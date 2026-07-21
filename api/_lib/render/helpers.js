// Shared helpers for building print-ready HTML documents from design records.

// Escapes text for safe interpolation into HTML.
export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Rebuilds a flat cell array (hex or null per stitch) from the run-length grid
// the studio saves. Ported from `deserializeGrid` in index.html so the chart
// matches the on-screen design exactly. Row-major: index = row * W + col.
export function deserializeGrid(g, len) {
  const cells = new Array(len).fill(null);
  if (!g || !g.rle) return cells;
  let i = 0;
  for (const run of g.rle.split("|")) {
    const dot = run.indexOf(".");
    const c = parseInt(run.slice(0, dot), 10);
    const v = parseInt(run.slice(dot + 1), 10);
    for (let k = 0; k < c && i < len; k++) {
      if (v > 0) cells[i] = (g.colors && g.colors[v - 1]) || null;
      i++;
    }
  }
  return cells;
}

// A large, visually distinct symbol set for cross-stitch chart legends. Chosen
// to stay legible at small sizes; cycles if a design somehow exceeds the set.
const SYMBOLS = [
  "●", "■", "▲", "◆", "★", "✚", "✖", "▼", "◗", "◐", "♦", "♥", "♣", "♠",
  "☀", "☁", "☂", "☘", "❀", "✿", "❄", "⬟", "⬠", "⬢", "⬡", "◭", "◮", "⌘",
  "§", "¶", "†", "‡", "Ω", "Δ", "Σ", "Ψ", "Φ", "Θ", "Λ", "Ξ", "Π",
  "A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P",
  "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "0", "1", "2", "3", "4",
];

// Assigns each distinct color (by hex) a stable symbol, in the order colors are
// provided (the studio already sorts them by stitch count, most-used first).
export function assignSymbols(colors) {
  const map = new Map();
  colors.forEach((c, i) => {
    map.set(c.hex, SYMBOLS[i % SYMBOLS.length]);
  });
  return map;
}

// Picks black or white text for legibility on a given background hex.
export function readableText(hex) {
  if (!hex) return "#000";
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#111" : "#fff";
}

// Shared print CSS: self-contained (no external fonts/assets so the PDF renders
// identically offline) and branded to the studio's warm palette.
export function baseStyles() {
  return `
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { font-family: "Helvetica Neue", Arial, sans-serif; color: #2E2925; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .doc { padding: 0; }
    .doc-head { border-bottom: 2px solid #1A1613; padding-bottom: 14px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
    .doc-title { font-size: 22px; font-weight: 700; letter-spacing: -0.01em; margin: 0; }
    .doc-kicker { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #8A8177; margin: 0 0 4px; }
    .doc-meta { text-align: right; font-size: 11px; color: #6b6459; line-height: 1.5; }
    .doc-meta b { color: #2E2925; }
    h2.sec { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #8A8177; margin: 22px 0 10px; border-bottom: 1px solid #E4DED5; padding-bottom: 4px; }
    .brand { font-size: 12px; letter-spacing: 0.18em; text-transform: lowercase; color: #E8583A; font-weight: 700; }
    table.legend { border-collapse: collapse; width: 100%; font-size: 11px; }
    table.legend th { text-align: left; color: #8A8177; font-weight: 600; padding: 4px 8px; border-bottom: 1px solid #E4DED5; text-transform: uppercase; letter-spacing: 0.04em; font-size: 10px; }
    table.legend td { padding: 5px 8px; border-bottom: 1px solid #EDE8E0; vertical-align: middle; }
    .sym { font-size: 13px; text-align: center; width: 26px; }
    .swatch { width: 16px; height: 16px; border-radius: 3px; border: 1px solid rgba(0,0,0,0.15); display: inline-block; vertical-align: middle; }
    .mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
    .muted { color: #8A8177; }
    ol.steps { padding-left: 18px; margin: 0; }
    ol.steps li { margin-bottom: 9px; font-size: 12.5px; line-height: 1.55; }
    .tip { background: #FBFAF8; border: 1px solid #E4DED5; border-radius: 8px; padding: 12px 14px; font-size: 12px; margin-top: 14px; }
    .stat-row { display: flex; gap: 26px; margin: 4px 0 0; }
    .stat .n { font-size: 20px; font-weight: 700; }
    .stat .l { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #8A8177; }
  `;
}

// Wraps body HTML in a full document with the given page CSS.
export function htmlDoc({ title, pageCss, body }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${baseStyles()}
@page { ${pageCss} }
</style></head><body><div class="doc">${body}</div></body></html>`;
}
