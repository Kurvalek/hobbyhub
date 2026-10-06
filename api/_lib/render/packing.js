import { esc } from "./helpers.js";
import { fmtYards } from "../bom.js";

// The two order-level documents: the pick sheet you work from at the shelf, and
// the packing slip that goes in the box.
//
// Both read the BOM frozen onto `order_items.bom` at webhook time rather than
// recomputing it from the design. That is deliberate: if the customer edits
// their saved design after ordering, we still pull and ship exactly what was
// promised at purchase.

// Kit contents that the design itself can't determine — they follow from the
// size the customer bought, not from what they drew. Mirrors KIT_INFO in
// index.html so the slip promises the same things the kit review page did.
const KIT_INFO = {
  quilt: {
    included: ["Printed cutting and assembly guide matched to your design"],
    extras: {},
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
      "Small Hoop": ["Wooden hoop to finish and hang it in"],
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
      // The same size was sold as "Wall Hanging" until it was renamed. Orders
      // are historical records, so the old title stays matchable — a slip
      // reprinted for last month's order still lists its hoop.
      "Wall Hanging": ["Wooden hoop to finish and hang it in"],
      Pillow: ["Backing fabric and a pillow insert"],
      Coaster: ["Felt backing for all four coasters"],
    },
    yourOwn: [
      "Gripper frame or stretcher bars to hold the cloth taut",
      "Small sharp scissors",
      "Fabric glue, for finishing the backs",
    ],
  },
};

// Shopify's variant title carries the size the customer picked ("Large Hoop",
// "Medium Hoop"), which is what selects the finishing extras. It often has the
// dimensions appended, so match on containment rather than equality.
//
// Exported because the dashboard needs the same list: these are physical things
// that go in the box (a hoop, a pillow insert, felt backing) and so have to
// appear on the pull checklist, not just on the printed slip.
export function extrasFor(type, variantTitle) {
  const info = KIT_INFO[type];
  if (!info) return [];
  const table = info.extras || {};
  const title = String(variantTitle || "");
  for (const preset of Object.keys(table)) {
    if (title.toLowerCase().includes(preset.toLowerCase())) return table[preset];
  }
  return [];
}

function skeinLabel(n) {
  return `${n} skein${n === 1 ? "" : "s"}`;
}

// A cut piece is per kit, so two kits means two pieces of the same size rather
// than one bigger piece.
function piecesLabel(quantity, dims) {
  return quantity > 1 ? `${quantity} × ${dims}` : dims;
}

// Flattens a BOM into printable supply lines, scaled to the number of kits on
// the line item. The BOM itself is always per-kit, so anything countable has to
// be multiplied here — a 2× line needs twice the floss.
//
// Mirrors supplyRows() in admin.html, which is a dependency-free standalone
// page with no module loader and so cannot import this one.
export function bomSupplyRows(bom, quantity = 1) {
  const rows = [];
  if (!bom) return rows;
  const q = Math.max(1, quantity || 1);

  if (bom.type === "cross-stitch") {
    if (bom.aida)
      rows.push({
        label: `Aida ${bom.aida.count}ct${bom.aida.color ? ` · ${bom.aida.color}` : ""}`,
        qty: piecesLabel(q, `${bom.aida.w}" × ${bom.aida.h}"`),
      });
    if (bom.needle) rows.push({ label: `${bom.needle} needle`, qty: String(q) });
    for (const f of bom.floss || [])
      rows.push({
        hex: f.hex,
        label: f.name,
        code: `DMC ${f.code}`,
        qty: skeinLabel(f.skeins * q),
      });
  } else if (bom.type === "punch-needle") {
    if (bom.monksCloth)
      rows.push({
        label: `Monk's cloth${bom.monksCloth.color ? ` · ${bom.monksCloth.color}` : ""}`,
        qty: piecesLabel(q, `${bom.monksCloth.w}" × ${bom.monksCloth.h}"`),
      });
    if (bom.needle) rows.push({ label: bom.needle, qty: String(q) });
    for (const y of bom.yarn || [])
      rows.push({
        hex: y.hex,
        label: y.name,
        code: `Wool ${y.code}`,
        qty: skeinLabel(y.skeins * q),
      });
  } else if (bom.type === "quilt") {
    for (const fab of bom.fabrics || [])
      rows.push({
        hex: fab.hex,
        label: fab.name,
        code: fab.code ? `Kona ${fab.code}` : null,
        qty: fmtYards((fab.yards || 0) * q),
      });
    if (bom.backing)
      rows.push({ label: "Backing fabric", qty: fmtYards((bom.backing.yards || 0) * q) });
    if (bom.binding)
      rows.push({ label: "Binding fabric", qty: fmtYards((bom.binding.yards || 0) * q) });
    if (bom.batting)
      rows.push({
        label: "Batting",
        qty: piecesLabel(q, `${bom.batting.w}" × ${bom.batting.h}"`),
      });
  }
  return rows;
}

