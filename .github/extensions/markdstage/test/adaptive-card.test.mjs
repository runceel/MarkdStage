import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAdaptiveCardSource, resolveCardImageUrl, MAX_CARD_JSON_BYTES, MAX_CARD_DEPTH, MAX_CARD_OBJECTS,
} from "../renderer/adaptive-card.mjs";
import { validateAdaptiveCardSource, MAX_CARD_DIAGNOSTICS } from "../renderer/adaptive-card-validation.mjs";
import { adaptiveCardValidationReport, validateLoadedDeck } from "../runtime/deck-validation.mjs";

const card = (body = []) => ({ type: "AdaptiveCard", version: "1.5", body });
const parse = (value) => parseAdaptiveCardSource(JSON.stringify(value));
const rejects = (value, code) => assert.throws(() => parse(value), (error) => error.code === code);

test("accepts only resolved, bounded schema 1.5 JSON and diagnoses unsupported mechanisms", () => {
  assert.deepEqual(parse(card()), card());
  assert.throws(() => parseAdaptiveCardSource("{"), (error) => error.code === "invalid-json");
  for (const version of [undefined, "1.4", "1.6", "2.0", 1.5]) rejects({ ...card(), version }, "unsupported-version");
  rejects(card([{ type: "Input.Custom", id: "input" }]), "unsupported-element");
  assert.deepEqual(parse({ ...card(), actions: [] }), { ...card(), actions: [] });
  const interactive = card([{ type: "Input.Text", id: "input" },
    { type: "Image", url: "assets/image.png", selectAction: { type: "Action.OpenUrl", url: "https://example.com" } }]);
  assert.deepEqual(parse(interactive), interactive);
  assert.deepEqual(validateAdaptiveCardSource(JSON.stringify(interactive)).diagnostics.map((entry) => entry.code), ["static-input", "static-link"]);
  rejects({ ...card(), refresh: {} }, "unsupported-interactivity");
  rejects({ ...card(), authentication: {} }, "unsupported-interactivity");
  rejects({ ...card(), actions: [{ type: "Action.Custom" }] }, "unsupported-action");
  rejects({ ...card(), fallback: "drop" }, "unsupported-fallback");
  rejects({ ...card(), requires: { unknown: "1.0" } }, "requires-not-met");
  rejects(card([{ type: "TextBlock", text: "${unresolved}" }]), "unresolved-template");
  rejects(card([{ type: "Container", $data: "rows", items: [] }]), "unresolved-template");
  rejects(card([{ type: "ImageSet", images: [{ url: "https://example.com/implicit.png" }] }]), "unsupported-element");
  rejects(card([{ type: "FactSet", facts: [{ title: "Missing value" }] }]), "invalid-fact");
});

test("static schema validates property types, required fields, collection roles and identities without an SDK", () => {
  for (const element of [
    { type: "TextBlock", text: 42 }, { type: "TextBlock", text: null },
    { type: "TextBlock", text: "x", wrap: "true" }, { type: "TextBlock", text: "x", size: "Huge" },
    { type: "Image", url: "assets/a.png", width: "-1px" },
    { type: "ColumnSet", columns: [{ type: "Column", width: 0, items: [] }] },
    { type: "Container", items: [], style: "unrecognized" },
    { type: "TextBlock", text: "x", requires: { adaptiveCards: true } },
  ]) rejects(card([element]), "invalid-property");
  rejects(card([{ type: "TextBlock" }]), "missing-property");
  rejects(card([{ type: "Column", items: [] }]), "unsupported-element");
  rejects(card([{ type: "Container", items: null }]), "invalid-collection");
  rejects(card([{ type: "Table", columns: [{ width: 1 }], rows: [{ type: "TableRow", cells: [] }] }]), "invalid-table");
  rejects(card([{ type: "TextBlock", id: "duplicate", text: "a" }, { type: "TextBlock", id: "duplicate", text: "b" }]), "duplicate-id");
  rejects(card([{ type: "TextBlock", text: "{{DATE(2020-01-01T00:00:00Z)}}" }]), "unresolved-template");
});

test("known requirements succeed; substitutions, drops and inherited fallback retain authored paths and content diagnostics", () => {
  const supported = card([{ type: "TextBlock", text: "yes", requires: { adaptiveCards: "1.5" } }]);
  assert.deepEqual(validateAdaptiveCardSource(JSON.stringify(supported)).diagnostics, []);
  const source = card([
    { type: "TextBlock", text: "drop", requires: { otherHost: "*" }, fallback: "drop" },
    { type: "Unknown", fallback: { type: "TextBlock", id: "fallback", text: "Retained" } },
    { type: "Container", items: [{ type: "Unknown" }], fallback: { type: "TextBlock", text: "Parent fallback" } },
  ]);
  const result = validateAdaptiveCardSource(JSON.stringify(source));
  assert.equal(result.valid, true);
  assert.deepEqual(result.card.body.map((item) => item.text), ["Retained", "Parent fallback"]);
  assert.equal(result.sourcePaths.get("$.body[0]"), "$.body[1].fallback");
  assert.equal(result.sourcePaths.get("$.body[1]"), "$.body[2].fallback");
  assert.ok(result.diagnostics.some((entry) => entry.code === "requires-not-met"));
  assert.ok(result.diagnostics.some((entry) => entry.code === "fallback-substituted"));
  assert.ok(result.diagnostics.some((entry) => entry.code === "fallback-dropped"));
  assert.ok(result.diagnostics.every((entry) => entry.severity === "warning" && entry.impact === "content"));
  rejects(card([{ type: "Unknown", fallback: { type: "Image", url: "assets/a.png", selectAction: {} } }]), "unsupported-element");
  rejects(card([{ type: "Unknown", fallback: { type: "Column", items: [] } }]), "unsupported-element");
  rejects(card([{ type: "TextBlock", text: "x", requires: [], fallback: "drop" }]), "invalid-property");
});

