// node test\scripts\mermaid-gantt-review.mjs <absolute-output-directory>
// Then render-kanban-block-review.ps1 -ArtifactDirectory <directory> -PageNumbers (2..7).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { withDeckServer } from "../../packages/markdstage-cli/src/deck.mjs";
import { captureSlides, exportPptx } from "../../.github/extensions/markdstage/runtime/output.mjs";
import { runPptxOutputBrowser } from "../../.github/extensions/markdstage/hosts/node/browser.mjs";
import { inspectPptxPackage } from "../../.github/extensions/markdstage/runtime/pptx-package.mjs";

const output = process.argv[2];
if (!output || !isAbsolute(output)) throw new Error("Provide an absolute artifact directory.");
const changes = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
assert.equal(changes, "", "Visual evidence must come from a clean committed tree.");
const fixtureDirectory = resolve("test", "fixtures", "mermaid");
const diagrams = [
  ["Gantt: native tasks and milestones", "gantt-basic"],
  ["Gantt: exclusions and multiline sections", "gantt-periods"],
  ["Gantt: rotated date labels", "gantt-ticks"],
  ["Gantt: local task shadow", "gantt-hybrid"],
  ["Gantt: unusual milestone and label", "gantt-milestone-hybrid"],
  ["Gantt: uncertain top-axis overlap", "gantt-basic"],
];
const fragments = [];
for (const [index, [title, name]] of diagrams.entries()) {
  const source = await readFile(join(fixtureDirectory, `${name}.mmd`), "utf8");
  fragments.push(`## ${title}\n\n\`\`\`mermaid\n${index === 5 ? '%%{init: {"gantt": {"topAxis": true}}}%%\n' : ""}${source}\n\`\`\``);
}
const markdown = ["# Gantt editable export\n\nRank 14 native / hybrid review", ...fragments].join("\n\n---\n\n");
await mkdir(output, { recursive: true });
await writeFile(join(output, "provenance.json"), JSON.stringify({
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  changes, bundledMermaid: "11.15.0", node: process.version,
  diagrams: diagrams.map(([title, name], index) => ({ page: index + 2, title, fixture: name })),
  expectedFallbacks: [0, 0, 0, 1, 2, 8],
  method: "Source PNG: runtime captureSlides; PPTX: actual exportPptx/runPptxOutputBrowser; comparison right: desktop PowerPoint COM PNG export.",
}, null, 2));
for (const theme of ["dark", "light", "microsoft", "custom"]) {
  const directory = join(output, theme);
  await mkdir(directory, { recursive: true });
  const file = join(directory, "slides.md");
  await writeFile(file, markdown);
  if (theme === "custom") {
    await writeFile(join(directory, "theme.css"), ":root{--bg:#102030;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;}");
  }
  await withDeckServer({
    file, workspace: directory, theme, ...(theme === "custom" ? { themeFile: "theme.css" } : {}),
  }, async (session) => {
    const references = await captureSlides(session, diagrams.map((_, index) => index + 1),
      join(directory, "original"), theme);
    await writeFile(join(directory, "original-layout.json"), JSON.stringify(references, null, 2));
    let rendered;
    const report = await exportPptx(session, join(directory, "editable-hybrid.pptx"), theme, {
      findChromiumBrowser: () => chromium.executablePath(),
      runPptxOutputBrowser: async (...args) => {
        rendered = await runPptxOutputBrowser(...args);
        return rendered;
      },
    });
    const pptx = await readFile(join(directory, "editable-hybrid.pptx"));
    assert.equal(inspectPptxPackage(pptx).valid, true);
    const counts = rendered.model.slides.slice(1, 7).map((slide) =>
      slide.fallbacks.filter((fallback) => fallback.type === "mermaid").length);
    assert.deepEqual(counts, [0, 0, 0, 1, 2, 8]);
    const paintOrder = [];
    for (let slideIndex = 1; slideIndex < 7; slideIndex++) {
      const slide = rendered.model.slides[slideIndex];
      paintOrder.push({ page: slideIndex + 1, objects: [
        ...slide.elements.filter((element) => element.path?.startsWith("mermaid[0].")),
        ...slide.fallbacks.filter((fallback) => fallback.type === "mermaid"),
      ].sort((a, b) => a.zOrder - b.zOrder) });
      for (const image of rendered.slideFallbackImages[slideIndex]) {
        const fallback = slide.fallbacks[image.fallbackIndex];
        if (fallback.type !== "mermaid") continue;
        assert.ok(image.width > 0 && image.height > 0);
        const first = pptx.indexOf(image.data);
        assert.ok(first > 0, "Actual fallback image must be embedded.");
        assert.equal(pptx.indexOf(image.data, first + 1), -1, "Fallback image must not be duplicated.");
        await writeFile(join(directory, `slide-${slideIndex + 1}-fallback-${image.fallbackIndex}.png`), image.data);
      }
    }
    await writeFile(join(directory, "paint-order.json"), JSON.stringify(paintOrder, null, 2));
    await writeFile(join(directory, "export-report.json"), JSON.stringify(report, null, 2));
    await writeFile(join(directory, "model.json"), JSON.stringify(rendered.model, null, 2));
    console.log(`${theme}: ${join(directory, "editable-hybrid.pptx")} (Gantt fallback counts ${counts})`);
  });
}
