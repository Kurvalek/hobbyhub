import { applyCors } from "../_lib/cors.js";
import { DESIGN_ID_PATTERN } from "../_lib/id.js";
import { deleteOwnedDesign, getDesign, updateOwnedDesign } from "../_lib/store.js";
import { requireUser } from "../_lib/auth.js";
import { supabaseConfigured } from "../_lib/supabase.js";
import { validateDesignPayload } from "../_lib/validate.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (!supabaseConfigured()) {
    return res.status(503).json({ error: "supabase_not_configured" });
  }

  const { id } = req.query;
  if (typeof id !== "string" || !DESIGN_ID_PATTERN.test(id)) {
    return res.status(400).json({ error: "invalid_id" });
  }

  // Anonymous read by id, on purpose. The uuid is the capability: a kit bought
  // by someone who isn't the designer still has to be resolvable at fulfillment
  // time (Shopify webhook, admin PDF render), so this read runs with the service
  // role and does not check ownership. Writes below do.
  if (req.method === "GET") {
    try {
      const record = await getDesign(id);
      if (!record) {
        return res.status(404).json({ error: "not_found" });
      }
      return res.status(200).json(record);
    } catch (err) {
      console.error("GET /api/designs/[id] failed:", err);
      return res.status(500).json({ error: "internal_error" });
    }
  }

  // PUT and PATCH are the same operation here — the studio replaces the whole
  // design payload on every save-in-place. Both are accepted so either verb
  // works from the client.
  if (req.method === "PUT" || req.method === "PATCH") {
    const user = await requireUser(req, res);
    if (!user) return;

    const error = validateDesignPayload(req.body);
    if (error === "payload_too_large") {
      return res.status(400).json({ error: "payload_too_large" });
    }
    if (error) {
      return res.status(400).json({ error: "invalid_payload", message: error });
    }

    try {
      const existing = await getDesign(id);
      if (!existing) return res.status(404).json({ error: "not_found" });
      if (existing.type !== req.body.type) {
        return res.status(400).json({ error: "type_mismatch" });
      }

      // RLS scopes the update to this user's rows, so a design owned by someone
      // else (or unowned) matches nothing and comes back null.
      const updated = await updateOwnedDesign(req, id, { data: req.body.data });
      if (!updated) return res.status(403).json({ error: "forbidden" });
      return res.status(200).json({ id: updated.id });
    } catch (err) {
      console.error("PUT /api/designs/[id] failed:", err);
      return res.status(500).json({ error: "internal_error" });
    }
  }

  if (req.method === "DELETE") {
    const user = await requireUser(req, res);
    if (!user) return;
    try {
      const removed = await deleteOwnedDesign(req, id);
      if (!removed) {
        // RLS can't tell us apart "never existed" from "not yours"; the
        // existence check decides which answer the caller earns.
        const existing = await getDesign(id);
        return res.status(existing ? 403 : 404).json({
          error: existing ? "forbidden" : "not_found",
        });
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("DELETE /api/designs/[id] failed:", err);
      return res.status(500).json({ error: "internal_error" });
    }
  }

  res.setHeader("Allow", "GET, PUT, PATCH, DELETE, OPTIONS");
  return res.status(405).json({ error: "method_not_allowed" });
}
