import assert from "node:assert/strict";
import test from "node:test";
import { adaptiveCardSchemaEnvelope, validateAdaptiveCardSource, isAllowedCardHref } from "../renderer/adaptive-card-validation.mjs";
import { adaptiveCardCapabilities } from "../renderer/adaptive-card-capabilities.mjs";
import { generateAdaptiveCardContract } from "../scripts/generate-adaptive-card-contract.mjs";
import { adaptiveCardOutputReport, pptxAdaptiveCardReport } from "../runtime/output-model.mjs";
import { sanitizeLayoutReport } from "../runtime/layout-report.mjs";
import { formatExportReport } from "../runtime/export-report.mjs";
import { adaptiveCardCompatibilityCases, compatibilityDiagnostics } from "../../../../test/harness/adaptive-card-compatibility.mjs";

test("every validator type/property/role has an explicit browser and PPTX contract; generated guide cannot drift", async () => {
  const envelope = adaptiveCardSchemaEnvelope(), capabilities = adaptiveCardCapabilities();
  assert.deepEqual(Object.keys(capabilities.types), Object.keys(envelope));
  assert.equal(capabilities.sdkVersion, "3.0.6");
  assert.equal(capabilities.schemaVersion, "1.5");
  assert.equal(capabilities.hostConfigVersion, 1);
  assert.equal(capabilities.supportsInteractivity, false);
  for (const [type, schema] of Object.entries(envelope)) {
    const entry = capabilities.types[type];
    assert.deepEqual(Object.keys(entry.properties), [...schema.properties, ...Object.keys(schema.collections),
      ...Object.keys(schema.children), ...Object.keys(schema.records), ...schema.capabilityProperties]);
    assert.ok(entry.browser && entry.pptx, type);
    for (const [name, property] of Object.entries(entry.properties)) assert.ok(property.browser && property.pptx, `${type}.${name}`);
  }
  await generateAdaptiveCardContract({ check: true });
});

test("capability introspection cannot mutate the validator's accepted collection roles", () => {
  const description = adaptiveCardSchemaEnvelope();
  description.AdaptiveCard.collections.body.push("Column");
  description.Image.children.selectAction.push("Action.ShowCard");
  assert.equal(adaptiveCardSchemaEnvelope().AdaptiveCard.collections.body.includes("Column"), false);
  const result = validateAdaptiveCardSource(JSON.stringify({ type: "AdaptiveCard", version: "1.5", body: [{ type: "Column", items: [] }] }));
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code, "unsupported-element");
});

for (const entry of await adaptiveCardCompatibilityCases()) {
  test(`official-sample compatibility static diagnostics: ${entry.name}`, () => {
    const result = validateAdaptiveCardSource(JSON.stringify(entry.input));
    assert.equal(result.valid, entry.static.valid);
    assert.equal(result.complete, entry.static.complete);
    assert.deepEqual(compatibilityDiagnostics(result.diagnostics), entry.static.diagnostics);
    assert.equal(result.truncated, !entry.static.complete);
    if (entry.name === "fallback-resolution") {
      assert.equal(result.sourcePaths.get("$.body[1].text"), "$.body[2].fallback.text");
      assert.equal(result.sourcePaths.get("$.body[2].text"), "$.body[3].fallback.text");
    }
  });
}

test("authored source version is exact while requires at or below the pinned capability can succeed", () => {
  for (const version of ["1.0", "1.4", "1.5", "*"]) {
    const json = { type: "AdaptiveCard", version: "1.5", body: [{ type: "TextBlock", text: "Retained", requires: { adaptiveCards: version } }] };
    assert.equal(validateAdaptiveCardSource(JSON.stringify(json)).valid, true);
    if (version !== "1.5") {
      json.version = version;
      assert.equal(validateAdaptiveCardSource(JSON.stringify(json)).diagnostics[0].code, "unsupported-version");
    }
  }
  for (const type of ["Action.ShowCard"]) {
    const result = validateAdaptiveCardSource(JSON.stringify({ type: "AdaptiveCard", version: "1.5", body: [],
      actions: [{ type, title: "Collapsed", card: { type: "AdaptiveCard", version: "1.6", body: [] } }] }));
    assert.equal(result.diagnostics[0].code, "unsupported-version");
    assert.equal(result.diagnostics[0].path, "$.actions[0].card.version");
  }
});

test("link preflight does not promise a safe hyperlink which the browser will remove for credentials", () => {
  for (const link of ["https://user:secret@example.invalid/", "https://user@example.invalid", "mailto://user:secret@example.invalid/"]) {
    assert.equal(isAllowedCardHref(link), false, link);
  }
});

test("incomplete/truncated browser and PPTX reporting never reads as complete, and text retains content impact", () => {
  const card = {
    blockIndex: 2, status: "error", sdkVersion: "3.0.6", schemaVersion: "1.5", hostConfigVersion: 1,
    complete: false, diagnosticsTruncated: true, resourceValidation: "not-run",
    nativeObjectCount: 0, rasterizedSubtreeCount: 1,
    diagnostics: [{ category: "adaptive-card", code: "diagnostics-truncated", path: "$", sourcePath: "adaptive-card[2]$",
      severity: "error", impact: "content", message: "Incomplete diagnostics." }],
    conversions: [{ sourcePath: "adaptive-card[2]$", sourceType: "AdaptiveCard", mode: "rasterized",
      reason: "adaptive-card-diagnostics-truncated", nativeObjects: 0, impact: "content" }],
  };
  const layout = sanitizeLayoutReport({ slides: [{ index: 1, page: 2, adaptiveCards: [card] }] });
  assert.equal(layout.slides[0].adaptiveCards[0].complete, false);
  assert.equal(layout.slides[0].adaptiveCards[0].resourceValidation, "not-run");
  assert.equal(layout.adaptiveCardIssueCount, 1);
  const capture = adaptiveCardOutputReport(layout);
  assert.equal(capture.adaptiveCardsComplete, false);
  assert.equal(capture.adaptiveCardsTruncated, true);
  const report = pptxAdaptiveCardReport({ slides: [{}, { adaptiveCards: [card] }] });
  assert.equal(report.adaptiveCardsComplete, false);
  assert.equal(report.adaptiveCardsTruncated, true);
  assert.equal(report.adaptiveCardIssueCount, 1);
  const text = formatExportReport({ ...report, format: "pptx", total: 2, path: "cards.pptx", bytes: 100, theme: "dark" });
  assert.match(text, /error slide 2: adaptive-card\[2\]\$ Incomplete diagnostics\. \(diagnostics-truncated; content impact\)/);
  assert.match(text, /validation is incomplete/);
  assert.match(text, /Browser image validation was not run/);
  assert.match(text, /0 editable native objects, 0 approximated elements, 1 rasterized subtrees/);
});
