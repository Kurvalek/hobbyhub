import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { redis } from "./redis.js";

const CODE_TTL_SEC = 10 * 60;
const SEND_WINDOW_SEC = 15 * 60;
const MAX_SENDS_PER_EMAIL = 5;
const MAX_SENDS_PER_IP = 20;
const MAX_VERIFY_PER_EMAIL = 15;
const MAX_ATTEMPTS_PER_CODE = 5;

function pepper() {
  return process.env.AUTH_SECRET || process.env.ADMIN_TOKEN || "dev-insecure-auth-secret";
}

function hashCode(email, code) {
  return createHash("sha256").update(`${pepper()}:${email}:${code}`).digest("hex");
}

function hashesEqual(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function rateLimit(key, max, windowSec) {
  const n = await redis().incr(key);
  if (n === 1) await redis().expire(key, windowSec);
  return n > max;
}

export function generateAuthCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function normalizeAuthCode(code) {
  return String(code || "").replace(/\D/g, "").slice(0, 6);
}

export async function issueAuthCode(email, ip) {
  const sendEmailLimited = await rateLimit(`rl:auth:send:email:${email}`, MAX_SENDS_PER_EMAIL, SEND_WINDOW_SEC);
  const sendIpLimited = await rateLimit(`rl:auth:send:ip:${ip}`, MAX_SENDS_PER_IP, SEND_WINDOW_SEC);
  if (sendEmailLimited || sendIpLimited) {
    return { ok: false, error: "rate_limited" };
  }

  const code = generateAuthCode();
  await redis().set(
    `authcode:${email}`,
    { hash: hashCode(email, code), attempts: 0 },
    { ex: CODE_TTL_SEC },
  );
  return { ok: true, code };
}

export async function consumeAuthCode(email, code) {
  const verifyLimited = await rateLimit(`rl:auth:verify:email:${email}`, MAX_VERIFY_PER_EMAIL, SEND_WINDOW_SEC);
  if (verifyLimited) {
    return { ok: false, error: "rate_limited" };
  }

  const normalized = normalizeAuthCode(code);
  if (normalized.length !== 6) {
    return { ok: false, error: "invalid_code" };
  }

  const record = await redis().get(`authcode:${email}`);
  if (!record || !record.hash) {
    return { ok: false, error: "invalid_code" };
  }

  const attempts = (record.attempts || 0) + 1;
  if (attempts > MAX_ATTEMPTS_PER_CODE) {
    await redis().del(`authcode:${email}`);
    return { ok: false, error: "invalid_code" };
  }

  if (!hashesEqual(record.hash, hashCode(email, normalized))) {
    if (attempts >= MAX_ATTEMPTS_PER_CODE) {
      await redis().del(`authcode:${email}`);
    } else {
      await redis().set(`authcode:${email}`, { ...record, attempts }, { ex: CODE_TTL_SEC });
    }
    return { ok: false, error: "invalid_code" };
  }

  await redis().del(`authcode:${email}`);
  return { ok: true };
}
