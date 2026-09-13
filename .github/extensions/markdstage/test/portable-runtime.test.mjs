import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createPortableRuntime } from "../runtime/portable-runtime.mjs";
import { createHostRuntime } from "../runtime/host-bootstrap.mjs";
import { KNOWN_THEME_VARIABLES } from "../runtime/theme-reader.mjs";
import { IO_LIMITS, IO_OPERATIONS, isWorkspacePath } from "../runtime/io.mjs";
import { deriveTitle, splitFrontMatter } from "../renderer/slide-title.mjs";

const encoder = new TextEncoder();
const ok = (value) => ({ ok: true, value });
const fail = (code) => ({ ok: false, code, message: "Host detail must not escape." });

function memoryIO(initial = {}) {
  let clock = 1;
  const files = new Map();
  const directories = new Set([""]);
  const calls = [];
  const watchers = new Map();
  const set = (path, value) => files.set(path, {
    bytes: typeof value === "string" ? encoder.encode(value) : value,
    modifiedAt: ++clock,
  });
  Object.entries(initial).forEach(([path, value]) => set(path, value));
  const bridge = Object.fromEntries(IO_OPERATIONS.map((operation) => [operation, async () => fail("unsupported")]));
  const info = (path) => {
    const file = files.get(path);
    if (file) return { kind: "file", size: file.bytes.length, modifiedAt: file.modifiedAt };
    if (directories.has(path) || [...files.keys()].some((key) => key.startsWith(`${path}/`))) {
      return { kind: "directory", size: 0, modifiedAt: 1 };
    }
    return null;
  };
  Object.assign(bridge, {
    stat: async (path) => info(path) ? ok(info(path)) : fail("missing"),
    readText: async (path, limit) => {
      const file = files.get(path);
      return !file ? fail("missing") : file.bytes.length > limit ? fail("too_large")
        : ok(new TextDecoder().decode(file.bytes));
    },
    readBytes: async (path, limit) => {
      const file = files.get(path);
      return !file ? fail("missing") : file.bytes.length > limit ? fail("too_large") : ok(file.bytes.slice());
    },
    replaceText: async (path, text, options) => {
      if (files.get(path)?.modifiedAt !== options.expectedModifiedAt) return fail("conflict");
      set(path, text);
      return ok(path);
    },
    list: async (root, options = {}) => ok([...files.keys()].filter((path) =>
      (root === "" || path.startsWith(`${root}/`)) &&
      (!options.extensions || options.extensions.some((extension) => path.toLowerCase().endsWith(extension))))
      .map((path) => ({ path, ...info(path) }))),
    makeDirectory: async (path) => { directories.add(path); return ok(path); },
    writeBytes: async (path, bytes, options = {}) => {
      if (files.has(path) && !options.overwrite) return fail("exists");
      set(path, bytes.slice());
      return ok(path);
    },
    watch: async (path, _options, callback) => {
      const handle = `watch_${++clock}`;
      watchers.set(handle, { path, callback });
      return ok(handle);
    },
    unwatch: async (handle) => { watchers.delete(handle); return ok(undefined); },
  });
  const io = Object.fromEntries(Object.entries(bridge).map(([operation, method]) => [
    operation, async (...args) => {
      calls.push({ operation, args });
      if (["stat", "readText", "readBytes", "replaceText", "list", "watch", "writeBytes", "makeDirectory"].includes(operation)) {
        assert.ok(isWorkspacePath(args[0], { allowRoot: ["stat", "list", "watch"].includes(operation) }), args[0]);
      }
      return method(...args);
    },
  ]));
  return { io, calls, files, set, watchers };
}

const diagram = (source = '{"elements":[]}') => `# Diagram\r\n\r\n\`\`\`architecture\r\n${source}\r\n\`\`\`\r\n`;

