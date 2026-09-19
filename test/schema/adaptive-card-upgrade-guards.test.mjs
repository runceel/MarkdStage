import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rm, symlink, realpath, lstat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import {
  CARD_REVIEW_THEMES, expectedCardReviewFixtures, compareAdaptiveCardReviews, isReportOutputPath,
} from "../scripts/compare-adaptive-cards-review.mjs";
import { resolveCandidateArtifact, writeCandidateArtifact } from "../scripts/adaptive-card-upgrade-guard.mjs";
import { buildPptxPackage } from "../../.github/extensions/markdstage/runtime/pptx-package.mjs";
import { pptxAdaptiveCardReport, pptxFallbackReport } from "../../.github/extensions/markdstage/runtime/output-model.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const pageName = (number) => `slide-${String(number).padStart(3, "0")}`;
const fixturesBySuite = Object.fromEntries(await Promise.all(["baseline", "compatibility"].map(async (suite) =>
  [suite, await expectedCardReviewFixtures(suite)])));

function solidPng() {
  const chunk = (name, data) => {
    const type = Buffer.from(name), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    let checksum = 0xffffffff;
    for (const byte of Buffer.concat([type, data])) {
      checksum ^= byte;
      for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
    }
    crc.writeUInt32BE((checksum ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, type, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1280); header.writeUInt32BE(720, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc((1280 * 4 + 1) * 720))), chunk("IEND", Buffer.alloc(0))]);
}
const png = solidPng();

