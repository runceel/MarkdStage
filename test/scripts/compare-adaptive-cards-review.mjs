// Compare two complete, immutable review directories of the SAME known suite.
// Negative card fixtures are expected; incomplete review evidence is never success.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as paths from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { adaptiveCardReviewCases } from "../harness/adaptive-cards.mjs";
import { adaptiveCardCompatibilityCases } from "../harness/adaptive-card-compatibility.mjs";
import { compareCardGeometry, compareCardNativeModels, compareCardPngs } from "../utils/adaptive-card-comparison.mjs";
import { contractDifferences } from "./adaptive-card-upgrade-guard.mjs";
import { inspectPptxPackage } from "../../.github/extensions/markdstage/runtime/pptx-package.mjs";
import { verifyPngBytes, pptxAdaptiveCardReport, pptxFallbackReport } from "../../.github/extensions/markdstage/runtime/output-model.mjs";
import { isWorkspacePath } from "../../.github/extensions/markdstage/runtime/io.mjs";
import { adaptiveCardSchemaEnvelope, MAX_CARD_DIAGNOSTICS } from "../../.github/extensions/markdstage/renderer/adaptive-card-validation.mjs";

export const CARD_REVIEW_THEMES = Object.freeze(["dark", "light", "microsoft", "custom"]);
const EDIT_OPERATIONS = ["text", "fill", "position", "image", "table"];
const EDIT_TYPES = ["text", "shape", "image", "table"];
const CARD_FIELDS = ["blockIndex", "status", "sdkVersion", "schemaVersion", "hostConfigVersion",
  "complete", "diagnosticsTruncated", "resourceValidation", "diagnostics", "conversions",
  "nativeObjectCount", "rasterizedSubtreeCount"];
const CONVERSION_MODES = new Set(["native", "approximated", "rasterized"]);
const SOURCE_TYPES = new Set([...Object.keys(adaptiveCardSchemaEnvelope()), "Diagnostic"]);
const TREATMENTS = new Set(["static-input", "static-action", "static-media", "static-link"]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value) => typeof value === "string" && value.length > 0;
const pageName = (index) => `slide-${String(index + 1).padStart(3, "0")}`;
const complete = (value, label) => {
  assert.ok(object(value), `${label}: missing proof`);
  assert.notEqual(value.complete, false, `${label}: incomplete proof`);
  assert.notEqual(value.truncated, true, `${label}: truncated proof`);
};
const noErrors = (value, label) => assert.deepEqual(value, [], `${label}: missing, incomplete or failed checks`);
const setEquals = (value, expected, label) => {
  assert.ok(Array.isArray(value), `${label}: missing collection`);
  assert.deepEqual([...value].sort(), [...expected].sort(), `${label}: missing, extra or duplicate entries`);
};
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const keys = (value, required, optional, label) => {
  assert.ok(object(value), `${label}: missing structured value`);
  setEquals(Object.keys(value), [...required, ...optional.filter((key) => Object.hasOwn(value, key))],
    `${label} producer fields`);
};
const cardPrefix = (index) => `adaptive-card[${index}]`;
const cardPath = (value, index, rootWithoutDollar = false) => {
  if (!nonempty(value)) return false;
  const prefix = cardPrefix(index);
  if (rootWithoutDollar && value === prefix) return true;
  return value.startsWith(`${prefix}$`) && ["", ".", "["].includes(value.slice(prefix.length + 1, prefix.length + 2));
};

function assertConversions(conversions, blockIndex, label) {
  assert.ok(Array.isArray(conversions), `${label}: missing conversions`);
  for (const conversion of conversions) {
    const at = `${label} ${conversion?.sourcePath || "(missing source)"}`;
    keys(conversion, ["sourcePath", "sourceType", "mode", "reason", "nativeObjects", "impact"],
      ["treatment", "sharedCapturePath"], at);
    assert.ok(cardPath(conversion.sourcePath, blockIndex), `${at}: invalid authored card source path`);
    assert.ok(SOURCE_TYPES.has(conversion.sourceType), `${at}: unknown source type`);
    assert.ok(CONVERSION_MODES.has(conversion.mode), `${at}: unknown conversion mode ${conversion.mode}`);
    assert.ok(count(conversion.nativeObjects), `${at}: invalid native object count`);
    assert.equal(conversion.impact, conversion.mode === "native" ? "none" : "content", `${at}: invalid content impact`);
    assert.match(conversion.reason, /^adaptive-card-[a-z0-9-]+$/, `${at}: missing conversion reason`);
    if (conversion.mode === "native") assert.equal(conversion.reason, "adaptive-card-native", at);
    if (conversion.mode === "rasterized") assert.equal(conversion.nativeObjects, 0, `${at}: rasterized content cannot claim native objects`);
    if (Object.hasOwn(conversion, "treatment")) assert.ok(TREATMENTS.has(conversion.treatment), `${at}: unknown static treatment`);
    if (conversion.mode === "approximated") {
      assert.ok(["static-input", "static-action", "static-media"].includes(conversion.treatment), `${at}: missing approximation treatment`);
      assert.equal(conversion.reason, `adaptive-card-${conversion.treatment}`, at);
    }
    if (conversion.mode === "native") {
      assert.ok(!["static-input", "static-action", "static-media"].includes(conversion.treatment), `${at}: static projection cannot be mislabeled native`);
    }
    if (Object.hasOwn(conversion, "sharedCapturePath")) {
      assert.equal(conversion.mode, "rasterized", at);
      assert.equal(conversion.reason, "adaptive-card-paint-context", at);
      assert.match(conversion.sharedCapturePath, /^adaptive-card\[(?:0|[1-9]\d*)\]\$$/, `${at}: invalid shared capture owner`);
    }
  }
}

