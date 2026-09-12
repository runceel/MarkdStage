import { MarkdStageError } from "./errors.mjs";
import { IO_LIMITS, isWorkspacePath, unwrapIOResult } from "./io.mjs";
import { joinPath, parentPath, readWorkspaceBytes, resolveWorkspaceAsset } from "./workspace-assets.mjs";
import { sanitizeLayoutReport } from "./layout-report.mjs";
import {
  MAX_CAPTURE_SLIDES, MAX_PPTX_ASSET_BYTES, createOutputSnapshot, createOutputJob,
  selectLayoutResults, normalizeCaptureIndexes, preparePptxPackageModel,
  buildValidatedPptx, pptxFallbackReport, decodeBase64, verifyPdfBytes, verifyPngBytes,
} from "./output-model.mjs";
import { captureOutputPng, capturePptxModel } from "./output-cdp.mjs";

const RENDER_TIMEOUT_MS = 60_000;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function sourceStem(sourceName) {
  return (sourceName || "").split("/").pop().replace(/\.(?:md|markdown)$/i, "") || "markdstage";
}

function outputPath(requested, fallback, extension) {
  const path = requested == null || requested === "" ? fallback : requested;
  if (!isWorkspacePath(path) || (extension && !path.toLowerCase().endsWith(extension))) {
    throw new MarkdStageError("invalid_output_path",
      extension ? `Output must be a workspace-relative ${extension} file.` : "Output must be a workspace-relative directory.");
  }
  return path;
}

function pageIndexes(pages, total) {
  if (Array.isArray(pages)) return normalizeCaptureIndexes(pages.map((page) => page - 1), total);
  if (typeof pages !== "string") throw new MarkdStageError("invalid_input", "Pages must be a comma-separated list.");
  const indexes = new Set();
  for (const part of pages.split(",").map((entry) => entry.trim()).filter(Boolean)) {
    const match = /^([1-9]\d*)(?:\s*-\s*([1-9]\d*))?$/.exec(part);
    const from = match ? Number(match[1]) : NaN;
    const to = match ? Number(match[2] ?? match[1]) : NaN;
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || to < from || to > total) {
      throw new MarkdStageError("slide_out_of_range", `Pages must be between 1 and ${total}.`);
    }
    if (to - from + 1 > MAX_CAPTURE_SLIDES) {
      throw new MarkdStageError("too_many_slides", `At most ${MAX_CAPTURE_SLIDES} slides can be captured at once.`);
    }
    for (let page = from; page <= to; page++) indexes.add(page - 1);
  }
  return normalizeCaptureIndexes([...indexes], total);
}