// Synthetic proof-contract fixtures: no claim of Office/WebView2 execution.
// Real unchanged 8-deck artifacts are verified separately with the actual CLI.
function proofFixture(suite = "compatibility") {
  const fixtures = fixturesBySuite[suite];
  const base = path.join(repository, "test-results", `memory-${randomUUID()}`);
  const before = path.join(base, "before"), after = path.join(base, "after"), output = path.join(base, "comparison");
  const files = new Map(), reads = [], writes = new Map();
  const json = (file, value) => files.set(file, Buffer.from(JSON.stringify(value)));
  const nativeEngine = {
    runtimeVersion: "153.0.1.1", executable: "C:\\Engine\\msedgewebview2.exe", processId: 123,
    webView2Assembly: "Microsoft.Web.WebView2.Core.Projection",
    controller: { Width: 1280, Height: 720, RasterizationScale: 1, ZoomFactor: 1, IsVisible: true },
  };
  const office = { application: "PowerPoint desktop", version: "16.0", fileVersion: "16.0.1.1", renderWidth: 1280, renderHeight: 720 };
  const bounds = { x: 10, y: 10, width: 100, height: 100 };
  const original = Buffer.from(buildPptxPackage({ title: "Synthetic original",
    slides: Array.from({ length: fixtures.length + 1 }, () => ({ elements: [] })) }));
  const edited = Buffer.from(buildPptxPackage({ title: "Synthetic edited",
    slides: Array.from({ length: fixtures.length + 1 }, () => ({ elements: [] })) }));
  for (const directory of [before, after]) {
    const manifest = { suite, fixtures, head: "a".repeat(40), workingTreeChanged: false,
      chromium: { version: "151.0.1.1", executable: "chromium" },
      webview2: { probe: "native-probe", host: "Real CoreWebView2 controller" },
      sourceHashes: { renderer: "b".repeat(64) },
      bundle: { sdkVersion: "3.0.6", sha256: "c".repeat(64), bytes: 334964, gzipBytes: 50000, chunks: 1 }, themes: {} };
    for (const theme of CARD_REVIEW_THEMES) {
      const themeDirectory = path.join(directory, theme);
      const source = path.join(themeDirectory, "cards.pptx");
      const editedFile = path.join(themeDirectory, "editability", "owned", "edited.pptx");
      const editedPng = path.join(themeDirectory, "editability", "owned", "powerpoint", "slide-001.png");
      const model = { version: 1, width: 1280, height: 720, slides: fixtures.map((fixture) => {
        const elements = [], fallbacks = [];
        const adaptiveCards = fixture.expected.map(({ status, codes }, blockIndex) => {
          const prefix = `adaptive-card[${blockIndex}]`;
          const diagnostics = codes.map((code, index) => {
            const location = code === "diagnostics-truncated" ? "$" : `$.body[${index}]`;
            return { category: "adaptive-card", code,
              severity: status === "error" && code !== "unknown-property" ? "error" : "warning",
              path: location, sourcePath: prefix + location, message: `Synthetic ${code}`, impact: "content" };
          });
          const truncated = codes.includes("diagnostics-truncated");
          const card = { blockIndex, status, sdkVersion: "3.0.6", schemaVersion: "1.5", hostConfigVersion: 1,
            complete: !truncated, diagnosticsTruncated: truncated,
            resourceValidation: status === "ready" ? "browser-checked" : "not-run", diagnostics, conversions: [],
            nativeObjectCount: status === "ready" ? 1 : 0, rasterizedSubtreeCount: 0 };
          if (status === "ready") {
            elements.push({ type: "text", ...bounds,
              adaptiveCard: { sourcePath: `${prefix}$.body[0]`, sourceType: "TextBlock", renderedType: "TextBlock" } });
            card.conversions.push({ sourcePath: `${prefix}$.body[0]`, sourceType: "TextBlock", mode: "native",
              reason: "adaptive-card-native", nativeObjects: 1, impact: "none" });
          }
          if (diagnostics.length) {
            const sourcePath = status === "error" ? prefix : `${prefix}$.diagnostics`;
            const reason = status === "error" ? `adaptive-card-${diagnostics.at(-1).code}` : "adaptive-card-diagnostic-note";
            fallbacks.push({ type: "adaptive-card", sourcePath, path: sourcePath, reason, ...bounds, diagnostics });
            card.rasterizedSubtreeCount = 1;
            card.conversions.push({ sourcePath: status === "error" ? `${prefix}$` : sourcePath,
              sourceType: status === "error" ? "AdaptiveCard" : "Diagnostic",
              mode: "rasterized", reason, nativeObjects: 0, impact: "content" });
          }
          return card;
        });
        return { adaptiveCards, elements, fallbacks };
      }) };
      model.slides.push({ layout: "backcover", elements: [], fallbacks: [] });
      const fallbackReport = pptxFallbackReport(model);
      const exportReport = { ok: true, format: "pptx", path: source, total: model.slides.length, theme,
        bytes: original.length, fallbackCount: fallbackReport.length, fallbacks: fallbackReport, ...pptxAdaptiveCardReport(model) };
      manifest.themes[theme] = {
        export: exportReport,
        pages: fixtures.map((fixture, index) => ({
          index, name: fixture.name, cards: fixture.expected,
          chromiumRepeatGeometry: true, chromiumRepeatPng: true, nativeCollectionUnchanged: true,
          webview2RepeatGeometry: true, webview2RepeatPng: true,
          exportedNativeObjects: model.slides[index].elements.length,
          exportedNativeTypes: model.slides[index].elements.length ? { text: model.slides[index].elements.length } : {},
          rasterizedSubtrees: model.slides[index].fallbacks.length,
          geometryComparison: { edgeTolerance: 2, textRectTolerance: 3, maximumEdgeDelta: 0, maximumTextRectDelta: 0, violations: [], measuredEdges: 4 },
          nativeComparison: { edgeTolerance: 2, maximumDelta: 0, violations: [], measuredMetrics: 0 },
          engine: nativeEngine,
        })),
      };
      files.set(source, original); files.set(editedFile, edited); files.set(editedPng, png);
      json(path.join(themeDirectory, "powerpoint-report.json"), {
        schemaVersion: 2, engine: office, measuredChecksPassed: true, originalUnchanged: true, readOnly: true,
        errors: [], sourcePptx: source, pptxSha256: sha(original), pptxSha256After: sha(original),
        slideCount: fixtures.length + 1,
        pages: Array.from({ length: fixtures.length + 1 }, (_, index) => ({
          page: index + 1, measuredChecksPassed: true, errors: [], missing: [], extra: [],
          shapeCount: 0, expectedShapeCount: 0, shapes: [], mappings: [],
          rasterCount: 0, expectedRasterCount: 0, nativeCounts: {}, expectedNativeCounts: {},
        })),
      });
      json(path.join(themeDirectory, "editability-report.json"), {
        engine: office, sourcePptx: source, copyPptx: editedFile,
        originalSha256Before: sha(original), originalSha256After: sha(original),
        copySha256AfterSave: sha(edited), copySha256AfterReopen: sha(edited),
        measuredChecksPassed: true, originalUnchanged: true, copyIsDisposable: true, reopenedReadOnly: true, saved: true,
        errors: [], requiredNativeTypes: ["text", "shape", "image", "table"],
        requiredOperations: ["text", "fill", "position", "image", "table"],
        operations: ["text", "fill", "position", "image", "table"].map((operation) => ({
          operation, persisted: true, changed: true, error: null, sourceShape: { page: 1 },
          inMemoryChecks: [{ passed: true }], reopenChecks: [{ passed: true }],
        })), inventoryChecks: [{ passed: true }], outputPngPaths: [editedPng],
      });
      json(path.join(themeDirectory, "model.json"), model);
      json(path.join(themeDirectory, "export-report.json"), exportReport);
      files.set(path.join(themeDirectory, "powerpoint", `${pageName(fixtures.length + 1)}.png`), png);
      for (const [index, fixture] of fixtures.entries()) {
        const name = pageName(index + 1);
        const geometry = {
          viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
          slides: [{ index: 0, cards: model.slides[index].adaptiveCards.map((card) => ({
            status: card.status, sdkVersion: card.sdkVersion, schemaVersion: card.schemaVersion, hostConfigVersion: card.hostConfigVersion,
            bounds, diagnostics: card.diagnostics.map(({ sourcePath: _sourcePath, ...entry }) => entry),
            objects: card.status === "ready" ? [{ type: "AdaptiveCard", sourcePath: "$", bounds, textRects: [] }] : [],
          })) }],
          native: [{ index: 0, cards: model.slides[index].adaptiveCards.map((card) => card.status === "error" ? null :
            { scene: {}, elements: model.slides[index].elements.filter((element) =>
              element.adaptiveCard.sourcePath.startsWith(`adaptive-card[${card.blockIndex}]$`)),
            conversions: card.conversions, fallbacks: model.slides[index].fallbacks.filter((fallback) =>
              fallback.sourcePath.startsWith(`adaptive-card[${card.blockIndex}]`)) }) }],
        };
        json(path.join(themeDirectory, "chromium", `${name}.json`), geometry);
        json(path.join(themeDirectory, "webview2", name, "geometry-1.json"), geometry);
        json(path.join(themeDirectory, "webview2", name, "geometry-2.json"), geometry);
        json(path.join(themeDirectory, "webview2", name, "native-engine.json"), nativeEngine);
        for (const file of [path.join("chromium", `${name}.png`), path.join("powerpoint", `${name}.png`),
          path.join("webview2", name, "slide-001.png"), path.join("webview2", name, "slide-002.png")]) {
          files.set(path.join(themeDirectory, file), png);
        }
      }
    }
    json(path.join(directory, "evidence.json"), manifest);
  }
  let launches = 0, comparisons = 0;
  const run = () => compareAdaptiveCardReviews(before, after, output, {
    read: async (file, encoding) => {
      reads.push(file);
      if (!files.has(file)) throw Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT" });
      return encoding ? files.get(file).toString(encoding) : files.get(file);
    },
    write: async (file, bytes) => writes.set(file, bytes),
    makeDirectory: async () => {},
    launch: async () => { launches++; return { newPage: async () => ({}), close: async () => {} }; },
    compareImages: async () => { comparisons++; return {
      changedPixels: 0, changedPixelsOver20: 0, sideBySide: png.toString("base64"), overlay: png.toString("base64"),
    }; },
  });
  return { before, after, output, files, reads, writes, fixtures, run,
    counts: () => ({ launches, comparisons }),
    change(file, mutate) { const value = JSON.parse(files.get(file)); mutate(value); json(file, value); },
    manifests(mutate) { for (const directory of [before, after]) this.change(path.join(directory, "evidence.json"), mutate); },
    outputPath(directory, value) {
      const replace = (report) => {
        if (value === undefined) delete report.path;
        else report.path = value;
      };
      this.change(path.join(directory, "dark", "export-report.json"), replace);
      this.change(path.join(directory, "evidence.json"), (manifest) => replace(manifest.themes.dark.export));
    },
    // Keep redundant local copies in step: a validator must still reject an
    // impossible contract, and compare valid changed outcomes across the pair.
    rewriteOutcome(directory, mutate) {
      const themeDirectory = path.join(directory, "dark");
      const model = JSON.parse(files.get(path.join(themeDirectory, "model.json")));
      mutate(model);
      for (const [index, slide] of model.slides.slice(0, fixtures.length).entries()) {
        for (const card of slide.adaptiveCards) {
          for (const fallback of slide.fallbacks.filter((entry) => entry.diagnostics &&
              entry.sourcePath.startsWith(`adaptive-card[${card.blockIndex}]`))) fallback.diagnostics = card.diagnostics;
        }
        const name = pageName(index + 1);
        for (const location of [path.join("chromium", `${name}.json`), path.join("webview2", name, "geometry-1.json"),
          path.join("webview2", name, "geometry-2.json")]) {
          const file = path.join(themeDirectory, location), geometry = JSON.parse(files.get(file));
          slide.adaptiveCards.forEach((card, block) => {
            Object.assign(geometry.slides[0].cards[block], { status: card.status, sdkVersion: card.sdkVersion,
              schemaVersion: card.schemaVersion, hostConfigVersion: card.hostConfigVersion,
              diagnostics: card.diagnostics.map(({ sourcePath: _sourcePath, ...entry }) => entry) });
            if (geometry.native[0].cards[block]) geometry.native[0].cards[block].conversions = card.conversions;
          });
          json(file, geometry);
        }
      }
      const reportFile = path.join(themeDirectory, "export-report.json");
      const previous = JSON.parse(files.get(reportFile)), fallbackReport = pptxFallbackReport(model);
      const report = { ...previous, fallbacks: fallbackReport, fallbackCount: fallbackReport.length, ...pptxAdaptiveCardReport(model) };
      json(path.join(themeDirectory, "model.json"), model); json(reportFile, report);
      this.change(path.join(directory, "evidence.json"), (value) => { value.themes.dark.export = report; });
    },
  };
}

