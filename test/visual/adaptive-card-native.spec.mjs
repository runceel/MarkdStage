import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startHarness, REPO_ROOT } from "../harness/server.mjs";
import { adaptiveCardSlides, adaptiveCardGeometry, boundarySlide, CARD_FIXTURE_DIRECTORY, cardFence, staticCard } from "../harness/adaptive-cards.mjs";

async function conversionSnapshot() {
  const { collectAdaptiveCardPptx } = await import("./renderer/adaptive-card.mjs");
  return Promise.all([...document.querySelectorAll(".deck")].map(async (deck) =>
    Promise.all([...deck.querySelectorAll(".adaptive-card-host")].map(async (host) => {
      const result = await collectAdaptiveCardPptx(host, deck);
      if (!result) return null;
      return { scene: result.scene, elements: result.elements, conversions: result.conversions,
        fallbacks: result.fallbacks.map(({ element, ...fallback }) => ({
          ...fallback, text: element.textContent, nativeDescendants: element.querySelectorAll("[data-pptx-native]").length,
        })) };
    }))));
}

async function slideScreenshots(page) {
  const screenshots = [];
  // Full-page capture can relayout Linux fallback fonts outside the viewport.
  // Keep every slide at its production viewport when checking collection purity.
  for (const deck of await page.locator(".deck").all()) screenshots.push(await deck.screenshot());
  return screenshots;
}

test("native collection retains SDK/browser content, geometry and pixels across all four themes", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  for (const theme of ["dark", "light", "microsoft", "custom"]) {
    const harness = await startHarness({ slides: (await adaptiveCardSlides()).slice(0, 4), theme,
      markdownRoot: REPO_ROOT, sourceName: "test/fixtures/adaptive-cards/typography.json",
      ...(theme === "custom" ? { customThemeCss: "--fg:#fefefe;--muted:#adbccc;--surface:#203040;--accent:#ff6600;--border:#405060;" } : {}) });
    try {
      await page.goto(`${harness.url}/?print=1&token=${harness.printToken}`);
      await expect(page.locator("html")).toHaveAttribute("data-print-ready", "true");
      const geometry = await page.evaluate(adaptiveCardGeometry);
      const before = await slideScreenshots(page);
      const first = await page.evaluate(conversionSnapshot);
      expect(await page.evaluate(adaptiveCardGeometry)).toEqual(geometry);
      const after = await slideScreenshots(page);
      expect(before).toHaveLength(first.length);
      expect(after).toHaveLength(before.length);
      for (const [index, screenshot] of after.entries()) {
        expect(screenshot.equals(before[index]), `${theme} fixture ${index}: unchanged pixels`).toBe(true);
      }
      expect(await page.evaluate(conversionSnapshot)).toEqual(first);
      for (const [index, [card]] of first.entries()) {
        expect(card.scene.source.kind).toBe("adaptive-card");
        expect(card.elements.length, `fixture ${index}`).toBeGreaterThan(0);
        expect(card.fallbacks, `fixture ${index} reasons`).toEqual([]);
        expect(card.conversions.reduce((count, entry) => count + entry.nativeObjects, 0)).toBe(card.elements.length);
      }
      expect(first[3][0].elements.filter((element) => element.type === "table")).toHaveLength(2);
      expect(first[2][0].elements.filter((element) => element.type === "image")).toHaveLength(3);
      expect(first[0][0].elements.some((element) => element.type === "shape")).toBe(true);
      expect(first[0][0].elements.some((element) => element.type === "connector" && element.strokeWidth === 1)).toBe(true);
      expect(first[0][0].elements.some((element) => element.paragraphs?.some((paragraph) =>
        paragraph.runs.some((run) => run.strikethrough)))).toBe(true);
      await page.evaluate(() => {
        for (const host of document.querySelectorAll(".adaptive-card-host")) {
          for (const element of host.shadowRoot.querySelectorAll("[class]")) {
            if (!element.classList.contains("card-diagnostics")) element.className = "unrelated-sdk-class";
          }
        }
      });
      expect(await page.evaluate(conversionSnapshot)).toEqual(first);
      await testInfo.attach(`${theme}-native-model`, { body: JSON.stringify(first), contentType: "application/json" });
    } finally { await harness.close(); }
  }
});

