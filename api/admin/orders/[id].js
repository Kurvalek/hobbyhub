import { requireAdmin } from "../../_lib/adminAuth.js";
import {
  getOrder,
  updateOrderStatus,
  ORDER_STATUSES,
} from "../../_lib/orders.js";
import { supabaseConfigured } from "../../_lib/supabase.js";

// GET   /api/admin/orders/:id  — full fulfillment job (items, BOM, checklist).
// PATCH /api/admin/orders/:id  — update status and/or the pick-list checklist.
// `:id` is the Shopify order id, which is what the dashboard has in hand.
export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (!supabaseConfigured()) {
    return res.status(503).json({ error: "supabase_not_configured" });
  }

  const { id } = req.query;
  if (typeof id !== "string" || !id) {
    return res.status(400).json({ error: "invalid_id" });
  }

  try {
    if (req.method === "GET") {
      const order = await getOrder(id);
      if (!order) return res.status(404).json({ error: "not_found" });
      return res.status(200).json(order);
    }

    if (req.method === "PATCH") {
      const { status, checklist } = req.body || {};
      if (status && !ORDER_STATUSES.includes(status)) {
        return res.status(400).json({
          error: "invalid_status",
          allowed: ORDER_STATUSES,
        });
      }
      const updated = await updateOrderStatus(id, { status, checklist });
      if (!updated) return res.status(404).json({ error: "not_found" });
      return res.status(200).json(updated);
    }

    res.setHeader("Allow", "GET, PATCH");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    console.error("admin order endpoint failed:", err);
    return res.status(500).json({ error: "internal_error" });
  }
}
