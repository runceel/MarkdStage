import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startHarness, REPO_ROOT } from "../harness/server.mjs";
import { adaptiveCardGeometry, adaptiveCardSlides, CARD_FIXTURE_DIRECTORY, cardFence, staticCard } from "../harness/adaptive-cards.mjs";
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
      await page.evaluate(async () => {
        const { getAdaptiveCardModel } = await import("./renderer/adaptive-card.mjs");
        for (const host of document.querySelectorAll(".adaptive-card-host")) {
          const root = getAdaptiveCardModel(host)?.renderedElement;
          if (!root) continue;
          for (const element of [root, ...root.querySelectorAll("[class]")]) element.className = "not-an-sdk-class";
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
    staticCard([{ type: "TextBlock", text: "Click", refresh: { action: { type: "Action.Execute", verb: "never-run" } } }]),
    { ...staticCard([]), version: "1.6" },
  ];
  const sanitized = staticCard([{ type: "TextBlock", text:
    '**Safe** <img src="https://blocked.example/markdown.png" onerror="window.cardAttack=1"><script>window.cardAttack=2</script> [link](javascript:alert(1))',
  }]);
  const harness = await startHarness({ slides: [...forbidden, sanitized].map(cardFence) });
  try {
    await open(page, harness, "pptx");
    const geometry = await page.evaluate(adaptiveCardGeometry);
    expect(geometry.slice(0, 4).every((slide) => slide.cards[0].status === "ready")).toBe(true);
    expect(geometry.slice(0, 4).every((slide) => slide.cards[0].diagnostics.length > 0)).toBe(true);
    expect(geometry.slice(4, forbidden.length).every((slide) => slide.cards[0].status === "error")).toBe(true);
    expect(geometry.at(-1).cards[0].status).toBe("ready");
    expect(geometry.at(-1).cards[0].diagnostics[0].code).toBe("markdown-sanitized");
    expect(remote).toEqual([]);
    expect(await page.evaluate(() => window.cardAttack)).toBeUndefined();
    await expect(page.locator(".adaptive-card-host").last().locator("button, input, img, iframe, a[href]")).toHaveCount(0);
    const model = await page.evaluate(() => window.__presentationPptxModel);
    expect(model.slides.every((slide) => slide.adaptiveCards[0].diagnostics.length > 0)).toBe(true);
    expect(model.slides.slice(0, 4).every((slide) => slide.elements.some((entry) => entry.type === "image"))).toBe(true);
    expect(model.slides.slice(4, forbidden.length).every((slide) => slide.adaptiveCards[0].nativeObjectCount === 0 &&
      slide.fallbacks.some((entry) => entry.type === "adaptive-card"))).toBe(true);
  } finally { await harness.close(); }
});

test("over-limit local images become bounded placeholders without losing the card", async ({ page }) => {
  const sdkRequests = [];
  page.on("request", (request) => { if (request.url().includes("adaptivecards.min.js")) sdkRequests.push(request.url()); });
  await page.route("**/assets/oversized.png", (route) => route.fulfill({
    contentType: "image/png", body: Buffer.alloc(10 * 1024 * 1024 + 1),
  }));
  const harness = await startHarness({ slides: [cardFence(staticCard([{ type: "Image", url: "assets/oversized.png" }]))] });
  try {
    await open(page, harness, "pptx");
    const result = await page.evaluate(adaptiveCardGeometry);
    expect(result[0].cards[0].status).toBe("ready");
    expect(result[0].cards[0].diagnostics[0].code).toBe("blocked-image");
    expect(result[0].cards[0].diagnostics[0].message).toContain("limit is 10 MiB");
    expect(sdkRequests).toHaveLength(1);
    const slide = await page.evaluate(() => window.__presentationPptxModel.slides[0]);
    expect(slide.elements.filter((entry) => entry.type === "image")).toHaveLength(1);
    expect(slide.fallbacks[0].reason).toBe("adaptive-card-diagnostic-note");
  } finally { await harness.close(); }
});