test("unsupported children stay bounded, with native siblings and no duplicate descendants", async ({ page }) => {
  const names = ["mixed-native", "native-text"];
  const slides = await Promise.all(names.map(async (name) =>
    `## Adaptive Cards: ${name}\n\n${cardFence(await readFile(join(CARD_FIXTURE_DIRECTORY, `${name}.json`), "utf8"))}`));
  const harness = await startHarness({ slides, markdownRoot: REPO_ROOT, sourceName: "test/fixtures/adaptive-cards/mixed-native.json" });
  try {
    await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`);
    await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
    const model = await page.evaluate(() => window.__presentationPptxModel);
    const [mixed, text] = model.slides;
    expect(text.adaptiveCards[0].diagnostics).toEqual([]);
    expect(mixed.fallbacks.filter((entry) => entry.type === "adaptive-card").map((entry) => entry.reason))
      .toEqual(expect.arrayContaining(["adaptive-card-image-style", "adaptive-card-markdown-list"]));
    expect(mixed.adaptiveCards[0].nativeObjectCount).toBeGreaterThan(5);
    expect(mixed.elements.some((element) => element.paragraphs?.some((paragraph) =>
      paragraph.runs.some((run) => run.text.includes("still native"))))).toBe(true);
    expect(mixed.elements.some((element) => element.href === "https://example.com/review")).toBe(true);
    for (const slide of model.slides) {
      for (const fallback of slide.fallbacks.filter((entry) => entry.type === "adaptive-card")) {
        expect(slide.elements.some((element) =>
          element.path === fallback.sourcePath || element.path?.startsWith(`${fallback.sourcePath}.`))).toBe(false);
        expect(fallback.sourcePath).not.toBe("adaptive-card[0]$");
      }
    }
    expect(text.fallbacks.filter((entry) => entry.type === "adaptive-card").map((entry) => entry.reason))
      .toContain("adaptive-card-bidirectional-text");
    expect(text.elements.some((element) => element.paragraphs?.some((paragraph) =>
      paragraph.runs.some((run) => run.text.includes("日本語"))))).toBe(true);
  } finally { await harness.close(); }
});

test("clipped text falls back locally and source paths survive removed siblings", async ({ page }) => {
  const source = staticCard([
    { type: "Custom.Widget", fallback: "drop" },
    { type: "TextBlock", text: "Measured replacement", requires: { otherHost: "1.0" },
      fallback: { type: "TextBlock", text: "Native authored fallback" } },
    { type: "TextBlock", text: "This single line is deliberately wider than the measured column. ".repeat(25), wrap: false },
    { type: "TextBlock", text: "Visible native tail" },
  ]);
  const harness = await startHarness({ slides: [cardFence(source)] });
  try {
    await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`);
    await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
    const slide = await page.evaluate(() => window.__presentationPptxModel.slides[0]);
    expect(slide.elements.some((element) => element.path.startsWith("adaptive-card[0]$.body[1].fallback.lines"))).toBe(true);
    expect(slide.fallbacks.find((entry) => entry.sourcePath === "adaptive-card[0]$.body[2]")?.reason)
      .toBe("adaptive-card-text-fragmentation");
    expect(slide.elements.some((element) => element.path.startsWith("adaptive-card[0]$.body[3].lines"))).toBe(true);
  } finally { await harness.close(); }
});

