import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { withDeckServer } from "../../packages/markdstage-cli/src/deck.mjs";
import { createOutputJob, createOutputSnapshot, exportPptx } from "../../.github/extensions/markdstage/runtime/output.mjs";
import { runPptxOutputBrowser } from "../../.github/extensions/markdstage/hosts/node/browser.mjs";
import { inspectPptxPackage } from "../../.github/extensions/markdstage/runtime/pptx-package.mjs";
import { CARD_FIXTURE_DIRECTORY, adaptiveCardSlides, cardFence, staticCard, placementSlide } from "../harness/adaptive-cards.mjs";
import { readSystemsPackage } from "../utils/systems-fallback-contract.mjs";
import { startHarness } from "../harness/server.mjs";

test("real PPTX embeds one transparent, bounded card capture, without generic duplicates", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const workspace = testInfo.outputPath("workspace");
  await mkdir(workspace, { recursive: true });
  await cp(join(CARD_FIXTURE_DIRECTORY, "assets"), join(workspace, "assets"), { recursive: true });
  const slides = [...await adaptiveCardSlides(), placementSlide];
  const source = join(workspace, "cards.md");
  await writeFile(source, slides.join("\n\n---\n\n"));
  await withDeckServer({ file: source, workspace, theme: "dark" }, async (session) => {
    const token = crypto.randomUUID();
    session.exportJobs.set(token, createOutputJob(createOutputSnapshot(session), "capture"));
    await page.goto(`${session.url}?capture=1&token=${token}&index=6`);
    await expect(page.locator("html")).toHaveAttribute("data-capture-ready", "true");
    const visibleOrder = await page.evaluate(async () => {
      const { getAdaptiveCardModel } = await import("./renderer/adaptive-card.mjs");
      const host = document.querySelector(".adaptive-card-host");
      const text = getAdaptiveCardModel(host).getItemAt(0).getItemAt(0).renderedElement;
      const box = text.getBoundingClientRect();
      const foreground = [...document.querySelectorAll(".body p")].find((element) => element.textContent.includes("Native foreground neighbor"));
      const front = foreground.getBoundingClientRect();
      return {
        cardAboveBackground: document.elementFromPoint(box.x + 2, box.y + 2) === host,
        nativeAboveCard: foreground.contains(document.elementFromPoint(front.x + 2, front.y + 2)),
      };
    });
    expect(visibleOrder).toEqual({ cardAboveBackground: true, nativeAboveCard: true });
    session.exportJobs.delete(token);
    let rendered;
    const report = await exportPptx(session, "cards.pptx", undefined, {
      findChromiumBrowser: () => chromium.executablePath(),
      runPptxOutputBrowser: async (...args) => {
        rendered = await runPptxOutputBrowser(...args);
        return rendered;
      },
    });
    expect(report.ok).toBe(true);
    const bytes = await readFile(join(workspace, "cards.pptx"));
    expect(inspectPptxPackage(bytes).valid).toBe(true);
    const files = readSystemsPackage(bytes);
    for (const [index, slide] of rendered.model.slides.slice(0, slides.length).entries()) {
      const cards = slide.fallbacks.filter((fallback) => fallback.type === "adaptive-card");
      expect(cards).toHaveLength(1);
      expect(cards[0].path).toBe("adaptive-card[0]");
      expect(cards[0].reason).toBe(index === 5 ? "adaptive-card-unsupported-element" : "adaptive-card-phase-0-raster");
      if (index !== 5) expect(cards[0].diagnostics).toBeUndefined();
      expect(cards[0].captureId).toBeTruthy();
      expect(slide.fallbacks.filter((fallback) => fallback.type === "html")).toHaveLength(index === 6 ? 1 : 0);
      const capture = rendered.slideFallbackImages[index].find((image) => slide.fallbacks[image.fallbackIndex] === cards[0]);
      expect(capture.x).toBe(Math.floor(cards[0].x));
      expect(capture.y).toBe(Math.floor(cards[0].y));
      expect(capture.x + capture.width).toBeLessThanOrEqual(1280);
      expect(capture.y + capture.height).toBeLessThanOrEqual(720);
      const png = await page.evaluate(async (base64) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, image.width, image.height).data;
        let transparent = 0, opaque = 0, bottomPaint = 0;
        for (let offset = 3; offset < pixels.length; offset += 4) {
          if (pixels[offset] === 0) transparent++;
          if (pixels[offset] === 255) opaque++;
          if (offset > pixels.length - image.width * 4 && pixels[offset] > 0) bottomPaint++;
        }
        return { width: image.width, height: image.height, transparent, opaque, bottomPaint };
      }, capture.data.toString("base64"));
      expect(png.width).toBe(capture.width);
      expect(png.height).toBe(capture.height);
      expect(png.transparent).toBeGreaterThan(0);
      expect(png.opaque).toBeGreaterThan(0);
      if (index === 4) expect(png.bottomPaint).toBe(0);
      const rels = files.get(`ppt/slides/_rels/slide${index + 1}.xml.rels`).toString("utf8");
      const xml = files.get(`ppt/slides/slide${index + 1}.xml`).toString("utf8");
      const pictures = await page.evaluate(({ xml, rels }) => {
        const parser = new DOMParser();
        const relations = [...parser.parseFromString(rels, "application/xml").getElementsByTagName("Relationship")];
        return [...parser.parseFromString(xml, "application/xml").getElementsByTagName("p:pic")].map((picture) => {
          const id = picture.getElementsByTagName("a:blip")[0].getAttribute("r:embed");
          return relations.find((relation) => relation.getAttribute("Id") === id).getAttribute("Target");
        });
      }, { xml, rels });
      expect(pictures.filter((target) => files.get(posix.normalize(posix.join("ppt/slides", target))).equals(capture.data))).toHaveLength(1);
      await writeFile(testInfo.outputPath(`card-${index + 1}.png`), capture.data);
    }
    const placement = rendered.model.slides[6];
    const card = placement.fallbacks.find((fallback) => fallback.type === "adaptive-card");
    const html = placement.fallbacks.find((fallback) => fallback.type === "html");
    const foreground = placement.elements.find((element) => element.paragraphs?.some((paragraph) =>
      paragraph.runs.some((run) => run.text.includes("Native foreground neighbor"))));
    expect(html.zOrder).toBeLessThan(card.zOrder);
    expect(foreground.zOrder).toBeGreaterThan(card.zOrder);
    const xml = files.get("ppt/slides/slide7.xml").toString("utf8");
    expect(xml.indexOf("adaptive-card artwork")).toBeGreaterThanOrEqual(0);
    expect(xml.indexOf("adaptive-card artwork")).toBeLessThan(xml.indexOf("Native foreground neighbor"));
    await writeFile(testInfo.outputPath("export-report.json"), JSON.stringify(report, null, 2));
    await writeFile(testInfo.outputPath("model.json"), JSON.stringify(rendered.model, null, 2));
    await testInfo.attach("actual-pptx", { path: join(workspace, "cards.pptx"),
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
  });
});

test("capture cannot bypass the pre-render image approval", async ({ page }) => {
  const harness = await startHarness({ slides: [cardFence(staticCard([
    { type: "Image", id: "image", url: "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='2'%20height='2'%3E%3C/svg%3E" },
  ]))] });
  try {
    await page.goto(`${harness.url}/?print=1&token=${harness.printToken}`);
    await expect(page.locator("html")).toHaveAttribute("data-print-ready", "true");
    const result = await page.evaluate(async () => {
      const { getAdaptiveCardModel, assertAdaptiveCardCaptureSafe } = await import("./renderer/adaptive-card.mjs");
      const host = document.querySelector(".adaptive-card-host");
      assertAdaptiveCardCaptureSafe(host);
      getAdaptiveCardModel(host).getItemAt(0).url = "https://blocked.example/late.png";
      try { assertAdaptiveCardCaptureSafe(host); return "not rejected"; }
      catch (error) { return error.code; }
    });
    expect(result).toBe("blocked-image");
  } finally { await harness.close(); }
});
