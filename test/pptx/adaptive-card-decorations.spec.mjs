import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { withDeckServer } from "../../packages/markdstage-cli/src/deck.mjs";
import { createOutputJob, createOutputSnapshot, exportPptx } from "../../.github/extensions/markdstage/runtime/output.mjs";
import { runPptxOutputBrowser } from "../../.github/extensions/markdstage/hosts/node/browser.mjs";
import { inspectPptxPackage } from "../../.github/extensions/markdstage/runtime/pptx-package.mjs";
import {
  adaptiveCardGeometry, adaptiveCardNativeModel, CARD_FIXTURE_DIRECTORY, cardFence, staticCard,
} from "../harness/adaptive-cards.mjs";
import { readSystemsPackage } from "../utils/systems-fallback-contract.mjs";

const combinations = [
  { name: "none", underline: false, strikethrough: false },
  { name: "underline", underline: true, strikethrough: false },
  { name: "strike", underline: false, strikethrough: true },
  { name: "both", underline: true, strikethrough: true },
];
const matrix = staticCard([
  ...[
    { name: "Regular", italic: false },
    { name: "Italic", italic: true },
    { name: "Link", italic: true, link: true },
  ].map(({ name, italic, link }) => ({
    type: "RichTextBlock",
    inlines: [
      ...combinations.map(({ name: decoration, ...flags }) => ({
        type: "TextRun", text: `${name} ${decoration} / `, italic, ...flags,
        ...(link ? { color: "Accent",
          selectAction: { type: "Action.OpenUrl", url: `https://example.com/${decoration}` } } : {}),
      })),
      `${name} default`,
    ],
  })),
  { type: "TextBlock", wrap: true, text: [
    "**MD bold**", "*MD italic*", "<u>MD underline</u>", "<s>MD strike</s>",
    "<u><s><em>MD both</em></s></u>", "`MD code`", "[MD link](https://example.com/markdown)",
  ].join(" / ") },
]);

// Computed paint is a test oracle only. Production resolves the pinned SDK's
// typed properties; public rendered references locate these independent witnesses.
async function decorationPaint() {
  const { getAdaptiveCardModel, getAdaptiveCardSemanticModel } =
    await import("./renderer/adaptive-card.mjs");
  const host = document.querySelector(".adaptive-card-host");
  const card = getAdaptiveCardModel(host), original = getAdaptiveCardSemanticModel(host);
  const result = [];
  const flags = (run) => ({ italic: run.italic, underline: run.underline, strikethrough: run.strikethrough });
  const paint = (element, owner) => {
    const style = getComputedStyle(element), decorations = new Set();
    for (let part = element; part; part = part.parentElement) {
      for (const line of getComputedStyle(part).textDecorationLine.split(" ")) {
        if (line !== "none") decorations.add(line);
      }
      if (part === owner) break;
    }
    return { italic: style.fontStyle === "italic", decorations: [...decorations].sort(),
      color: `#${style.color.match(/\d+/g).slice(0, 3)
        .map((value) => Number(value).toString(16).padStart(2, "0")).join("").toUpperCase()}` };
  };
  for (let body = 0; body < card.getItemCount(); body++) {
    const item = card.getItemAt(body);
    if (item instanceof AdaptiveCards.RichTextBlock) {
      for (let inline = 0; inline < item.getInlineCount(); inline++) {
        const run = item.getInlineAt(inline);
        result.push({ sourcePath: `adaptive-card[0]$.body[${body}].inlines[${inline}]`, text: run.text,
          type: run.getJsonTypeName(), typed: run instanceof AdaptiveCards.TextRun,
          original: flags(original.getItemAt(body).getInlineAt(inline)), rendered: flags(run),
          paint: paint(run.renderedElement, item.renderedElement) });
      }
    } else if (item instanceof AdaptiveCards.TextBlock) {
      const walker = document.createTreeWalker(item.renderedElement, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.data.startsWith("MD ")) continue;
        result.push({ sourcePath: `adaptive-card[0]$.body[${body}]`, text: node.data, type: "Markdown",
          paint: paint(node.parentElement, item.renderedElement) });
      }
    }
  }
  return result;
}

