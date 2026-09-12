import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile, symlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readMarkdownDeck } from "../runtime/deck-reader.mjs";
import { createDeckSession } from "../runtime/deck-session.mjs";
import { buildDeckSlides } from "../markdown-deck.mjs";
import { IO_LIMITS } from "../runtime/io.mjs";
import { saveArchitectureSource } from "../runtime/architecture-source.mjs";

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), "markdstage-reader-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("the shared reader sends only the relative path and fixed Markdown limit to the port", async () => {
  const calls = [];
  const markdown = "# 日本語\r\n\r\n---\r\n\r\n# Second\r\n";
  const result = await readMarkdownDeck("talk/slides.MD", {
    async readText(...args) {
      calls.push(args);
      return { ok: true, value: `\uFEFF${markdown}` };
    },
  });
  assert.deepEqual(calls, [["talk/slides.MD", IO_LIMITS.markdown]]);
  assert.equal(result.markdown, markdown);
  assert.deepEqual(result.slides, buildDeckSlides(markdown));
});

test("invalid paths and non-Markdown paths never reach the port", async () => {
  const io = { readText() { assert.fail("invalid path reached the port"); } };
  for (const path of ["", "../secret.md", "talk/../secret.md", "/secret.md",
    "C:/secret.md", "C:secret.md", "\\\\host\\share.md", "talk\\slides.md", "a.md:stream", "a\0.md"]) {
    await assert.rejects(readMarkdownDeck(path, io), { code: "invalid_input" });
  }
  for (const path of ["slides.txt", ".md", "talk/.markdown", "slides.md.txt"]) {
    await assert.rejects(readMarkdownDeck(path, io), { code: "invalid_markdown_path" });
  }
});

test("the reader enforces its own UTF-8 byte limit and rejects bad successful payloads", async () => {
  const read = (value) => readMarkdownDeck("slides.md", {
    async readText() { return { ok: true, value }; },
  });
  await assert.rejects(read("日".repeat(Math.ceil(IO_LIMITS.markdown / 3))), { code: "file_too_large" });
  await assert.rejects(read({ text: "# deck" }), { code: "io_failed" });
  await assert.rejects(read(" \r\n\t"), { code: "empty_markdown" });
  const exact = "# " + "a".repeat(IO_LIMITS.markdown - 2);
  assert.equal((await read(exact)).markdown, exact);
});

test("port failures preserve the runtime error classification without leaking host details", async () => {
  for (const [code, expected] of [
    ["denied", "path_outside_workspace"], ["missing", "file_not_found"],
    ["too_large", "file_too_large"], ["unsupported", "invalid_markdown_path"],
    ["io_failed", "io_failed"],
  ]) {
    await assert.rejects(readMarkdownDeck("slides.md", {
      async readText() { return { ok: false, code, message: "EACCES C:\\private\\secret.md" }; },
    }), (error) => error.code === expected && !error.message.includes("private") && !error.message.includes("EACCES"));
  }
});

test("sessions capture their injected adapter and keep the last snapshot after failed reloads", async (t) => {
  const root = await workspace(t);
  const calls = [];
  let contents = "# First\n\n---\n\n# Second";
  let failure = null;
  const io = {
    async stat(path) {
      calls.push(["stat", path]);
      return { ok: true, value: { kind: "file", size: contents.length, modifiedAt: 1 } };
    },
    async readText(path, limit) {
      calls.push(["readText", path, limit]);
      return failure ?? { ok: true, value: contents };
    },
  };
  const session = await createDeckSession({ file: join(root, "virtual.md"), workspaceRoot: root, io });
  assert.equal(session.navigate(1), true);
  const snapshot = () => ({
    slides: session.slides.slice(), index: session.index, version: session.version,
    deckVersion: session.deckVersion, markdown: session.markdown, sourceMarkdown: session.sourceMarkdown,
  });
  const before = snapshot();
  for (const code of ["missing", "denied", "too_large", "io_failed"]) {
    failure = { ok: false, code, message: code };
    await assert.rejects(session.load({ preserveIndex: true }));
    assert.deepEqual(snapshot(), before);
  }
  failure = null;
  contents = "# Changed\n\n---\n\n# Second";
  await session.load({ preserveIndex: true });
  assert.equal(session.index, 1);
  assert.match(session.slides[0], /Changed/);
  assert.ok(calls.every((call) => call[1] === "virtual.md"));
});

test("Node-backed session reloads enforce size and link checks, not only the initial load", async (t) => {
  const root = await workspace(t);
  const file = join(root, "slides.md");
  await writeFile(file, "# Original");
  const session = await createDeckSession({ file, workspaceRoot: root });
  const before = { slides: session.slides, version: session.version };
  await writeFile(file, "a".repeat(IO_LIMITS.markdown + 1));
  await assert.rejects(session.load(), { code: "file_too_large" });
  assert.equal(session.slides, before.slides);
  assert.equal(session.version, before.version);
  await mkdir(join(root, "target"));
  await writeFile(join(root, "target", "slides.md"), "# Linked");
  await symlink(join(root, "target"), join(root, "link"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(session.openFile(join(root, "link", "slides.md")), { code: "path_outside_workspace" });
  assert.equal(session.slides, before.slides);
  assert.equal(session.version, before.version);
});

test("a canonicalized workspace root still accepts its original activation path", async (t) => {
  const parent = await workspace(t);
  const root = join(parent, "real");
  const alias = join(parent, "alias");
  await mkdir(root);
  await writeFile(join(root, "slides.md"), "# Original");
  await writeFile(join(root, "next.md"), "# Next");
  await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");
  const session = await createDeckSession({ file: join(alias, "slides.md"), workspaceRoot: alias });
  assert.equal(session.workspaceRoot, root);
  assert.equal(session.file, join(root, "slides.md"));
  await session.openFile(join(alias, "next.md"));
  assert.equal(session.sourceName, "next.md");
  assert.match(session.markdown, /Next/);
});

test("CLI editing accepts port snapshots without losing the BOM or missing external edits", async (t) => {
  const root = await workspace(t);
  const file = join(root, "slides.md");
  const original = '\uFEFF# Deck\r\n\r\n```architecture\r\n{"elements":[]}\r\n```\r\n';
  await writeFile(file, original);
  const session = await createDeckSession({ file, workspaceRoot: root });
  const save = () => saveArchitectureSource({
    workspaceRoot: root,
    sourcePath: session.sourceName,
    sourceFile: session.file,
    blockIndex: 0,
    source: '{ "elements": [] }',
    expectedMarkdown: session.sourceMarkdown,
  });
  assert.equal(session.sourceMarkdown, original.slice(1));
  assert.equal((await save()).ok, true);
  const saved = await readFile(file, "utf8");
  assert.ok(saved.startsWith("\uFEFF"));
  assert.match(saved, /\r\n/);
  await session.load();
  assert.equal((await save()).ok, true, "subsequent edits also accept the normalized snapshot");
  const external = saved + "\r\nExternal change";
  await writeFile(file, external);
  const conflict = await save();
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error, "source_changed");
  assert.equal(await readFile(file, "utf8"), external);
});
