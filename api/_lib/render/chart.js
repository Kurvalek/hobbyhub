import {
  esc,
  deserializeGrid,
  assignSymbols,
  readableText,
  htmlDoc,
} from "./helpers.js";

const AIDA_COUNT = 14;
const STITCHES_PER_SKEIN = Number(process.env.STITCHES_PER_SKEIN) || 1500;

// Usable area (px @96dpi) for the chart grid on page 1, after reserving room
// for the header. An SVG is a non-breakable element, so if it's taller than
// this it gets pushed to page 2 (leaving page 1 blank) — hence the reserve.
const PAGE = {
  portrait: { w: 720, h: 760 },
  landscape: { w: 960, h: 520 },
};

// Builds a printable cross-stitch chart: a symbol/color grid plus a floss
// legend. Returns a full HTML document string sized to one page.
export function crossStitchChartHtml(record) {
  const d = record.data || {};
  const W = d.w || 0;
  const H = d.h || 0;
  const colors = d.colors || [];
  const name = d.name || record.id || "Cross-stitch pattern";
  const cells = deserializeGrid(d.grid, W * H);
  const symbols = assignSymbols(colors);

  // Orient the page to the design, then size cells to fit within the margins.
  const landscape = W > H;
  const area = landscape ? PAGE.landscape : PAGE.portrait;
  const cell = Math.max(
    5,
    Math.min(28, Math.floor(Math.min(area.w / (W || 1), area.h / (H || 1))))
  );
  const gw = W * cell;
  const gh = H * cell;
  const font = Math.max(4, Math.round(cell * 0.62));

  // Cells first (filled = floss color + symbol), then gridlines on top.
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
      const skeins = Math.max(1, Math.ceil((c.count || 0) / STITCHES_PER_SKEIN));
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

  const finW = W ? (W / AIDA_COUNT).toFixed(1) : "—";
  const finH = H ? (H / AIDA_COUNT).toFixed(1) : "—";
  const total = d.stitches || colors.reduce((s, c) => s + (c.count || 0), 0);

  const body = `
    <div class="doc-head">
      <div>
        <p class="doc-kicker">Cross-stitch chart</p>
        <h1 class="doc-title">${esc(name)}</h1>
      </div>
      <div class="doc-meta">
        <div><b>${W} × ${H}</b> stitches</div>
        <div>${finW}" × ${finH}" @ ${AIDA_COUNT}ct</div>
        <div><b>${total}</b> stitches · ${colors.length} colors</div>
        <div class="brand">metime</div>
      </div>
    </div>
    <div style="text-align:center; margin: 4px 0 8px;">${svg}</div>
    <h2 class="sec">Floss legend — DMC</h2>
    <table class="legend">
      <thead><tr><th>Sym</th><th>Color</th><th>DMC</th><th>Name</th><th>Stitches</th><th>Skeins</th></tr></thead>
      <tbody>${legendRows}</tbody>
    </table>`;

  return htmlDoc({
    title: `${name} — chart`,
    pageCss: `size: letter ${landscape ? "landscape" : "portrait"}; margin: 0.5in;`,
    body,
  });
}
