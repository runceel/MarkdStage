import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { exportPptx } from "../../.github/extensions/markdstage/runtime/output.mjs";
import { runPptxOutputBrowser } from "../../.github/extensions/markdstage/hosts/node/browser.mjs";
import { inspectPptxPackage } from "../../.github/extensions/markdstage/runtime/pptx-package.mjs";
import {
  BACKGROUND_COLORS,
  backgroundSlide,
  openBackgroundOutput,
  pngPixel,
  withBackgroundDeck,
} from "../utils/backgrounds.mjs";

test("PPTX backgrounds stay on the correct layout and survive real package export", async ({ page }) => {
  test.setTimeout(120_000);
  await withBackgroundDeck({
    slides: [
      backgroundSlide("title"),
      backgroundSlide("title", "/assets/override.svg"),
      backgroundSlide("default"),
      backgroundSlide("default", "/assets/override.svg"),
      backgroundSlide("default", "/assets/other.svg"),
      backgroundSlide("default", "assets/override.svg"),
      backgroundSlide("center", "/assets/override.svg"),
      backgroundSlide("section", "/assets/override.svg"),
      backgroundSlide("backcover", "/assets/override.svg"),
    ],
  }, async ({ session, dir }) => {
    await openBackgroundOutput(page, session, "pptx");
    const model = await page.evaluate(() => window.__presentationPptxModel);
    expect(model.slides.map((slide) => slide.layoutId).slice(0, 5)).toEqual([
      "custom:title",
      "custom:title:background-1",
      "custom:default",
      "custom:default:background-2",
      "custom:default:background-3",
    ]);
    expect(model.slides[5].layoutId).toBe(model.slides[3].layoutId);
    expect(model.layouts).toHaveLength(11);
    expect(model.masters[0].layoutIds).toEqual(model.layouts.map((layout) => layout.id));
    expect(model.layouts.map((layout) => layout.captureIndex)).toEqual(
      model.layouts.map((_, index) => model.slides.length + index),
    );
    for (const slide of model.slides) {
      expect(slide.elements.some((element) => element.type === "text")).toBe(true);
      expect(slide.elements.some((element) => element.type === "image")).toBe(false);
      expect(slide.fallbacks.filter((fallback) =>
        /slide-background|unsupported-image/.test(`${fallback.path} ${fallback.reason}`))).toEqual([]);
    }

    const masks = await page.evaluate(() => {
      document.body.classList.remove("pptx-layout-artwork-mode");
      document.body.classList.add("pptx-slide-artwork-mode");
      return {
        slides: [...document.querySelectorAll(".deck:not(.pptx-layout-template)>.slide-background")]
          .map((image) => getComputedStyle(image).visibility),
        layouts: [...document.querySelectorAll(".pptx-layout-template>.slide-background")]
          .map((image) => getComputedStyle(image).visibility),
      };
    });
    expect(masks.slides).toEqual(Array(9).fill("hidden"));
    expect(masks.layouts.length).toBeGreaterThan(0);
    expect(masks.layouts.every((visibility) => visibility === "visible")).toBe(true);

    let captured;
    await exportPptx(session, "backgrounds.pptx", undefined, {
      findChromiumBrowser: () => chromium.executablePath(),
      runPptxOutputBrowser: async (...args) => {
        captured = await runPptxOutputBrowser(...args);
        return captured;
      },
    });
    const summary = inspectPptxPackage(await readFile(join(dir, "backgrounds.pptx")));
    expect(summary.valid).toBe(true);
    expect(summary.slideCount).toBe(model.slides.length);
    expect(summary.layoutCount).toBe(model.layouts.length);
    const expectedColors = ["cover", "override", "default", "override", "other", "override", "override", "override", "override"];
    for (const [index, name] of expectedColors.entries()) {
      const layoutIndex = captured.model.layouts.findIndex(
        (layout) => layout.id === captured.model.slides[index].layoutId,
      );
      expect(await pngPixel(page, captured.layoutArtworks[layoutIndex])).toEqual(
        BACKGROUND_COLORS[name],
      );
    }
  });
});