function matchingRun(elements, witness) {
  const matches = elements.filter((element) => element.adaptiveCard?.sourcePath === witness.sourcePath)
    .flatMap((element) => element.paragraphs?.flatMap((paragraph) =>
      paragraph.runs.filter((run) => run.text.trim() === witness.text.trim())) || []);
  expect(matches, `${witness.sourcePath}: ${witness.text}`).toHaveLength(1);
  return matches[0];
}

function expectNativePaint(elements, witnesses) {
  for (const witness of witnesses) {
    expect(matchingRun(elements, witness), witness.text).toEqual(expect.objectContaining({
      italic: witness.paint.italic, color: witness.paint.color,
      underline: witness.paint.decorations.includes("underline"),
      strikethrough: witness.paint.decorations.includes("line-through"),
    }));
  }
}

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  test(`pinned TextRun decoration paint survives native collection and actual PPTX (${theme})`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const workspace = testInfo.outputPath(theme);
    await mkdir(join(workspace, "chromium"), { recursive: true });
    await cp(join(CARD_FIXTURE_DIRECTORY, "assets"), join(workspace, "assets"), { recursive: true });
    const mixed = await readFile(join(CARD_FIXTURE_DIRECTORY, "mixed-native.json"), "utf8");
    const slides = [
      `## Adaptive Cards: mixed-native\n\n${cardFence(mixed)}`,
      `## Adaptive Cards: decoration precedence\n\n${cardFence(matrix)}`,
    ];
    const file = join(workspace, "cards.md");
    await writeFile(file, slides.join("\n\n---\n\n"));
    if (theme === "custom") await writeFile(join(workspace, "theme.css"),
      ":root{--bg:#102030;--fg:#fefefe;--body:#e0e4e8;--muted:#adbccc;--accent:#ff6600;--surface:#203040;--border:#405060;}");
    await withDeckServer({ file, workspace, theme, ...(theme === "custom" ? { themeFile: "theme.css" } : {}) }, async (session) => {
      const token = crypto.randomUUID(), observations = [];
      session.exportJobs.set(token, createOutputJob(createOutputSnapshot(session), "capture"));
      try {
        for (let index = 0; index < slides.length; index++) {
          await page.goto(`${session.url}?capture=1&token=${token}&index=${index}`);
          await expect(page.locator("html")).toHaveAttribute("data-capture-ready", "true");
          const paint = await page.evaluate(decorationPaint), geometry = await page.evaluate(adaptiveCardGeometry);
          const before = await page.screenshot({ path: join(workspace, "chromium", `slide-${index + 1}-before.png`) });
          const native = await page.evaluate(adaptiveCardNativeModel);
          expect(await page.evaluate(decorationPaint)).toEqual(paint);
          expect(await page.evaluate(adaptiveCardGeometry)).toEqual(geometry);
          expect((await page.screenshot({ path: join(workspace, "chromium", `slide-${index + 1}-after.png`) })).equals(before)).toBe(true);
          expect(await page.evaluate(adaptiveCardNativeModel)).toEqual(native);
          observations.push({ page: index + 1, paint, geometry, native, collectionPixelsUnchanged: true });
          await writeFile(join(workspace, "browser-evidence.json"), JSON.stringify(observations, null, 2));
          for (const witness of paint.filter((entry) => entry.type === "TextRun")) {
            expect(witness.typed).toBe(true);
            expect(witness.rendered).toEqual(witness.original);
            const expected = witness.original.underline ? ["underline"]
              : witness.original.strikethrough ? ["line-through"] : [];
            expect(witness.paint.decorations, witness.text).toEqual(expected);
            expect(witness.paint.italic, witness.text).toBe(witness.original.italic);
          }
          expectNativePaint(native[0].cards[0].elements, paint);
          for (const witness of paint) {
            expect(native[0].cards[0].conversions.find((entry) => entry.sourcePath === witness.sourcePath))
              .toEqual(expect.objectContaining({ mode: "native", impact: "none" }));
          }
        }
        expect(observations[0].paint.find((entry) => entry.text === " and styled text"))
          .toEqual(expect.objectContaining({ original: { italic: true, underline: true, strikethrough: true },
            paint: expect.objectContaining({ italic: true, decorations: ["underline"] }) }));
        expect(observations[1].paint.filter((entry) => entry.type === "TextRun")).toHaveLength(15);
        expect(observations[1].paint.filter((entry) => entry.type === "Markdown")).toHaveLength(7);
        expect(observations[1].paint.find((entry) => entry.text === "MD both").paint.decorations)
          .toEqual(["line-through", "underline"]);
        const markdownElements = observations[1].native[0].cards[0].elements;
        expect(matchingRun(markdownElements, observations[1].paint.find((entry) => entry.text === "MD bold")).fontFace)
          .toBe("Segoe UI Semibold");
        expect(matchingRun(markdownElements, observations[1].paint.find((entry) => entry.text === "MD code")).fontFace)
          .toBe("Consolas");

        let rendered;
        const report = await exportPptx(session, "cards.pptx", theme, {
          findChromiumBrowser: () => chromium.executablePath(),
          runPptxOutputBrowser: async (...args) => {
            rendered = await runPptxOutputBrowser(...args);
            return rendered;
          },
        });
        expect(report.ok).toBe(true);
        await writeFile(join(workspace, "model.json"), JSON.stringify(rendered.model, null, 2));
        await writeFile(join(workspace, "export-report.json"), JSON.stringify(report, null, 2));
        const bytes = await readFile(join(workspace, "cards.pptx"));
        expect(inspectPptxPackage(bytes).valid).toBe(true);
        const files = readSystemsPackage(bytes);
        for (const [index, observation] of observations.entries()) {
          const slide = rendered.model.slides[index];
          expectNativePaint(slide.elements, observation.paint);
          const xml = files.get(`ppt/slides/slide${index + 1}.xml`).toString("utf8");
          const shapes = await page.evaluate((source) => {
            const document = new DOMParser().parseFromString(source, "application/xml");
            return [...document.getElementsByTagName("p:sp")].map((shape) => ({
              link: shape.getElementsByTagName("p:cNvPr")[0]?.getElementsByTagName("a:hlinkClick")[0]?.getAttribute("r:id"),
              runs: [...shape.getElementsByTagName("a:r")].map((run) => {
                const properties = run.getElementsByTagName("a:rPr")[0];
                return { text: run.getElementsByTagName("a:t")[0].textContent,
                  underline: properties.getAttribute("u") === "sng",
                  strikethrough: properties.getAttribute("strike") === "sngStrike",
                  italic: properties.getAttribute("i") === "1",
                  color: `#${properties.getElementsByTagName("a:srgbClr")[0].getAttribute("val")}`,
                  runLink: properties.getElementsByTagName("a:hlinkClick").length > 0 };
              }),
            }));
          }, xml);
          for (const witness of observation.paint) {
            const matches = shapes.flatMap((shape) => shape.runs.filter((run) => run.text.trim() === witness.text.trim())
              .map((run) => ({ shape, run })));
            expect(matches, witness.text).toHaveLength(1);
            expect(matches[0].run).toEqual(expect.objectContaining({
              underline: witness.paint.decorations.includes("underline"),
              strikethrough: witness.paint.decorations.includes("line-through"),
              italic: witness.paint.italic, color: witness.paint.color, runLink: false,
            }));
            const linked = slide.elements.find((element) => element.adaptiveCard?.sourcePath === witness.sourcePath &&
              element.href && element.paragraphs.some((paragraph) =>
              paragraph.runs.some((run) => run.text.trim() === witness.text.trim())));
            if (linked) expect(matches[0].shape.link).toBeTruthy();
          }
        }
        expect(rendered.model.slides[0].fallbacks.filter((entry) => entry.type === "adaptive-card").map((entry) => entry.reason).sort())
          .toEqual(["adaptive-card-diagnostic-note", "adaptive-card-image-style", "adaptive-card-markdown-list"]);
        expect(rendered.model.slides[1].fallbacks.filter((entry) => entry.type === "adaptive-card").map((entry) => entry.reason))
          .toEqual(["adaptive-card-diagnostic-note"]);
        await testInfo.attach(`${theme}-actual-pptx`, { path: join(workspace, "cards.pptx"),
          contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
      } finally { session.exportJobs.delete(token); }
    });
  });
}
