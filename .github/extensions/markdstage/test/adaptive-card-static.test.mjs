import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import { reconstructAsset } from "../scripts/vendor-assets.mjs";
import { validateAdaptiveCardSource, isAllowedCardHref, MAX_CARD_DEPTH } from "../renderer/adaptive-card-validation.mjs";
import {
  projectAdaptiveCardStatic, MAX_STATIC_CARD_OBJECTS, MAX_STATIC_CARD_DEPTH,
} from "../renderer/adaptive-card-static.mjs";

const sdkSource = await reconstructAsset(
  fileURLToPath(new URL("../vendor/", import.meta.url)), "adaptivecards.min.js",
  fileURLToPath(new URL("../vendor/vendor-assets.lock.json", import.meta.url)),
);
const noSideEffects = () => assert.fail("Static projection must not render, execute actions, or use the network.");
const sandbox = { console, setTimeout: noSideEffects, clearTimeout: noSideEffects, fetch: noSideEffects };
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.runInNewContext(sdkSource.toString(), sandbox, { filename: "adaptivecards.min.js", timeout: 5_000 });
const SDK = sandbox.AdaptiveCards;
SDK.AdaptiveCard.onExecuteAction = noSideEffects;
SDK.AdaptiveCard.onProcessMarkdown = noSideEffects;
SDK.AdaptiveCard.prototype.render = noSideEffects;
SDK.Action.prototype.execute = noSideEffects;
Object.defineProperty(sandbox, "document", { get: noSideEffects });

