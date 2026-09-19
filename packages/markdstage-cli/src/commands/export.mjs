// markdstage export — produce the same PDF or editable PowerPoint as the Canvas Extension.

import { extname } from "node:path";

import {
  exportPdf,
  exportPptx,
  pdfNameForSource,
  pptxNameForSource,
} from "../runtime.mjs";
import { withDeckServer } from "../deck.mjs";
export { formatExportReport } from "../runtime.mjs";

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