for (const suite of ["baseline", "compatibility"]) test(`complete ${suite} proof contract compares every theme/page (synthetic I/O)`, async () => {
  const fixture = proofFixture(suite);
  const report = await fixture.run();
  assert.deepEqual(report.failures, []);
  assert.equal(report.preflightComplete, true);
  assert.equal(report.automatedComparisonPassed, true);
  assert.equal(report.pages.length, fixture.fixtures.length * 4);
  assert.equal(fixture.counts().comparisons, fixture.fixtures.length * 4 * 3 + 4);
  assert.equal(report.backCovers.length, 4);
  assert.deepEqual(Object.keys(report.exportOutcomes), CARD_REVIEW_THEMES);
  assert.equal(report.baselineUpdated, false);
});

for (const [name, value] of [
  ["missing", undefined], ["null", null], ["number", 42], ["boolean", false], ["object", {}], ["array", []],
  ["empty", ""], ["spaces", "   "], ["Unicode whitespace", "\u3000\u00a0"],
  ["tab", "\t"], ["newline", "\n"], ["reviewer whitespace/control", " \t "],
  ["embedded tab", "cards\t.pptx"], ["embedded newline", "cards\n.pptx"],
  ["embedded NUL", "cards\u0000.pptx"], ["embedded DEL", "cards\u007f.pptx"],
  ["embedded escape", "\u001b[32mcards.pptx"], ["trailing control", "cards.pptx\r\n"],
  ["trailing space", "cards.pptx "], ["directory only", "/"],
  ["directory suffix", "cards.pptx/"], ["current directory", "."],
  ["empty drive", "C:\\"], ["drive relative", "C:cards.pptx"],
  ["URI not a producer pathname", "https://example.invalid/cards.pptx"],
  ["blank UNC server", "\\\\   \\share\\cards.pptx"],
]) {
  test(`mandatory output path rejects ${name} before path omission on either or both sides`, async () => {
    assert.equal(isReportOutputPath(value), false);
    for (const sides of [["after"], ["before", "after"]]) {
      const fixture = proofFixture("baseline");
      for (const side of sides) fixture.outputPath(fixture[side], value);
      const report = await fixture.run();
      assert.equal(report.automatedComparisonPassed, false);
      assert.equal(fixture.counts().launches, 0);
      assert.ok(report.failures.some((message) => message.includes("invalid mandatory output path metadata")),
        report.failures.join("\n"));
    }
  });
}