test("unknown custom properties are stripped and diagnosed rather than accepted as SDK semantics", () => {
  const result = validateAdaptiveCardSource(JSON.stringify(card([{ type: "TextBlock", text: "Safe", custom: { url: "https://blocked.example" } }])));
  assert.equal(result.valid, true);
  assert.equal(result.card.body[0].custom, undefined);
  assert.equal(result.diagnostics[0].code, "unknown-property");
  assert.equal(result.diagnostics[0].path, "$.body[0].custom");
  const many = validateAdaptiveCardSource(JSON.stringify(card([{
    type: "TextBlock", text: "x", ...Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`custom${index}`, true])),
  }])));
  assert.equal(many.valid, false);
  assert.equal(many.complete, false);
  assert.equal(many.truncated, true);
  assert.equal(many.diagnostics.length, MAX_CARD_DIAGNOSTICS);
  assert.equal(many.diagnostics.at(-1).code, "diagnostics-truncated");
});

test("CLI/deck validation surfaces card errors, content warnings and block source locations without a browser", () => {
  const fence = (value) => `\`\`\`adaptive-card\n${typeof value === "string" ? value : JSON.stringify(value)}\n\`\`\``;
  const source = [
    fence(card([{ type: "TextBlock", text: 42 }])),
    fence({ ...card(), version: "1.6" }),
    fence(card([{ type: "Unknown", fallback: { type: "Image", url: "https://blocked.example/image.png" } }])),
    fence("{"),
  ].join("\n\n");
  const report = validateLoadedDeck({ slides: [source], sourceName: "cards.md", theme: "dark" });
  assert.equal(report.valid, false);
  assert.equal(report.errors.length, 3);
  assert.equal(report.adaptiveCards.blocks.length, 4);
  const issue = report.diagnostics.find((entry) => entry.code === "invalid-property");
  assert.equal(issue.file, "cards.md");
  assert.equal(issue.sourcePath, "adaptive-card[0]$.body[0].text");
  assert.equal(issue.page, 1);
  assert.equal(issue.openLine, 1);
  assert.equal(issue.impact, "content");
  assert.ok(report.diagnostics.some((entry) => entry.code === "fallback-substituted"));
  assert.ok(report.diagnostics.some((entry) => entry.code === "blocked-image"));
  assert.equal(report.adaptiveCards.resourceValidation, "deferred-to-browser");
  const unclosed = adaptiveCardValidationReport(["~~~ADAPTIVE-CARD\n" + JSON.stringify(card())]);
  assert.equal(unclosed.valid, false);
  assert.equal(unclosed.diagnostics.at(-1).code, "unclosed-adaptive-card-fence");
  assert.deepEqual(adaptiveCardValidationReport(["````markdown\n" + fence("{") + "\n````"]).blocks, []);
});

test("enforces exact UTF-8 byte, depth and object ceilings before SDK work", () => {
  const minimal = JSON.stringify(card());
  assert.deepEqual(parseAdaptiveCardSource(minimal + " ".repeat(MAX_CARD_JSON_BYTES - minimal.length)), card());
  assert.throws(() => parseAdaptiveCardSource(minimal + " ".repeat(MAX_CARD_JSON_BYTES)), (error) => error.code === "card-size-limit");
  assert.throws(() => parseAdaptiveCardSource(JSON.stringify(card([{ type: "TextBlock", text: "界".repeat(MAX_CARD_JSON_BYTES / 2) }]))), (error) => error.code === "card-size-limit");
  const many = card(Array.from({ length: MAX_CARD_OBJECTS }, () => ({ type: "TextBlock", text: "x" })));
  rejects(many, "card-object-limit");
  const boundaryObjects = card(Array.from({ length: MAX_CARD_OBJECTS - 2 }, () => ({ type: "TextBlock", text: "x" })));
  assert.deepEqual(parse(boundaryObjects), boundaryObjects);
  boundaryObjects.body.push({ type: "TextBlock", text: "one too many" });
  rejects(boundaryObjects, "card-object-limit");
  let nested = { type: "TextBlock", text: "leaf" };
  for (let index = 0; index < MAX_CARD_DEPTH / 2 - 2; index++) nested = { type: "Container", items: [nested] };
  assert.deepEqual(parse(card([nested])), card([nested]));
  nested = { type: "Container", items: [nested] };
  rejects(card([nested]), "card-depth-limit");
});

test("only approved same-origin assets and bounded data images survive URL preflight", () => {
  const base = "http://127.0.0.1:45000/scope/";
  for (const source of ["assets/card.png", "/assets/card.png", `${base}assets/card.png`]) {
    assert.equal(resolveCardImageUrl(source, base), `${base}assets/card.png`);
  }
  for (const source of [
    "https://example.com/card.png", "//example.com/card.png", "file:///C:/card.png", "javascript:alert(1)",
    "blob:http://127.0.0.1/id", "assets/../card.png", "assets/%2e%2e/card.png", "assets/%252e%252e/card.png",
    "assets/a%2f..%2fcard.png", "assets\\card.png", "/other/card.png", `${base}state`,
    "assets/card.svg#fragment", "assets/card.png?url=https://example.com", "data:text/html;base64,WA==",
    "data:image/png;base64,?", "assets/card.webp",
  ]) {
    assert.throws(() => resolveCardImageUrl(source, base), undefined, source);
  }
  const data = "data:image/png;base64,iVBORw0KGgo=";
  assert.equal(resolveCardImageUrl(data, base), data);
});