const card = (body = [], actions) => ({ type: "AdaptiveCard", version: "1.5", body, ...(actions ? { actions } : {}) });
const plain = (value) => JSON.parse(JSON.stringify(value));
const visit = (value, callback, path = "$", depth = 0) => {
  callback(value, path, depth);
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) visit(child, callback,
    Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`, depth + 1);
};
const texts = (json) => {
  const result = [];
  visit(json, (value) => { if (value?.type === "TextRun") result.push(value.text); });
  return result;
};
const parseSdk = (json) => {
  const parsed = new SDK.AdaptiveCard();
  parsed.hostConfig = new SDK.HostConfig({ supportsInteractivity: false, actions: { maxActions: 0 }, media: { allowInlinePlayback: false } });
  const context = new SDK.SerializationContext(SDK.Versions.v1_5);
  parsed.parse(json, context);
  assert.equal(context.eventCount, 0, Array.from({ length: context.eventCount }, (_, index) => context.getEventAt(index).message).join("\n"));
  return parsed;
};
const project = (value) => {
  const validated = validateAdaptiveCardSource(JSON.stringify(value));
  assert.equal(validated.valid, true, JSON.stringify(validated.diagnostics));
  const original = parseSdk(validated.card);
  const before = plain(original.toJSON());
  const result = projectAdaptiveCardStatic(original, SDK, validated.sourcePaths);
  assert.deepEqual(plain(original.toJSON()), before);
  assert.equal(original.hostConfig.supportsInteractivity, false);
  const projected = parseSdk(result.json);
  assert.equal(projected.validateProperties().validationEvents.length, 0);
  assert.equal(projected.hostConfig.supportsInteractivity, false);
  const nodes = new Map();
  let count = 0;
  visit(result.json, (node, path, depth) => {
    nodes.set(path, node);
    assert.ok(result.sourcePaths.has(path), path);
    assert.ok(depth <= MAX_STATIC_CARD_DEPTH);
    if (!node || typeof node !== "object") return;
    count++;
    if (node.type) assert.doesNotMatch(node.type, /^(?:Input\.|Action\.|ActionSet$|Media$)/);
    for (const key of ["actions", "selectAction", "inlineAction", "refresh", "authentication", "sources", "card", "href"]) {
      assert.equal(Object.hasOwn(node, key), false, `${path}.${key}`);
    }
  });
  assert.ok(count <= MAX_STATIC_CARD_OBJECTS);
  for (const [path, provenance] of result.provenance) {
    assert.ok(nodes.has(path), path);
    assert.deepEqual(plain(provenance), provenance);
    assert.ok(["static-input", "static-action", "static-media", "static-link"].includes(provenance.treatment));
    assert.equal(typeof provenance.type, "string");
    assert.equal(typeof provenance.sourcePath, "string");
    if (provenance.href) assert.equal(isAllowedCardHref(provenance.href), true);
  }
  return { ...result, validated, original, projected };
};

test("all supported SDK inputs project authored initial values or placeholders, never live control values", () => {
  const result = project(card([
    { type: "Input.Text", id: "text", label: "Name", value: "Ada", maxLength: 50, regex: ".*" },
    { type: "Input.Text", id: "placeholder", placeholder: "Enter a name", maxLength: 0, isMultiline: true },
    { type: "Input.Number", id: "number", value: 0, min: -10, max: 10 },
    { type: "Input.Number", id: "empty-number", placeholder: "Enter a number" },
    { type: "Input.Date", id: "date", value: "2026-09-19", min: "2026-01-01", max: "2026-12-31" },
    { type: "Input.Time", id: "time", value: "08:47", min: "00:00", max: "23:59" },
    { type: "Input.Toggle", id: "toggle", title: "Enabled", value: "yes", valueOn: "yes", valueOff: "no" },
    { type: "Input.Toggle", id: "off", title: "Disabled" },
    { type: "Input.ChoiceSet", id: "multi", isMultiSelect: true, value: "b,a,unknown",
      choices: [{ title: "Choice A", value: "a" }, { title: "Choice B", value: "b" }], style: "expanded" },
    { type: "Input.ChoiceSet", id: "empty-choice", choices: [], placeholder: "Choose an item", style: "filtered" },
    { type: "Input.Text", id: "password", style: "password", value: "secret" },
  ]));
  const output = texts(result.json);
  for (const expected of ["Name (non-interactive)", "Ada", "Enter a name", "0", "Enter a number", "2026-09-19", "08:47",
    "On: yes", "Off: false", "Choice A", "Choice B", "unknown", "Choose an item", "••••••"]) assert.ok(output.includes(expected), expected);
  assert.equal(output.includes("secret"), false);
  assert.equal(result.sourcePaths.get("$.body[0].items[1].inlines[0]"), "$.body[0].value");
  assert.equal(result.sourcePaths.get("$.body[0].items[1].inlines[0].text"), "$.body[0].value");
  assert.equal(result.sourcePaths.get("$.body[1].items[1]"), "$.body[1].placeholder");
  assert.equal(result.sourcePaths.get("$.body[8].items[1].inlines[0]"), "$.body[8].choices[1].title");
  assert.equal(result.sourcePaths.get("$.body[8].items[1].inlines[2]"), "$.body[8].choices[0].title");
  assert.equal(result.provenance.get("$.body[2]").type, "Input.Number");
  assert.equal(result.validated.diagnostics.filter((entry) => entry.code === "static-input").length, 11);
});

test("root, ActionSet and inline actions become static labels; ShowCard is always collapsed", () => {
  const result = project(card([
    { type: "Input.Text", id: "inline", value: "value",
      inlineAction: { type: "Action.Submit", id: "inline-action", title: "Find", data: { command: "ignored" } } },
    { type: "ActionSet", id: "actions", orientation: "horizontal", actions: [
      { type: "Action.Submit", title: "Submit", data: { a: 1 }, associatedInputs: "none" },
      { type: "Action.Execute", title: "Execute", verb: "command", data: "opaque", isEnabled: false },
      { type: "Action.ShowCard", title: "Details", card: { type: "AdaptiveCard", body: [
        { type: "TextBlock", text: "Embedded contents must never be rendered" },
        { type: "Input.Text", id: "hidden-input", value: "Hidden initial value" },
      ] } },
    ] },
  ], [{ type: "Action.OpenUrl", id: "open", title: "Reference", url: "https://example.com/reference?q=1#section" }]));
  const output = texts(result.json);
  for (const label of ["Find", "Submit", "Execute", "Details", "Show card (collapsed; non-interactive)", "Reference"]) {
    assert.ok(output.includes(label), label);
  }
  assert.ok(output.includes("Disabled action (non-interactive)"));
  assert.equal(output.includes("Embedded contents must never be rendered"), false);
  assert.equal(output.includes("Hidden initial value"), false);
  assert.equal(result.sourcePaths.get("$.body[0].items[2]"), "$.body[0].inlineAction");
  assert.equal(result.sourcePaths.get("$.body[2]"), "$.actions[0]");
  assert.deepEqual(result.provenance.get("$.body[2].items[0].inlines[0]"), {
    type: "Action.OpenUrl", sourcePath: "$.actions[0].title", treatment: "static-link",
    href: "https://example.com/reference?q=1#section", actionSourcePath: "$.actions[0]",
  });
  const ids = [];
  visit(result.json, (node) => { if (node?.id) ids.push(node.id); });
  assert.deepEqual(ids, ["inline", "inline-action", "actions", "open"]);
});

test("plain TextRun labels cannot introduce Markdown links, HTML, images, or submission payloads", () => {
  const hostile = "[click](javascript:alert(1)) ![image](https://blocked.example/a.png) <img src=x onerror=alert(1)>";
  const result = project(card([
    { type: "Input.Text", id: "text", label: hostile, value: hostile },
    { type: "Input.Text", id: "empty", placeholder: hostile },
    { type: "Input.ChoiceSet", id: "choice", value: "x", choices: [{ title: hostile, value: "x" }] },
  ], [
    { type: "Action.Submit", title: hostile, data: { sensitive: "PAYLOAD_NOT_EXPORTED" } },
    { type: "Action.OpenUrl", title: hostile, url: "javascript:alert(1)" },
  ]));
  assert.ok(texts(result.json).filter((text) => text === hostile).length >= 5);
  assert.doesNotMatch(JSON.stringify(result.json), /PAYLOAD_NOT_EXPORTED/);
  assert.equal([...result.provenance.values()].some((entry) => entry.href), false);
  assert.ok(result.validated.diagnostics.some((entry) => entry.code === "blocked-link" && entry.path === "$.actions[1].url"));
  visit(result.json, (node) => { assert.notEqual(node?.type, "TextBlock"); });
});

test("link preflight is a strict syntactic subset of pinned rendered links and never exports unsafe or disabled hrefs", async () => {
  const purifier = await readFile(new URL("../vendor/purify.min.js", import.meta.url), "utf8");
  const marker = purifier.indexOf("mailto|tel|callto|sms|cid|xmpp");
  assert.ok(marker > 0);
  const start = purifier.lastIndexOf("/", marker);
  const end = purifier.indexOf("/i", marker);
  const renderedLinkPolicy = new RegExp(purifier.slice(start + 1, end), "i");
  const safe = ["https://example.com/page?query=1#anchor", "http://example.com", "mailto:someone@example.com",
    "mailto:someone@example.com?subject=Hello", "tel:+15550100", "HTTPS://example.com/reference"];
  const unsupported = ["ftp://example.com/file", "ftps://example.com/file", "sms:+15550100", "callto:+15550100",
    "cid:part@example.com", "xmpp:user@example.com", "/relative/page", "../page", "#anchor", "//example.com/page"];
  const unsafe = ["javascript:alert(1)", "vbscript:message()", "data:text/html,hello", "file:///C:/secret", "blob:https://example.com/id",
    "https://", "https:///example.com", "https:example.com", "http://[invalid", "mailto:", "mailto:?subject=Hello", "tel:"];
  for (const value of safe) {
    assert.equal(isAllowedCardHref(value), true, value);
    assert.equal(renderedLinkPolicy.test(value), true, value);
  }
  for (const value of unsupported) {
    assert.equal(isAllowedCardHref(value), false, value);
    assert.equal(renderedLinkPolicy.test(value), true, value);
  }
  for (const value of [...unsafe, "", null, 42, {}, "javascript:\nalert(1)", "\u0000https://example.com", "https://example.com/ space",
    "https://example.com/<script>", "https:\\\\example.com"]) assert.equal(isAllowedCardHref(value), false, String(value));
  const result = project(card([], [
    ...safe.map((url, index) => ({ type: "Action.OpenUrl", title: `Safe ${index}`, url })),
    ...unsupported.map((url, index) => ({ type: "Action.OpenUrl", title: `Unsupported ${index}`, url })),
    ...unsafe.map((url, index) => ({ type: "Action.OpenUrl", title: `Unsafe ${index}`, url })),
    { type: "Action.OpenUrl", title: "Control character", url: "https://example.com/\npath" },
    { type: "Action.OpenUrl", title: "Disabled", url: "https://example.com", isEnabled: false },
  ]));
  assert.deepEqual([...result.provenance.values()].flatMap((entry) => entry.href ? [entry.href] : []), safe);
  assert.equal(result.validated.diagnostics.filter((entry) => entry.code === "blocked-link").length, unsafe.length + unsupported.length + 1);
});

test("media exposes only poster Images to the existing image gate, never sources or playback", () => {
  const result = project(card([
    { type: "Media", id: "media", poster: "assets/poster.png", altText: "Recorded session",
      sources: [{ mimeType: "video/mp4", url: "https://blocked.example/NEVER_FETCH_MEDIA.mp4" }] },
    { type: "Media", sources: [{ mimeType: "audio/mpeg", url: "https://blocked.example/NEVER_FETCH_AUDIO.mp3" }] },
    { type: "Media", poster: "https://blocked.example/poster.png", sources: [] },
  ]));
  assert.deepEqual(result.json.body[0].items[0], { type: "Image", url: "assets/poster.png", altText: "Recorded session" });
  assert.equal(result.sourcePaths.get("$.body[0].items[0]"), "$.body[0].poster");
  assert.equal(result.sourcePaths.get("$.body[0].items[0].url"), "$.body[0].poster");
  assert.equal(result.json.body[1].items.some((item) => item.type === "Image"), false);
  assert.doesNotMatch(JSON.stringify(result.json), /NEVER_FETCH/);
  assert.ok(texts(result.json).includes("Media: Recorded session (non-interactive)"));
  assert.ok(result.validated.diagnostics.some((entry) => entry.code === "blocked-image" && entry.path === "$.body[2].poster"));
  assert.equal(result.validated.diagnostics.filter((entry) => entry.code === "static-media").length, 3);
});

test("fallback substitution, dropped actions/inlines, shorthand text and typed selectAction preserve authored paths", () => {
  const result = project(card([
    { type: "Custom", fallback: "drop" },
    { type: "Custom", fallback: { type: "Input.Text", id: "replacement", value: "Retained" } },
    { type: "RichTextBlock", inlines: [
      { type: "Custom", fallback: "drop" }, "Unshifted shorthand",
      { type: "TextRun", id: "run", text: "Linked text", selectAction: {
        type: "Action.Custom", fallback: { type: "Action.OpenUrl", url: "https://example.com/run" },
      } },
    ] },
    { type: "Image", url: "assets/picture.png", selectAction: { type: "Action.OpenUrl", title: "Invisible title", url: "https://example.com/image" } },
    { type: "Container", items: [{ type: "TextBlock", text: "Do not append a button" }],
      selectAction: { type: "Action.Submit", title: "Invisible submit" } },
  ], [
    { type: "Action.Custom", fallback: "drop" },
    { type: "Action.Custom", fallback: { type: "Action.OpenUrl", title: "Fallback action", url: "https://example.com/action" } },
  ]));
  assert.equal(result.sourcePaths.get("$.body[0]"), "$.body[1].fallback");
  assert.equal(result.sourcePaths.get("$.body[0].items[1].inlines[0]"), "$.body[1].fallback.value");
  assert.equal(result.sourcePaths.get("$.body[1].inlines[0]"), "$.body[2].inlines[1]");
  assert.equal(result.sourcePaths.get("$.body[1].inlines[0].text"), "$.body[2].inlines[1]");
  assert.equal(result.sourcePaths.get("$.body[1].inlines[1]"), "$.body[2].inlines[2]");
  assert.equal(result.provenance.get("$.body[1].inlines[1]").href, "https://example.com/run");
  assert.equal(result.provenance.get("$.body[1].inlines[1]").actionSourcePath, "$.body[2].inlines[2].selectAction.fallback");
  assert.equal(result.sourcePaths.get("$.body[4]"), "$.actions[1].fallback");
  assert.equal(result.provenance.get("$.body[4].items[0].inlines[0]").sourcePath, "$.actions[1].fallback.title");
  assert.equal(result.json.body[3].items.length, 1);
  assert.equal(result.provenance.get("$.body[2]").href, "https://example.com/image");
  assert.equal(result.provenance.get("$.body[2]").linkScope, "text-label");
  assert.equal(texts(result.json).some((text) => text.includes("Invisible")), false);
});

test("existing static SDK semantics, table column metadata and authored ids survive projection unchanged", () => {
  const result = project(card([
    { type: "ColumnSet", id: "columns", columns: [
      { type: "Column", width: 2, style: "emphasis", items: [{ type: "TextBlock", id: "title", text: "**Static Markdown**",
        wrap: true, horizontalAlignment: "center", color: "accent" }] },
      { type: "Column", width: "120px", items: [{ type: "RichTextBlock", inlines: [
        { type: "TextRun", text: "Bold", weight: "bolder" }, { type: "TextRun", text: "Italic", italic: true },
      ] }] },
    ] },
    { type: "FactSet", facts: [{ title: "Fact", value: "Value" }] },
    { type: "Table", columns: [{ width: 2 }, { width: "80px" }], rows: [
      { type: "TableRow", cells: [{ type: "TableCell", items: [{ type: "TextBlock", text: "One" }] },
        { type: "TableCell", items: [{ type: "TextBlock", text: "Two" }] }] },
    ] },
    { type: "ImageSet", images: [{ type: "Image", id: "image", url: "assets/a.png", altText: "Image" }] },
  ]));
  assert.deepEqual(plain(result.projected.toJSON()), plain(result.original.toJSON()));
  assert.equal(result.provenance.size, 0);
  assert.equal(result.sourcePaths.get("$.body[1].facts[0]"), "$.body[1].facts[0]");
  assert.equal(result.sourcePaths.get("$.body[2].columns[1]"), "$.body[2].columns[1]");
});

test("static expansion stays bounded near the source depth ceiling and does not synthesize colliding ids", () => {
  let nested = { type: "Input.Text", id: "authored", value: "Leaf" };
  for (let index = 0; index < MAX_CARD_DEPTH / 2 - 2; index++) nested = { type: "Container", items: [nested] };
  const result = project(card([nested, { type: "TextBlock", id: "authored-value", text: "Authored sibling" }]));
  const ids = [];
  visit(result.json, (node) => { if (node?.id) ids.push(node.id); });
  assert.deepEqual(ids, ["authored", "authored-value"]);
  assert.ok(texts(result.json).includes("Leaf"));
  const interactive = parseSdk(card());
  interactive.hostConfig = new SDK.HostConfig({ supportsInteractivity: true });
  assert.throws(() => projectAdaptiveCardStatic(interactive, SDK), (error) => error.code === "invalid-static-card");
});

test("large initial multi-selection strings cannot amplify into unbounded generated SDK nodes", () => {
  const unknown = Array.from({ length: 4_096 }, (_, index) => `unknown${index}`);
  const result = project(card([{ type: "Input.ChoiceSet", id: "choices", isMultiSelect: true,
    choices: [{ title: "Known choice", value: "known" }],
    value: ["known", "known", ...unknown].join(",") }]));
  const inlines = result.json.body[0].items[1].inlines;
  assert.equal(inlines.length, 3);
  assert.equal(inlines[0].text, "Known choice");
  assert.equal(inlines[2].text, unknown.join(", "));
  assert.equal(result.sourcePaths.get("$.body[0].items[1].inlines[2]"), "$.body[0].value");
});

test("toggle labels and titles both remain visible, while card-level selection stays non-interactive", () => {
  const result = project({
    ...card([{ type: "Input.Toggle", id: "alerts", label: "Preferences", title: "Receive alerts", value: "true" }]),
    selectAction: { type: "Action.OpenUrl", title: "Invisible card title", url: "https://example.com/card" },
  });
  assert.deepEqual(texts(result.json), ["Preferences (non-interactive)", "Receive alerts", "On: true"]);
  assert.equal(result.sourcePaths.get("$.body[0].items[1].inlines[0]"), "$.body[0].title");
  assert.equal(result.provenance.get("$").href, "https://example.com/card");
  assert.equal(result.provenance.get("$").actionSourcePath, "$.selectAction");
});

test("mixed-native fixture retains its safe link on the owning projected SDK TextRun path", async () => {
  const fixture = JSON.parse(await readFile(new URL("../../../../test/fixtures/adaptive-cards/mixed-native.json", import.meta.url), "utf8"));
  const result = project(fixture);
  const path = "$.body[3].inlines[1]";
  const originalRun = result.original.getItemAt(3).getInlineAt(1);
  const projectedRun = result.projected.getItemAt(3).getInlineAt(1);
  assert.ok(originalRun instanceof SDK.TextRun);
  assert.ok(originalRun.selectAction instanceof SDK.OpenUrlAction);
  assert.equal(originalRun.selectAction.url, "https://example.com/review");
  assert.ok(projectedRun instanceof SDK.TextRun);
  assert.equal(projectedRun.text, "safe link");
  assert.equal(projectedRun.selectAction, undefined);
  assert.equal(result.sourcePaths.get(path), path);
  assert.deepEqual([...result.provenance].filter(([, entry]) => entry.href), [[path, {
    type: "TextRun", sourcePath: path, treatment: "static-link", href: "https://example.com/review",
    actionType: "Action.OpenUrl", actionSourcePath: `${path}.selectAction`, linkScope: "text-label",
  }]]);
});
