import { applyCors } from "../_lib/cors.js";
import { DESIGN_ID_PATTERN } from "../_lib/id.js";
import { getDesign } from "../_lib/store.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { id } = req.query;
  if (typeof id !== "string" || !DESIGN_ID_PATTERN.test(id)) {
    return res.status(400).json({ error: "invalid_id" });
  }

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
