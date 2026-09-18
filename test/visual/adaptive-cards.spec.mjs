import { expect, test } from "@playwright/test";
import { startHarness, REPO_ROOT } from "../harness/server.mjs";
import { adaptiveCardGeometry, adaptiveCardSlides, cardFence, staticCard } from "../harness/adaptive-cards.mjs";
import { compareCardGeometry } from "../utils/adaptive-card-comparison.mjs";
import { waitForSlideReady } from "../utils/ready.mjs";

async function open(page, harness, mode = "print") {
  await page.goto(`${harness.url}/?${mode}=1&token=${harness.printToken}&index=0`);
  await expect(page.locator("html")).toHaveAttribute(`data-${mode}-ready`, "true");
}

test("only adaptive-card fences lazy-load the pinned SDK and adapter", async ({ page }) => {
  const requests = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  const harness = await startHarness({ slides: ["## Ordinary Markdown\n\nNo card library.", cardFence(staticCard([
    { type: "TextBlock", id: "lazy", text: "Lazy SDK" },
  ]))] });
  try {
    await open(page, harness, "capture");
    expect(requests.filter((path) => /adaptive-card|adaptivecards/.test(path))).toEqual([]);
    await open(page, harness);
    expect(requests.filter((path) => path.endsWith("/vendor/adaptivecards.min.js"))).toHaveLength(1);
    expect(requests.filter((path) => path.endsWith("/renderer/adaptive-card.mjs"))).toHaveLength(1);
    await expect(page.locator(".adaptive-card-host")).toHaveAttribute("data-adaptive-card-state", "ready");
    expect(await page.evaluate(() => window.AdaptiveCards.AdaptiveCard !== undefined)).toBe(true);
  } finally { await harness.close(); }
});

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  test(`${theme}: actual SDK objects have repeatable typed identity, style and deck geometry`, async ({ page }, testInfo) => {
    const harness = await startHarness({
      slides: await adaptiveCardSlides(), theme, markdownRoot: REPO_ROOT,
      sourceName: "test/fixtures/adaptive-cards/typography.json",
      ...(theme === "custom" ? { customThemeCss: "--fg:#fefefe;--muted:#adbccc;--surface:#203040;--accent:#ff6600;--border:#405060;" } : {}),
    });
    try {
      await open(page, harness);
      const first = await page.evaluate(adaptiveCardGeometry);
      expect(first.map((slide) => slide.cards[0].status)).toEqual(["ready", "ready", "ready", "ready", "ready", "error"]);
      expect(first.slice(0, 5).flatMap((slide) => slide.cards[0].diagnostics)).toEqual([]);
      expect(first[5].cards[0].diagnostics[0].code).toBe("unsupported-element");
      const objects = first.slice(0, 5).flatMap((slide) => slide.cards[0].objects);
      expect(new Set(objects.map((object) => object.type))).toEqual(new Set([
        "AdaptiveCard", "TextBlock", "RichTextBlock", "TextRun", "Container", "ColumnSet", "Column",
        "Image", "ImageSet", "FactSet", "Fact", "Table", "TableRow", "TableCell",
      ]));
      for (const object of objects) {
        if (object.type === "Fact") {
          expect(object.bounds).toBeNull();
          expect(object.geometry).toBe("aggregate-only");
        } else {
          expect(object.geometry).toBe("renderedElement");
          expect(object.bounds.width, object.sourcePath).toBeGreaterThan(0);
          expect(object.bounds.height, object.sourcePath).toBeGreaterThan(0);
        }
      }
      const runs = objects.filter((object) => object.type === "TextRun");
      expect(runs).toHaveLength(4);
      expect(runs.every((run) => run.parentPath === "$.body[2].items[1].items[0]" && run.textRects.length > 0)).toBe(true);
      expect(runs.find((run) => run.id === "run-italic").style.italic).toBe(true);
      expect(runs.find((run) => run.id === "run-italic").textRects.length).toBeGreaterThan(1);
      const japanese = objects.find((object) => object.id === "japanese");
      expect(new Set(japanese.textRects.map((rect) => rect.y)).size).toBeGreaterThan(1);
      const columns = first[1].cards[0].objects;
      expect(columns.find((object) => object.id === "pixel").style.width).toEqual({ value: 128, unit: "Pixel" });
      expect(columns.find((object) => object.id === "pixel").bounds.width).toBeCloseTo(128, 1);
      const weights = [1, 2, 3].map((weight) => columns.find((object) => object.id === `weight-${weight}`));
      expect(weights.map((object) => object.style.width)).toEqual([1, 2, 3].map((value) => ({ value, unit: "Weight" })));
      // SDK flex percentages interact with padding and gaps; do not replace that
      // measured layout with an invented exact 1:2:3 pixel-width calculation.
      expect(weights[0].bounds.width).toBeLessThan(weights[1].bounds.width);
      expect(weights[1].bounds.width).toBeLessThan(weights[2].bounds.width);
      const separator = objects.find((object) => object.id === "emphasis");
      expect(separator.style.separator.lineThickness).toBe(1);
      expect(separator.separatorBounds.height).toBeGreaterThan(1);
      expect(first[4].cards[0].bounds.y + first[4].cards[0].bounds.height).toBeGreaterThan(720);
      const identities = await page.evaluate(async () => {
        const { getAdaptiveCardModel } = await import("./renderer/adaptive-card.mjs");
        const card = getAdaptiveCardModel(document.querySelector(".adaptive-card-host"));
        const nested = card.getItemAt(2).getItemAt(1);
        return { card: card instanceof AdaptiveCards.AdaptiveCard, container: nested instanceof AdaptiveCards.Container,
          parent: nested.parent === card.getItemAt(2), root: card.renderedElement.getRootNode() instanceof ShadowRoot };
      });

      expect(identities).toEqual({ card: true, container: true, parent: true, root: true });
      const actualFonts = await page.evaluate(async () => {
        const { getAdaptiveCardModel } = await import("./renderer/adaptive-card.mjs");
        const card = getAdaptiveCardModel(document.querySelector(".adaptive-card-host"));
        return ["heading", "japanese", "subtle"].map((id) => {
          const object = card.getElementById(id), style = getComputedStyle(object.renderedElement);
          return { id, fontFamily: style.fontFamily, fontSize: parseFloat(style.fontSize),
            fontWeight: Number(style.fontWeight), lineHeight: parseFloat(style.lineHeight) };
        });
      });
      for (const actual of actualFonts) {
        const expected = objects.find((object) => object.id === actual.id).style;
        expect(actual).toEqual({ id: actual.id, fontFamily: expected.fontFamily, fontSize: expected.fontSize,
          fontWeight: expected.fontWeight, lineHeight: expected.lineHeight });
      }
      if (theme === "custom") expect(objects.find((object) => object.id === "emphasis").style.background).toBe("#203040");
      const before = await page.locator(".deck").first().screenshot();
      await page.evaluate(() => {
        for (const host of document.querySelectorAll(".adaptive-card-host")) {
          for (const element of host.shadowRoot.querySelectorAll("[class]")) element.className = "not-an-sdk-class";
        }
      });
      expect(await page.evaluate(adaptiveCardGeometry)).toEqual(first);
      expect((await page.locator(".deck").first().screenshot()).equals(before)).toBe(true);
      const boundary = structuredClone(first);
      boundary[0].cards[0].bounds.x += 2;
      expect(compareCardGeometry(first, boundary).violations).toEqual([]);
      boundary[0].cards[0].bounds.x += 0.01;
      expect(compareCardGeometry(first, boundary).violations.length).toBeGreaterThan(0);
      const textBoundary = structuredClone(first);
      textBoundary[0].cards[0].objects.find((object) => object.textRects.length).textRects[0].y += 3;
      expect(compareCardGeometry(first, textBoundary).violations).toEqual([]);
      textBoundary[0].cards[0].objects.find((object) => object.textRects.length).textRects[0].y += 0.01;
      expect(compareCardGeometry(first, textBoundary).violations.length).toBeGreaterThan(0);
      boundary[0].cards[0].objects.pop();
      expect(() => compareCardGeometry(first, boundary)).toThrow("typed object count");
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-print-ready", "true");
      expect(await page.evaluate(adaptiveCardGeometry)).toEqual(first);
      expect((await page.locator(".deck").first().screenshot()).equals(before)).toBe(true);
      await testInfo.attach("geometry", { body: JSON.stringify(first, null, 2), contentType: "application/json" });
    } finally { await harness.close(); }
  });
}

