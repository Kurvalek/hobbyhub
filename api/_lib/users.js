import { redis } from "./redis.js";
import { generateDesignId } from "./id.js";

function userKey(id) {
  return `user:${id}`;
}

function emailKey(email) {
  return `email:${email}`;
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    stripeCustomerId: user.stripeCustomerId ?? null,
  };
}

export async function getUser(id) {
  if (!id) return null;
  return await redis().get(userKey(id));
}

export async function getUserByEmail(email) {
  const id = await redis().get(emailKey(email));
  if (!id) return null;
  return await getUser(id);
}

// Finds or creates the MeTime user for this email. stripeCustomerId stays
// null until Stripe checkout is wired; Stripe is never the login.
export async function getOrCreateUser(email) {
  const existing = await getUserByEmail(email);
  if (existing) return existing;

  const user = {
    id: generateDesignId(),
    email,
    createdAt: new Date().toISOString(),
    stripeCustomerId: null,
  };
  await redis().set(userKey(user.id), user);
  await redis().set(emailKey(email), user.id);
  return user;
}
