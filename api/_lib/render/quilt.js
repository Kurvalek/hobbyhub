import { esc, htmlDoc } from "./helpers.js";

// Renders eighths-of-a-yard as a tidy fraction (matches the studio's fmtY).
function fmtY(y) {
  if (!y) return "0 yd";
  const w = Math.floor(y);
  const e = Math.round((y - w) * 8);
  if (!e) return `${w} yd`;
  if (e === 8) return `${w + 1} yd`;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = gcd(e, 8);
  return w ? `${w} ${e / g}/${8 / g} yd` : `${e / g}/${8 / g} yd`;
}

// SVG points for a triangle half — ported verbatim from the quilt thumbnail
// renderer in index.html so the printed layout matches the on-screen design.
function triPoints(s) {
  const { c, r, w, h } = s;
  if (s.dir === "/") {
    return s.half === "a"
      ? `${c},${r} ${c + w},${r} ${c},${r + h}`
      : `${c + w},${r} ${c + w},${r + h} ${c},${r + h}`;
  }
  return s.half === "a"
    ? `${c},${r} ${c + w},${r} ${c + w},${r + h}`
    : `${c},${r} ${c},${r + h} ${c + w},${r + h}`;
}

// Builds a printable quilt template: a block-placement diagram plus a cutting
// list (per-fabric strips/cut size/yardage) and backing/binding/batting.
export function quiltTemplateHtml(record) {
  const d = record.data || {};
  const cols = d.cols || 1;
  const rows = d.rows || 1;
  const shapes = d.shapes || [];
  const name = d.name || record.id || "Quilt pattern";
  const bs = d.bs || null;
  const fw = d.fw || 0;
  const fh = d.fh || 0;

  const shapeEls = shapes
    .map((s) => {
      if (!s || !s.color) return "";
      if (s.type === "tri") {
        return `<polygon points="${triPoints(s)}" fill="${esc(s.color.hex)}"/>`;
      }
      return `<rect x="${s.c}" y="${s.r}" width="${s.w}" height="${s.h}" fill="${esc(s.color.hex)}" stroke="rgba(46,41,37,0.10)" stroke-width="0.04"/>`;
    })
    .join("");

  // Scale the cols×rows coordinate space up so strokes/labels render crisply.
  const unit = Math.max(4, Math.floor(700 / Math.max(cols, rows)));
  const svgW = cols * unit;
  const svgH = rows * unit;
  const svg = `<svg width="${svgW}" height="${svgH}" viewBox="0 0 ${cols} ${rows}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${cols}" height="${rows}" fill="#ffffff"/>
    ${shapeEls}
    <rect x="0" y="0" width="${cols}" height="${rows}" fill="none" stroke="#1A1613" stroke-width="0.08"/>
  </svg>`;

  const items = (d.materials && d.materials.items) || [];
  const cutRows = items
    .map(
      (it) => `<tr>
        <td><span class="swatch" style="background:${esc(it.hex)}"></span></td>
        <td class="mono">${esc(it.code || "")}</td>
        <td>${esc(it.name || "Fabric")}</td>
        <td class="mono">${it.strips != null ? it.strips : "—"}</td>
        <td class="mono">${it.cutSize != null ? it.cutSize + '"' : "—"}</td>
        <td class="mono">${fmtY(it.yards || 0)}</td>
      </tr>`
    )
    .join("");

  const backing = d.backing && d.backCalc ? fmtY(d.backCalc.yards) : null;
  const binding = d.binding && d.bindCalc ? fmtY(d.bindCalc.yards) : null;
  const batting = fw && fh ? `${fw + 8}" × ${fh + 8}"` : null;

  const extras = [
    backing ? `<tr><td colspan="5">Backing fabric</td><td class="mono">${backing}</td></tr>` : "",
    binding ? `<tr><td colspan="5">Binding fabric (2.5" strips)</td><td class="mono">${binding}</td></tr>` : "",
    batting ? `<tr><td colspan="5">Batting (cut oversized)</td><td class="mono">${batting}</td></tr>` : "",
  ].join("");

  const body = `
    <div class="doc-head">
      <div>
        <p class="doc-kicker">Quilt template &amp; cutting guide</p>
        <h1 class="doc-title">${esc(name)}</h1>
      </div>
      <div class="doc-meta">
        ${fw && fh ? `<div><b>${fw}" × ${fh}"</b> finished</div>` : ""}
        <div>${cols} × ${rows} blocks${bs ? ` · ${bs}" each` : ""}</div>
        <div><b>${fmtY(d.grandTotal || 0)}</b> total fabric</div>
        <div class="brand">metime</div>
      </div>
    </div>
    <div style="text-align:center; margin: 4px 0 10px;">${svg}</div>
    <h2 class="sec">Cutting list — Kona Cotton</h2>
    <table class="legend">
      <thead><tr><th>Color</th><th>Kona</th><th>Name</th><th>Strips</th><th>Cut size</th><th>Yardage</th></tr></thead>
      <tbody>${cutRows}${extras}</tbody>
    </table>
    <div class="tip">Cut measurements include a ¼" seam allowance and assume 40" width-of-fabric. Add 10–15% for shrinkage. Backing is cut 4" larger than the top on every side.</div>`;

  return htmlDoc({
    title: `${name} — template`,
    pageCss: `size: letter portrait; margin: 0.5in;`,
    body,
  });
}