for (const [name, value] of [
  ["Windows absolute", String.raw`C:\different location\cards.pptx`],
  ["Windows forward slash", "D:/other/cards.PPTX"],
  ["POSIX absolute", "/different/日本語 deck/cards.pptx"],
  ["portable relative", "exports/another deck.pptx"],
  ["relative filename", "another.pptx"],
  ["portable dotfile", ".pptx"],
  ["portable leading filename space", " another.pptx"],
  ["Windows UNC metadata", String.raw`\\review-server\share\deck.pptx`],
  ["Windows long-path metadata", String.raw`\\?\C:\decks\deck.pptx`],
]) test(`different valid ${name} paths are accepted without lookup or normalization`, async () => {
  assert.equal(isReportOutputPath(value), true);
  const fixture = proofFixture("baseline");
  fixture.outputPath(fixture.after, value);
  const report = await fixture.run();
  assert.equal(report.automatedComparisonPassed, true, report.failures.join("\n"));
  assert.equal(fixture.reads.includes(value), false, "Reported paths must never be read, including network metadata.");
  assert.equal(JSON.parse(fixture.files.get(path.join(fixture.after, "dark", "export-report.json"))).path, value);
});

test("required metadata strings reject blank/control-only engine and SDK identities", async () => {
  for (const mutate of [
    (manifest) => { manifest.bundle.sdkVersion = " \t "; },
    (manifest) => { manifest.chromium.version = "   "; },
    (manifest) => { manifest.chromium.executable = "\n"; },
    (manifest) => { manifest.webview2.probe = "\t"; },
    (manifest) => { manifest.webview2.host = "\u3000"; },
    (manifest) => { manifest.themes.dark.pages[0].engine.runtimeVersion = " \r "; },
  ]) {
    const fixture = proofFixture();
    fixture.manifests(mutate);
    const report = await fixture.run();
    assert.equal(report.automatedComparisonPassed, false);
    assert.equal(fixture.counts().launches, 0);
  }
});

test("required diagnostic metadata cannot be blank but authored empty/whitespace text remains valid", async () => {
  const broken = proofFixture("baseline");
  for (const directory of [broken.before, broken.after]) broken.rewriteOutcome(directory, (model) => {
    const card = model.slides.flatMap((slide) => slide.adaptiveCards || []).find((card) => card.diagnostics.length);
    card.diagnostics[0].message = " \t ";
  });
  assert.equal((await broken.run()).automatedComparisonPassed, false);
  const fixture = proofFixture("baseline");
  for (const directory of [fixture.before, fixture.after]) {
    for (const relative of [path.join("chromium", "slide-001.json"),
      path.join("webview2", "slide-001", "geometry-1.json"), path.join("webview2", "slide-001", "geometry-2.json")]) {
      fixture.change(path.join(directory, "dark", relative), (geometry) => {
        const source = geometry.slides[0].cards[0].objects[0];
        geometry.slides[0].cards[0].objects.push({ ...source, type: "TextBlock", sourcePath: "$.body[0]", text: "" },
          { ...source, type: "TextBlock", sourcePath: "$.body[1]", text: " \t\n " });
      });
    }
  }
  const report = await fixture.run();
  assert.equal(report.automatedComparisonPassed, true, report.failures.join("\n"));
});

