// Compare two immutable review directories of the SAME suite. Never updates a baseline.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "@playwright/test";
import { compareCardGeometry, compareCardNativeModels, compareCardPngs } from "../utils/adaptive-card-comparison.mjs";
import { contractDifferences } from "./adaptive-card-upgrade-guard.mjs";

const [beforeArgument, afterArgument, outputArgument, ...extra] = process.argv.slice(2);
if (!beforeArgument || !afterArgument || !outputArgument || extra.length) {
  throw new Error("Usage: compare-adaptive-cards-review.mjs <before-directory> <after-directory> <new-comparison-directory>");
}
const before = resolve(beforeArgument), after = resolve(afterArgument), output = resolve(outputArgument);
assert.notEqual(output, before); assert.notEqual(output, after);
await mkdir(output, { recursive: false });
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const reference = await json(join(before, "evidence.json")), candidate = await json(join(after, "evidence.json"));
const report = {
  before: { directory: before, head: reference.head, dirty: reference.workingTreeChanged, chromium: reference.chromium, webview2: reference.webview2 },
  after: { directory: after, head: candidate.head, dirty: candidate.workingTreeChanged, chromium: candidate.chromium, webview2: candidate.webview2 },
  suite: candidate.suite || "baseline", sourceChanges: contractDifferences(reference.sourceHashes, candidate.sourceHashes),
  bundleChanges: contractDifferences(reference.bundle, candidate.bundle), pages: [], failures: [],
  independentActualPowerPointApproval: "required; this comparison never grants visual approval",
  baselineUpdated: false,
};
const browser = await chromium.launch({ headless: true });
try {
  assert.equal(candidate.suite || "baseline", reference.suite || "baseline", "Compare baseline and compatibility suites separately.");
  assert.deepEqual(candidate.fixtures, reference.fixtures, "Fixture/content changes require an explicit corpus review, not an SDK-baseline overwrite.");
  assert.deepEqual(Object.keys(candidate.themes), Object.keys(reference.themes), "Theme coverage changed.");
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  for (const theme of Object.keys(candidate.themes)) {
    const target = join(output, theme);
    await mkdir(target);
    try {
      for (const directory of [before, after]) {
        const actual = await json(join(directory, theme, "powerpoint-report.json"));
        assert.equal(actual.engine.application, "PowerPoint desktop", "Actual PowerPoint evidence is mandatory.");
        assert.equal(actual.measuredChecksPassed, true);
        assert.equal(actual.originalUnchanged, true);
        const edit = await json(join(directory, theme, "editability-report.json"));
        assert.deepEqual(edit.errors, []);
      }
    } catch (error) { report.failures.push(`${theme}: ${error.message}`); }
    for (const [index, fixture] of candidate.fixtures.entries()) {
      const name = `slide-${String(index + 1).padStart(3, "0")}`;
      const entry = { theme, fixture: fixture.name, page: index + 1, geometry: {}, pixels: {}, failures: [] };
      for (const engine of ["chromium", "webview2"]) {
        const location = engine === "chromium" ? [theme, engine, `${name}.json`] : [theme, engine, name, "geometry-1.json"];
        try {
          const a = await json(join(before, ...location)), b = await json(join(after, ...location));
          assert.deepEqual(a.viewport, b.viewport);
          entry.geometry[engine] = {
            card: compareCardGeometry(a.slides, b.slides), native: compareCardNativeModels(a.native, b.native),
          };
          assert.deepEqual(entry.geometry[engine].card.violations, [], "Card geometry exceeds unchanged tolerances.");
          assert.deepEqual(entry.geometry[engine].native.violations, [], "Native geometry exceeds unchanged tolerances.");
        } catch (error) { entry.failures.push(`${engine}: ${error.message}`); }
      }
      for (const engine of ["chromium", "webview2", "powerpoint"]) {
        const location = engine === "webview2" ? [theme, engine, name, "slide-001.png"] : [theme, engine, `${name}.png`];
        try {
          const compared = await compareCardPngs(page, await readFile(join(before, ...location)), await readFile(join(after, ...location)));
          const { sideBySide, overlay, ...counts } = compared;
          entry.pixels[engine] = counts;
          await writeFile(join(target, `${name}-${engine}-before-after.png`), Buffer.from(sideBySide, "base64"));
          if (counts.changedPixels) {
            await writeFile(join(target, `${name}-${engine}-overlay.png`), Buffer.from(overlay, "base64"));
            entry.failures.push(`${engine}: ${counts.changedPixels} changed pixels; investigate and obtain explicit visual approval before any baseline change.`);
          }
        } catch (error) { entry.failures.push(`${engine}: ${error.message}`); }
      }
      report.pages.push(entry);
      report.failures.push(...entry.failures.map((message) => `${theme} ${name} ${fixture.name}: ${message}`));
    }
  }
} catch (error) {
  report.failures.push(error.message);
} finally {
  await browser.close();
  report.automatedComparisonPassed = report.failures.length === 0;
  await writeFile(join(output, "comparison.json"), JSON.stringify(report, null, 2) + "\n");
}
console.log(`${report.pages.length} pages compared; ${report.failures.length} differences/blockers. ${join(output, "comparison.json")}`);
if (report.failures.length) process.exitCode = 2;
