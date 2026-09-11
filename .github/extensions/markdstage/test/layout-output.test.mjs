import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeLayoutReport } from "../runtime/layout-report.mjs";
import { selectLayoutResults } from "../runtime/output.mjs";
import { formatInspectReport } from "../../../../packages/markdstage-cli/src/commands/inspect.mjs";
import { withDeckServer } from "../../../../packages/markdstage-cli/src/deck.mjs";

const extensionRoot = fileURLToPath(new URL("..", import.meta.url));

test("canvas exposes layout, PNG, PDF, and editable PowerPoint output", async () => {
  const source = await readFile(join(extensionRoot, "extension.mjs"), "utf8");
  // The headless browser flags live in the runtime shared with the CLI.
  const browser = await readFile(join(extensionRoot, "runtime", "browser.mjs"), "utf8");
  const html = await readFile(join(extensionRoot, "renderer", "index.html"), "utf8");

  assert.match(source, /name: "inspect_layout"/);
  assert.match(source, /name: "capture_slides"/);
  assert.match(source, /name: "export_pdf"/);
  assert.match(source, /name: "export_pptx"/);
  assert.match(source, /^    if \(pathname === "\/export-pptx"\)/m);
  assert.match(source, /mermaidImageFallback: body\.mermaidImageFallback === true/);
  assert.match(source, /runtimeExportPptx\(inst, requestedPath, requestedTheme, undefined, options\)/);
  assert.match(source, /mermaidImageFallback: snapshot\.mermaidImageFallback === true/);
  assert.match(source, /maxItems: MAX_CAPTURE_SLIDES/);
  assert.match(source, /never inline image bytes/);
  assert.match(browser, /--window-size=1280,720/);
  assert.match(browser, /--force-device-scale-factor=1/);
  assert.match(browser, /--remote-debugging-port=0/);
  assert.match(browser, /Page\.captureScreenshot/);
  assert.match(browser, /Page\.printToPDF/);
  assert.match(browser, /await openCdpOutputPage\(browser, pageUrl, profileDir, job\)/);
  assert.doesNotMatch(browser, /--print-to-pdf=/);
  assert.match(source, /Every non-empty input must include slides/);
  assert.match(source, /sourceName is metadata and never reads or watches Markdown/);
  assert.match(source, /registered in-memory output snapshot/);
  assert.match(source, /targeted inspections must be serialized/);
  assert.match(browser, /runPptxOutputBrowser/);
  assert.match(browser, /window\.__presentationPptxModel/);
  assert.match(browser, /const slideFallbackImages = \[\]/);
  assert.match(browser, /fallbackIndex/);
  assert.match(browser, /fallback\.captureId/);
  assert.match(browser, /pptx-fallback-hidden/);
  assert.match(browser, /width: bounds\.width/);
  assert.match(html, /id="navExportPptx"/);
  assert.match(html, /<dialog id="pptxExportDialog"/);
  assert.doesNotMatch(html, /navMermaidImageFallback/);
});

