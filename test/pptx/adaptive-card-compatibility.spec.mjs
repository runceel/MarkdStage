import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { withDeckServer } from "../../packages/markdstage-cli/src/deck.mjs";
import { createOutputJob, createOutputSnapshot, exportPptx } from "../../.github/extensions/markdstage/runtime/output.mjs";
import { runPptxOutputBrowser } from "../../.github/extensions/markdstage/hosts/node/browser.mjs";
import { formatExportReport } from "../../.github/extensions/markdstage/runtime/export-report.mjs";
import { inspectPptxPackage } from "../../.github/extensions/markdstage/runtime/pptx-package.mjs";
import { CARD_FIXTURE_DIRECTORY, cardFence, staticCard } from "../harness/adaptive-cards.mjs";
import { validateAdaptiveCardSource } from "../../.github/extensions/markdstage/renderer/adaptive-card-validation.mjs";
import {
  adaptiveCardCompatibilityCases, compatibilityDiagnostics, assertCompatibilityOutput,
} from "../harness/adaptive-card-compatibility.mjs";
import { readSystemsPackage } from "../utils/systems-fallback-contract.mjs";

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  test(`official-sample corpus preserves content, exact diagnostics and actual PPTX modes: ${theme}`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const workspace = testInfo.outputPath("workspace");
    await mkdir(workspace, { recursive: true });
    await cp(join(CARD_FIXTURE_DIRECTORY, "assets"), join(workspace, "assets"), { recursive: true });
    const cases = await adaptiveCardCompatibilityCases();
    const file = join(workspace, "cards.md");
    await writeFile(file, cases.map((entry) => entry.markdown).join("\n\n---\n\n"));
    if (theme === "custom") await writeFile(join(workspace, "theme.css"),
      ":root{--bg:#102030;--fg:#fefefe;--body:#e0e4e8;--muted:#adbccc;--accent:#ff6600;--surface:#203040;--border:#405060;}");
    await withDeckServer({ file, workspace, theme, ...(theme === "custom" ? { themeFile: "theme.css" } : {}) }, async (session) => {
      const requests = [];
      page.on("request", (request) => requests.push(request.url()));
      const token = crypto.randomUUID();
      session.exportJobs.set(token, createOutputJob(createOutputSnapshot(session), "capture"));
      try {
        for (const [index, entry] of cases.entries()) {
          await page.goto(`${session.url}?capture=1&token=${token}&index=${index}`);
          await expect(page.locator("html")).toHaveAttribute("data-capture-ready", "true");
          const result = await page.evaluate(async () => {
            const { getAdaptiveCardDiagnostics, getAdaptiveCardSemanticModel, collectAdaptiveCardPptx } = await import("./renderer/adaptive-card.mjs");
            const host = document.querySelector(".adaptive-card-host");
            const before = host.getBoundingClientRect().toJSON();
            const text = host.shadowRoot.textContent;
            const card = getAdaptiveCardDiagnostics(host);
            const model = getAdaptiveCardSemanticModel(host);
            await collectAdaptiveCardPptx(host, host.closest(".deck"));
            return { card, text, before, after: host.getBoundingClientRect().toJSON(),
              afterText: host.shadowRoot.textContent,
              interactive: host.shadowRoot.querySelectorAll("input,textarea,select,button,video,audio,iframe,[href],[onclick]").length,
              supportsInteractivity: model?.hostConfig.supportsInteractivity ?? false };
          });
          expect(result.card.status, entry.name).toBe(entry.browser.status);
          expect(compatibilityDiagnostics(result.card.diagnostics), entry.name).toEqual(entry.browser.diagnostics);
          expect(result.card.complete).toBe(entry.static.complete);
          expect(result.card.diagnosticsTruncated).toBe(!entry.static.complete);
          for (const diagnostic of result.card.diagnostics) {
            expect(diagnostic.sourcePath).toBe(`adaptive-card[0]${diagnostic.path}`);
            expect(diagnostic.impact).toBe("content");
          }

          for (const text of entry.contains) expect(result.text, `${entry.name}: ${text}`).toContain(text);
          for (const text of entry.absent) expect(result.text, `${entry.name}: ${text}`).not.toContain(text);
          expect(result.interactive).toBe(0);
          expect(result.supportsInteractivity).toBe(false);
          expect(result.after).toEqual(result.before);
          expect(result.afterText).toBe(result.text);
        }
        expect(requests.filter((url) => new URL(url).origin !== new URL(session.url).origin)).toEqual([]);
        expect(requests.some((url) => /never-fetched|custom-host:|external\.invalid/.test(url))).toBe(false);
        let rendered;
        const report = await exportPptx(session, "cards.pptx", theme, {
          findChromiumBrowser: () => chromium.executablePath(),
          runPptxOutputBrowser: async (...args) => { rendered = await runPptxOutputBrowser(...args); return rendered; },
        });
        expect(report.ok).toBe(true);
        await assertCompatibilityOutput(cases, rendered.model);
        expect(report.adaptiveCardsTruncated).toBe(true);
        expect(report.adaptiveCardsComplete).toBe(false);
        const bytes = await readFile(join(workspace, "cards.pptx"));
        expect(inspectPptxPackage(bytes).valid).toBe(true);
        const files = readSystemsPackage(bytes);
        for (const [index, entry] of cases.entries()) {
          const slide = rendered.model.slides[index], card = report.adaptiveCards[index];
          expect(card).toEqual({ slideIndex: index, page: index + 1, ...slide.adaptiveCards[0] });
          expect(compatibilityDiagnostics(card.diagnostics)).toEqual(entry.browser.diagnostics);
          const xml = files.get(`ppt/slides/slide${index + 1}.xml`).toString("utf8");
          if (entry.name.startsWith("native-")) for (const text of entry.contains) expect(xml).toContain(text);
          if (entry.name === "native-flight-table") expect(xml.match(/<a:tbl>/g)).toHaveLength(1);
          if (entry.name === "native-activity") expect(xml.match(/<a:tbl>/g)).toHaveLength(1);
          const relations = files.get(`ppt/slides/_rels/slide${index + 1}.xml.rels`).toString("utf8");
          expect(relations).not.toMatch(/external\.invalid|custom-host:|user:secret|never-fetched/);
          if (entry.name === "static-actions-media") expect(relations).toContain("https://adaptivecards.microsoft.com/");
          const images = rendered.slideFallbackImages[index].filter((capture) => slide.fallbacks[capture.fallbackIndex].type === "adaptive-card");
          expect(images).toHaveLength(card.rasterizedSubtreeCount);
          expect(images.every((image) => image.width > 0 && image.height > 0)).toBe(true);
        }
        const text = formatExportReport(report);
        for (const card of report.adaptiveCards) for (const diagnostic of card.diagnostics) {
          expect(text).toContain(`${diagnostic.severity} slide ${card.page}: ${diagnostic.sourcePath}`);
          expect(text).toContain(`(${diagnostic.code}; content impact)`);
        }
        await writeFile(testInfo.outputPath("export-report.json"), JSON.stringify(report, null, 2));
        await writeFile(testInfo.outputPath("export-report.txt"), text);
        await writeFile(testInfo.outputPath("model.json"), JSON.stringify(rendered.model, null, 2));
      } finally { session.exportJobs.delete(token); }
    });
  });
}

