import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { startHarness } from "../harness/server.mjs";
import { waitForPrintReady, waitForSlideReady } from "../utils/ready.mjs";
import { createDeckSession } from "../../.github/extensions/markdstage/runtime/deck-session.mjs";
import { startPresentationServer } from "../../.github/extensions/markdstage/hosts/node/presentation-server.mjs";
import { createOutputJob, createOutputSnapshot } from "../../.github/extensions/markdstage/runtime/output.mjs";

test.use({ launchOptions: { executablePath: chromium.executablePath() } });

const diagram = (source) => `## Mermaid theme\n\n\`\`\`mermaid\n${source}\n\`\`\``;
const fixture = (name) => readFile(join(process.cwd(), "test", "fixtures", "mermaid", `${name}.mmd`), "utf8");
const customLight = "--bg:hsl(0, 0%, 100%);--print-slide-bg:#fff;--fg:#15181f;--body:#333a44;--surface:white;--code:rgb(95% 95% 95%);--border:#888;--accent:deepskyblue;--accent-strong:#0af;--accent-soft:#eef2ff;--accent-line:#c7d2fe;";
const palettes = [
  { name: "dark", theme: "dark" },
  { name: "light", theme: "light" },
  { name: "microsoft", theme: "microsoft" },
  { name: "custom-dark", theme: "custom", customThemeCss: "--bg:#102030;--print-slide-bg:#102030;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;" },
  { name: "custom-light", theme: "custom", customThemeCss: customLight },
];