for (const [element, attributes] of [
  ["animate", 'attributeName="x" from="0" to="80" dur="1s" repeatCount="indefinite"'],
  ["animateColor", 'attributeName="fill" from="red" to="blue" dur="1s" repeatCount="indefinite"'],
  ["animateMotion", 'path="M0,0 L80,0" dur="1s" repeatCount="indefinite"'],
  ["animateTransform", 'attributeName="transform" type="translate" from="0 0" to="80 0" dur="1s" repeatCount="indefinite"'],
  ["set", 'attributeName="visibility" to="hidden" begin="1s"'],
]) {
  for (const entry of ["local", "data"]) {
    test(`${entry} SVG ${element} is visibly blocked before card rendering and raster capture`, async ({ page }, testInfo) => {
      const fixture = await readFile(join(CARD_FIXTURE_DIRECTORY, "assets", "animated-motion.svg"), "utf8");
      const svg = fixture.replace(/<animateMotion\b[^>]*\/>/, `<${element} ${attributes}/>`);
      const localPath = element === "animateMotion" ? "assets/animated-motion.svg" : `assets/animation-${element}.svg`;
      if (entry === "local" && element !== "animateMotion") {
        await page.route(`**/${localPath}`, (route) => route.fulfill({ contentType: "image/svg+xml", body: svg }));
      }
      const sdkRequests = [], assetRequests = [];
      page.on("request", (request) => {
        if (request.url().endsWith("/vendor/adaptivecards.min.js")) sdkRequests.push(request.url());
        if (request.url().endsWith(`/${localPath}`)) assetRequests.push(request.url());
      });
      const url = entry === "local" ? localPath : `data:image/svg+xml,${encodeURIComponent(svg)}`;
      const harness = await startHarness({
        slides: [cardFence(staticCard([{ type: "Image", id: "animated", url }]))],
        markdownRoot: REPO_ROOT, sourceName: "test/fixtures/adaptive-cards/typography.json",
      });
      try {
        await open(page, harness, "pptx");
        const host = page.locator(".adaptive-card-host");
        await expect(host).toHaveAttribute("data-adaptive-card-state", "ready");
        await expect(host.getByRole("note")).toBeVisible();
        await expect(host.getByRole("note")).toContainText("blocked-image");
        await expect(host.getByRole("note")).toContainText("animation are not allowed");
        await expect(host.locator("img")).toHaveCount(1);
        await expect(host.locator("img")).toHaveAttribute("alt", "Image unavailable");
        expect(await host.locator("img").getAttribute("src")).not.toContain("animate");
        expect(assetRequests).toHaveLength(entry === "local" ? 1 : 0);
        expect(sdkRequests).toHaveLength(1);
        const geometry = await page.evaluate(adaptiveCardGeometry);
        expect(geometry[0].cards[0].objects.map((object) => object.type)).toEqual(["AdaptiveCard", "Image"]);
        expect(geometry[0].cards[0].diagnostics).toEqual([expect.objectContaining({ code: "blocked-image" })]);
        const slide = await page.evaluate(() => window.__presentationPptxModel.slides[0]);
        expect(slide.elements.filter((entry) => entry.type === "image")).toHaveLength(1);
        expect(slide.fallbacks).toEqual([expect.objectContaining({
          type: "adaptive-card", reason: "adaptive-card-diagnostic-note",
          diagnostics: [expect.objectContaining({ code: "blocked-image" })],
        })]);
        await testInfo.attach("blocked-svg-diagnostic", { body: JSON.stringify(geometry), contentType: "application/json" });
        const first = await page.screenshot({ path: testInfo.outputPath("blocked-svg.png") });
        await page.waitForTimeout(470);
        const later = await page.screenshot({ path: testInfo.outputPath("blocked-svg-later.png") });
        expect(later.equals(first), "Blocked artwork must not depend on the SVG animation clock.").toBe(true);
      } finally { await harness.close(); }
    });
  }
}

test("bad assets preserve neighboring card content and report canonical block paths", async ({ page }) => {
  const harness = await startHarness({ slides: [cardFence(staticCard([
    { type: "TextBlock", text: "Retained before" },
    { type: "Image", url: "assets/missing.png", width: "96px", height: "48px" },
    { type: "TextBlock", text: "Retained after" },
  ]))] });
  try {
    await open(page, harness, "pptx");
    const host = page.locator(".adaptive-card-host");
    await expect(host).toContainText("Retained before");
    await expect(host).toContainText("Retained after");
    await expect(host.locator("img")).toHaveAttribute("alt", "Image unavailable");
    const fallback = await page.evaluate(() => window.__presentationPptxModel.slides[0].fallbacks[0]);
    expect(fallback.reason).toBe("adaptive-card-diagnostic-note");
    expect(fallback.diagnostics).toEqual([expect.objectContaining({
      code: "image-load-failed", severity: "warning", impact: "content",
      path: "$.body[1].url", sourcePath: "adaptive-card[0]$.body[1].url",
    })]);
  } finally { await harness.close(); }
});