// A short human description of the finished piece, for the item subheading.
function sizeSummary(bom) {
  if (!bom) return null;
  const f = bom.finishedInches;
  if (bom.type === "cross-stitch")
    return [
      bom.finishedStitches ? `${bom.finishedStitches.w} × ${bom.finishedStitches.h} stitches` : null,
      f ? `${f.w}" × ${f.h}" finished` : null,
    ].filter(Boolean).join(" · ");
  if (bom.type === "punch-needle")
    return [
      bom.finishedLoops ? `${bom.finishedLoops.w} × ${bom.finishedLoops.h} loops` : null,
      f ? `${f.w}" × ${f.h}" finished` : null,
    ].filter(Boolean).join(" · ");
  if (bom.type === "quilt") return f ? `${f.w}" × ${f.h}" finished` : null;
  return null;
}

const CRAFT_LABEL = {
  quilt: "Quilt",
  "cross-stitch": "Cross-stitch",
  "punch-needle": "Punch needle",
};

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function addressHtml(order) {
  const s = order.shipping || {};
  const cityLine = [s.city, s.province, s.zip].filter(Boolean).join(", ");
  return [
    `<div><b>${esc(s.name || order.customer?.name || "")}</b></div>`,
    s.address1 ? `<div>${esc(s.address1)}</div>` : "",
    s.address2 ? `<div>${esc(s.address2)}</div>` : "",
    cityLine ? `<div>${esc(cityLine)}</div>` : "",
    s.country ? `<div>${esc(s.country)}</div>` : "",
  ].join("");
}

// ── Pick sheet (internal) ───────────────────────────────────────────────────

const PICK_STYLES = `
  .pk-ship { font-size: 11.5px; line-height: 1.45; }
  .pk-item { border: 1px solid #E4DED5; border-radius: 8px; padding: 11px 13px; margin-bottom: 11px; break-inside: avoid; }
  .pk-item-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 2px; }
  .pk-item-title { font-size: 13.5px; font-weight: 700; }
  .pk-item-sub { font-size: 10.5px; color: #8A8177; margin-bottom: 9px; }
  .pk-row { display: flex; align-items: center; gap: 8px; padding: 3.5px 0; font-size: 12px; border-bottom: 1px solid #F2EEE7; }
  .pk-row:last-child { border-bottom: 0; }
  .pk-box { width: 12px; height: 12px; border: 1.2px solid #1A1613; border-radius: 2px; flex: 0 0 auto; }
  .pk-qty { margin-left: auto; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11.5px; white-space: nowrap; }
  .pk-warn { color: #E8583A; font-size: 11.5px; font-weight: 600; }
  .pk-docs { font-size: 11px; color: #6b6459; margin-top: 8px; padding-top: 7px; border-top: 1px dashed #E4DED5; }
`;

