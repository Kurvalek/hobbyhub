import { applyCors } from "../_lib/cors.js";
import { getSessionUser } from "../_lib/session.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: "unauthorized" });
    return res.status(200).json({ user });
  } catch (err) {
    console.error("GET /api/auth/me failed:", err);
    return res.status(500).json({ error: "internal_error" });
  }
}
