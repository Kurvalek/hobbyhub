import { esc, deserializeGrid, assignSymbols, readableText } from "./helpers.js";

const AIDA_COUNT = 14;
const STITCHES_PER_SKEIN = Number(process.env.STITCHES_PER_SKEIN) || 1500;

// Punch needle is worked on monk's cloth at a far coarser gauge than Aida, and
// a loop eats much more yarn than a cross stitch does thread. Both mirror the
// constants in api/_lib/bom.js so the chart's skein counts match the kit's.
const PUNCH_GAUGE = 5;
const LOOPS_PER_SKEIN = Number(process.env.LOOPS_PER_SKEIN) || 350;

// Usable area (px @96dpi) for the chart grid on page 1, after reserving room
// for the header. An SVG is a non-breakable element, so if it's taller than
// this it gets pushed to page 2 (leaving page 1 blank) — hence the reserve.
const PAGE = {
  portrait: { w: 720, h: 760 },
  landscape: { w: 960, h: 520 },
};

// Cross-stitch and punch needle store the identical `{ w, h, grid, colors }`
// shape; only the units, the thread, and the gauge differ. Everything below is
// driven by one of these two configs.
const CHART_CONFIGS = {
  "cross-stitch": {
    kicker: "Cross-stitch chart",
    fallbackName: "Cross-stitch pattern",
    unit: "stitches",
    gauge: AIDA_COUNT,
    gaugeLabel: `@ ${AIDA_COUNT}ct`,
    unitsPerSkein: STITCHES_PER_SKEIN,
    legendTitle: "Floss legend — DMC",
    codeHeader: "DMC",
    countHeader: "Stitches",
    // Aida squares are small, so a dense chart is normal and expected.
    maxCell: 28,
  },
  "punch-needle": {
    kicker: "Punch needle chart",
    fallbackName: "Punch needle pattern",
    unit: "loops",
    gauge: PUNCH_GAUGE,
    gaugeLabel: `@ ${PUNCH_GAUGE}/in`,
    unitsPerSkein: LOOPS_PER_SKEIN,
    legendTitle: "Wool legend — tapestry",
    codeHeader: "Wool",
    countHeader: "Loops",
    // Punch designs are coarse (a 12×12 is a whole wall hanging), so cells are
    // allowed to grow larger before the sheet looks empty.
    maxCell: 44,
  },
};

// Builds a printable grid chart: a symbol/color grid plus a thread legend.
// Returns { title, pageCss, body } so the caller can render it standalone or
// concatenate it into an order packet.
function gridChartParts(record, cfg) {
  const d = record.data || {};
  const W = d.w || 0;
  const H = d.h || 0;
  const colors = d.colors || [];
  const name = d.name || record.id || cfg.fallbackName;
  const cells = deserializeGrid(d.grid, W * H);
  const symbols = assignSymbols(colors);

  // Orient the page to the design, then size cells to fit within the margins.
  const landscape = W > H;
  const area = landscape ? PAGE.landscape : PAGE.portrait;
  const cell = Math.max(
    5,
    Math.min(cfg.maxCell, Math.floor(Math.min(area.w / (W || 1), area.h / (H || 1))))
  );
  const gw = W * cell;
  const gh = H * cell;
  const font = Math.max(4, Math.round(cell * 0.62));

  // Cells first (filled = thread color + symbol), then gridlines on top.
  let rects = "";
  let glyphs = "";
  for (let i = 0; i < cells.length; i++) {
    const hex = cells[i];
    if (!hex) continue;
    const col = i % W;
    const row = Math.floor(i / W);
    const x = col * cell;
    const y = row * cell;
    rects += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${esc(hex)}"/>`;
    const sym = symbols.get(hex);
    if (sym && cell >= 8) {
      glyphs += `<text x="${x + cell / 2}" y="${y + cell / 2}" font-size="${font}" fill="${readableText(hex)}" text-anchor="middle" dominant-baseline="central">${esc(sym)}</text>`;
    }
  }

  let lines = "";
  for (let c = 0; c <= W; c++) {
    const major = c % 10 === 0;
    lines += `<line x1="${c * cell}" y1="0" x2="${c * cell}" y2="${gh}" stroke="${major ? "#555" : "#d8d3ca"}" stroke-width="${major ? 1.1 : 0.5}"/>`;
  }
  for (let r = 0; r <= H; r++) {
    const major = r % 10 === 0;
    lines += `<line x1="0" y1="${r * cell}" x2="${gw}" y2="${r * cell}" stroke="${major ? "#555" : "#d8d3ca"}" stroke-width="${major ? 1.1 : 0.5}"/>`;
  }

  const svg = `<svg width="${gw}" height="${gh}" viewBox="0 0 ${gw} ${gh}" style="max-width:100%; max-height:${area.h}px; height:auto;" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica Neue, Arial, sans-serif">
    <rect x="0" y="0" width="${gw}" height="${gh}" fill="#ffffff"/>
    ${rects}${lines}${glyphs}
    <rect x="0" y="0" width="${gw}" height="${gh}" fill="none" stroke="#1A1613" stroke-width="1.5"/>
  </svg>`;

  const legendRows = colors
    .map((c) => {
      const skeins = Math.max(1, Math.ceil((c.count || 0) / cfg.unitsPerSkein));
      return `<tr>
        <td class="sym">${esc(symbols.get(c.hex) || "")}</td>
        <td><span class="swatch" style="background:${esc(c.hex)}"></span></td>
        <td class="mono">${esc(c.code || "?")}</td>
        <td>${esc(c.name || "Custom")}</td>
        <td class="mono">${c.count || 0}</td>
        <td class="mono">${skeins}</td>
      </tr>`;
    })
    .join("");

  const finW = W ? (W / cfg.gauge).toFixed(1) : "—";
  const finH = H ? (H / cfg.gauge).toFixed(1) : "—";
  const total = d.stitches || colors.reduce((s, c) => s + (c.count || 0), 0);

  const body = `
    <div class="doc-head">
      <div>
        <p class="doc-kicker">${esc(cfg.kicker)}</p>
        <h1 class="doc-title">${esc(name)}</h1>
      </div>
      <div class="doc-meta">
        <div><b>${W} × ${H}</b> ${esc(cfg.unit)}</div>
        <div>${finW}" × ${finH}" ${esc(cfg.gaugeLabel)}</div>
        <div><b>${total}</b> ${esc(cfg.unit)} · ${colors.length} colors</div>
        <div class="brand">metime</div>
      </div>
    </div>
    <div style="text-align:center; margin: 4px 0 8px;">${svg}</div>
    <h2 class="sec">${esc(cfg.legendTitle)}</h2>
    <table class="legend">
      <thead><tr><th>Sym</th><th>Color</th><th>${esc(cfg.codeHeader)}</th><th>Name</th><th>${esc(cfg.countHeader)}</th><th>Skeins</th></tr></thead>
      <tbody>${legendRows}</tbody>
    </table>`;

  return {
    title: `${name} — chart`,
    pageCss: `size: letter ${landscape ? "landscape" : "portrait"}; margin: 0.5in;`,
    body,
  };
}

export function crossStitchChartParts(record) {
  return gridChartParts(record, CHART_CONFIGS["cross-stitch"]);
}

export function punchNeedleChartParts(record) {
  return gridChartParts(record, CHART_CONFIGS["punch-needle"]);
}
