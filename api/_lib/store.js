import { redis } from "./redis.js";

function designKey(id) {
  return `design:${id}`;
}

// Returns the stored record, or null if no design exists for this id.
export async function getDesign(id) {
  return await redis().get(designKey(id));
}

// Writes only if the id isn't already taken. Returns true on success,
// false if the id collided (caller should retry with a new id).
export async function putDesignIfAbsent(id, record) {
  const result = await redis().set(designKey(id), record, { nx: true });
  return result !== null;
}
