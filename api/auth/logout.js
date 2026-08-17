import { applyCors } from "../_lib/cors.js";
import { destroySession } from "../_lib/session.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    await destroySession(req, res);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("POST /api/auth/logout failed:", err);
    return res.status(500).json({ error: "internal_error" });
  }
}
