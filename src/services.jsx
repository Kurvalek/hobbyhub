import { createContext, useContext, useEffect, useState } from 'react';
import { fmtY, refreshQuiltColors } from './catalog.jsx';
import { CRAFT_STUDIO } from './stitch-studio.jsx';

export const AuthContext = createContext(null);
export function useAuth() {
  return useContext(AuthContext);
}

// ── Supabase client (keys live in index.html) ──────────────────────────────
// True once the placeholders in index.html are replaced. Kept separate from the CDN
// check below because the two failures deserve very different treatment: never
// filling these in is a choice, whereas filling them in and getting local-only
// saves anyway is a bug the person can't see.
export function supabaseKeysPresent() {
  return (
    !!SUPABASE_URL && !SUPABASE_URL.includes("YOUR-PROJECT-REF") &&
    !!SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.startsWith("YOUR_")
  );
}

// True once the UMD bundle in <head> has run. It's a synchronous <script>, so
// this is settled before any of the app code below executes — but a blocked or
// failed request leaves the global missing forever, hence the recheck in
// AuthProvider rather than a single snapshot at startup.
function supabaseClientLoaded() {
  return (
    typeof window !== "undefined" && !!window.supabase &&
    typeof window.supabase.createClient === "function"
  );
}

// True only once the placeholders are replaced AND the CDN client loaded.
// Same defensive pattern as shopifyConfigured(): with Supabase unconfigured the
// studio keeps working exactly as it did before accounts existed — designs save
// to this device's localStorage and nothing ever asks for an email.
export function supabaseConfigured() {
  return supabaseKeysPresent() && supabaseClientLoaded();
}

// How long to keep looking for the CDN global before calling it a loss. Only
// reached when the keys are real, so the wait costs nothing for a studio that
// was never wired up to Supabase.
export const SUPABASE_LOAD_GRACE_MS = 5000;

// Said once, loudly, and only when the keys are real: a studio with a working
// config that quietly saves local-only is indistinguishable from a Save button
// that does nothing, which is the worst way for this to fail.
let _warnedNoClient = false;
export function warnSupabaseUnreachable() {
  if (_warnedNoClient) return;
  _warnedNoClient = true;
  console.error(
    "[metime] Supabase is configured but supabase-js never loaded, so accounts " +
    "are off and designs save to this device only. The CDN <script> in <head> " +
    "was blocked or failed — check a script/ad blocker, the network, or unpkg."
  );
}

// What the library drawer shows after a save that had to stay on this device
// because the client never loaded (AccountsOfflineNote says it up front).
export const ACCOUNTS_OFFLINE_SAVE_MSG =
  "Accounts couldn't load. Saved to this device only. Reload to try again.";

