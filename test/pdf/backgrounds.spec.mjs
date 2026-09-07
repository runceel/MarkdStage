import { expect, test } from "@playwright/test";
import { BACKGROUND_COLORS, backgroundSlide, openBackgroundOutput, pngPixel, withBackgroundDeck } from "../utils/backgrounds.mjs";
import { inspectPdf, isSixteenByNinePage } from "../utils/pdf.mjs";

test("PNG and PDF retain backgrounds, foreground diagrams, and page geometry", async ({ page }) => {
  await withBackgroundDeck({
    slides: [
      backgroundSlide("title"),
      backgroundSlide("default", "/assets/override.svg") + `

\`\`\`mermaid
flowchart LR
  A[Client] --> B[API]
\`\`\`
`,
      backgroundSlide("center") + `

\`\`\`architecture
{
  "version": 1,
  "canvas": { "width": 800, "height": 180 },
  "elements": [
    { "type": "node", "id": "api", "x": 20, "y": 20, "width": 200, "height": 100, "text": "API" }
  ]
}
\`\`\`
`,
      backgroundSlide("section", "/assets/other.svg"),
      backgroundSlide("backcover"),
    ],
  }, async ({ session }) => {
    const print = await openBackgroundOutput(page, session, "print");
    expect(print.layout.slides.every((slide) => !slide.pdfClipped)).toBe(true);
    await expect(page.locator("#stage .deck").nth(1).locator(".mermaid svg")).toBeVisible();
    await expect(page.locator("#stage .deck").nth(1).locator(".body")).toHaveCSS("z-index", "1");
    await expect(page.locator("#stage .deck").nth(2).locator(".architecture-svg")).toBeVisible();
    const colors = [BACKGROUND_COLORS.cover, BACKGROUND_COLORS.override, BACKGROUND_COLORS.center, BACKGROUND_COLORS.other];
    for (const [index, color] of colors.entries()) {
      expect(await pngPixel(page, await page.locator("#stage > .deck").nth(index).screenshot())).toEqual(color);
    }
    const pdf = inspectPdf(await page.pdf({ printBackground: true, preferCSSPageSize: true }));
    expect(pdf.pageCount).toBe(session.slides.length);
    expect(pdf.mediaBoxes.every((box) => isSixteenByNinePage(box))).toBe(true);

    const capture = await openBackgroundOutput(page, session, "capture", 1);
    const png = await page.screenshot();
    expect(png.readUInt32BE(16)).toBe(1280);
    expect(png.readUInt32BE(20)).toBe(720);
    expect(await pngPixel(page, png)).toEqual(BACKGROUND_COLORS.override);
    expect(capture.layout.slides[0].status).toBe("fits");
  });
});

test("a background that cannot be decoded fails output instead of exporting a fallback color", async ({ page }) => {
  await withBackgroundDeck({
    slides: [backgroundSlide("title", "/assets/override.svg")],
  }, async ({ session }) => {
    await page.route("**/background-assets/override.svg", (route) =>
      route.fulfill({ status: 200, contentType: "image/svg+xml", body: "not an image" }));
    await expect(openBackgroundOutput(page, session, "print")).rejects.toThrow(/Could not load slide background/);
  });
});
