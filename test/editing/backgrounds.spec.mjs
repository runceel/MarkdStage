import { expect, test } from "@playwright/test";
import { clickMoreControl } from "../utils/nav.mjs";
import { waitForSlideReady } from "../utils/ready.mjs";
import {
  BACKGROUND_COLORS,
  backgroundSlide,
  pngPixel,
  withBackgroundDeck,
} from "../utils/backgrounds.mjs";

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  test(`per-slide backgrounds override every layout in fixed preview and presentation (${theme})`, async ({ page }) => {
    await withBackgroundDeck({
      theme,
      slides: ["title", "default", "center", "section", "backcover"].map((layout) =>
        backgroundSlide(layout, "/assets/override.svg")),
    }, async ({ session }) => {
      await page.goto(session.url);
      let slide = await waitForSlideReady(page);
      for (let index = 0; index < 5; index++) {
        if (index) {
          await page.request.post(`${session.url}navigate`, { data: { index } });
          await expect(slide.locator("#stage h1")).toHaveText(
            ["title", "default", "center", "section", "backcover"][index],
          );
          await waitForSlideReady(page);
        }
        const image = slide.locator("#stage .slide-background");
        await expect(image).toHaveCount(1);
        await expect(image).toHaveAttribute("aria-hidden", "true");
        await expect(image).toHaveAttribute("alt", "");
        await expect(image).toHaveCSS("pointer-events", "none");
        await expect(image).toHaveCSS("object-fit", "cover");
        await expect(image).toHaveCSS("height", "720px");
        await expect(slide.locator("#stage .body")).toHaveCSS("z-index", "1");
        expect(await pngPixel(page, await slide.locator("#stage .deck").screenshot())).toEqual(
          BACKGROUND_COLORS.override,
        );
      }

      await clickMoreControl(page, "#navFixedPreview");
      await expect(page.locator("body")).not.toHaveClass(/fixed-output-mode/);
      slide = await waitForSlideReady(page);
      await expect(slide.locator("#stage .slide-background")).toHaveCSS("height", "720px");
      await page.goto(`${session.url}?preview=1&offset=0`);
      slide = await waitForSlideReady(page);
      await expect(page.locator("body")).toHaveClass(/preview-mode/);
      expect(await pngPixel(page, await slide.locator("#stage .deck").screenshot())).toEqual(
        BACKGROUND_COLORS.override,
      );
    });
  });
}

for (const individual of [true, false]) {
  test(`theme backgrounds use ${individual ? "layout-specific" : "common fallback"} images without affecting special layouts`, async ({ page }) => {
    await withBackgroundDeck({
      individual,
      slides: ["title", "default", "center", "section", "backcover"].map((layout) =>
        backgroundSlide(layout)),
    }, async ({ session }) => {
      await page.goto(session.url);
      const slide = await waitForSlideReady(page);
      for (const [index, name] of ["cover", individual ? "default" : "common", individual ? "center" : "common", null, null].entries()) {
        await page.request.post(`${session.url}navigate`, { data: { index } });
        await expect(slide.locator("#stage h1")).toHaveText(
          ["title", "default", "center", "section", "backcover"][index],
        );
        await waitForSlideReady(page);
        await expect(slide.locator("#stage .slide-background")).toHaveCount(name ? 1 : 0);
        if (name) {
          expect(await pngPixel(page, await slide.locator("#stage .deck").screenshot())).toEqual(
            BACKGROUND_COLORS[name],
          );
        }
      }
    });
  });
}

test("presenter current and next previews keep independent backgrounds", async ({ page }) => {
  await withBackgroundDeck({
    slides: [
      backgroundSlide("title", "/assets/override.svg"),
      backgroundSlide("center", "/assets/root.svg"),
    ],
  }, async ({ session }) => {
    await page.goto(`${session.url}?presenter=1`);
    await waitForSlideReady(page);
    const current = page.frameLocator("#presenterCurrent").locator(".slide-background");
    const next = page.frameLocator("#presenterNext").locator(".slide-background");
    await expect(current).toHaveAttribute("src", /\/background-assets\/override\.svg$/);
    await expect(next).toHaveAttribute("src", /\/background-assets\/root\.svg$/);
    await expect.poll(() => current.evaluate((image) => image.naturalWidth)).toBe(128);
    await expect.poll(() => next.evaluate((image) => image.naturalWidth)).toBe(128);
  });
});

test("live background load failures produce a visible error", async ({ page }) => {
  await withBackgroundDeck({
    slides: [backgroundSlide("title", "/assets/override.svg")],
  }, async ({ session }) => {
    await page.route("**/background-assets/override.svg", (route) =>
      route.fulfill({ status: 404, body: "Not found" }));
    await page.goto(session.url);
    await waitForSlideReady(page);
    await expect(page.locator("#exportNotification")).toBeVisible();
    await expect(page.locator("#exportNotificationMessage")).toContainText("Could not load slide background");
  });
});

for (const [filename, color] of [
  ["with space.svg", "override"],
  ["100%.svg", "override"],
  ["with%20space.svg", "other"],
]) {
  test(`background filenames use literal paths through the token-scoped route: ${filename}`, async ({ page }) => {
    await withBackgroundDeck({
      slides: [backgroundSlide("title", `/assets/${filename}`)],
    }, async ({ session, server }) => {
      await page.goto(session.url);
      const slide = await waitForSlideReady(page);
      await expect(slide.locator("#stage .slide-background")).toHaveAttribute(
        "src", `/${server.token}/background-assets/${encodeURIComponent(filename)}`,
      );
      expect(await pngPixel(page, await slide.locator("#stage .deck").screenshot())).toEqual(
        BACKGROUND_COLORS[color],
      );
    });
  });
}

test("a first-slide background is not inherited by subsequent slides", async ({ page }) => {
  await withBackgroundDeck({
    slides: [
      backgroundSlide("title", "/assets/override.svg"),
      backgroundSlide("default"),
      backgroundSlide("center"),
    ],
  }, async ({ session }) => {
    await page.goto(session.url);
    const slide = await waitForSlideReady(page);
    await expect(slide.locator("#stage .slide-background")).toHaveAttribute("src", /override\.svg$/);
    for (const [index, name] of [[1, "default"], [2, "center"]]) {
      await page.request.post(`${session.url}navigate`, { data: { index } });
      await expect(slide.locator("#stage h1")).toHaveText(name);
      await waitForSlideReady(page);
      expect(await pngPixel(page, await slide.locator("#stage .deck").screenshot())).toEqual(
        BACKGROUND_COLORS[name],
      );
    }
  });
});
