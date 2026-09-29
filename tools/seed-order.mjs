#!/usr/bin/env node
// Seeds a fake Shopify `orders/create` webhook against a running dev server, so
// the fulfillment queue can be exercised without a public tunnel or a real sale.
//
// The payload is signed with SHOPIFY_WEBHOOK_SECRET using the same HMAC the real
// webhook verifies (api/_lib/shopify.js), so this exercises the genuine code
// path — signature check included — rather than bypassing it.
//
//   node tools/seed-order.mjs                          # one kit of each craft
//   node tools/seed-order.mjs --type quilt             # just a quilt
//   node tools/seed-order.mjs --design <uuid>          # use an existing design
//   node tools/seed-order.mjs --base https://my.app    # target a deploy
//
// With no --design, sample designs are POSTed to /api/designs first (unowned,
// exactly as guest kit checkout does) and the returned uuids are attached to the
// order's line items.

import { createHmac } from "node:crypto";

try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {
  // No .env — fall back to whatever is already exported in the shell.
}

const CRAFTS = ["quilt", "cross-stitch", "punch-needle"];

// ── args ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { types: [], designs: [], base: "http://localhost:3000" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--type") out.types.push(argv[++i]);
    else if (a === "--design") out.designs.push(argv[++i]);
    else if (a === "--base") out.base = argv[++i];
    else if (a === "--secret") out.secret = argv[++i];
    else {
      console.error(`Unknown argument: ${a}`);
      out.help = true;
    }
  }
  return out;
}

const USAGE = `
Seed a signed Shopify orders/create webhook into the local fulfillment queue.

  --type <craft>    quilt | cross-stitch | punch-needle. Repeatable.
                    Default: one line item of each.
  --design <uuid>   Use an existing design instead of creating a sample.
                    Repeatable; pairs positionally with --type.
  --base <url>      Server to hit. Default http://localhost:3000
  --secret <value>  Overrides SHOPIFY_WEBHOOK_SECRET.
  -h, --help        This text.
`;

// ── sample designs ──────────────────────────────────────────────────────────
const KONA = {
  snow: { name: "Snow", code: "1339", hex: "#F2F0E4" },
  cardinal: { name: "Cardinal", code: "1063", hex: "#B3282B" },
  teal: { name: "Teal Blue", code: "1373", hex: "#2E7C91" },
};

// A 4x4 sampler: half-square-triangle pinwheel in the middle, alternating
// squares around it. Exercises both branches of the cut list (squares + HSTs).
function sampleQuilt() {
  const cols = 4;
  const rows = 4;
  const bs = 6;
  const shapes = [];
  let id = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const center = r >= 1 && r <= 2 && c >= 1 && c <= 2;
      if (center) {
        const pairId = `pin-${r}-${c}`;
        const dir = (r + c) % 2 === 0 ? "/" : "\\";
        shapes.push({ id: id++, r, c, w: 1, h: 1, type: "tri", dir, half: "a", pairId, color: KONA.cardinal });
        shapes.push({ id: id++, r, c, w: 1, h: 1, type: "tri", dir, half: "b", pairId, color: KONA.snow });
      } else {
        shapes.push({ id: id++, r, c, w: 1, h: 1, type: "square", color: (r + c) % 2 === 0 ? KONA.teal : KONA.snow });
      }
    }
  }

  const items = [
    { ...KONA.snow, count: 10, yards: 0.5, cutSize: '6 1/2"', strips: 2 },
    { ...KONA.teal, count: 6, yards: 0.25, cutSize: '6 1/2"', strips: 1 },
    { ...KONA.cardinal, count: 4, yards: 0.25, cutSize: '6 7/8"', strips: 1 },
  ];
  const fw = cols * bs;
  const fh = rows * bs;
  const backCalc = { yards: 1, backingW: fw + 8, backingH: fh + 8, widths: 1 };
  const bindCalc = { yards: 0.25, strips: 3, perimeter: (fw + fh) * 2 };
  const grandTotal =
    items.reduce((s, i) => s + i.yards, 0) + backCalc.yards + bindCalc.yards;

  return {
    name: "Pinwheel Sampler",
    cols,
    rows,
    bs,
    preset: "Baby",
    shapes,
    backing: KONA.snow,
    binding: KONA.cardinal,
    pinned: [],
    materials: { items, total: items.length, possible: items.length, yards: items.reduce((s, i) => s + i.yards, 0) },
    fw,
    fh,
    backCalc,
    bindCalc,
    grandTotal,
    updatedAt: new Date().toISOString(),
  };
}

