import assert from "node:assert/strict";
import test from "node:test";
import { createPortableOutput } from "../runtime/portable-output.mjs";
import { preparePptxPackageModel, buildValidatedPptx } from "../runtime/output-model.mjs";
import { inspectPptxPackage } from "../runtime/pptx-package.mjs";

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13,
  73, 72, 68, 82, 0, 0, 5, 0, 0, 0, 2, 208]);
const base64 = (bytes) => btoa(String.fromCharCode(...bytes));
const slides = ["# Editable title", "---\nlayout: backcover\n---\n"];
const model = {
  version: 1, width: 1280, height: 720,
  masters: [{ id: "dark", theme: "dark", layoutIds: ["dark:default"] }],
  layouts: [{ id: "dark:default", name: "default", theme: "dark", elements: [] }],
  slides: [
    { layoutId: "dark:default", title: "Editable title", notes: "日本語 notes",
      elements: [{ type: "text", x: 40, y: 30, width: 600, height: 90,
        paragraphs: [{ runs: [{ text: "Editable native text", fontSize: "32px" }] }] }],
      fallbacks: [] },
    { layoutId: "dark:default", elements: [], fallbacks: [] },
  ],
};

function harness(overrides = {}) {
  const events = [];
  const writes = new Map();
  const tokens = [];
  const session = { slides: slides.slice(), sourceName: "decks/talk.md", theme: "dark",
    themeLocked: false, customThemeCss: "", customThemeMeta: null, customThemeAssets: [], mode: "deck", index: 0 };
  let output;
  let snapshots = 0;
  const ok = (value) => ({ ok: true, value });
  const layout = (index) => ({ width: 1280, height: 720, total: 2,
    slides: (index === undefined ? [0, 1] : [index]).map((index) => ({
      index, page: index + 1, title: `Slide ${index + 1}`, pdfClipped: index === 0,
      secret: "drop", elements: [],
    })) });
  const io = {
    async createTransientDirectory(kind) { events.push(["create", kind]); return ok(`profile-${events.length}`); },
    async launchBrowser(options) {
      events.push(["launch", options]);
      const url = new URL(options.url);
      const token = url.searchParams.get("token");
      tokens.push(token);
      const data = output.getData(token);
      assert.deepEqual(data.slides, slides);
      assert.equal(options.mode, "automation");
      const index = url.searchParams.has("index") ? Number(url.searchParams.get("index")) :
        url.searchParams.has("layout-index") ? Number(url.searchParams.get("layout-index")) : undefined;
      if (overrides.launch) return overrides.launch({ output, token, options, ok, data, layout: layout(index) });
      output.reportStatus(token, { status: "ready", layout: layout(index) });
      return ok({ handle: `browser-${events.length}`, debuggerEndpoint: "ws://127.0.0.1:3000/devtools/page/1" });
    },
    async closeBrowser(handle) { events.push(["close", handle]); return ok(undefined); },
    async removeTransientDirectory(handle) { events.push(["remove", handle]); return ok(undefined); },
    async makeDirectory(path) { events.push(["mkdir", path]); return ok(path); },
    async writeBytes(path, bytes, options) {
      events.push(["write", path, options]);
      if (overrides.write) return overrides.write(path, bytes);
      writes.set(path, bytes.slice());
      return ok(path);
    },
    async stat(path) {
      events.push(["stat", path]);
      return path === "decks/assets/photo.png" ? ok({ kind: "file", size: png.length, modifiedAt: 1 }) :
        { ok: false, code: "missing", message: "missing" };
    },
    async readBytes(path) { events.push(["read", path]); return ok(png.slice()); },
  };
  const sendCdp = async (handle, method, params) => {
    events.push(["cdp", handle, method, params]);
    if (overrides.cdp) {
      const result = await overrides.cdp(handle, method, params);
      if (result !== undefined) return result;
    }
    if (method === "Page.captureScreenshot") return { data: base64(png) };
    if (method === "Page.printToPDF") return { data: btoa("%PDF-1.7\n%%EOF") };
    if (method === "Runtime.evaluate" && params.expression === "window.__presentationPptxModel") {
      return { result: { value: overrides.model ?? model } };
    }
    return {};
  };
  output = createPortableOutput({
    runtime: { async snapshot() { snapshots++; return structuredClone(session); } },
    io, baseUrl: "http://127.0.0.1:3000/secret/", sendCdp,
  });
  return { output, events, writes, tokens, session, snapshots: () => snapshots };
}

