import { applyCors } from "./_lib/cors.js";
import { validateDesignPayload } from "./_lib/validate.js";
import { documentPdf, documentFilename, DOC_TYPES } from "./_lib/render/index.js";

// POST /api/render  { type, data, doc }
// Renders a design straight from the request body to a PDF and streams it back —
// no storage round-trip, so the studio can offer "Download cut list" /
// "Download instructions" for a locally-saved design without uploading it first.
// It only ever renders our own generated HTML (built from the validated design
// data), never arbitrary markup, so there's no HTML-injection/SSRF surface here.
export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { type, data, doc = "chart" } = req.body || {};

  if (!DOC_TYPES.includes(doc)) {
    return res.status(400).json({ error: "invalid_doc", allowed: DOC_TYPES });
  }

  const error = validateDesignPayload({ type, data });
  if (error === "payload_too_large") {
    return res.status(400).json({ error: "payload_too_large" });
  }
  if (error) {
    return res.status(400).json({ error: "invalid_payload", message: error });
  }

  try {
    const record = { type, data };
    const pdf = await documentPdf(record, doc);
    if (!pdf) {
      return res.status(422).json({ error: "unsupported_for_type", type });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${documentFilename(record, doc)}"`
    );
    return res.status(200).send(Buffer.from(pdf));
  } catch (err) {
    console.error("POST /api/render failed:", err);
    return res.status(500).json({ error: "render_failed" });
  }
}
