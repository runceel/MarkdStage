import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("desktop bridge loads Markdown and preserves reveal navigation in snapshots", async () => {
  const host = await readFile(new URL("../../apps/MarkdStage.Desktop/src/MarkdStage.App/Services/NativeRuntimeHost.cs", import.meta.url), "utf8");
  const bootstrap = host.match(/private const string Bootstrap = """\r?\n([\s\S]*?)\r?\n\s*""";/u)?.[1];
  assert.ok(bootstrap, "Native runtime bootstrap must be available");
  const source = [
    "# Plan", "", "<!-- markdstage: reveal=list-items -->", "",
    "- First", "- Second", "", "# Next",
  ].join("\n");
  let listener;
  const replies = new Map();
  const webview = {
    addEventListener(_type, callback) { listener = callback; },
    postMessage(message) {
      if (message.type === "io:request") {
        const [path] = message.args;
        const result = path === "slides.md" && message.method === "readText"
          ? { ok: true, value: source }
          : path === "slides.md" && message.method === "stat"
            ? { ok: true, value: { kind: "file", size: Buffer.byteLength(source), modifiedAt: 1 } }
            : { ok: false, code: "missing", message: "Not found" };
        queueMicrotask(() => listener({ data: { type: "io:result", id: message.id, result } }));
      } else if (message.type === "runtime:result") {
        replies.get(message.id)(message);
      }
    },
  };
  const sharedRoot = new URL("../../.github/extensions/markdstage/", import.meta.url).href;
  const executable = bootstrap.replaceAll('import("/Shared/', `import("${sharedRoot}`);
  await new Function("chrome", `return ${executable}`)({ webview });
  async function command(method, args = {}) {
    const id = String(replies.size + 1);
    const response = new Promise(resolve => replies.set(id, resolve));
    await listener({ data: { type: "runtime:command", id, method, args } });
    const result = await response;
    assert.equal(result.ok, true, result.message);
    return result.value;
  }
  const state = ({ index, revealTotals, revealStep, revealTotal }) =>
    ({ index, revealTotals, revealStep, revealTotal });
  const loaded = await command("load", { path: "slides.md" });
  assert.equal(loaded.slides.length, 2);
  assert.equal(loaded.titles.length, loaded.slides.length);
  assert.equal(loaded.notes.length, loaded.slides.length);
  assert.equal(loaded.revealTotals.length, loaded.slides.length);
  assert.equal(loaded.sourcePath, "slides.md");
  assert.ok(loaded.theme.name);
  assert.deepEqual(state(loaded), { index: 0, revealTotals: [2, 0], revealStep: 0, revealTotal: 2 });
  assert.deepEqual(state(await command("navigate", { action: "advance" })),
    { index: 0, revealTotals: [2, 0], revealStep: 1, revealTotal: 2 });
  assert.deepEqual(state(await command("navigate", { action: "advance" })),
    { index: 0, revealTotals: [2, 0], revealStep: 2, revealTotal: 2 });
  assert.deepEqual(state(await command("navigate", { action: "advance" })),
    { index: 1, revealTotals: [2, 0], revealStep: 0, revealTotal: 0 });
  assert.deepEqual(state(await command("navigate", { action: "rewind" })),
    { index: 0, revealTotals: [2, 0], revealStep: 2, revealTotal: 2 });
  assert.deepEqual(state(await command("getSnapshot")),
    { index: 0, revealTotals: [2, 0], revealStep: 2, revealTotal: 2 });
});
