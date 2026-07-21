import { redis } from "./redis.js";

// Fulfillment jobs — one per Shopify order. The record is the single source of
// truth the admin dashboard reads to know what to pull, print, and ship.
//
// Storage:
//   order:<orderId>   -> the fulfillment job record (JSON)
//   orders:index      -> sorted set, score = createdAt (ms), member = orderId
// The sorted set lets the dashboard list orders newest-first without scanning
// every key.

const INDEX_KEY = "orders:index";

function orderKey(orderId) {
  return `order:${orderId}`;
}

// Valid fulfillment states, in the order they typically progress.
export const ORDER_STATUSES = [
  "new",
  "supplies_pulled",
  "printed",
  "shipped",
];

export async function getOrder(orderId) {
  return await redis().get(orderKey(orderId));
}

// Idempotent upsert. Shopify can deliver the same webhook more than once, so we
// key on the order id and simply overwrite; the index score stays stable.
export async function putOrder(record) {
  const id = String(record.orderId);
  const score = Date.parse(record.createdAt) || Date.now();
  await redis().set(orderKey(id), record);
  await redis().zadd(INDEX_KEY, { score, member: id });
  return record;
}

// Newest-first list of full order records. `limit` caps how many we fetch.
export async function listOrders(limit = 100) {
  const ids = await redis().zrange(INDEX_KEY, 0, limit - 1, { rev: true });
  if (!ids || ids.length === 0) return [];
  const records = await Promise.all(ids.map((id) => getOrder(id)));
  return records.filter(Boolean);
}

// Updates just the status (and a per-item checklist, if provided). Returns the
// updated record, or null if the order doesn't exist.
export async function updateOrderStatus(orderId, { status, checklist } = {}) {
  const record = await getOrder(orderId);
  if (!record) return null;
  if (status && ORDER_STATUSES.includes(status)) record.status = status;
  if (checklist && typeof checklist === "object") record.checklist = checklist;
  record.updatedAt = new Date().toISOString();
  await redis().set(orderKey(String(orderId)), record);
  return record;
}
