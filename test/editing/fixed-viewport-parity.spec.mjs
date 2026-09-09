import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { REPO_ROOT, startHarness } from "../harness/server.mjs";
import { splitFixtureDeck } from "../harness/deck.mjs";
import { clickMoreControl } from "../utils/nav.mjs";
import { getSlideFrame, waitForPrintReady, waitForSlideReady } from "../utils/ready.mjs";

const fixture = (name) => splitFixtureDeck(
  readFileSync(join(REPO_ROOT, "test", "fixtures", name), "utf8"),
);
const architecture = fixture("architecture-visual.md");
const SLIDES = [
  architecture[0],
  fixture("standard-title.md")[1],
  architecture[1],
  fixture("print-mixed.md")[0],
  [
    "## \u9577\u3044\u898b\u51fa\u3057\u3068\u672c\u6587",
    "\u65e5\u672c\u8a9e\u306e\u9577\u6587\u3067\u6298\u308a\u8fd4\u3057\u3092\u78ba\u8a8d\u3057\u307e\u3059\u3002".repeat(10),
    "| Item | Value |\n| --- | --- |\n| Fixed | 1280 x 720 |",
    "```js\nconst size = { width: 1280, height: 720 };\n```",
    "![Example](/assets/sample.svg)",
  ].join("\n\n"),
  "---\nlayout: section\n---\n# Section",
  "## Clipped content\n\n" + Array.from({ length: 28 }, (_, i) => `- Item ${i}`).join("\n"),
  architecture.at(-1),
];

async function geometry(deck) {
  return deck.evaluate((root) => {
    const origin = root.getBoundingClientRect();
    const bounds = (rect) => [
      rect.x - origin.x, rect.y - origin.y, rect.width, rect.height,
    ];
    return [root, ...root.querySelectorAll("*")].filter((el) =>
      el.getClientRects().length && !el.closest("defs"),
    ).map((el) => {
      const style = getComputedStyle(el);
      const lines = [];
      for (const child of el.childNodes) {
        if (child.nodeType !== Node.TEXT_NODE || !child.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(child);
        lines.push(...[...range.getClientRects()].map(bounds));
      }
      return {
        tag: el.tagName, font: style.fontSize, lineHeight: style.lineHeight,
        bounds: bounds(el.getBoundingClientRect()), lines,
      };
    });
  });
}

function expectGeometry(actual, expected, label) {
  expect(actual.length, label).toBe(expected.length);
  const differences = [];
  for (let i = 0; i < expected.length; i++) {
    const a = actual[i];
    const b = expected[i];
    if (a.tag !== b.tag || a.font !== b.font || a.lineHeight !== b.lineHeight ||
        a.lines.length !== b.lines.length) {
      differences.push({ i, tag: b.tag, actual: a, expected: b });
      continue;
    }
    const av = [...a.bounds, ...a.lines.flat()];
    const bv = [...b.bounds, ...b.lines.flat()];
    const delta = Math.max(...av.map((v, j) => Math.abs(v - bv[j])));
    if (delta > 0.05) differences.push({ i, tag: b.tag, delta });
  }
  expect(differences.slice(0, 8), label).toEqual([]);
}

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  test(`${theme}: preview, current, next and projection preserve output geometry`, async ({ browser }) => {
    test.setTimeout(120_000);
    const harness = await startHarness({
      slides: SLIDES, theme,
      customThemeCss: "--ms-font:Arial;--cover-logo-width:18vw;--backcover-logo-width:18vw;",
      customThemeMeta: { version: 1, cover: { background: { image: "/assets/sample.svg" } } },
    });
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const preview = await context.newPage();
    const presenter = await context.newPage();
    const projection = await context.newPage();
    const print = await context.newPage();
    try {
      await print.setViewportSize({ width: 1280, height: 720 });
      await print.goto(`${harness.url}/?print=1&token=${harness.printToken}`);
      await waitForPrintReady(print);
      const reference = [];
      for (let i = 0; i < SLIDES.length; i++) {
        reference.push(await geometry(print.locator(".deck").nth(i)));
      }
      // Initial rendering is already scaled, including Mermaid's text measurement.
      await preview.setViewportSize({ width: 800, height: 600 });
      await presenter.setViewportSize({ width: 1440, height: 900 });
      await projection.setViewportSize({ width: 900, height: 900 });
      await preview.goto(harness.url);
      await presenter.goto(`${harness.url}/?presenter=1`);
      await projection.goto(`${harness.url}/?present=1`);
      for (let i = 0; i < SLIDES.length; i++) {
        await preview.request.post(`${harness.url}/navigate`, { data: { index: i } });
        await expect(preview.locator("#navCounter")).toHaveText(`${i + 1} / ${SLIDES.length}`);
        await expect(presenter.locator("#presenterCounter")).toHaveText(`${i + 1} / ${SLIDES.length}`);
        await expect(projection.locator("#navCounter")).toHaveText(`${i + 1} / ${SLIDES.length}`);
        for (const [name, page] of [["preview", preview], ["current", presenter], ["projection", projection]]) {
          const frame = await waitForSlideReady(page);
          expect(await frame.evaluate(() => [innerWidth, innerHeight])).toEqual([1280, 720]);
          expectGeometry(await geometry(frame.locator(".deck")), reference[i], `${name} slide ${i}`);
        }
        if (i + 1 < SLIDES.length) {
          const next = await (await presenter.$("#presenterNext")).contentFrame();
          await waitForSlideReady(next);
          expectGeometry(await geometry(next.locator(".deck")), reference[i + 1], `next slide ${i + 1}`);
        } else {
          await expect(presenter.locator("#presenterNextEmpty")).toBeVisible();
          await expect(presenter.locator("#presenterNext")).toBeHidden();
        }
        await presenter.setViewportSize({ width: i % 2 ? 1440 : 760, height: 900 });
        const resizedCurrent = await waitForSlideReady(presenter);
        expectGeometry(await geometry(resizedCurrent.locator(".deck")), reference[i], `resized current ${i}`);
        if (i + 1 < SLIDES.length) {
          const resizedNext = await (await presenter.$("#presenterNext")).contentFrame();
          await waitForSlideReady(resizedNext);
          expectGeometry(await geometry(resizedNext.locator(".deck")), reference[i + 1], `resized next ${i + 1}`);
        }
        for (const size of [
          { width: 1920, height: 1080 }, { width: 900, height: 900 }, { width: 3840, height: 2160 },
        ]) {
          await projection.setViewportSize(size);
          const frame = await waitForSlideReady(projection);
          expectGeometry(await geometry(frame.locator(".deck")), reference[i], `resize slide ${i}`);
          const box = await projection.locator("#outputFrame").boundingBox();
          const scale = Math.min(size.width / 1280, size.height / 720);
          expect(box.width).toBeCloseTo(1280 * scale, 2);
          expect(box.height).toBeCloseTo(720 * scale, 2);
          expect(box.x).toBeCloseTo((size.width - box.width) / 2, 2);
          expect(box.y).toBeCloseTo((size.height - box.height) / 2, 2);
        }
      }
      // Prove that the comparison detects an internal (rather than external) scale.
      const frame = await getSlideFrame(projection);
      await frame.locator(".deck").evaluate((deck) => { deck.style.transform = "scale(.9)"; });
      expect(await geometry(frame.locator(".deck"))).not.toEqual(reference.at(-1));
    } finally {
      await context.close();
      await harness.close();
    }
  });
}