for (const sides of [["after"], ["before"], ["before", "after"]]) {
  test(`actual comparator rejects missing export-report.json on ${sides.join("+")}`, async () => {
    const fixture = proofFixture("baseline");
    for (const side of sides) fixture.files.delete(path.join(fixture[side], "dark", "export-report.json"));
    const report = await fixture.run();
    assert.equal(report.automatedComparisonPassed, false);
    assert.equal(fixture.counts().launches, 0);
    assert.ok(report.failures.some((message) => message.includes("export-report.json") && message.includes("ENOENT")));
  });
  for (const [name, mutate, error] of [
    ["unknown output mode", (value) => { value.adaptiveCards[0].conversions[0].mode = "unknown-output-mode"; }, /unknown conversion mode/],
    ["new diagnostic truncation", (value) => {
      value.adaptiveCardsComplete = false; value.adaptiveCardsTruncated = true;
      value.adaptiveCards[0].complete = false; value.adaptiveCards[0].diagnosticsTruncated = true;
    }, /unexpected diagnostic truncation/],
    ["new incomplete outcome", (value) => { value.adaptiveCardsComplete = false; value.adaptiveCards[0].complete = false; }, /unexpected incomplete validation/],
    ["unknown impact", (value) => { value.adaptiveCards[0].conversions[0].impact = "lossless"; }, /invalid content impact/],
    ["wrong card source", (value) => { value.adaptiveCards[0].conversions[0].sourcePath = "adaptive-card[8]$.body[0]"; }, /invalid authored card source/],
    ["unknown source type", (value) => { value.adaptiveCards[0].conversions[0].sourceType = "Custom.Widget"; }, /unknown source type/],
    ["missing conversion mode", (value) => { delete value.adaptiveCards[0].conversions[0].mode; }, /producer fields/],
    ["native count mismatch", (value) => { value.adaptiveCards[0].nativeObjectCount++; }, /native counts do not add up/],
    ["approximation aggregate mismatch", (value) => { value.adaptiveCardConversionSummary.approximated++; }, /producer model\/aggregates/],
    ["issue aggregate mismatch", (value) => { value.adaptiveCardIssueCount++; }, /producer model\/aggregates/],
    ["raster aggregate mismatch", (value) => { value.adaptiveCardConversionSummary.rasterizedSubtrees++; }, /producer model\/aggregates/],
    ["fallback count mismatch", (value) => { value.fallbackCount++; }, /producer model\/aggregates/],
    ["missing aggregate completion flag", (value) => { delete value.adaptiveCardsComplete; }, /producer model\/aggregates/],
    ["unrecognized report flag", (value) => { value.validationSkipped = true; }, /producer model\/aggregates/],
    ["invalid diagnostic severity", (value) => { value.adaptiveCards.find((card) => card.diagnostics.length).diagnostics[0].severity = "information"; }, /invalid diagnostic severity/],
    ["wrong diagnostic source path", (value) => { value.adaptiveCards.find((card) => card.diagnostics.length).diagnostics[0].sourcePath = "adaptive-card[7]$"; }, /diagnostic source identity/],
    ["diagnostic content impact lost", (value) => { value.adaptiveCards.find((card) => card.diagnostics.length).diagnostics[0].impact = "none"; }, /diagnostic lost content impact/],
  ]) test(`actual comparator rejects ${name} on ${sides.join("+")}`, async () => {
    const fixture = proofFixture("baseline");
    for (const side of sides) fixture.change(path.join(fixture[side], "dark", "export-report.json"), mutate);
    const report = await fixture.run();
    assert.equal(report.automatedComparisonPassed, false);
    assert.equal(fixture.counts().launches, 0);
    assert.ok(report.failures.some((message) => error.test(message)), report.failures.join("\n"));
  });
}

test("identically unknown modes in reports, manifests, models and typed collectors still cannot pass", async () => {
  const fixture = proofFixture("baseline");
  for (const directory of [fixture.before, fixture.after]) fixture.rewriteOutcome(directory, (model) => {
    model.slides[0].adaptiveCards[0].conversions[0].mode = "unknown-output-mode";
  });
  const report = await fixture.run();
  assert.equal(report.automatedComparisonPassed, false);
  assert.ok(report.failures.some((message) => message.includes("unknown conversion mode")));
  assert.equal(fixture.counts().launches, 0);
});

test("valid but changed diagnostic outcomes are compared even when every local report copy agrees", async () => {
  const fixture = proofFixture("baseline");
  fixture.rewriteOutcome(fixture.after, (model) => {
    const card = model.slides.flatMap((slide) => slide.adaptiveCards || []).find((card) => card.diagnostics.length);
    card.diagnostics[0].message = "A different valid diagnostic message must not be normalized away.";
  });
  const report = await fixture.run();
  assert.equal(report.automatedComparisonPassed, false);
  assert.equal(fixture.counts().launches, 0);
  assert.ok(report.failures.some((message) => message.includes("diagnostics") && message.includes("message")), report.failures.join("\n"));
});

