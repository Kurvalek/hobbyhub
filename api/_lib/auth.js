import { accessToken, adminSupabase, supabaseConfigured } from "./supabase.js";

// Replaces the old cookie session. Supabase-js owns the session in the browser
// (storage + refresh); every API call carries `Authorization: Bearer
// <access_token>`. Here we just hand that token back to Supabase to validate —
// which checks the signature and expiry for us, so we never parse a JWT
// ourselves or keep a signing secret.

// Returns { id, email } for a valid token, or null for a guest / bad / expired
// token. Never throws on an unauthenticated caller.
export async function getRequestUser(req) {
  if (!supabaseConfigured()) return null;
  const token = accessToken(req);
  if (!token) return null;

  const { data, error } = await adminSupabase().auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email || null };
}

// Sends 401 and returns null when there's no valid token. Endpoints that
// require an account start with this.
export async function requireUser(req, res) {
  if (!supabaseConfigured()) {
    res.status(503).json({ error: "supabase_not_configured" });
    return null;
  }
  const user = await getRequestUser(req);
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  return user;
}