test("card geometry is equivalent in fixed preview, presenter, capture, print and PPTX", async ({ browser }) => {
  const slides = (await adaptiveCardSlides()).slice(0, 1);
  const harness = await startHarness({ slides });
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 720 } });
  try {
    const page = await context.newPage();
    await open(page, harness, "capture");
    const reference = await page.evaluate(adaptiveCardGeometry);
    for (const mode of ["print", "pptx"]) {
      await open(page, harness, mode);
      expect(await page.evaluate(adaptiveCardGeometry)).toEqual(reference);
    }
    for (const suffix of ["", "?presenter=1", "?present=1"]) {
      await page.setViewportSize({ width: 900, height: 900 });
      await page.goto(`${harness.url}/${suffix}`);
      const frame = await waitForSlideReady(page);
      expect(await frame.evaluate(adaptiveCardGeometry)).toEqual(reference);
      await page.setViewportSize({ width: 1920, height: 1080 });
      await waitForSlideReady(page);
      expect(await frame.evaluate(adaptiveCardGeometry)).toEqual(reference);
    }
  } finally { await context.close(); await harness.close(); }
});

test("unsafe card resources, redirects, implicit images and fallback never trigger remote requests", async ({ page }) => {
  const remote = [];
  page.on("request", (request) => { if (new URL(request.url()).hostname === "blocked.example") remote.push(request.url()); });
  await page.route("https://blocked.example/**", (route) => route.abort());
  await page.route("**/assets/redirect.png", (route) => route.fulfill({ status: 302, headers: { location: "https://blocked.example/redirect.png" } }));
  await page.route("**/assets/external.svg", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://blocked.example/nested.png"/></svg>',
  }));
  await page.route("**/assets/disguised.png", (route) => route.fulfill({
    contentType: "image/png",
    body: '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://blocked.example/disguised.png"/></svg>',
  }));
  const forbidden = [
    staticCard([{ type: "Image", url: "https://blocked.example/direct.png" }]),
    staticCard([{ type: "Image", url: "assets/redirect.png" }]),
    staticCard([{ type: "Image", url: "assets/external.svg" }]),
    staticCard([{ type: "Image", url: "assets/disguised.png" }]),
    staticCard([{ type: "ImageSet", images: [{ url: "https://blocked.example/implicit.png" }] }]),
    { ...staticCard([]), fallback: staticCard([{ type: "Image", url: "https://blocked.example/fallback.png" }]) },
    staticCard([{ type: "TextBlock", text: "Click", selectAction: { type: "Action.OpenUrl", url: "https://blocked.example/action" } }]),
    { ...staticCard([]), version: "1.6" },
  ];
  const sanitized = staticCard([{ type: "TextBlock", text:
    '**Safe** <img src="https://blocked.example/markdown.png" onerror="window.cardAttack=1"><script>window.cardAttack=2</script> [link](javascript:alert(1))',
  }]);
  const harness = await startHarness({ slides: [...forbidden, sanitized].map(cardFence) });
  try {
    await open(page, harness, "pptx");
    const geometry = await page.evaluate(adaptiveCardGeometry);
    expect(geometry.slice(0, forbidden.length).every((slide) => slide.cards[0].status === "error")).toBe(true);
    expect(geometry.at(-1).cards[0].status).toBe("ready");
    expect(geometry.at(-1).cards[0].diagnostics[0].code).toBe("markdown-sanitized");
    expect(remote).toEqual([]);
    expect(await page.evaluate(() => window.cardAttack)).toBeUndefined();
    await expect(page.locator(".adaptive-card-host").last().locator("button, input, img, iframe, a[href]")).toHaveCount(0);
    const model = await page.evaluate(() => window.__presentationPptxModel);
    expect(model.slides.every((slide) => slide.elements.length === 0 &&
      slide.fallbacks.length === 1 && slide.fallbacks[0].type === "adaptive-card")).toBe(true);
  } finally { await harness.close(); }
});

test("over-limit local images fail before SDK rendering or raster collection", async ({ page }) => {
  const sdkRequests = [];
  page.on("request", (request) => { if (request.url().includes("adaptivecards.min.js")) sdkRequests.push(request.url()); });
  await page.route("**/assets/oversized.png", (route) => route.fulfill({
    contentType: "image/png", body: Buffer.alloc(10 * 1024 * 1024 + 1),
  }));
  const harness = await startHarness({ slides: [cardFence(staticCard([{ type: "Image", url: "assets/oversized.png" }]))] });
  try {
    await open(page, harness, "pptx");
    const result = await page.evaluate(adaptiveCardGeometry);
    expect(result[0].cards[0].status).toBe("error");
    expect(result[0].cards[0].diagnostics[0].code).toBe("blocked-image");
    expect(result[0].cards[0].diagnostics[0].message).toContain("limit is 10 MiB");
    expect(sdkRequests).toEqual([]);
    expect((await page.evaluate(() => window.__presentationPptxModel)).slides[0].fallbacks[0].reason).toBe("adaptive-card-blocked-image");
  } finally { await harness.close(); }
});
