import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../.github/extensions/markdstage/", import.meta.url);

// Every shared runtime module is portable except the explicit Node adapter.
// Node transport and build/test tooling are separate from the shared runtime.
test("all shared runtime modules except io-node have a portable dependency graph", async () => {
  const modules = await readdir(new URL("runtime/", root));
  const pending = modules.filter((name) => name.endsWith(".mjs") && name !== "io-node.mjs")
    .map((name) => new URL(`runtime/${name}`, root));
  const visited = new Set();
  while (pending.length) {
    const url = pending.pop();
    if (visited.has(url.href)) continue;
    visited.add(url.href);
    assert.ok(url.href.startsWith(root.href), `dependency leaves the shared runtime: ${url}`);
    assert.ok(!url.pathname.endsWith("/io-node.mjs"), `portable module imports the Node adapter: ${url}`);
    assert.ok(!url.pathname.includes("/hosts/node/"), `portable module imports a Node host: ${url}`);
    const source = await readFile(url, "utf8");
    assert.doesNotMatch(source, /\brequire\s*\(/, `${url} contains a CommonJS import`);
    assert.doesNotMatch(source, /\bimport\s*\(\s*(?!["'])\S/, `${url} contains a computed import`);
    const imports = source.matchAll(/(?:\bimport\s+(?:(?:[\w$]+\s*,\s*)?(?:\{[^}]*\}|\*\s+as\s+[\w$]+)|[\w$]+)\s+from\s*|\bexport\s+(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?)\s+from\s*|\bimport\s*\(\s*|^\s*import\s*)["']([^"']+)["']/gm);
    for (const [, specifier] of imports) {
      assert.ok(!specifier.startsWith("node:"), `${url} imports Node: ${specifier}`);
      assert.match(specifier, /^\.\.?\//, `${url} imports a non-relative dependency: ${specifier}`);
      pending.push(new URL(specifier, url));
    }
  }
  assert.ok(visited.has(new URL("markdown-deck.mjs", root).href));
  assert.ok(visited.has(new URL("runtime/errors.mjs", root).href));
  assert.ok(visited.has(new URL("runtime/portable-runtime.mjs", root).href));
  assert.ok(visited.has(new URL("deck-state.mjs", root).href));
});
