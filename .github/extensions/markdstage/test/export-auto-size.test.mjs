import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const renderer = await readFile(new URL("../renderer/renderer.js", import.meta.url), "utf8");

/**
 * Slice the body of the named `async function` so ordering assertions cannot be
 * satisfied by a call that lives in some unrelated part of the module.
 */
function functionBody(name) {
  const start = renderer.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `renderer.js no longer defines ${name}`);
  // Parameters may be destructured across lines, so skip past them before
  // looking for the brace that opens the body.
  let parens = 0;
  let open = -1;
  for (let index = renderer.indexOf("(", start); index < renderer.length; index += 1) {
    if (renderer[index] === "(") parens += 1;
    else if (renderer[index] === ")") {
      parens -= 1;
      if (parens === 0) {
        open = renderer.indexOf("{", index);
        break;
      }
    }
  }
  assert.notEqual(open, -1, `Could not find the body of ${name}`);
  let depth = 0;
  for (let index = open; index < renderer.length; index += 1) {
    if (renderer[index] === "{") depth += 1;
    else if (renderer[index] === "}") {
      depth -= 1;
      if (depth === 0) return renderer.slice(open, index + 1);
    }
  }
  throw new Error(`Could not find the end of ${name}`);
}

test("export paths auto size only after the deferred diagrams have landed", () => {
  // Auto sizing measures the rendered body. Archify diagrams arrive during the
  // deferred pass, so sizing before it promotes those slides to size-xlarge and
  // exports headings and prose much larger than the preview shows.
  for (const name of ["renderPptxDeck", "renderPrintDeck", "renderCaptureSlide"]) {
    const body = functionBody(name);
    const deferred = body.lastIndexOf("renderDeferredDiagrams(");
    const images = body.indexOf("waitForImages(");
    const sized = body.indexOf("autoSizeSlides(");
    assert.notEqual(deferred, -1, `${name} must render deferred diagrams`);
    assert.notEqual(sized, -1, `${name} must auto size through autoSizeSlides`);
    assert.ok(sized > deferred, `${name} auto sizes before its diagrams render`);
    assert.ok(sized > images, `${name} auto sizes before its images finish loading`);
  }
});

test("export paths never inline their own auto sizing", () => {
  // A second copy of the size-mode guard is how the early-sizing bug would come
  // back, so keep the single helper as the only caller of applyAutoSize here.
  for (const name of ["renderPptxDeck", "renderPrintDeck", "renderCaptureSlide"]) {
    assert.doesNotMatch(
      functionBody(name),
      /applyAutoSize\(/,
      `${name} must delegate to autoSizeSlides instead of calling applyAutoSize`,
    );
  }
});