// Lazily created singleton. supabase-js owns the session: it persists the
// access/refresh tokens in localStorage and refreshes them in the background,
// which is what makes "reopen on any device with the same email" work without
// us managing a cookie.
let _sb = null;
export function sb() {
  if (!supabaseConfigured()) return null;
  if (!_sb) {
    _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  return _sb;
}

// ── Shopify kits (store domain and token live in index.html) ───────────────
// The kit entries below hold product HANDLES (the URL slug in the Shopify admin
// and in products_export.csv), not numeric ids — handles survive a re-import,
// which product ids do not. Each size is its own single-variant, flat-price
// product, so we resolve that product's one variant (and its price) on demand
// via the Storefront API — see resolveKit below.
//
// Maps each craft's finished-size preset to the Shopify product that sells it.
// The keys must match the preset `name` strings exactly (PRESETS for quilts,
// STITCH_PRESETS and PUNCH_PRESETS for the grid crafts) — that name is what a
// saved design carries, and it's the only link between a design and its kit.
//
// Two deliberate gaps: punch needle's "Small Hoop" has no product yet, and the
// cross-stitch-wall-art-large product has no matching preset. An unmapped
// preset falls back to save-only rather than erroring.
const SHOPIFY_KITS = {
  "quilt": {
    "Coaster":      "quilted-coaster-set",
    "Wall hanging": "quilted-wall-hanging",
    "Baby blanket": "baby-quilt",
    "Throw":        "throw-quilt",
  },
  "cross-stitch": {
    "Coaster Set":  "cross-stitch-coaster-set",
    "Bookmark":     "cross-stitch-bookmark",
    "Small Hoop":   "cross-stitch-wall-art-small",
    "Medium Hoop":  "cross-stitch-wall-art-medium",
  },
  "punch-needle": {
    "Coaster":    "punch-needle-coaster-set",
    "Large Hoop": "punch-needle-wall-art",
    "Pillow":     "punch-needle-pillow",
  },
};

// "Large Hoop" was called "Wall Hanging" until the size was renamed. Designs
// saved before that still carry the old name — in Supabase, in localStorage and
// in any cart already in flight — so it is translated on read rather than
// rewritten. The stored record stays exactly as the customer left it and their
// kit stays buyable. Keyed by craft because quilt has its own "Wall hanging"
// that is a different size of a different product and must not be touched.
const LEGACY_PRESET_NAMES = {
  "punch-needle": { "Wall Hanging": "Large Hoop" },
};
export function canonicalPresetName(type, name) {
  return (LEGACY_PRESET_NAMES[type] || {})[name] || name;
}
// Line-item property carried into the Shopify order; the fulfillment backend
// keys off this exact name to trace a kit back to its design.
const DESIGN_ID_ATTRIBUTE = "_design_id";

// What the kit review page says about a box, beyond the supplies the design
// itself determines. /api/bom already derives the fabric, thread and needle from
// the design — this covers only what it can't know.
//
// `included` is the printed matter every kit of that craft ships with, worded
// from the product descriptions in shopify-products.csv. `extras` is keyed by
// finished-size preset (same keys as SHOPIFY_KITS) for finishing that varies by
// kit rather than by design — api/_lib/bom.js leaves these out of the BOM on
// purpose, because the packer takes them from the order's SKU. `yourOwn` is the
// tools a maker needs to have already.
export const KIT_INFO = {
  "quilt": {
    included: [
      "Printed cutting and assembly guide matched to your design",
    ],
    yourOwn: [
      "Sewing machine and matching thread",
      "Rotary cutter, ruler and mat (or sharp scissors)",
      "Iron and pressing surface",
      "Pins or clips",
    ],
  },
  "cross-stitch": {
    included: [
      "Printed chart with a full-color symbol legend",
      "Printed step-by-step instructions",
    ],
    extras: {
      "Small Hoop":  ["Wooden hoop to finish and hang it in"],
      "Medium Hoop": ["Wooden hoop to finish and hang it in"],
    },
    yourOwn: [
      "Embroidery hoop or frame, if your kit doesn't include one",
      "Small sharp scissors",
      "An iron, to press the finished piece",
    ],
  },
  "punch-needle": {
    included: [
      "Printed chart with a full-color legend",
      "Printed step-by-step instructions",
    ],
    extras: {
      "Large Hoop": ["Wooden hoop to finish and hang it in"],
      "Pillow":     ["Backing fabric and a pillow insert"],
      "Coaster":    ["Felt backing for all four coasters"],
    },
    yourOwn: [
      "Gripper frame or stretcher bars to hold the cloth taut",
      "Small sharp scissors",
      "Fabric glue, for finishing the backs",
    ],
  },
};

// The "in your kit" extras for a design's size, plus the printed matter that
// comes with every kit of that craft.
export function kitIncludes(type, design) {
  const info = KIT_INFO[type];
  if (!info) return [];
  const extras = (info.extras && info.extras[kitPresetName(type, design)]) || [];
  return [...extras, ...(info.included || [])];
}

// Quilts store the chosen preset as `preset`; the grid crafts store it as
// `presetName`. Callers shouldn't have to know which, so both go through here.
export function kitPresetName(type, design) {
  if (!design) return null;
  return canonicalPresetName(type, type === "quilt" ? design.preset : design.presetName);
}

// The Shopify product handle for a design's size, or null when that size isn't
// sold yet (punch needle "Small Hoop", or a design saved as "Custom").
export function kitHandle(type, design) {
  const forType = SHOPIFY_KITS[type];
  if (!forType) return null;
  return forType[kitPresetName(type, design)] || null;
}

// True once the store credentials are real. Kept separate from the per-design
// check so the price lookups (which have no design in hand) can reuse it.
function shopifyStoreConfigured() {
  return (
    !!SHOPIFY_STORE_DOMAIN && !SHOPIFY_STORE_DOMAIN.startsWith("your-store") &&
    !!SHOPIFY_STOREFRONT_TOKEN && !SHOPIFY_STOREFRONT_TOKEN.startsWith("YOUR_")
  );
}

// Whether this specific design can be bought: the store has to be wired up and
// its size has to map to a product. When false the checkout button falls back
// to the save-only behavior so the app keeps working regardless.
export function shopifyConfigured(type, design) {
  return shopifyStoreConfigured() && !!kitHandle(type, design);
}

// Session cache of product handle → { variantId, amount, currencyCode,
// availableForSale }, so the size cards and the checkout button share one
// lookup and repeat checkouts in the same page load cost nothing.
const shopifyKitCache = new Map();

// Shared endpoint + headers for every Storefront call.
function storefrontEndpoint() {
  return `https://${SHOPIFY_STORE_DOMAIN}/api/${SHOPIFY_STOREFRONT_API_VERSION}/graphql.json`;
}

async function storefrontQuery(query, variables) {
  const res = await fetch(storefrontEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": SHOPIFY_STOREFRONT_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify request failed (HTTP ${res.status})`);
  const body = await res.json();
  if (body.errors && body.errors.length) {
    throw new Error(body.errors[0].message || "Shopify GraphQL error");
  }
  return body.data || {};
}

// The one variant and price of a single-variant kit product. `productByHandle`
// is deprecated, so this uses `product(handle:)`.
const KIT_FIELDS = `
  fragment KitFields on Product {
    variants(first: 1) {
      nodes { id availableForSale price { amount currencyCode } }
    }
  }`;

// Flattens a product node into the shape we cache. Returns null for a product
// that doesn't exist, isn't published to this token's sales channel, or somehow
// has no variant — all of which we treat the same: not purchasable.
function kitFromProductNode(product) {
  const variant = product && product.variants && product.variants.nodes && product.variants.nodes[0];
  if (!variant || !variant.id) return null;
  return {
    variantId: variant.id,
    amount: variant.price ? Number(variant.price.amount) : null,
    currencyCode: variant.price ? variant.price.currencyCode : null,
    availableForSale: variant.availableForSale !== false,
  };
}

// Resolves several handles in ONE request using field aliases, so a size
// selector showing four kits makes a single network call. Handles already in
// the cache are skipped. Resolves to a Map of handle → kit (or null).
async function resolveKits(handles) {
  const wanted = Array.from(new Set((handles || []).filter(Boolean)));
  const missing = wanted.filter((h) => !shopifyKitCache.has(h));
  if (missing.length) {
    // Aliases must be valid GraphQL names, so index rather than use the handle
    // (handles contain hyphens). We map back by position.
    const aliases = missing.map((_, i) => `k${i}`);
    const args = missing.map((_, i) => `$h${i}: String!`).join(", ");
    const selections = missing
      .map((_, i) => `k${i}: product(handle: $h${i}) { ...KitFields }`)
      .join("\n      ");
    const variables = {};
    missing.forEach((handle, i) => { variables[`h${i}`] = handle; });
    const data = await storefrontQuery(
      `query kits(${args}) {\n      ${selections}\n    }\n    ${KIT_FIELDS}`,
      variables
    );
    missing.forEach((handle, i) => {
      shopifyKitCache.set(handle, kitFromProductNode(data[aliases[i]]));
    });
  }
  const out = new Map();
  wanted.forEach((h) => out.set(h, shopifyKitCache.get(h) || null));
  return out;
}

// Single-handle convenience used at checkout. Throws with a clear reason so the
// button can surface why a kit couldn't be added, rather than failing silently.
export async function resolveKit(handle) {
  if (!handle) throw new Error("This size isn't available as a kit yet");
  const kit = (await resolveKits([handle])).get(handle);
  if (!kit) {
    throw new Error(
      `Shopify product "${handle}" not found — check the handle, and that it's published to this token's sales channel`
    );
  }
  return kit;
}

// Formats a Storefront money amount for display. Whole-dollar kit prices show
// without cents ("$38"), anything else keeps them ("$38.50").
export function formatKitPrice(kit) {
  if (!kit || kit.amount == null || !Number.isFinite(kit.amount)) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: kit.currencyCode || "USD",
      minimumFractionDigits: Number.isInteger(kit.amount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(kit.amount);
  } catch {
    return `$${Number.isInteger(kit.amount) ? kit.amount : kit.amount.toFixed(2)}`;
  }
}

// Live prices for every sellable size of one craft, keyed by preset name, for
// the size-picker cards. One batched request per craft per page load.
//
// Pricing is advisory here — Shopify is still the authority at checkout — so
// every failure mode (store not configured, offline, product unpublished, size
// not sold) resolves to "no price for that preset" and the cards just render
// without one. Nothing here can block a buyer from designing.
export function useKitPrices(type) {
  const [prices, setPrices] = useState({});
  useEffect(() => {
    if (!type || !shopifyStoreConfigured()) return;
    const handles = SHOPIFY_KITS[type];
    if (!handles) return;
    let alive = true;
    resolveKits(Object.values(handles))
      .then((kits) => {
        if (!alive) return;
        const next = {};
        Object.keys(handles).forEach((presetName) => {
          const kit = kits.get(handles[presetName]);
          if (kit) next[presetName] = kit;
        });
        setPrices(next);
      })
      .catch((e) => console.warn("Kit price lookup failed:", e));
    return () => { alive = false; };
  }, [type]);
  return prices;
}

// The price of the one kit a saved design maps to, for the checkout button.
// Resolves to null when that size isn't sold.
export function useKitPrice(type, design) {
  const handle = kitHandle(type, design);
  const [kit, setKit] = useState(() => (handle ? shopifyKitCache.get(handle) || null : null));
  useEffect(() => {
    if (!handle || !shopifyStoreConfigured()) { setKit(null); return; }
    let alive = true;
    resolveKits([handle])
      .then((kits) => { if (alive) setKit(kits.get(handle) || null); })
      .catch((e) => console.warn("Kit price lookup failed:", e));
    return () => { alive = false; };
  }, [handle]);
  return kit;
}

// Creates a Shopify cart with a single kit line item that carries the studio
// design id as a line-item attribute, and resolves to the hosted checkout URL.
// Throws on userErrors or network/HTTP failure so callers can surface a clear
// inline error instead of silently dropping the design link.
export async function addKitToShopifyCart({ variantId, designId }) {
  const query = `
    mutation cartCreate($input: CartInput!) {
      cartCreate(input: $input) {
        cart { checkoutUrl }
        userErrors { field message }
      }
    }`;
  const variables = {
    input: {
      lines: [{
        merchandiseId: variantId,
        quantity: 1,
        attributes: [{ key: DESIGN_ID_ATTRIBUTE, value: designId }],
      }],
    },
  };
  const data = await storefrontQuery(query, variables);
  const result = data.cartCreate;
  if (result && result.userErrors && result.userErrors.length) {
    throw new Error(result.userErrors[0].message || "Shopify cart error");
  }
  const checkoutUrl = result && result.cart && result.cart.checkoutUrl;
  if (!checkoutUrl) throw new Error("Shopify cart create failed (no checkout URL)");
  return checkoutUrl;
}

// ── Saved-design cache (localStorage) ──────────────────────────────────────
// Signed-in libraries live in Supabase. These keys are a same-device cache so a
// refresh still works offline, and the guest draft buffer when Supabase isn't
// configured. Guests who never Save never create an account. Anything a guest
// left here gets claimed into their account on first sign-in (claimLocalDesigns).
const QUILTS_KEY = "metime.savedQuilts.v1";
export function loadSavedQuilts() {
  try {
    const raw = localStorage.getItem(QUILTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(refreshQuiltColors) : [];
  } catch (e) {
    console.warn("Could not read saved quilts:", e);
    return [];
  }
}
export function persistSavedQuilts(quilts) {
  try {
    localStorage.setItem(QUILTS_KEY, JSON.stringify(quilts));
    return true;
  } catch (e) {
    // Most likely QuotaExceededError (localStorage is ~5MB per origin).
    console.warn("Could not save quilts:", e);
    return false;
  }
}
// Cross-stitch designs use the same on-device persistence pattern as quilts.
const STITCHES_KEY = "metime.savedStitches.v1";
export function loadSavedStitches() {
  try {
    const raw = localStorage.getItem(STITCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("Could not read saved designs:", e);
    return [];
  }
}
export function persistSavedStitches(designs) {
  try {
    localStorage.setItem(STITCHES_KEY, JSON.stringify(designs));
    return true;
  } catch (e) {
    console.warn("Could not save designs:", e);
    return false;
  }
}
// Punch needle keeps its own drawer rather than sharing the cross-stitch one:
// the two crafts have different color libraries and gauges, so a design saved
// from one would reopen in the other with the wrong yarn list and finished size.
const PUNCH_KEY = "metime.savedPunch.v1";
export function loadSavedPunch() {
  try {
    const raw = localStorage.getItem(PUNCH_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("Could not read saved punch needle designs:", e);
    return [];
  }
}
export function persistSavedPunch(designs) {
  try {
    localStorage.setItem(PUNCH_KEY, JSON.stringify(designs));
    return true;
  } catch (e) {
    console.warn("Could not save punch needle designs:", e);
    return false;
  }
}
// ── Design-store API (server-side, powers checkout) ────────────────────────
// POSTs a finished design to /api/designs (same-origin serverless function)
// and resolves to the design's uuid. That id is the handle a Shopify order will
// carry (as a cart attribute) so a purchased kit can be traced back to the exact
// design, long after this device's localStorage is gone.
//
// No account needed: a guest's design lands unowned, which is what lets kit
// checkout work without signing in. If they happen to be signed in the access
// token attaches and the row is theirs.
export async function saveDesignToApi(type, data) {
  const res = await fetch("/api/designs", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ type, data }),
  });
  if (!res.ok) throw new Error(`design save failed (HTTP ${res.status})`);
  const body = await res.json();
  if (!body || typeof body.id !== "string") throw new Error("design save failed (bad response)");
  return body.id;
}

const PENDING_SAVE_KEY = "metime.pendingSave";

// Every /api call that needs an identity carries the Supabase access token.
// supabase-js hands us a fresh one (refreshing first if it's about to expire),
// and the server verifies it — there is no cookie and no custom session.
async function authHeader() {
  const client = sb();
  if (!client) return {};
  try {
    const { data } = await client.auth.getSession();
    const token = data && data.session && data.session.access_token;
    return token ? { Authorization: "Bearer " + token } : {};
  } catch (e) {
    return {};
  }
}

async function apiJson(url, opts) {
  const options = { ...(opts || {}) };
  options.headers = { ...(await authHeader()), ...(options.headers || {}) };
  const res = await fetch(url, options);
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { ok: res.ok, status: res.status, body };
}

// Flattens a Supabase user into the little shape the UI needs (the account chip
// shows the email; stripeCustomerId is reserved for when Stripe is built).
export function toStudioUser(user) {
  if (!user) return null;
  return { id: user.id, email: user.email || null };
}

export async function fetchMe() {
  const client = sb();
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error || !data || !data.session) return null;
  return toStudioUser(data.session.user);
}

// Step 1 of sign-in: Supabase emails a 6-digit code. `shouldCreateUser` is what
// makes this one flow serve both new and returning people — no separate signup.
// Requires the Magic Link email template to include {{ .Token }}, otherwise
// Supabase only sends a link and there's no code to type (see SUPABASE_SETUP.md).
export async function requestAuthCode(email) {
  const client = sb();
  if (!client) return { ok: false, error: "not_configured" };
  try {
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (!error) return { ok: true };
    logAuthError("send", error);
    return { ok: false, error: authErrorCode(error) };
  } catch (e) {
    logAuthError("send", e);
    return { ok: false, error: "network" };
  }
}

// Step 2: exchange the typed code for a session. On success supabase-js stores
// the session, so the next page load on this device is already signed in.
export async function verifyAuthCode(email, code) {
  const client = sb();
  if (!client) return { ok: false, error: "not_configured" };
  try {
    const { data, error } = await client.auth.verifyOtp({ email, token: code, type: "email" });
    if (error) {
      logAuthError("verify", error);
      return { ok: false, error: authErrorCode(error) };
    }
    const user = data && data.user ? toStudioUser(data.user) : null;
    if (!user) return { ok: false, error: "invalid_code" };
    return { ok: true, user };
  } catch (e) {
    return { ok: false, error: "network" };
  }
}

// Supabase's auth errors arrive as prose + a loose code. Normalizing them here
// keeps the overlay's copy readable and lets us tell "you typed it wrong" apart
// from "it expired" and "you're being throttled" — three very different fixes.
function authErrorCode(error) {
  const code = (error && (error.code || error.name) || "").toString();
  const message = (error && error.message ? error.message : "").toLowerCase();
  const status = error && error.status;
  if (status === 429 || code === "over_email_send_rate_limit" || message.includes("rate limit") || message.includes("only request this after")) {
    return "rate_limited";
  }
  if (code === "otp_expired" || message.includes("expired")) return "expired";
  // Supabase couldn't hand the mail off. Distinct from every other failure
  // because nothing about the studio or the typed address is wrong — it's the
  // project's email setup. The built-in service only delivers to project
  // members and caps at a few an hour, so this is what a real inbox hits first.
  if (
    code === "unexpected_failure" || code === "email_provider_disabled" ||
    message.includes("error sending") || message.includes("smtp") ||
    (status === 500 && !message)
  ) {
    return "email_send_failed";
  }
  if (message.includes("invalid") || status === 401 || status === 403) return "invalid_code";
  if (message.includes("failed to fetch") || message.includes("network")) return "network";
  if (message.includes("signups not allowed") || code === "signup_disabled") return "signups_disabled";
  return "unknown";
}

// The overlay's copy is deliberately short, which makes a genuine
// misconfiguration hard to diagnose from the UI alone. Mirror the raw error to
// the console so the underlying Supabase reason is always recoverable.
function logAuthError(step, error) {
  if (!error) return;
  console.error(
    `[metime] Supabase auth ${step} failed:`,
    { code: error.code || error.name || null, status: error.status ?? null, message: error.message || null },
  );
}

export async function logoutUser() {
  const client = sb();
  if (!client) return;
  try { await client.auth.signOut(); } catch (e) { /* local session is cleared regardless */ }
}

export async function listCloudDesigns() {
  if (!supabaseConfigured()) return [];
  const { ok, body } = await apiJson("/api/designs");
  if (!ok || !body || !Array.isArray(body.designs)) return [];
  return body.designs;
}

export async function upsertCloudDesign(type, design) {
  const data = apiSafeDesign(design);
  if (design.apiId) {
    const { ok, status } = await apiJson("/api/designs/" + encodeURIComponent(design.apiId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, data }),
    });
    // A design saved on this device but missing (or no longer ours) server-side
    // shouldn't dead-end the save — fall through and create a fresh row.
    if (status === 404 || status === 403) return await createCloudDesign(type, data);
    if (!ok) throw new Error("design update failed (HTTP " + status + ")");
    return design.apiId;
  }
  return await createCloudDesign(type, data);
}