for (const [name, mutate, field] of [
  ["resource validation", (model) => {
    model.slides.flatMap((slide) => slide.adaptiveCards || []).find((card) => card.status === "error").resourceValidation = "browser-checked";
  }, "resourceValidation"],
  ["known conversion classification", (model) => {
    const card = model.slides.flatMap((slide) => slide.adaptiveCards || []).find((card) =>
      card.diagnostics.some((diagnostic) => diagnostic.code === "static-input"));
    Object.assign(card.conversions[0], { mode: "approximated", treatment: "static-input",
      reason: "adaptive-card-static-input", impact: "content" });
  }, "conversions"],
]) test(`changed ${name} is not discarded when report/model/manifest/collector agree locally`, async () => {
  const fixture = proofFixture("baseline");
  fixture.rewriteOutcome(fixture.after, mutate);
  const report = await fixture.run();
  assert.equal(report.automatedComparisonPassed, false);
  assert.equal(fixture.counts().launches, 0);
  assert.ok(report.failures.some((message) => message.includes(field)), report.failures.join("\n"));
});

test("purposeful negative corpus outcomes remain intact, including the declared incomplete/truncated card", async () => {
  const fixture = proofFixture("compatibility");
  const source = JSON.parse(fixture.files.get(path.join(fixture.after, "dark", "export-report.json")));
  assert.equal(source.adaptiveCardsComplete, false);
  assert.equal(source.adaptiveCardsTruncated, true);
  assert.equal(source.adaptiveCards.at(-1).status, "error");
  assert.equal(source.adaptiveCards.at(-1).complete, false);
  assert.equal(source.adaptiveCards.at(-1).diagnosticsTruncated, true);
  const report = await fixture.run();
  assert.equal(report.automatedComparisonPassed, true, report.failures.join("\n"));
  assert.deepEqual(Object.keys(report.exportOutcomes), CARD_REVIEW_THEMES);
});

for (const [name, mutate] of [
  ["both empty theme maps", (value) => { value.themes = {}; }],
  ["matching partial theme maps", (value) => { delete value.themes.custom; }],
  ["unknown suite", (value) => { value.suite = "custom"; }],
  ["missing SDK bundle identity", (value) => { delete value.bundle; }],
  ["empty source fingerprints", (value) => { value.sourceHashes = {}; }],
  ["missing fixtures", (value) => { value.fixtures.pop(); }],
  ["duplicated fixtures", (value) => { value.fixtures[1] = value.fixtures[0]; }],
  ["missing theme pages", (value) => { value.themes.dark.pages.pop(); }],
  ["duplicate page indexes", (value) => { value.themes.dark.pages[1].index = 0; }],
  ["invalid page indexes", (value) => { value.themes.dark.pages[0].index = -1; }],
  ["manifest marked truncated", (value) => { value.truncated = true; }],
  ["theme proof incomplete", (value) => { value.themes.dark.complete = false; }],
  ["missing Chromium identity", (value) => { delete value.chromium; }],
  ["WebView2 not run", (value) => { value.webview2 = { status: "not run" }; }],
  ["repeat proof absent", (value) => { delete value.themes.dark.pages[0].webview2RepeatPng; }],
  ["unfinished export accounting", (value) => { delete value.themes.dark.pages[0].exportedNativeObjects; }],
  ["hidden tiny WebView2 controller", (value) => { value.themes.dark.pages[0].engine.controller.Width = 1; }],
]) test(`comparison rejects ${name} before engine/artifact loops`, async () => {
  const fixture = proofFixture();
  fixture.manifests(mutate);
  const report = await fixture.run();
  assert.equal(report.automatedComparisonPassed, false);
  assert.equal(report.preflightComplete, false);
  assert.equal(report.pages.length, 0);
  assert.equal(fixture.reads.length, 2, "Only the two manifests should be read before rejection.");
  assert.equal(fixture.counts().launches, 0);
  assert.ok(report.failures.length > 0);
});

for (const [name, relative] of [
  ["PPTX package", ["cards.pptx"]],
  ["model pages", ["model.json"]],
  ["actual export report", ["export-report.json"]],
  ["PowerPoint report", ["powerpoint-report.json"]],
  ["editability report", ["editability-report.json"]],
  ["edited PPTX", ["editability", "owned", "edited.pptx"]],
  ["edited render", ["editability", "owned", "powerpoint", "slide-001.png"]],
  ["Chromium geometry", ["chromium", "slide-001.json"]],
  ["Chromium render", ["chromium", "slide-001.png"]],
  ["WebView2 geometry", ["webview2", "slide-001", "geometry-1.json"]],
  ["WebView2 repeat geometry", ["webview2", "slide-001", "geometry-2.json"]],
  ["WebView2 engine", ["webview2", "slide-001", "native-engine.json"]],
  ["WebView2 repeat render", ["webview2", "slide-001", "slide-002.png"]],
  ["PowerPoint render", ["powerpoint", "slide-001.png"]],
  ["PowerPoint back cover", ["powerpoint", "slide-018.png"]],
]) test(`comparison rejects missing ${name} before starting pixel comparisons`, async () => {
  const fixture = proofFixture();
  fixture.files.delete(path.join(fixture.before, "dark", ...relative));
  const report = await fixture.run();
  assert.equal(report.automatedComparisonPassed, false);
  assert.equal(report.preflightComplete, false);
  assert.equal(fixture.counts().launches, 0);
  assert.ok(report.failures.some((message) => message.includes("ENOENT")));
});

