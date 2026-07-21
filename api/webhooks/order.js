import {
  verifyShopifyWebhook,
  readRawBody,
  extractOrder,
} from "../_lib/shopify.js";
import { getDesign } from "../_lib/store.js";
import { designToBom } from "../_lib/bom.js";
import { putOrder, getOrder } from "../_lib/orders.js";

// We verify Shopify's HMAC against the exact bytes it signed, so the platform
// must not JSON-parse the body first. Reading the raw stream ourselves keeps
// those bytes intact.
export const config = { api: { bodyParser: false } };

// Receives Shopify `orders/create` webhooks. On a verified order we resolve each
// purchased design, compute its supply BOM, and store a fulfillment job the
// admin dashboard can act on. Always returns 200 quickly on success so Shopify
// doesn't retry.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (err) {
    console.error("order webhook: failed to read body:", err);
    return res.status(400).json({ error: "bad_request" });
  }

  const hmac = req.headers["x-shopify-hmac-sha256"];
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!verifyShopifyWebhook(raw, hmac, secret)) {
    return res.status(401).json({ error: "invalid_signature" });
  }

  let order;
  try {
    order = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "invalid_json" });
  }

  const normalized = extractOrder(order);
  if (!normalized.orderId) {
    return res.status(400).json({ error: "missing_order_id" });
  }

  try {
    // Resolve each line item's design and attach its supply BOM. A missing or
    // unrecognized design is flagged (designFound=false) rather than failing the
    // whole webhook, so the order still shows up for manual handling.
    const items = await Promise.all(
      normalized.items.map(async (item) => {
        if (!item.designId) {
          return { ...item, designFound: false, type: "unknown", bom: null };
        }
        const record = await getDesign(item.designId);
        if (!record) {
          return { ...item, designFound: false, type: "unknown", bom: null };
        }
        return {
          ...item,
          designFound: true,
          type: record.type,
          bom: designToBom(record),
        };
      })
    );

    // Preserve any fulfillment progress if Shopify re-delivers the webhook.
    const existing = await getOrder(normalized.orderId);
    const record = {
      ...normalized,
      items,
      status: existing?.status || "new",
      checklist: existing?.checklist || {},
      receivedAt: existing?.receivedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await putOrder(record);
    return res.status(200).json({ ok: true, orderId: record.orderId });
  } catch (err) {
    console.error("order webhook: processing failed:", err);
    return res.status(500).json({ error: "internal_error" });
  }
}
