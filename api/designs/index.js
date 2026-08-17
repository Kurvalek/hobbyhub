import { applyCors } from "../_lib/cors.js";
import { validateDesignPayload } from "../_lib/validate.js";
import { createDesign, listUserDesigns } from "../_lib/store.js";
import { getRequestUser, requireUser } from "../_lib/auth.js";
import { supabaseConfigured } from "../_lib/supabase.js";

// GET  — the signed-in user's library, newest edit first. Requires an account.
// POST — save a design. Owned when the caller sends a valid access token,
//        unowned when they don't: guest kit checkout has to be able to park a
//        design somewhere the Shopify webhook can find it, and requiring an
//        account for that would break checkout for anyone who never signs in.
export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (!supabaseConfigured()) {
    return res.status(503).json({ error: "supabase_not_configured" });
  }

  if (req.method === "GET") {
    const user = await requireUser(req, res);
    if (!user) return;
    try {
      const designs = await listUserDesigns(req);
      return res.status(200).json({ designs });
    } catch (err) {
      console.error("GET /api/designs failed:", err);
      return res.status(500).json({ error: "internal_error" });
    }
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const error = validateDesignPayload(req.body);
  if (error === "payload_too_large") {
    return res.status(400).json({ error: "payload_too_large" });
  }
  if (error) {
    return res.status(400).json({ error: "invalid_payload", message: error });
  }

  try {
    const user = await getRequestUser(req);
    const record = await createDesign(req, user, {
      type: req.body.type,
      data: req.body.data,
    });
    return res.status(201).json({ id: record.id });
  } catch (err) {
    console.error("POST /api/designs failed:", err);
    return res.status(500).json({ error: "internal_error" });
  }
}
