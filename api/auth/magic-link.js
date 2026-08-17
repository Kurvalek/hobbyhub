import { applyCors } from "../_lib/cors.js";
import { issueAuthCode } from "../_lib/authCode.js";
import { sendAuthCodeEmail, appOrigin } from "../_lib/mail.js";
import { clientIp } from "../_lib/session.js";
import { isValidEmail, normalizeEmail } from "../_lib/users.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const email = normalizeEmail(req.body?.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "invalid_email" });
  }

  try {
    const issued = await issueAuthCode(email, clientIp(req));
    if (!issued.ok) {
      return res.status(429).json({ error: issued.error });
    }

    const origin = appOrigin(req);
    const verifyUrl = `${origin}/api/auth/callback?email=${encodeURIComponent(email)}&code=${issued.code}`;
    const sent = await sendAuthCodeEmail({ to: email, code: issued.code, verifyUrl });
    if (!sent.ok) {
      return res.status(500).json({ error: "email_failed" });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("POST /api/auth/magic-link failed:", err);
    return res.status(500).json({ error: "internal_error" });
  }
}