test("inputs, actions and media use typed static projection without any browser interaction or media fetch", async ({ page }) => {
  const names = ["static-inputs", "static-actions-media"];
  const remote = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname === "blocked.example") remote.push(request.url());
  });
  const slides = await Promise.all(names.map(async (name) =>
    `## Adaptive Cards: ${name}\n\n${cardFence(await readFile(join(CARD_FIXTURE_DIRECTORY, `${name}.json`), "utf8"))}`));
  const harness = await startHarness({ slides, markdownRoot: REPO_ROOT,
    sourceName: "test/fixtures/adaptive-cards/static-inputs.json" });
  try {
    await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`);
    await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
    for (const host of await page.locator(".adaptive-card-host").all()) {
      await expect(host).toHaveAttribute("data-adaptive-card-state", "ready");
      await expect(host.locator("input, textarea, select, button, audio, video, iframe, a[href], [onclick]")).toHaveCount(0);
    }
    expect(remote).toEqual([]);
    const input = page.locator(".adaptive-card-host").first();
    for (const value of ["Ada Lovelace", "Unfilled field", "12", "2026-09-19", "09:30", "Reviewed", "Ready"]) {
      await expect(input).toContainText(value);
    }
    await expect(page.locator(".adaptive-card-host").last()).not.toContainText("This collapsed content must not be rendered.");
    const semantics = await page.evaluate(async () => {
      const { getAdaptiveCardModel, getAdaptiveCardSemanticModel } = await import("./renderer/adaptive-card.mjs");
      return [...document.querySelectorAll(".adaptive-card-host")].map((host) => {
        const original = getAdaptiveCardSemanticModel(host), projected = getAdaptiveCardModel(host);
        return { typed: original instanceof AdaptiveCards.AdaptiveCard,
          originalInteractive: original.hostConfig.supportsInteractivity,
          renderedInteractive: projected.hostConfig.supportsInteractivity,
          inputType: original.getElementById("name")?.getJsonTypeName(),
          mediaType: original.getElementById("media")?.getJsonTypeName() };
      });
    });
    expect(semantics[0]).toEqual({ typed: true, originalInteractive: false, renderedInteractive: false,
      inputType: "Input.Text", mediaType: undefined });
    expect(semantics[1].mediaType).toBe("Media");
    const model = await page.evaluate(() => window.__presentationPptxModel);
    expect(model.slides[0].adaptiveCards[0].diagnostics.map((entry) => entry.code)).toEqual(Array(7).fill("static-input"));
    expect(model.slides[0].adaptiveCards[0].conversions.some((entry) => entry.mode === "approximated" &&
      entry.treatment === "static-input" && entry.nativeObjects > 0)).toBe(true);
    expect(model.slides[1].elements.some((element) => element.type === "image" &&
      element.src.startsWith("data:image/svg+xml;base64,"))).toBe(true);
    expect(model.slides[1].elements.some((element) => element.href === "https://example.com/documentation")).toBe(true);
    for (const slide of await page.evaluate(adaptiveCardGeometry)) {
      expect(slide.cards[0].bounds.y + slide.cards[0].bounds.height, names[slide.index]).toBeLessThanOrEqual(720);
    }
  } finally { await harness.close(); }
});

test("static media posters share image approval and retain the authored poster diagnostic path", async ({ page }) => {
  const remote = [];
  page.on("request", (request) => { if (request.url().includes("blocked.example")) remote.push(request.url()); });
  const harness = await startHarness({ slides: [cardFence(staticCard([
    { type: "TextBlock", text: "Before media" },
    { type: "Media", poster: "https://blocked.example/poster.png",
      sources: [{ mimeType: "video/mp4", url: "https://blocked.example/video.mp4" }] },
    { type: "TextBlock", text: "After media" },
  ]))] });
  try {
    await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`);
    await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
    expect(remote).toEqual([]);
    const slide = await page.evaluate(() => window.__presentationPptxModel.slides[0]);
    expect(slide.adaptiveCards[0].status).toBe("ready");
    expect(slide.adaptiveCards[0].diagnostics.filter((entry) => entry.code === "blocked-image"))
      .toEqual([expect.objectContaining({ sourcePath: "adaptive-card[0]$.body[1].poster" })]);
    expect(slide.elements.filter((entry) => entry.type === "image")).toHaveLength(1);
    expect(slide.elements.some((entry) => entry.paragraphs?.some((paragraph) =>
      paragraph.runs.some((run) => run.text.includes("After media"))))).toBe(true);
  } finally { await harness.close(); }
});

