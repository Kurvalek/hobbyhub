import { crossStitchChartHtml } from "./chart.js";
import { quiltTemplateHtml } from "./quilt.js";
import { instructionsHtml } from "./instructions.js";
import { htmlToPdf } from "./pdf.js";

// The documents we can produce for a design.
export const DOC_TYPES = ["chart", "instructions"];

// Returns the HTML for a given document ("chart" = the design-specific
// template/chart, "instructions" = the how-to sheet), or null if the design
// type doesn't support it.
export function documentHtml(record, doc) {
  if (doc === "instructions") return instructionsHtml(record);
  if (doc === "chart") {
    if (record.type === "cross-stitch") return crossStitchChartHtml(record);
    if (record.type === "quilt") return quiltTemplateHtml(record);
  }
  return null;
}

// Renders a design document straight to a PDF Buffer.
export async function documentPdf(record, doc) {
  const html = documentHtml(record, doc);
  if (!html) return null;
  return await htmlToPdf(html);
}

// A friendly download filename for a rendered document.
export function documentFilename(record, doc) {
  const base = (record?.data?.name || record?.id || "design")
    .toString()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "design";
  const suffix = doc === "chart"
    ? record.type === "quilt" ? "template" : "chart"
    : "instructions";
  return `${base}-${suffix}.pdf`;
}
