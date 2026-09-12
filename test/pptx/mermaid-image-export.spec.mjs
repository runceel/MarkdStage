import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, chromium } from "@playwright/test";
import { withDeckServer } from "../../packages/markdstage-cli/src/deck.mjs";
import { exportPptx } from "../../.github/extensions/markdstage/runtime/output.mjs";
import { runPptxOutputBrowser } from "../../.github/extensions/markdstage/hosts/node/browser.mjs";
import { inspectPptxPackage } from "../../.github/extensions/markdstage/runtime/pptx-package.mjs";
import { clickMoreControl } from "../utils/nav.mjs";
import { waitForSlideReady } from "../utils/ready.mjs";

async function captureMermaidReferences(profileDir) {
  const port = (await readFile(join(profileDir, "DevToolsActivePort"), "utf8")).split(/\r?\n/)[0];
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0];
  try {
    const model = await page.evaluate(() => window.__presentationPptxModel);
    await page.evaluate(() => {
      document.body.classList.remove("pptx-layout-artwork-mode");
      document.body.classList.add("pptx-slide-artwork-mode");
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setDefaultBackgroundColorOverride", {
      color: { r: 0, g: 0, b: 0, a: 0 },
    });
    const references = [];
    for (const [slideIndex, slide] of model.slides.entries()) {
      const images = [];
      for (const [fallbackIndex, fallback] of slide.fallbacks.entries()) {
        if (fallback.type !== "mermaid") continue;
        await page.evaluate((captureId) => {
          for (const element of document.querySelectorAll("[data-pptx-fallback-ids]")) {
            const ids = element.getAttribute("data-pptx-fallback-ids").split(/\s+/);
            // Isolate a full-slide reference without changing layout. Some Mermaid
            // descendants explicitly override inherited visibility.
            element.style.opacity = ids.includes(captureId) ? "" : "0";
          }
          return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }, fallback.captureId);
        const screenshot = await cdp.send("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: true,
          clip: { x: 0, y: slideIndex * 720, width: 1280, height: 720, scale: 1 },
        });
        images.push({ fallbackIndex, data: Buffer.from(screenshot.data, "base64") });
      }
      references.push(images);
    }
    return references;
  } finally {
    await page.evaluate(() => {
      document.body.classList.add("pptx-layout-artwork-mode");
      document.body.classList.remove("pptx-slide-artwork-mode");
      for (const element of document.querySelectorAll("[data-pptx-fallback-ids]")) {
        element.style.removeProperty("opacity");
      }
    });
    await browser.close();
  }
}

async function compareArtwork(page, reference, picture) {
  return page.evaluate(async ({ reference, picture }) => {
    const decode = async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      return image;
    };
    const [original, cropped] = await Promise.all([decode(reference), decode(picture.data)]);
    const canvas = document.createElement("canvas");
    canvas.width = original.width;
    canvas.height = original.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(original, 0, 0);
    const expected = context.getImageData(0, 0, canvas.width, canvas.height).data;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(cropped, picture.x, picture.y);
    const actual = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width;
    let top = canvas.height;
    let right = 0;
    let bottom = 0;
    let changedPixels = 0;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const index = (y * canvas.width + x) * 4;
        if (expected[index + 3]) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x + 1);
          bottom = Math.max(bottom, y + 1);
        }
        if ([0, 1, 2, 3].some(channel => expected[index + channel] !== actual[index + channel])) {
          changedPixels++;
        }
      }
    }
    return {
      changedPixels,
      pngWidth: cropped.width,
      pngHeight: cropped.height,
      painted: { x: left, y: top, width: right - left, height: bottom - top },
    };
  }, {
    reference: reference.toString("base64"),
    picture: { ...picture, data: picture.data.toString("base64") },
  });
}