// Turns ASCII art into the studio's run-length grid format. `.` is an empty
// cell; every other character maps through `legend` to a color.
function gridFromArt(art, legend) {
  const h = art.length;
  const w = art[0].length;
  const palette = [...new Set(Object.values(legend).map((c) => c.hex))];
  const counts = new Map();

  const values = [];
  for (const line of art) {
    if (line.length !== w) {
      throw new Error(`Pattern rows must all be ${w} wide; got ${line.length}: "${line}"`);
    }
    for (const ch of line) {
      if (ch === ".") {
        values.push(0);
        continue;
      }
      const color = legend[ch];
      if (!color) throw new Error(`No legend entry for "${ch}"`);
      values.push(palette.indexOf(color.hex) + 1);
      counts.set(color.hex, (counts.get(color.hex) || 0) + 1);
    }
  }

  // Run-length encode as "count.value|count.value|…" — the exact format
  // deserializeGrid in api/_lib/render/helpers.js expects.
  const runs = [];
  let run = 1;
  for (let i = 1; i <= values.length; i++) {
    if (i < values.length && values[i] === values[i - 1]) run++;
    else {
      runs.push(`${run}.${values[i - 1]}`);
      run = 1;
    }
  }

  const colors = Object.values(legend)
    .map((c) => ({ ...c, count: counts.get(c.hex) || 0 }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);

  return {
    w,
    h,
    grid: { colors: palette, rle: runs.join("|") },
    colors,
    stitches: colors.reduce((s, c) => s + c.count, 0),
  };
}

const HEART_ART = [
  "..XXX...XXX..",
  ".XXoXX.XXXXX.",
  "XXoooXXXXXXXX",
  "XXXXXXXXXXXXX",
  ".XXXXXXXXXXX.",
  "..XXXXXXXXX..",
  "...XXXXXXX...",
  "....XXXXX....",
  ".....XXX.....",
  "......X......",
];

function sampleCrossStitch() {
  const g = gridFromArt(HEART_ART, {
    X: { code: "321", name: "Red", hex: "#C72C48" },
    o: { code: "819", name: "Baby Pink Light", hex: "#F5D5DC" },
  });
  return {
    name: "Little Heart",
    craft: "cross-stitch",
    presetName: "Small Hoop",
    ...g,
    palette: g.colors,
    colorsUsed: g.colors.length,
    fabric: { name: "Antique White", hex: "#F3EFE4" },
    updatedAt: new Date().toISOString(),
  };
}

const SUNBURST_ART = [
  "....oooo....",
  "..oooooooo..",
  ".oooXXXXooo.",
  "ooooXXXXoooo",
  "oooXXXXXXooo",
  "ooXXXXXXXXoo",
  "ooXXXXXXXXoo",
  "oooXXXXXXooo",
  "ooooXXXXoooo",
  ".oooXXXXooo.",
  "..oooooooo..",
  "....oooo....",
];

function samplePunchNeedle() {
  const g = gridFromArt(SUNBURST_ART, {
    X: { code: "7947", name: "Marigold", hex: "#E8873A" },
    o: { code: "7317", name: "Deep Teal", hex: "#2B6B77" },
  });
  return {
    name: "Sunburst",
    craft: "punch-needle",
    presetName: "Large Hoop",
    ...g,
    palette: g.colors,
    colorsUsed: g.colors.length,
    fabric: { name: "Natural Monk's Cloth", hex: "#E6DCC6" },
    updatedAt: new Date().toISOString(),
  };
}

const SAMPLES = {
  quilt: { build: sampleQuilt, title: "Custom Quilt Kit", variant: "Baby · 24\" × 24\"", sku: "KIT-QUILT-BABY" },
  "cross-stitch": { build: sampleCrossStitch, title: "Custom Cross-Stitch Kit", variant: "Small Hoop", sku: "KIT-XS-SM" },
  "punch-needle": { build: samplePunchNeedle, title: "Custom Punch Needle Kit", variant: "Large Hoop", sku: "KIT-PN-WALL" },
};

// ── http ────────────────────────────────────────────────────────────────────
async function createDesign(base, type) {
  const res = await fetch(`${base}/api/designs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, data: SAMPLES[type].build() }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST /api/designs → ${res.status}: ${text}`);
  }
  return JSON.parse(text).id;
}

