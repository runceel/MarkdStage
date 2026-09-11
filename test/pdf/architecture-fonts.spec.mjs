import { expect, test } from "@playwright/test";

import { startHarness } from "../harness/server.mjs";
import { ARCHITECTURE_FONT_ROLES, AUTHORED_FONT, FONT_TEST_THEME_CSS, architectureFontSlide } from "../fixtures/architecture-fonts.mjs";
import { inspectPdf, isSixteenByNinePage } from "../utils/pdf.mjs";
import { waitForPrintReady } from "../utils/ready.mjs";

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  for (const role of ARCHITECTURE_FONT_ROLES) {
    test(`${theme} ${role} preserves authored and inherited fonts in browser, PDF, and capture`, async ({ page }, testInfo) => {
      const harness = await startHarness({
        slides: [architectureFontSlide(role)], theme,
        ...(theme === "custom" ? { customThemeCss: FONT_TEST_THEME_CSS } : {}),
      });
      try {
        for (const mode of ["browser", "print", "capture"]) {
          await page.goto(mode === "browser" ? harness.url :
            `${harness.url}/?${mode}=1&token=${harness.printToken}&index=0`, { waitUntil: "load" });
          if (mode === "print") await waitForPrintReady(page);
          if (mode === "capture") await expect(page.locator("html")).toHaveAttribute("data-capture-ready", "true");
          const surface = mode === "browser" ? page.frameLocator("iframe") : page;
          await expect(surface.locator(".architecture-svg")).toHaveCount(1);
          await page.evaluate(() => document.fonts.ready);
          if (mode === "print") await page.emulateMedia({ media: "print" });

          const custom = surface.locator(".architecture-svg text[font-family]");
          const themed = surface.locator(".architecture-svg text:not([font-family])");
          await expect(custom).toHaveCount(1);
          await expect(themed).toHaveCount(1);
          await expect(custom).toHaveCSS("font-family", `"${AUTHORED_FONT}"`);
          const inherited = await surface.locator(".architecture-svg").evaluate((svg) => getComputedStyle(svg).fontFamily);
          await expect(themed).toHaveCSS("font-family", inherited);
          expect(inherited).not.toBe(`"${AUTHORED_FONT}"`);
          if (theme === "custom") expect(inherited).toBe("Arial, sans-serif");
          if (role === "node") {
            const boxes = await surface.locator('.architecture-svg [data-architecture-type="node"]')
              .evaluateAll((nodes) => nodes.map((node) => {
                const { x, y, width, height } = node.getBoundingClientRect();
                return { x, y, width, height };
              }));
            expect(boxes).toHaveLength(2);
            expect(boxes[1].width).toBeCloseTo(boxes[0].width * 2, 1);
            expect(boxes[1].x).toBeGreaterThan(boxes[0].x + boxes[0].width);
            expect(boxes[1].y).toBeCloseTo(boxes[0].y, 1);
            expect(boxes[1].height).toBeCloseTo(boxes[0].height, 1);
          }

          if (mode === "print") {
            const cdp = await page.context().newCDPSession(page);
            await cdp.send("DOM.enable");
            await cdp.send("CSS.enable");
            const { root } = await cdp.send("DOM.getDocument");
            const renderedFonts = [];
            // Chromium may outline variable theme fonts as Type 3; the custom theme uses static Arial.
            const selectors = [".architecture-svg text[font-family]",
              ...(theme === "custom" ? [".architecture-svg text:not([font-family])"] : [])];
            for (const selector of selectors) {
              const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
              const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
              expect(fonts.length).toBeGreaterThan(0);
              renderedFonts.push(...fonts);
            }
            const pdf = await page.pdf({
              path: testInfo.outputPath(`${role}.pdf`), printBackground: true, preferCSSPageSize: true,
            });
            const summary = inspectPdf(pdf);
            expect(summary.pageCount).toBe(1);
            expect(summary.mediaBoxes.every((box) => isSixteenByNinePage(box))).toBe(true);
            // Verify the actual embedded PDF font, including platform substitutions on Linux.
            const embeddedFonts = [...pdf.toString("latin1").matchAll(/\/BaseFont\s+\/([^\s/<>]+)/g)]
              .map(([, name]) => name.replace(/^[A-Z]{6}\+/, "").replace(/#([0-9a-f]{2})/gi,
                (_, hex) => String.fromCharCode(parseInt(hex, 16))));
            for (const font of renderedFonts) {
              expect(font.glyphCount).toBeGreaterThan(0);
              expect(embeddedFonts).toContain(font.postScriptName);
            }
            await testInfo.attach(`${role}-pdf`, { body: pdf, contentType: "application/pdf" });
            await cdp.detach();
            await page.emulateMedia({ media: "screen" });
          }
          if (mode === "capture") {
            const png = await page.screenshot({ path: testInfo.outputPath(`${role}-capture.png`) });
            expect(png.readUInt32BE(16)).toBe(1280);
            expect(png.readUInt32BE(20)).toBe(720);
            await testInfo.attach(`${role}-capture`, { body: png, contentType: "image/png" });
          }
        }
      } finally {
        await harness.close();
      }
    });
  }
}
