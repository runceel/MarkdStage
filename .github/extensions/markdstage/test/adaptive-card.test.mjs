import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAdaptiveCardSource, resolveCardImageUrl, MAX_CARD_JSON_BYTES, MAX_CARD_DEPTH, MAX_CARD_OBJECTS,
} from "../renderer/adaptive-card.mjs";

const card = (body = []) => ({ type: "AdaptiveCard", version: "1.5", body });
const parse = (value) => parseAdaptiveCardSource(JSON.stringify(value));
const rejects = (value, code) => assert.throws(() => parse(value), (error) => error.code === code);

test("accepts only resolved, bounded schema 1.5 JSON and diagnoses unsupported mechanisms", () => {
  assert.deepEqual(parse(card()), card());
  assert.throws(() => parseAdaptiveCardSource("{"), (error) => error.code === "invalid-json");
  for (const version of [undefined, "1.4", "1.6", "2.0", 1.5]) rejects({ ...card(), version }, "unsupported-version");
  rejects(card([{ type: "Input.Text", id: "input" }]), "unsupported-element");
  rejects({ ...card(), actions: [] }, "unsupported-interactivity");
  rejects(card([{ type: "Image", url: "assets/image.png", selectAction: { type: "Action.OpenUrl", url: "https://example.com" } }]), "unsupported-interactivity");
  rejects({ ...card(), fallback: "drop" }, "unsupported-fallback");
  rejects({ ...card(), requires: { unknown: "1.0" } }, "unsupported-requires");
  rejects(card([{ type: "TextBlock", text: "${unresolved}" }]), "unresolved-template");
  rejects(card([{ type: "Container", $data: "rows", items: [] }]), "unresolved-template");
  rejects(card([{ type: "ImageSet", images: [{ url: "https://example.com/implicit.png" }] }]), "unsupported-element");
  rejects(card([{ type: "FactSet", facts: [{ title: "Missing value" }] }]), "invalid-fact");
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
