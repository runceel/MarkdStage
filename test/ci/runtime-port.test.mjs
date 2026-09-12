import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../.github/extensions/markdstage/", import.meta.url);

// Guard the migrated dependency graph, not an allowlist of legacy Node imports.
// Add entry points here as their I/O is moved to the port; the older server,
// theme, and browser modules still need migration before the whole-tree guard.
test("portable runtime entry points cannot acquire Node or host-adapter dependencies", async () => {
  const pending = ["runtime/io.mjs", "runtime/io-host.mjs", "runtime/deck-reader.mjs", "runtime/pptx-package.mjs"]
    .map((path) => new URL(path, root));
  const visited = new Set();
  while (pending.length) {
    const url = pending.pop();
    if (visited.has(url.href)) continue;
    visited.add(url.href);
    assert.ok(url.href.startsWith(root.href), `dependency leaves the shared runtime: ${url}`);
    assert.ok(!url.pathname.endsWith("/io-node.mjs"), `portable module imports the Node adapter: ${url}`);
    const source = await readFile(url, "utf8");
    assert.doesNotMatch(source, /["'`]node:/, `${url} contains a Node import`);
    assert.doesNotMatch(source, /\brequire\s*\(/, `${url} contains a CommonJS import`);
    assert.doesNotMatch(source, /\bimport\s*\(\s*(?!["'])\S/, `${url} contains a computed import`);
    const imports = source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/g);
    for (const [, specifier] of imports) {
      assert.match(specifier, /^\.\.?\//, `${url} imports a non-relative dependency: ${specifier}`);
      pending.push(new URL(specifier, url));
    }
  }
  assert.ok(visited.has(new URL("markdown-deck.mjs", root).href));
  assert.ok(visited.has(new URL("runtime/errors.mjs", root).href));
});
