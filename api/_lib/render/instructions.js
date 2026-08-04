import { esc, htmlDoc } from "./helpers.js";
import { designToBom } from "../bom.js";
import { quiltCutList, fmtInches } from "../cutlist.js";

function stepsList(steps) {
  return `<ol class="steps">${steps.map((s) => `<li>${s}</li>`).join("")}</ol>`;
}

function suppliesList(rows) {
  return `<table class="legend"><thead><tr><th>Included</th><th>Qty</th></tr></thead><tbody>${rows
    .map(
      (r) => `<tr><td>${r.swatch ? `<span class="swatch" style="background:${esc(r.swatch)}"></span> ` : ""}${esc(r.label)}</td><td class="mono">${esc(r.qty)}</td></tr>`
    )
    .join("")}</tbody></table>`;
}

function crossStitchInstructions(record, bom) {
  const d = record.data || {};
  const name = d.name || record.id || "Your pattern";
  const rows = [];
  if (bom?.aida)
    rows.push({ label: `Aida cloth, ${bom.aida.count}-count${bom.aida.color ? ` (${bom.aida.color})` : ""}`, qty: `${bom.aida.w}" × ${bom.aida.h}"` });
  if (bom?.needle) rows.push({ label: bom.needle + " needle", qty: "1" });
  for (const f of bom?.floss || [])
    rows.push({ swatch: f.hex, label: `DMC ${f.code} — ${f.name}`, qty: `${f.skeins} skein${f.skeins === 1 ? "" : "s"}` });

  const steps = [
    "<b>Prep your cloth.</b> Find the center of the Aida by folding it in half both ways; the creases cross at the middle. The chart's center is marked by the heavy gridlines — starting from the center keeps your design centered on the fabric.",
    "<b>Separate your floss.</b> DMC floss has 6 strands. For 14-count Aida, stitch with <b>2 strands</b>. Cut a length about 18\" long — longer tangles and frays.",
    "<b>Read the chart.</b> Each square is one stitch. The symbol tells you which floss color to use — match it to the legend on your chart sheet. Each square on the Aida is one stitch too.",
    "<b>Make a cross-stitch.</b> Bring the needle up at the bottom-left of a square, down at the top-right (that's a half stitch, /), then up at the bottom-right and down at the top-left to complete the X. Keep the top diagonal facing the same way for every stitch.",
    "<b>Work color by color.</b> Stitch all of one color in an area before switching. Don't carry floss more than a few squares behind unstitched fabric — it shows through.",
    "<b>Finish off.</b> Weave the tail under a few stitches on the back; no knots. Trim close.",
    "<b>Press & mount.</b> Press face-down on a towel. For a bookmark, trim to size leaving a small border and finish the edges as you like.",
  ];

  const body = `
    <div class="doc-head">
      <div>
        <p class="doc-kicker">Cross-stitch instructions</p>
        <h1 class="doc-title">${esc(name)}</h1>
      </div>
      <div class="doc-meta">
        ${bom?.finishedInches ? `<div><b>${bom.finishedInches.w}" × ${bom.finishedInches.h}"</b> finished</div>` : ""}
        ${bom?.finishedStitches ? `<div>${bom.finishedStitches.w} × ${bom.finishedStitches.h} stitches</div>` : ""}
        <div class="brand">metime</div>
      </div>
    </div>
    <h2 class="sec">In your kit</h2>
    ${suppliesList(rows)}
    <h2 class="sec">How to stitch it</h2>
    ${stepsList(steps)}
    <div class="tip"><b>New to cross-stitch?</b> Start in a corner of a large single-color area to get a rhythm before tackling detailed sections. Keep even tension — snug, not tight.</div>`;

  return htmlDoc({ title: `${name} — instructions`, pageCss: `size: letter portrait; margin: 0.6in;`, body });
}

