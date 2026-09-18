export function formatExportReport(report) {
  const format = report.format === "pptx" ? "PowerPoint" : "PDF";
  const exported = `Exported ${report.total} slide(s) to ${report.path} (${report.bytes} bytes, ${format}, theme ${report.theme})`;
  const contentFallbacks = report.format === "pptx" && Array.isArray(report.fallbacks)
    ? report.fallbacks.filter((fallback) => fallback?.impact === "content")
    : [];
  const pages = [...new Set(contentFallbacks.map((fallback) => fallback.page).filter(Number.isInteger))]
    .sort((a, b) => a - b);
  const summary = !contentFallbacks.length ? `${exported}.` : pages.length === 1
    ? `${exported} — an image on slide ${pages[0]} is not editable.`
    : `${exported} — images on slides ${pages.join(", ")} are not editable.`;
  const cardReports = report.format === "pptx"
    ? contentFallbacks.filter((entry) => entry.type === "adaptive-card")
    : report.adaptiveCards || [];
  const lines = [summary];
  for (const card of cardReports) {
    if (card.reason) lines.push(`  slide ${card.page}: ${card.path} (${card.reason}; content impact)`);
    for (const diagnostic of card.diagnostics || []) {
      lines.push(`  ${diagnostic.severity} slide ${card.page}: ${diagnostic.sourcePath} ${diagnostic.message} (${diagnostic.code})`);
    }
  }
  if (report.adaptiveCardsTruncated) lines.push("  Card diagnostic details are truncated; inspect smaller inputs.");
  return lines.join("\n");
}
