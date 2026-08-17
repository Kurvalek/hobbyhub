import { adminSupabase } from "./supabase.js";

// Fulfillment jobs — one per Shopify order, in `public.orders` +
// `public.order_items`. The record is the single source of truth the admin
// dashboard reads to know what to pull, print, and ship.
//
// Everything here uses the service role: orders cross user boundaries by nature
// (the buyer of a kit isn't necessarily the designer) and RLS on these tables
// denies the browser outright. Only the HMAC-verified webhook and the
// ADMIN_TOKEN-gated endpoints reach this file.
//
// The nested camelCase shape below is the dashboard's existing contract
// (order.customer.name, order.shipping.zip, order.items[].designFound, …), so we
// flatten on write and re-nest on read rather than changing admin.html.

// Valid fulfillment states, in the order they typically progress.
export const ORDER_STATUSES = [
  "new",
  "supplies_pulled",
  "printed",
  "shipped",
];

const ORDER_COLUMNS = `
  id, shopify_order_id, order_name, customer_name, customer_email,
  ship_name, ship_address1, ship_address2, ship_city, ship_province, ship_zip,
  ship_country, status, checklist, created_at, received_at, updated_at,
  order_items ( position, line_item_id, title, variant_title, quantity, sku,
                design_id, design_ref, design_found, type, bom )
`;

function toItem(row) {
  return {
    lineItemId: row.line_item_id,
    title: row.title,
    variantTitle: row.variant_title,
    quantity: row.quantity,
    sku: row.sku,
    // design_ref is the raw id Shopify sent. Falling back to it keeps the
    // dashboard's "design not found for id X" warning informative when the id
    // resolved to nothing (or the design was deleted afterwards).
    designId: row.design_id || row.design_ref || null,
    designFound: row.design_found,
    type: row.type,
    bom: row.bom,
  };
}

function toOrder(row) {
  if (!row) return null;
  const items = [...(row.order_items || [])]
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .map(toItem);
  return {
    orderId: row.shopify_order_id,
    orderName: row.order_name,
    createdAt: row.created_at,
    receivedAt: row.received_at,
    updatedAt: row.updated_at,
    status: row.status,
    checklist: row.checklist || {},
    customer: { name: row.customer_name, email: row.customer_email },
    shipping: {
      name: row.ship_name,
      address1: row.ship_address1,
      address2: row.ship_address2,
      city: row.ship_city,
      province: row.ship_province,
      zip: row.ship_zip,
      country: row.ship_country,
    },
    items,
  };
}

export async function getOrder(orderId) {
  const { data, error } = await adminSupabase()
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("shopify_order_id", String(orderId))
    .maybeSingle();
  if (error) throw error;
  return toOrder(data);
}

// Idempotent upsert keyed on shopify_order_id, because Shopify can deliver the
// same webhook more than once. `status`, `checklist`, and `received_at` are
// deliberately NOT part of the write — a redelivery must never reset work
// already done in the dashboard. Items are replaced wholesale (delete + insert)
// since the incoming payload is authoritative about what was bought.
export async function putOrder(record) {
  const db = adminSupabase();
  const shopifyOrderId = String(record.orderId);
  const ship = record.shipping || {};
  const customer = record.customer || {};

  const { data: upserted, error: orderError } = await db
    .from("orders")
    .upsert(
      {
        shopify_order_id: shopifyOrderId,
        order_name: record.orderName ?? null,
        customer_name: customer.name ?? null,
        customer_email: customer.email ?? null,
        ship_name: ship.name ?? null,
        ship_address1: ship.address1 ?? null,
        ship_address2: ship.address2 ?? null,
        ship_city: ship.city ?? null,
        ship_province: ship.province ?? null,
        ship_zip: ship.zip ?? null,
        ship_country: ship.country ?? null,
        created_at: record.createdAt || new Date().toISOString(),
      },
      { onConflict: "shopify_order_id" },
    )
    .select("id")
    .single();
  if (orderError) throw orderError;

  const orderRowId = upserted.id;
  const { error: deleteError } = await db
    .from("order_items")
    .delete()
    .eq("order_id", orderRowId);
  if (deleteError) throw deleteError;

  const items = record.items || [];
  if (items.length) {
    const rows = items.map((item, position) => ({
      order_id: orderRowId,
      position,
      line_item_id: item.lineItemId ?? null,
      title: item.title ?? null,
      variant_title: item.variantTitle ?? null,
      quantity: item.quantity ?? 1,
      sku: item.sku ?? null,
      // Only the resolved id may go in the FK column; the raw one always goes
      // in design_ref so nothing is lost when it doesn't resolve.
      design_id: item.designFound ? item.designId : null,
      design_ref: item.designId ?? null,
      design_found: Boolean(item.designFound),
      type: item.type ?? null,
      bom: item.bom ?? null,
    }));
    const { error: itemsError } = await db.from("order_items").insert(rows);
    if (itemsError) throw itemsError;
  }

  return await getOrder(shopifyOrderId);
}

// Newest-first list of full order records. `limit` caps how many we fetch.
export async function listOrders(limit = 100) {
  const { data, error } = await adminSupabase()
    .from("orders")
    .select(ORDER_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(toOrder);
}

// Updates just the status (and a per-item checklist, if provided). Returns the
// updated record, or null if the order doesn't exist. `updated_at` is maintained
// by a trigger.
export async function updateOrderStatus(orderId, { status, checklist } = {}) {
  const patch = {};
  if (status && ORDER_STATUSES.includes(status)) patch.status = status;
  if (checklist && typeof checklist === "object") patch.checklist = checklist;

  // Nothing to change — still answer with the current record (or null) so the
  // dashboard's 404 handling stays correct.
  if (Object.keys(patch).length === 0) return await getOrder(orderId);

  const { data, error } = await adminSupabase()
    .from("orders")
    .update(patch)
    .eq("shopify_order_id", String(orderId))
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return await getOrder(orderId);
}