test("portable session parses once, owns navigation, detaches snapshots and serializes mutations", async () => {
  const { io } = memoryIO({ "talk/slides.md": "\uFEFF# **日本語**\n\n---\n\n## Second" });
  const runtime = await createPortableRuntime({ io });
  assert.equal((await runtime.snapshot()).total, 0);
  await assert.rejects(runtime.navigate("next"), { code: "no_deck" });
  const [loaded, navigated] = await Promise.all([runtime.loadDeck("talk/slides.md"), runtime.navigate("next")]);
  assert.equal(loaded.total, 3);
  assert.deepEqual(loaded.titles, ["日本語", "Second", "(Untitled)"]);
  assert.equal(loaded.theme, "dark");
  assert.equal(navigated.index, 1);
  assert.equal(navigated.version, 2);
  assert.equal(navigated.deckVersion, 1);
  loaded.slides[0] = "# Corrupted";
  loaded.titles.length = 0;
  assert.notEqual((await runtime.snapshot()).slides[0], "# Corrupted");
  assert.equal((await runtime.snapshot({ offset: 1 })).index, 2);
  assert.equal((await runtime.snapshot()).index, 1);
  assert.equal((await runtime.navigate({ delta: 999 })).index, 2);
  assert.equal((await runtime.navigate("last")).version, 3);
  await assert.rejects(runtime.navigate({ index: 0, delta: 1 }), { code: "invalid_input" });
  await assert.rejects(runtime.navigate("2"), { code: "invalid_input" });
});

test("portable session validates loaded decks for native hosts", async () => {
  const { io } = memoryIO({
    "slides.md": "---\ndeck: Demo\nlayout: title\npage: 1\ntotal: 1\nsize: 16:9\n---\n# Demo",
  });
  const runtime = await createHostRuntime(io);
  await runtime.loadDeck("slides.md");
  const report = await runtime.validate({ file: "C:\\decks\\slides.md", workspace: "C:\\decks" });
  assert.equal(report.ok, true);
  assert.equal(report.file, "C:\\decks\\slides.md");
  assert.equal(report.workspace, "C:\\decks");
  assert.equal(report.total, 2);
  assert.deepEqual(report.errors, []);
});

test("failed load and reload leave every authoritative field unchanged", async () => {
  const memory = memoryIO({ "slides.md": "# Original", "bad.md": "---\nbackground-image: assets/missing.png\n---\n# Bad" });
  const runtime = await createPortableRuntime({ io: memory.io });
  const before = await runtime.loadDeck("slides.md");
  await assert.rejects(runtime.loadDeck("bad.md", { theme: "light" }), { code: "slide_background_not_found" });
  assert.deepEqual(await runtime.snapshot(), before);
  memory.set("slides.md", "");
  await assert.rejects(runtime.reload(), { code: "empty_markdown" });
  assert.deepEqual(await runtime.snapshot(), before);
  await assert.rejects(runtime.loadDeck("../outside.md"), { code: "invalid_input" });
  await assert.rejects(runtime.loadDeck("not.txt"), { code: "invalid_markdown_path" });
  assert.deepEqual(await runtime.snapshot(), before);
});

test("host bridge resolves adjacent custom themes and assets with bounded reads and no absolute paths", async () => {
  const memory = memoryIO({
    "talk/slides.md": "---\ntheme-file: brand/theme.css\nbackground-image: assets/背景.png\n---\n# Custom",
    "talk/brand/theme.css": "--bg: #123456; --not-a-token: 1;",
    "talk/brand/theme.json": JSON.stringify({ version: 1, background: { image: "assets/cover.png" } }),
    "talk/brand/assets/cover.png": new Uint8Array([1, 2, 3]),
    "talk/assets/背景.png": new Uint8Array([4, 5]),
    "assets/背景.png": new Uint8Array([9]),
    "brand/theme.css": "--bg: red;",
  });
  const runtime = await createHostRuntime(memory.io);
  const snapshot = await runtime.loadDeck("talk/slides.md");
  assert.equal(snapshot.theme, "custom");
  assert.equal(snapshot.customThemeFile, "talk/brand/theme.css");
  assert.equal(snapshot.customThemeMeta.background.image, "/theme-assets/assets/cover.png");
  assert.equal(snapshot.customThemeWarnings[0].code, "unknown_theme_property");
  snapshot.customThemeMeta.background.image = "bad";
  assert.equal((await runtime.snapshot()).customThemeMeta.background.image, "/theme-assets/assets/cover.png");
  assert.deepEqual((await runtime.readAsset("/assets/背景.png")).bytes, new Uint8Array([4, 5]));
  assert.deepEqual((await runtime.readAsset("/theme-assets/assets/cover.png")).bytes, new Uint8Array([1, 2, 3]));
  await assert.rejects(runtime.readAsset("/theme-assets/assets/private.png"), { code: "file_not_found" });
  await assert.rejects(runtime.readAsset("/assets/../slides.md"), { code: "invalid_input" });
  assert.ok(memory.calls.some(({ operation, args }) => operation === "readText" && args[1] === IO_LIMITS.themeCss));
  assert.equal((await runtime.loadDeck("talk/slides.md", { theme: "light" })).theme, "light");
});

