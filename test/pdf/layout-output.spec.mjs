import { expect, test } from "@playwright/test";

import { startHarness } from "../harness/server.mjs";
import { waitForPrintReady } from "../utils/ready.mjs";

const SHORT_SLIDE = [
  "---",
  "title: Fits",
  "---",
  "## Fits",
  "",
  "- Short content",
].join("\n");

const TALL_SLIDE = [
  "---",
  "title: Too tall",
  "---",
  "## Too tall",
  "",
  ...Array.from({ length: 28 }, (_, index) => `- Overflow item ${index + 1}`),
].join("\n");

const WIDE_SLIDE = [
  "---",
  "title: Too wide",
  "---",
  "## Too wide",
  "",
  "```text",
  "x".repeat(320),
  "```",
].join("\n");

const ARCHITECTURE_SLIDE = [
  "## Architecture measurements",
  "```architecture",
  JSON.stringify({
    version: 1, canvas: { width: 1600, height: 900 },
    elements: [
      { type: "node", id: "service", x: 100, y: 100, width: 350, height: 180, text: "Service", style: { fontSize: 40 } },
      { type: "node", id: "database", x: 700, y: 100, width: 350, height: 180, text: "Database", style: { fontSize: 32 } },
      { type: "connector", from: "service", to: "database", label: "query" },
    ],
  }),
  "```",
].join("\n");

test("clean architecture reports measured output bounds and font sizes in print and capture", async ({ page }) => {
  const harness = await startHarness({ slides: [ARCHITECTURE_SLIDE] });
  try {
    for (const mode of ["print", "capture"]) {
      await page.goto(`${harness.url}/?${mode}=1&token=${harness.printToken}&index=0`, { waitUntil: "load" });
      await expect(page.locator("html")).toHaveAttribute(`data-${mode}-ready`, "true");
      await expect(page.locator(".architecture-error")).toHaveCount(0);
      const report = harness.printReports.at(-1).layout.slides[0];
      expect(report.status).toBe("fits");
      expect(report.architecture[0].effectiveScale).toBeGreaterThan(0);
      expect(report.architecture[0].effectiveScale).toBeLessThan(1);
      const node = report.elements.find((entry) => entry.id === "service");
      expect(node.kind).toBe("architecture");
      expect(node.requestedFontSize).toBe(40);
      expect(node.requestedSize).toEqual({ width: 350, height: 180 });
      expect(node.effectiveSize).toEqual({ width: 350, height: 180 });
      expect(node.shrunk).toBe(false);
      expect(node.truncated).toBe(false);
      const measured = await page.locator('[data-architecture-id="service"]').evaluate((element) => {
        const deck = element.closest(".deck").getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        const text = element.querySelector("text");
        const matrix = text.getScreenCTM();
        return {
          x: rect.x - deck.x, y: rect.y - deck.y,
          width: rect.width, height: rect.height,
          fontSize: parseFloat(getComputedStyle(text).fontSize) * Math.hypot(matrix.c, matrix.d),
        };
      });

      for (const key of ["x", "y", "width", "height"]) {
        expect(node.bbox[key]).toBeCloseTo(measured[key], 2);
      }
      expect(node.fontSize).toBeCloseTo(measured.fontSize, 2);
      expect(node.fontSize).toBeLessThan(node.requestedFontSize);
    }
    expect(harness.printReports[0].layout.slides[0].elements)
      .toEqual(harness.printReports[1].layout.slides[0].elements);
    const transformed = await page.evaluate(async () => {
      const { collectArchitectureLayout } = await import("/renderer/architecture-layout.mjs");
      const deck = document.querySelector("#stage .deck");
      const text = deck.querySelector('[data-architecture-id="service"] text');
      text.style.fontSize = "50px";
      const before = collectArchitectureLayout(deck).elements.find((entry) => entry.id === "service");
      deck.style.transform = "scale(0.5)";
      const after = collectArchitectureLayout(deck, 0.5).elements.find((entry) => entry.id === "service");
      return { before, after };
    });
    expect(transformed.before.requestedFontSize).toBe(40);
    expect(transformed.before.effectiveFontSize).toBe(50);
    expect(transformed.after).toEqual(transformed.before);
  } finally {
    await harness.close();
  }
});