test("post-validation browser truncation and native separators beside raster content remain honest in actual export", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const workspace = testInfo.outputPath("workspace");
  await mkdir(workspace, { recursive: true });
  const truncated = staticCard(Array.from({ length: 100 }, (_, index) => ({
    type: "TextBlock", text: `Retained ${index} <img src="https://never-fetch.invalid/${index}.png">`,
  })));
  const validated = validateAdaptiveCardSource(JSON.stringify(truncated));
  expect(validated.valid).toBe(true);
  expect(validated.diagnostics).toEqual([]);
  const file = join(workspace, "cards.md");
  await writeFile(file, [
    cardFence(truncated),
    cardFence(staticCard([{ type: "TextBlock", text: "Native neighbor" },
      { type: "TextBlock", text: "- Bounded list", separator: true }])),
  ].join("\n\n---\n\n"));
  await withDeckServer({ file, workspace }, async (session) => {
    const token = crypto.randomUUID();
    session.exportJobs.set(token, createOutputJob(createOutputSnapshot(session), "capture"));
    await page.goto(`${session.url}?capture=1&token=${token}&index=0`);
    await expect(page.locator("html")).toHaveAttribute("data-capture-ready", "true");
    await expect(page.locator(".adaptive-card-host")).toHaveAttribute("data-adaptive-card-state", "error");
    let rendered;
    const report = await exportPptx(session, "cards.pptx", undefined, {
      findChromiumBrowser: () => chromium.executablePath(),
      runPptxOutputBrowser: async (...args) => { rendered = await runPptxOutputBrowser(...args); return rendered; },
    });
    const error = report.adaptiveCards[0];
    expect(error.diagnostics).toHaveLength(100);
    expect(error.diagnostics.at(-1).code).toBe("diagnostics-truncated");
    expect(error.complete).toBe(false);
    expect(error.resourceValidation).toBe("browser-checked");
    expect(report.adaptiveCardsComplete).toBe(false);
    expect(report.adaptiveCardsTruncated).toBe(true);
    expect(error.nativeObjectCount).toBe(0);
    expect(error.rasterizedSubtreeCount).toBe(1);
    const separated = report.adaptiveCards[1];
    expect(separated.conversions).toContainEqual({
      sourcePath: "adaptive-card[0]$.body[1].separator", sourceType: "TextBlock",
      mode: "native", reason: "adaptive-card-native", nativeObjects: 1, impact: "none",
    });
    expect(separated.conversions.reduce((sum, entry) => sum + entry.nativeObjects, 0)).toBe(separated.nativeObjectCount);
    expect(rendered.model.slides[1].elements.filter((element) => element.adaptiveCard && element.type === "connector")).toHaveLength(1);
    expect(inspectPptxPackage(await readFile(join(workspace, "cards.pptx"))).valid).toBe(true);
    await writeFile(testInfo.outputPath("export-report.json"), JSON.stringify(report, null, 2));
    session.exportJobs.delete(token);
  });
});
