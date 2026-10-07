import { expect, test } from "@playwright/test";

import { startHarness } from "../harness/server.mjs";
import { getSlideFrame, waitForSlideReady } from "../utils/ready.mjs";

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