test("print, capture, and fixed preview share one 1280x720 output surface", async () => {
  const renderer = await readFile(join(extensionRoot, "renderer", "renderer.js"), "utf8");
  const viewport = await readFile(join(extensionRoot, "renderer", "slide-viewport.mjs"), "utf8");
  const css = await readFile(join(extensionRoot, "renderer", "slides.css"), "utf8");
  const html = await readFile(join(extensionRoot, "renderer", "index.html"), "utf8");

  assert.match(viewport, /const OUTPUT_WIDTH = 1280/);
  assert.match(viewport, /const OUTPUT_HEIGHT = 720/);
  assert.match(renderer, /collectDeckLayout/);
  assert.match(renderer, /params\.get\("capture"\) === "1"/);
  assert.match(
    renderer,
    /params\.get\("responsive"\) !== "1"/,
  );
  assert.match(renderer, /if \(next && fixedPreviewMode\) setFixedPreviewMode\(false,/);
  assert.match(css, /body\.fixed-output-mode \.deck/);
  assert.match(css, /width:1280px;height:720px/);
  assert.match(html, /id="navFixedPreview"/);
  assert.match(html, /id="layoutWarning"/);
  assert.match(viewport, /document\.createElement\("iframe"\)/);
  assert.match(viewport, /frame\.style\.transform/);
  assert.match(renderer, /params\.get\("surface"\) === "1"/);
  assert.match(renderer, /initSlideSurface\(\);\s+return;/);
  // Content-authored transforms still need normalization in layout diagnostics.
  assert.match(renderer, /function layoutScale\(deck\)/);
  assert.match(renderer, /const scale = layoutScale\(deck\)/);
  // Partial custom slide palettes must not make product controls unreadable.
  assert.match(css, /--markdstage-ui-bg:/);
  assert.match(
    css,
    /\.nav,\.pptx-export-dialog,\.export-notification,\.presenter-view,\.overview-panel\{/,
  );
  assert.match(css, /--surface:var\(--markdstage-ui-bg\)/);
});

const architectureElement = {
  kind: "architecture", path: "architecture[0].node[0]", tag: "g",
  blockIndex: 0, id: "service", type: "node",
  bbox: { x: -4, y: 100, width: 200, height: 80 },
  fontSize: 18, requestedFontSize: 40, effectiveFontSize: 30,
  requestedSize: { width: 300, height: 120 },
  effectiveSize: { width: 333, height: 133 },
  effectiveScale: 0.6, shrunk: true, truncated: false,
};

function cleanArchitectureReport(elements = [architectureElement]) {
  return {
    width: 1280, height: 720, total: 1, slides: [{
      index: 0, page: 1, title: "Clean diagram", status: "fits", pdfClipped: false,
      elements, architectureBlockCount: 1,
      architecture: [{
        blockIndex: 0, bbox: { x: 20, y: 100, width: 960, height: 540 },
        effectiveScale: 0.6, elementCount: elements.length, reportedElementCount: elements.length,
      }],
    }],
  };
}

test("inspect retains clean architecture measurements without treating them as clipping", () => {
  const report = selectLayoutResults(cleanArchitectureReport(), undefined, false);
  assert.equal(report.issueCount, 0);
  assert.equal(report.hasIssues, false);
  assert.equal(report.slides.length, 1);
  assert.deepEqual(report.slides[0].elements[0], architectureElement);
  assert.match(formatInspectReport(report), /font 18px \(requested 40, effective 30\)/);
  assert.match(formatInspectReport(report), /architecture\[0\]: scale 0.6; 1\/1/);
  assert.match(formatInspectReport(report), /shrunk/);
  assert.equal(selectLayoutResults(cleanArchitectureReport([]), 1, true).slides.length, 0);
});

test("layout report whitelist bounds architecture output and drops untrusted metadata", () => {
  const source = cleanArchitectureReport(Array.from({ length: 500 }, () => ({
    ...architectureElement, source: "private source", image: "data:image/png;base64,private",
    id: "x".repeat(1000), fontSize: Infinity,
    bbox: { x: -Infinity, y: -3, width: NaN, height: 40, source: "private" },
  })));
  source.slides[0].secret = "private";
  source.slides[0].architecture[0].svg = "<svg>private</svg>";
  const result = sanitizeLayoutReport(source);
  const slide = result.slides[0];
  assert.equal(slide.elements.length, 200);
  assert.equal(slide.architecture[0].reportedElementCount, 200);
  assert.equal(slide.architecture[0].elementCount, 500);
  assert.equal(slide.elements[0].id.length, 96);
  assert.equal(slide.elements[0].fontSize, undefined);
  assert.deepEqual(slide.elements[0].bbox, { x: 0, y: -3, width: 0, height: 40 });
  assert.doesNotMatch(JSON.stringify(result), /private|Infinity|NaN/);
  assert.equal(sanitizeLayoutReport(null), null);
  assert.equal(sanitizeLayoutReport({ slides: {} }), null);
});

test("architecture detail budget is shared across inspected slides", () => {
  const source = cleanArchitectureReport(Array.from({ length: 150 }, () => architectureElement));
  source.slides.push({ ...source.slides[0], index: 1, page: 2 });
  const result = sanitizeLayoutReport(source);
  assert.deepEqual(result.slides.map((slide) => slide.elements.length), [150, 50]);
  assert.equal(result.slides[1].architecture[0].reportedElementCount, 50);
});

test("requested auto dimensions survive the bounded report schema", () => {
  const source = cleanArchitectureReport([{
    ...architectureElement, requestedSize: { width: "auto", height: 120 },
  }]);
  assert.deepEqual(sanitizeLayoutReport(source).slides[0].elements[0].requestedSize,
    { width: "auto", height: 120 });
});

test("CLI export-status API preserves bounded architecture diagnostics", async () => {
  await withDeckServer({
    file: join(extensionRoot, "../../../test/fixtures/layout-visual.md"),
    workspaceRoot: join(extensionRoot, "../../.."),
  }, async (session) => {
    const job = { status: "pending" };
    session.exportJobs.set("layout-test", job);
    const source = cleanArchitectureReport([{ ...architectureElement, source: "private source" }]);
    const response = await fetch(new URL("export-status?token=layout-test", session.url), {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: new URL(session.url).origin },
      body: JSON.stringify({ status: "ready", layout: source }),
    });
    assert.equal(response.status, 204);
    assert.equal(job.status, "ready");
    assert.deepEqual(job.layout.slides[0].elements[0], architectureElement);
    assert.doesNotMatch(JSON.stringify(job.layout), /private source/);
    session.exportJobs.delete("layout-test");
  });
});
