// node test\scripts\mermaid-systems-review.mjs <absolute-artifact-directory> <fixture-name>...
// Then render-kanban-block-review.ps1 -ArtifactDirectory <directory> -PageNumbers (2..<last-page>).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { withDeckServer } from "../../packages/markdstage-cli/src/deck.mjs";
import { captureSlides, exportPptx } from "../../.github/extensions/markdstage/runtime/output.mjs";
import { findChromiumBrowser, runPptxOutputBrowser } from "../../.github/extensions/markdstage/runtime/browser.mjs";
import { inspectPptxPackage } from "../../.github/extensions/markdstage/runtime/pptx-package.mjs";

const [output, ...names] = process.argv.slice(2);
assert.ok(output && isAbsolute(output), "Provide an absolute artifact directory.");
const expectedFallbacks = new Map([
  ["c4-basic", 0], ["c4-hybrid", 5],
  ["architecture-basic", 0], ["architecture-hybrid", 3],
  ["eventmodeling-basic", 0], ["eventmodeling-hybrid", 1],
]);
assert.ok(names.length && names.every((name) => expectedFallbacks.has(name)), "Provide known systems fixture basenames.");
const fixtureDirectory = resolve("test", "fixtures", "mermaid");
const hash = (data) => createHash("sha256").update(data).digest("hex");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
// Record uncommitted implementations too, without requiring an unsolicited commit.
const sourcePaths = [...new Set([
  ...git("ls-files", ".github/extensions/markdstage", "packages/markdstage-cli", "test/fixtures/mermaid").split("\n"),
  ...names.map((name) => join("test", "fixtures", "mermaid", `${name}.mmd`)),
  ...names.map((name) => join("test", "fixtures", "mermaid", `${name}.svg`)),
])].filter(Boolean).sort();
async function sourceHashes() {
  const result = {};
  for (const path of sourcePaths) result[path] = hash(await readFile(path));
  return result;
}
const before = await sourceHashes();
const fragments = [];
for (const name of names) {
  fragments.push(`## ${name}\n\n\`\`\`mermaid\n${await readFile(join(fixtureDirectory, `${name}.mmd`), "utf8")}\n\`\`\``);
}
const markdown = ["---\nlayout: title\n---\n# Systems diagrams\n\nRank 18 native / hybrid review", ...fragments].join("\n\n---\n\n");
const customPalette = "--bg:#102030;--print-slide-bg:#102030;--print-cover-bg:#102030;--topbar:#ff6600;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;";
const browser = findChromiumBrowser();
await mkdir(output, { recursive: true });
await writeFile(join(output, "provenance.json"), JSON.stringify({
  commit: git("rev-parse", "HEAD"), branch: git("branch", "--show-current"),
  changes: git("status", "--porcelain"), diffSha256: hash(git("diff", "HEAD")),
  sourceHashes: before, bundledMermaid: "11.15.0", node: process.version, browser, customPalette,
  diagrams: names.map((name, index) => ({ page: index + 2, fixture: name })),
  method: "Source PNG: runtime captureSlides; PPTX: exportPptx/runPptxOutputBrowser with the same full browser; comparison right: desktop PowerPoint COM export. Independent image review required.",
}, null, 2));
for (const theme of ["dark", "light", "microsoft", "custom"]) {
  const directory = join(output, theme);
  await mkdir(directory, { recursive: true });
  const file = join(directory, "slides.md");
  await writeFile(file, markdown);
  if (theme === "custom") await writeFile(join(directory, "theme.css"), `:root{${customPalette}}`);
  await withDeckServer({
    file, workspace: directory, theme, ...(theme === "custom" ? { themeFile: "theme.css" } : {}),
  }, async (session) => {
    const references = await captureSlides(session, names.map((_, index) => index + 1),
      join(directory, "original"), theme);
    await writeFile(join(directory, "original-layout.json"), JSON.stringify(references, null, 2));
    let rendered;
    assert.equal(findChromiumBrowser(), browser);
    const report = await exportPptx(session, join(directory, "editable-hybrid.pptx"), theme, {
      runPptxOutputBrowser: async (...args) => {
        rendered = await runPptxOutputBrowser(...args);
        return rendered;
      },
    });
    const pptx = await readFile(join(directory, "editable-hybrid.pptx"));
    assert.equal(inspectPptxPackage(pptx).valid, true);
    const paintOrder = [];
    for (let slideIndex = 1; slideIndex <= names.length; slideIndex++) {
      const slide = rendered.model.slides[slideIndex];
      const native = slide.elements.filter((element) => element.path?.startsWith("mermaid[0]."));
      const fallbacks = slide.fallbacks.filter((fallback) => fallback.type === "mermaid");
      assert.equal(fallbacks.length, expectedFallbacks.get(names[slideIndex - 1]), `${names[slideIndex - 1]}: local fallback count`);
      assert.ok(native.some((element) => element.type === "text"), `${names[slideIndex - 1]}: native text`);
      assert.ok(native.some((element) => element.type !== "text"), `${names[slideIndex - 1]}: native geometry`);
      for (const fallback of fallbacks) {
        assert.ok(fallback.path && fallback.reason, "Fallback diagnostics identify source and reason.");
        assert.notEqual(fallback.path, "mermaid[0]", "Basic systems diagrams must not fall back as a whole.");
      }
      paintOrder.push({ page: slideIndex + 1, objects: [...native, ...fallbacks].sort((a, b) => a.zOrder - b.zOrder) });
      for (const image of rendered.slideFallbackImages[slideIndex]) {
        if (slide.fallbacks[image.fallbackIndex].type !== "mermaid") continue;
        assert.ok(image.width > 0 && image.width < 1280 && image.height > 0 && image.height < 720);
        assert.ok(pptx.indexOf(image.data) > 0, "Local fallback is embedded in the actual package.");
        await writeFile(join(directory, `slide-${slideIndex + 1}-fallback-${image.fallbackIndex}.png`), image.data);
      }
    }
    await writeFile(join(directory, "paint-order.json"), JSON.stringify(paintOrder, null, 2));
    await writeFile(join(directory, "export-report.json"), JSON.stringify(report, null, 2));
    await writeFile(join(directory, "model.json"), JSON.stringify(rendered.model, null, 2));
    console.log(`${theme}: ${join(directory, "editable-hybrid.pptx")} (fallbacks ${paintOrder.map((entry) =>
      entry.objects.filter((object) => object.type === "mermaid").length)})`);
  });
}
assert.deepEqual(await sourceHashes(), before, "Implementation and fixture sources must stay unchanged throughout visual capture.");
await writeFile(join(output, "index.html"), `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Mermaid systems: source / PowerPoint</title>
<style>
body{margin:0 auto;padding:24px;max-width:1600px;background:#13202f;color:#eef3f8;font:16px system-ui}
a{color:#91caff}nav{display:flex;gap:20px;flex-wrap:wrap}section{margin-top:48px}
figure{margin:28px 0}figcaption{margin:8px 0}img{width:100%;height:auto;border:1px solid #596777}
</style>
<h1>Mermaid systems: source / PowerPoint</h1>
<p>Left: MarkdStage source. Right: actual desktop PowerPoint rendering.
Run the companion PowerPoint rendering script before opening this gallery.</p>
<nav>${["dark", "light", "microsoft", "custom"].map((theme) => `<a href="#${theme}">${theme}</a>`).join("")}</nav>
${["dark", "light", "microsoft", "custom"].map((theme) => `<section id="${theme}">
<h2>${theme}</h2><a href="${theme}/editable-hybrid.pptx">Editable PowerPoint</a>
${names.map((name, index) => `<figure><figcaption>${index + 2}: ${name}</figcaption>
<a href="${theme}/comparisons/slide-${String(index + 2).padStart(3, "0")}.png">
<img loading="lazy" alt="${name}: source left, PowerPoint right" src="${theme}/comparisons/slide-${String(index + 2).padStart(3, "0")}.png"></a>
</figure>`).join("")}</section>`).join("")}
</html>`);
