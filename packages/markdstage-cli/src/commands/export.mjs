// markdstage export — produce the same PDF or editable PowerPoint as the Canvas Extension.

import { extname } from "node:path";

import {
  exportPdf,
  exportPptx,
  pdfNameForSource,
  pptxNameForSource,
} from "../runtime.mjs";
import { withDeckServer } from "../deck.mjs";

export async function exportCommand(
  options,
  exporters = { pdf: exportPdf, pptx: exportPptx },
) {
  return withDeckServer(options, async (session) => {
    const requested = options.output || pdfNameForSource(session.sourceName);
    const extension = extname(requested).toLowerCase();
    if (extension === ".pptx") {
      return exporters.pptx(
        session,
        options.output || pptxNameForSource(session.sourceName),
        options.theme,
        undefined,
        { mermaidImageFallback: options.mermaidImageFallback === true },
      );
    }
    return exporters.pdf(session, requested, options.theme);
  });
}

export function formatExportReport(report) {
  const format = report.format === "pptx" ? "PowerPoint" : "PDF";
  const exported = `Exported ${report.total} slide(s) to ${report.path} (${report.bytes} bytes, ${format}, theme ${report.theme})`;
  const contentFallbacks = report.format === "pptx" && Array.isArray(report.fallbacks)
    ? report.fallbacks.filter((fallback) => fallback?.impact === "content")
    : [];
  if (!contentFallbacks.length) return `${exported}.`;
  const pages = [...new Set(contentFallbacks.map((fallback) => fallback.page).filter(Number.isInteger))]
    .sort((a, b) => a - b);
  return pages.length === 1
    ? `${exported} — an image on slide ${pages[0]} is not editable.`
    : `${exported} — images on slides ${pages.join(", ")} are not editable.`;
}
