import { expect, test } from "@playwright/test";

import { startHarness } from "../harness/server.mjs";

const ALERT_SLIDE = [
  "## Alerts",
  "",
  "> [!NOTE]",
  "> Informational **context**.",
  "",
  "> [!WARNING]",
  "> Rotate keys first.",
  ">",
  "> Then deploy.",
  "",
  "> Plain quote stays plain.",
].join("\n");

const textOf = (element) =>
  (element.paragraphs || []).map((paragraph) => paragraph.runs.map((run) => run.text).join("")).join("\n");

const TONES = [
  ["note", "Note", "--info", "--surface-info"],
  ["tip", "Tip", "--success", "--surface-success"],
  ["important", "Important", "--accent", "--accent-soft"],
  ["warning", "Warning", "--warning", "--surface-warning"],
  ["caution", "Caution", "--danger", "--surface-danger"],
];

const TONE_SLIDE = [
  "## Tones",
  ...TONES.flatMap(([type]) => ["", `> [!${type.toUpperCase()}]`, `> The ${type} body.`]),
].join("\n");

test("renders every GitHub alert type with readable theme tones", async ({ page }) => {
  for (const theme of ["dark", "light", "microsoft"]) {
    const harness = await startHarness({ slides: [TONE_SLIDE], theme });
    try {
      await page.goto(`${harness.url}/?responsive=1`, { waitUntil: "load" });
      const deck = page.locator("#stage > .deck");
      await expect(deck.locator("blockquote.markdown-alert")).toHaveCount(TONES.length);
      const rendered = await deck.evaluate((element, tones) => {
        const probe = document.createElement("span");
        element.append(probe);
        const color = (value) => {
          probe.style.color = value;
          return getComputedStyle(probe).color;
        };
        const read = (name) => color(getComputedStyle(element).getPropertyValue(name).trim());
        const rgba = (value) => {
          const [r, g, b, a = 1] = value.match(/[\d.]+/g).map(Number);
          return { r, g, b, a };
        };
        const over = (top, bottom) => ({
          r: top.r * top.a + bottom.r * (1 - top.a),
          g: top.g * top.a + bottom.g * (1 - top.a),
          b: top.b * top.a + bottom.b * (1 - top.a),
          a: 1,
        });
        const luminance = ({ r, g, b }) => {
          const channel = (value) => {
            const c = value / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
        };
        const contrast = (a, b) => {
          const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
          return (hi + 0.05) / (lo + 0.05);
        };
        const page = over(rgba(read("--bg")), { r: 255, g: 255, b: 255, a: 1 });
        const result = [...element.querySelectorAll(".body > blockquote")].map((quote, index) => {
          const [, , border, surface] = tones[index];
          const style = getComputedStyle(quote);
          const background = over(rgba(style.backgroundColor), page);
          const title = quote.querySelector(":scope > .markdown-alert-title");
          const body = quote.querySelector(":scope > p:not(.markdown-alert-title)");
          return {
            alert: quote.dataset.alert,
            title: title?.textContent,
            text: quote.textContent,
            border: style.borderLeftColor,
            background: style.backgroundColor,
            expectedBorder: read(border),
            expectedBackground: read(surface),
            titleContrast: contrast(rgba(getComputedStyle(title).color), background),
            bodyContrast: contrast(rgba(getComputedStyle(body).color), background),
          };
        });
        probe.remove();
        return result;
      }, TONES);
      for (const [index, [type, label]] of TONES.entries()) {
        const alert = rendered[index];
        expect(alert, `${theme} ${type}`).toMatchObject({
          alert: type,
          title: label,
          border: alert.expectedBorder,
          background: alert.expectedBackground,
        });
        expect(alert.text).not.toContain("[!");
        expect(alert.titleContrast, `${theme} ${type} title`).toBeGreaterThanOrEqual(4.5);
        expect(alert.bodyContrast, `${theme} ${type} body`).toBeGreaterThanOrEqual(4.5);
      }
    } finally {
      await harness.close();
    }
  }
});

test("keeps plain block quotes and unsupported markers unchanged", async ({ page }) => {
  const harness = await startHarness({ slides: [ALERT_SLIDE + "\n\n> [!INFO]\n> Not an alert."] });
  try {
    await page.goto(`${harness.url}/?responsive=1`, { waitUntil: "load" });
    const quotes = page.locator("#stage > .deck .body > blockquote");
    await expect(quotes).toHaveCount(4);
    await expect(quotes.nth(2)).not.toHaveClass(/markdown-alert/);
    await expect(quotes.nth(3)).not.toHaveClass(/markdown-alert/);
    await expect(quotes.nth(3)).toContainText("[!INFO]");
  } finally {
    await harness.close();
  }
});
test("exports alert titles and bodies as native text over decoration artwork", async ({ page }) => {
  const harness = await startHarness({ slides: [ALERT_SLIDE] });
  try {
    await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`, { waitUntil: "load" });
    await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
    const model = await page.evaluate(() => window.__presentationPptxModel);
    const slide = model.slides[0];
    const texts = slide.elements.filter((element) => element.type === "text").map((element) => textOf(element).trim());
    for (const expected of ["Note", "Informational context.", "Warning", "Rotate keys first.", "Then deploy.", "Plain quote stays plain."]) {
      expect(texts).toContain(expected);
    }
    expect(texts.join("\n")).not.toContain("[!");

    const alertFallbacks = slide.fallbacks.filter(
      (fallback) => fallback.reason === "alert-decoration-rendered-as-artwork",
    );
    expect(alertFallbacks).toHaveLength(2);
    for (const fallback of alertFallbacks) {
      expect(fallback).toMatchObject({ type: "decoration", behindNative: true });
      expect(fallback.captureId).toEqual(expect.any(String));
    }
    const titles = slide.elements.filter((element) => element.type === "text" && ["Note", "Warning"].includes(textOf(element)));
    for (const [index, title] of titles.entries()) {
      const box = alertFallbacks[index];
      expect(title.x).toBeGreaterThan(box.x);
      expect(title.y).toBeGreaterThanOrEqual(box.y);
      expect(title.zOrder).toBeGreaterThan(box.zOrder);
    }
    expect(slide.fallbacks).toContainEqual(
      expect.objectContaining({ reason: "native-text-decoration-rendered-as-artwork" }),
    );
  } finally {
    await harness.close();
  }
});

test("exports mixed alert content without duplicated text and keeps artwork behind it", async ({ page }) => {
  const harness = await startHarness({
    slides: [[
      "## Mixed",
      "",
      "> [!CAUTION]",
      "> ### Before you start",
      ">",
      "> - first step",
      "> - second step",
      ">",
      "> ```sh",
      "> rm -rf build",
      "> ```",
      ">",
      "> > Nested quote",
    ].join("\n")],
  });
  try {
    await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`, { waitUntil: "load" });
    await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
    const slide = (await page.evaluate(() => window.__presentationPptxModel)).slides[0];
    const texts = slide.elements.filter((element) => element.type === "text").map((element) => textOf(element).trim());
    for (const expected of ["Caution", "Before you start", "Nested quote"]) {
      expect(texts.filter((text) => text === expected), expected).toHaveLength(1);
    }
    expect(texts.filter((text) => text.includes("first step"))).toHaveLength(1);
    expect(texts.join("\n")).not.toContain("[!");
    const code = slide.elements.filter((element) => element.type === "shape" && textOf(element).includes("rm -rf build"));
    expect(code).toHaveLength(1);
    const [decoration] = slide.fallbacks.filter((fallback) => fallback.reason === "alert-decoration-rendered-as-artwork");
    expect(decoration).toBeTruthy();
    const inside = slide.elements.filter((element) =>
      element.x >= decoration.x && element.y >= decoration.y &&
      element.x + element.width <= decoration.x + decoration.width + 1 &&
      element.y + element.height <= decoration.y + decoration.height + 1);
    expect(inside.length).toBeGreaterThanOrEqual(5);
    for (const element of inside) expect(element.zOrder).toBeGreaterThan(decoration.zOrder);
  } finally {
    await harness.close();
  }
});