function assertCardOutcome(card, expected, slideIndex, blockIndex, sdkVersion, reported, label) {
  keys(card, [...CARD_FIELDS, ...(reported ? ["slideIndex", "page"] : [])], [], label);
  if (reported) {
    assert.equal(card.slideIndex, slideIndex, `${label}: wrong slide identity`);
    assert.equal(card.page, slideIndex + 1, `${label}: wrong page identity`);
  }
  assert.equal(card.blockIndex, blockIndex, `${label}: wrong card identity`);
  assert.equal(card.status, expected.status, `${label}: unexpected card outcome`);
  assert.equal(card.sdkVersion, sdkVersion, `${label}: SDK identity differs from evidence`);
  assert.ok(nonempty(card.schemaVersion) && Number.isSafeInteger(card.hostConfigVersion) && card.hostConfigVersion > 0,
    `${label}: missing schema/HostConfig identity`);
  assert.ok(["browser-checked", "not-run"].includes(card.resourceValidation), `${label}: unknown resource validation outcome`);
  if (card.status === "ready") assert.equal(card.resourceValidation, "browser-checked", `${label}: ready card without browser asset validation`);
  assert.ok(Array.isArray(card.diagnostics) && card.diagnostics.length <= MAX_CARD_DIAGNOSTICS, `${label}: invalid diagnostics`);
  for (const diagnostic of card.diagnostics) {
    keys(diagnostic, ["category", "code", "severity", "path", "sourcePath", "message", "impact"], [], `${label} diagnostic`);
    assert.equal(diagnostic.category, "adaptive-card");
    assert.match(diagnostic.code, /^[a-z][a-z0-9-]*$/);
    assert.ok(["error", "warning"].includes(diagnostic.severity), `${label}: invalid diagnostic severity`);
    assert.ok(nonempty(diagnostic.path) && diagnostic.path.startsWith("$") &&
      nonempty(diagnostic.message), `${label}: missing authored diagnostic path/message`);
    assert.equal(diagnostic.sourcePath, `${cardPrefix(blockIndex)}${diagnostic.path}`, `${label}: diagnostic source identity changed`);
    assert.equal(diagnostic.impact, "content", `${label}: diagnostic lost content impact`);
  }
  assert.deepEqual(card.diagnostics.map((entry) => entry.code).sort(), [...expected.codes].sort(),
    `${label}: diagnostic outcomes differ from the declared fixture`);
  const intendedTruncation = expected.codes.includes("diagnostics-truncated");
  assert.equal(card.diagnosticsTruncated, intendedTruncation, `${label}: unexpected diagnostic truncation`);
  assert.equal(card.complete, !intendedTruncation, `${label}: unexpected incomplete validation`);
  assert.equal(card.diagnostics.some((entry) => entry.severity === "error"), card.status === "error",
    `${label}: status disagrees with diagnostic severity`);
  assert.ok(count(card.nativeObjectCount) && count(card.rasterizedSubtreeCount), `${label}: invalid conversion counters`);
  assertConversions(card.conversions, blockIndex, label);
  assert.equal(card.conversions.reduce((total, entry) => total + entry.nativeObjects, 0), card.nativeObjectCount,
    `${label}: conversion native counts do not add up`);
}