for (const [name, file, mutate] of [
  ["missing PowerPoint page", "powerpoint-report.json", (value) => { value.pages.pop(); }],
  ["duplicate PowerPoint page", "powerpoint-report.json", (value) => { value.pages[1].page = 1; }],
  ["PowerPoint engine removed", "powerpoint-report.json", (value) => { delete value.engine; }],
  ["empty persisted edits", "editability-report.json", (value) => { value.operations = []; }],
  ["unpersisted existing-object edit", "editability-report.json", (value) => { value.operations[0].persisted = false; }],
  ["empty edit checks", "editability-report.json", (value) => { value.operations[0].reopenChecks = []; }],
  ["truncated model", "model.json", (value) => { value.slides.pop(); }],
]) test(`comparison rejects ${name} even when top-level success flags remain true`, async () => {
  const fixture = proofFixture();
  fixture.change(path.join(fixture.before, "dark", file), mutate);
  const report = await fixture.run();
  assert.equal(report.automatedComparisonPassed, false);
  assert.equal(report.preflightComplete, false);
  assert.equal(fixture.counts().launches, 0);
});

test("comparison rejects truncated PNG and geometry proof", async () => {
  for (const kind of ["png", "geometry"]) {
    const fixture = proofFixture();
    if (kind === "png") fixture.files.set(path.join(fixture.before, "dark", "chromium", "slide-001.png"), png.subarray(0, -12));
    else fixture.change(path.join(fixture.before, "dark", "chromium", "slide-001.json"), (value) => { value.slides[0].cards = []; });
    const report = await fixture.run();
    assert.equal(report.automatedComparisonPassed, false);
    assert.equal(fixture.counts().launches, 0);
  }
});

async function ownedWorkspace(t) {
  const base = path.join(repository, "test-results", `guard-${randomUUID()}`);
  const workspace = path.join(base, "checkout"), outside = path.join(base, "outside");
  await mkdir(workspace, { recursive: true }); await mkdir(outside);
  t.after(() => rm(base, { recursive: true, force: true }));
  return { base, workspace, outside };
}

test("real comparator CLI rejects empty/matching partial themes with exit 2, never zero-page success", async (t) => {
  const { base } = await ownedWorkspace(t);
  for (const kind of ["empty", "partial"]) {
    const fixture = proofFixture();
    const directory = path.join(base, kind);
    await mkdir(directory);
    const manifest = JSON.parse(fixture.files.get(path.join(fixture.before, "evidence.json")));
    if (kind === "empty") manifest.themes = {};
    else delete manifest.themes.custom;
    await writeFile(path.join(directory, "evidence.json"), JSON.stringify(manifest));
    const output = path.join(base, `${kind}-comparison`);
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/compare-adaptive-cards-review.mjs", import.meta.url)),
      directory, directory, output], { cwd: repository, encoding: "utf8", windowsHide: true, timeout: 30_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 2, result.stderr);
    const report = JSON.parse(await readFile(path.join(output, "comparison.json")));
    assert.equal(report.automatedComparisonPassed, false);
    assert.equal(report.pages.length, 0);
  }
});