export function createPortableOutput({ runtime, io, baseUrl, sendCdp }) {
  if (typeof runtime?.snapshot !== "function" || typeof sendCdp !== "function") {
    throw new TypeError("Portable output requires a runtime snapshot and CDP transport.");
  }
  const base = new URL(baseUrl);
  const jobs = new Map();
  let exporting = false;
  const callIO = async (operation, ...args) => unwrapIOResult(await io[operation](...args),
    { operation, path: ["writeBytes", "makeDirectory"].includes(operation) ? args[0] : undefined });
  const getJob = (token) => {
    const job = jobs.get(token);
    if (!job) throw new MarkdStageError("file_not_found", "Export snapshot not found.");
    return job;
  };

  async function run(kind, options, operation) {
    if (exporting) {
      throw new MarkdStageError(kind === "pdf" || kind === "pptx" ? "export_in_progress" : "output_in_progress",
        "Another PDF, PowerPoint, layout inspection, or PNG output job is already running for this canvas.");
    }
    exporting = true;
    try {
      const session = await runtime.snapshot();
      const snapshot = createOutputSnapshot(session, options.theme ?? undefined);
      if (!snapshot.slides.length) throw new MarkdStageError("no_deck", "Load a deck before producing output.");
      return await operation(snapshot, session);
    } catch (error) {
      if (error instanceof MarkdStageError) throw error;
      throw new MarkdStageError({
        inspect: "layout_inspection_failed", capture: "png_capture_failed",
        pdf: "pdf_export_failed", pptx: "pptx_export_failed",
      }[kind], error?.message || "Output failed.");
    } finally {
      exporting = false;
    }
  }

  async function render(snapshot, kind, params, operation, options = {}) {
    const token = crypto.randomUUID();
    const job = createOutputJob(snapshot, kind, options);
    const url = new URL(base);
    for (const [key, value] of Object.entries({ ...params, token })) url.searchParams.set(key, String(value));
    let profile;
    let browser;
    jobs.set(token, job);
    try {
      profile = await callIO("createTransientDirectory", kind);
      browser = await callIO("launchBrowser", {
        url: url.href, profile, mode: "automation", windowSize: { width: 1280, height: 720 },
      });
      const deadline = Date.now() + RENDER_TIMEOUT_MS;
      while (job.status === "pending" && Date.now() < deadline) await delay(25);
      if (job.status !== "ready") {
        throw new Error(job.error || `Browser rendering did not finish within ${RENDER_TIMEOUT_MS / 1000} seconds.`);
      }
      return await operation({ send: (method, parameters = {}) => sendCdp(browser.handle, method, parameters) }, job);
    } finally {
      jobs.delete(token);
      try {
        if (browser) await callIO("closeBrowser", browser.handle);
      } finally {
        if (profile) await callIO("removeTransientDirectory", profile);
      }
    }
  }

  function requireLayout(job) {
    if (!job.layout || !Array.isArray(job.layout.slides)) throw new Error("The renderer did not return layout diagnostics.");
    return sanitizeLayoutReport(job.layout);
  }

  const inspectSnapshot = (snapshot, index) => render(snapshot, "inspect", {
    print: 1, ...(index === undefined ? {} : { "layout-index": index }),
  }, (_cdp, job) => requireLayout(job));

  async function write(path, bytes) {
    const directory = parentPath(path);
    if (directory) await callIO("makeDirectory", directory);
    await callIO("writeBytes", path, bytes, { overwrite: true });
  }

  // Resolve images against the captured session, not mutable runtime state, and
  // read through the workspace port rather than a cross-origin WebView fetch.
  function imageReader(session) {
    return async (url) => {
      let path = url.pathname;
      if (path.startsWith(base.pathname)) path = path.slice(base.pathname.length);
      path = decodeURIComponent(path.replace(/^\//, ""));
      let resolved;
      let limit = MAX_PPTX_ASSET_BYTES;
      if (path.startsWith("assets/") && isWorkspacePath(path)) {
        resolved = (await resolveWorkspaceAsset(io, session.sourceName, path.slice(7)))?.path;
      } else if (path.startsWith("theme-assets/")) {
        const asset = path.slice("theme-assets/".length);
        if (!isWorkspacePath(asset) || !session.customThemeAssets?.includes(asset)) {
          throw new MarkdStageError("file_not_found", "The theme asset was not declared.");
        }
        resolved = joinPath(session.customThemeDir, asset);
        limit = IO_LIMITS.themeAsset;
      }
      if (!resolved) throw new MarkdStageError("file_not_found", "The image asset was not found.");
      const bytes = await readWorkspaceBytes(io, resolved, limit);
      const extension = resolved.split(".").pop().toLowerCase();
      const contentType = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
        gif: "image/gif", svg: "image/svg+xml" }[extension];
      return { ok: true, headers: { get: () => contentType },
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    };
  }

  return Object.freeze({
    // These callbacks deliberately bypass the runtime queue: the renderer must
    // fetch its frozen snapshot and report readiness while an output is pending.
    getData(token) {
      const job = getJob(token);
      return { slides: job.slides.slice(), theme: job.theme, themeLocked: job.themeLocked,
        customThemeCss: job.customThemeCss, customThemeMeta: job.customThemeMeta,
        mermaidImageFallback: job.mermaidImageFallback === true };
    },
    reportStatus(token, body) {
      const job = getJob(token);
      if (!body || (body.status !== "ready" && body.status !== "error")) {
        throw new MarkdStageError("invalid_input", "Invalid export status.");
      }
      job.status = body.status;
      job.error = typeof body.error === "string" ? body.error.slice(0, 2000) : "";
      job.layout = sanitizeLayoutReport(body.layout);
      return { ok: true };
    },
    inspect(options = {}) {
      return run("inspect", options, async (snapshot) => {
        const index = options.index ?? (options.slide == null ? undefined : Number(options.slide) - 1);
        if (index !== undefined && (!Number.isInteger(index) || index < 0 || index >= snapshot.slides.length)) {
          throw new MarkdStageError("slide_out_of_range", `Slide index must be between 0 and ${snapshot.slides.length - 1}.`);
        }
        return selectLayoutResults(await inspectSnapshot(snapshot, index), index, Boolean(options.includeFits ?? options.all));
      });
    },
    capture(options = {}) {
      return run("capture", options, async (snapshot, session) => {
        let indexes;
        let inspection;
        if (options.indexes != null) indexes = normalizeCaptureIndexes(options.indexes, snapshot.slides.length);
        else if (options.pages != null) indexes = pageIndexes(options.pages, snapshot.slides.length);
        else {
          const layout = await inspectSnapshot(snapshot);
          inspection = selectLayoutResults(layout, undefined, false);
          indexes = layout.slides.filter((slide) => slide.pdfClipped).map((slide) => slide.index).slice(0, MAX_CAPTURE_SLIDES);
          if (!indexes.length) return { ok: true, total: snapshot.slides.length, captured: 0, issueCount: 0,
            message: "The PDF layout fits; no PNG capture is needed.", files: [] };
        }
        const directory = outputPath(options.output, `${sourceStem(session.sourceName)}-previews`);
        const digits = Math.max(3, String(snapshot.slides.length).length);
        const captures = [];
        for (const index of indexes) {
          captures.push(await render(snapshot, "capture", { capture: 1, index }, async (cdp, job) => {
            const bytes = await captureOutputPng(cdp);
            const image = verifyPngBytes(bytes);
            const layout = requireLayout(job).slides.find((slide) => slide.index === index);
            if (!layout) throw new Error("The PNG renderer did not return the selected slide diagnostics.");
            return { bytes, file: { index, page: index + 1,
              path: `${directory}/slide-${String(index + 1).padStart(digits, "0")}.png`, ...image, layout } };
          }));
        }
        await callIO("makeDirectory", directory);
        for (const capture of captures) await write(capture.file.path, capture.bytes);
        const files = captures.map((capture) => capture.file);
        return { ok: true, directory, total: snapshot.slides.length, captured: files.length,
          issueCount: inspection?.issueCount ?? files.filter((file) => file.layout.pdfClipped).length,
          theme: snapshot.theme, files };
      });
    },
    exportPdf(options = {}) {
      return run("pdf", options, async (snapshot, session) => {
        const path = outputPath(options.output, `${sourceStem(session.sourceName)}.pdf`, ".pdf");
        const bytes = await render(snapshot, "pdf", { print: 1 }, async (cdp) => {
          const result = await cdp.send("Page.printToPDF", {
            printBackground: true, displayHeaderFooter: false, preferCSSPageSize: true,
            paperWidth: 13.3333333333, paperHeight: 7.5,
            marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
            transferMode: "ReturnAsBase64",
          });
          if (typeof result.data !== "string") throw new Error("Chromium did not return PDF data.");
          const bytes = decodeBase64(result.data);
          verifyPdfBytes(bytes);
          return bytes;
        });
        await write(path, bytes);
        return { ok: true, format: "pdf", path, total: snapshot.slides.length, theme: snapshot.theme, bytes: bytes.length };
      });
    },
    exportPptx(options = {}) {
      return run("pptx", options, async (snapshot, session) => {
        const path = outputPath(options.output, `${sourceStem(session.sourceName)}.pptx`, ".pptx");
        const { model, layoutArtworks, slideFallbackImages } = await render(snapshot, "pptx", { pptx: 1 },
          (cdp) => capturePptxModel(cdp, snapshot.slides.length), options);
        const packageModel = await preparePptxPackageModel({ url: base.href }, model,
          layoutArtworks, slideFallbackImages, imageReader(session));
        const bytes = buildValidatedPptx(model, packageModel, snapshot.slides.length,
          model.slides[0]?.title || path.split("/").pop().replace(/\.pptx$/i, ""));
        await write(path, bytes);
        const fallbacks = pptxFallbackReport(model);
        return { ok: true, format: "pptx", path, total: snapshot.slides.length, theme: snapshot.theme,
          bytes: bytes.length, fallbackCount: fallbacks.length, fallbacks };
      });
    },
  });
}
