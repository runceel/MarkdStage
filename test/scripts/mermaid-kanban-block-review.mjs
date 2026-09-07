// Reproduce source PNGs and actual editable/hybrid PowerPoint exports for an independent review.
// node test\scripts\mermaid-kanban-block-review.mjs <absolute-output-directory>
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { withDeckServer } from "../../packages/markdstage-cli/src/deck.mjs";
import { captureSlides, exportPptx } from "../../.github/extensions/markdstage/runtime/output.mjs";
import { runPptxOutputBrowser } from "../../.github/extensions/markdstage/runtime/browser.mjs";
import { inspectPptxPackage } from "../../.github/extensions/markdstage/runtime/pptx-package.mjs";

const output = process.argv[2];
if (!output || !isAbsolute(output)) throw new Error("Provide an absolute artifact directory.");
const fixtureDirectory = resolve("test", "fixtures", "mermaid");
const sources = [];
for (const name of ["kanban-basic", "block-basic", "block-hybrid"]) {
  sources.push(await readFile(join(fixtureDirectory, `${name}.mmd`), "utf8"));
}
const decoratedKanban = sources[0].replace("Review **API**", "<u>Review API</u>");
const decoratedBlock = sources[2].replace("Decorated label", "<u>Decorated label</u>");
const diagrams = [
  ["Kanban: native fields", sources[0]],
  ["Block: native shapes", sources[1]],
  ["Block: local special outline", sources[2]],
  ["Kanban: local decorated label", decoratedKanban],
  ["Block: local outline and label", decoratedBlock],
];
const markdown = [
  "# Kanban and block\n\nRank 12 editable / hybrid review",
  ...diagrams.map(([title, source]) => `## ${title}\n\n\`\`\`mermaid\n${source}\n\`\`\``),
].join("\n\n---\n\n");
await mkdir(output, { recursive: true });
for (const theme of ["dark", "light", "microsoft", "custom"]) {
  const directory = join(output, theme);
  await mkdir(directory, { recursive: true });
  const file = join(directory, "slides.md");
  await writeFile(file, markdown);
  const themeFile = join(directory, "theme.css");
  if (theme === "custom") {
    await writeFile(themeFile, ":root{--bg:#102030;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;}");
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
    assert.deepEqual(rendered.model.slides.slice(1, 3).flatMap((slide) =>
      slide.fallbacks.filter((fallback) => fallback.type === "mermaid")), []);
    const fallbackCounts = rendered.model.slides.slice(3, 6).map((slide) =>
      slide.fallbacks.filter((fallback) => fallback.type === "mermaid").length);
    assert.deepEqual(fallbackCounts, [1, 1, 2]);
    for (let slideIndex = 3; slideIndex < 6; slideIndex++) {
      const slide = rendered.model.slides[slideIndex];
      for (const image of rendered.slideFallbackImages[slideIndex]) {
        const fallback = slide.fallbacks[image.fallbackIndex];
        if (fallback.type !== "mermaid") continue;
        assert.ok(image.data.length > 100);
        assert.ok(image.width > 0 && image.height > 0);
        assert.ok(pptx.includes(image.data), "Actual local PNG must be embedded in the package.");
        await writeFile(join(directory, `slide-${slideIndex + 1}-fallback-${image.fallbackIndex}.png`), image.data);
      }
    }
    await writeFile(join(directory, "export-report.json"), JSON.stringify(report, null, 2));
    await writeFile(join(directory, "model.json"), JSON.stringify(rendered.model, null, 2));
    console.log(`${theme}: ${join(directory, "editable-hybrid.pptx")} (hybrid fallbacks ${fallbackCounts})`);
  });
}
