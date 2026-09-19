import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CARD_FIXTURE_DIRECTORY, cardFence } from "./adaptive-cards.mjs";

export const CARD_COMPATIBILITY_DIRECTORY = join(CARD_FIXTURE_DIRECTORY, "compatibility");
const issue = (code, path, severity = "warning") => ({ code, path, severity, impact: "content" });

export async function adaptiveCardCompatibilityCases() {
  const load = async (name) => JSON.parse(await readFile(join(CARD_COMPATIBILITY_DIRECTORY, `${name}.json`), "utf8"));
  const activity = await load("activity"), table = await load("flight-table");
  const cases = [];
  const add = (name, input, diagnostics = [], options = {}) => {
    const status = diagnostics.some((entry) => entry.severity === "error") ? "error" : "ready";
    const browserDiagnostics = options.browserDiagnostics || diagnostics;
    cases.push({
      name, input, markdown: `## Compatibility: ${name}\n\n${cardFence(input)}`,
      expected: [{ status, codes: browserDiagnostics.map((entry) => entry.code) }],
      static: { valid: status === "ready", complete: !diagnostics.some((entry) => entry.code === "diagnostics-truncated"), diagnostics },
      browser: { status, diagnostics: browserDiagnostics },
      contains: options.contains || [], absent: options.absent || [],
    });
  };
  const variant = (input, change) => { const copy = structuredClone(input); change(copy); return copy; };
  add("native-activity", activity, [], { contains: ["Publish Adaptive Card schema", "Schema team", "Backlog"] });
  add("mixed-activity", variant(activity, (card) => {
    card.body[1].columns[0].items[0].style = "person";
    card.body.push({ type: "TextBlock", text: "- Define schema\n- Publish reference", wrap: true });
  }), [], { contains: ["Schema team", "Define schema", "Publish reference"] });
  add("native-flight-table", table, [], { contains: ["Passengers", "Passenger A", "14A", "Passenger B", "14B"] });
  add("nongrid-flight-table", variant(table, (card) => { card.body[1].showGridLines = false; }),
    [], { contains: ["Passengers", "14A", "14B"] });
  add("static-inputs", await load("inputs"),
    [0, 1].flatMap((column) => [0, 1].map((item) => issue("static-input", `$.body[0].columns[${column}].items[${item}]`))),
    { contains: ["Name (non-interactive)", "Enter your name", "Red, Blue", "On: true"], absent: ["Name is required", "Green"] });
  const actionPath = "$.body[0].columns[0].items[0]";
  add("static-actions-media", await load("actions-media"), [
    issue("static-action", `${actionPath}.actions[0]`), issue("static-action", `${actionPath}.actions[1]`),
    issue("static-link", `${actionPath}.actions[2]`), issue("static-action", `${actionPath}.actions[3]`),
    issue("static-property-ignored", `${actionPath}.orientation`), issue("static-media", "$.body[0].columns[1].items[0]"),
  ], { contains: ["Submit", "Execute", "Documentation", "Show card (collapsed; non-interactive)", "Media: Local poster"],
    absent: ["Collapsed content must not appear", "never-run", "local-only"] });
  add("fallback-resolution", await load("fallbacks"), [
    issue("unsupported-element", "$.body[1]"), issue("fallback-dropped", "$.body[1].fallback"),
    issue("unsupported-element", "$.body[2]"), issue("fallback-substituted", "$.body[2].fallback"),
    issue("requires-not-met", "$.body[3].requires.acTest"), issue("fallback-substituted", "$.body[3].fallback"),
  ], { contains: ["Fallback test:", "No graph support.", "The required host is unavailable."], absent: ["Unsupported capability content"] });
  add("unknown-property", variant(activity, (card) => { card.body[0].customAppearance = "not-an-SDK-extension"; }),
    [issue("unknown-property", "$.body[0].customAppearance")], { contains: ["Schema team"], absent: ["not-an-SDK-extension"] });
  add("unsupported-type", variant(activity, (card) => { card.body[0].type = "Custom.Widget"; }),
    [issue("unsupported-element", "$.body[0]", "error")], { contains: ["unsupported-element"], absent: ["Schema team"] });
  for (const version of ["1.4", "1.6"]) add(`unsupported-version-${version}`,
    { ...activity, version }, [issue("unsupported-version", "$.version", "error")],
    { contains: ["unsupported-version"], absent: ["Schema team"] });
  add("requires-failed", variant(activity, (card) => { card.body[0].requires = { adaptiveCards: "1.6" }; }),
    [issue("requires-not-met", "$.body[0].requires.adaptiveCards", "error")], { contains: ["requires-not-met"], absent: ["Schema team"] });
  add("invalid-unused-fallback", variant(activity, (card) => { card.body[0].fallback = { type: "TextBlock", text: 42 }; }),
    [issue("invalid-property", "$.body[0].fallback.text", "error")], { contains: ["invalid-property"], absent: ["Schema team"] });
  const linkPath = "$.body[1].columns[0].items[0].selectAction.url";
  add("blocked-link", variant(activity, (card) => {
    card.body[1].columns[0].items[0].selectAction = { type: "Action.OpenUrl", title: "Unsafe link", url: "https://user:secret@example.invalid/" };
  }), [issue("blocked-link", linkPath)], { contains: ["Schema team"], absent: ["user:secret"] });
  add("custom-protocol", variant(activity, (card) => {
    card.body[1].columns[0].items[0].selectAction = { type: "Action.OpenUrl", url: "custom-host:never-run" };
  }), [issue("unsupported-protocol", linkPath, "error")], { contains: ["unsupported-protocol"], absent: ["Schema team"] });
  const assets = variant(activity, (card) => {
    card.body = [
      { type: "TextBlock", text: "Content before image failures", wrap: true },
      { type: "ColumnSet", columns: ["https://external.invalid/card.png", "assets/missing-corpus.svg",
        "data:image/png;base64,AQIDBA==", "assets/animated-motion.svg"].map((url) => ({
        type: "Column", width: 1, items: [{ type: "Image", url, width: "120px", altText: "Negative asset" }],
      })) },
      { type: "TextBlock", text: "Content after image failures", wrap: true },
    ];
  });
  add("blocked-missing-invalid-assets", assets, [issue("blocked-image", "$.body[1].columns[0].items[0].url")], {
    browserDiagnostics: ["blocked-image", "image-load-failed", "invalid-image", "blocked-image"]
      .map((code, index) => issue(code, `$.body[1].columns[${index}].items[0].url`)),
    contains: ["Content before image failures", "Content after image failures"],
  });
  add("diagnostics-truncated", variant(activity, (card) => {
    Object.assign(card.body[0], Object.fromEntries(Array.from({ length: 105 }, (_, index) => [`unknown${index}`, true])));
  }), [...Array.from({ length: 99 }, (_, index) => issue("unknown-property", `$.body[0].unknown${index}`)),
    issue("diagnostics-truncated", "$", "error")], { contains: ["diagnostics-truncated"], absent: ["Schema team"] });
  return cases;
}