// Validate BEFORE calling the producer helpers: their aggregation is not a
// schema validator (for example, filtering approximated entries skips unknown modes).
export function assertExportOutcome(report, embeddedReport, model, fixtures, theme, sdkVersion, packageBytes) {
  assert.ok(object(report), `${theme}: missing actual export report`);
  assert.ok(Array.isArray(report.adaptiveCards), `${theme}: missing reported cards`);
  let reportedIndex = 0;
  for (const [slideIndex, fixture] of fixtures.entries()) {
    const slide = model.slides[slideIndex];
    assert.ok(Array.isArray(slide.adaptiveCards) && slide.adaptiveCards.length === fixture.expected.length,
      `${theme} page ${slideIndex + 1}: missing model card outcomes`);
    assert.ok(Array.isArray(slide.elements) && Array.isArray(slide.fallbacks), `${theme}: missing model objects/fallbacks`);
    for (const [blockIndex, expected] of fixture.expected.entries()) {
      const label = `${theme} page ${slideIndex + 1} ${cardPrefix(blockIndex)}`;
      const card = slide.adaptiveCards[blockIndex];
      assertCardOutcome(card, expected, slideIndex, blockIndex, sdkVersion, false, `${label} model`);
      assertCardOutcome(report.adaptiveCards[reportedIndex++], expected, slideIndex, blockIndex, sdkVersion, true,
        `${label} export report`);
      const native = slide.elements.filter((element) => element.adaptiveCard && cardPath(element.adaptiveCard.sourcePath, blockIndex));
      assert.equal(native.length, card.nativeObjectCount, `${label}: native count differs from actual model objects`);
      const ownedFallbacks = slide.fallbacks.filter((entry) => entry.type === "adaptive-card" &&
        cardPath(entry.sourcePath, blockIndex, true));
      assert.equal(ownedFallbacks.filter((entry) => entry.artwork !== false).length, card.rasterizedSubtreeCount,
        `${label}: raster count differs from owned model pictures`);
      for (const fallback of ownedFallbacks) if (Object.hasOwn(fallback, "diagnostics") ||
          fallback.reason === "adaptive-card-diagnostic-note" ||
          (card.status === "error" && fallback.sourcePath === cardPrefix(blockIndex))) {
        assert.deepEqual(fallback.diagnostics, card.diagnostics, `${label}: captured diagnostic note differs from card outcome`);
      }
      for (const conversion of card.conversions.filter((entry) => entry.mode === "rasterized")) {
        const owner = conversion.sharedCapturePath || conversion.sourcePath;
        const matches = slide.fallbacks.filter((entry) => entry.type === "adaptive-card" && entry.reason === conversion.reason &&
          (entry.sourcePath === owner || (owner === `${cardPrefix(blockIndex)}$` && entry.sourcePath === cardPrefix(blockIndex))));
        assert.equal(matches.length, 1, `${label}: rasterized source/reason has no unique capture owner`);
        if (conversion.sharedCapturePath) assert.ok(matches[0].cardSources?.includes(`${cardPrefix(blockIndex)}$`),
          `${label}: shared capture omits this card`);
      }
    }
    assert.equal(slide.elements.filter((element) => element.adaptiveCard).length,
      slide.adaptiveCards.reduce((sum, card) => sum + card.nativeObjectCount, 0), `${theme}: orphan native card objects`);
    assert.equal(slide.fallbacks.filter((entry) => entry.type === "adaptive-card" && entry.artwork !== false).length,
      slide.adaptiveCards.reduce((sum, card) => sum + card.rasterizedSubtreeCount, 0), `${theme}: orphan card pictures`);
  }
  assert.equal(report.adaptiveCards.length, reportedIndex, `${theme}: extra/duplicate reported cards`);
  assert.ok(!model.slides.at(-1).adaptiveCards?.length, `${theme}: unexpected back-cover cards`);
  assert.ok(nonempty(report.path), `${theme}: missing output path`);
  const fallbacks = pptxFallbackReport(model);
  const produced = { ok: true, format: "pptx", path: report.path, total: model.slides.length, theme,
    bytes: packageBytes, fallbackCount: fallbacks.length, fallbacks, ...pptxAdaptiveCardReport(model) };
  assert.deepEqual(report, produced, `${theme}: actual export report differs from the validated producer model/aggregates`);
  assert.deepEqual(embeddedReport, report, `${theme}: manifest export result differs from the actual export-report.json`);
  // Output path is the only per-run field emitted by these producer reports.
  // Keep every outcome, mode, reason, source, impact, flag, count and byte count.
  const { path: _outputPath, ...stable } = report;
  return stable;
}

export async function expectedCardReviewFixtures(suite) {
  assert.ok(["baseline", "compatibility"].includes(suite), "A known baseline or compatibility suite is required.");
  const cases = await (suite === "baseline" ? adaptiveCardReviewCases() : adaptiveCardCompatibilityCases());
  return cases.map(({ name, expected, markdown }) => ({ name, expected, sha256: hash(markdown) }));
}

function assertNativeEngine(engine, label) {
  complete(engine, label);
  assert.ok(nonempty(engine.runtimeVersion) && nonempty(engine.webView2Assembly) &&
    engine.webView2Assembly.includes("Microsoft.Web.WebView2.Core") &&
    /(?:^|[\\/])msedgewebview2\.exe$/i.test(engine.executable || "") &&
    Number.isSafeInteger(engine.processId) && engine.processId > 0, `${label}: real WebView2 engine identity is required`);
  assert.deepEqual(engine.controller, { Width: 1280, Height: 720, RasterizationScale: 1, ZoomFactor: 1, IsVisible: true },
    `${label}: real visible 1280x720 DPR1 controller is required`);
}

