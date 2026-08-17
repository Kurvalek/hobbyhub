import { applyCors } from "../_lib/cors.js";
import { DESIGN_ID_PATTERN } from "../_lib/id.js";
import { deleteOwnedDesign, getDesign, putDesign } from "../_lib/store.js";
import { requireUser } from "../_lib/session.js";
import { validateDesignPayload } from "../_lib/validate.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  const { id } = req.query;
  if (typeof id !== "string" || !DESIGN_ID_PATTERN.test(id)) {
    return res.status(400).json({ error: "invalid_id" });
  }

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

  if (req.method === "PUT") {
    const user = await requireUser(req, res);
    if (!user) return;

    const existing = await getDesign(id);
    if (!existing) return res.status(404).json({ error: "not_found" });
    if (existing.ownerId !== user.id) return res.status(403).json({ error: "forbidden" });

    const error = validateDesignPayload(req.body);
    if (error === "payload_too_large") {
      return res.status(400).json({ error: "payload_too_large" });
    }
    if (error) {
      return res.status(400).json({ error: "invalid_payload", message: error });
    }
    if (req.body.type !== existing.type) {
      return res.status(400).json({ error: "type_mismatch" });
    }

    try {
      const record = {
        ...existing,
        data: req.body.data,
        updatedAt: new Date().toISOString(),
      };
      await putDesign(id, record);
      return res.status(200).json({ id });
    } catch (err) {
      console.error("PUT /api/designs/[id] failed:", err);
      return res.status(500).json({ error: "internal_error" });
    }
  }

  if (req.method === "DELETE") {
    const user = await requireUser(req, res);
    if (!user) return;
    try {
      const result = await deleteOwnedDesign(id, user.id);
      if (!result.ok && result.error === "not_found") {
        return res.status(404).json({ error: "not_found" });
      }
      if (!result.ok) return res.status(403).json({ error: "forbidden" });
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("DELETE /api/designs/[id] failed:", err);
      return res.status(500).json({ error: "internal_error" });
    }
  }

  res.setHeader("Allow", "GET, PUT, DELETE, OPTIONS");
  return res.status(405).json({ error: "method_not_allowed" });
}
