// node test\scripts\adaptive-cards-review.mjs <absolute-output-dir> [--webview2-probe <absolute-exe>]
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";
import { withDeckServer } from "../../packages/markdstage-cli/src/deck.mjs";
import { createOutputJob, createOutputSnapshot, exportPptx } from "../../.github/extensions/markdstage/runtime/output.mjs";
import { runPptxOutputBrowser } from "../../.github/extensions/markdstage/hosts/node/browser.mjs";
import { reconstructAsset } from "../../.github/extensions/markdstage/scripts/vendor-assets.mjs";
import { inspectPptxPackage } from "../../.github/extensions/markdstage/runtime/pptx-package.mjs";
import { adaptiveCardGeometry, adaptiveCardReviewCases, CARD_FIXTURE_DIRECTORY } from "../harness/adaptive-cards.mjs";
import { compareCardGeometry, compareCardPngs } from "../utils/adaptive-card-comparison.mjs";

const [output, flag, probe] = process.argv.slice(2);
if (!output || !isAbsolute(output) || (flag && (flag !== "--webview2-probe" || !isAbsolute(probe || "")))) {
  throw new Error("Provide an absolute output directory and, optionally, --webview2-probe <absolute-exe>.");
}
await mkdir(output, { recursive: true });
const json = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + "\n");
const browser = await chromium.launch({ headless: true });
const cases = await adaptiveCardReviewCases();
const slides = cases.map((entry) => entry.markdown);
const expression = `(async () => {
  const deadline = performance.now() + 40000;
  while (document.documentElement.dataset.captureReady !== "true") {
    if (document.documentElement.dataset.captureError || performance.now() > deadline) throw new Error("Capture did not become ready.");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await document.fonts.ready;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return {
    viewport: { width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio },
    slides: await (${adaptiveCardGeometry.toString()})()
  };
})()`;
const expressionFile = join(output, "geometry.js");
await writeFile(expressionFile, expression);

async function runProbe(url, directory) {
  await mkdir(directory, { recursive: true });
  await new Promise((resolveRun, reject) => {
    const child = spawn(probe, [url, expressionFile, directory], { windowsHide: true, timeout: 180_000 });
    let log = "";
    child.stdout.on("data", (data) => { log += data; });
    child.stderr.on("data", (data) => { log += data; });
    child.once("error", reject);
    child.once("exit", async (code) => {
      await writeFile(join(directory, "process-output.txt"), log);
      if (code === 0) resolveRun();
      else reject(new Error(`WebView2 probe exited ${code}: ${log}`));
    });
  });
}

const report = {
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  workingTreeChanged: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()),
  chromium: { version: browser.version(), executable: chromium.executablePath() },
  webview2: probe ? { probe, host: "Real CoreWebView2 controller using the Desktop STA infrastructure; not the WinUI shell." }
    : { status: "not run", reason: "No --webview2-probe supplied. Chromium is not a substitute." },
  themes: {},
  fixtures: cases.map(({ name, expected }) => ({ name, expected })),
};
const vendorDirectory = resolve(".github", "extensions", "markdstage", "vendor");
const sdk = await reconstructAsset(vendorDirectory, "adaptivecards.min.js", join(vendorDirectory, "vendor-assets.lock.json"));
report.bundle = { sdkVersion: "3.0.6", bytes: sdk.length, gzipBytes: gzipSync(sdk).length,
  sha256: createHash("sha256").update(sdk).digest("hex"), chunks: 1 };
report.sourceHashes = {};
for (const name of ["adaptive-card.mjs", "adaptive-card-validation.mjs", "fenced-blocks.mjs", "marked-lexer.mjs", "renderer.js", "slides.css"]) {
  const bytes = await readFile(resolve(".github", "extensions", "markdstage", "renderer", name));
  report.sourceHashes[name] = createHash("sha256").update(bytes).digest("hex");
}