test("denied adjacent assets never fall back, missing adjacent assets do", async () => {
  const memory = memoryIO({
    "slides.md": "# Root",
    "talk/slides.md": "# Nested",
    "assets/a.png": new Uint8Array([1]),
  });
  const stat = memory.io.stat;
  memory.io.stat = (path) => path === "talk/assets/a.png" ? Promise.resolve(fail("denied")) : stat(path);
  const runtime = await createPortableRuntime({ io: memory.io });
  await runtime.loadDeck("talk/slides.md");
  await assert.rejects(runtime.readAsset("/assets/a.png"), { code: "path_outside_workspace" });
  memory.io.stat = stat;
  assert.equal((await runtime.readAsset("/assets/a.png")).path, "assets/a.png");
});

test("portable architecture imports share naming, signatures, collision handling, and scoped enumeration", async () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const memory = memoryIO({
    "talk/slides.md": "# Test", "talk/assets/hero.png": png,
    "assets/HERO.png": new Uint8Array([...png, 1]), "assets/ignored.gif": new Uint8Array([1]),
  });
  const runtime = await createHostRuntime(memory.io, { caseInsensitivePaths: true });
  await runtime.loadDeck("talk/slides.md");
  const before = await runtime.snapshot();
  const first = await runtime.importArchitectureAsset({ filename: "Résumé hero.PNG", contentType: "image/png", content: png });
  const second = await runtime.importArchitectureAsset({ filename: "Résumé hero.PNG", contentType: "image/png", content: png });
  assert.equal(first.path, "assets/Resume-hero.png");
  assert.equal(second.path, "assets/Resume-hero-2.png");
  assert.deepEqual(memory.files.get(first.path).bytes, png);
  assert.deepEqual(await runtime.listArchitectureAssets(), [
    { path: "assets/hero.png", size: 8 },
    { path: "assets/Resume-hero-2.png", size: 8 },
    { path: "assets/Resume-hero.png", size: 8 },
  ]);
  assert.deepEqual(await runtime.snapshot(), before);
  const writes = memory.calls.filter(({ operation }) => operation === "writeBytes");
  assert.equal(writes.length, 3);
  assert.ok(writes.every(({ args }) => args[2].overwrite === false));
});

test("portable asset validation and denied writes have no unsafe fallback", async () => {
  const memory = memoryIO();
  const runtime = await createHostRuntime(memory.io);
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  for (const [request, code] of [
    [{ filename: "empty.png", content: new Uint8Array() }, "empty_asset"],
    [{ filename: "fake.png", content: new Uint8Array([1]) }, "asset_signature_mismatch"],
    [{ filename: "fake.png", content: png, contentType: "image/jpeg" }, "asset_content_type_mismatch"],
    [{ filename: "big.png", content: new Uint8Array(IO_LIMITS.architectureAsset + 1) }, "asset_too_large"],
    [{ filename: "script.js", content: png }, "unsupported_asset_type"],
  ]) {
    await assert.rejects(runtime.importArchitectureAsset(request), { code });
  }
  assert.equal(memory.calls.length, 0);
  memory.io.writeBytes = async () => fail("denied");
  // Capture a fresh bridge after replacing its implementation.
  const denied = await createHostRuntime(memory.io);
  await assert.rejects(denied.importArchitectureAsset({ filename: "safe.png", content: png }), { code: "invalid_output_path" });
  assert.equal(memory.files.size, 0);
});