test("portable inspect receives live export callbacks without reentering runtime snapshot", async () => {
  const h = harness();
  const report = await h.output.inspect({ index: 0, includeFits: true, failOnIssues: true });
  assert.equal(h.snapshots(), 1);
  assert.equal(report.scope, "slide");
  assert.equal(report.issueCount, 1);
  assert.equal(report.slides[0].secret, undefined);
  assert.deepEqual(h.events.slice(-2).map(([kind]) => kind), ["close", "remove"]);
  assert.throws(() => h.output.getData(h.tokens[0]), { code: "file_not_found" });
});

test("portable inspect accepts native CLI 1-based slide and all aliases", async () => {
  const h = harness();
  const report = await h.output.inspect({ slide: "2", all: true });
  assert.equal(report.index, 1);
  assert.equal(report.slides.length, 1);
  assert.equal(report.hasIssues, false);
});

test("portable captures page ranges as atomic port writes after browser cleanup", async () => {
  const h = harness();
  const report = await h.output.capture({ pages: "2,1-2", output: "results/screens" });
  assert.equal(report.captured, 2);
  assert.deepEqual([...h.writes.keys()], ["results/screens/slide-001.png", "results/screens/slide-002.png"]);
  assert.ok(h.events.filter(([kind]) => kind === "write").every((event) => event[2].overwrite));
  assert.deepEqual(report.files.map(({ width, height }) => [width, height]), [[1280, 720], [1280, 720]]);
  assert.equal(h.events.filter(([kind]) => kind === "close").length, 2);
});

test("portable capture defaults to clipped slides and source-based directory", async () => {
  const h = harness();
  const report = await h.output.capture();
  assert.equal(report.captured, 1);
  assert.equal(report.files[0].path, "talk-previews/slide-001.png");
  assert.equal(h.events.filter(([kind]) => kind === "launch").length, 2);
});

test("portable capture does not write files for a fitting deck", async () => {
  const h = harness({ launch: ({ output, token, ok, layout }) => {
    layout.slides.forEach((slide) => { slide.pdfClipped = false; });
    output.reportStatus(token, { status: "ready", layout });
    return ok({ handle: "browser" });
  } });
  assert.equal((await h.output.capture()).captured, 0);
  assert.equal(h.writes.size, 0);
});

test("portable PDF uses ready CDP print and writes validated bytes via IO", async () => {
  const h = harness();
  const report = await h.output.exportPdf();
  assert.equal(report.path, "talk.pdf");
  assert.equal(report.format, "pdf");
  assert.equal(new TextDecoder().decode(h.writes.get(report.path)), "%PDF-1.7\n%%EOF");
  const command = h.events.find((event) => event[2] === "Page.printToPDF");
  assert.equal(command[3].printBackground, true);
  assert.equal(command[3].preferCSSPageSize, true);
});

test("portable PPTX matches shared editable package bytes without Buffer", async () => {
  const h = harness();
  const savedBuffer = globalThis.Buffer;
  let report;
  try {
    globalThis.Buffer = undefined;
    report = await h.output.exportPptx({ output: "slides.pptx", mermaidImageFallback: true });
  } finally {
    globalThis.Buffer = savedBuffer;
  }
  const packageModel = await preparePptxPackageModel({ url: "http://127.0.0.1:3000/secret/" }, model, [png], [[], []]);
  const expected = buildValidatedPptx(model, packageModel, 2, "Editable title");
  assert.deepEqual(h.writes.get(report.path), expected);
  const summary = inspectPptxPackage(expected);
  assert.equal(summary.valid, true);
  assert.equal(summary.notesCount, 1);
  assert.equal(summary.slideCount, 2);
  assert.ok(new TextDecoder().decode(expected).includes("Editable native text"));
  assert.ok(h.events.some((event) => event[2] === "Emulation.setDefaultBackgroundColorOverride"));
});

