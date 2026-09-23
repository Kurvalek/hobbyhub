import { applyCors } from "./_lib/cors.js";
import { validateDesignPayload } from "./_lib/validate.js";
import { designToBom } from "./_lib/bom.js";

// POST /api/bom  { type, data }  ->  { bom }
// The supplies a design turns into, for the kit review page the maker sees before
// checkout. Same shape as /api/render: straight from the request body, so the
// studio can price up a design it hasn't uploaded yet, and nothing is stored.
//
// This exists rather than doing the arithmetic in the browser because the skein
// and cut-margin constants live in the server's env (STITCHES_PER_SKEIN,
// LOOPS_PER_SKEIN, AIDA_MARGIN_IN, MONKS_CLOTH_MARGIN_IN) and the packer works
// from this same function. A second copy in the page could quietly promise a
// maker something different from what gets put in the box.
export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { type, data } = req.body || {};

  const error = validateDesignPayload({ type, data });
  if (error === "payload_too_large") {
    return res.status(400).json({ error: "payload_too_large" });
  }
  if (error) {
    return res.status(400).json({ error: "invalid_payload", message: error });
  }

  const bom = designToBom({ type, data });
  if (!bom) {
    return res.status(422).json({ error: "unsupported_for_type", type });
  }

  return res.status(200).json({ bom });
}
