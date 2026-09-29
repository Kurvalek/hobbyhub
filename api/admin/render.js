import { requireAdmin } from "../_lib/adminAuth.js";
import { getDesign } from "../_lib/store.js";
import { getOrder } from "../_lib/orders.js";
import { DESIGN_ID_PATTERN } from "../_lib/id.js";
import { supabaseConfigured } from "../_lib/supabase.js";
import {
  documentPdf,
  documentFilename,
  orderDocumentPdf,
  orderDocumentFilename,
  DESIGN_DOC_TYPES,
  ORDER_DOC_TYPES,
} from "../_lib/render/index.js";

// GET /api/admin/render?designId=<id>&doc=chart|instructions
// GET /api/admin/render?orderId=<id>&doc=pick-sheet|packing-slip|bundle
//
// Renders the requested document on demand and streams it back as a PDF. The
// dashboard fetches this with the admin bearer token, so no design id ever
// leaks the PDF publicly. Generation is on-demand (no stored assets) — fine for
// low order volume; swap in blob storage later if you want to cache them.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!requireAdmin(req, res)) return;
  if (!supabaseConfigured()) {
    return res.status(503).json({ error: "supabase_not_configured" });
  }

  const { designId, orderId, doc = "chart" } = req.query;

  try {
    if (typeof orderId === "string" && orderId) {
      return await renderOrderDoc(res, orderId, doc);
    }
    if (typeof designId === "string" && designId) {
      return await renderDesignDoc(res, designId, doc);
    }
    return res.status(400).json({ error: "missing_design_id_or_order_id" });
  } catch (err) {
    console.error("GET /api/admin/render failed:", err);
    return res.status(500).json({ error: "render_failed" });
  }
}

async function renderDesignDoc(res, designId, doc) {
  if (!DESIGN_ID_PATTERN.test(designId)) {
    return res.status(400).json({ error: "missing_design_id" });
  }
  if (!DESIGN_DOC_TYPES.includes(doc)) {
    return res.status(400).json({ error: "invalid_doc", allowed: DESIGN_DOC_TYPES });
  }

  const record = await getDesign(designId);
  if (!record) return res.status(404).json({ error: "design_not_found" });

  const pdf = await documentPdf(record, doc);
  if (!pdf) {
    return res.status(422).json({ error: "unsupported_for_type", type: record.type });
  }
  return sendPdf(res, pdf, documentFilename(record, doc));
}

async function renderOrderDoc(res, orderId, doc) {
  if (!ORDER_DOC_TYPES.includes(doc)) {
    return res.status(400).json({ error: "invalid_doc", allowed: ORDER_DOC_TYPES });
  }

  const order = await getOrder(orderId);
  if (!order) return res.status(404).json({ error: "order_not_found" });

  // Only the bundle needs the designs themselves — the pick sheet and packing
  // slip come from the BOM frozen onto the order at purchase time. Items whose
  // design has since been deleted simply contribute no chart to the packet;
  // the pick sheet still flags them for manual handling.
  let designs = null;
  if (doc === "bundle") {
    designs = new Map();
    const ids = [
      ...new Set(
        (order.items || [])
          .filter((i) => i.designFound && i.designId && DESIGN_ID_PATTERN.test(i.designId))
          .map((i) => i.designId)
      ),
    ];
    const records = await Promise.all(ids.map((id) => getDesign(id)));
    records.forEach((record, i) => {
      if (record) designs.set(ids[i], record);
    });
  }

  const pdf = await orderDocumentPdf(order, doc, designs);
  if (!pdf) return res.status(422).json({ error: "nothing_to_render", doc });
  return sendPdf(res, pdf, orderDocumentFilename(order, doc));
}

function sendPdf(res, pdf, filename) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  return res.status(200).send(Buffer.from(pdf));
}