test("portable PPTX reads native image bytes through frozen workspace source roots", async () => {
  const imageModel = structuredClone(model);
  imageModel.slides[0].elements.push({ type: "image", src: "./assets/photo.png", x: 0, y: 0, width: 50, height: 50 });
  const h = harness({ model: imageModel });
  const report = await h.output.exportPptx();
  assert.equal(report.format, "pptx");
  assert.ok(h.events.some((event) => event[0] === "read" && event[1] === "decks/assets/photo.png"));
  assert.equal(inspectPptxPackage(h.writes.get(report.path)).mediaCount, 2);
});

test("portable PPTX preserves actionable locked-destination errors", async () => {
  const h = harness({ write: () => ({
    ok: false,
    code: "destination_locked",
    message: "private host details",
  }) });
  await assert.rejects(
    h.output.exportPptx({ output: "decks/final.pptx" }),
    {
      code: "output_locked",
      message: "The output file may be open in another application. Close final.pptx and retry.",
    },
  );
});

test("failed rendering releases browser then transient handle and resets exclusivity", async () => {
  let fail = true;
  const h = harness({ launch: ({ output, token, ok, layout }) => {
    output.reportStatus(token, fail ? { status: "error", error: "Renderer failed" } : { status: "ready", layout });
    return ok({ handle: "browser" });
  } });
  await assert.rejects(h.output.inspect(), { code: "layout_inspection_failed", message: "Renderer failed" });
  assert.deepEqual(h.events.slice(-2).map(([kind]) => kind), ["close", "remove"]);
  fail = false;
  assert.equal((await h.output.inspect()).ok, true);
});

test("failed browser launch releases its transient profile", async () => {
  const h = harness({ launch: () => ({ ok: false, code: "io_failed", message: "launch failed" }) });
  await assert.rejects(h.output.inspect(), { code: "io_failed" });
  assert.equal(h.events.at(-1)[0], "remove");
  assert.equal(h.events.some(([kind]) => kind === "close"), false);
});

test("concurrent outputs reject while export status remains available", async () => {
  let finish;
  const h = harness({ launch: ({ output, token, ok, layout }) => new Promise((resolve) => {
    finish = () => {
      output.reportStatus(token, { status: "ready", layout });
      resolve(ok({ handle: "browser" }));
    };
  }) });
  const pending = h.output.inspect();
  while (!finish) await new Promise((resolve) => setTimeout(resolve, 0));
  await assert.rejects(h.output.exportPdf(), { code: "export_in_progress" });
  assert.deepEqual(h.output.getData(h.tokens[0]).slides, slides);
  finish();
  await pending;
});

test("portable output rejects traversal, invalid pages and malformed output bytes", async () => {
  const h = harness();
  await assert.rejects(h.output.exportPdf({ output: "../escape.pdf" }), { code: "invalid_output_path" });
  await assert.rejects(h.output.capture({ pages: "1-999999999999" }), { code: "slide_out_of_range" });
  await assert.rejects(h.output.inspect({ index: -1 }), { code: "slide_out_of_range" });
  assert.equal(h.events.length, 0);
  const bad = harness({ cdp: (_handle, method) =>
    method === "Page.printToPDF" ? { data: btoa("not pdf") } : undefined });
  await assert.rejects(bad.output.exportPdf(), { code: "pdf_export_failed" });
  assert.equal(bad.writes.size, 0);
  assert.deepEqual(bad.events.slice(-2).map(([kind]) => kind), ["close", "remove"]);
});