export function assertCardReviewCoverage(evidence, suite, fixtures) {
  complete(evidence, "Review manifest");
  assert.ok(["baseline", "compatibility"].includes(suite), "Unknown review suite.");
  assert.equal(evidence.suite, suite, "Compare the same known suite.");
  assert.ok(fixtures.length > 0, "Expected fixtures cannot be empty.");
  assert.match(evidence.head || "", /^[a-f0-9]{40}$/i, "A source commit identity is required.");
  assert.equal(typeof evidence.workingTreeChanged, "boolean", "Source tree state is required.");
  assert.ok(object(evidence.sourceHashes) && Object.keys(evidence.sourceHashes).length > 0 &&
    Object.values(evidence.sourceHashes).every((value) => /^[a-f0-9]{64}$/i.test(value)), "Source fingerprints are required.");
  assert.ok(nonempty(evidence.bundle?.sdkVersion) && /^[a-f0-9]{64}$/i.test(evidence.bundle.sha256 || "") &&
    ["bytes", "gzipBytes", "chunks"].every((key) => Number.isSafeInteger(evidence.bundle[key]) && evidence.bundle[key] > 0),
  "Pinned SDK bundle identity is required.");
  assert.deepEqual(evidence.fixtures, fixtures, "Complete canonical fixture identities, content hashes and expected states are required.");
  assert.ok(object(evidence.themes), "Missing theme evidence.");
  setEquals(Object.keys(evidence.themes), CARD_REVIEW_THEMES, "All four themes");
  assert.ok(nonempty(evidence.chromium?.version) && nonempty(evidence.chromium?.executable), "Chromium engine evidence is required.");
  assert.ok(nonempty(evidence.webview2?.probe) && nonempty(evidence.webview2?.host) &&
    evidence.webview2.status === undefined, "Real WebView2 evidence is required, not a not-run/partial status.");
  for (const theme of CARD_REVIEW_THEMES) {
    const result = evidence.themes[theme];
    complete(result, theme);
    assert.ok(Array.isArray(result.pages), `${theme}: missing pages`);
    assert.equal(result.pages.length, fixtures.length, `${theme}: incomplete fixture-page coverage`);
    assert.equal(result.export?.ok, true, `${theme}: missing completed PPTX export`);
    assert.equal(result.export.format, "pptx");
    assert.equal(result.export.total, fixtures.length + 1, `${theme}: missing back cover or export pages`);
    for (const [index, fixture] of fixtures.entries()) {
      const page = result.pages[index];
      complete(page, `${theme} page ${index}`);
      assert.equal(page.index, index, `${theme}: duplicate, invalid or reordered page index`);
      assert.equal(page.name, fixture.name, `${theme}: missing or duplicated fixture`);
      assert.ok(Array.isArray(page.cards) && page.cards.every((card) => Array.isArray(card.codes)), `${theme}: missing card diagnostics`);
      assert.deepEqual(page.cards.map(({ status, codes }) => ({ status, codes: [...codes].sort() })),
        fixture.expected.map(({ status, codes }) => ({ status, codes: [...codes].sort() })),
        `${theme} ${fixture.name}: incomplete card states`);
      for (const key of ["chromiumRepeatGeometry", "chromiumRepeatPng", "nativeCollectionUnchanged",
        "webview2RepeatGeometry", "webview2RepeatPng"]) assert.equal(page[key], true, `${theme} ${fixture.name}: ${key} is required`);
      noErrors(page.geometryComparison?.violations, `${theme} card geometry`);
      noErrors(page.nativeComparison?.violations, `${theme} native geometry`);
      assert.equal(page.geometryComparison.edgeTolerance, 2);
      assert.equal(page.geometryComparison.textRectTolerance, 3);
      assert.equal(page.nativeComparison.edgeTolerance, 2);
      assert.ok(page.geometryComparison.measuredEdges > 0 &&
        page.geometryComparison.maximumEdgeDelta <= 2 && page.geometryComparison.maximumTextRectDelta <= 3 &&
        page.nativeComparison.maximumDelta <= 2, `${theme}: incomplete or out-of-tolerance geometry proof`);
      assert.ok(Number.isSafeInteger(page.exportedNativeObjects) && page.exportedNativeObjects >= 0 &&
        Number.isSafeInteger(page.rasterizedSubtrees) && page.rasterizedSubtrees >= 0 &&
        object(page.exportedNativeTypes) && Object.values(page.exportedNativeTypes).every((count) =>
          Number.isSafeInteger(count) && count >= 0) &&
        Object.values(page.exportedNativeTypes).reduce((sum, count) => sum + count, 0) === page.exportedNativeObjects,
      `${theme}: incomplete exported-object accounting`);
      assertNativeEngine(page.engine, `${theme} ${fixture.name}`);
    }
  }
}

