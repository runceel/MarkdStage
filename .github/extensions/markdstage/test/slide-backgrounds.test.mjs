import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseSlideBackground } from "../renderer/slide-background.mjs";
import { THEME_ASSET_MAX_BYTES } from "../renderer/theme.mjs";
import { loadSlideBackgrounds, resolveSlideBackgroundFile } from "../runtime/slide-backgrounds.mjs";
import { createDeckSession } from "../runtime/deck-session.mjs";
import { withDeckServer } from "../../../../packages/markdstage-cli/src/deck.mjs";

const slide = (value) => `---\nbackground-image: ${value}\n---\n# Background\n`;

async function workspace(t) {
  const root = await mkdtemp(join(process.cwd(), ".slide-background-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "assets"));
  await mkdir(join(root, "talk", "assets"), { recursive: true });
  return root;
}

async function post(base, route, body) {
  return fetch(new URL(route, base), {
    method: "POST",
    headers: { "content-type": "application/json", origin: new URL(base).origin },
    body: JSON.stringify(body),
  });
}

test("background parser distinguishes absence from invalid declarations and keeps normal asset names", () => {
  assert.equal(parseSlideBackground(undefined), "");
  for (const path of ["a.svg", "folder/背景 image.PNG", ".hidden.webp", "image (1).JPEG", "100%.jpg", "image%20name.png"]) {
    assert.equal(parseSlideBackground(`assets/${path}`), `/assets/${path}`);
    assert.equal(parseSlideBackground(`/assets/${path}`), `/assets/${path}`);
  }
  for (const value of [
    "", " ", null, false, 3, {}, "https://example.com/a.png", "//example.com/a.png",
    "data:image/png;base64,abc", "file:///a.png", "/elsewhere/a.png", "../a.png",
    "/assets/../a.png", "/assets/a/../../a.png", "/assets/./a.png", "/assets//a.png",
    "/assets/a\\b.png", "/assets/a.png?x=1", "/assets/a.png#fragment",
    "/assets/a\0.png", "/assets/a\n.png", "/assets/a.gif", "/assets/a.bmp",
    "/assets/a.png:stream.png", "C:\\assets\\a.png",
  ]) {
    assert.throws(() => parseSlideBackground(value), /Invalid background-image/, String(value));
  }
});

test("background resolution prefers adjacent assets, falls back to root, and works without a source file", async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, "assets", "image.PNG"), "root");
  await writeFile(join(root, "talk", "assets", "image.PNG"), "adjacent");
  const read = async (source) => readFile(await resolveSlideBackgroundFile(root, source, "/assets/image.PNG"), "utf8");
  assert.equal(await read("talk/not-on-disk.md"), "adjacent");
  assert.equal(await read(""), "root");
  await rm(join(root, "talk", "assets", "image.PNG"));
  assert.equal(await read("talk/not-on-disk.md"), "root");
  await rm(join(root, "talk", "assets"), { recursive: true });
  assert.equal(await read("talk/not-on-disk.md"), "root");
  await assert.rejects(resolveSlideBackgroundFile(root, "../outside.md", "/assets/image.PNG"), { code: "invalid_slide_background" });
});

test("background validation accepts the size boundary, rejects oversize and missing images without fallback", async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, "assets", "image.png"), "root");
  const adjacent = join(root, "talk", "assets", "image.png");
  await writeFile(adjacent, Buffer.alloc(THEME_ASSET_MAX_BYTES));
  await loadSlideBackgrounds(root, "talk/slides.md", [slide("/assets/image.png")]);
  await writeFile(adjacent, Buffer.alloc(THEME_ASSET_MAX_BYTES + 1));
  await assert.rejects(loadSlideBackgrounds(root, "talk/slides.md", [slide("/assets/image.png")]), {
    code: "slide_background_too_large", message: /Slide 1:.*2 MiB/,
  });
  await assert.rejects(loadSlideBackgrounds(root, "", ["# First", slide("/assets/missing.png")]), {
    code: "slide_background_not_found", message: /Slide 2:/,
  });
  await assert.rejects(loadSlideBackgrounds(root, "", [slide("")]), { code: "invalid_slide_background" });
  await loadSlideBackgrounds(root, "../unused.md", ["# No background"]);
});

