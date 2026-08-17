import { redis } from "./redis.js";
import { generateDesignId } from "./id.js";
import { getUser, publicUser } from "./users.js";

const COOKIE = "metime_session";
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

function sessionKey(id) {
  return `session:${id}`;
}

function cookieSecure() {
  // HTTPS deploys need Secure; `vercel dev` is http://localhost.
  return process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "development";
}

function sessionCookie(id, { clear = false } = {}) {
  const parts = [
    `${COOKIE}=${clear ? "" : id}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (clear) parts.push("Max-Age=0");
  else parts.push(`Max-Age=${SESSION_TTL_SEC}`);
  if (cookieSecure()) parts.push("Secure");
  return parts.join("; ");
}

export function parseCookies(req) {
  const header = req.headers?.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function clientIp(req) {
  const xf = req.headers?.["x-forwarded-for"];
  if (typeof xf === "string" && xf) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

export async function createSession(res, userId) {
  const id = generateDesignId();
  await redis().set(sessionKey(id), { userId, createdAt: new Date().toISOString() }, { ex: SESSION_TTL_SEC });
  res.setHeader("Set-Cookie", sessionCookie(id));
  return id;
}

export async function destroySession(req, res) {
  const id = parseCookies(req)[COOKIE];
  if (id) await redis().del(sessionKey(id));
  res.setHeader("Set-Cookie", sessionCookie("", { clear: true }));
}

export async function getSessionUser(req) {
  const id = parseCookies(req)[COOKIE];
  if (!id) return null;
  const session = await redis().get(sessionKey(id));
  if (!session || !session.userId) return null;
  const user = await getUser(session.userId);
  return publicUser(user);
}

// Sends 401 and returns null when there is no session. Library routes use this.
export async function requireUser(req, res) {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  return user;
}