function assertGeometry(geometry, fixture, label) {
  complete(geometry, label);
  assert.deepEqual(geometry.viewport, { width: 1280, height: 720, deviceScaleFactor: 1 }, `${label}: invalid viewport`);
  for (const key of ["slides", "native"]) {
    assert.ok(Array.isArray(geometry[key]) && geometry[key].length === 1, `${label}: incomplete ${key}`);
    assert.equal(geometry[key][0].index, 0, `${label}: invalid capture-page index`);
    assert.equal(geometry[key][0].cards?.length, fixture.expected.length, `${label}: missing card proof`);
  }
  for (const [index, expected] of fixture.expected.entries()) {
    const card = geometry.slides[0].cards[index];
    assert.equal(card.status, expected.status, `${label}: missing card state`);
    assert.ok(Array.isArray(card.diagnostics) && Array.isArray(card.objects), `${label}: incomplete typed card proof`);
    assert.deepEqual(card.diagnostics.map((entry) => entry.code).sort(), [...expected.codes].sort(), `${label}: incomplete diagnostics`);
    assert.ok(card.bounds && ["x", "y", "width", "height"].every((key) => Number.isFinite(card.bounds[key])) &&
      card.bounds.width > 0 && card.bounds.height > 0, `${label}: missing measured card bounds`);
    const native = geometry.native[0].cards[index];
    if (expected.status === "error") {
      assert.equal(native, null, `${label}: invalid error-panel native state`);
      assert.deepEqual(card.objects, []);
    } else {
      assert.ok(card.objects.length > 0 && object(native) &&
        ["elements", "conversions", "fallbacks"].every((key) => Array.isArray(native[key])),
      `${label}: truncated typed/native object proof`);
    }
  }
}

function assertPowerPointEngine(engine) {
  assert.equal(engine?.application, "PowerPoint desktop", "Actual PowerPoint evidence is mandatory.");
  assert.ok(nonempty(engine.version) && nonempty(engine.fileVersion));
  assert.equal(engine.renderWidth, 1280); assert.equal(engine.renderHeight, 720);
}

// Relocate owned edit artifacts when an evidence directory has been copied.
// Never follow arbitrary absolute paths supplied by a report.
function editArtifactPath(directory, sourcePptx, artifact) {
  assert.ok(nonempty(sourcePptx) && nonempty(artifact), "Missing edit artifact path.");
  const path = paths.win32.isAbsolute(sourcePptx) ? paths.win32 : paths;
  const local = path.relative(path.dirname(sourcePptx), artifact);
  const portable = local.split(path.sep).join("/");
  assert.ok(!path.isAbsolute(local) && isWorkspacePath(portable) && portable.startsWith("editability/"),
    "Edit evidence must remain inside its owned theme editability directory.");
  return paths.join(directory, ...portable.split("/"));
}