try {
  for (const theme of ["dark", "light", "microsoft", "custom"]) {
    const directory = join(output, theme);
    await mkdir(join(directory, "chromium"), { recursive: true });
    await cp(join(CARD_FIXTURE_DIRECTORY, "assets"), join(directory, "assets"), { recursive: true });
    const file = join(directory, "cards.md");
    await writeFile(file, slides.join("\n\n---\n\n"));
    if (theme === "custom") await writeFile(join(directory, "theme.css"),
      ":root{--bg:#102030;--fg:#fefefe;--body:#e0e4e8;--muted:#adbccc;--accent:#ff6600;--surface:#203040;--border:#405060;}");
    await withDeckServer({
      file, workspace: directory, theme, ...(theme === "custom" ? { themeFile: "theme.css" } : {}),
    }, async (session) => {
      const token = crypto.randomUUID();
      session.exportJobs.set(token, createOutputJob(createOutputSnapshot(session), "capture"));
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const result = { pages: [], lazyLoad: [] };
      try {
        for (let index = 0; index < slides.length; index++) {
          const name = `slide-${String(index + 1).padStart(3, "0")}`;
          const url = `${session.url}?capture=1&token=${token}&index=${index}`;
          await page.goto(url);
          const geometry = await page.evaluate(expression);
          assert.deepEqual(geometry.viewport, { width: 1280, height: 720, deviceScaleFactor: 1 });
          assert.deepEqual(await page.evaluate(expression), geometry, "Chromium repeat geometry");
          const original = await page.screenshot({ path: join(directory, "chromium", `${name}.png`) });
          assert.ok(original.equals(await page.screenshot()), "Chromium repeat PNG");
          await json(join(directory, "chromium", `${name}.json`), geometry);
          const cards = geometry.slides[0].cards;
          const measurement = { index, name: cases[index].name,
            cards: cards.map((card) => ({ status: card.status, codes: card.diagnostics.map((entry) => entry.code) })),
            coverage: cards.flatMap((card) => card.objects).reduce((counts, object) => {
              counts[object.geometry] = (counts[object.geometry] || 0) + 1; return counts;
            }, {}), chromiumRepeatGeometry: true, chromiumRepeatPng: true };
          assert.equal(cards.length, cases[index].expected.length);
          for (const [cardIndex, expected] of cases[index].expected.entries()) {
            assert.equal(cards[cardIndex].status, expected.status);
            assert.deepEqual(cards[cardIndex].diagnostics.map((entry) => entry.code).sort(), [...expected.codes].sort());
          }
          if (probe) {
            const nativeDirectory = join(directory, "webview2", name);
            await runProbe(url, nativeDirectory);
            const native = JSON.parse(await readFile(join(nativeDirectory, "geometry-1.json"), "utf8"));
            assert.deepEqual(JSON.parse(await readFile(join(nativeDirectory, "geometry-2.json"), "utf8")), native, "WebView2 repeat geometry");
            assert.deepEqual(native.viewport, geometry.viewport);
            measurement.geometryComparison = compareCardGeometry(geometry.slides, native.slides);
            const nativePng = await readFile(join(nativeDirectory, "slide-001.png"));
            const repeat = await compareCardPngs(page, nativePng, await readFile(join(nativeDirectory, "slide-002.png")));
            assert.equal(repeat.changedPixels, 0, "WebView2 repeat visible output");
            const comparison = await compareCardPngs(page, original, nativePng);
            const { sideBySide, overlay, ...pixelCounts } = comparison;
            await mkdir(join(directory, "comparisons"), { recursive: true });
            await writeFile(join(directory, "comparisons", `${name}-webview2.png`), Buffer.from(sideBySide, "base64"));
            await writeFile(join(directory, "comparisons", `${name}-webview2-overlay.png`), Buffer.from(overlay, "base64"));
            measurement.visibleComparison = pixelCounts;
            measurement.webview2RepeatGeometry = true;
            measurement.webview2RepeatPng = true;
            measurement.engine = JSON.parse(await readFile(join(nativeDirectory, "native-engine.json"), "utf8"));
          }
          result.pages.push(measurement);
        }
        if (theme === "dark") {
          for (const kind of ["no-card", "card"]) {
            const perfToken = crypto.randomUUID();
            const snapshot = { ...createOutputSnapshot(session), slides: [kind === "card" ? slides[0] : "## No card\n\nOrdinary Markdown."] };
            session.exportJobs.set(perfToken, createOutputJob(snapshot, "capture"));
            for (let sample = 0; sample < 3; sample++) {
              const cold = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
              try {
                await cold.goto(`${session.url}?capture=1&token=${perfToken}&index=0`);
                await cold.waitForFunction(() => document.documentElement.dataset.captureReady === "true");
                result.lazyLoad.push(await cold.evaluate(({ kind, sample }) => ({
                  kind, sample, readyMs: performance.now(),
                  resources: performance.getEntriesByType("resource")
                    .filter((entry) => /\/(?:adaptivecards\.min\.js|adaptive-card\.mjs)$/.test(new URL(entry.name).pathname))
                    .map((entry) => ({ path: new URL(entry.name).pathname, bytes: entry.encodedBodySize, durationMs: entry.duration })),
                }), { kind, sample }));
              } finally { await cold.close(); }
            }
            session.exportJobs.delete(perfToken);
          }
          assert.ok(result.lazyLoad.filter((sample) => sample.kind === "no-card").every((sample) => sample.resources.length === 0));
          assert.ok(result.lazyLoad.filter((sample) => sample.kind === "card").every((sample) => sample.resources.length === 2));
        }
        let rendered;
        result.export = await exportPptx(session, "cards.pptx", theme, {
          findChromiumBrowser: () => chromium.executablePath(),
          runPptxOutputBrowser: async (...args) => { rendered = await runPptxOutputBrowser(...args); return rendered; },
        });
        assert.equal(result.export.ok, true);
        const pptx = await readFile(join(directory, "cards.pptx"));
        assert.equal(inspectPptxPackage(pptx).valid, true);
        await json(join(directory, "model.json"), rendered.model);
        await json(join(directory, "export-report.json"), result.export);
        for (let index = 0; index < slides.length; index++) {
          const slide = rendered.model.slides[index];
          const captures = rendered.slideFallbackImages[index].filter((capture) => slide.fallbacks[capture.fallbackIndex].type === "adaptive-card");
          assert.equal(captures.length, cases[index].expected.length);
          for (const [cardIndex, capture] of captures.entries()) {
            const fallback = slide.fallbacks[capture.fallbackIndex];
            assert.equal(fallback.reason, cases[index].expected[cardIndex].status === "ready"
              ? "adaptive-card-rendered-as-artwork" : `adaptive-card-${cases[index].expected[cardIndex].codes.at(-1)}`);
            await writeFile(join(directory, `card-${index + 1}${captures.length > 1 ? `-${cardIndex + 1}` : ""}.png`), capture.data);
          }
        }
      } finally { await context.close(); session.exportJobs.delete(token); }
      report.themes[theme] = result;
      await json(join(output, "evidence.json"), report);
      console.log(`${theme}: ${result.pages.length} fixture pages; ${join(directory, "cards.pptx")}`);
    });
  }
  const violations = Object.values(report.themes).flatMap((theme) => theme.pages.flatMap((page) => page.geometryComparison?.violations || []));
  assert.deepEqual(violations, [], "Geometry exceeded the existing review tolerances; keep raster-only and notify the coordinator.");
} finally {
  await browser.close();
  await json(join(output, "evidence.json"), report);
}
