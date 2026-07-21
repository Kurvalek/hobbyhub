import { createHmac, timingSafeEqual } from "node:crypto";

// Verifies a Shopify webhook using the raw request body and the shared secret
// (Shopify admin → Settings → Notifications → Webhooks, or the app's API secret
// for app-created webhooks). Compares against the X-Shopify-Hmac-Sha256 header.
// Returns true only on an exact, constant-time match.
export function verifyShopifyWebhook(rawBody, hmacHeader, secret) {
  if (!secret || !hmacHeader) return false;
  const digest = createHmac("sha256", secret).update(rawBody).digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(String(hmacHeader));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Collects the raw request body as a Buffer. HMAC verification must run against
// the exact bytes Shopify signed, so we read the stream ourselves rather than
// letting the platform JSON-parse it first.
export async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// The line-item property (and cart attribute) name that carries our design id.
// The studio sets this when adding a kit to the Shopify cart.
export const DESIGN_ID_PROPERTY = "_design_id";

// Maps a Shopify line item to the design it represents. We look first at
// per-line-item properties, then fall back to order-level note attributes so a
// single-item cart still works if the id was attached at the cart level.
function designIdForLineItem(lineItem, noteAttributes) {
  const props = lineItem?.properties || [];
  const hit = props.find((p) => p?.name === DESIGN_ID_PROPERTY && p?.value);
  if (hit) return String(hit.value);
  const note = (noteAttributes || []).find(
    (n) => n?.name === DESIGN_ID_PROPERTY && n?.value
  );
  return note ? String(note.value) : null;
}

// Normalizes a raw Shopify order payload into the flat shape our fulfillment
// job needs: which designs were bought, in what quantity, plus who to ship to.
export function extractOrder(order) {
  const noteAttributes = order?.note_attributes || [];
  const items = (order?.line_items || []).map((li) => ({
    lineItemId: li?.id != null ? String(li.id) : null,
    title: li?.title || li?.name || "Item",
    variantTitle: li?.variant_title || null,
    quantity: li?.quantity || 1,
    sku: li?.sku || null,
    designId: designIdForLineItem(li, noteAttributes),
  }));

  const ship = order?.shipping_address || {};
  return {
    orderId: order?.id != null ? String(order.id) : null,
    orderName: order?.name || (order?.order_number ? `#${order.order_number}` : null),
    createdAt: order?.created_at || new Date().toISOString(),
    customer: {
      name:
        [order?.customer?.first_name, order?.customer?.last_name]
          .filter(Boolean)
          .join(" ") || ship.name || null,
      email: order?.email || order?.customer?.email || null,
    },
    shipping: {
      name: ship.name || null,
      address1: ship.address1 || null,
      address2: ship.address2 || null,
      city: ship.city || null,
      province: ship.province || null,
      zip: ship.zip || null,
      country: ship.country || null,
    },
    items,
  };
}
