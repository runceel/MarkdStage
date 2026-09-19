import { expect, test } from "@playwright/test";
import { startHarness } from "../harness/server.mjs";
import { adaptiveCardGeometry, cardFence } from "../harness/adaptive-cards.mjs";
import { cardMarkdownCases, fatalFallbackCases } from "../harness/adaptive-card-regressions.mjs";
import { buildDeckSlides } from "../../.github/extensions/markdstage/markdown-deck.mjs";
import { validateLoadedDeck } from "../../.github/extensions/markdstage/runtime/deck-validation.mjs";

test("actual rendering agrees with canonical validation for nested lists, notes, literal and mixed fences", async ({ page }) => {
  const cases = cardMarkdownCases();
  const slides = cases.flatMap((entry) => buildDeckSlides(entry.markdown));
  const validation = validateLoadedDeck({ slides });
  const harness = await startHarness({ slides });
  try {
    await page.goto(`${harness.url}/?print=1&token=${harness.printToken}`);
    await expect(page.locator("html")).toHaveAttribute("data-print-ready", "true");
    const rendered = await page.evaluate(adaptiveCardGeometry);
    expect(rendered.map((slide) => slide.cards.map((card) => card.status))).toEqual(cases.map((entry) => entry.states));
    expect(rendered.flatMap((slide) => slide.cards).length).toBe(validation.adaptiveCards.blocks.length);
    for (const [index, entry] of cases.entries()) {
      expect(rendered[index].cards.flatMap((card) => card.diagnostics.map((diagnostic) => diagnostic.code))).toEqual(entry.codes);
      expect(rendered[index].cards.flatMap((card) => card.objects.filter((object) => object.type === "TextBlock").map((object) => object.text)))
        .toEqual(entry.text || []);
    }
    const indexes = await page.locator(".deck").last().locator(".adaptive-card-host").evaluateAll((hosts) =>
      hosts.map((host) => host.dataset.adaptiveCardBlock));
    expect(indexes).toEqual(["0", "1", "2"]);
    await expect(page.locator(".deck").first().locator(".adaptive-card-host").getByRole("alert")).toContainText("invalid-property");
  } finally { await harness.close(); }
});

test("fatal properties and all requires entries are checked before any browser fallback or SDK load", async ({ page }) => {
  const cases = fatalFallbackCases();
  const requests = [];
  page.on("request", (request) => {
    if (request.url().includes("blocked.example") || request.url().endsWith("adaptivecards.min.js")) requests.push(request.url());
  });
  const harness = await startHarness({ slides: cases.map((entry) => cardFence(entry.card)) });
  try {
    await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`);
    await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
    const rendered = await page.evaluate(adaptiveCardGeometry);
    expect(requests).toEqual([]);
    for (const [index, entry] of cases.entries()) {
      expect(rendered[index].cards[0].status).toBe("error");
      expect(rendered[index].cards[0].objects).toEqual([]);
      expect(rendered[index].cards[0].diagnostics).toEqual([expect.objectContaining({
        code: entry.code, path: entry.path, severity: "error", impact: "content",
      })]);
    }
    const model = await page.evaluate(() => window.__presentationPptxModel);
    expect(model.slides.map((slide) => slide.fallbacks[0].reason)).toEqual(cases.map((entry) => `adaptive-card-${entry.code}`));
  } finally { await harness.close(); }
});
