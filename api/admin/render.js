import { requireAdmin } from "../_lib/adminAuth.js";
import { getDesign } from "../_lib/store.js";
import { DESIGN_ID_PATTERN } from "../_lib/id.js";
import { supabaseConfigured } from "../_lib/supabase.js";
import { documentPdf, documentFilename, DOC_TYPES } from "../_lib/render/index.js";

// GET /api/admin/render?designId=<id>&doc=chart|instructions
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

  const { designId, doc = "chart" } = req.query;
  if (typeof designId !== "string" || !DESIGN_ID_PATTERN.test(designId)) {
    return res.status(400).json({ error: "missing_design_id" });
  }
  if (!DOC_TYPES.includes(doc)) {
    return res.status(400).json({ error: "invalid_doc", allowed: DOC_TYPES });
  }

  try {
    const record = await getDesign(designId);
    if (!record) return res.status(404).json({ error: "design_not_found" });

    const pdf = await documentPdf(record, doc);
    if (!pdf) {
      return res.status(422).json({ error: "unsupported_for_type", type: record.type });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${documentFilename(record, doc)}"`
    );
    return res.status(200).send(Buffer.from(pdf));
  } catch (err) {
    console.error("GET /api/admin/render failed:", err);
    return res.status(500).json({ error: "render_failed" });
  }
}
