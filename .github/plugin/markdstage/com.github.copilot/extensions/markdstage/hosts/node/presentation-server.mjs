// Node compatibility host: owns the HTTP listener, routing, SSE, and lifecycle.
// Native hosts call the transport-free runtime directly, not this module.
//
// Security model:
//   * The listener binds to 127.0.0.1 only.
//   * Every route lives below an unguessable per-process URL token, so other
//     local processes cannot discover the deck by scanning ports.
//   * Mutating routes require a same-origin `Origin` header, and every request
//     must carry a loopback `Host` header (DNS-rebinding protection).
//   * Mutable state responses are `no-store`; files stay inside the workspace.
//
// The routes mirror the Canvas Extension endpoints the renderer calls, so the
// browser experience (navigation, presenter view, next-slide preview, notes,
// overview, custom themes, Mermaid, Architecture DSL, local assets) is identical.

import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { resolveAssetFile } from "../../scripts/asset-paths.mjs";
import { loadSlideBackgrounds, resolveSlideBackgroundFile } from "../../runtime/slide-backgrounds.mjs";
import { importedArchitectureBlockIndex } from "../../scripts/markdown-blocks.mjs";
import { isMarkdownPath, listMarkdownFiles } from "../../scripts/markdown-files.mjs";
import { createMarkdownWatcher } from "../../scripts/markdown-watcher.mjs";
import { startArchitectureEditorServer } from "./architecture-editor-server.mjs";
import { saveArchitectureSource } from "../../runtime/architecture-source.mjs";
import { exportPdf, exportPptx } from "../../runtime/output.mjs";
import { sanitizeLayoutReport } from "../../runtime/layout-report.mjs";
import { snapshotSession } from "../../runtime/session-state.mjs";
import {
  isPathInside,
  outputPathForSource,
  pdfNameForSource,
  pptxNameForSource,
} from "../../runtime/output-paths.mjs";
import { safeJoin, sendChunkedVendorAsset, sendFile } from "./static-files.mjs";

const HOST_DIR = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = resolve(HOST_DIR, "..", "..");
const VENDOR_DIR = join(EXT_DIR, "vendor");
const VENDOR_MANIFEST = join(VENDOR_DIR, "vendor-assets.lock.json");
const MAX_BODY_BYTES = 4096;
const MAX_EDIT_BODY_BYTES = 256 * 1024;

export function createUrlToken() {
  return randomBytes(24).toString("base64url");
}

function json(res, status, payload, { cache = "no-store" } = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cache);
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        rejectPromise(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolvePromise(text ? JSON.parse(text) : {});
      } catch (_) {
        rejectPromise(new Error("invalid_json"));
      }
    });
    req.on("error", rejectPromise);
  });
}