test("architecture inspection distinguishes shrink, truncation, and preserved text", async ({ page }) => {
  const longText = "A very long label which cannot possibly fit inside the small rectangle";
  const markdown = ["## Text fitting", "```architecture", JSON.stringify({
    version: 1,
    elements: [
      { type: "node", id: "shrunk", x: 100, y: 100, width: 180, height: 80,
        text: longText, style: { fontSize: 40, padding: 8, autoFit: "shrink" } },
      { type: "node", id: "preserved", x: 100, y: 400, width: 180, height: 80,
        text: longText, style: { fontSize: 40, padding: 8, autoFit: "none" } },
      { type: "node", id: "auto", x: 800, y: 600, width: "auto", height: "auto",
        text: "Auto dimensions", style: { fontSize: 28, padding: 16 } },
    ],
  }), "```"].join("\n");
  const harness = await startHarness({ slides: [markdown] });
  try {
    await page.goto(`${harness.url}/?capture=1&token=${harness.printToken}&index=0`, { waitUntil: "load" });
    await expect(page.locator("html")).toHaveAttribute("data-capture-ready", "true");
    await expect(page.locator(".architecture-error")).toHaveCount(0);
    const report = harness.printReports[0].layout.slides[0];
    const shrunk = report.elements.find((entry) => entry.id === "shrunk");
    const preserved = report.elements.find((entry) => entry.id === "preserved");
    const auto = report.elements.find((entry) => entry.id === "auto");
    expect(shrunk.requestedFontSize).toBe(40);
    expect(shrunk.effectiveFontSize).toBeLessThan(40);
    expect(shrunk.fontSize).toBeCloseTo(shrunk.effectiveFontSize * shrunk.effectiveScale, 1);
    expect(shrunk.shrunk).toBe(true);
    expect(shrunk.truncated).toBe(true);
    expect(preserved.requestedFontSize).toBe(40);
    expect(preserved.effectiveFontSize).toBe(40);
    expect(preserved.shrunk).toBe(false);
    expect(preserved.truncated).toBe(false);
    expect(preserved.text).toBe(longText);
    expect(auto.requestedSize).toEqual({ width: "auto", height: "auto" });
    expect(auto.effectiveSize.width).toBeGreaterThan(32);
    expect(auto.effectiveSize.height).toBeGreaterThan(32);
  } finally {
    await harness.close();
  }
});

test("targeted inspection reserves the architecture detail budget for the requested slide", async ({ page }) => {
  const harness = await startHarness({ slides: [ARCHITECTURE_SLIDE, ARCHITECTURE_SLIDE] });
  try {
    await page.goto(`${harness.url}/?print=1&token=${harness.printToken}&layout-index=1`, { waitUntil: "load" });
    await waitForPrintReady(page);
    const [first, requested] = harness.printReports[0].layout.slides;
    expect(first.elements.filter((entry) => entry.kind === "architecture")).toHaveLength(0);
    expect(first.architecture[0].reportedElementCount).toBe(0);
    expect(requested.elements.find((entry) => entry.id === "service")).toBeTruthy();
    expect(requested.architecture[0].reportedElementCount).toBe(requested.architecture[0].elementCount);
  } finally {
    await harness.close();
  }
});

for (const mode of ["print", "capture", "pptx"]) {
  test(`${mode} output excludes export notifications and live announcements`, async ({ page }) => {
    const harness = await startHarness({ slides: [SHORT_SLIDE] });
    try {
      await page.goto(`${harness.url}/?${mode}=1&token=${harness.printToken}&index=0`, {
        waitUntil: "load",
      });
      await expect(page.locator("html")).toHaveAttribute(`data-${mode}-ready`, "true");
      await page.evaluate(() => document.fonts.ready);
      const before = await page.screenshot({ animations: "disabled" });
      await page.evaluate(() => {
        document.getElementById("exportNotification").hidden = false;
        document.getElementById("exportNotificationMessage").textContent = "PDF saved: slides.pdf.";
        document.getElementById("exportNotificationClose").hidden = false;
        document.getElementById("exportStatus").textContent = "Saved to: D:\\Exports\\slides.pdf";
        document.getElementById("exportErrorStatus").textContent = "Previous export error";
      });
      for (const id of ["exportNotification", "exportStatus", "exportErrorStatus"]) {
        await expect(page.locator(`#${id}`)).toHaveCSS("display", "none");
      }
      const after = await page.screenshot({ animations: "disabled" });
      expect(after.equals(before)).toBe(true);
    } finally {
      await harness.close();
    }
  });
}

