import { expect, test } from "@playwright/test";

import { startHarness } from "../harness/server.mjs";
import { getSlideFrame, waitForSlideReady } from "../utils/ready.mjs";
import { BLOCK_REVEAL_SLIDES } from "../utils/reveal-deck.mjs";

const SLIDE = [
  "# Delivery",
  "<!-- markdstage: reveal=list-items nested=separate -->",
  "",
  "- Plan",
  "  - Requirements",
  "    - Interviews",
  "  - Design",
  "- Deliver",
  "",
  "<!-- markdstage:",
  '{"steps":[["frontend"],["backend","request"]]}',
  "-->",
  "```architecture",
  JSON.stringify({
    version: 1,
    canvas: { width: 800, height: 450 },
    elements: [
      { type: "node", id: "frontend", x: 30, y: 80, width: 180, height: 100, text: "Frontend" },
      { type: "node", id: "backend", x: 500, y: 80, width: 180, height: 100, text: "Backend" },
      { type: "connector", id: "request", from: "frontend", to: "backend" },
    ],
  }),
  "```",
].join("\n");

async function readState(page, url) {
  return page.request.get(new URL("state", url).href).then((response) => response.json());
}

test("presentation reveals list items and Architecture targets without reflow", async ({ page }) => {
  const harness = await startHarness({ slides: [SLIDE] });
  try {
    await page.goto(`${harness.url}/?present=1`, { waitUntil: "load" });
    await waitForSlideReady(page);
    const slide = await getSlideFrame(page);
    const items = slide.locator(".body li");
    const boxesBefore = await items.evaluateAll((elements) =>
      elements.map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      }),
    );
    await expect(items).toHaveCount(5);
    await expect(items.nth(0)).toHaveAttribute("aria-hidden", "true");
    await expect(items.nth(0)).toHaveAttribute("inert", "");
    await expect(items.nth(4)).toHaveCSS("visibility", "hidden");
    await expect(slide.locator('[data-architecture-id="frontend"]').first()).toHaveCSS("visibility", "hidden");

    const stateUrl = new URL("navigate", harness.url);
    const advance = async () => {
      const response = await page.request.post(stateUrl.href, {
        data: { action: "advance" },
        headers: { origin: new URL(harness.url).origin },
      });
      expect(response.ok()).toBe(true);
      return response.json();
    };
    for (const expectedStep of [1, 2, 3, 4, 5]) {
      const state = await advance();
      expect(state.revealStep).toBe(expectedStep);
    }
    await expect(items.nth(0)).toHaveCSS("visibility", "visible");
    await expect(items.nth(1)).toHaveCSS("visibility", "visible");
    await expect(items.nth(2)).toHaveCSS("visibility", "visible");
    await expect(items.nth(3)).toHaveCSS("visibility", "visible");
    await expect(items.nth(4)).toHaveCSS("visibility", "visible");
    await expect(slide.locator('[data-architecture-id="frontend"]').first()).toHaveCSS("visibility", "hidden");

    await advance();
    await expect(slide.locator('[data-architecture-id="frontend"]').first()).toHaveCSS("visibility", "visible");
    await advance();
    await expect(slide.locator('[data-architecture-id="backend"]').first()).toHaveCSS("visibility", "visible");
    await expect(slide.locator('[data-architecture-id="request"]').first()).toHaveCSS("visibility", "visible");
    expect(await items.evaluateAll((elements) =>
      elements.map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      }),
    )).toEqual(boxesBefore);

    const rewind = await page.request.post(stateUrl.href, {
      data: { action: "rewind" },
      headers: { origin: new URL(harness.url).origin },
    }).then((response) => response.json());
    expect(rewind.revealStep).toBe(6);
    await expect(slide.locator('[data-architecture-id="backend"]').first()).toHaveCSS("visibility", "hidden");
    await expect(slide.locator('[data-architecture-id="request"]').first()).toHaveCSS("visibility", "hidden");
  } finally {
    await harness.close();
  }
});

test("static slide mode keeps reveal content complete", async ({ page }) => {
  const harness = await startHarness({ slides: [SLIDE] });
  try {
    await page.goto(harness.url, { waitUntil: "load" });
    await waitForSlideReady(page);
    const slide = await getSlideFrame(page);
    await expect(slide.locator(".body li")).toHaveCount(5);
    for (const item of await slide.locator(".body li").all()) {
      await expect(item).toHaveCSS("visibility", "visible");
      await expect(item).not.toHaveAttribute("aria-hidden", "true");
    }
    await expect(slide.locator('[data-architecture-id="frontend"]').first()).toHaveCSS("visibility", "visible");
  } finally {
    await harness.close();
  }
});

