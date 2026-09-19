import { expect, test } from "@playwright/test";
import { startHarness } from "../harness/server.mjs";
import { cardFence, staticCard } from "../harness/adaptive-cards.mjs";

test("late srcset, unowned resources and CSS resources cannot use subtree fallback to bypass approval", async ({ page }) => {
  const approved = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='2'%20height='2'%3E%3C/svg%3E";
  const harness = await startHarness({ slides: [cardFence(staticCard([{ type: "Image", url: approved }]))] });
  try {
    await page.goto(`${harness.url}/?print=1&token=${harness.printToken}`);
    await expect(page.locator("html")).toHaveAttribute("data-print-ready", "true");
    const result = await page.evaluate(async () => {
      const { getAdaptiveCardModel, assertAdaptiveCardCaptureSafe } = await import("./renderer/adaptive-card.mjs");
      const host = document.querySelector(".adaptive-card-host");
      const card = getAdaptiveCardModel(host), image = card.getItemAt(0).renderedImageElement;
      const rejected = () => {
        try { assertAdaptiveCardCaptureSafe(host); return null; }
        catch (error) { return { code: error.code, path: error.path }; }
      };
      const results = [];
      image.setAttribute("srcset", `${image.src} 2x`);
      results.push(rejected());
      image.removeAttribute("srcset");
      image.style.backgroundImage = `url("${image.src}")`;
      results.push(rejected());
      image.style.removeProperty("background-image");
      const unowned = document.createElement("img");
      unowned.src = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='3'%20height='3'%3E%3C/svg%3E";
      card.renderedElement.appendChild(unowned);
      results.push(rejected());
      unowned.remove();
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      card.renderedElement.appendChild(svg);
      results.push(rejected());
      svg.remove();
      return results;
    });
    expect(result).toEqual([
      { code: "blocked-image", path: "$.body[0].url" },
      { code: "blocked-image", path: "$.body[0].url" },
      { code: "blocked-image", path: "$" },
      { code: "blocked-image", path: "$" },
    ]);
  } finally { await harness.close(); }
});
