import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { withDeckServer } from "../../packages/markdstage-cli/src/deck.mjs";
import { createOutputJob, createOutputSnapshot, exportPptx } from "../../.github/extensions/markdstage/runtime/output.mjs";
import { runPptxOutputBrowser } from "../../.github/extensions/markdstage/hosts/node/browser.mjs";
import { cardFence, staticCard } from "../harness/adaptive-cards.mjs";
import { readSystemsPackage } from "../utils/systems-fallback-contract.mjs";

test("actual PPTX keeps shared card opacity as one composited picture with both visible labels", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const workspace = testInfo.outputPath("workspace");
  await mkdir(workspace, { recursive: true });
  const file = join(workspace, "context.md");
  await writeFile(file, [
    "## Shared paint context",
    '<div style="opacity:0.55;background:#305070;padding:10px">',
    cardFence(staticCard([{ type: "TextBlock", id: "first", text: "First composite card" }])),
    cardFence(staticCard([{ type: "TextBlock", id: "second", text: "Second composite card" }])),
    "</div>",
    "Outside native neighbor.",
  ].join("\n\n"));
  await withDeckServer({ file, workspace, theme: "dark" }, async (session) => {
    const token = crypto.randomUUID();
    session.exportJobs.set(token, createOutputJob(createOutputSnapshot(session), "capture"));
    await page.goto(`${session.url}?capture=1&token=${token}&index=0`);
    await expect(page.locator("html")).toHaveAttribute("data-capture-ready", "true");
    const regions = await page.evaluate(async () => {
      const { getAdaptiveCardModel } = await import("./renderer/adaptive-card.mjs");
      return [...document.querySelectorAll(".adaptive-card-host")].map((host) => {
        const box = getAdaptiveCardModel(host).getItemAt(0).renderedElement.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      });
    });
    let rendered;
    const report = await exportPptx(session, "context.pptx", undefined, {
      findChromiumBrowser: () => chromium.executablePath(),
      runPptxOutputBrowser: async (...args) => { rendered = await runPptxOutputBrowser(...args); return rendered; },
    });
    expect(report.adaptiveCardConversionSummary).toEqual({ nativeObjects: 0, approximated: 0, rasterizedSubtrees: 1 });
    const slide = rendered.model.slides[0];
    const captures = rendered.slideFallbackImages[0].filter((capture) => slide.fallbacks[capture.fallbackIndex].type === "adaptive-card");
    expect(captures).toHaveLength(1);
    const [capture] = captures;
    const pixels = await page.evaluate(async ({ base64, capture, regions }) => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d", { willReadFrequently: true }); context.drawImage(image, 0, 0);
      return regions.map((region) => {
        const pixels = context.getImageData(Math.floor(region.x - capture.x), Math.floor(region.y - capture.y),
          Math.floor(region.width), Math.floor(region.height)).data;
        let glyphs = 0;
        for (let offset = 0; offset < pixels.length; offset += 4) {
          if ([0, 1, 2].every((channel) => pixels[offset + channel] > 180) &&
              pixels[offset + 3] >= 130 && pixels[offset + 3] <= 145) glyphs++;
        }
        return glyphs;
      });
    }, { base64: capture.data.toString("base64"), capture: { x: capture.x, y: capture.y }, regions });
    expect(pixels.every((count) => count > 10)).toBe(true);
    const bytes = await readFile(join(workspace, "context.pptx"));
    const xml = readSystemsPackage(bytes).get("ppt/slides/slide1.xml").toString("utf8");
    expect(xml.match(/name="adaptive-card artwork"/g)).toHaveLength(1);
    expect(xml).not.toContain("First composite card");
    expect(xml).not.toContain("Second composite card");
    expect(xml).toContain("Outside native neighbor.");
  });
});
