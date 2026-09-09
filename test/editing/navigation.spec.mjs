import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { startHarness } from "../harness/server.mjs";
import { getSlideFrame, waitForSlideReady } from "../utils/ready.mjs";

const SLIDES = [
  "---\nlayout: title\n---\n\n# First slide",
  "## Second slide\n\nInteractive content must not advance.",
  "## Third slide",
];

async function openPresenter(page) {
  const harness = await startHarness({ slides: SLIDES });
  await page.goto(`${harness.url}/?present=1`, { waitUntil: "load" });
  await waitForSlideReady(page);
  return harness;
}

async function openPreview(page, { interactive }) {
  const harness = await startHarness({ slides: SLIDES });
  const query = interactive ? "?preview=1&offset=0&navigate=1" : "?preview=1&offset=0";
  await page.goto(`${harness.url}/${query}`, { waitUntil: "load" });
  await waitForSlideReady(page);
  return harness;
}

test("Desktop host shortcuts reach the top-level WebView2 bridge once from a focused slide", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const hostSource = await readFile(new URL(
    "../../apps/MarkdStage.Desktop/src/MarkdStage.App/PresenterWindow.xaml.cs", import.meta.url,
  ), "utf8");
  const script = hostSource.match(/PresenterShortcutScript\s*=\s*"""([\s\S]*?)""";/)?.[1];
  expect(script).toBeTruthy();
  await page.addInitScript({ content: `
    window.hostKeys = [];
    window.hostMessageListeners = [];
    window.chrome ||= {};
    window.chrome.webview = {
      addEventListener: (name, listener) => {
        if (name === "message") window.hostMessageListeners.push(listener);
      },
      postMessage: (key) => window.hostKeys.push(key),
    };
    ${script}
  ` });
  const harness = await openPresenter(page);
  try {
    const slide = await getSlideFrame(page);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.hostMessageListeners.length)).toBe(1);
    expect(await slide.evaluate(() => window.hostMessageListeners.length)).toBe(0);
    await slide.locator("body").focus();
    await page.keyboard.press("F11");
    await expect.poll(() => page.evaluate(() => window.hostKeys)).toEqual(["F11"]);
    expect(await slide.evaluate(() => window.hostKeys)).toEqual([]);
    await page.evaluate(() => {
      window.hostMessageListeners.forEach((listener) => listener({ data: "fullscreen" }));
    });
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => window.hostKeys)).toEqual(["F11", "Escape"]);
    expect(await slide.evaluate(() => window.hostKeys)).toEqual([]);
  } finally {
    await harness.close();
  }
});

test.describe("presenter navigation", () => {
  test("left click and right click on slide whitespace navigate", async ({ page }) => {
    const harness = await openPresenter(page);
    try {
      await (await getSlideFrame(page)).locator(".deck").click({ position: { x: 12, y: 120 } });
      await expect.poll(() => harness.index).toBe(1);
      await waitForSlideReady(page);

      await (await getSlideFrame(page)).locator(".deck").click({
        button: "right",
        position: { x: 12, y: 120 },
      });

      await expect.poll(() => harness.index).toBe(0);
    } finally {
      await harness.close();
    }
  });

  test("interactive current-slide preview navigates by mouse", async ({ page }) => {
    const harness = await openPreview(page, { interactive: true });
    try {
      await (await getSlideFrame(page)).locator(".deck").click({ position: { x: 12, y: 120 } });
      await expect.poll(() => harness.index).toBe(1);
      await waitForSlideReady(page);

      await (await getSlideFrame(page)).locator(".deck").click({
        button: "right",
        position: { x: 12, y: 120 },
      });
      await expect.poll(() => harness.index).toBe(0);
    } finally {
      await harness.close();
    }
  });

  test("interactive preview keeps slide keys after mouse focus", async ({ page }) => {
    const harness = await openPreview(page, { interactive: true });
    try {
      await (await getSlideFrame(page)).locator(".deck").click({ position: { x: 12, y: 120 } });
      await expect.poll(() => harness.index).toBe(1);

      await page.keyboard.press("End");
      await expect.poll(() => harness.index).toBe(2);
      await page.keyboard.press("Home");
      await expect.poll(() => harness.index).toBe(0);
    } finally {
      await harness.close();
    }
  });

  test("read-only next-slide preview ignores mouse navigation", async ({ page }) => {
    const harness = await openPreview(page, { interactive: false });
    try {
      await (await getSlideFrame(page)).locator(".deck").click({ position: { x: 12, y: 120 } });
      await page.keyboard.press("End");
      await page.waitForTimeout(100);
      expect(harness.index).toBe(0);
    } finally {
      await harness.close();
    }
  });

  test("modified whitespace clicks do not navigate", async ({ page }) => {
    const harness = await openPresenter(page);
    try {
      await (await getSlideFrame(page)).locator(".deck").click({
        modifiers: ["Control"],
        position: { x: 12, y: 120 },
      });
      await page.waitForTimeout(100);
      expect(harness.index).toBe(0);
    } finally {
      await harness.close();
    }
  });

  test("touch tap on slide whitespace advances", async ({ browser }) => {
    const context = await browser.newContext({
      hasTouch: true,
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    const harness = await openPresenter(page);
    try {
      await page.touchscreen.tap(12, 120);
      await expect.poll(() => harness.index).toBe(1);
    } finally {
      await harness.close();
      await context.close();
    }
  });

  test("slide content keeps its own click behavior", async ({ page }) => {
    const harness = await openPresenter(page);
    try {
      await (await getSlideFrame(page)).locator(".deck").click({ position: { x: 12, y: 120 } });
      await expect.poll(() => harness.index).toBe(1);
      await waitForSlideReady(page);

      await (await getSlideFrame(page)).locator(".body > p").click();
      await (await getSlideFrame(page)).locator(".body > p").click({ button: "right" });
      await page.waitForTimeout(100);
      expect(harness.index).toBe(1);
    } finally {
      await harness.close();
    }
  });
});