async function createCloudDesign(type, data) {
  const { ok, status, body } = await apiJson("/api/designs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, data }),
  });
  if (!ok || !body || typeof body.id !== "string") throw new Error("design save failed (HTTP " + status + ")");
  return body.id;
}

export async function deleteCloudDesign(apiId) {
  if (!apiId || !supabaseConfigured()) return;
  await apiJson("/api/designs/" + encodeURIComponent(apiId), { method: "DELETE" });
}

function cloudToLocal(record) {
  const data = record && record.data && typeof record.data === "object" ? record.data : {};
  return { ...data, apiId: record.id, id: data.id != null ? data.id : record.id };
}

// Which localStorage drawer each craft type lives in. Punch needle keeps its own
// (different yarn library and gauge), which is why this isn't a 2-way split.
const LOCAL_DRAWERS = [
  { type: "quilt", load: loadSavedQuilts, persist: persistSavedQuilts },
  { type: "cross-stitch", load: loadSavedStitches, persist: persistSavedStitches },
  { type: "punch-needle", load: loadSavedPunch, persist: persistSavedPunch },
];

// Rewrites the on-device cache from the account's cloud library. `keep` is the
// local-only leftovers that must survive — a guest draft, or an upload that
// failed while offline — since the cloud list is authoritative only for the
// designs it actually knows about.
export function hydrateLocalLibrary(records, keep) {
  const buckets = { "quilt": [], "cross-stitch": [], "punch-needle": [] };
  const push = (type, design) => (buckets[type] || buckets["cross-stitch"]).push(design);
  for (const rec of records) push(rec.type, cloudToLocal(rec));
  for (const entry of (keep || [])) push(entry.type, entry.design);
  for (const drawer of LOCAL_DRAWERS) drawer.persist(buckets[drawer.type]);
  return { quilts: buckets["quilt"], stitches: buckets["cross-stitch"], punch: buckets["punch-needle"] };
}

