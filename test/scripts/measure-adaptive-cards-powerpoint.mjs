// Compare actual rasterized, baseline-aligned capital glyphs, not DOM Range
// tops or Office TextRange bounds. Both input images must be real renders.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { chromium } from "@playwright/test";

const [root] = process.argv.slice(2);
assert.ok(root && isAbsolute(root), "Provide the absolute adaptive-cards review artifact directory.");
const browser = await chromium.launch();
const report = { method: "Baseline-aligned, non-italic capital glyph ink in actual browser and PowerPoint PNGs.",
  tolerancePx: 3, antialiasCoverageThreshold: 0.25,
  excludes: ["DOM Range baselines", "COM TextRange baselines", "underlines", "italic glyphs", "non-Latin baselines"],
  themes: {} };
try {
  const page = await browser.newPage();
  for (const theme of ["dark", "light", "microsoft", "custom"]) {
    const directory = join(root, theme);
    const model = JSON.parse(await readFile(join(directory, "model.json"), "utf8"));
    const pages = [];
    for (const [index, slide] of model.slides.entries()) {
      const samples = slide.elements.filter((element) => element.adaptiveCard && element.type === "text")
        .flatMap((element) => {
          const run = element.paragraphs?.[0]?.runs?.[0];
          if (!run || !/^[A-Z]/.test(run.text) || run.italic || run.underline ||
              !["Segoe UI", "Segoe UI Semibold", "Segoe UI Light", "Consolas"].includes(run.fontFace)) return [];
          return [{ path: element.path, x: element.x, y: element.y, glyph: run.text[0],
            font: `${run.bold ? "bold " : ""}${run.fontSize}px "${run.fontFace}"`,
            color: run.color, fontSize: run.fontSize }];
        });
      if (!samples.length) continue;
      const file = `slide-${String(index + 1).padStart(3, "0")}.png`;
      const images = await Promise.all(["chromium", "powerpoint"].map(async (kind) =>
        (await readFile(join(directory, kind, file))).toString("base64")));
      const result = await page.evaluate(async ({ images, samples }) => {
        const contexts = await Promise.all(images.map(async (data) => {
          const image = new Image();
          image.src = `data:image/png;base64,${data}`; await image.decode();
          if (image.width !== 1280 || image.height !== 720) throw new Error("Expected actual 1280x720 renders.");
          const canvas = document.createElement("canvas");
          canvas.width = 1280; canvas.height = 720;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(image, 0, 0);
          return context;
        }));
        const metricsContext = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
        const result = [];
        for (const sample of samples) {
          metricsContext.font = sample.font;
          const metrics = metricsContext.measureText(sample.glyph);
          if (metrics.actualBoundingBoxDescent !== 0) continue;
          metricsContext.fillStyle = sample.color;
          metricsContext.fillRect(0, 0, 1, 1);
          const color = metricsContext.getImageData(0, 0, 1, 1).data;
          // One pixel inside the advance excludes the next character, whose
          // descender must not be mistaken for this capital's baseline.
          const x = Math.max(0, Math.floor(sample.x));
          const y = Math.max(0, Math.floor(sample.y - 6));
          const width = Math.max(1, Math.floor(metrics.width) - 1);
          const height = Math.min(720 - y, Math.ceil(metrics.fontBoundingBoxAscent + 12));
          const ink = contexts.map((context) => {
            const pixels = context.getImageData(x, y, width, height).data;
            const colors = new Map();
            for (let offset = 0; offset < pixels.length; offset += 4) {
              const key = `${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`;
              colors.set(key, (colors.get(key) || 0) + 1);
            }
            const background = [...colors].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);
            const vector = background.map((channel, index) => channel - color[index]);
            const magnitude = vector.reduce((sum, channel) => sum + channel * channel, 0);
            if (magnitude < 1024) return null;
            let top = height, bottom = -1, count = 0;
            for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
              const offset = (row * width + column) * 4;
              // A thin ClearType stem can have no near-foreground RGB pixel.
              // Estimate ink coverage against the measured flat background,
              // rather than silently measuring only a capital's top crossbar.
              const coverage = vector.reduce((sum, channel, index) =>
                sum + channel * (background[index] - pixels[offset + index]), 0) / magnitude;
              if (pixels[offset + 3] > 200 && coverage >= 0.25 && coverage <= 1.4 &&
                  [0, 1, 2].every((channel) => Math.abs(pixels[offset + channel] -
                    (background[channel] - coverage * vector[channel])) <= 90)) {
                top = Math.min(top, row); bottom = Math.max(bottom, row); count++;
              }
            }
            return count ? { top: y + top, baseline: y + bottom + 1, pixels: count } : null;
          });
          result.push({ ...sample, region: { x, y, width, height }, browser: ink[0], powerpoint: ink[1],
            baselineDelta: ink.every(Boolean) ? Math.abs(ink[0].baseline - ink[1].baseline) : null });
        }
        return result;
      }, { images, samples });
      pages.push({ page: index + 1, samples: result });
    }
    const samples = pages.flatMap((entry) => entry.samples);
    assert.ok(samples.length >= 20, `${theme}: insufficient actual raster baseline witnesses`);
    const failures = samples.filter((sample) => sample.baselineDelta === null || sample.baselineDelta > 3);
    report.themes[theme] = { pages, samples: samples.length,
      maximumBaselineDelta: Math.max(0, ...samples.map((sample) => sample.baselineDelta || 0)), failures };
    console.log(`${theme}: ${samples.length} actual raster baseline witnesses; ${failures.length} failures.`);
  }
} finally {
  await browser.close();
  await writeFile(join(root, "powerpoint-baseline-measurements.json"), JSON.stringify(report, null, 2) + "\n");
}
assert.deepEqual(Object.values(report.themes).flatMap((theme) => theme.failures), [],
  "Actual PowerPoint text exceeded the baseline tolerance or a visible glyph was missing.");
