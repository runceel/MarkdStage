import { expect, test } from "@playwright/test";

import { startHarness } from "../harness/server.mjs";
import { clickMoreControl } from "../utils/nav.mjs";
import { getSlideFrame, waitForSlideReady } from "../utils/ready.mjs";

const SLIDES = [
  ["---", "title: First", "---", "## First", "", "- Short content"].join("\n"),
  ["---", "title: Second", "---", "## Second", "", "- Another slide"].join("\n"),
];
const TITLE_SLIDE = ["---", "layout: title", "---", "# Branded title"].join("\n");
const CUSTOM_THEME_META = {
  version: 1,
  cover: { background: { image: "/assets/sample.svg" } },
};

async function settleFrames(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test("16:9 preview is the default, uses the fixed PDF surface, and remains toggleable", async ({
  page,
}) => {
  const harness = await startHarness({ slides: SLIDES });
  try {
    await page.goto(`${harness.url}/`, { waitUntil: "load" });
    await waitForSlideReady(page);

    const button = page.locator("#navFixedPreview");
    await settleFrames(page);

    await expect(page.locator("body")).toHaveClass(/fixed-preview-mode/);
    const frame = await getSlideFrame(page);
    await expect(frame.locator("body")).toHaveClass(/fixed-output-mode/);
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(button).toHaveAttribute("data-state", "active");

    const fixedSize = await frame.locator("#stage > .deck").evaluate((deck) => {
      const style = getComputedStyle(deck);
      const stage = document.getElementById("stage");
      return {
        width: style.width,
        height: style.height,
        transform: getComputedStyle(stage).transform,
      };
    });
    expect(fixedSize.width).toBe("1280px");
    expect(fixedSize.height).toBe("720px");
    expect(fixedSize.transform).toBe("none");
    await expect(page.locator(".scroll-view")).toBeVisible();
    await expect(page.locator(".scroll-item-frame iframe")).toHaveCount(2);
    await expect(page.locator("#navViewMode")).toHaveAttribute("aria-pressed", "true");
    const scrollbarGap = await page.locator(".scroll-view").evaluate((view) => {
      const slide = view.querySelector(".scroll-item");
      return view.getBoundingClientRect().right - slide.getBoundingClientRect().right;
    });
    expect(scrollbarGap).toBeGreaterThanOrEqual(12);

    await page.locator("#navNext").click();
    await expect.poll(() => harness.index).toBe(1);
    await expect(page.locator("body")).toHaveClass(/fixed-preview-mode/);

    await clickMoreControl(page, "#navFixedPreview");
    await settleFrames(page);
    await expect(page.locator("body")).not.toHaveClass(/fixed-preview-mode/);
    await expect(button).toHaveAttribute("aria-pressed", "false");

    await clickMoreControl(page, "#navFixedPreview");
    await settleFrames(page);
    await expect(page.locator("body")).toHaveClass(/fixed-preview-mode/);
    await expect(button).toHaveAttribute("aria-pressed", "true");
  } finally {
    await harness.close();
  }
});

test("16:9 preview on a square display keeps the theme background covering the title slide", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 900 });
  const harness = await startHarness({
    slides: [TITLE_SLIDE],
    theme: "custom",
    customThemeMeta: CUSTOM_THEME_META,
  });
  try {
    await page.goto(`${harness.url}/`, { waitUntil: "load" });
    await waitForSlideReady(page);
    await settleFrames(page);

    const dimensions = await (await getSlideFrame(page)).locator("#stage > .deck").evaluate((deck) => {
      const background = deck.querySelector(".theme-cover-background");
      return {
        deck: { width: deck.clientWidth, height: deck.clientHeight },
        background: { width: background.clientWidth, height: background.clientHeight },
      };
    });
    expect(dimensions.background).toEqual(dimensions.deck);
  } finally {
    await harness.close();
  }
});

test("16:9 preview ignores one pixel but warns when PDF clipping exceeds the tolerance", async ({
  page,
}) => {
  const harness = await startHarness({ slides: SLIDES.slice(0, 1) });
  try {
    await page.goto(`${harness.url}/`, { waitUntil: "load" });
    await waitForSlideReady(page);
    await settleFrames(page);

    const frame = await getSlideFrame(page);
    await frame.locator(".body").evaluate((body) => {
      body.replaceChildren();
      const probe = document.createElement("div");
      probe.id = "overflowProbe";
      probe.style.flex = "0 0 auto";
      probe.style.height = `${body.clientHeight + 1}px`;
      body.appendChild(probe);
      window.dispatchEvent(new Event("resize"));
    });
    await settleFrames(page);
    await expect(page.locator("#layoutWarning")).toBeHidden();

    await frame.locator("#overflowProbe").evaluate((probe) => {
      const body = probe.parentElement;
      probe.style.height = `${body.clientHeight + 3}px`;
      window.dispatchEvent(new Event("resize"));
    });
    await settleFrames(page);
    await expect(page.locator("#layoutWarning")).toBeHidden();
    await expect(page.locator("#navIssues")).toHaveAccessibleName("1 slide has issues");
    await expect(page.locator("#navMore")).toHaveAttribute("data-state", "active");
    await page.locator("#navIssues").click();
    await expect(page.locator("#issuesPanel")).toBeVisible();
    await expect(page.locator("#issuesList")).toContainText("PDF layout clips this slide");
  } finally {
    await harness.close();
  }
});

test("fixed preview waits for images and closes host controls on slide interaction", async ({ page }) => {
  const harness = await startHarness({
    slides: [TITLE_SLIDE], theme: "custom", customThemeMeta: CUSTOM_THEME_META,
  });
  let releaseImage;
  const imageReady = new Promise((resolve) => { releaseImage = resolve; });
  await page.route("**/assets/sample.svg", async (route) => {
    await imageReady;
    await route.continue();
  });
  try {
    await page.goto(`${harness.url}?view=slide`, { waitUntil: "domcontentloaded" });
    releaseImage();
    const frame = await waitForSlideReady(page);
    await expect(frame.locator(".deck h1")).toHaveText("Branded title");
    await page.locator("#navMore").click();
    await expect(page.locator("#navMorePanel")).toBeVisible();
    await frame.locator(".deck").click({ position: { x: 24, y: 24 } });
    await expect(page.locator("#navMorePanel")).toBeHidden();
  } finally {
    releaseImage();
    await harness.close();
  }
});
