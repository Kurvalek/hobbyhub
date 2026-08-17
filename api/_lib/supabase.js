import { createClient } from "@supabase/supabase-js";

// Two clients, two very different trust levels.
//
//   adminSupabase()      — secret key. Bypasses RLS. Used only where a request
//                          legitimately needs to cross user boundaries: the
//                          Shopify webhook resolving a purchased design, the
//                          admin dashboard, the by-id capability read, and
//                          unowned guest-checkout writes. NEVER sent to a
//                          browser.
//   userSupabase(req)    — publishable key plus the caller's own access token,
//                          so every query runs as that user and RLS decides
//                          what they can see. This is what the designs library
//                          uses.
//
// Both are created lazily: importing this module must never require env vars to
// be present (build time, or an endpoint that doesn't touch the database).

const AUTH_OPTS = {
  // Serverless: no cookie jar, no background refresh. The browser owns the
  // session; we only ever verify a token that was handed to us.
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};

// Publishable (sb_publishable_…) and secret (sb_secret_…) keys are Supabase's
// current key format; the legacy anon / service_role JWTs they replace still
// work but are slated for removal at the end of 2026. Each key is read under
// its current name first, falling back to the legacy name so a deploy that was
// already configured the old way keeps running.
const URL_VARS = ["SUPABASE_URL"];
const PUBLISHABLE_VARS = ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"];
const SECRET_VARS = ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"];

function readEnv(names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  return "";
}

function requireEnv(names) {
  const value = readEnv(names);
  if (!value) {
    const [primary, ...legacy] = names;
    const also = legacy.length ? ` (or legacy ${legacy.join(" / ")})` : "";
    throw new Error(`${primary}${also} is not set — see SUPABASE_SETUP.md`);
  }
  return value;
}

// True only when the server has everything it needs to talk to Supabase.
// Endpoints check this first and answer 503 instead of throwing a stack trace,
// so a half-configured deploy fails legibly.
export function supabaseConfigured() {
  return Boolean(readEnv(URL_VARS) && readEnv(PUBLISHABLE_VARS) && readEnv(SECRET_VARS));
}

let admin = null;
export function adminSupabase() {
  if (!admin) {
    admin = createClient(requireEnv(URL_VARS), requireEnv(SECRET_VARS), AUTH_OPTS);
  }
  return admin;
}

// Pulls the bearer token the browser's supabase-js session attached. Returns ""
// when the caller is a guest.
export function accessToken(req) {
  const header = req.headers?.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

// A client that acts *as the caller*. Not cached — the token is per-request.
export function userSupabase(req) {
  const token = accessToken(req);
  return createClient(requireEnv(URL_VARS), requireEnv(PUBLISHABLE_VARS), {
    ...AUTH_OPTS,
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  });
}
