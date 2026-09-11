import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, expect, test } from "@playwright/test";

import { withDeckServer } from "../../packages/markdstage-cli/src/deck.mjs";
import {
  createOutputJob, createOutputSnapshot, exportPptx,
} from "../../.github/extensions/markdstage/runtime/output.mjs";
import { inspectPptxPackage } from "../../.github/extensions/markdstage/runtime/pptx-package.mjs";
import { ARCHITECTURE_FONT_ROLES, AUTHORED_FONT, FONT_TEST_THEME_CSS, architectureFontSlide } from "../fixtures/architecture-fonts.mjs";

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  test(`${theme} authored and themed architecture fonts survive real PPTX export`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const file = testInfo.outputPath("fonts.md");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, ARCHITECTURE_FONT_ROLES.map(architectureFontSlide).join("\n\n---\n\n"));
    const themeFile = theme === "custom" ? "font-theme.css" : undefined;
    if (themeFile) await writeFile(testInfo.outputPath(themeFile), FONT_TEST_THEME_CSS);
    await withDeckServer({ file, workspace: dirname(file), theme, themeFile }, async (session) => {
      const token = "architecture-font-test";
      session.exportJobs.set(token, createOutputJob(createOutputSnapshot(session), "pptx"));
      await page.goto(`${session.url}?pptx=1&token=${token}`, { waitUntil: "load" });
      await page.waitForFunction(() =>
        document.documentElement.hasAttribute("data-pptx-ready") ||
        document.documentElement.hasAttribute("data-pptx-error"));
      await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
      const inheritedFonts = [];
      for (const [index] of ARCHITECTURE_FONT_ROLES.entries()) {
        const svg = page.locator("#stage > .deck").nth(index).locator(".architecture-svg");
        await expect(svg.locator("text[font-family]")).toHaveCSS("font-family", `"${AUTHORED_FONT}"`);
        const inherited = await svg.evaluate((element) => getComputedStyle(element).fontFamily);
        await expect(svg.locator("text:not([font-family])")).toHaveCSS("font-family", inherited);
        if (theme === "custom") expect(inherited).toBe("Arial, sans-serif");
        inheritedFonts.push(inherited.split(",")[0].trim().replace(/^["']|["']$/g, ""));
      }

      const result = await exportPptx(session, "architecture-fonts.pptx", undefined, {
        findChromiumBrowser: () => chromium.executablePath(),
      });
      expect(result.ok).toBe(true);
      expect(result.fallbacks.filter((fallback) => fallback.path.includes("architecture"))).toEqual([]);
      const bytes = await readFile(result.path);
      const summary = inspectPptxPackage(bytes);
      expect(summary.valid).toBe(true);
      expect(summary.slideCount).toBe(session.slides.length);
      // The package writer uses stored ZIP entries: inspect actual slide XML, not the input model.
      const slideXml = [...bytes.toString("utf8").matchAll(/<p:sld\b[\s\S]*?<\/p:sld>/g)]
        .map(([xml]) => xml);
      expect(slideXml).toHaveLength(session.slides.length);
      const nodeBoxes = await page.evaluate((xml) => {
        const document = new DOMParser().parseFromString(xml, "application/xml");
        return [...document.getElementsByTagName("p:sp")]
          .filter((shape) => /^(Authored|Themed) node$/.test(shape.getElementsByTagName("a:t")[0]?.textContent))
          .map((shape) => {
            const transform = shape.getElementsByTagName("a:xfrm")[0];
            const offset = transform.getElementsByTagName("a:off")[0];
            const extent = transform.getElementsByTagName("a:ext")[0];
            return { x: Number(offset.getAttribute("x")), y: Number(offset.getAttribute("y")),
              width: Number(extent.getAttribute("cx")), height: Number(extent.getAttribute("cy")) };
          });
      }, slideXml[0]);
      expect(nodeBoxes).toHaveLength(2);
      expect(Math.abs(nodeBoxes[1].width - nodeBoxes[0].width * 2)).toBeLessThanOrEqual(2);
      expect(nodeBoxes[1].x).toBeGreaterThan(nodeBoxes[0].x + nodeBoxes[0].width);
      expect(nodeBoxes[1].y).toBe(nodeBoxes[0].y);
      expect(nodeBoxes[1].height).toBe(nodeBoxes[0].height);
      for (const [index, role] of ARCHITECTURE_FONT_ROLES.entries()) {
        const runs = await page.evaluate((xml) => {
          const document = new DOMParser().parseFromString(xml, "application/xml");
          if (document.querySelector("parsererror")) throw new Error("Invalid slide XML");
          return [...document.getElementsByTagName("a:r")].map((run) => ({
            text: run.getElementsByTagName("a:t")[0]?.textContent,
            fontFace: run.getElementsByTagName("a:latin")[0]?.getAttribute("typeface"),
          }));
        }, slideXml[index]);
        expect(runs.filter((run) => run.text === `Authored ${role}`)).toEqual([
          { text: `Authored ${role}`, fontFace: AUTHORED_FONT },
        ]);
        expect(runs.filter((run) => run.text === `Themed ${role}`)).toEqual([
          { text: `Themed ${role}`, fontFace: inheritedFonts[index] },
        ]);
      }
      await testInfo.attach("architecture-fonts-pptx", {
        body: bytes, contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });
    });
  });
}
