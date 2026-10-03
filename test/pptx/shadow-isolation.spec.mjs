import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { withDeckServer } from "../../packages/markdstage-cli/src/deck.mjs";
import { exportPptx } from "../../.github/extensions/markdstage/runtime/output.mjs";
import { runPptxOutputBrowser } from "../../.github/extensions/markdstage/hosts/node/browser.mjs";

// Regression: a padded box-shadow capture used to include the inline-code chip of
// the native text directly above it, and that opaque strip then covered the text.
test("box-shadow artwork never captures neighboring inline-code chips", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const workspace = testInfo.outputPath("workspace");
  await mkdir(join(workspace, "assets"), { recursive: true });
  await page.setContent("<canvas width=320 height=160></canvas>");
  const png = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const context = canvas.getContext("2d");
    context.fillStyle = "#3366cc";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await writeFile(join(workspace, "assets", "picture.png"), Buffer.from(png, "base64"));
  // A chip wide enough to span the horizontal extent of both captures.
  const chip = `\`${"SendAndWaitAsync ".repeat(5).trim()}\``;
  const file = join(workspace, "shadow.md");
  await writeFile(file, [
    "## Code shadow",
    `Call ${chip}`,
    "```csharp\nvar reply = await session.SendAndWaitAsync(\"Hello\");\n```",
    "---",
    "## Image shadow",
    `Call ${chip}`,
    "![Picture](assets/picture.png)",
  ].join("\n\n"));

  await withDeckServer({ file, workspace, theme: "light" }, async (session) => {
    let rendered;
    await exportPptx(session, "shadow.pptx", undefined, {
      findChromiumBrowser: () => chromium.executablePath(),
      runPptxOutputBrowser: async (...args) => { rendered = await runPptxOutputBrowser(...args); return rendered; },
    });
    const cases = [
      { slideIndex: 0, reason: "native-code-approximates: box-shadow", type: "shape", tag: "> pre" },
      { slideIndex: 1, reason: "native-image-approximates: box-shadow", type: "image", tag: "img" },
    ];
    for (const { slideIndex, reason, type, tag } of cases) {
      const slide = rendered.model.slides[slideIndex];
      const fallbackIndex = slide.fallbacks.findIndex((fallback) => fallback.reason === reason);
      expect(fallbackIndex, reason).toBeGreaterThanOrEqual(0);
      const target = slide.elements.find((element) => element.type === type && element.path.endsWith(tag));
      const above = slide.elements.find((element) => element.type === "text" && /> p(:nth-of-type\(1\))?$/.test(element.path));
      const capture = rendered.slideFallbackImages[slideIndex].find((image) => image.fallbackIndex === fallbackIndex);
      expect(target, reason).toBeTruthy();
      expect(above, reason).toBeTruthy();
      expect(capture, reason).toBeTruthy();
      // Precondition: the padded capture really reaches into the text above.
      expect(above.y + above.height, reason).toBeGreaterThan(capture.y + 4);
      const stats = await page.evaluate(async ({ base64, inner }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, image.width, image.height).data;
        let opaqueOutside = 0;
        let shadowPixels = 0;
        for (let y = 0; y < image.height; y++) {
          for (let x = 0; x < image.width; x++) {
            if (x >= inner.left && x < inner.right && y >= inner.top && y < inner.bottom) continue;
            const alpha = data[(y * image.width + x) * 4 + 3];
            if (alpha > 0) shadowPixels++;
            if (alpha > 120) opaqueOutside++;
          }
        }
        return { opaqueOutside, shadowPixels };
      }, {
        base64: Buffer.from(capture.data).toString("base64"),
        inner: {
          left: Math.floor(target.x - capture.x) - 1,
          top: Math.floor(target.y - capture.y) - 1,
          right: Math.ceil(target.x + target.width - capture.x) + 1,
          bottom: Math.ceil(target.y + target.height - capture.y) + 1,
        },
      });
      expect(stats.opaqueOutside, reason).toBe(0);
      expect(stats.shadowPixels, reason).toBeGreaterThan(0);
    }
  });
});