test("requires and fallback substitutions are visible without silent SDK content loss", async ({ page }) => {
  const payload = staticCard([
    { type: "TextBlock", text: "Not supported", requires: { otherHost: "1.0" },
      fallback: { type: "TextBlock", id: "substitution", text: "Safe replacement", wrap: true } },
    { type: "Custom.Widget", fallback: "drop" },
  ]);
  const harness = await startHarness({ slides: [cardFence(payload)] });
  try {
    await open(page, harness, "pptx");
    await expect(page.locator(".adaptive-card-host").getByRole("note")).toContainText("fallback-substituted");
    const [slide] = await page.evaluate(adaptiveCardGeometry);
    expect(slide.cards[0].status).toBe("ready");
    expect(slide.cards[0].objects.find((object) => object.id === "substitution").sourcePath).toBe("$.body[0].fallback");
    expect(slide.cards[0].objects.map((object) => object.type)).toEqual(["AdaptiveCard", "TextBlock"]);
    expect(slide.cards[0].diagnostics.map((entry) => entry.code)).toEqual([
      "requires-not-met", "fallback-substituted", "unsupported-element", "fallback-dropped",
    ]);
  } finally { await harness.close(); }
});

test("SDK subtree is sanitized in place before attachment, while typed references remain connected", async ({ page }) => {
  await page.addInitScript(() => {
    let sdk;
    Object.defineProperty(window, "AdaptiveCards", {
      configurable: true, get: () => sdk, set: (value) => {
        sdk = value;
        const render = value.AdaptiveCard.prototype.render;
        value.AdaptiveCard.prototype.render = function (...args) {
          const root = render.apply(this, args);
          const script = document.createElement("script");
          script.textContent = "window.unsafeCardScript = true";
          const unsafe = document.createElement("span");
          unsafe.textContent = "Sanitized content";
          unsafe.setAttribute("onclick", "window.unsafeCardScript=true");
          unsafe.style.backgroundImage = 'url("https://blocked.example/sdk.png")';
          root.append(script, unsafe);
          return root;
        };
      },
    });
  });
  const remote = [];
  page.on("request", (request) => { if (request.url().includes("blocked.example")) remote.push(request.url()); });
  const harness = await startHarness({ slides: [cardFence(staticCard([{ type: "TextBlock", id: "identity", text: "Typed content" }]))] });
  try {
    await open(page, harness);
    expect(remote).toEqual([]);
    expect(await page.evaluate(() => window.unsafeCardScript)).toBeUndefined();
    await expect(page.locator(".adaptive-card-host").locator("script, [onclick], [tabindex], a[href]")).toHaveCount(0);
    const identity = await page.evaluate(async () => {
      const { getAdaptiveCardModel } = await import("./renderer/adaptive-card.mjs");
      const card = getAdaptiveCardModel(document.querySelector(".adaptive-card-host"));
      return { typed: card.getElementById("identity") instanceof AdaptiveCards.TextBlock,
        connected: card.getElementById("identity").renderedElement.isConnected };
    });
    expect(identity).toEqual({ typed: true, connected: true });
    expect((await page.evaluate(adaptiveCardGeometry))[0].cards[0].diagnostics[0].code).toBe("sdk-subtree-sanitized");
  } finally { await harness.close(); }
});

for (const mode of ["capture", "print", "pptx"]) {
  test(`${mode} readiness waits for permitted images and fonts introduced by card rendering`, async ({ page }) => {
    let releaseImage;
    const gate = new Promise((resolve) => { releaseImage = resolve; });
    let requested;
    const request = new Promise((resolve) => { requested = resolve; });
    await page.route("**/assets/delayed.svg", async (route) => {
      requested();
      await gate;
      await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="red"/></svg>' });
    });
    await page.addInitScript(() => {
      const ready = Object.getOwnPropertyDescriptor(FontFaceSet.prototype, "ready").get;
      const cardFonts = new Promise((resolve) => { window.releaseCardFonts = resolve; });
      Object.defineProperty(document.fonts, "ready", { get() {
        if (document.querySelector(".adaptive-card-host")?.shadowRoot?.querySelector("img")) {
          window.cardFontsPending = true;
          return cardFonts;
        }
        return ready.call(this);
      } });
    });
    const harness = await startHarness({ slides: [cardFence(staticCard([
      { type: "TextBlock", text: "Readiness", fontType: "Monospace" },
      { type: "Image", url: "assets/delayed.svg" },
    ]))] });
    try {
      await page.goto(`${harness.url}/?${mode}=1&token=${harness.printToken}&index=0`);
      await request;
      await expect(page.locator("html")).not.toHaveAttribute(`data-${mode}-ready`, "true");
      releaseImage();
      await page.waitForFunction(() => window.cardFontsPending);
      await expect(page.locator(".adaptive-card-host")).toHaveAttribute("data-adaptive-card-state", "loading");
      await expect(page.locator("html")).not.toHaveAttribute(`data-${mode}-ready`, "true");
      await page.evaluate(() => window.releaseCardFonts());
      await expect(page.locator("html")).toHaveAttribute(`data-${mode}-ready`, "true");
      expect((await page.evaluate(adaptiveCardGeometry))[0].cards[0].status).toBe("ready");
    } finally { releaseImage(); await harness.close(); }
  });
}