test("theme catalog matches bundled schema and title extraction matches renderer rules", async () => {
  const schema = JSON.parse(await readFile(new URL("../schema/theme-v1.json", import.meta.url), "utf8"));
  assert.deepEqual([...KNOWN_THEME_VARIABLES], Object.keys(schema.properties.variables.properties));
  assert.equal(deriveTitle("---\nlayout: title\n---\n# **A** [link](url)\n<!-- notes -->\n# Hidden"), "A link");
  assert.equal(deriveTitle("x".repeat(41)), `${"x".repeat(40)}…`);
  assert.equal(deriveTitle(null), "(Untitled)");
  assert.equal(splitFrontMatter("---\nunterminated").body, "---\nunterminated");
});

test("architecture writes preserve surrounding newlines and atomically update source-backed snapshot", async () => {
  const memory = memoryIO({ "slides.md": diagram() });
  const runtime = await createHostRuntime(memory.io);
  await runtime.loadDeck("slides.md");
  const read = await runtime.readArchitecture(0);
  assert.equal(read.source.trim(), '{"elements":[]}');
  const source = '{"title":"Changed","elements":[]}';
  const saved = await runtime.saveArchitecture({ blockIndex: 0, source });
  assert.equal(saved.ok, true);
  assert.equal(saved.snapshot.deckVersion, 2);
  assert.equal(saved.markdown, diagram(source));
  assert.equal(saved.snapshot.sourceMarkdown, saved.markdown);
  assert.equal(new TextDecoder().decode(memory.files.get("slides.md").bytes), saved.markdown);
  assert.equal(memory.calls.filter(({ operation }) => operation === "replaceText").length, 1);
});

test("architecture validation, stale snapshots, and compare-and-swap races never mutate session", async () => {
  const memory = memoryIO({ "slides.md": diagram() });
  const runtime = await createPortableRuntime({ io: memory.io });
  const before = await runtime.loadDeck("slides.md");
  const invalid = await runtime.saveArchitecture({ blockIndex: 0, source: '{"elements":[{"type":"wrong"}]}' });
  assert.equal(invalid.error, "invalid_architecture");
  assert.equal(invalid.validation.valid, false);
  assert.deepEqual(await runtime.snapshot(), before);
  memory.set("slides.md", diagram('{"title":"External","elements":[]}'));
  const stale = await runtime.saveArchitecture({ blockIndex: 0, source: '{"elements":[]}' });
  assert.equal(stale.error, "source_changed");
  assert.deepEqual(await runtime.snapshot(), before);
  memory.set("slides.md", diagram());
  memory.io.replaceText = async () => fail("conflict");
  const raced = await runtime.saveArchitecture({ blockIndex: 0, source: '{"elements":[]}' });
  assert.equal(raced.error, "source_changed");
  assert.deepEqual(await runtime.snapshot(), before);
});

test("architecture saves preserve BOM and resolve slide-local blocks in the shared runtime", async () => {
  const memory = memoryIO({ "slides.md": `\uFEFF# Title\n\n---\n\n${diagram()}` });
  const runtime = await createPortableRuntime({ io: memory.io });
  const loaded = await runtime.loadDeck("slides.md");
  assert.deepEqual(await runtime.resolveArchitectureTarget({ index: 1, block: 0 }), { sourcePath: "slides.md", blockIndex: 0 });
  const stale = await runtime.saveArchitecture({ index: 1, block: 0, deckVersion: 0, source: '{"elements":[]}' });
  assert.equal(stale.error, "deck_changed");
  const saved = await runtime.saveArchitecture({ index: 1, block: 0, deckVersion: loaded.deckVersion, source: '{"title":"New","elements":[]}' });
  assert.equal(saved.ok, true);
  const bytes = memory.files.get("slides.md").bytes;
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(saved.snapshot.sourceMarkdown.startsWith("\uFEFF"), false);
});

