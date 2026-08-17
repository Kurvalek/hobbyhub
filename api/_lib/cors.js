const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

// Vercel functions don't set CORS headers or answer preflight automatically.
// Call this first in every handler; if it returns true, the request was an
// OPTIONS preflight and has already been fully responded to.
export function applyCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}