function buildOrderPayload(lineItems) {
  // Shopify ids are numeric; anything unique works for a local seed.
  const orderId = Date.now();
  const orderNumber = 1000 + (orderId % 1000);
  return {
    id: orderId,
    name: `#${orderNumber}`,
    order_number: orderNumber,
    created_at: new Date().toISOString(),
    email: "wren.callaway@example.com",
    customer: { first_name: "Wren", last_name: "Callaway", email: "wren.callaway@example.com" },
    shipping_address: {
      name: "Wren Callaway",
      address1: "418 Marigold Lane",
      address2: "Apt 2B",
      city: "Asheville",
      province: "North Carolina",
      zip: "28801",
      country: "United States",
    },
    line_items: lineItems.map((li, i) => ({
      id: orderId * 10 + i,
      title: li.title,
      variant_title: li.variant,
      quantity: li.quantity,
      sku: li.sku,
      properties: [{ name: "_design_id", value: li.designId }],
    })),
    note_attributes: [],
  };
}

async function postWebhook(base, secret, payload) {
  // Sign the exact bytes we send — the webhook verifies against the raw body.
  const raw = Buffer.from(JSON.stringify(payload), "utf8");
  const hmac = createHmac("sha256", secret).update(raw).digest("base64");
  const res = await fetch(`${base}/api/webhooks/order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Hmac-Sha256": hmac,
      "X-Shopify-Topic": "orders/create",
      "X-Shopify-Shop-Domain": "shop.makemetime.com",
    },
    body: raw,
  });
  return { status: res.status, body: await res.text() };
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const secret = args.secret || process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("SHOPIFY_WEBHOOK_SECRET is not set (check .env) and --secret was not passed.");
    process.exit(1);
  }

  const types = args.types.length ? args.types : CRAFTS;
  for (const t of types) {
    if (!SAMPLES[t]) {
      console.error(`Unknown craft "${t}". Expected one of: ${CRAFTS.join(", ")}`);
      process.exit(1);
    }
  }

  const base = args.base.replace(/\/+$/, "");
  console.log(`Seeding against ${base}\n`);

  const lineItems = [];
  for (let i = 0; i < types.length; i++) {
    const type = types[i];
    let designId = args.designs[i];
    if (designId) {
      console.log(`  ${type}: using existing design ${designId}`);
    } else {
      designId = await createDesign(base, type);
      console.log(`  ${type}: created sample design ${designId}`);
    }
    lineItems.push({ ...SAMPLES[type], designId, quantity: 1 });
  }

  const payload = buildOrderPayload(lineItems);
  const { status, body } = await postWebhook(base, secret, payload);

  console.log("");
  if (status === 200) {
    console.log(`Order ${payload.name} accepted. Open ${base}/admin.html to fulfill it.`);
  } else if (status === 401) {
    console.error(
      `Webhook rejected the signature (401). The SHOPIFY_WEBHOOK_SECRET this script\n` +
      `used does not match the one the server loaded. Restart \`vercel dev\` after\n` +
      `editing .env — it only reads env vars at startup.`
    );
    process.exitCode = 1;
  } else {
    console.error(`Webhook returned ${status}: ${body}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\nSeed failed: ${err.message}`);
  if (err.cause?.code === "ECONNREFUSED") {
    console.error("Nothing is listening there. Start the dev server with `npm start`.");
  }
  process.exit(1);
});
