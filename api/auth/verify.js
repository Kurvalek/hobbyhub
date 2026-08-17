import { applyCors } from "../_lib/cors.js";
import { consumeAuthCode } from "../_lib/authCode.js";
import { createSession } from "../_lib/session.js";
import { getOrCreateUser, isValidEmail, normalizeEmail, publicUser } from "../_lib/users.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const email = normalizeEmail(req.body?.email);
  const code = req.body?.code;
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "invalid_email" });
  }

  try {
    const consumed = await consumeAuthCode(email, code);
    if (!consumed.ok) {
      const status = consumed.error === "rate_limited" ? 429 : 401;
      return res.status(status).json({ error: consumed.error });
    }

    const user = await getOrCreateUser(email);
    await createSession(res, user.id);
    return res.status(200).json({ user: publicUser(user) });
  } catch (err) {
    console.error("POST /api/auth/verify failed:", err);
    return res.status(500).json({ error: "internal_error" });
  }
}