export async function readCardReviewEvidence(directory, evidence, fixtures, read = readFile) {
  const json = async (...parts) => JSON.parse(await read(paths.join(directory, ...parts), "utf8"));
  const binary = async (file) => {
    const bytes = await read(file);
    assert.ok(bytes instanceof Uint8Array && bytes.length > 0, `Missing or empty artifact: ${file}`);
    return Buffer.from(bytes);
  };
  const png = async (file) => {
    const bytes = await binary(file);
    verifyPngBytes(bytes);
    assert.ok(bytes.subarray(-12).equals(Buffer.from("0000000049454e44ae426082", "hex")), `Truncated PNG: ${file}`);
    return bytes;
  };
  const themes = {};
  for (const theme of CARD_REVIEW_THEMES) {
    const themeDirectory = paths.join(directory, theme);
    const pp = await json(theme, "powerpoint-report.json");
    complete(pp, `${theme} PowerPoint`);
    assertPowerPointEngine(pp.engine);
    assert.equal(pp.measuredChecksPassed, true); assert.equal(pp.originalUnchanged, true); assert.equal(pp.readOnly, true);
    noErrors(pp.errors, `${theme} PowerPoint`);
    const slideCount = fixtures.length + 1;
    assert.equal(pp.slideCount, slideCount, `${theme}: incomplete PowerPoint deck`);
    assert.ok(Array.isArray(pp.pages) && pp.pages.length === slideCount, `${theme}: missing PowerPoint pages`);
    const original = await binary(paths.join(themeDirectory, "cards.pptx"));
    const packageSummary = inspectPptxPackage(original);
    assert.equal(packageSummary.valid, true, `${theme}: incomplete PowerPoint package`);
    assert.equal(packageSummary.slideCount, slideCount);
    const originalHash = hash(original);
    assert.equal(pp.pptxSha256?.toLowerCase(), originalHash);
    assert.equal(pp.pptxSha256After?.toLowerCase(), originalHash);
    const model = await json(theme, "model.json");
    assert.equal(model.version, 1); assert.equal(model.width, 1280); assert.equal(model.height, 720);
    assert.equal(model.slides?.length, slideCount, `${theme}: missing model pages`);
    assert.equal(model.slides.at(-1).layout, "backcover", `${theme}: missing model back cover`);
    const exportReport = await json(theme, "export-report.json");
    const outcome = assertExportOutcome(exportReport, evidence.themes[theme].export, model, fixtures,
      theme, evidence.bundle.sdkVersion, original.length);
    for (const [index, page] of pp.pages.entries()) {
      complete(page, `${theme} PowerPoint page ${index}`);
      assert.equal(page.page, index + 1, `${theme}: duplicate or invalid PowerPoint page index`);
      assert.equal(page.measuredChecksPassed, true);
      noErrors(page.errors, `${theme} PowerPoint page ${index}`);
      noErrors(page.missing, `${theme} missing objects`); noErrors(page.extra, `${theme} extra objects`);
      assert.equal(page.shapeCount, page.expectedShapeCount);
      assert.equal(page.shapes?.length, page.shapeCount, `${theme}: truncated shape inventory`);
      assert.equal(page.mappings?.length, page.expectedShapeCount, `${theme}: truncated shape mapping`);
      assert.equal(page.rasterCount, page.expectedRasterCount);
      assert.deepEqual(page.nativeCounts, page.expectedNativeCounts);
    }
    // The back cover has no card geometry in the review harness, but its actual
    // PowerPoint render/package/page proof is still mandatory.
    const backCover = await png(paths.join(themeDirectory, "powerpoint", `${pageName(fixtures.length)}.png`));
    const edit = await json(theme, "editability-report.json");
    complete(edit, `${theme} editability`);
    assertPowerPointEngine(edit.engine);
    for (const key of ["measuredChecksPassed", "originalUnchanged", "copyIsDisposable", "reopenedReadOnly", "saved"]) {
      assert.equal(edit[key], true, `${theme}: incomplete ${key} edit proof`);
    }
    noErrors(edit.errors, `${theme} editability`);
    setEquals(edit.requiredNativeTypes, EDIT_TYPES, `${theme} native edit types`);
    setEquals(edit.requiredOperations, EDIT_OPERATIONS, `${theme} required edits`);
    setEquals(edit.operations?.map((entry) => entry.operation), EDIT_OPERATIONS, `${theme} persisted edits`);
    for (const operation of edit.operations) {
      assert.equal(operation.persisted, true); assert.equal(operation.changed, true); assert.equal(operation.error, null);
      for (const checks of [operation.inMemoryChecks, operation.reopenChecks]) {
        assert.ok(Array.isArray(checks) && checks.length > 0 && checks.every((check) => check.passed === true),
          `${theme}: truncated or unsuccessful existing-object edit checks`);
      }
      assert.ok(Number.isSafeInteger(operation.sourceShape?.page) &&
        operation.sourceShape.page >= 1 && operation.sourceShape.page <= slideCount, `${theme}: invalid edited page`);
    }
    assert.ok(Array.isArray(edit.inventoryChecks) && edit.inventoryChecks.length > 0 &&
      edit.inventoryChecks.every((check) => check.passed === true), `${theme}: missing edit inventory checks`);
    assert.equal(edit.originalSha256Before?.toLowerCase(), originalHash);
    assert.equal(edit.originalSha256After?.toLowerCase(), originalHash);
    assert.equal(edit.sourcePptx, pp.sourcePptx);
    const edited = await binary(editArtifactPath(themeDirectory, edit.sourcePptx, edit.copyPptx));
    assert.equal(edit.copySha256AfterSave?.toLowerCase(), hash(edited));
    assert.equal(edit.copySha256AfterReopen?.toLowerCase(), hash(edited));
    assert.notEqual(hash(edited), originalHash, `${theme}: edits did not change the disposable copy`);
    const editedPages = [...new Set(edit.operations.map((entry) => entry.sourceShape.page))].sort((a, b) => a - b);
    assert.ok(Array.isArray(edit.outputPngPaths) && edit.outputPngPaths.length === editedPages.length,
      `${theme}: missing edited-page renders`);
    setEquals(edit.outputPngPaths.map((file) => paths.win32.basename(file)),
      editedPages.map((page) => `${pageName(page - 1)}.png`), `${theme} edited renders`);
    for (const file of edit.outputPngPaths) await png(editArtifactPath(themeDirectory, edit.sourcePptx, file));
    const pages = [];
    for (const [index, fixture] of fixtures.entries()) {
      assert.equal(model.slides[index].adaptiveCards?.length, fixture.expected.length, `${theme}: incomplete card model`);
      const modelNative = model.slides[index].elements?.filter((element) => element.adaptiveCard);
      assert.equal(modelNative?.length, evidence.themes[theme].pages[index].exportedNativeObjects,
        `${theme}: exported native-object proof differs from the model`);
      assert.equal(model.slides[index].fallbacks?.filter((fallback) => fallback.type === "adaptive-card" && fallback.artwork !== false).length,
        evidence.themes[theme].pages[index].rasterizedSubtrees, `${theme}: exported raster proof differs from the model`);
      const name = pageName(index);
      const geometry = {
        chromium: await json(theme, "chromium", `${name}.json`),
        webview2: await json(theme, "webview2", name, "geometry-1.json"),
      };
      for (const [engine, snapshot] of Object.entries(geometry)) assertGeometry(snapshot, fixture, `${theme} ${name} ${engine}`);
      for (const [engine, snapshot] of Object.entries(geometry)) {
        for (const [blockIndex, card] of model.slides[index].adaptiveCards.entries()) {
          const measured = snapshot.slides[0].cards[blockIndex];
          const label = `${theme} ${name} ${cardPrefix(blockIndex)} ${engine}`;
          for (const key of ["sdkVersion", "schemaVersion", "hostConfigVersion", "status"]) {
            assert.equal(measured[key], card[key], `${label}: exported card identity/outcome differs from measured evidence`);
          }
          assert.deepEqual(measured.diagnostics, card.diagnostics.map(({ sourcePath: _sourcePath, ...entry }) => entry),
            `${label}: exported diagnostics differ from measured browser diagnostics`);
          const native = snapshot.native[0].cards[blockIndex];
          if (native) {
            assertConversions(native.conversions, blockIndex, `${label} typed collector`);
            // Shared paint contexts are owned by the full-slide collector, not
            // an individual card. All other conversion records must agree.
            if (!card.conversions.some((entry) => entry.sharedCapturePath)) {
              assert.deepEqual(native.conversions, card.conversions, `${label}: exported conversions differ from typed collector`);
              assert.equal(native.elements.length, card.nativeObjectCount, `${label}: native object accounting differs`);
            }
          }
        }
      }
      const repeat = await json(theme, "webview2", name, "geometry-2.json");
      assertGeometry(repeat, fixture, `${theme} ${name} WebView2 repetition`);
      assert.deepEqual(repeat, geometry.webview2, `${theme}: WebView2 geometry is not repeatable`);
      const engine = await json(theme, "webview2", name, "native-engine.json");
      assertNativeEngine(engine, `${theme} ${name} native engine`);
      assert.deepEqual(engine, evidence.themes[theme].pages[index].engine, `${theme}: engine evidence differs from the manifest`);
      pages.push({ geometry, pngs: {
        chromium: await png(paths.join(themeDirectory, "chromium", `${name}.png`)),
        webview2: await png(paths.join(themeDirectory, "webview2", name, "slide-001.png")),
        webview2Repeat: await png(paths.join(themeDirectory, "webview2", name, "slide-002.png")),
        powerpoint: await png(paths.join(themeDirectory, "powerpoint", `${name}.png`)),
      } });
    }
    themes[theme] = { pages, backCover, outcome };
  }
  return themes;
}

