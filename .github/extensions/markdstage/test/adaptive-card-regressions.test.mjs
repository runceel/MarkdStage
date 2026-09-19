import assert from "node:assert/strict";
import test from "node:test";
import { buildDeckSlides } from "../markdown-deck.mjs";
import { validateLoadedDeck } from "../runtime/deck-validation.mjs";
import { validateAdaptiveCardSource } from "../renderer/adaptive-card-validation.mjs";
import { cardMarkdownCases, fatalFallbackCases } from "../../../../test/harness/adaptive-card-regressions.mjs";

for (const entry of fatalFallbackCases()) {
  test(`fatal structure cannot be rescued: ${entry.name}`, () => {
    const result = validateAdaptiveCardSource(JSON.stringify(entry.card));
    assert.equal(result.valid, false);
    assert.equal(result.card, null);
    assert.deepEqual(result.diagnostics.map(({ code, path, severity }) => ({ code, path, severity })),
      [{ code: entry.code, path: entry.path, severity: "error" }]);
  });
}

for (const entry of cardMarkdownCases()) {
  test(`canonical deck builder and validation use rendered Markdown semantics: ${entry.name}`, () => {
    const slides = buildDeckSlides(entry.markdown);
    const report = validateLoadedDeck({ slides, sourceName: "cards.md" });
    assert.equal(report.valid, !entry.states.includes("error"));
    assert.equal(report.complete, true);
    assert.equal(report.adaptiveCards.blocks.length, entry.states.length);
    assert.deepEqual(report.adaptiveCards.diagnostics.map((diagnostic) => diagnostic.code), entry.codes);
    for (const block of report.adaptiveCards.blocks) {
      assert.match(block.markdownPath, /^tokens\[/);
      assert.equal(block.lineBasis, "visible-markdown-body");
    }
    if (entry.name === "mixed fences and multiple containers") {
      assert.equal(report.adaptiveCards.diagnostics[0].blockIndex, 2);
      assert.equal(report.adaptiveCards.diagnostics[0].sourcePath, "adaptive-card[2]$.body[0].text");
    }
  });
}

const card = (body = [], actions) => ({ type: "AdaptiveCard", version: "1.5", body, ...(actions ? { actions } : {}) });
const validation = (value) => validateAdaptiveCardSource(JSON.stringify(value));
const fatal = (value, code, path) => {
  const result = validation(value);
  assert.equal(result.valid, false);
  assert.equal(result.card, null);
  assert.deepEqual(result.diagnostics.map(({ code, path, severity }) => ({ code, path, severity })), [{ code, path, severity: "error" }]);
};

for (const [name, element, field] of [
  ["text maxLength type", { type: "Input.Text", id: "x", maxLength: "20" }, "maxLength"],
  ["text maxLength negative", { type: "Input.Text", id: "x", maxLength: -1 }, "maxLength"],
  ["text maxLength fraction", { type: "Input.Text", id: "x", maxLength: 1.5 }, "maxLength"],
  ["text maxLength unsafe integer", { type: "Input.Text", id: "x", maxLength: Number.MAX_SAFE_INTEGER + 1 }, "maxLength"],
  ["text value", { type: "Input.Text", id: "x", value: 1 }, "value"],
  ["text placeholder", { type: "Input.Text", id: "x", placeholder: [] }, "placeholder"],
  ["text multiline", { type: "Input.Text", id: "x", isMultiline: "true" }, "isMultiline"],
  ["text regex", { type: "Input.Text", id: "x", regex: {} }, "regex"],
  ["text style", { type: "Input.Text", id: "x", style: "search" }, "style"],
  ["input id", { type: "Input.Text", id: "" }, "id"],
  ["input label", { type: "Input.Text", id: "x", label: false }, "label"],
  ["input required flag", { type: "Input.Text", id: "x", isRequired: 1 }, "isRequired"],
  ["input error message", { type: "Input.Text", id: "x", errorMessage: [] }, "errorMessage"],
  ["number initial value", { type: "Input.Number", id: "x", value: "12" }, "value"],
  ["number minimum", { type: "Input.Number", id: "x", min: "0" }, "min"],
  ["number maximum", { type: "Input.Number", id: "x", max: null }, "max"],
  ["date initial value", { type: "Input.Date", id: "x", value: 20260919 }, "value"],
  ["date invalid day", { type: "Input.Date", id: "x", value: "2026-02-30" }, "value"],
  ["date minimum", { type: "Input.Date", id: "x", min: "yesterday" }, "min"],
  ["date maximum", { type: "Input.Date", id: "x", max: "2026-13-01" }, "max"],
  ["time value", { type: "Input.Time", id: "x", value: "24:00" }, "value"],
  ["time minimum", { type: "Input.Time", id: "x", min: 0 }, "min"],
  ["time maximum", { type: "Input.Time", id: "x", max: "01:60" }, "max"],
  ["toggle title", { type: "Input.Toggle", id: "x", title: 1 }, "title"],
  ["toggle initial value", { type: "Input.Toggle", id: "x", title: "Toggle", value: true }, "value"],
  ["toggle valueOn", { type: "Input.Toggle", id: "x", title: "Toggle", valueOn: true }, "valueOn"],
  ["toggle valueOff", { type: "Input.Toggle", id: "x", title: "Toggle", valueOff: false }, "valueOff"],
  ["toggle wrap", { type: "Input.Toggle", id: "x", title: "Toggle", wrap: "true" }, "wrap"],
  ["choice value", { type: "Input.ChoiceSet", id: "x", choices: [], value: ["a"] }, "value"],
  ["choice style", { type: "Input.ChoiceSet", id: "x", choices: [], style: "other" }, "style"],
  ["choice multiple selection", { type: "Input.ChoiceSet", id: "x", choices: [], isMultiSelect: 1 }, "isMultiSelect"],
  ["choice wrap", { type: "Input.ChoiceSet", id: "x", choices: [], wrap: "false" }, "wrap"],
  ["media poster", { type: "Media", sources: [], poster: 1 }, "poster"],
  ["media alt text", { type: "Media", sources: [], altText: [] }, "altText"],
  ["action set orientation", { type: "ActionSet", actions: [], orientation: "diagonal" }, "orientation"],
]) {
  test(`static interactive property cannot be rescued by requires/fallback: ${name}`, () => {
    fatal(card([{ ...element, requires: { otherHost: "*" }, fallback: { type: "TextBlock", text: "Replacement" } }]),
      "invalid-property", `$.body[0].${field}`);
  });
}

for (const [name, action, field] of [
  ["URL", { type: "Action.OpenUrl", url: 42 }, "url"],
  ["empty URL", { type: "Action.OpenUrl", url: "" }, "url"],
  ["title", { type: "Action.Submit", title: {} }, "title"],
  ["icon URL", { type: "Action.Submit", iconUrl: true }, "iconUrl"],
  ["style", { type: "Action.Submit", style: "emphasis" }, "style"],
  ["mode", { type: "Action.Submit", mode: "tertiary" }, "mode"],
  ["tooltip", { type: "Action.Submit", tooltip: 42 }, "tooltip"],
  ["enabled", { type: "Action.Submit", isEnabled: "true" }, "isEnabled"],
  ["submit data", { type: "Action.Submit", data: [1, 2] }, "data"],
  ["execute data", { type: "Action.Execute", data: false }, "data"],
  ["associated inputs", { type: "Action.Submit", associatedInputs: "all" }, "associatedInputs"],
  ["execute verb", { type: "Action.Execute", verb: 42 }, "verb"],
  ["complete requires", { type: "Action.Submit", requires: { otherHost: "*", adaptiveCards: false } }, "requires.adaptiveCards"],
]) {
  test(`all action properties are validated before action resolution: ${name}`, () => {
    fatal(card([], [{ requires: { otherHost: "*" }, ...action, fallback: "drop" }]), "invalid-property", `$.actions[0].${field}`);
  });
}

test("complete embedded ShowCard, action arrays and unused fallback structures are checked before resolution", () => {
  fatal(card([{ type: "ActionSet", actions: {}, requires: { otherHost: "*" }, fallback: "drop" }]), "invalid-collection", "$.body[0].actions");
  fatal({ ...card(), actions: null }, "invalid-collection", "$.actions");
  fatal(card([{ type: "Input.ChoiceSet", id: "x", choices: {} }]), "invalid-collection", "$.body[0].choices");
  fatal(card([{ type: "Input.ChoiceSet", id: "x", choices: [{ title: "Choice", value: 42 }] }]),
    "invalid-property", "$.body[0].choices[0].value");
  fatal(card([{ type: "Input.ChoiceSet", id: "x", choices: [{ value: "choice" }] }]),
    "missing-property", "$.body[0].choices[0].title");
  fatal(card([{ type: "Media", sources: {} }]), "invalid-collection", "$.body[0].sources");
  fatal(card([{ type: "Media", sources: [{ mimeType: 42, url: "https://example.com/video" }] }]),
    "invalid-property", "$.body[0].sources[0].mimeType");
  fatal(card([{ type: "Media", sources: [{ mimeType: "video/mp4" }] }]), "missing-property", "$.body[0].sources[0].url");
  fatal(card([], [{ type: "Action.ShowCard", card: [] }]), "invalid-element", "$.actions[0].card");
  fatal(card([], [{ type: "Action.ShowCard", card: { type: "AdaptiveCard", body: null }, fallback: "drop" }]),
    "invalid-collection", "$.actions[0].card.body");
  fatal(card([], [{ type: "Action.ShowCard", requires: { otherHost: "*" }, fallback: "drop",
    card: { type: "AdaptiveCard", body: [{ type: "Input.Number", id: "hidden", value: "bad" }] } }]),
  "invalid-property", "$.actions[0].card.body[0].value");
  fatal(card([{ type: "TextBlock", text: "Visible", fallback: { type: "Input.Text", id: "hidden", maxLength: "bad" } }]),
    "invalid-property", "$.body[0].fallback.maxLength");
  fatal(card([], [{ type: "Action.Submit", fallback: { type: "Action.ShowCard",
    card: { type: "AdaptiveCard", actions: [{ type: "Action.OpenUrl", url: 1 }] } } }]),
  "invalid-property", "$.actions[0].fallback.card.actions[0].url");
  fatal(card([{ type: "ActionSet", actions: [{ type: "Action.Custom" }, { type: "Action.OpenUrl", url: 42 }],
    fallback: { type: "TextBlock", text: "Replacement" } }]), "invalid-property", "$.body[0].actions[1].url");
  fatal(card([{ type: "Input.Text", id: "inline", inlineAction: null, fallback: "drop" }]), "invalid-element", "$.body[0].inlineAction");
});

test("schema role boundaries remain closed even when the SDK exposes broader APIs", () => {
  fatal(card([{ type: "Container", items: [], actions: [] }]), "unsupported-interactivity", "$.body[0].actions");
  fatal(card([{ type: "TextBlock", text: "Text", selectAction: { type: "Action.Submit" } }]),
    "unsupported-interactivity", "$.body[0].selectAction");
  fatal(card([{ type: "Input.Number", id: "x", inlineAction: { type: "Action.Submit" } }]),
    "unsupported-interactivity", "$.body[0].inlineAction");
  for (const value of [
    { type: "Image", url: "assets/a.png", selectAction: { type: "Action.ShowCard", card: card() } },
    { type: "Input.Text", id: "x", inlineAction: { type: "Action.ShowCard", card: card() } },
    { type: "RichTextBlock", inlines: [{ type: "TextRun", text: "Text", selectAction: { type: "Action.ShowCard", card: card() } }] },
  ]) {
    const result = validation(card([value]));
    assert.equal(result.valid, false);
    assert.equal(result.diagnostics[0].code, "unsupported-action");
  }
  fatal(card([{ type: "Action.Submit", title: "Not a body element" }]), "unsupported-action", "$.body[0]");
  fatal(card([], [{ type: "TextBlock", text: "Not an action" }]), "unsupported-element", "$.actions[0]");
});

test("refresh, authentication, custom host protocols and card-root resource/fallback features stay fatal in collapsed branches", () => {
  for (const [property, value, code] of [
    ["refresh", {}, "unsupported-interactivity"], ["authentication", {}, "unsupported-interactivity"],
    ["backgroundImage", "https://blocked.example/a.png", "unsupported-resource"],
    ["fallbackText", "Fallback", "unsupported-fallback"], ["fallback", "drop", "unsupported-fallback"],
  ]) {
    fatal(card([], [{ type: "Action.ShowCard", card: { ...card(), [property]: value }, requires: { otherHost: "*" }, fallback: "drop" }]),
      code, `$.actions[0].card.${property}`);
  }
  fatal(card([], [{ type: "Action.OpenUrl", url: "msteams://host/action", requires: { otherHost: "*" }, fallback: "drop" }]),
    "unsupported-protocol", "$.actions[0].url");
  fatal(card([], [{ type: "Action.Submit", fallback: { type: "Action.OpenUrl", url: "custom-host:command" } }]),
    "unsupported-protocol", "$.actions[0].fallback.url");
  fatal(card([{ type: "Media", sources: [{ mimeType: "video/mp4", url: "custom-player:video" }], fallback: "drop" }]),
    "unsupported-protocol", "$.body[0].sources[0].url");
  fatal(card([{ type: "Input.ChoiceSet", id: "dynamic", choices: [], "choices.data": {} }]),
    "unsupported-interactivity", "$.body[0].choices.data");
});

test("custom actions need authored fallbacks and preserve action paths instead of disappearing silently", () => {
  fatal(card([], [{ type: "Action.Custom" }]), "unsupported-action", "$.actions[0]");
  fatal(card([{ type: "ActionSet", actions: [{ type: "Action.ToggleVisibility", targetElements: ["id"] }] }]),
    "unsupported-action", "$.body[0].actions[0]");
  fatal(card([], [{ type: "Action.ShowCard", card: card([], [{ type: "Action.Custom" }]) }]),
    "unsupported-action", "$.actions[0].card.actions[0]");
  const result = validation(card([], [
    { type: "Action.Custom", fallback: "drop" },
    { type: "Action.Custom", fallback: { type: "Action.Submit", title: "Retained", id: "submit" } },
  ]));
  assert.equal(result.valid, true);
  assert.equal(result.card.actions.length, 1);
  assert.equal(result.sourcePaths.get("$.actions[0]"), "$.actions[1].fallback");
  assert.equal(result.sourcePaths.get("$.actions[0].title"), "$.actions[1].fallback.title");
  assert.ok(result.diagnostics.some((entry) => entry.code === "fallback-dropped" && entry.path === "$.actions[0].fallback"));
  assert.ok(result.diagnostics.some((entry) => entry.code === "static-action" && entry.path === "$.actions[1].fallback"));
  assert.ok(result.diagnostics.every((entry) => entry.impact === "content"));
  fatal(card([], [{ type: "CustomHostAction", title: 42, fallback: "drop" }]), "invalid-property", "$.actions[0].title");
  const inheritedName = validation(card([{ type: "constructor", name: "Custom", fallback: { type: "TextBlock", text: "Replacement" } }]));
  assert.equal(inheritedName.valid, true);
  assert.equal(inheritedName.card.body[0].text, "Replacement");
});

test("identity checks include retained actions and embedded cards without confusing opaque action data for elements", () => {
  const duplicate = validation(card([{ type: "TextBlock", id: "same", text: "Text" }],
    [{ type: "Action.Submit", id: "same", title: "Submit" }]));
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.diagnostics.some((entry) => entry.code === "duplicate-id" && entry.path === "$.actions[0].id"));
  const embedded = validation(card([{ type: "TextBlock", id: "same", text: "Text" }],
    [{ type: "Action.ShowCard", card: card([{ type: "Input.Text", id: "same" }]) }]));
  assert.equal(embedded.valid, false);
  assert.ok(embedded.diagnostics.some((entry) => entry.code === "duplicate-id" && entry.path === "$.actions[0].card.body[0].id"));
  assert.equal(validation(card([{ type: "TextBlock", id: "same", text: "Text" }],
    [{ type: "Action.Submit", data: { type: "TextBlock", id: "same", text: 42 } }])).valid, true);
});

test("duplicate ids in unused or dropped content are malformed, but mutually exclusive replacements may retain an authored id", () => {
  fatal(card([
    { type: "Input.Text", id: "same", requires: { otherHost: "*" }, fallback: "drop" },
    { type: "TextBlock", id: "same", text: "Sibling" },
  ]), "duplicate-id", "$.body[1].id");
  fatal(card([{ type: "TextBlock", text: "Visible", fallback: { type: "Container", items: [
    { type: "Input.Text", id: "duplicate" }, { type: "Input.Text", id: "duplicate" },
  ] } }]), "duplicate-id", "$.body[0].fallback.items[1].id");
  const replacement = validation(card([{ type: "Input.Text", id: "retained", requires: { otherHost: "*" },
    fallback: { type: "TextBlock", id: "retained", text: "Replacement" } }]));
  assert.equal(replacement.valid, true);
  assert.equal(replacement.card.body[0].id, "retained");
  assert.equal(replacement.sourcePaths.get("$.body[0]"), "$.body[0].fallback");
});