test("unowned SDK visible content triggers an explicit whole-card safety fallback", async ({ page }) => {
  await page.addInitScript(() => {
    let sdk;
    Object.defineProperty(window, "AdaptiveCards", { configurable: true, get: () => sdk, set: (value) => {
      sdk = value;
      const render = value.AdaptiveCard.prototype.render;
      value.AdaptiveCard.prototype.render = function (...args) {
        const root = render.apply(this, args);
        const extra = document.createElement("span");
        extra.textContent = "Unaccounted visible SDK content";
        root.appendChild(extra);
        return root;
      };
    } });
  });

  const harness = await startHarness({ slides: [cardFence(staticCard([{ type: "TextBlock", text: "Typed content" }]))] });
  try {
    await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`);
    await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
    const slide = await page.evaluate(() => window.__presentationPptxModel.slides[0]);
    expect(slide.elements).toEqual([]);
    expect(slide.fallbacks).toEqual([expect.objectContaining({
      type: "adaptive-card", reason: "adaptive-card-unowned-visible-content", sourcePath: "adaptive-card[0]$",
    })]);
    await expect(page.locator(".adaptive-card-host")).toContainText("Unaccounted visible SDK content");
  } finally { await harness.close(); }
});

test("native clipping follows browser overflow without clipping the positioned footer overlap", async ({ page }) => {
    const slides = await adaptiveCardSlides();
    const harness = await startHarness({ slides: [slides[4], boundarySlide] });
    try {
      await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`);
      await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
      const result = await page.evaluate(() => {
        const decks = [...document.querySelectorAll(".deck")];
        const bounds = decks.map((deck) => {
          const body = deck.querySelector(".body").getBoundingClientRect(), origin = deck.getBoundingClientRect();
          return { bottom: body.bottom - origin.top };
        });
        return { bounds, model: window.__presentationPptxModel };
      });
      const ordinary = result.model.slides[0].elements.filter((element) => element.adaptiveCard);
      expect(ordinary.length).toBeGreaterThan(0);
      expect(ordinary.every((element) => element.y + element.height <= result.bounds[0].bottom + 0.01)).toBe(true);
      const positioned = result.model.slides[1].elements.filter((element) => element.adaptiveCard);
      expect(positioned.some((element) => element.y + element.height > result.bounds[1].bottom)).toBe(true);
      expect(positioned.every((element) => element.y + element.height <= 720)).toBe(true);
    } finally { await harness.close(); }
});

test("a shared opacity context is captured once with both cards and no native or generic duplicates", async ({ page }) => {
    const markdown = [
      "## Shared card paint context",
      '<div style="opacity:0.55;background:#305070;padding:10px">',
      "Neighbor in the same paint group.",
      cardFence(staticCard([{ type: "TextBlock", text: "First composite card" }])),
      cardFence(staticCard([{ type: "TextBlock", text: "Second composite card" }])),
      "</div>",
      "Native outside neighbor.",
    ].join("\n\n");
    const harness = await startHarness({ slides: [markdown] });
    try {
      await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`);
      await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
      const slide = await page.evaluate(() => window.__presentationPptxModel.slides[0]);
      const cards = slide.fallbacks.filter((entry) => entry.type === "adaptive-card");
      expect(cards).toHaveLength(1);
      expect(cards[0]).toEqual(expect.objectContaining({ reason: "adaptive-card-paint-context",
        cardSources: ["adaptive-card[0]$", "adaptive-card[1]$"] }));
      expect(slide.elements.filter((entry) => entry.adaptiveCard)).toEqual([]);
      expect(slide.fallbacks.filter((entry) => entry.type === "html" || entry.type === "effect")).toEqual([]);
      expect(slide.adaptiveCards.reduce((sum, card) => sum + card.rasterizedSubtreeCount, 0)).toBe(1);
      await page.evaluate((active) => {
        document.body.classList.remove("pptx-layout-artwork-mode");
        document.body.classList.add("pptx-slide-artwork-mode");
        window.__markdStageSetPptxCardCapture(active);
      }, cards[0].captureId);
      for (const text of ["First composite card", "Second composite card"]) {
        await expect(page.locator(".adaptive-card-host").getByText(text, { exact: true })).toBeVisible();
      }
    } finally { await harness.close(); }
});