export function compatibilityDiagnostics(diagnostics) {
  return diagnostics.map(({ code, path, severity, impact }) => ({ code, path, severity, impact }));
}

export function compatibilityOutputSignature(slide) {
  return {
    nativeTypes: slide.elements.filter((entry) => entry.adaptiveCard).reduce((counts, entry) => {
      counts[entry.type] = (counts[entry.type] || 0) + 1; return counts;
    }, {}),
    counts: [slide.adaptiveCards[0].nativeObjectCount,
      slide.adaptiveCards[0].conversions.filter((entry) => entry.mode === "approximated").length,
      slide.adaptiveCards[0].rasterizedSubtreeCount],
    conversions: slide.adaptiveCards[0].conversions.map(({ sourcePath, sourceType, mode, reason, nativeObjects }) =>
      [sourcePath, sourceType, mode, reason, nativeObjects]),
    fallbacks: slide.fallbacks.filter((entry) => entry.type === "adaptive-card")
      .map(({ sourcePath, reason, artwork }) => [sourcePath, reason, artwork !== false]),
  };
}

export async function assertCompatibilityOutput(cases, model) {
  const expected = JSON.parse(await readFile(join(CARD_COMPATIBILITY_DIRECTORY, "output-expectations.json"), "utf8"));
  assert.deepEqual(Object.keys(expected), cases.map((entry) => entry.name), "Corpus cases and exact output expectations drifted.");
  for (const [index, entry] of cases.entries()) {
    const slide = model.slides[index];
    assert.deepEqual(compatibilityOutputSignature(slide), expected[entry.name], `Actual PPTX model: ${entry.name}`);
    assert.equal(slide.adaptiveCards.length, 1);
    const card = slide.adaptiveCards[0];
    assert.equal(card.blockIndex, 0);
    assert.equal(card.status, entry.browser.status);
    assert.equal(card.complete, entry.static.complete);
    assert.equal(card.diagnosticsTruncated, !entry.static.complete);
    assert.equal(card.resourceValidation, card.status === "ready" ? "browser-checked" : "not-run");
    assert.deepEqual(compatibilityDiagnostics(card.diagnostics), entry.browser.diagnostics);
    for (const diagnostic of card.diagnostics) assert.equal(diagnostic.sourcePath, `adaptive-card[0]${diagnostic.path}`);
    for (const conversion of card.conversions) assert.equal(conversion.impact, conversion.mode === "native" ? "none" : "content");
    assert.equal(slide.elements.filter((item) => item.adaptiveCard).length, card.nativeObjectCount);
    assert.equal(slide.fallbacks.filter((item) => item.type === "adaptive-card" && item.artwork !== false).length, card.rasterizedSubtreeCount);
  }
}