function pickItemHtml(item) {
  const rows = bomSupplyRows(item.bom, item.quantity);
  const sub = [
    CRAFT_LABEL[item.type] || item.type || "Unknown craft",
    sizeSummary(item.bom),
    item.designId ? `design ${item.designId}` : null,
  ].filter(Boolean).join("  ·  ");

  if (!item.designFound) {
    return `<div class="pk-item">
      <div class="pk-item-head">
        <span class="pk-item-title">${item.quantity}× ${esc(item.title || "Item")}</span>
        <span class="mono muted">${esc(item.sku || "")}</span>
      </div>
      <div class="pk-item-sub">${esc(sub)}</div>
      <div class="pk-warn">${item.designId
        ? `No design found for id ${esc(item.designId)} — handle this line manually.`
        : "No design id on this line item — handle this line manually."}</div>
    </div>`;
  }

  const rowsHtml = rows.length
    ? rows.map((r) => `<div class="pk-row">
        <span class="pk-box"></span>
        ${r.hex ? `<span class="swatch" style="background:${esc(r.hex)}"></span>` : ""}
        <span>${esc(r.label)}</span>
        ${r.code ? `<span class="mono muted">${esc(r.code)}</span>` : ""}
        <span class="pk-qty">${esc(r.qty)}</span>
      </div>`).join("")
    : `<div class="pk-warn">No supplies computed for this line.</div>`;

  const chartLabel = item.type === "quilt" ? "template" : "chart";
  return `<div class="pk-item">
    <div class="pk-item-head">
      <span class="pk-item-title">${item.quantity}× ${esc(item.title || "Item")}${item.variantTitle ? ` — ${esc(item.variantTitle)}` : ""}</span>
      <span class="mono muted">${esc(item.sku || "")}</span>
    </div>
    <div class="pk-item-sub">${esc(sub)}</div>
    ${rowsHtml}
    <div class="pk-docs">Enclose with this kit: the ${chartLabel} sheet and the instruction sheet.</div>
  </div>`;
}

// The sheet the packer works from: everything to pull, with tick boxes, plus
// the address so the right supplies end up in the right box.
export function pickSheetParts(order) {
  const items = order.items || [];
  const totalUnits = items.reduce((s, i) => s + (i.quantity || 1), 0);
  const name = order.orderName || `#${order.orderId}`;

  const body = `
    <style>${PICK_STYLES}</style>
    <div class="doc-head">
      <div>
        <p class="doc-kicker">Pick sheet — internal${order.isTest ? " · test order, do not pull" : ""}</p>
        <h1 class="doc-title">${esc(name)}</h1>
      </div>
      <div class="doc-meta">
        <div><b>${totalUnits}</b> kit${totalUnits === 1 ? "" : "s"} · ${items.length} line${items.length === 1 ? "" : "s"}</div>
        <div>Ordered ${esc(fmtDate(order.createdAt))}</div>
        <div>${esc(order.customer?.name || "")}</div>
      </div>
    </div>
    <h2 class="sec">Pull these supplies</h2>
    ${items.map(pickItemHtml).join("")}
    <h2 class="sec">Ship to</h2>
    <div class="pk-ship">${addressHtml(order)}${order.customer?.email
      ? `<div class="mono muted">${esc(order.customer.email)}</div>` : ""}</div>`;

  return {
    title: `${name} — pick sheet`,
    pageCss: `size: letter portrait; margin: 0.5in;`,
    body,
  };
}

// ── Packing slip (customer) ─────────────────────────────────────────────────

const SLIP_STYLES = `
  .ps-grid { display: flex; gap: 40px; margin-bottom: 4px; }
  .ps-grid > div { font-size: 12px; line-height: 1.5; }
  .ps-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #8A8177; margin-bottom: 4px; }
  .ps-item { margin-bottom: 18px; break-inside: avoid; }
  .ps-item-title { font-size: 14px; font-weight: 700; margin-bottom: 1px; }
  .ps-item-sub { font-size: 11px; color: #8A8177; margin-bottom: 8px; }
  .ps-list { margin: 0; padding-left: 16px; font-size: 12px; line-height: 1.7; }
  .ps-thread { display: flex; align-items: center; gap: 7px; font-size: 12px; padding: 2.5px 0; }
  .ps-thread .n { flex: 1; }
  .ps-foot { margin-top: 26px; padding-top: 14px; border-top: 1px solid #E4DED5; font-size: 11.5px; color: #6b6459; line-height: 1.6; }
`;

