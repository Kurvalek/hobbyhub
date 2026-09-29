import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Gate for the admin endpoints. Two kinds of credential are accepted on
// `Authorization: Bearer <value>`:
//
//   1. A session token issued by POST /api/admin/login in exchange for the
//      correct password. This is what the dashboard uses.
//   2. The raw ADMIN_TOKEN, when set — a long random string for curl and the
//      scripts in tools/, which have no session to carry.
//
// There is one admin, so the password lives in ADMIN_PASSWORD as-is rather
// than as a hash. The tradeoff is explicit: anyone who can read the
// environment can read the password, so it must not be one used anywhere
// else. Online guessing is handled by the rate limit in admin/login.js.
//
// If neither ADMIN_PASSWORD nor ADMIN_TOKEN is set the endpoints stay locked
// (fail closed) so a misconfigured deploy never exposes orders.

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// timingSafeEqual throws unless both buffers are the same length, and feeding
// it the raw strings would leak the password's length through that throw.
// Comparing fixed-width digests instead keeps the comparison constant-time and
// length-blind: any two inputs, whatever their size, produce 32 bytes.
function constantTimeEqual(a, b) {
  const ha = createHash("sha256").update(String(a ?? ""), "utf8").digest();
  const hb = createHash("sha256").update(String(b ?? ""), "utf8").digest();
  return timingSafeEqual(ha, hb);
}

export function verifyAdminPassword(password) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return constantTimeEqual(password, expected);
}

// The signing key is derived from the password rather than being its own env
// var. Two benefits: nothing extra to configure, and changing the password
// automatically invalidates every session that was already issued.
function sessionSecret() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  return createHmac("sha256", "studio-admin-session-v1").update(password).digest();
}

// A session token is just an expiry stamped and signed by the server — there
// is no session store, so nothing to clean up and nothing to read if the
// database leaks. Revocation is by changing the password.
export function issueSession(ttlMs = SESSION_TTL_MS) {
  const secret = sessionSecret();
  if (!secret) return null;

  const expiresAt = Date.now() + ttlMs;
  const payload = `v1.${expiresAt}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return { token: `${payload}.${sig}`, expiresAt };
}

function validSession(token) {
  const secret = sessionSecret();
  if (!secret) return false;

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;

  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

  const expected = createHmac("sha256", secret)
    .update(`v1.${parts[1]}`)
    .digest("base64url");
  return constantTimeEqual(parts[2], expected);
}

function matchesMachineToken(token) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  return constantTimeEqual(token, expected);
}

export function passwordConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD);
}

export function adminConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD || process.env.ADMIN_TOKEN);
}

export function requireAdmin(req, res) {
  if (!adminConfigured()) {
    res.status(503).json({ error: "admin_not_configured" });
    return false;
  }

  const header = req.headers?.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token && (validSession(token) || matchesMachineToken(token))) return true;

  res.status(401).json({ error: "unauthorized" });
  return false;
}
