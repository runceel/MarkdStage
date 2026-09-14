import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("export notifications expose a direct file-opening link", async () => {
  const html = await readFile(new URL("../renderer/index.html", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../renderer/renderer.js", import.meta.url), "utf8");

  assert.match(html, /id="exportNotificationLink"/);
  assert.match(
    renderer,
    /postMessage\(\{ type: "shell:open-file", path \}\)/,
  );
  assert.match(html, /id="exportNotificationPath"[^>]*tabindex="0"/);
  assert.match(renderer, /link\.textContent = path;/);
  assert.match(renderer, /location\.prepend\("Saved to: "\)/);
});