function slipItemHtml(item) {
  const bom = item.bom;
  const q = Math.max(1, item.quantity || 1);
  // A line we couldn't resolve still belongs on the slip — the customer bought
  // it — but calling it a "Kit" of unknown craft reads like a mistake.
  const sub = bom ? [CRAFT_LABEL[item.type], sizeSummary(bom)].filter(Boolean).join("  ·  ") : "";

  const threads = [];
  if (bom?.type === "cross-stitch") {
    for (const f of bom.floss || [])
      threads.push({ hex: f.hex, label: `DMC ${f.code} · ${f.name}`, qty: skeinLabel(f.skeins * q) });
  } else if (bom?.type === "punch-needle") {
    for (const y of bom.yarn || [])
      threads.push({ hex: y.hex, label: `Wool ${y.code} · ${y.name}`, qty: skeinLabel(y.skeins * q) });
  } else if (bom?.type === "quilt") {
    for (const fab of bom.fabrics || [])
      threads.push({ hex: fab.hex, label: `Kona ${fab.code ? `${fab.code} · ` : ""}${fab.name}`, qty: fmtYards((fab.yards || 0) * q) });
  }

  const ground = [];
  if (bom?.aida) ground.push(`Aida cloth, ${bom.aida.count}-count${bom.aida.color ? ` in ${bom.aida.color}` : ""} · ${piecesLabel(q, `${bom.aida.w}" × ${bom.aida.h}"`)}`);
  if (bom?.monksCloth) ground.push(`Monk's cloth${bom.monksCloth.color ? ` in ${bom.monksCloth.color}` : ""} · ${piecesLabel(q, `${bom.monksCloth.w}" × ${bom.monksCloth.h}"`)}`);
  // bom.needle is a bare description for cross-stitch ("Size 24 tapestry") but
  // already names itself for punch needle.
  if (bom?.needle) ground.push(`${bom.needle}${/needle/i.test(bom.needle) ? "" : " needle"}${q > 1 ? ` × ${q}` : ""}`);
  if (bom?.backing) ground.push(`Backing fabric · ${fmtYards((bom.backing.yards || 0) * q)}`);
  if (bom?.binding) ground.push(`Binding fabric · ${fmtYards((bom.binding.yards || 0) * q)}`);
  if (bom?.batting) ground.push(`Batting · ${piecesLabel(q, `${bom.batting.w}" × ${bom.batting.h}"`)}`);

  const extras = bom
    ? [...extrasFor(item.type, item.variantTitle), ...(KIT_INFO[item.type]?.included || [])]
    : [];

  return `<div class="ps-item">
    <div class="ps-item-title">${item.quantity}× ${esc(item.title || "Kit")}${item.variantTitle ? ` · ${esc(item.variantTitle)}` : ""}</div>
    ${sub ? `<div class="ps-item-sub">${esc(sub)}</div>` : ""}
    ${threads.length ? `<div>${threads.map((t) => `<div class="ps-thread">
        <span class="swatch" style="background:${esc(t.hex || "#fff")}"></span>
        <span class="n">${esc(t.label)}</span>
        <span class="mono">${esc(t.qty)}</span>
      </div>`).join("")}</div>` : ""}
    ${ground.length || extras.length ? `<ul class="ps-list">${[...ground, ...extras]
      .map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
  </div>`;
}

// What goes in the box. Customer-facing: no checkboxes, no internal ids, no
// costs — Shopify already sent them the receipt.
export function packingSlipParts(order) {
  const items = order.items || [];
  const name = order.orderName || `#${order.orderId}`;

  // "Bring your own" tools, deduped across every craft in the order.
  const yourOwn = [
    ...new Set(items.flatMap((i) => KIT_INFO[i.type]?.yourOwn || [])),
  ];

  const body = `
    <style>${SLIP_STYLES}</style>
    <div class="doc-head">
      <div>
        <p class="doc-kicker">Packing slip</p>
        <h1 class="doc-title">Thanks for making something.</h1>
      </div>
      <div class="doc-meta">
        <div><b>${esc(name)}</b></div>
        <div>${esc(fmtDate(order.createdAt))}</div>
        <div class="brand">metime</div>
      </div>
    </div>

    <div class="ps-grid">
      <div>
        <div class="ps-label">Ship to</div>
        ${addressHtml(order)}
      </div>
    </div>

    <h2 class="sec">What's in your kit</h2>
    ${items.map(slipItemHtml).join("")}

    ${yourOwn.length ? `<h2 class="sec">You'll need a few things of your own</h2>
    <ul class="ps-list">${yourOwn.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}

    <div class="ps-foot">
      Everything in this box was cut and counted for the design you made. The
      chart and instructions enclosed match it exactly. If anything is missing or
      short, reply to your order confirmation and we'll put it right.
    </div>`;

  return {
    title: `${name} · packing slip`,
    pageCss: `size: letter portrait; margin: 0.6in;`,
    body,
  };
}
