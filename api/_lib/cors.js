const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

// Vercel functions don't set CORS headers or answer preflight automatically.
// Call this first in every handler; if it returns true, the request was an
// OPTIONS preflight and has already been fully responded to.
export function applyCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  // Authorization carries the Supabase access token the browser's supabase-js
  // session holds; without it here a cross-origin call would be blocked before
  // the handler ever sees the caller's identity.
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}
