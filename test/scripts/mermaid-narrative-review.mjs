// node test\scripts\mermaid-narrative-review.mjs <absolute-artifact-directory>
// Then render-kanban-block-review.ps1 -ArtifactDirectory <directory> -PageNumbers (2..7).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { withDeckServer } from "../../packages/markdstage-cli/src/deck.mjs";
import { captureSlides, exportPptx } from "../../.github/extensions/markdstage/runtime/output.mjs";
import { findChromiumBrowser, runPptxOutputBrowser } from "../../.github/extensions/markdstage/runtime/browser.mjs";
import { inspectPptxPackage } from "../../.github/extensions/markdstage/runtime/pptx-package.mjs";

const output = process.argv[2];
if (!output || !isAbsolute(output)) throw new Error("Provide an absolute artifact directory.");
const changes = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
assert.equal(changes, "", "Visual evidence must come from a clean committed tree.");
const fixtureDirectory = resolve("test", "fixtures", "mermaid");
const diagrams = [
  ["Mindmap: native nodes, branches, multiline labels", "mindmap-basic"],
  ["Mindmap: native labels / local cloud and bang", "mindmap-hybrid"],
  ["Timeline: native cards (event filter disabled in source)", "timeline-basic"],
  ["Timeline: original event brightness / local shadow", "timeline-hybrid"],
  ["Journey: native tasks, people and neutral faces", "journey-basic"],
  ["Journey: native tasks / local happy and sad mouth arcs", "journey-hybrid"],
];
const expectedFallbacks = [0, 2, 0, 6, 0, 2];
const fragments = [];
for (const [title, name] of diagrams) {
  fragments.push(`## ${title}\n\n\`\`\`mermaid\n${await readFile(join(fixtureDirectory, `${name}.mmd`), "utf8")}\n\`\`\``);
}
const markdown = ["# Basic narrative diagrams\n\nRank 17 native / hybrid review", ...fragments].join("\n\n---\n\n");
const customPalette = "--bg:#102030;--print-slide-bg:#102030;--print-cover-bg:#102030;--topbar:#ff6600;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;";
// Both runtime capture and export deliberately use the same full browser.
const browser = findChromiumBrowser();
await mkdir(output, { recursive: true });
await writeFile(join(output, "provenance.json"), JSON.stringify({
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  branch: execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(),
  changes, bundledMermaid: "11.15.0", node: process.version, browser, customPalette,
  diagrams: diagrams.map(([title, name], index) => ({ page: index + 2, title, fixture: name })),
  expectedFallbacks,
  method: "Source PNG: actual runtime captureSlides; PPTX: exportPptx/runPptxOutputBrowser using the same full browser; comparison right: desktop PowerPoint COM PNG export. Independent review still required.",
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
    const references = await captureSlides(session, diagrams.map((_, index) => index + 1),
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
    const counts = rendered.model.slides.slice(1, 7).map((slide) =>
      slide.fallbacks.filter((fallback) => fallback.type === "mermaid").length);
    assert.deepEqual(counts, expectedFallbacks);
    const paintOrder = [];
    for (let slideIndex = 1; slideIndex <= diagrams.length; slideIndex++) {
      const slide = rendered.model.slides[slideIndex];
      paintOrder.push({ page: slideIndex + 1, objects: [
        ...slide.elements.filter((element) => element.path?.startsWith("mermaid[0].")),
        ...slide.fallbacks.filter((fallback) => fallback.type === "mermaid"),
      ].sort((a, b) => a.zOrder - b.zOrder) });
      for (const image of rendered.slideFallbackImages[slideIndex]) {
        const fallback = slide.fallbacks[image.fallbackIndex];
        if (fallback.type !== "mermaid") continue;
        assert.ok(image.width > 0 && image.width < 1280 && image.height > 0 && image.height < 720);
        const first = pptx.indexOf(image.data);
        assert.ok(first > 0);
        assert.equal(pptx.indexOf(image.data, first + 1), -1);
        await writeFile(join(directory, `slide-${slideIndex + 1}-fallback-${image.fallbackIndex}.png`), image.data);
      }
    }
    await writeFile(join(directory, "paint-order.json"), JSON.stringify(paintOrder, null, 2));
    await writeFile(join(directory, "export-report.json"), JSON.stringify(report, null, 2));
    await writeFile(join(directory, "model.json"), JSON.stringify(rendered.model, null, 2));
    console.log(`${theme}: ${join(directory, "editable-hybrid.pptx")} (fallbacks ${counts})`);
  });
}