test("view changes keep only visible surfaces and one state subscription", async ({ page }) => {
  const harness = await startHarness({ slides: SLIDES });
  await page.addInitScript(() => {
    window.surfaceSubscriptions = { events: 0, polls: 0 };
    const Events = window.EventSource;
    window.EventSource = class extends Events {
      constructor(...args) {
        super(...args);
        window.surfaceSubscriptions.events++;
      }
    };
    const interval = window.setInterval;
    window.setInterval = (...args) => {
      if (args[1] === 2000) window.surfaceSubscriptions.polls++;
      return interval(...args);
    };
  });
  try {
    await page.goto(harness.url);
    await waitForSlideReady(page);
    const original = await getSlideFrame(page);
    for (let cycle = 0; cycle < 4; cycle++) {
      await clickMoreControl(page, "#navPresenterView");
      await waitForSlideReady(page);
      await expect(page.locator("iframe")).toHaveCount(2);
      expect(page.frames()).toHaveLength(3);
      await expect(page.locator("#stage .deck")).toHaveCount(0);
      const current = await getSlideFrame(page);
      const next = await (await page.$("#presenterNext")).contentFrame();
      await waitForSlideReady(next);
      expect(await current.evaluate(() => window.surfaceSubscriptions)).toEqual({ events: 0, polls: 0 });
      expect(await next.evaluate(() => window.surfaceSubscriptions)).toEqual({ events: 0, polls: 0 });
      const currentDocument = await current.locator("body").elementHandle();
      await page.setViewportSize({ width: 900 + cycle * 20, height: 650 });
      expect(await currentDocument.evaluate((body) => body === document.body)).toBe(true);
      // Returning through a key from inside the frame preserves host shortcuts.
      await current.locator(".deck").press("Escape");
      await expect(page.locator("#presenterView")).toBeHidden();
      await waitForSlideReady(page);
      await expect(page.locator("iframe")).toHaveCount(1);
      expect(current.isDetached()).toBe(true);
      expect(next.isDetached()).toBe(true);
      expect(page.frames()).toHaveLength(2);
    }
    expect(original.isDetached()).toBe(true);
    expect(await page.evaluate(() => window.surfaceSubscriptions)).toEqual({ events: 1, polls: 1 });
    await clickMoreControl(page, "#navFixedPreview");
    await waitForSlideReady(page);
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect(page.locator(".deck")).toHaveCount(1);
    await clickMoreControl(page, "#navFixedPreview");
    await waitForSlideReady(page);
    expect(page.frames()).toHaveLength(2);
  } finally {
    await harness.close();
  }
});