test("live startup refresh catches changes made while the watch subscription is starting", async () => {
  const memory = memoryIO({ "slides.md": "# Old" });
  const watch = memory.io.watch;
  memory.io.watch = async (...args) => {
    memory.set("slides.md", "# New");
    return watch(...args);
  };
  const runtime = await createPortableRuntime({ io: memory.io });
  await runtime.loadDeck("slides.md");
  const live = await runtime.setSourceMode("live");
  assert.equal(live.titles[0], "New");
  assert.equal(live.sourceWatchStatus, "watching");
  await runtime.close();
});

test("live source changes update shared snapshot, failures preserve deck, stale callbacks are ignored", async () => {
  const memory = memoryIO({ "slides.md": "# One", "other.md": "# Other" });
  const runtime = await createHostRuntime(memory.io);
  await runtime.loadDeck("slides.md");
  const notifications = [];
  const unsubscribe = runtime.subscribe((snapshot) => notifications.push(snapshot));
  await runtime.setSourceMode("live");
  const watcher = [...memory.watchers.values()][0];
  memory.set("slides.md", "# Two");
  watcher.callback({ path: "slides.md", kind: "changed" });
  assert.equal((await runtime.snapshot()).titles[0], "Two");
  memory.set("slides.md", "");
  watcher.callback({ path: "slides.md", kind: "changed" });
  const failed = await runtime.snapshot();
  assert.equal(failed.titles[0], "Two");
  assert.equal(failed.sourceWatchStatus, "error");
  await runtime.loadDeck("other.md");
  const switched = await runtime.snapshot();
  watcher.callback({ path: "slides.md", kind: "changed" });
  assert.deepEqual(await runtime.snapshot(), switched);
  await runtime.setSourceMode("snapshot");
  assert.equal(memory.watchers.size, 0);
  assert.ok(notifications.length > 0);
  unsubscribe();
  await runtime.close();
  await assert.rejects(runtime.snapshot(), { code: "runtime_closed" });
});

test("Node compatibility session and portable host produce equivalent deck state", async (t) => {
  const { createDeckSession } = await import("../runtime/deck-session.mjs");
  await assert.rejects(createDeckSession(), { code: "invalid_input" });
  await assert.rejects(createDeckSession({ file: "slides.md" }), { code: "invalid_input" });
  const root = await mkdtemp(join(process.cwd(), ".portable-conformance-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    "talk/slides.md": "---\ntheme-file: brand/theme.css\n---\n# Test\n---\n## Two",
    "talk/brand/theme.css": "--bg: #123456;",
  };
  await mkdir(join(root, "talk/brand"), { recursive: true });
  for (const [path, content] of Object.entries(files)) await writeFile(join(root, path), content);
  const node = await createDeckSession({ workspaceRoot: root, file: join(root, "talk/slides.md") });
  const portable = await createHostRuntime(memoryIO(files).io);
  let snapshot = await portable.loadDeck("talk/slides.md");
  for (const key of ["slides", "theme", "themeLocked", "customThemeFile", "customThemeCss", "customThemeMeta", "sourceMarkdown", "version", "deckVersion"]) {
    assert.deepEqual(snapshot[key], node[key], key);
  }
  node.navigate(1);
  snapshot = await portable.navigate(1);
  assert.equal(snapshot.index, node.index);
  assert.equal(snapshot.version, node.version);
});

test("host bootstrap transitive graph is portable and contains no Node globals", async () => {
  const visited = new Set();
  async function visit(url) {
    if (visited.has(url.href)) return;
    visited.add(url.href);
    const source = await readFile(url, "utf8");
    assert.doesNotMatch(source, /\b(?:Buffer|process|require)\s*[.(]/u, url.href);
    for (const match of source.matchAll(/^\s*(?:import|export)\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/gm)) {
      const specifier = match[1];
      assert.ok(specifier.startsWith("."), `${url.href}: ${specifier}`);
      await visit(new URL(specifier, url));
    }
  }
  await visit(new URL("../runtime/host-bootstrap.mjs", import.meta.url));
  assert.ok(visited.size > 15);
});
