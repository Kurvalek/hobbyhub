import { crossStitchChartParts, punchNeedleChartParts } from "./chart.js";
import { quiltTemplateParts } from "./quilt.js";
import { instructionsParts } from "./instructions.js";
import { pickSheetParts, packingSlipParts } from "./packing.js";
import { htmlDoc, htmlMultiDoc } from "./helpers.js";
import { htmlToPdf } from "./pdf.js";

// Documents that describe a single design. These are customer-facing: the
// studio serves them from /api/render for any design the visitor holds the id
// for, so nothing order-specific may ever appear in this list.
export const DESIGN_DOC_TYPES = ["chart", "instructions"];

// Documents that describe a whole order. Admin-only — they carry the shipping
// address and the internal pick list.
export const ORDER_DOC_TYPES = ["pick-sheet", "packing-slip", "bundle"];

// ── Design documents ────────────────────────────────────────────────────────

// Returns { title, pageCss, body } for a design document, or null if the
// design's type doesn't support it.
export function designDocumentParts(record, doc) {
  if (doc === "instructions") return instructionsParts(record);
  if (doc === "chart") {
    if (record.type === "cross-stitch") return crossStitchChartParts(record);
    if (record.type === "punch-needle") return punchNeedleChartParts(record);
    if (record.type === "quilt") return quiltTemplateParts(record);
  }
  return null;
}

// Returns the HTML for a given document ("chart" = the design-specific
// template/chart, "instructions" = the how-to sheet), or null if the design
// type doesn't support it.
export function documentHtml(record, doc) {
  const parts = designDocumentParts(record, doc);
  return parts ? htmlDoc(parts) : null;
}

// Renders a design document straight to a PDF Buffer.
export async function documentPdf(record, doc) {
  const html = documentHtml(record, doc);
  if (!html) return null;
  return await htmlToPdf(html);
}

function slugify(value, fallback) {
  return (
    String(value ?? "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || fallback
  );
}

// A friendly download filename for a rendered document.
export function documentFilename(record, doc) {
  const base = slugify(record?.data?.name || record?.id, "design");
  const suffix = doc === "chart"
    ? record.type === "quilt" ? "template" : "chart"
    : "instructions";
  return `${base}-${suffix}.pdf`;
}

// ── Order documents ─────────────────────────────────────────────────────────

// Builds the sheets for an order document. `designs` maps a design id to its
// stored record, and is only consulted for the bundle — the pick sheet and the
// packing slip are built entirely from the BOM frozen onto the order, so they
// still print correctly for a design that has since been edited or deleted.
function orderDocumentSheets(order, doc, designs) {
  if (doc === "pick-sheet") return [pickSheetParts(order)];
  if (doc === "packing-slip") return [packingSlipParts(order)];
  if (doc !== "bundle") return null;

  // Everything the packer needs, in the order they need it: pull the supplies,
  // print each kit's chart and instructions, then the slip that tops the box.
  const sheets = [pickSheetParts(order)];
  for (const item of order.items || []) {
    const record = item.designId ? designs?.get(item.designId) : null;
    if (!record) continue;
    for (const docType of DESIGN_DOC_TYPES) {
      const parts = designDocumentParts(record, docType);
      if (parts) sheets.push(parts);
    }
  }
  sheets.push(packingSlipParts(order));
  return sheets;
}

export function orderDocumentHtml(order, doc, designs) {
  const sheets = orderDocumentSheets(order, doc, designs);
  if (!sheets || !sheets.length) return null;
  if (sheets.length === 1) return htmlDoc(sheets[0]);
  const name = order.orderName || `#${order.orderId}`;
  return htmlMultiDoc({ title: `${name} — fulfillment packet`, sheets });
}

export async function orderDocumentPdf(order, doc, designs) {
  const html = orderDocumentHtml(order, doc, designs);
  if (!html) return null;
  return await htmlToPdf(html);
}

export function orderDocumentFilename(order, doc) {
  const base = slugify(order?.orderName || order?.orderId, "order");
  const suffix = doc === "bundle" ? "packet" : doc;
  return `${base}-${suffix}.pdf`;
}
