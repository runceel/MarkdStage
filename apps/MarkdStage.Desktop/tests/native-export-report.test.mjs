import assert from "node:assert/strict";
import { test } from "node:test";
import { formatExportReport } from "../src/MarkdStage.Cli/export-report.mjs";
import { formatExportReport as formatNodeExportReport } from "../../../packages/markdstage-cli/src/commands/export.mjs";

const diagnostic = {
  category: "adaptive-card", severity: "warning", code: "blocked-image",
  path: "$.body[0].url", sourcePath: "adaptive-card[0]$.body[0].url",
  message: "The image was replaced by a safe placeholder.", impact: "content",
};
const card = {
  page: 1, slideIndex: 0, blockIndex: 0, type: "adaptive-card", path: "adaptive-card[0]",
  reason: "adaptive-card-rendered-as-artwork", impact: "content", diagnostics: [diagnostic],
};
const cases = [
  ["plain PDF", { format: "pdf" }],
  ["plain PowerPoint", { format: "pptx" }],
  ["decoration-only PowerPoint", {
    format: "pptx", fallbacks: [{ page: 1, impact: "decoration" }, { page: 2, impact: "none" }],
  }],
  ["sorted and deduplicated PowerPoint pages", {
    format: "pptx", fallbacks: [3, 1, 3].map((page) => ({ page, impact: "content" })),
  }],
  ["PowerPoint card reason and warning", { format: "pptx", fallbacks: [card] }],
  ["PowerPoint card artwork without a warning", {
    format: "pptx", fallbacks: [{ ...card, diagnostics: [] }],
  }],
  ["PDF card diagnostics", {
    format: "pdf", adaptiveCards: [
      { page: 1, slideIndex: 0, diagnostics: [diagnostic] },
      { page: 2, slideIndex: 1, diagnostics: [{ ...diagnostic, severity: "error", code: "invalid-property" }] },
    ], adaptiveCardIssueCount: 2, adaptiveCardsTruncated: false,
  }],
  ["PDF card diagnostic truncation", {
    format: "pdf", adaptiveCards: [], adaptiveCardIssueCount: 1, adaptiveCardsTruncated: true,
  }],
  ["PDF card without diagnostics", {
    format: "pdf", adaptiveCards: [{ page: 1, slideIndex: 0, diagnostics: [] }],
    adaptiveCardIssueCount: 0, adaptiveCardsTruncated: false,
  }],
];

for (const [name, details] of cases) {
  test(`native export text matches Node: ${name}`, () => {
    const report = { total: 3, path: `cards.${details.format}`, bytes: 1234, theme: "dark", ...details };
    const before = structuredClone(report);
    assert.equal(formatExportReport(report), formatNodeExportReport(report));
    assert.deepEqual(report, before);
  });
}
