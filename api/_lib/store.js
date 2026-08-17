import { redis } from "./redis.js";

function designKey(id) {
  return `design:${id}`;
}

function userDesignsKey(userId) {
  return `user:${userId}:designs`;
}

function updatedScore(record) {
  return Date.parse(record?.updatedAt || record?.createdAt) || Date.now();
}

// Returns the stored record, or null if no design exists for this id.
export async function getDesign(id) {
  return await redis().get(designKey(id));
}

// Writes only if the id isn't already taken. Returns true on success,
// false if the id collided (caller should retry with a new id).
export async function putDesignIfAbsent(id, record) {
  const result = await redis().set(designKey(id), record, { nx: true });
  if (result !== null && record.ownerId) {
    await redis().zadd(userDesignsKey(record.ownerId), { score: updatedScore(record), member: id });
  }
  return result !== null;
}

export async function putDesign(id, record) {
  await redis().set(designKey(id), record);
  if (record.ownerId) {
    await redis().zadd(userDesignsKey(record.ownerId), { score: updatedScore(record), member: id });
  }
}

export async function listUserDesigns(userId) {
  const ids = await redis().zrange(userDesignsKey(userId), 0, -1, { rev: true });
  if (!ids || ids.length === 0) return [];
  const records = await Promise.all(ids.map((id) => getDesign(id)));
  return records.filter(Boolean);
}

export async function deleteOwnedDesign(id, ownerId) {
  const record = await getDesign(id);
  if (!record) return { ok: false, error: "not_found" };
  if (record.ownerId !== ownerId) return { ok: false, error: "forbidden" };
  await redis().del(designKey(id));
  await redis().zrem(userDesignsKey(ownerId), id);
  return { ok: true };
}