function quiltInstructions(record, bom) {
  const d = record.data || {};
  const name = d.name || record.id || "Your quilt";
  const cols = d.cols || 0;
  const rowsCount = d.rows || 0;
  const bs = d.bs || null;
  const cut = quiltCutList(d);

  const rows = [];
  for (const fab of bom?.fabrics || [])
    rows.push({ swatch: fab.hex, label: `Kona ${fab.code ? fab.code + " — " : ""}${fab.name}`, qty: fab.yardsLabel });
  if (bom?.batting) rows.push({ label: "Batting", qty: `${bom.batting.w}" × ${bom.batting.h}"` });
  if (bom?.backing) rows.push({ label: "Backing fabric", qty: bom.backing.yardsLabel });
  if (bom?.binding) rows.push({ label: "Binding fabric", qty: bom.binding.yardsLabel });

  // A one-line summary of what to cut, so the instructions stand on their own
  // even next to the template sheet.
  const cutSummary = [];
  if (cut.totals.squarePieces)
    cutSummary.push(`${cut.totals.squarePieces} square${cut.totals.squarePieces === 1 ? "" : "s"}`);
  if (cut.totals.hstUnits)
    cutSummary.push(`${cut.totals.hstUnits} half-square-triangle unit${cut.totals.hstUnits === 1 ? "" : "s"}`);
  const cutSummaryText = cutSummary.length ? cutSummary.join(" and ") : "the pieces on the template sheet";

  const steps = [];
  steps.push(
    `<b>Cut your pieces.</b> Following the cutting list on the template sheet, cut ${cutSummaryText}. Every square measurement already includes a ¼" seam allowance, so cut on the lines.`
  );
  if (cut.hasHst) {
    steps.push(
      `<b>Make the half-square triangles.</b> For each color pair, layer one square of each color right sides together, draw a diagonal line corner to corner, and sew ¼" from each side of the line. Cut along the line and press open — each pair makes two units. Trim every unit square before piecing.`
    );
  }
  steps.push(
    `<b>Lay out the top.</b> Arrange your pieces into the ${rowsCount && cols ? `${rowsCount} row${rowsCount === 1 ? "" : "s"} of ${cols}` : "grid"} shown on the placement diagram${bs ? ` (each block finishes at ${fmtInches(bs)})` : ""}. Snap a photo before sewing so you can restore the layout if pieces shift.`
  );
  steps.push(
    `<b>Piece each row.</b> Sew the pieces in each horizontal row together with a scant ¼" seam. Press the seams of adjoining rows in opposite directions so they nest when you join them.`
  );
  steps.push(
    `<b>Join the rows.</b> Sew the ${rowsCount ? `${rowsCount} rows` : "rows"} together in order, matching seams as you go. Press — your quilt top is complete${bom?.finishedInches ? ` at ${bom.finishedInches.w}" × ${bom.finishedInches.h}"` : ""}.`
  );
  steps.push(
    `<b>Baste the layers.</b> Layer the backing (right side down), batting, then the quilt top (right side up). Smooth flat and pin or spray baste.`
  );
  steps.push(
    `<b>Quilt it.</b> Quilt as desired — straight lines, following the seams, or free-motion. Work from the center outward.`
  );
  if (bom?.binding) {
    steps.push(
      `<b>Bind the edges.</b> Trim the excess batting and backing flush with the top. Sew the 2.5" binding strips end to end, fold in half lengthwise, and attach around the edge, mitering the corners.`
    );
  }

  const body = `
    <div class="doc-head">
      <div>
        <p class="doc-kicker">Quilt assembly instructions</p>
        <h1 class="doc-title">${esc(name)}</h1>
      </div>
      <div class="doc-meta">
        ${bom?.finishedInches ? `<div><b>${bom.finishedInches.w}" × ${bom.finishedInches.h}"</b> finished</div>` : ""}
        ${cols && rowsCount ? `<div>${cols} × ${rowsCount} blocks${bs ? ` · ${fmtInches(bs)} each` : ""}</div>` : ""}
        <div class="brand">metime</div>
      </div>
    </div>
    <h2 class="sec">In your kit</h2>
    ${suppliesList(rows)}
    <h2 class="sec">How to make it</h2>
    ${stepsList(steps)}
    <div class="tip"><b>Seam tip:</b> A consistent ¼" seam is everything in quilting. Test on scraps and adjust your needle position until two 2.5" strips sewn together measure exactly 4.5" across.</div>`;

  return htmlDoc({ title: `${name} — instructions`, pageCss: `size: letter portrait; margin: 0.6in;`, body });
}

// Builds the instruction sheet for a design record, or null if the type is
// unknown. Design-specific values (sizes, floss, yardage) are merged in via
// the shared BOM so the sheet always matches what's in the kit.
export function instructionsHtml(record) {
  const bom = designToBom(record);
  if (record.type === "cross-stitch") return crossStitchInstructions(record, bom);
  if (record.type === "quilt") return quiltInstructions(record, bom);
  return null;
}
