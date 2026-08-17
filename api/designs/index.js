import { applyCors } from "../_lib/cors.js";
import { validateDesignPayload } from "../_lib/validate.js";
import { generateDesignId } from "../_lib/id.js";
import { listUserDesigns, putDesignIfAbsent } from "../_lib/store.js";
import { getSessionUser, requireUser } from "../_lib/session.js";

const SCHEMA_VERSION = 1;
const MAX_ID_COLLISION_RETRIES = 3;

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method === "GET") {
    const user = await requireUser(req, res);
    if (!user) return;
    try {
      const designs = await listUserDesigns(user.id);
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

  const { type, data } = req.body;
  const user = await getSessionUser(req);
  const now = new Date().toISOString();
  const record = {
    type,
    version: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    data,
  };
  if (user) record.ownerId = user.id;

  try {
    for (let attempt = 0; attempt < MAX_ID_COLLISION_RETRIES; attempt++) {
      const id = generateDesignId();
      const stored = await putDesignIfAbsent(id, { id, ...record });
      if (stored) {
        return res.status(201).json({ id });
      }
    }
    return res.status(500).json({ error: "internal_error" });
  } catch (err) {
    console.error("POST /api/designs failed:", err);
    return res.status(500).json({ error: "internal_error" });
  }
}