test("image approval cache and aggregate budget are shared across cards and slides", async ({ page }) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>';
  const requested = [];
  await page.route("**/assets/budget-*.svg", (route) => {
    requested.push(new URL(route.request().url()).pathname);
    return route.fulfill({ contentType: "image/svg+xml", body: svg });
  });
  const payload = staticCard([{ type: "Image", url: "assets/budget-a.svg" }]);
  const harness = await startHarness({ slides: [cardFence(payload), cardFence(payload)] });
  try {
    await open(page, harness);
    expect(requested).toHaveLength(1);
    const result = await page.evaluate(async ({ svgBytes, payload }) => {
      const { renderAdaptiveCard, createAdaptiveCardResourceContext, getAdaptiveCardDiagnostics } = await import("./renderer/adaptive-card.mjs");
      const resources = createAdaptiveCardResourceContext();
      resources.totalBytes = 100 * 1024 * 1024 - svgBytes;
      const host = document.querySelector(".adaptive-card-host");
      const palette = { fg: "#ffffff", muted: "#888888", accent: "#0088ff", surface: "#202020", border: "#444444", fontFamily: "Segoe UI" };
      await renderAdaptiveCard(host, JSON.stringify(payload), palette, resources);
      const first = getAdaptiveCardDiagnostics(host);
      const exactBytes = resources.totalBytes;
      payload.body[0].url = "assets/budget-b.svg";
      await renderAdaptiveCard(host, JSON.stringify(payload), palette, resources);
      return { first, exactBytes, second: getAdaptiveCardDiagnostics(host) };
    }, { svgBytes: Buffer.byteLength(svg), payload });
    expect(result.first.diagnostics).toEqual([]);
    expect(result.exactBytes).toBe(100 * 1024 * 1024);
    expect(result.second.status).toBe("ready");
    expect(result.second.diagnostics[0].code).toBe("blocked-image");
    expect(result.second.diagnostics[0].message).toContain("limit is 100 MiB");
    expect(requested.some((path) => path.endsWith("budget-b.svg"))).toBe(false);
  } finally { await harness.close(); }
});

test("animated PNG and GIF data cannot make card captures time-dependent", async ({ page }) => {
  const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const animation = Buffer.alloc(20);
  animation.writeUInt32BE(8);
  animation.write("acTL", 4, "ascii");
  const apng = Buffer.concat([pngHeader, animation]);
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
  const firstFrame = gif.subarray(19, gif.length - 1);
  const animatedGif = Buffer.concat([gif.subarray(0, gif.length - 1), firstFrame, Buffer.from([0x3b])]);
  const harness = await startHarness({ slides: [
    cardFence(staticCard([{ type: "Image", url: `data:image/png;base64,${apng.toString("base64")}` }])),
    cardFence(staticCard([{ type: "Image", url: `data:image/gif;base64,${animatedGif.toString("base64")}` }])),
  ] });
  try {
    await open(page, harness);
    const geometry = await page.evaluate(adaptiveCardGeometry);
    for (const slide of geometry) {
      expect(slide.cards[0].status).toBe("ready");
      expect(slide.cards[0].diagnostics[0].code).toBe("blocked-image");
      expect(slide.cards[0].diagnostics[0].message).toContain("Animated");
    }
  } finally { await harness.close(); }
});

test("a fully off-slide card has an explicit content fallback without a zero-size picture", async ({ page }) => {
  const harness = await startHarness({ slides: [
    '<div style="position:absolute;left:1400px;top:800px;width:200px">\n\n' +
      cardFence(staticCard([{ type: "TextBlock", text: "Outside the slide" }])) + "\n\n</div>",
  ] });
  try {
    await open(page, harness, "pptx");
    const cards = await page.evaluate(() => window.__presentationPptxModel.slides[0].fallbacks.filter((entry) => entry.type === "adaptive-card"));
    expect(cards).toEqual([expect.objectContaining({ artwork: false, reason: "adaptive-card-outside-slide", width: 0, height: 0 })]);
    expect(cards[0].captureId).toBeUndefined();
  } finally { await harness.close(); }
});
