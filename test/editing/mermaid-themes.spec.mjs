import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { startHarness } from "../harness/server.mjs";
import { waitForPrintReady, waitForSlideReady } from "../utils/ready.mjs";

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

function whiteContrast(fill) {
  const channels = fill.match(/[\d.]+/g).slice(0, 3).map(Number);
  const luminance = channels.reduce((sum, channel, index) => {
    const value = channel / 255;
    return sum + [0.2126, 0.7152, 0.0722][index] *
      (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  }, 0);
  return 1.05 / (luminance + 0.05);
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
          for (const fill of fills) expect(whiteContrast(fill), `${name}: white on ${fill}`).toBeGreaterThanOrEqual(4.5);
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