// Uploads whatever this browser already had saved locally into the account the
// person just signed into, so a guest who designed for an hour before making an
// account loses nothing. Runs once per account per device — the flag is keyed by
// user id, so signing back in later doesn't re-upload and duplicate.
//
// Must run BEFORE hydrateLocalLibrary, which overwrites the local cache.
const CLAIMED_KEY_PREFIX = "metime.claimed.";
export async function claimLocalDesigns(userId, skipId) {
  const empty = { claimed: 0, keep: [] };
  if (!userId || !supabaseConfigured()) return empty;
  const flag = CLAIMED_KEY_PREFIX + userId;
  try {
    if (localStorage.getItem(flag)) return empty;
  } catch (e) {
    return empty;
  }

  let claimed = 0;
  const keep = [];
  let allOk = true;
  for (const drawer of LOCAL_DRAWERS) {
    for (const design of drawer.load()) {
      // The design the Save button is waiting on is uploaded by
      // flushPendingSave; claiming it here too would make two rows.
      if (skipId != null && String(design.id) === String(skipId)) continue;
      try {
        // A design that already has an apiId from guest kit checkout is an
        // *unowned* row; the PUT comes back 403 and upsertCloudDesign creates an
        // owned copy instead. The original row stays put so any order that
        // already references it still resolves.
        const apiId = await upsertCloudDesign(drawer.type, design);
        claimed++;
        if (!apiId) keep.push({ type: drawer.type, design });
      } catch (e) {
        console.warn("Could not claim a local design:", e);
        keep.push({ type: drawer.type, design });
        allOk = false;
      }
    }
  }

  // Only mark the device done when everything made it. A partial failure keeps
  // the flag unset so the next sign-in retries; designs that did upload now
  // carry an owned apiId, so the retry updates them instead of duplicating.
  if (allOk) {
    try { localStorage.setItem(flag, new Date().toISOString()); } catch (e) { /* ignore */ }
  }
  return { claimed, keep };
}