test("UI image selection produces a whole-diagram PNG in a real PowerPoint package", async ({ page }) => {
  test.setTimeout(120_000);
  const dir = await mkdtemp(join(tmpdir(), "markdstage-mermaid-export-"));
  const file = join(dir, "slides.md");
  await writeFile(file, [
    "## Export diagram",
    "```mermaid\nflowchart LR\n  A[Browser<br/>Client] -->|request| B[API]\n  style A stroke-width:5px\n```",
    "---",
    "## Later slide with two diagrams",
    "```mermaid\nsequenceDiagram\n  participant A as Client\n  participant B as Server\n  A->>B: Request\n  B-->>A: Response\n```",
    "```mermaid\nflowchart LR\n  C((Start)) --> D[End]\n```",
  ].join("\n\n"));
  let rendered;
  let references;
  try {
    await withDeckServer({
      file,
      workspace: dir,
      application: true,
      exporters: {
        pptx: (session, output, theme, _dependencies, options) => exportPptx(session, output, theme, {
          findChromiumBrowser: () => chromium.executablePath(),
          runPptxOutputBrowser: async (...args) => {
            if (options.mermaidImageFallback) {
              // Pause capture at the existing ready barrier to record uncropped pixels
              // in the very same renderer, not a second potentially different layout.
              let captured = false;
              const job = args[3];
              args[3] = new Proxy(job, {
                get(target, property) {
                  if (property === "status" && target.status === "ready" && !captured) return "pending";
                  return Reflect.get(target, property);
                },
              });
              const exporting = runPptxOutputBrowser(...args);
              try {
                await expect.poll(() => job.status, { timeout: 30_000 }).toBe("ready");
                references = await captureMermaidReferences(args[2]);
              } finally {
                captured = true;
                rendered = await exporting;
              }
            } else {
              rendered = await runPptxOutputBrowser(...args);
            }
            return rendered;
          },
        }, options),
      },
    }, async (_session, server) => {
      await page.goto(server.url);
      await waitForSlideReady(page);
      const dialog = page.getByRole("dialog", { name: "Export PowerPoint" });
      for (const images of [true, false]) {
        await clickMoreControl(page, "#navExportPptx");
        await expect(dialog).toBeVisible();
        if (images) await dialog.getByRole("radio", { name: "Images", exact: true }).check();
        const completed = page.waitForResponse((response) =>
          response.url().endsWith("/export-pptx") && response.request().method() === "POST",
        { timeout: 60_000 });
        await dialog.getByRole("button", { name: "Export", exact: true }).click();
        const response = await completed;
        const report = await response.json();
        expect(response.ok(), JSON.stringify(report)).toBe(true);
        const slide = rendered.model.slides[0];
        const nativeMermaid = slide.elements.filter((element) => element.path?.startsWith("mermaid["));
        const mermaidFallbacks = slide.fallbacks.filter((element) => element.type === "mermaid");
        if (images) {
          expect(nativeMermaid).toHaveLength(0);
          expect(mermaidFallbacks).toHaveLength(1);
          const fallbackIndex = slide.fallbacks.indexOf(mermaidFallbacks[0]);
          const picture = rendered.slideFallbackImages[0].find((image) => image.fallbackIndex === fallbackIndex);
          expect(picture.width).toBeGreaterThan(100);
          expect(picture.height).toBeGreaterThan(20);
          expect(picture.data.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
          expect(picture.data.length).toBeGreaterThan(1000);
        } else {
          expect(nativeMermaid.length).toBeGreaterThan(0);
        }
        expect(slide.elements.some((element) => element.type === "text")).toBe(true);
        const packageData = await readFile(join(dir, "slides.pptx"));
        const summary = inspectPptxPackage(packageData);
        expect(summary.valid).toBe(true);
        expect(summary.slideCount).toBe(rendered.model.slides.length);
        if (images) {
          expect(references.map(images => images.length)).toEqual([1, 2, 0]);
          for (const [slideIndex, referenceImages] of references.entries()) {
            for (const reference of referenceImages) {
              const picture = rendered.slideFallbackImages[slideIndex].find(image =>
                image.fallbackIndex === reference.fallbackIndex);
              const comparison = await compareArtwork(page, reference.data, picture);
              const name = `slide-${slideIndex + 1}-fallback-${picture.fallbackIndex}`;
              const referencePath = test.info().outputPath(`${name}-reference.png`);
              const croppedPath = test.info().outputPath(`${name}-cropped.png`);
              await writeFile(referencePath, reference.data);
              await writeFile(croppedPath, picture.data);
              await test.info().attach(`${name}-reference`, { path: referencePath, contentType: "image/png" });
              await test.info().attach(`${name}-cropped`, { path: croppedPath, contentType: "image/png" });
              expect(comparison.changedPixels, JSON.stringify({
                name, comparison, x: picture.x, y: picture.y,
              })).toBe(0);
              expect(picture.x).toBeGreaterThan(100);
              expect(picture.y).toBeGreaterThan(50);
              expect(picture.width).toBeLessThan(1000);
              expect(picture.height).toBeLessThan(400);
              expect(comparison.pngWidth).toBe(picture.width);
              expect(comparison.pngHeight).toBe(picture.height);
              expect(picture.x).toBe(comparison.painted.x - 2);
              expect(picture.y).toBe(comparison.painted.y - 2);
              expect(picture.width).toBe(comparison.painted.width + 4);
              expect(picture.height).toBe(comparison.painted.height + 4);
              const emu = value => Math.round(value * 9525);
              expect(packageData.toString("utf8")).toContain(
                `<a:off x="${emu(picture.x)}" y="${emu(picture.y)}"/><a:ext cx="${emu(picture.width)}" cy="${emu(picture.height)}"/>`,
              );
            }
          }
        }
        await expect(page.locator("#navExportPptx")).toBeEnabled();
      }
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