test("background assets cannot escape through file or assets-folder symlinks", async (t) => {
  const root = await workspace(t);
  const outside = await workspace(t);
  await writeFile(join(outside, "outside.png"), "outside");
  await writeFile(join(root, "outside-assets.png"), "outside assets");
  try {
    await symlink(join(outside, "outside.png"), join(root, "assets", "escape.png"), "file");
    await symlink(join(root, "outside-assets.png"), join(root, "assets", "escape-root.png"), "file");
  } catch (error) {
    if (error.code !== "EPERM") throw error;
    t.diagnostic("File symlinks require Windows privileges; testing directory junction confinement.");
  }
  for (const path of ["escape.png", "escape-root.png"]) {
    await assert.rejects(resolveSlideBackgroundFile(root, "", `/assets/${path}`), (error) =>
      ["invalid_slide_background", "slide_background_not_found"].includes(error.code));
  }
  await rm(join(root, "talk", "assets"), { recursive: true });
  await symlink(outside, join(root, "talk", "assets"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(resolveSlideBackgroundFile(root, "talk/slides.md", "/assets/outside.png"), { code: "invalid_slide_background" });
});

test("failed reload and open preserve the entire previous deck and raw Markdown", async (t) => {
  const root = await workspace(t);
  const file = join(root, "slides.md");
  const markdown = `${slide('"assets/image.png"')}\n---\n\n## Without a background\n`;
  await writeFile(join(root, "assets", "image.png"), "image");
  await writeFile(file, markdown);
  const session = await createDeckSession({ file, workspaceRoot: root });
  assert.equal(session.sourceMarkdown, markdown);
  assert.equal(await readFile(file, "utf8"), markdown);
  assert.match(session.slides[0], /background-image: "assets\/image.png"/);
  assert.doesNotMatch(session.slides[1], /background-image:/);
  const snapshot = () => ({
    file: session.file, sourceName: session.sourceName, slides: session.slides.slice(),
    markdown: session.markdown, sourceMarkdown: session.sourceMarkdown,
    theme: session.theme, index: session.index, version: session.version, deckVersion: session.deckVersion,
  });
  const before = snapshot();
  await writeFile(file, slide("/assets/missing.png"));
  await assert.rejects(session.load({ preserveIndex: true }), { code: "slide_background_not_found" });
  assert.deepEqual(snapshot(), before);
  const next = join(root, "talk", "next.md");
  await writeFile(next, slide("https://example.com/image.png"));
  await assert.rejects(session.openFile(next), { code: "invalid_slide_background" });
  assert.deepEqual(snapshot(), before);
});

test("presentation background route is token isolated and revalidates size, type, existence and paths", async (t) => {
  const root = await workspace(t);
  const file = join(root, "talk", "slides.md");
  const image = join(root, "talk", "assets", "背景 100%.PNG");
  await writeFile(file, slide("/assets/背景 100%.PNG"));
  await writeFile(image, "adjacent image");
  await writeFile(join(root, "assets", "背景 100%.PNG"), "root image");
  await writeFile(join(root, "assets", "ordinary.gif"), "normal image");
  await withDeckServer({ file, workspace: root, application: true }, async (session, server) => {
    const path = parseSlideBackground("/assets/背景 100%.PNG")
      .replace(/^\/assets\//, "background-assets/")
      .split("/").map(encodeURIComponent).join("/");
    let response = await fetch(new URL(path, server.url));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "adjacent image");
    assert.equal((await fetch(new URL(`/${path}`, server.url))).status, 404);
    assert.equal((await fetch(new URL("background-assets/ordinary.gif", server.url))).status, 403);
    assert.equal((await fetch(new URL("assets/ordinary.gif", server.url))).status, 200);
    assert.equal((await fetch(new URL("background-assets/image%25name.png", server.url))).status, 404);
    assert.equal((await fetch(new URL("background-assets/image%23name.png", server.url))).status, 403);
    assert.equal((await fetch(new URL("background-assets/..%5Coutside.png", server.url))).status, 403);
    assert.equal((await fetch(new URL("background-assets/missing.png", server.url))).status, 404);
    await writeFile(image, Buffer.alloc(THEME_ASSET_MAX_BYTES + 1));
    assert.equal((await fetch(new URL(path, server.url))).status, 413);
    await rm(image);
    response = await fetch(new URL(path, server.url));
    assert.equal(await response.text(), "root image");
    await rm(join(root, "assets", "背景 100%.PNG"));
    assert.equal((await fetch(new URL(path, server.url))).status, 404);
    const before = { file: session.file, slides: session.slides.slice(), version: session.version };
    await writeFile(join(root, "bad.md"), slide("/assets/missing.png"));
    response = await post(server.url, "import", { path: "bad.md" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "slide_background_not_found");
    assert.deepEqual({ file: session.file, slides: session.slides, version: session.version }, before);
  });
});

test("Canvas snapshots validate metadata-relative backgrounds, updates, imports and serving without changing the previous deck", async (t) => {
  const root = await workspace(t);
  execFileSync("git", ["init", "--quiet", root]);
  await writeFile(join(root, "talk", "assets", "image.png"), "adjacent");
  await writeFile(join(root, "assets", "image.png"), "root");
  await writeFile(join(root, "bad.md"), slide("/assets/missing.png"));
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
    import { writeFile, rm } from "node:fs/promises";
    const sdkUrl = ${JSON.stringify(`data:text/javascript,${encodeURIComponent(sdk)}`)};
    registerHooks({ resolve(specifier, context, next) {
      return specifier === "@github/copilot-sdk/extension"
        ? { url: sdkUrl, shortCircuit: true } : next(specifier, context);
    }});
    await import(${JSON.stringify(new URL("../extension.mjs", import.meta.url).href)});
    const canvas = globalThis.presentation;
    const ctx = { sessionId: "background-test", instanceId: "deck",
      session: { workingDirectory: ${JSON.stringify(root)} } };
    const markdown = ${JSON.stringify(slide("/assets/image.png"))};
    let url;
    try {
      ({ url } = await canvas.open({ ...ctx, input: {
        slides: [markdown], sourceName: "talk/not-on-disk.md",
      }}));
      const get = async path => fetch(new URL(path, url));
      const state = async () => (await get("state")).json();
      const before = await state();
      assert.equal(await (await get("background-assets/image.png")).text(), "adjacent");
      assert.match((await (await get("deck")).json()).slides[0], /background-image: \\/assets\\/image.png/);
      const action = name => canvas.actions.find(action => action.name === name).handler;
      for (const [name, input] of [
        ["load_deck", { slides: [${JSON.stringify(slide("/assets/missing.png"))}], sourceName: "other.md" }],
        ["show_slide", { markdown: ${JSON.stringify(slide(""))} }],
      ]) {
        await assert.rejects(action(name)({ ...ctx, input }), error =>
          ["invalid_slide_background", "slide_background_not_found"].includes(error.code));
        assert.deepEqual(await state(), before);
      }
      const imported = await fetch(new URL("import", url), {
        method: "POST", headers: { "content-type": "application/json", origin: new URL(url).origin },
        body: JSON.stringify({ path: "bad.md" }),
      });
      assert.equal(imported.status, 400);
      assert.deepEqual(await state(), before);
      await writeFile(${JSON.stringify(join(root, "talk", "assets", "image.png"))}, Buffer.alloc(${THEME_ASSET_MAX_BYTES + 1}));
      assert.equal((await get("background-assets/image.png")).status, 413);
      assert.equal((await get("background-assets/a.gif")).status, 403);
      await rm(${JSON.stringify(join(root, "talk", "assets", "image.png"))});
      assert.equal(await (await get("background-assets/image.png")).text(), "root");
      await action("show_slide")({ ...ctx, input: { markdown: "# Without background" } });
      assert.equal((await state()).markdown, "# Without background");
    } finally {
      await canvas.onClose(ctx);
    }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8",
    timeout: 15_000,
    env: { ...process.env, TEMP: root, TMP: root, TMPDIR: root, SystemRoot: root, WINDIR: root },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
