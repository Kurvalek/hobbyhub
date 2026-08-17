// Scratch: import every serverless entry point with dummy env, to catch broken
// imports or missing named exports that `node --check` can't see, and smoke the
// two Supabase clients. Delete once the migration is signed off.
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = "anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
process.env.ADMIN_TOKEN = "t";

const files = [
  "api/designs/index.js", "api/designs/[id].js", "api/render.js",
  "api/webhooks/order.js", "api/admin/render.js",
  "api/admin/orders/index.js", "api/admin/orders/[id].js",
  "api/_lib/supabase.js", "api/_lib/auth.js", "api/_lib/store.js",
  "api/_lib/orders.js", "api/_lib/cors.js", "api/_lib/id.js",
  "api/_lib/validate.js", "api/_lib/adminAuth.js", "api/_lib/bom.js",
  "api/_lib/shopify.js", "api/_lib/render/index.js",
];

let bad = 0;
for (const f of files) {
  const url = new URL("../" + f, import.meta.url);
  try {
    const m = await import(url);
    const isLib = f.startsWith("api/_lib");
    const hasDefault = typeof m.default === "function";
    if (!isLib && !hasDefault) { console.log("FAIL  " + f + " — no default handler export"); bad++; }
    else console.log("ok    " + f + (isLib ? "  (lib)" : "  (handler)"));
  } catch (e) {
    console.log("FAIL  " + f + " — " + e.message);
    bad++;
  }
}

const { adminSupabase, userSupabase, supabaseConfigured, accessToken } =
  await import(new URL("../api/_lib/supabase.js", import.meta.url));
console.log("configured with all three vars:", supabaseConfigured());
console.log("adminSupabase() builds:", typeof adminSupabase().from === "function");
console.log("userSupabase(req) builds:", typeof userSupabase({ headers: {} }).from === "function");
console.log("accessToken parses bearer:",
  accessToken({ headers: { authorization: "Bearer abc123" } }) === "abc123");
console.log("accessToken empty for guest:", accessToken({ headers: {} }) === "");

delete process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log("configured after dropping service key:", supabaseConfigured());

const { ORDER_STATUSES } = await import(new URL("../api/_lib/orders.js", import.meta.url));
console.log("order statuses:", ORDER_STATUSES.join(", "));

const { DESIGN_ID_PATTERN } = await import(new URL("../api/_lib/id.js", import.meta.url));
const uuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
console.log("uuid accepted:", DESIGN_ID_PATTERN.test(uuid));
console.log("legacy base64url id rejected:", !DESIGN_ID_PATTERN.test("Ab3_x9QzKmNpQrStUvWx"));
console.log("sql injection-ish id rejected:", !DESIGN_ID_PATTERN.test("' or 1=1 --"));

process.exit(bad ? 1 : 0);
