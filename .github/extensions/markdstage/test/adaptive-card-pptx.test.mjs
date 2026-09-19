import assert from "node:assert/strict";
import test from "node:test";
import { pptxAdaptiveCardReport } from "../runtime/output-model.mjs";
import { buildPptxPackage } from "../runtime/pptx-package.mjs";
import { compareCardNativeModels } from "../../../../test/utils/adaptive-card-comparison.mjs";

test("native/approximation/subtree reports retain precise page, source and content classifications", () => {
  const card = {
    blockIndex: 1, status: "ready", nativeObjectCount: 3, rasterizedSubtreeCount: 1,
    diagnostics: [{ code: "static-input", sourcePath: "adaptive-card[1]$.body[3]", impact: "content" }],
    conversions: [
      { sourcePath: "adaptive-card[1]$.body[2].fallback", mode: "native", nativeObjects: 3, impact: "none" },
      { sourcePath: "adaptive-card[1]$.body[3]", mode: "approximated", nativeObjects: 0, impact: "content", reason: "static-input" },
      { sourcePath: "adaptive-card[1]$.body[4]", mode: "rasterized", nativeObjects: 0, impact: "content", reason: "adaptive-card-image-style" },
    ],
  };
  const report = pptxAdaptiveCardReport({ slides: [{}, { adaptiveCards: [card] }] });
  assert.deepEqual(report.adaptiveCards, [{ slideIndex: 1, page: 2, ...card }]);
  assert.equal(report.adaptiveCardIssueCount, 1);
  assert.deepEqual(report.adaptiveCardConversionSummary, { nativeObjects: 3, approximated: 1, rasterizedSubtrees: 1 });
  assert.deepEqual(pptxAdaptiveCardReport({ slides: [{}] }), {});
});

test("native review fails semantic changes, omissions and the exact two-pixel geometry threshold", () => {
  const model = { elements: [{ type: "text", x: 5, y: 10, width: 120, height: 27,
    paragraphs: [{ runs: [{ text: "Native", fontSize: 20 }] }] }], columnWidths: [40, 80] };
  const boundary = structuredClone(model);
  boundary.elements[0].x += 2;
  boundary.columnWidths[0] += 2;
  assert.deepEqual(compareCardNativeModels(model, boundary).violations, []);
  boundary.elements[0].x += 0.01;
  assert.equal(compareCardNativeModels(model, boundary).violations.length, 1);
  const changed = structuredClone(model);
  changed.elements[0].paragraphs[0].runs[0].text = "Missing original";
  assert.throws(() => compareCardNativeModels(model, changed), /native semantics changed/);
  assert.throws(() => compareCardNativeModels(model, { ...model, elements: [] }), /count changed/);
});

test("card hyperlink appearance explicitly disables Office underline without changing legacy links", () => {
  const packageFor = (preserveHyperlinkColor) => Buffer.from(buildPptxPackage({ slides: [{ elements: [{
    type: "text", x: 10, y: 10, width: 200, height: 30,
    paragraphs: [{ runs: [{ text: "Static link", color: "#123456", underline: false,
      href: "https://example.com", ...(preserveHyperlinkColor === undefined ? {} : { preserveHyperlinkColor }) }] }],
  }] }] }));
  const legacy = packageFor(undefined);
  assert.deepEqual(packageFor(false), legacy);
  assert.ok(!legacy.includes(Buffer.from('u="none"')));
  const card = packageFor(true);
  assert.ok(card.includes(Buffer.from('u="none"')));
  assert.ok(card.includes(Buffer.from('ahyp:hlinkClr')));
  assert.ok(card.includes(Buffer.from('val="tx"')));
});

test("measured text-shape links do not opt its characters into Office hyperlink styling", () => {
  const element = { type: "text", x: 10, y: 20, width: 160, height: 27, href: "https://example.com/review",
    paragraphs: [{ runs: [{ text: "Plain label", color: "#123456", underline: false }] }] };
  const bytes = Buffer.from(buildPptxPackage({ slides: [{ elements: [element] }] })).toString("utf8");
  assert.match(bytes, /<p:cNvPr id="\d+" name="Text \d+"><a:hlinkClick r:id="rId\d+"\/><\/p:cNvPr>/);
  assert.match(bytes, /Target="https:\/\/example\.com\/review" TargetMode="External"/);
  const run = /<a:r>[\s\S]*?<a:t>Plain label<\/a:t><\/a:r>/.exec(bytes)?.[0];
  assert.ok(run);
  assert.doesNotMatch(run, /hlinkClick|u="sng"/);
  for (const href of ["", true, null]) {
    assert.throws(() => buildPptxPackage({ slides: [{ elements: [{ ...element, href }] }] }), /href/);
  }
});