function contrast(foreground, background) {
  const luminance = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number).reduce((sum, channel, index) => {
    const value = channel / 255;
    return sum + [0.2126, 0.7152, 0.0722][index] *
      (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  }, 0);
  const values = [luminance(foreground), luminance(background)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

async function paints(deck, selector, property) {
  return deck.locator(selector).evaluateAll(
    (elements, property) => elements.map((element) => getComputedStyle(element)[property]), property,
  );
}

async function paletteColor(deck, variable) {
  return deck.evaluate((deck, variable) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${variable})`;
    deck.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, variable);
}

async function expectC4Defaults(deck) {
  const accent = await paletteColor(deck, "--accent");
  const boundaries = await paints(deck, '.mermaid rect[fill="none"]', "stroke");
  expect(boundaries.length).toBeGreaterThan(0);
  expect(boundaries.every((color) => color === accent)).toBe(true);
  const relations = await paints(deck, '.mermaid line[marker-end], .mermaid path[marker-end]', "stroke");
  expect(relations.length).toBeGreaterThan(0);
  expect(relations.every((color) => color === accent)).toBe(true);
  const markers = (await paints(deck, ".mermaid marker path", "fill")).filter((fill) => fill !== "none");
  expect(markers.length).toBeGreaterThan(0);
  expect(markers.every((color) => color === accent)).toBe(true);
}

for (const palette of palettes) {
  test(`rendered systems follow the palette with readable C4 fills (${palette.name})`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const names = ["c4-basic", "c4-hybrid", "architecture-basic", "architecture-hybrid", "eventmodeling-basic", "eventmodeling-hybrid"];
    const harness = await startHarness({ ...palette, slides: await Promise.all(names.map(async (name) => diagram(await fixture(name)))) });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && /Mermaid|mermaid/.test(message.text())) errors.push(message.text());
    });
    try {
      await page.goto(`${harness.url}/?print=1&token=test-print-token`);
      await waitForPrintReady(page);
      expect(errors).toEqual([]);
      for (const [index, name] of names.entries()) {
        const deck = page.locator(".deck").nth(index);
        await expect(deck.locator(".mermaid svg[data-scene-backend]")).toHaveCount(1);
        await deck.screenshot({ path: testInfo.outputPath(`${name}.png`) });
        if (name.startsWith("c4")) {
          const fills = (await paints(deck, ".mermaid rect", "fill")).filter((fill) => fill !== "none");
          expect(fills.length).toBeGreaterThan(0);
          for (const fill of fills) expect(contrast("rgb(255, 255, 255)", fill), `${name}: white on ${fill}`).toBeGreaterThanOrEqual(4.5);
          await expectC4Defaults(deck);
        } else if (name.startsWith("architecture")) {
          const edges = await paints(deck, ".mermaid .edge", "stroke");
          expect(edges.length).toBeGreaterThan(0);
          expect(new Set(edges)).toEqual(new Set([await paletteColor(deck, "--accent")]));
        } else {
          const fills = await paints(deck, ".mermaid rect", "fill");
          expect(fills).toContain(await paletteColor(deck, "--surface"));
          expect(fills).toContain(await paletteColor(deck, "--code"));
          const edges = await paints(deck, ".mermaid .em-relation", "stroke");
          expect(edges.length).toBeGreaterThan(0);
          expect(new Set(edges)).toEqual(new Set([await paletteColor(deck, "--accent")]));
        }
      }
    } finally {
      await harness.close();
    }
  });

}

const examplePalettes = [
  ...palettes.filter((palette) => palette.theme !== "custom"),
  {
    name: "custom-dark", theme: "custom",
    customThemeCss: "--bg:#102030;--print-slide-bg:#102030;--fg:#fefefe;--body:#e0e4e8;--muted:#b0bdcb;--accent:#ff9900;--accent-strong:#ffbd59;--accent-soft:rgba(255,153,0,.14);--accent-line:rgba(255,153,0,.4);--surface:#203040;--code:#25394d;--border:#405060;",
  },
  {
    name: "custom-light", theme: "custom",
    customThemeCss: "--bg:hsl(0, 0%, 100%);--print-slide-bg:#fff;--cover-bg:#e7f7fc;--print-cover-bg:#e7f7fc;--fg:#15181f;--body:#333a44;--muted:#5b6470;--surface:white;--code:#f3f4f6;--code-fg:#006b88;--border:#888;--accent:#008aaa;--accent-strong:#006b88;--accent-soft:#e7f7fc;--accent-line:#a4ddeb;",
  },
];

async function expectTextPaint(deck, selector, background) {
  const colors = await paints(deck, selector, "fill");
  expect(colors.length, selector).toBeGreaterThan(0);
  for (const color of colors) {
    expect(contrast(color, background), `${selector}: ${color} on ${background}`).toBeGreaterThanOrEqual(4.5);
  }
}

async function exampleLabelPaints(deck) {
  return deck.evaluate((deck) => {
    const rgb = (value) => {
      const channels = value.match(/^rgba?\(([^)]+)\)$/)?.[1].split(/[,\s/]+/).map(Number);
      return channels?.length >= 3 ? channels : null;
    };
    const mix = (color, background, opacity) =>
      color.slice(0, 3).map((channel, index) => channel * opacity + background[index] * (1 - opacity));
    const opacity = (element, svg) => {
      let result = 1;
      for (let current = element; current && current !== svg; current = current.parentElement) {
        result *= Number(getComputedStyle(current).opacity);
      }
      return result;
    };
    const probe = document.createElement("span");
    probe.style.color = "var(--bg)";
    deck.append(probe);
    const backdrop = rgb(getComputedStyle(probe).color);
    probe.remove();
    const svg = deck.querySelector(".mermaid > svg");
    const shapes = [...svg.querySelectorAll("rect, circle, ellipse, polygon, path")]
      .filter((shape) => !shape.closest("defs, clipPath, mask"))
      .map((shape) => {
        const css = getComputedStyle(shape);
        const color = rgb(css.fill);
        return {
          shape, color, bounds: shape.getBoundingClientRect(),
          opacity: color ? (color[3] ?? 1) * Number(css.fillOpacity) * opacity(shape, svg) : 0,
        };
      }).filter((entry) => entry.color && entry.opacity > 0);
    const labels = [...svg.querySelectorAll("text:not(:has(tspan)), text tspan:not(:has(tspan)), foreignObject")];
    return labels.flatMap((element) => {
      if (element.closest("defs, clipPath, mask")) return [];
      let target = element;
      if (element.localName === "foreignObject") {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.textContent.trim()) {
            target = node.parentElement;
            break;
          }
        }
      }
      const css = getComputedStyle(target);
      const bounds = target.getBoundingClientRect();
      const alpha = opacity(target, svg);
      if (!target.textContent.trim() || css.visibility !== "visible" || !bounds.width || !bounds.height || alpha === 0) return [];
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + bounds.height / 2;
      // The example uses simple filled label backgrounds. Composite only
      // earlier shapes under the label, including Treemap's .6/.3 fills.
      let background = backdrop;
      for (const entry of shapes) {
        if (!(entry.shape.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        const rect = entry.bounds;
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          background = mix(entry.color, background, entry.opacity);
        }
      }
      const color = rgb(element.localName === "foreignObject" ? css.color : css.fill);
      const foreground = color && mix(color, background, (color[3] ?? 1) * alpha *
        (element.localName === "foreignObject" ? 1 : Number(css.fillOpacity)));
      return [{
        text: target.textContent.trim(),
        foreground: foreground ? `rgb(${foreground.join(",")})` : css.fill,
        background: `rgb(${background.join(",")})`,
      }];
    });
  });
}

async function expectExampleContrast(decks) {
  const er = decks.nth(9);
  const rowLabels = await er.locator(".mermaid .row-rect-odd, .mermaid .row-rect-even").evaluateAll((rows) =>
    rows.flatMap((row) => {
      const bounds = row.getBoundingClientRect();
      return [...row.closest(".node").querySelectorAll(".nodeLabel")].filter((label) => {
        const rect = label.getBoundingClientRect();
        const center = rect.y + rect.height / 2;
        return center > bounds.top && center < bounds.bottom;
      }).map((label) => ({
        text: label.textContent,
        foreground: getComputedStyle(label).color,
        background: getComputedStyle(row.querySelector("path, rect") || row).fill,
      }));
    }),
  );
  expect(rowLabels.length).toBeGreaterThanOrEqual(12);
  expect(new Set(rowLabels.map((label) => label.background)).size).toBe(2);
  for (const label of rowLabels) {
    expect(contrast(label.foreground, label.background), `ER ${label.text}`).toBeGreaterThanOrEqual(4.5);
  }
  const packet = decks.nth(11);
  const background = await paletteColor(packet, "--bg");
  const surface = await paletteColor(packet, "--surface");
  await expectTextPaint(packet, ".packetByte, .packetTitle, .treeView-node-label", background);
  await expectTextPaint(packet, ".packetLabel", surface);
  const treeLines = await paints(packet, ".treeView-node-line", "stroke");
  expect(treeLines.length).toBeGreaterThan(0);
  for (const stroke of treeLines) expect(contrast(stroke, background)).toBeGreaterThanOrEqual(3);
  for (const [index, selector] of [
    [6, ".actor-line, .loopLine"],
    [9, ".node .outer-path path, .node .outer-path rect"],
    [13, ".node :is(rect, path, polygon)"],
  ]) {
    const strokes = (await paints(decks.nth(index), `.mermaid :is(${selector})`, "stroke")).filter((stroke) => stroke !== "none");
    expect(strokes.length, selector).toBeGreaterThan(0);
    for (const stroke of strokes) expect(contrast(stroke, surface), selector).toBeGreaterThanOrEqual(3);
  }
  // The example intentionally styles these nodes; theme adaptation must not repaint them.
  for (const index of [5, 8]) {
    expect(await paints(decks.nth(index), ".mermaid .node :is(rect, path, polygon)", "fill"))
      .toContain("rgb(219, 234, 254)");
  }
  expect(new Set(await paints(decks.nth(14), ".mermaid circle", "fill")))
    .toEqual(new Set(["rgb(37, 99, 235)", "rgb(22, 163, 74)", "rgb(249, 115, 22)"]));
  for (const index of [2, 3, 4, 12, 17, 19]) {
    const labels = await exampleLabelPaints(decks.nth(index));
    expect(labels.length, `page ${index + 1}`).toBeGreaterThan(0);
    for (const label of labels) {
      expect(contrast(label.foreground, label.background),
        `page ${index + 1}: ${label.text} (${label.foreground} on ${label.background})`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
  const xy = decks.nth(15);
  const chartBackgrounds = await paints(xy, ".mermaid .background rect, .mermaid rect.background", "fill");
  expect(chartBackgrounds).toEqual([background]);
  await expectTextPaint(xy, ".chart-title text, .bottom-axis text, .left-axis text", chartBackgrounds[0]);
  const plot = await xy.locator(".mermaid svg").evaluate((svg) => {
    const rectangles = [...svg.querySelectorAll('[class^="bar-plot-"] rect')];
    const lines = [...svg.querySelectorAll('[class^="line-plot-"] path')];
    return {
      bars: rectangles.map((element) => getComputedStyle(element).fill),
      lines: lines.map((element) => getComputedStyle(element).stroke),
    };
  });
  expect(plot.bars.length).toBeGreaterThan(0);
  expect(plot.lines.length).toBeGreaterThan(0);
  for (const fill of plot.bars) {
    expect(contrast(fill, background)).toBeGreaterThanOrEqual(3);
    for (const stroke of plot.lines) expect(contrast(stroke, fill)).toBeGreaterThanOrEqual(4.5);
  }
  for (const stroke of plot.lines) expect(contrast(stroke, background)).toBeGreaterThanOrEqual(3);
}

for (const palette of examplePalettes) {
  test(`every Mermaid example slide renders with readable diagram colors (${palette.name})`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const session = await createDeckSession({
      file: join(process.cwd(), "docs", "examples", "mermaid-support.md"),
      workspaceRoot: process.cwd(),
      theme: palette.theme === "custom" ? "dark" : palette.theme,
    });
    if (palette.customThemeCss) {
      session.theme = palette.theme;
      session.customThemeCss = palette.customThemeCss;
    }
    const server = await startPresentationServer(session, { token: randomUUID() });
    const token = randomUUID();
    const job = createOutputJob(createOutputSnapshot(session), "inspect");
    session.exportJobs.set(token, job);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && /Mermaid|mermaid/.test(message.text())) errors.push(message.text());
    });
    try {
      await page.goto(`${session.url}?print=1&token=${token}`);
      await waitForPrintReady(page);
      const decks = page.locator(".deck");
      await expect(decks).toHaveCount(29);
      // The source says theme:microsoft; verify the real explicit CLI override wins.
      expect(await decks.evaluateAll((decks) => [...new Set(decks.map((deck) => deck.dataset.theme))]))
        .toEqual([palette.theme]);
      await expect(page.locator(".mermaid svg[data-scene-backend]")).toHaveCount(21);
      expect(errors).toEqual([]);
      expect(job.layout.slides.filter((slide) => slide.pdfClipped)).toEqual([]);
      await expectExampleContrast(decks);
      for (const index of [9, 11]) await decks.nth(index).screenshot({ path: testInfo.outputPath(`page-${index + 1}.png`) });
    } finally {
      session.exportJobs.delete(token);
      await page.goto("about:blank");
      await server.close();
    }
  });
}

test("C4 defaults are themed with comments, directives, front matter and deployment boundaries", async ({ page }, testInfo) => {
  const source = await fixture("c4-basic");
  const sources = [
    `%% UpdateElementStyle and UpdateRelStyle(a, b) are optional\n${source}`,
    `---\ntitle: C4 with metadata\n---\n${source}`,
    `%%{init: {"c4": {"wrap": true}}}%%\n${source}`,
    'C4Deployment\nDeployment_Node(host, "Host", "Linux") {\nContainer(api, "API", "Service", "Handles requests")\nContainer(db, "Data", "Store", "Stores requests")\n}\nRel(api, db, "Writes")',
  ];
  const harness = await startHarness({ slides: sources.map(diagram), theme: "dark" });
  try {
    await page.goto(`${harness.url}/?print=1&token=test-print-token`);
    await waitForPrintReady(page);
    for (let index = 0; index < sources.length; index++) {
      const deck = page.locator(".deck").nth(index);
      await deck.screenshot({ path: testInfo.outputPath(`c4-prefix-${index}.png`) });
      await expectC4Defaults(deck);
    }
  } finally {
    await harness.close();
  }
});

test("C4 source-authored colors are preserved in responsive view and fixed output", async ({ page }) => {
  const source = `${await fixture("c4-basic")}\nUpdateElementStyle(api, "#445566", "#fedcba", "#112233")\nUpdateRelStyle(web, api, "#abcdef", "#444444")`;
  const harness = await startHarness({ slides: [diagram(source)], theme: "dark" });
  try {
    for (const output of [false, true]) {
      await page.goto(output ? `${harness.url}/?print=1&token=test-print-token` : `${harness.url}/?responsive=1`);
      if (output) await waitForPrintReady(page);
      else {
        await waitForSlideReady(page);
        await expect(page.locator("body")).not.toHaveClass(/fixed-output-mode/);
      }
      const deck = page.locator(".deck");
      expect(await paints(deck, ".mermaid rect", "fill")).toContain("rgb(68, 85, 102)");
      expect(await paints(deck, ".mermaid rect", "stroke")).toContain("rgb(17, 34, 51)");
      expect(await paints(deck, ".mermaid text", "fill")).toContain("rgb(254, 220, 186)");
      expect(await paints(deck, ".mermaid text", "fill")).toContain("rgb(171, 205, 239)");
      expect(await paints(deck, ".mermaid line[marker-end]", "stroke")).toContain("rgb(68, 68, 68)");
    }
  } finally {
    await harness.close();
  }
});
