import {
  SESSION_TTL_MS,
  issueSession,
  passwordConfigured,
  verifyAdminPassword,
} from "../_lib/adminAuth.js";

// POST /api/admin/login — trade the admin password for a session token.
//
// Deliberately same-origin only (no CORS headers), so a page on another site
// can't drive password guesses through a visitor's browser.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

// Per-instance, in-memory throttle. The password is compared directly rather
// than through a slow hash, so a guess costs an attacker almost nothing and
// this is the only thing standing between a plain password and an offline-speed
// online attack — treat MAX_ATTEMPTS as load-bearing, not as polish.
//
// Vercel may run several instances and each keeps its own counter, so the real
// ceiling is some multiple of MAX_ATTEMPTS per window. That still removes the
// high-volume case, which is the one that matters, without taking on a database
// or a Redis dependency for a single-admin dashboard.
const attempts = new Map();

function clientKey(req) {
  const fwd = req.headers?.["x-forwarded-for"];
  const first = Array.isArray(fwd) ? fwd[0] : String(fwd || "").split(",")[0];
  return first.trim() || req.socket?.remoteAddress || "unknown";
}

// Returns seconds to wait, or 0 when the caller may try now.
function throttled(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.first > WINDOW_MS) return 0;
  if (rec.count < MAX_ATTEMPTS) return 0;
  return Math.ceil((rec.first + WINDOW_MS - now) / 1000);
}

function recordFailure(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.first > WINDOW_MS) attempts.set(key, { first: now, count: 1 });
  else rec.count += 1;

  // Bounded cleanup so a long-lived instance can't accumulate entries forever.
  if (attempts.size > 500) {
    for (const [k, v] of attempts) {
      if (now - v.first > WINDOW_MS) attempts.delete(k);
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!passwordConfigured()) {
    return res.status(503).json({ error: "password_not_configured" });
  }

  const key = clientKey(req);
  const wait = throttled(key);
  if (wait) {
    res.setHeader("Retry-After", String(wait));
    return res.status(429).json({ error: "too_many_attempts", retryAfter: wait });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  const password = body?.password;
  if (typeof password !== "string" || !password) {
    return res.status(400).json({ error: "password_required" });
  }

  if (!verifyAdminPassword(password)) {
    recordFailure(key);
    return res.status(401).json({ error: "invalid_password" });
  }

  attempts.delete(key);
  const session = issueSession(SESSION_TTL_MS);
  return res.status(200).json(session);
}