function hostAllowed(req, port) {
  const host = req.headers.host;
  if (!host) return false;
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`;
}

function broadcast(session) {
  const message = `data: ${session.version}\n\n`;
  for (const client of [...session.clients]) {
    try {
      client.write(message);
    } catch (_) {
      session.clients.delete(client);
    }
  }
}

/**
 * Start the presentation server for a deck session.
 *
 * Returns `{ url, token, port, close, broadcast }`. `session.url` is set to the
 * token-scoped base URL so the shared output runtime can render from it.
 */
export async function startPresentationServer(
  session,
  {
    application = false,
    editable = false,
    exporters,
    initialSourceMode = "snapshot",
    onLog,
    presenter,
    token = createUrlToken(),
    watcherFactory = createMarkdownWatcher,
  } = {},
) {
  const base = `/${token}`;
  const architectureEditors = new Map();
  const applicationMode = application === true;
  const editingAvailable = applicationMode || editable === true;
  const exportPdfImpl = exporters?.pdf ?? exportPdf;
  const exportPptxImpl = exporters?.pptx ?? exportPptx;
  let sourceMode = initialSourceMode === "live" ? "live" : "snapshot";
  let sourceWatchStatus = "inactive";
  let sourceWatchError = "";
  let sourceWatcher = null;
  let sourceWatcherGeneration = 0;
  let sourceOperation = Promise.resolve();
  let port = 0;

  const runSourceOperation = (operation) => {
    const result = sourceOperation.then(operation, operation);
    sourceOperation = result.catch(() => {});
    return result;
  };

  const setWatchState = (status, error = "") => {
    const changed = sourceWatchStatus !== status || sourceWatchError !== error;
    sourceWatchStatus = status;
    sourceWatchError = error;
    session.watchStatus = status;
    session.watchError = error;
    if (changed && port) broadcast(session);
  };

  const closeSourceWatcher = () => {
    sourceWatcherGeneration += 1;
    sourceWatcher?.close();
    sourceWatcher = null;
  };

  const reloadSourceNow = async (generation) => {
      if (
        generation !== sourceWatcherGeneration ||
        sourceMode !== "live" ||
        !session.file
      ) {
        return;
      }
      const sourceFile = session.file;
      try {
        if ((await readFile(sourceFile, "utf8")) === session.sourceMarkdown) {
          setWatchState("watching");
          return;
        }
        if (
          generation !== sourceWatcherGeneration ||
          sourceMode !== "live" ||
          session.file !== sourceFile
        ) {
          return;
        }
        await session.load({ preserveIndex: true });
        setWatchState("watching");
        broadcast(session);
        onLog?.(`reloaded ${session.sourceName} (${session.slides.length} slides)`);
      } catch (error) {
        if (
          generation !== sourceWatcherGeneration ||
          sourceMode !== "live" ||
          session.file !== sourceFile
        ) {
          return;
        }
        setWatchState("error", error?.code || "source_reload_failed");
        onLog?.(
          `reload failed, keeping the last valid deck: ${error?.message || error}`,
          "error",
        );
      }
  };

  const reloadSource = (generation) =>
    runSourceOperation(() => reloadSourceNow(generation));

  const bindSourceWatcher = () => {
    closeSourceWatcher();
    if (sourceMode !== "live" || !session.file) {
      setWatchState("inactive");
      return { ok: true };
    }
    try {
      const generation = sourceWatcherGeneration;
      sourceWatcher = watcherFactory({
        path: session.file,
        onChange: () => reloadSource(generation),
        onError: (error) => {
          setWatchState("error", "watch_failed");
          onLog?.(`watch error: ${error?.message || error}`, "error");
        },
      });
      setWatchState("watching");
      return { ok: true, generation };
    } catch (error) {
      setWatchState("error", "watch_failed");
      return {
        ok: false,
        error: "watch_failed",
        message: error?.message || "The Markdown watcher could not be started.",
      };
    }
  };

  const setSourceMode = async (mode, { reload = true } = {}) => {
    sourceMode = mode === "live" ? "live" : "snapshot";
    const result = bindSourceWatcher();
    if (sourceMode === "live" && result.ok && reload) {
      await reloadSourceNow(result.generation);
    }
    return sourceMode === "live"
      ? {
          ok: true,
          status: sourceWatchStatus,
          error: sourceWatchError,
        }
      : { ok: true };
  };

  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (!hostAllowed(req, port)) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Forbidden");
      return;
    }

    let requestUrl;
    let pathname = "/";
    try {
      requestUrl = new URL(req.url, `http://127.0.0.1:${port}`);
      pathname = decodeURIComponent(requestUrl.pathname);
    } catch (_) {
      res.statusCode = 400;
      res.end("Bad request");
      return;
    }

    if (pathname !== base && !pathname.startsWith(`${base}/`)) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not found");
      return;
    }
    const route = pathname.slice(base.length) || "/";

    const sameOrigin = () => {
      const origin = req.headers.origin;
      return !origin || origin === `http://127.0.0.1:${port}`;
    };

    if (route === "/" || route === "/index.html") {
      await sendFile(res, join(EXT_DIR, "renderer", "index.html"), { cache: false });
      return;
    }

    if (route === "/state") {
      const offset = Math.max(
        -1,
        Math.min(1, Number.parseInt(requestUrl.searchParams.get("offset") || "0", 10) || 0),
      );
      const state = snapshotSession(session, { offset });
      json(res, 200, {
        version: state.version,
        deckVersion: state.deckVersion,
        markdown: state.markdown,
        index: state.index,
        total: state.total,
        theme: state.theme,
        themeLocked: state.themeLocked,
        customThemeFile: state.customThemeFile,
        customThemeCss: state.customThemeCss,
        customThemeMeta: state.customThemeMeta,
        mode: state.mode,
        sourceBacked: state.sourceBacked,
        sourceModeAvailable: applicationMode && Boolean(session.file),
        sourceMode,
        sourceWatchStatus,
        sourceWatchError,
        presenterRunning: Boolean(presenter?.isRunning?.()),
        presenterWindowAvailable: Boolean(presenter),
        presenterViewAvailable: Boolean(presenter),
        pdfExportAvailable: applicationMode && Boolean(session.file),
        pptxExportAvailable: applicationMode && Boolean(session.file),
        markdownImportAvailable: applicationMode,
        architectureEditAvailable: editingAvailable && Boolean(session.file),
        architectureEdit:
          editingAvailable && Boolean(session.file) && Boolean(session.architectureEdit),
        architectureDetailedEdit: editingAvailable && Boolean(session.file),
        architectureDetailedEditTarget:
          editingAvailable && session.file ? "window" : "",
      });
      return;
    }

    if (route === "/deck") {
      json(res, 200, { deckVersion: session.deckVersion, slides: session.slides });
      return;
    }

    if (route === "/events") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Connection", "keep-alive");
      res.write("retry: 2000\n\n");
      res.write(`data: ${session.version}\n\n`);
      session.clients.add(res);
      const heartbeat = setInterval(() => {
        try {
          res.write(": ping\n\n");
        } catch (_) {
          /* dropped client cleaned up on close */
        }
      }, 15000);
      req.on("close", () => {
        clearInterval(heartbeat);
        session.clients.delete(res);
      });
      return;
    }

    if (route === "/navigate") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        json(res, 405, { ok: false, error: "method_not_allowed" });
        return;
      }
      if (!sameOrigin()) {
        json(res, 403, { ok: false, error: "origin_not_allowed" });
        return;
      }
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        res.setHeader("Connection", "close");
        json(res, error?.message === "payload_too_large" ? 413 : 400, {
          ok: false,
          error: error?.message || "bad_request",
        });
        return;
      }
      const hasIndex = typeof body.index === "number" && Number.isFinite(body.index);
      const hasDelta = typeof body.delta === "number" && Number.isFinite(body.delta);
      if (hasIndex === hasDelta) {
        json(res, 400, {
          ok: false,
          error: "exactly one of index or delta is required",
        });
        return;
      }
      if (!session.slides.length) {
        json(res, 409, { ok: false, error: "no_deck" });
        return;
      }
      const changed = session.navigate(hasIndex ? body.index : session.index + body.delta);
      if (changed) broadcast(session);
      json(res, 200, {
        ok: true,
        changed,
        version: session.version,
        index: session.index,
        total: session.slides.length,
        mode: session.mode,
      });
      return;
    }

    // Print and capture renders read their frozen deck snapshot here.
    if (route === "/export-data") {
      const jobToken = requestUrl.searchParams.get("token") || "";
      const job = session.exportJobs.get(jobToken);
      if (!job) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Export snapshot not found");
        return;
      }
      json(res, 200, {
        slides: job.slides,
        theme: job.theme,
        themeLocked: job.themeLocked,
        customThemeCss: job.customThemeCss,
        customThemeMeta: job.customThemeMeta,
        mermaidImageFallback: job.mermaidImageFallback === true,
      });
      return;
    }

    if (route === "/export-status") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        res.statusCode = 405;
        res.end("Method not allowed");
        return;
      }
      const jobToken = requestUrl.searchParams.get("token") || "";
      const job = session.exportJobs.get(jobToken);
      if (!job) {
        res.statusCode = 404;
        res.end("Export snapshot not found");
        return;
      }
      let body;
      try {
        body = await readJsonBody(req, 256 * 1024);
      } catch (error) {
        res.statusCode = error?.message === "payload_too_large" ? 413 : 400;
        res.end("Invalid export status");
        return;
      }
      if (body.status !== "ready" && body.status !== "error") {
        res.statusCode = 400;
        res.end("Invalid export status");
        return;
      }
      job.status = body.status;
      job.error = typeof body.error === "string" ? body.error.slice(0, 2_000) : "";
      job.layout = sanitizeLayoutReport(body.layout);
      res.statusCode = 204;
      res.end();
      return;
    }

    if (route === "/markdown-files") {
      if (!applicationMode) {
        json(res, 501, { ok: false, error: "not_supported" });
        return;
      }
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        json(res, 405, { ok: false, error: "method_not_allowed" });
        return;
      }
      const { files, truncated } = await listMarkdownFiles(session.workspaceRoot);
      json(res, 200, {
        ok: true,
        files,
        truncated,
        current: session.sourceName || "",
      });
      return;
    }

    // Loading another workspace Markdown file from the browser 📂 button.
    if (route === "/import") {
      if (!applicationMode) {
        json(res, 501, { ok: false, error: "not_supported" });
        return;
      }
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        json(res, 405, { ok: false, error: "method_not_allowed" });
        return;
      }
      if (!sameOrigin()) {
        json(res, 403, { ok: false, error: "origin_not_allowed" });
        return;
      }
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        res.setHeader("Connection", "close");
        json(res, 400, { ok: false, error: error?.message || "bad_request" });
        return;
      }
      const requested = typeof body.path === "string" ? body.path.trim() : "";
      const requestedSourceMode =
        body.sourceMode === undefined ? "snapshot" : body.sourceMode;
      if (requestedSourceMode !== "snapshot" && requestedSourceMode !== "live") {
        json(res, 400, { ok: false, error: "invalid_source_mode" });
        return;
      }
      if (!requested) {
        json(res, 400, { ok: false, error: "path (string) is required" });
        return;
      }
      const root = resolve(session.workspaceRoot);
      const candidate = safeJoin(root, requested);
      if (!candidate || !isPathInside(root, candidate) || !isMarkdownPath(candidate)) {
        json(res, 400, { ok: false, error: "path_outside_workspace" });
        return;
      }
      let canonical;
      try {
        canonical = await realpath(candidate);
        const info = await stat(canonical);
        if (!info.isFile() || !isPathInside(await realpath(root), canonical)) {
          throw new Error("not_a_file");
        }
      } catch (_) {
        json(res, 404, { ok: false, error: "file_not_found" });
        return;
      }
      let sourceResult;
      try {
        sourceResult = await runSourceOperation(async () => {
          await session.openFile(canonical);
          return setSourceMode(requestedSourceMode);
        });
      } catch (error) {
        json(res, 400, { ok: false, error: error?.code || "import_failed" });
        return;
      }
      broadcast(session);
      json(res, sourceResult.ok ? 200 : 409, {
        ...sourceResult,
        version: session.version,
        index: session.index,
        total: session.slides.length,
        theme: session.theme,
        sourceName: session.sourceName,
        sourceMode,
        sourceWatchStatus,
      });
      return;
    }

    if (applicationMode && route === "/source-mode") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        json(res, 405, { ok: false, error: "method_not_allowed" });
        return;
      }
      if (!sameOrigin()) {
        json(res, 403, { ok: false, error: "origin_not_allowed" });
        return;
      }
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        res.setHeader("Connection", "close");
        json(res, error?.message === "payload_too_large" ? 413 : 400, {
          ok: false,
          error: error?.message || "bad_request",
        });
        return;
      }
      if (!session.file) {
        json(res, 409, { ok: false, error: "no_deck" });
        return;
      }
      if (body.mode !== "snapshot" && body.mode !== "live") {
        json(res, 400, { ok: false, error: "invalid_source_mode" });
        return;
      }
      const previous = sourceMode;
      const result = await runSourceOperation(() => setSourceMode(body.mode));
      json(res, result.ok ? 200 : 409, {
        ...result,
        changed: result.ok ? previous !== sourceMode : false,
        sourceMode,
        sourceWatchStatus,
        sourceWatchError,
      });
      return;
    }

    if (editingAvailable && session.file && route === "/edit-mode") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        json(res, 405, { ok: false, error: "method_not_allowed" });
        return;
      }
      if (!sameOrigin()) {
        json(res, 403, { ok: false, error: "origin_not_allowed" });
        return;
      }
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        res.setHeader("Connection", "close");
        json(res, error?.message === "payload_too_large" ? 413 : 400, {
          ok: false,
          error: error?.message || "bad_request",
        });
        return;
      }
      if (typeof body.enabled !== "boolean") {
        json(res, 400, { ok: false, error: "enabled (boolean) is required" });
        return;
      }
      const changed = Boolean(session.architectureEdit) !== body.enabled;
      session.architectureEdit = body.enabled;
      json(res, 200, {
        ok: true,
        changed,
        architectureEdit: session.architectureEdit,
      });
      return;
    }

    if (editingAvailable && session.file && route === "/edit") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        json(res, 405, { ok: false, error: "method_not_allowed" });
        return;
      }
      if (!sameOrigin()) {
        json(res, 403, { ok: false, error: "origin_not_allowed" });
        return;
      }
      let body;
      try {
        body = await readJsonBody(req, MAX_EDIT_BODY_BYTES);
      } catch (error) {
        res.setHeader("Connection", "close");
        json(res, error?.message === "payload_too_large" ? 413 : 400, {
          ok: false,
          error: error?.message || "bad_request",
        });
        return;
      }
      if (typeof body.source !== "string" || !body.source.trim()) {
        json(res, 400, { ok: false, error: "source (string) is required" });
        return;
      }
      const response = await runSourceOperation(async () => {
        if (!session.architectureEdit) {
          return {
            status: 409,
            body: { ok: false, error: "edit_mode_disabled" },
          };
        }
        const index = Number.isInteger(body.index) ? body.index : session.index;
        const block = Number.isInteger(body.block) ? body.block : 0;
        const deckVersion = Number.isInteger(body.deckVersion)
          ? body.deckVersion
          : session.deckVersion;
        if (index < 0 || index >= session.slides.length) {
          return {
            status: 400,
            body: { ok: false, error: "index_out_of_range" },
          };
        }
        if (deckVersion !== session.deckVersion) {
          return {
            status: 409,
            body: { ok: false, error: "deck_changed" },
          };
        }
        const globalBlock = importedArchitectureBlockIndex(
          session.slides,
          index,
          block,
        );
        if (globalBlock === null) {
          return {
            status: 404,
            body: { ok: false, error: "block_not_found" },
          };
        }
        try {
          await loadSlideBackgrounds(session.workspaceRoot, session.sourceName, session.slides);
        } catch (error) {
          return { status: 400, body: { ok: false, error: error.code, message: error.message } };
        }
        const result = await saveArchitectureSource({
          workspaceRoot: session.workspaceRoot,
          sourcePath: session.sourceName,
          sourceFile: session.file,
          blockIndex: globalBlock,
          source: body.source,
          expectedMarkdown: session.sourceMarkdown,
        });
        if (!result.ok) {
          const status =
            result.error === "source_changed"
              ? 409
              : result.error === "block_not_found"
                ? 404
                : result.error === "source_file_too_large"
                  ? 413
                  : result.error === "source_write_failed"
                    ? 500
                    : 422;
          return { status, body: result };
        }
        try {
          await session.load({ preserveIndex: true });
        } catch (error) {
          return {
            status: 500,
            body: {
              ok: false,
              error: "source_reload_failed",
              message: error?.message || "The saved deck could not be reloaded.",
            },
          };
        }
        return {
          status: 200,
          body: {
            ok: true,
            version: session.version,
            deckVersion: session.deckVersion,
            index,
            block,
            markdown: session.markdown,
            fileSaved: true,
          },
        };
      });
      if (response.status === 200) broadcast(session);
      json(res, response.status, response.body);
      return;
    }

    if (editingAvailable && session.file && route === "/architecture-editor/open") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        json(res, 405, { ok: false, error: "method_not_allowed" });
        return;
      }
      if (!sameOrigin()) {
        json(res, 403, { ok: false, error: "origin_not_allowed" });
        return;
      }
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        json(res, error?.message === "payload_too_large" ? 413 : 400, {
          ok: false,
          error: error?.message || "bad_request",
        });
        return;
      }
      const slideIndex = Number.isInteger(body.index) ? body.index : session.index;
      const blockIndex = Number.isInteger(body.block) ? body.block : 0;
      const globalBlock = importedArchitectureBlockIndex(
        session.slides,
        slideIndex,
        blockIndex,
      );
      if (globalBlock === null) {
        json(res, 404, { ok: false, error: "block_not_found" });
        return;
      }
      const key = `${session.file}\0${globalBlock}`;
      let entry = architectureEditors.get(key);
      const refreshExisting = Boolean(entry?.editor);
      if (!entry) {
        entry = { editor: null };
        entry.promise = startArchitectureEditorServer({
          extensionDirectory: EXT_DIR,
          workspaceRoot: session.workspaceRoot,
          sourcePath: session.sourceName,
          blockIndex: globalBlock,
          theme: session.theme,
          logger: onLog,
          onMarkdownSaved: async ({ sourcePath }) => {
            await runSourceOperation(async () => {
              if (resolve(session.workspaceRoot, sourcePath) !== resolve(session.file)) {
                return;
              }
              await session.load({ preserveIndex: true });
              broadcast(session);
            });
          },
        });
        architectureEditors.set(key, entry);
      }
      try {
        const editor = entry.editor ?? (await entry.promise);
        entry.editor = editor;
        if (refreshExisting && !editor.dirty) {
          await editor.reload(
            {
              sourcePath: session.sourceName,
              blockIndex: globalBlock,
              theme: session.theme,
            },
            { discard: true },
          );
        } else {
          editor.setTheme(session.theme);
        }
        json(res, 200, { ok: true, url: editor.url });
      } catch (error) {
        if (!entry.editor && architectureEditors.get(key) === entry) {
          architectureEditors.delete(key);
        }
        json(res, error?.code === "block_not_found" ? 404 : 409, {
          ok: false,
          error: error?.code || "editor_open_failed",
          message: error?.message || "Architecture Editor could not be opened.",
        });
        return;
      }
      return;
    }

    if (presenter && route === "/present") {
      if (req.method !== "POST" && req.method !== "DELETE") {
        res.setHeader("Allow", "POST, DELETE");
        json(res, 405, { ok: false, error: "method_not_allowed" });
        return;
      }
      if (!sameOrigin()) {
        json(res, 403, { ok: false, error: "origin_not_allowed" });
        return;
      }
      if (!session.slides.length) {
        json(res, 409, { ok: false, error: "no_deck" });
        return;
      }
      try {
        const result = req.method === "POST" ? await presenter.open() : await presenter.close();
        json(res, 200, { ok: true, ...result });
      } catch (error) {
        json(res, 500, {
          ok: false,
          error: error?.code || "presenter_launch_failed",
          message: error?.message || "The audience view could not be updated.",
        });
      }
      return;
    }

    if (applicationMode && (route === "/export" || route === "/export-pptx")) {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        json(res, 405, { ok: false, error: "method_not_allowed" });
        return;
      }
      if (!sameOrigin()) {
        json(res, 403, { ok: false, error: "origin_not_allowed" });
        return;
      }
      if (!session.slides.length) {
        json(res, 409, { ok: false, error: "no_deck" });
        return;
      }
      const pptx = route === "/export-pptx";
      let body = {};
      if (pptx) {
        try {
          body = await readJsonBody(req);
          if (!body || typeof body !== "object" || Array.isArray(body) ||
              (body.mermaidImageFallback !== undefined && typeof body.mermaidImageFallback !== "boolean")) {
            throw new Error("invalid_export_options");
          }
        } catch (error) {
          json(res, error?.message === "payload_too_large" ? 413 : 400, {
            ok: false,
            error: error?.message || "bad_request",
          });
          return;
        }
      }
      try {
        const result = pptx
          ? await exportPptxImpl(
              session,
              outputPathForSource(session.sourceName, pptxNameForSource(session.sourceName)),
              session.theme,
              undefined,
              { mermaidImageFallback: body.mermaidImageFallback === true },
            )
          : await exportPdfImpl(
              session,
              outputPathForSource(session.sourceName, pdfNameForSource(session.sourceName)),
              session.theme,
            );
        json(res, 200, result);
      } catch (error) {
        json(
          res,
          error?.code === "no_deck" || error?.code === "export_in_progress"
            ? 409
            : 500,
          {
            ok: false,
            error:
              error?.code || (pptx ? "pptx_export_failed" : "pdf_export_failed"),
            message:
              error?.message ||
              (pptx ? "PowerPoint export failed." : "PDF export failed."),
          },
        );
      }
      return;
    }

    // Routes that are unavailable in this CLI server mode stay explicit so the
    // browser reports an actionable message instead of a bare 404.
    if (
      route === "/present" ||
      route === "/export" ||
      route === "/export-pptx" ||
      route === "/edit" ||
      route === "/edit-mode" ||
      route === "/source-mode" ||
      route === "/architecture-editor/open"
    ) {
      json(res, 501, {
        ok: false,
        error: "not_supported",
        message:
          "This action is available in the MarkdStage canvas. Use the markdstage CLI commands instead (for example: markdstage export).",
      });
      return;
    }

    if (route === "/vendor/mermaid.min.js") {
      await sendChunkedVendorAsset(res, VENDOR_DIR, VENDOR_MANIFEST, "mermaid.min.js", (message) =>
        onLog?.(message, "error"),
      );
      return;
    }

    if (route.startsWith("/renderer/") || route.startsWith("/vendor/")) {
      const abs = safeJoin(EXT_DIR, route);
      if (!abs) {
        res.statusCode = 403;
        res.end("Forbidden");
        return;
      }
      await sendFile(res, abs, { cache: route.startsWith("/vendor/") });
      return;
    }

    if (route.startsWith("/theme-assets/")) {
      const assetPath = route.slice("/theme-assets/".length);
      if (!session.customThemeDir || !session.customThemeAssets.has(assetPath)) {
        res.statusCode = 404;
        res.end("Theme asset not found");
        return;
      }
      const themeRoot = resolve(session.workspaceRoot, session.customThemeDir);
      const candidate = safeJoin(themeRoot, assetPath);
      if (!candidate) {
        res.statusCode = 403;
        res.end("Forbidden");
        return;
      }
      try {
        const [realThemeRoot, realAsset, realWorkspaceRoot] = await Promise.all([
          realpath(themeRoot),
          realpath(candidate),
          realpath(session.workspaceRoot),
        ]);
        if (
          !isPathInside(realWorkspaceRoot, realThemeRoot) ||
          !isPathInside(realThemeRoot, realAsset)
        ) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }
        await sendFile(res, realAsset, { cache: true });
      } catch (_) {
        res.statusCode = 404;
        res.end("Theme asset not found");
      }
      return;
    }

    if (route.startsWith("/background-assets/")) {
      try {
        const file = await resolveSlideBackgroundFile(
          session.workspaceRoot,
          session.sourceName,
          `/assets/${route.slice("/background-assets/".length)}`,
        );
        await sendFile(res, file, { cache: false });
      } catch (error) {
        res.statusCode = error?.code === "slide_background_too_large" ? 413
          : error?.code === "invalid_slide_background" ? 403 : 404;
        res.end(error.message);
      }
      return;
    }

    if (route.startsWith("/assets/")) {
      try {
        const abs = await resolveAssetFile(
          session.workspaceRoot,
          session.sourceName,
          route.slice("/assets/".length),
        );
        if (!abs) {
          res.statusCode = 404;
          res.end("Asset not found");
          return;
        }
        await sendFile(res, abs, { cache: true });
      } catch (error) {
        const forbidden = [
          "invalid_asset_path",
          "asset_source_outside_workspace",
          "asset_root_outside_workspace",
          "asset_outside_workspace",
        ].includes(error?.code);
        res.statusCode = forbidden ? 403 : 404;
        res.end(forbidden ? "Forbidden" : "Asset not found");
      }
      return;
    }

    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not found");
  });

  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  port = typeof address === "object" && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}${base}/`;
  session.url = url;
  const initialWatcher = bindSourceWatcher();
  if (sourceMode === "live" && initialWatcher.ok) {
    await runSourceOperation(() => reloadSourceNow(initialWatcher.generation));
  }

  return {
    server,
    url,
    token,
    port,
    get sourceMode() {
      return sourceMode;
    },
    broadcast: () => broadcast(session),
    close: async () => {
      closeSourceWatcher();
      await sourceOperation.catch(() => {});
      await Promise.all(
        [...architectureEditors.values()].map(async (entry) =>
          (entry.editor ?? (await entry.promise.catch(() => null)))?.close().catch(() => {}),
        ),
      );
      architectureEditors.clear();
      await new Promise((done) => {
        for (const client of [...session.clients]) {
          try {
            client.end();
          } catch (_) {
            /* the client may already be gone */
          }
        }
        session.clients.clear();
        server.close(() => done());
        server.closeAllConnections?.();
      });
    },
  };
}
