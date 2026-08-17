import { createClient } from "@supabase/supabase-js";

// Two clients, two very different trust levels.
//
//   adminSupabase()      — service role key. Bypasses RLS. Used only where a
//                          request legitimately needs to cross user boundaries:
//                          the Shopify webhook resolving a purchased design,
//                          the admin dashboard, the by-id capability read, and
//                          unowned guest-checkout writes. NEVER sent to a
//                          browser.
//   userSupabase(req)    — anon key plus the caller's own access token, so
//                          every query runs as that user and RLS decides what
//                          they can see. This is what the designs library uses.
//
// Both are created lazily: importing this module must never require env vars to
// be present (build time, or an endpoint that doesn't touch the database).

const AUTH_OPTS = {
  // Serverless: no cookie jar, no background refresh. The browser owns the
  // session; we only ever verify a token that was handed to us.
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — see SUPABASE_SETUP.md`);
  }
  return value;
}

// True only when the server has everything it needs to talk to Supabase.
// Endpoints check this first and answer 503 instead of throwing a stack trace,
// so a half-configured deploy fails legibly.
export function supabaseConfigured() {
  return Boolean(
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

let admin = null;
export function adminSupabase() {
  if (!admin) {
    admin = createClient(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      AUTH_OPTS,
    );
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
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
    ...AUTH_OPTS,
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  });
}