function checkedPixels(result, engine) {
  const { sideBySide, overlay, ...counts } = result;
  assert.ok(Number.isSafeInteger(counts.changedPixels) && counts.changedPixels >= 0 &&
    Number.isSafeInteger(counts.changedPixelsOver20) && counts.changedPixelsOver20 >= 0 &&
    counts.changedPixelsOver20 <= counts.changedPixels && counts.changedPixels <= 1280 * 720 &&
    nonempty(sideBySide) && nonempty(overlay), `${engine}: incomplete pixel comparison`);
  return { counts, sideBySide, overlay };
}

export async function compareAdaptiveCardReviews(beforeArgument, afterArgument, outputArgument, {
  read = readFile, write = writeFile, makeDirectory = mkdir,
  launch = () => chromium.launch({ headless: true }), compareImages = compareCardPngs,
} = {}) {
  const before = paths.resolve(beforeArgument), after = paths.resolve(afterArgument), output = paths.resolve(outputArgument);
  assert.notEqual(output, before); assert.notEqual(output, after);
  await makeDirectory(output, { recursive: false });
  const report = { before: { directory: before }, after: { directory: after },
    pages: [], backCovers: [], exportOutcomes: {}, failures: [], expectedPages: 0, preflightComplete: false, baselineUpdated: false,
    independentActualPowerPointApproval: "required; this comparison never grants visual approval" };
  let browser;
  try {
    const reference = JSON.parse(await read(paths.join(before, "evidence.json"), "utf8"));
    const candidate = JSON.parse(await read(paths.join(after, "evidence.json"), "utf8"));
    const fixtures = await expectedCardReviewFixtures(candidate.suite);
    report.suite = candidate.suite;
    report.expectedPages = fixtures.length * CARD_REVIEW_THEMES.length;
    assertCardReviewCoverage(reference, candidate.suite, fixtures);
    assertCardReviewCoverage(candidate, candidate.suite, fixtures);
    for (const [name, value] of [["before", reference], ["after", candidate]]) {
      Object.assign(report[name], { head: value.head, dirty: value.workingTreeChanged,
        chromium: value.chromium, webview2: value.webview2 });
    }
    report.sourceChanges = contractDifferences(reference.sourceHashes, candidate.sourceHashes);
    report.bundleChanges = contractDifferences(reference.bundle, candidate.bundle);
    const a = await readCardReviewEvidence(before, reference, fixtures, read);
    const b = await readCardReviewEvidence(after, candidate, fixtures, read);
    for (const theme of CARD_REVIEW_THEMES) {
      const comparison = compareCardNativeModels(a[theme].outcome, b[theme].outcome);
      noErrors(comparison.violations, `${theme}: export report geometry changed beyond unchanged tolerances`);
      report.exportOutcomes[theme] = comparison;
    }
    report.preflightComplete = true;
    browser = await launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    for (const theme of CARD_REVIEW_THEMES) {
      const target = paths.join(output, theme);
      await makeDirectory(target);
      for (const [index, fixture] of fixtures.entries()) {
        const name = pageName(index);
        const entry = { theme, fixture: fixture.name, page: index + 1, geometry: {}, pixels: {}, failures: [] };
        for (const engine of ["chromium", "webview2"]) {
          try {
            entry.geometry[engine] = {
              card: compareCardGeometry(a[theme].pages[index].geometry[engine].slides, b[theme].pages[index].geometry[engine].slides),
              native: compareCardNativeModels(a[theme].pages[index].geometry[engine].native, b[theme].pages[index].geometry[engine].native),
            };
            noErrors(entry.geometry[engine].card.violations, `${engine} card geometry`);
            noErrors(entry.geometry[engine].native.violations, `${engine} native geometry`);
          } catch (error) { entry.failures.push(`${engine}: ${error.message}`); }
        }
        for (const engine of ["chromium", "webview2", "powerpoint"]) {
          try {
            for (const proof of [a[theme].pages[index], b[theme].pages[index]]) if (engine === "webview2" &&
                !proof.pngs.webview2.equals(proof.pngs.webview2Repeat)) {
              const repeat = await compareImages(page, proof.pngs.webview2, proof.pngs.webview2Repeat);
              assert.equal(repeat.changedPixels, 0, "WebView2 pixels are not repeatable.");
            }
            const { sideBySide, overlay, counts } = checkedPixels(
              await compareImages(page, a[theme].pages[index].pngs[engine], b[theme].pages[index].pngs[engine]), engine);
            entry.pixels[engine] = counts;
            await write(paths.join(target, `${name}-${engine}-before-after.png`), Buffer.from(sideBySide, "base64"));
            if (counts.changedPixels) {
              await write(paths.join(target, `${name}-${engine}-overlay.png`), Buffer.from(overlay, "base64"));
              entry.failures.push(`${engine}: ${counts.changedPixels} changed pixels; investigate and obtain explicit visual approval before any baseline change.`);
            }
          } catch (error) { entry.failures.push(`${engine}: ${error.message}`); }
        }
        report.pages.push(entry);
        report.failures.push(...entry.failures.map((message) => `${theme} ${name} ${fixture.name}: ${message}`));
      }
      const backCover = { theme, page: fixtures.length + 1, failures: [] };
      try {
        const { counts, sideBySide, overlay } = checkedPixels(
          await compareImages(page, a[theme].backCover, b[theme].backCover), "PowerPoint back cover");
        backCover.pixels = counts;
        const prefix = paths.join(target, `${pageName(fixtures.length)}-powerpoint-backcover`);
        await write(`${prefix}-before-after.png`, Buffer.from(sideBySide, "base64"));
        if (counts.changedPixels) {
          await write(`${prefix}-overlay.png`, Buffer.from(overlay, "base64"));
          backCover.failures.push(`${theme} back cover: ${counts.changedPixels} changed pixels require explicit visual review.`);
        }
      } catch (error) { backCover.failures.push(error.message); }
      report.backCovers.push(backCover);
      report.failures.push(...backCover.failures);
    }
  } catch (error) { report.failures.push(error.message); }
  finally {
    await browser?.close();
    if (!report.preflightComplete || !report.expectedPages || report.pages.length !== report.expectedPages ||
        report.backCovers.length !== CARD_REVIEW_THEMES.length) {
      report.failures.push(`Incomplete review: compared ${report.pages.length} of ${report.expectedPages} required fixture/theme pages and ${report.backCovers.length} of 4 PowerPoint back covers.`);
    }
    report.automatedComparisonPassed = report.preflightComplete && report.expectedPages > 0 &&
      report.pages.length === report.expectedPages && report.backCovers.length === CARD_REVIEW_THEMES.length && report.failures.length === 0;
    await write(paths.join(output, "comparison.json"), JSON.stringify(report, null, 2) + "\n");
  }
  return report;
}

if (process.argv[1] && paths.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [before, after, output, ...extra] = process.argv.slice(2);
  if (!before || !after || !output || extra.length) throw new Error(
    "Usage: compare-adaptive-cards-review.mjs <before-directory> <after-directory> <new-comparison-directory>");
  const report = await compareAdaptiveCardReviews(before, after, output);
  console.log(`${report.pages.length} fixture/theme pages and ${report.backCovers.length} PowerPoint back covers compared; ${report.failures.length} differences/blockers. ${paths.join(paths.resolve(output), "comparison.json")}`);
  if (!report.automatedComparisonPassed) process.exitCode = 2;
}