test("whole blocks reveal in source order with list items and never change layout", async ({ page }) => {
  const harness = await startHarness({ slides: BLOCK_REVEAL_SLIDES });
  try {
    await page.goto(`${harness.url}/?present=1`, { waitUntil: "load" });
    await waitForSlideReady(page);
    const navigate = async (data) => {
      const response = await page.request.post(new URL("navigate", harness.url).href, {
        data, headers: { origin: new URL(harness.url).origin },
      });
      expect(response.ok()).toBe(true);
      return response.json();
    };
    for (let index = 0; index < BLOCK_REVEAL_SLIDES.length; index += 1) {
      await navigate({ index });
      const slide = await getSlideFrame(page);
      await expect(slide.locator(".slide-title")).toHaveText([
        "Explain, then illustrate", "Image", "Table", "Code", "Mermaid", "Entire list",
      ][index]);
      const blocks = slide.locator("[data-markdstage-reveal-block]");
      await expect(blocks).toHaveCount(index === 0 ? 2 : 1);
      const bounds = () => blocks.evaluateAll((elements) =>
        elements.map((element) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return { x, y, width, height };
        }));
      const before = await bounds();
      for (const target of await blocks.all()) {
        await expect(target).toHaveCSS("visibility", "hidden");
        await expect(target).toHaveAttribute("aria-hidden", "true");
        await expect(target).toHaveAttribute("inert", "");
        expect(await target.locator("*").evaluateAll((elements) =>
          elements.every((element) => getComputedStyle(element).visibility === "hidden"))).toBe(true);
      }
      if (index === 0) {
        await expect(slide.locator(".body > p").first()).toHaveCSS("visibility", "visible");
        await navigate({ action: "advance" });
        await expect(slide.locator(".body li").first()).toHaveCSS("visibility", "visible");
        await expect(blocks.first()).toHaveCSS("visibility", "hidden");
        await navigate({ action: "advance" });
        await expect(slide.locator(".body li").last()).toHaveCSS("visibility", "visible");
        await expect(blocks.first()).toHaveCSS("visibility", "hidden");
        await navigate({ action: "advance" });
        await expect(blocks.first()).toHaveCSS("visibility", "visible");
        await expect(blocks.last()).toHaveCSS("visibility", "hidden");
      }
      await navigate({ action: "advance" });
      for (const target of await blocks.all()) {
        await expect(target).toHaveCSS("visibility", "visible");
        await expect(target).not.toHaveAttribute("aria-hidden", "true");
        await expect(target).not.toHaveAttribute("inert", "");
      }
      expect(await bounds()).toEqual(before);
      await navigate({ action: "rewind" });
      await expect(blocks.last()).toHaveCSS("visibility", "hidden");
      await navigate({ index });
      await expect(blocks.first()).toHaveCSS("visibility", "hidden");
    }
  } finally {
    await harness.close();
  }
});

test("static views keep entire reveal blocks and their diagrams visible", async ({ page }) => {
  const harness = await startHarness({ slides: BLOCK_REVEAL_SLIDES });
  try {
    await page.goto(harness.url, { waitUntil: "load" });
    await waitForSlideReady(page);
    for (let index = 0; index < BLOCK_REVEAL_SLIDES.length; index += 1) {
      const response = await page.request.post(new URL("navigate", harness.url).href, {
        data: { index }, headers: { origin: new URL(harness.url).origin },
      });
      expect(response.ok()).toBe(true);

      const current = page.locator(`.scroll-item[data-index="${index}"]`);
      await expect(current).toHaveAttribute("data-current", "true");
      await expect(current.locator("iframe")).toBeAttached();
      const slide = await waitForSlideReady(page);
      await expect(slide.locator(".slide-title")).toHaveText([
        "Explain, then illustrate", "Image", "Table", "Code", "Mermaid", "Entire list",
      ][index]);
      for (const target of await slide.locator("[data-markdstage-reveal-block]").all()) {
        await expect(target).toHaveCSS("visibility", "visible");
        await expect(target).not.toHaveAttribute("aria-hidden", "true");
      }
    }
  } finally {
    await harness.close();
  }
});

test("presenter next-build preview includes the next block and return-to-slide shows completed content", async ({ page }) => {
  const harness = await startHarness({ slides: [BLOCK_REVEAL_SLIDES[0], "## Following"] });
  try {
    await page.goto(`${harness.url}/?presenter=1`, { waitUntil: "load" });
    await waitForSlideReady(page);
    const current = page.frameLocator("#presenterCurrent");
    const next = page.frameLocator("#presenterNext");
    await expect(current.locator(".body li").first()).toHaveCSS("visibility", "hidden");
    await expect(next.locator(".body li").first()).toHaveCSS("visibility", "visible");
    await expect(next.locator(".body li").last()).toHaveCSS("visibility", "hidden");
    await page.locator("#presenterNextButton").click();
    await page.locator("#presenterNextButton").click();
    await expect(current.locator("[data-markdstage-reveal-block]").first()).toHaveCSS("visibility", "hidden");
    await expect(next.locator("[data-markdstage-reveal-block]").first()).toHaveCSS("visibility", "visible");
    await expect(next.locator(".architecture-diagram")).toHaveCSS("visibility", "hidden");
    await page.locator("#presenterNextButton").click();
    await expect(current.locator(".architecture-diagram")).toHaveCSS("visibility", "hidden");
    await expect(next.locator(".architecture-diagram")).toHaveCSS("visibility", "visible");
    await expect(page.locator("#presenterNextLabel")).toHaveText("Next reveal");
    await page.getByRole("button", { name: "Return to slide view" }).click();
    const returned = page.locator('.scroll-item[data-index="0"]');
    await expect(returned).toHaveAttribute("data-current", "true");
    await expect(returned.locator("iframe")).toBeAttached();
    const slide = await waitForSlideReady(page);
    await expect(slide.locator(".architecture-diagram")).toHaveCSS("visibility", "visible");
  } finally {
    await harness.close();
  }
});
