function fromAddress() {
  return process.env.MAGIC_LINK_FROM || process.env.AUTH_FROM_EMAIL || "metime <onboarding@resend.dev>";
}

function emailBody(code, verifyUrl) {
  const text = [
    `Your metime code is ${code}.`,
    "",
    "It expires in 10 minutes. Enter it in the studio to save your design.",
    "",
    `Or open this link: ${verifyUrl}`,
  ].join("\n");

  const html = `
    <p style="font-family:Georgia,serif;font-size:22px;margin:0 0 12px">Your metime code</p>
    <p style="font-family:ui-monospace,monospace;font-size:32px;letter-spacing:0.2em;margin:0 0 16px"><strong>${code}</strong></p>
    <p style="font-family:system-ui,sans-serif;font-size:14px;color:#3c3833">It expires in 10 minutes. Type it in the studio to save your design.</p>
    <p style="font-family:system-ui,sans-serif;font-size:13px"><a href="${verifyUrl}">Or verify with this link</a></p>
  `;
  return { text, html };
}

// Sends the 6-digit save code. With no RESEND_API_KEY we log the code (and
// fallback link) so `vercel dev` still works.
export async function sendAuthCodeEmail({ to, code, verifyUrl }) {
  const key = process.env.RESEND_API_KEY;
  const { text, html } = emailBody(code, verifyUrl);

  if (!key) {
    console.log(`[auth] Resend unset — code for ${to}: ${code}`);
    console.log(`[auth] fallback link: ${verifyUrl}`);
    return { ok: true, logged: true };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress(),
      to: [to],
      subject: `${code} is your metime code`,
      text,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("Resend send failed:", res.status, body);
    return { ok: false };
  }
  return { ok: true };
}

export function appOrigin(req) {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, "");
  const proto = req.headers?.["x-forwarded-proto"] || "http";
  const host = req.headers?.["x-forwarded-host"] || req.headers?.host || "localhost:3000";
  return `${proto}://${host}`;
}