export function stashPendingSave(payload) {
  try { sessionStorage.setItem(PENDING_SAVE_KEY, JSON.stringify(payload)); } catch (e) { /* ignore */ }
}
export function readPendingSave() {
  try {
    const raw = sessionStorage.getItem(PENDING_SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function clearPendingSave() {
  try { sessionStorage.removeItem(PENDING_SAVE_KEY); } catch (e) { /* ignore */ }
}

// Finishes the save the person clicked before they had an account. Hydration is
// the caller's job so it can run after claimLocalDesigns too, in one pass.
export async function flushPendingSave() {
  const pending = readPendingSave();
  if (!pending || !pending.record || !pending.type) return null;
  const apiId = await upsertCloudDesign(pending.type, pending.record);
  const saved = { ...pending.record, apiId };
  clearPendingSave();
  return { type: pending.type, record: saved, mode: pending.mode || "new" };
}

// Serializes a design for the API: drops local-only fields (`apiId`,
// `bgImage`) and any embedded photo data — a photo backing stores its image
// as a ~500 KB data URL in `backing.image`, which the server never renders
// and which blows past the API's payload cap (photo fabrics keep small asset
// URLs, which pass through untouched). `id` stays so a signed-in library
// can update the same row after a refresh. Returns a fresh object; the saved
// design is never mutated.
export function apiSafeDesign(design) {
  const { apiId: _apiId, bgImage: _bgImage, ...data } = design;
  const stripPhoto = (o) => {
    if (!o || typeof o !== "object") return o;
    if (typeof o.image === "string" && o.image.startsWith("data:")) {
      const { image: _image, ...rest } = o;
      return rest;
    }
    return o;
  };
  if (data.backing) data.backing = stripPhoto(data.backing);
  if (data.binding) data.binding = stripPhoto(data.binding);
  if (Array.isArray(data.pinned)) data.pinned = data.pinned.map(stripPhoto);
  return data;
}

// Renders a design to a PDF on the server (POST /api/render) and triggers a
// download in the browser. `doc` is "chart" (quilt: template + per-piece cut
// list) or "instructions" (assembly steps). No upload/storage round-trip —
// the design travels in the request body.
export async function downloadDesignPdf(type, design, doc) {
  const data = apiSafeDesign(design);
  const res = await fetch("/api/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, data, doc }),
  });
  if (!res.ok) throw new Error(`render failed (HTTP ${res.status})`);
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const m = cd.match(/filename="([^"]+)"/);
  const filename = (m && m[1]) || `${(design.name || type).toString().replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${doc}.pdf`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Reads a stored design back by id (GET /api/designs/:id). No auth: the uuid is
// the capability, which is what lets a guest return to their own kit. Used when
// the browser rebuilt the document on the review step — the design is far too big
// to have travelled in the history entry, so only its id did.
export async function fetchDesignRecord(id) {
  const res = await fetch(`/api/designs/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`design fetch failed (HTTP ${res.status})`);
  const body = await res.json();
  if (!body || !body.data || !body.type) throw new Error("design fetch failed (bad response)");
  return { type: body.type, record: { ...body.data, name: body.data.name || body.name } };
}

// The supplies a design turns into (POST /api/bom). Like /api/render, the design
// travels in the request body, so this works for a canvas that was never saved.
//
// The arithmetic is deliberately not done here: skein counts and cut margins come
// from the server's env constants, and the same function produces the packer's
// pick-list. A second copy in this page could quietly tell a maker something
// different from what ends up in the box.
async function fetchDesignBom(type, design) {
  const res = await fetch("/api/bom", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, data: apiSafeDesign(design) }),
  });
  if (!res.ok) throw new Error(`bom failed (HTTP ${res.status})`);
  const json = await res.json();
  if (!json || !json.bom) throw new Error("bom response had no bom");
  return json.bom;
}

// Loads the BOM for one design, or null while it's in flight or if it failed.
// A failure is never surfaced as an error: the review page has a local fallback
// that lists the same colours without the skein counts, and a supply list that
// can't be fetched is no reason to stop someone buying.
export function useDesignBom(type, design) {
  const [bom, setBom] = useState(null);
  const key = design ? JSON.stringify(apiSafeDesign(design)) : null;
  useEffect(() => {
    if (!type || !key) { setBom(null); return; }
    let alive = true;
    fetchDesignBom(type, JSON.parse(key))
      .then((b) => { if (alive) setBom(b); })
      .catch((e) => console.warn("BOM lookup failed:", e));
    return () => { alive = false; };
  }, [type, key]);
  return bom;
}

function kitSkeinLabel(n) {
  return `${n} skein${n === 1 ? "" : "s"}`;
}

export function kitInchBox(o) {
  return `${o.w}" × ${o.h}"`;
}

// The server's BOM as rows for the review list: an optional colour swatch, a
// label, and how much of it comes in the box. Labels match the ones on the
// printed sheet (api/_lib/render/instructions.js) so the page, the paperwork and
// the packer's list all name the same thing the same way.
export function kitSupplyRows(type, bom) {
  if (!bom) return null;
  const rows = [];
  const named = (code, name) => (code ? `DMC ${code} · ${name}` : name);
  if (type === "quilt") {
    (bom.fabrics || []).forEach((f) => rows.push({
      hex: f.hex, label: f.code ? `Kona ${f.code} · ${f.name}` : f.name, qty: f.yardsLabel,
    }));
    if (bom.batting) rows.push({ label: "Batting", qty: kitInchBox(bom.batting) });
    if (bom.backing) rows.push({ label: "Backing fabric", qty: bom.backing.yardsLabel });
    if (bom.binding) rows.push({ label: "Binding fabric", qty: bom.binding.yardsLabel });
    return rows;
  }
  if (type === "cross-stitch") {
    if (bom.aida) rows.push({
      label: `Aida cloth, ${bom.aida.count}-count${bom.aida.color ? ` (${bom.aida.color})` : ""}`,
      qty: kitInchBox(bom.aida),
    });
    if (bom.needle) rows.push({ label: `${bom.needle} needle`, qty: "1" });
    (bom.floss || []).forEach((f) => rows.push({ hex: f.hex, label: named(f.code, f.name), qty: kitSkeinLabel(f.skeins) }));
    return rows;
  }
  if (bom.monksCloth) rows.push({
    label: `Monk's cloth${bom.monksCloth.color ? ` (${bom.monksCloth.color})` : ""}`,
    qty: kitInchBox(bom.monksCloth),
  });
  // Already reads as a full product name, so it doesn't take " needle" the way
  // the tapestry needle does.
  if (bom.needle) rows.push({ label: bom.needle, qty: "1" });
  (bom.yarn || []).forEach((y) => rows.push({ hex: y.hex, label: named(y.code, y.name), qty: kitSkeinLabel(y.skeins) }));
  return rows;
}

// The same list built from what the design already carries, for the moment before
// /api/bom answers and for the case where it never does. Quantities that are the
// server's to work out (skeins, cut sizes) are left off rather than guessed.
export function kitSupplyRowsLocal(type, record) {
  if (!record) return [];
  if (type === "quilt") {
    const rows = ((record.materials && record.materials.items) || []).map((m) => ({
      hex: m.hex, label: m.code ? `Kona ${m.code} · ${m.name}` : m.name, qty: fmtY(m.yards || 0),
    }));
    if (record.backing && record.backCalc) rows.push({ label: "Backing fabric", qty: fmtY(record.backCalc.yards) });
    if (record.binding && record.bindCalc) rows.push({ label: "Binding fabric", qty: fmtY(record.bindCalc.yards) });
    return rows;
  }
  const cfg = CRAFT_STUDIO[type];
  const unit = cfg ? cfg.unitPlural : "stitches";
  return (record.colors || []).map((c) => ({
    hex: c.hex, label: c.code ? `DMC ${c.code} · ${c.name}` : c.name, qty: `${c.count} ${unit}`,
  }));
}