test("print readiness reports bounded PDF layout diagnostics", async ({ page }) => {
  const slides = [SHORT_SLIDE, TALL_SLIDE, WIDE_SLIDE];
  const harness = await startHarness({ slides });
  try {
    await page.goto(`${harness.url}/?print=1&token=${harness.printToken}`, {
      waitUntil: "load",
    });
    await waitForPrintReady(page);

    expect(harness.printReports).toHaveLength(1);
    const report = harness.printReports[0];
    expect(report.status).toBe("ready");
    expect(report.layout.width).toBe(1280);
    expect(report.layout.height).toBe(720);
    expect(report.layout.total).toBe(slides.length);
    expect(report.layout.slides).toHaveLength(slides.length);

    const [fits, tall, wide] = report.layout.slides;
    expect(fits.status).toBe("fits");
    expect(fits.pdfClipped).toBe(false);
    expect(tall.status).toBe("pdf-clipped");
    expect(tall.verticalOverflowPx).toBeGreaterThan(2);
    expect(tall.elements.length).toBeLessThanOrEqual(5);
    expect(wide.status).toBe("pdf-clipped");
    expect(wide.horizontalOverflowPx).toBeGreaterThan(2);
    expect(wide.scrollContainers.length).toBeGreaterThan(0);
    expect(report.layout.issueCount).toBe(2);
  } finally {
    await harness.close();
  }
});

test("capture mode matches print geometry and produces a 1280x720 image", async ({
  browser,
}) => {
  const harness = await startHarness({ slides: [SHORT_SLIDE] });
  const printPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const capturePage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await printPage.goto(`${harness.url}/?print=1&token=${harness.printToken}`, {
      waitUntil: "load",
    });
    await waitForPrintReady(printPage);

    await capturePage.goto(
      `${harness.url}/?capture=1&token=${harness.printToken}&index=0`,
      { waitUntil: "load" },
    );
    await expect(capturePage.locator("html")).toHaveAttribute("data-capture-ready", "true");
    await expect(capturePage.locator("body")).toHaveClass(/capture-mode/);
    await expect(capturePage.locator("body")).toHaveClass(/fixed-output-mode/);

    const measure = (page) =>
      page.locator("#stage > .deck").evaluate((deck) => {
        const body = deck.querySelector(":scope > .body");
        const heading = deck.querySelector(".slide-title");
        const deckStyle = getComputedStyle(deck);
        const bodyStyle = getComputedStyle(body);
        return {
          deckWidth: deckStyle.width,
          deckHeight: deckStyle.height,
          paddingTop: deckStyle.paddingTop,
          paddingLeft: deckStyle.paddingLeft,
          bodyFontSize: bodyStyle.fontSize,
          bodyHeight: bodyStyle.height,
          headingFontSize: heading ? getComputedStyle(heading).fontSize : "",
        };
      });
    expect(await measure(capturePage)).toEqual(await measure(printPage));

    const png = await capturePage.screenshot();
    expect(png.readUInt32BE(16)).toBe(1280);
    expect(png.readUInt32BE(20)).toBe(720);

    expect(harness.printReports).toHaveLength(2);
    const captureReport = harness.printReports[1];
    expect(captureReport.status).toBe("ready");
    expect(captureReport.layout.slides[0].index).toBe(0);
    expect(captureReport.layout.slides[0].status).toBe("fits");
  } finally {
    await printPage.close();
    await capturePage.close();
    await harness.close();
  }
});
