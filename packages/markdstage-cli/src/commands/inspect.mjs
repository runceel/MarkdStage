// markdstage inspect — the compact 1280x720 clipping diagnostics the Canvas
// `inspect_layout` action returns.

import { inspectLayout } from "../runtime.mjs";
import { withDeckServer } from "../deck.mjs";

export async function inspectCommand(options, inspect = inspectLayout) {
  return withDeckServer(options, async (session) =>
    inspect(session, options.index, options.includeFits),
  );
}

export function formatInspectReport(report) {
  const lines = [
    `${report.width}x${report.height} · ${report.inspected}/${report.total} slide(s) inspected`,
  ];
  if (!report.slides.length) {
    lines.push(report.hasIssues ? "  (no details)" : "  OK: every slide fits the 16:9 output.");
    return lines.join("\n");
  }
  for (const slide of report.slides) {
    const details = [];
    if (slide.verticalOverflowPx) details.push(`vertical ${slide.verticalOverflowPx}px`);
    if (slide.horizontalOverflowPx) details.push(`horizontal ${slide.horizontalOverflowPx}px`);
    lines.push(
      `  slide ${slide.page ?? slide.index + 1} (${slide.title || "untitled"}): ${slide.status}` +
        (details.length ? ` — ${details.join(", ")}` : ""),
    );
    for (const hint of slide.elements ?? []) {
      const metrics = hint.kind === "architecture" ? [
        hint.bbox ? `bbox ${hint.bbox.x},${hint.bbox.y} ${hint.bbox.width}x${hint.bbox.height}px` : "",
        `scale ${hint.effectiveScale}`,
        hint.fontSize !== undefined ? `font ${hint.fontSize}px (requested ${hint.requestedFontSize}, effective ${hint.effectiveFontSize})` : "",
        hint.requestedSize && hint.effectiveSize
          ? `size ${hint.requestedSize.width}x${hint.requestedSize.height} -> ${hint.effectiveSize.width}x${hint.effectiveSize.height}` : "",
        hint.shrunk ? "shrunk" : "",
        hint.truncated ? "truncated" : "",
      ].filter(Boolean).join("; ") : "";
      lines.push(`      ${hint.kind}: ${hint.path || hint.tag}${hint.text ? ` — ${hint.text}` : ""}${metrics ? ` [${metrics}]` : ""}`);
    }
    for (const diagram of slide.architecture ?? []) {
      lines.push(`      architecture[${diagram.blockIndex}]: scale ${diagram.effectiveScale}; ${diagram.reportedElementCount}/${diagram.elementCount} element(s) reported`);
    }
  }
  lines.push(`  ${report.issueCount} slide(s) do not fit.`);
  return lines.join("\n");
}
