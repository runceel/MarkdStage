import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = fileURLToPath(new URL("..", import.meta.url));

test("preview mode only enables pointer navigation for an explicit current-slide preview", async () => {
  const source = await readFile(join(extensionRoot, "renderer", "renderer.js"), "utf8");

  assert.match(source, /params\.get\("preview"\) === "1"/);
  assert.match(source, /\.\/state\?offset=\$\{previewOffset\}/);
  assert.match(
    source,
    /navigationEnabled = params\.get\("navigate"\) === "1" && previewOffset === 0/,
  );
  assert.match(source, /if \(!previewMode\) wireControls\(\)/);
  assert.match(source, /wirePreviewKeyboardNavigation\(\)/);
  assert.match(source, /nav\.hidden = previewMode \|\|/);
  assert.match(source, /img\[src\^="\/assets\/"\]/);
});

test("preview state resolves the requested slide offset", async () => {
  const source = await readFile(join(extensionRoot, "extension.mjs"), "utf8");

  assert.match(source, /requestUrl\.searchParams\.get\("offset"\)/);
  assert.match(source, /targetIndex = clampIndex\(inst\.index \+ offset, inst\.slides\.length\)/);
  assert.match(source, /inst\.slides\[targetIndex\]/);
});

test("embedded preview can open the Architecture Editor in the same browser tab", async () => {
  const source = await readFile(join(extensionRoot, "renderer", "renderer.js"), "utf8");

  assert.match(
    source,
    /params\.get\("architectureEditorTarget"\) === "same" \? "same" : ""/,
  );
  assert.match(source, /architectureDetailedEditTarget === "same"/);
  assert.match(source, /window\.location\.assign\(editorUrl\.href\)/);
});

test("host-targeted Architecture editing leaves tab projection to the wrapper", async () => {
  const source = await readFile(join(extensionRoot, "renderer", "renderer.js"), "utf8");

  assert.match(source, /data\.architectureDetailedEditTarget === "host"/);
  assert.match(source, /architectureDetailedEditTarget === "window"/);
  assert.match(source, /openedByHost/);
});

test("same-tab Architecture editing provides an explicit return to preview", async () => {
  const renderer = await readFile(join(extensionRoot, "renderer", "renderer.js"), "utf8");
  const editor = await readFile(join(extensionRoot, "architecture-editor", "editor.js"), "utf8");
  const html = await readFile(join(extensionRoot, "architecture-editor", "index.html"), "utf8");

  assert.match(renderer, /editorUrl\.searchParams\.set\(\s*"returnTo"/);
  assert.match(html, /id="returnToPreviewButton"[^>]*hidden>Back to preview<\/button>/);
  assert.match(editor, /value\.startsWith\("\/"\)/);
  assert.match(editor, /value\.startsWith\("\/\/"\)/);
  assert.match(editor, /target\.origin === window\.location\.origin/);
  assert.match(editor, /returnToPreviewButton\.hidden = false/);
});
