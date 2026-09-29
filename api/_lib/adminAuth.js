import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Gate for the admin endpoints. Two kinds of credential are accepted on
// `Authorization: Bearer <value>`:
//
//   1. A session token issued by POST /api/admin/login in exchange for the
//      correct password. This is what the dashboard uses.
//   2. The raw ADMIN_TOKEN, when set — a long random string for curl and the
//      scripts in tools/, which have no session to carry.
//
// The password is never stored or sent after sign-in: the environment holds
// only a scrypt hash of it, and the browser holds only a session token. That
// way a leaked env dump or a leaked browser session doesn't hand over the
// password itself.
//
// If neither ADMIN_PASSWORD_HASH nor ADMIN_TOKEN is set the endpoints stay
// locked (fail closed) so a misconfigured deploy never exposes orders.

// scrypt is deliberately slow, which is the point: it's what makes guessing a
// human-chosen password expensive rather than instant. 128 * N * r = 16 MB of
// memory per attempt, ~50-100ms of CPU.
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 32;

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// base64url throughout so the hash is safe to paste into a .env file or a
// Vercel env var without quoting.
export function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(normalize(password), salt, KEY_LEN, SCRYPT);
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64, "base64url");
  const expected = Buffer.from(keyB64, "base64url");
  if (!salt.length || !expected.length) return false;

  let actual;
  try {
    actual = scryptSync(normalize(password), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
  } catch {
    return false;
  }
  return equal(actual, expected);
}

// Unicode normalization so a password typed with a composed vs. decomposed
// accent still matches the one that was hashed.
function normalize(password) {
  return String(password ?? "").normalize("NFKC");
}

// The signing key is derived from the stored password hash rather than being
// its own env var. Two benefits: nothing extra to configure, and changing the
// password automatically invalidates every session that was already issued.
function sessionSecret() {
  const hash = process.env.ADMIN_PASSWORD_HASH || "";
  if (!hash) return null;
  return createHmac("sha256", "studio-admin-session-v1").update(hash).digest();
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
  return equal(Buffer.from(parts[2]), Buffer.from(expected));
}

function matchesMachineToken(token) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  return equal(Buffer.from(token), Buffer.from(expected));
}

// timingSafeEqual throws on a length mismatch, and the length check itself has
// to happen before it — comparing lengths leaks nothing a response time
// wouldn't already.
function equal(a, b) {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function passwordConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD_HASH);
}

export function adminConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_TOKEN);
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
