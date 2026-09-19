import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rm, symlink, realpath, lstat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import {
  CARD_REVIEW_THEMES, expectedCardReviewFixtures, compareAdaptiveCardReviews,
} from "../scripts/compare-adaptive-cards-review.mjs";
import { resolveCandidateArtifact, writeCandidateArtifact } from "../scripts/adaptive-card-upgrade-guard.mjs";
import { buildPptxPackage } from "../../.github/extensions/markdstage/runtime/pptx-package.mjs";

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
      manifest.themes[theme] = {
        export: { ok: true, format: "pptx", total: fixtures.length + 1 },
        pages: fixtures.map((fixture, index) => ({
          index, name: fixture.name, cards: fixture.expected,
          chromiumRepeatGeometry: true, chromiumRepeatPng: true, nativeCollectionUnchanged: true,
          webview2RepeatGeometry: true, webview2RepeatPng: true,
          exportedNativeObjects: 0, exportedNativeTypes: {}, rasterizedSubtrees: 0,
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
      json(path.join(themeDirectory, "model.json"), {
        version: 1, width: 1280, height: 720,
        slides: [...fixtures.map((fixture) => ({ adaptiveCards: fixture.expected, elements: [], fallbacks: [] })), { layout: "backcover" }],
      });
      files.set(path.join(themeDirectory, "powerpoint", `${pageName(fixtures.length + 1)}.png`), png);
      for (const [index, fixture] of fixtures.entries()) {
        const name = pageName(index + 1);
        const geometry = {
          viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
          slides: [{ index: 0, cards: fixture.expected.map(({ status, codes }) => ({
            status, bounds, diagnostics: codes.map((code) => ({ code })),
            objects: status === "ready" ? [{ type: "AdaptiveCard", sourcePath: "$", bounds, textRects: [] }] : [],
          })) }],
          native: [{ index: 0, cards: fixture.expected.map(({ status }) => status === "error" ? null :
            { scene: {}, elements: [], conversions: [], fallbacks: [] }) }],
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
  assert.equal(report.baselineUpdated, false);
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
