import { requireAdmin } from "../../_lib/adminAuth.js";
import { listOrders } from "../../_lib/orders.js";

// GET /api/admin/orders — newest-first fulfillment queue for the dashboard.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!requireAdmin(req, res)) return;

  try {
    const orders = await listOrders(200);
    return res.status(200).json({ orders });
  } catch (err) {
    console.error("GET /api/admin/orders failed:", err);
    return res.status(500).json({ error: "internal_error" });
  }
}
