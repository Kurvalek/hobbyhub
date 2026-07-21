import { timingSafeEqual } from "node:crypto";

// Gate for the admin endpoints. The dashboard sends `Authorization: Bearer
// <ADMIN_TOKEN>`; we compare it in constant time against the env secret.
// If ADMIN_TOKEN is unset the endpoints stay locked (fail closed) so a
// misconfigured deploy never exposes orders.
export function requireAdmin(req, res) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    res.status(503).json({ error: "admin_not_configured" });
    return false;
  }

  const header = req.headers?.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}