test("actual comparator CLI rejects all three report mutations and symmetric copies using owned synthetic artifacts", async (t) => {
  const { base } = await ownedWorkspace(t);
  const fixture = proofFixture("baseline");
  const directories = { before: path.join(base, "before"), after: path.join(base, "after") };
  for (const [file, bytes] of fixture.files) {
    const side = file.startsWith(fixture.before + path.sep) ? "before" : "after";
    const destination = path.join(directories[side], path.relative(fixture[side], file));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  const originals = Object.fromEntries(await Promise.all(Object.entries(directories).map(async ([side, directory]) =>
    [side, await readFile(path.join(directory, "dark", "export-report.json"))])));
  for (const sides of [["after"], ["before", "after"]]) {
    for (const mutation of ["unknown-export-mode", "missing-export-report", "truncated-export-diagnostics"]) {
      for (const side of sides) {
        const file = path.join(directories[side], "dark", "export-report.json");
        if (mutation === "missing-export-report") await rm(file);
        else {
          const report = JSON.parse(originals[side]);
          if (mutation === "unknown-export-mode") report.adaptiveCards[0].conversions[0].mode = "unknown-output-mode";
          else {
            report.adaptiveCardsComplete = false; report.adaptiveCardsTruncated = true;
            report.adaptiveCards[0].complete = false; report.adaptiveCards[0].diagnosticsTruncated = true;
          }
          await writeFile(file, JSON.stringify(report));
        }
      }
      const output = path.join(base, `${mutation}-${sides.join("-")}`);
      const command = fileURLToPath(new URL("../scripts/compare-adaptive-cards-review.mjs", import.meta.url));
      const result = spawnSync(process.execPath, [command, directories.before, directories.after, output],
        { cwd: repository, encoding: "utf8", windowsHide: true, timeout: 30_000 });
      assert.ifError(result.error);
      assert.equal(result.status, 2, `${mutation}: ${result.stdout}\n${result.stderr}`);
      const comparison = JSON.parse(await readFile(path.join(output, "comparison.json")));
      assert.equal(comparison.automatedComparisonPassed, false);
      assert.equal(comparison.preflightComplete, false);
      assert.ok(comparison.failures.length > 0);
      for (const side of sides) await writeFile(path.join(directories[side], "dark", "export-report.json"), originals[side]);
    }
  }
});

test("Windows candidate aliases and outside paths are rejected lexically, without filesystem/network access", async () => {
  const checkout = String.raw`D:\checkout`;
  for (const requested of [
    String.raw`..\candidate-contract.json`, String.raw`C:\candidate-contract.json`,
    String.raw`\\review-server\artifacts\candidate-contract.json`,
    String.raw`\\?\D:\candidate-contract.json`, String.raw`\\?\D:\checkout\inside.json`,
    String.raw`\\.\D:\candidate-contract.json`, String.raw`\??\D:\candidate-contract.json`,
    String.raw`test\fixtures\adaptive-cards\compatibility\contract-lock.json`,
    String.raw`candidate.json:stream`, String.raw`NUL.json`, String.raw`inside.json.`,
  ]) {
    assert.throws(() => resolveCandidateArtifact(requested, checkout, path.win32), undefined, requested);
  }
  assert.equal(resolveCandidateArtifact(String.raw`artifacts\new.json`, checkout, path.win32).destination,
    String.raw`D:\checkout\artifacts\new.json`);
  const unavailable = new Proxy({}, { get: (_target, operation) => assert.fail(`Filesystem must not be touched: ${String(operation)}`) });
  for (const requested of [String.raw`\\review-server\artifacts\candidate-contract.json`,
    String.raw`\\?\D:\candidate-contract.json`, String.raw`\\?\D:\checkout\inside.json`,
    String.raw`Z:\outside-candidate.json`, "../outside.json"]) {
    await assert.rejects(writeCandidateArtifact(requested, { workspace: repository, fs: unavailable,
      snapshot: () => assert.fail("Invalid paths cannot start snapshotting.") }));
  }
});

test("candidate writes only a new inside file and never replaces existing files or the approved lock", async (t) => {
  const { workspace } = await ownedWorkspace(t);
  await mkdir(path.join(workspace, "artifacts"));
  const candidate = path.join(workspace, "artifacts", "candidate.json");
  const snapshot = async () => ({ candidate: true });
  assert.equal(await writeCandidateArtifact(candidate, { workspace, snapshot }), candidate);
  const relative = path.join("artifacts", "relative.json");
  assert.equal(await writeCandidateArtifact(relative, { workspace, snapshot }), path.join(workspace, relative));
  const original = await readFile(candidate);
  await assert.rejects(writeCandidateArtifact(candidate, { workspace, snapshot }), { code: "EEXIST" });
  assert.deepEqual(await readFile(candidate), original);
  const lock = path.join(workspace, "test", "fixtures", "adaptive-cards", "compatibility", "contract-lock.json");
  await mkdir(path.dirname(lock), { recursive: true });
  await writeFile(lock, "approved");
  await assert.rejects(writeCandidateArtifact(lock, { workspace, snapshot }), /approved contract lock/);
  assert.equal(await readFile(lock, "utf8"), "approved");
});

test("candidate rejects owned link/junction parent escape and rechecks parents after snapshotting", async (t) => {
  const { workspace, outside } = await ownedWorkspace(t);
  const parent = path.join(workspace, "artifacts");
  const kind = process.platform === "win32" ? "junction" : "dir";
  await symlink(outside, parent, kind);
  await assert.rejects(writeCandidateArtifact(path.join(parent, "candidate.json"), {
    workspace, snapshot: () => assert.fail("A linked parent cannot reach snapshotting."),
  }), /links, junctions/);
  await assert.rejects(readFile(path.join(outside, "candidate.json")), { code: "ENOENT" });
  await rm(parent); await mkdir(parent);
  await assert.rejects(writeCandidateArtifact(path.join(parent, "candidate.json"), { workspace, snapshot: async () => {
    await rm(parent, { recursive: true }); await symlink(outside, parent, kind); return {};
  } }), /links, junctions/);
  await assert.rejects(readFile(path.join(outside, "candidate.json")), { code: "ENOENT" });
});

test("candidate checks canonical parent containment even if link metadata is absent", async (t) => {
  const { workspace, outside } = await ownedWorkspace(t);
  const parent = path.join(workspace, "artifacts");
  await mkdir(parent);
  await assert.rejects(writeCandidateArtifact(path.join(parent, "candidate.json"), {
    workspace, snapshot: () => assert.fail("An escaped canonical parent cannot reach snapshotting."),
    fs: {
      lstat,
      realpath: async (file) => file === parent ? outside : realpath(file),
      writeFile: () => assert.fail("An escaped parent cannot be written."),
    },
  }), /canonical checkout/);
  await assert.rejects(readFile(path.join(outside, "candidate.json")), { code: "ENOENT" });
});
