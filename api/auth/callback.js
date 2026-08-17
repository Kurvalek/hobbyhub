import { consumeAuthCode } from "../_lib/authCode.js";
import { appOrigin } from "../_lib/mail.js";
import { createSession } from "../_lib/session.js";
import { getOrCreateUser, isValidEmail, normalizeEmail } from "../_lib/users.js";

// Fallback from the email link. Primary UX is typing the 6-digit code on the
// Save overlay; this still works if they open the message on another tab.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const origin = appOrigin(req);
  const email = normalizeEmail(req.query?.email);
  const code = req.query?.code;

  if (!isValidEmail(email) || !code) {
    res.statusCode = 302;
    res.setHeader("Location", `${origin}/?auth=invalid`);
    return res.end();
  }

  try {
    const consumed = await consumeAuthCode(email, code);
    if (!consumed.ok) {
      res.statusCode = 302;
      res.setHeader("Location", `${origin}/?auth=invalid`);
      return res.end();
    }

    const user = await getOrCreateUser(email);
    await createSession(res, user.id);
    res.statusCode = 302;
    res.setHeader("Location", `${origin}/?saved=1`);
    return res.end();
  } catch (err) {
    console.error("GET /api/auth/callback failed:", err);
    res.statusCode = 302;
    res.setHeader("Location", `${origin}/?auth=invalid`);
    return res.end();
  }
}
