import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("canvas port imports preserve BOM writeback and retain the deck after rejected reads", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "markdstage-canvas-port-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet", root]);
  await mkdir(join(root, "real"));
  const source = '\uFEFF# 日本語\r\n\r\n```architecture\r\n{"elements":[]}\r\n```\r\n';
  await writeFile(join(root, "slides.md"), source);
  await writeFile(join(root, "real", "slides.md"), "# Linked");
  await symlink(join(root, "real"), join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
  const sdk = `
    export class CanvasError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    }
    export const createCanvas = declaration => ({ declaration });
    export async function joinSession(config) {
      globalThis.presentation = config.canvases[0].declaration;
      return { log: async () => {} };
    }
  `;
  const script = `
    import assert from "node:assert/strict";
    import { registerHooks } from "node:module";
    import { readFile, writeFile } from "node:fs/promises";
    import { join } from "node:path";
    const root = ${JSON.stringify(root)};
    const sdkUrl = ${JSON.stringify(`data:text/javascript,${encodeURIComponent(sdk)}`)};
    registerHooks({ resolve(specifier, context, next) {
      return specifier === "@github/copilot-sdk/extension"
        ? { url: sdkUrl, shortCircuit: true } : next(specifier, context);
    }});
    await import(${JSON.stringify(new URL("../extension.mjs", import.meta.url).href)});
    const canvas = globalThis.presentation;
    const ctx = { sessionId: "io-port", instanceId: "deck", session: { workingDirectory: root } };
    try {
      const { url } = await canvas.open({ ...ctx, input: { slides: ["# Initial"] } });
      const post = (route, body) => fetch(new URL(route, url), {
        method: "POST", headers: { "content-type": "application/json", origin: new URL(url).origin },
        body: JSON.stringify(body),
      });
      const state = async () => (await fetch(new URL("state", url))).json();
      assert.equal((await post("import", { path: "slides.md" })).status, 200);
      const imported = await state();
      assert.match(imported.markdown, /日本語/);
      for (const [path, status, error] of [
        ["linked/slides.md", 400, "path_outside_workspace"],
        ["missing.md", 404, "file_not_found"],
        ["real/../slides.md", 400, "invalid_input"],
      ]) {
        const response = await post("import", { path });
        assert.equal(response.status, status, path);
        assert.equal((await response.json()).error, error, path);
        assert.deepEqual(await state(), imported);
      }
      await post("edit-mode", { enabled: true });
      const edit = await post("edit", { index: 0, block: 0, source: '{ "elements": [] }' });
      assert.equal(edit.status, 200, await edit.text());
      const saved = await readFile(join(root, "slides.md"), "utf8");
      assert.ok(saved.startsWith("\\uFEFF"), "legacy saves retain the existing BOM");
      assert.match(saved, /\\r\\n/, "legacy saves retain CRLF");
      const before = await state();
      await writeFile(join(root, "slides.md"), "a".repeat(2 * 1024 * 1024 + 1));
      const mode = await post("source-mode", { mode: "live" });
      assert.equal(mode.status, 200);
      const after = await state();
      assert.equal(after.markdown, before.markdown);
      assert.equal(after.deckVersion, before.deckVersion);
      assert.equal(after.sourceWatchError, "source_file_too_large");
      await post("source-mode", { mode: "snapshot" });
    } finally {
      await canvas.onClose(ctx);
    }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, TEMP: root, TMP: root, TMPDIR: root },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("canvas open reads sourcePath in live file-backed mode by default", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "markdstage-canvas-open-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet", root]);
  await writeFile(join(root, "slides.md"), "# From file\n", "utf8");
  const sdk = `
    export class CanvasError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    }
    export const createCanvas = declaration => ({ declaration });
    export async function joinSession(config) {
      globalThis.presentation = config.canvases[0].declaration;
      return { log: async () => {} };
    }
  `;
  const script = `
    import assert from "node:assert/strict";
    import { registerHooks } from "node:module";
    import { writeFile } from "node:fs/promises";
    import { join } from "node:path";
    const root = ${JSON.stringify(root)};
    const sdkUrl = ${JSON.stringify(`data:text/javascript,${encodeURIComponent(sdk)}`)};
    async function waitFor(predicate, timeoutMs = 2_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.fail("timed out waiting for canvas state");
    }
    registerHooks({ resolve(specifier, context, next) {
      return specifier === "@github/copilot-sdk/extension"
        ? { url: sdkUrl, shortCircuit: true } : next(specifier, context);
    }});
    await import(${JSON.stringify(new URL("../extension.mjs", import.meta.url).href)});
    const canvas = globalThis.presentation;
    const ctx = { sessionId: "open-source", instanceId: "deck", session: { workingDirectory: root } };
    try {
      const { url } = await canvas.open({ ...ctx, input: { sourcePath: "slides.md" } });
      const state = async () => (await fetch(new URL("state", url))).json();
      const opened = await state();
      assert.match(opened.markdown, /# From file/);
      assert.equal(opened.sourceBacked, true);
      assert.equal(opened.sourceMode, "live");
      assert.equal(opened.sourceWatchStatus, "watching");
      assert.equal(opened.architectureDetailedEdit, true);

      await writeFile(join(root, "slides.md"), "# Refreshed\\n", "utf8");
      await waitFor(async () => /# Refreshed/.test((await state()).markdown));

      await assert.rejects(
        canvas.open({ ...ctx, input: { sourcePath: "missing.md" } }),
        /The requested file or directory (?:is unavailable|was not found)|Markdown file/,
      );
      assert.match((await state()).markdown, /# Refreshed/);

      await canvas.open({ ...ctx, input: { slides: ["# Unsaved"] } });
      const unsaved = await state();
      assert.equal(unsaved.markdown, "# Unsaved");
      assert.equal(unsaved.sourceBacked, false);
      assert.equal(unsaved.sourceMode, "snapshot");
      assert.equal(unsaved.architectureDetailedEdit, false);
    } finally {
      await canvas.onClose(ctx);
    }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, TEMP: root, TMP: root, TMPDIR: root },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
