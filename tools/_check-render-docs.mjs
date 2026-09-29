// Renders every document type straight through the render layer (no Supabase,
// no HTTP) and reports page counts and page sizes. Catches the things that only
// show up once Chrome has laid the document out — a chart that overflows onto a
// second page, or a bundle that loses its landscape sheets.
//
//   node tools/_check-render-docs.mjs
import {
  documentPdf,
  orderDocumentPdf,
  DESIGN_DOC_TYPES,
  ORDER_DOC_TYPES,
} from "../api/_lib/render/index.js";
import { RECORDS, ORDER } from "./_check-render-docs-data.mjs";

process.env.CHROME_EXECUTABLE_PATH ||= "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Chrome writes uncompressed /MediaBox entries, so page geometry is greppable
// without pulling in a PDF parser.
function pageBoxes(buf) {
  return [...buf.toString("latin1").matchAll(/\/MediaBox\s*\[\s*([\d.\s-]+?)\]/g)]
    .map((m) => m[1].trim().split(/\s+/).map(Number))
    .map(([, , w, h]) => `${Math.round(w)}×${Math.round(h)}`);
}

let failures = 0;
function report(label, pdf) {
  if (!pdf) {
    console.log(`  ✗ ${label}: returned null`);
    failures++;
    return null;
  }
  const boxes = pageBoxes(Buffer.from(pdf));
  const tally = boxes.reduce((m, b) => m.set(b, (m.get(b) || 0) + 1), new Map());
  const shape = [...tally].map(([b, n]) => `${n}× ${b}`).join(", ");
  console.log(`  ✓ ${label}: ${boxes.length} page(s) [${shape}] ${(pdf.length / 1024).toFixed(0)} KB`);
  return boxes;
}

console.log("Design documents");
for (const type of Object.keys(RECORDS)) {
  for (const doc of DESIGN_DOC_TYPES) {
    report(`${type} / ${doc}`, await documentPdf(RECORDS[type], doc));
  }
}

console.log("\nOrder documents");
const designs = new Map(Object.values(RECORDS).map((r) => [r.id, r]));
let bundleBoxes = null;
for (const doc of ORDER_DOC_TYPES) {
  const pdf = await orderDocumentPdf(ORDER, doc, doc === "bundle" ? designs : null);
  const boxes = report(`order / ${doc}`, pdf);
  if (doc === "bundle") bundleBoxes = boxes;
}

// The bundle is the one that can silently regress: if named @page support ever
// breaks, every sheet collapses to a single orientation and nobody notices
// until a chart prints cropped.
console.log("\nBundle assertions");
const landscape = (bundleBoxes || []).filter((b) => b === "792×612").length;
const portrait = (bundleBoxes || []).filter((b) => b === "612×792").length;
console.log(`  portrait pages: ${portrait}, landscape pages: ${landscape}`);
if (landscape > 0 && portrait > 0) {
  console.log("  ✓ mixed page orientations survived into one PDF (named @page works)");
} else {
  console.log("  ✗ expected BOTH orientations in the bundle — named @page did not apply");
  failures++;
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll good.");
process.exit(failures ? 1 : 0);
