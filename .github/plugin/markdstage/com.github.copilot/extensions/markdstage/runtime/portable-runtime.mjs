import { buildDeckSlides } from "../markdown-deck.mjs";
import { importedArchitectureBlockIndex } from "../scripts/markdown-blocks.mjs";
import { IO_LIMITS, getIO, isWorkspacePath, unwrapIOResult } from "./io.mjs";
import { MarkdStageError } from "./errors.mjs";
import {
  createSessionState, prepareSessionDeck, commitSessionDeck,
  navigateSession, requireDeck, snapshotSession,
} from "./session-state.mjs";
import { joinPath, readWorkspaceBytes, resolveWorkspaceAsset } from "./workspace-assets.mjs";
import { readArchitectureBlock, writeArchitectureSource } from "./architecture-writes.mjs";
import { importArchitectureAsset, listArchitectureAssets } from "./architecture-assets.mjs";
import { validateLoadedDeck } from "./deck-validation.mjs";

// The host owns routing and native capabilities. This object alone owns deck
// state; snapshots are detached transport values, never a writable state mirror.
export async function createPortableRuntime({ io = getIO(), ...options } = {}) {
  const session = createSessionState(options);
  let pending = Promise.resolve();
  let closed = false;
  let watchHandle;
  let watchGeneration = 0;
  let sourceMode = "snapshot";
  let watchStatus = "inactive";
  let watchError = "";
  const listeners = new Set();
  const snapshot = (options) => ({
    ...snapshotSession(session, options), sourceMode,
    sourceWatchStatus: watchStatus, sourceWatchError: watchError,
  });
  const publish = () => {
    for (const listener of listeners) {
      try { Promise.resolve(listener(snapshot())).catch(() => {}); } catch { /* Host listeners are isolated. */ }
    }
  };
  const run = (operation) => {
    const result = pending.then(() => {
      if (closed) throw new MarkdStageError("runtime_closed", "The deck runtime is closed.");
      return operation();
    });
    pending = result.catch(() => {});
    return result;
  };
  const reload = async () => {
    requireDeck(session);
    const prepared = await prepareSessionDeck(session, io, session.sourceName);
    commitSessionDeck(session, prepared, { preserveIndex: true });
    watchError = "";
    if (sourceMode === "live") watchStatus = "watching";
    publish();
    return snapshot();
  };
  const architectureTarget = ({ index = session.index, block = 0 } = {}) => {
    requireDeck(session);
    const blockIndex = importedArchitectureBlockIndex(session.slides, index, block);
    if (blockIndex === null) throw new MarkdStageError("block_not_found", "The Architecture block was not found.");
    return { sourcePath: session.sourceName, blockIndex };
  };
  const stopWatch = async () => {
    watchGeneration += 1;
    const handle = watchHandle;
    watchHandle = undefined;
    if (handle !== undefined) unwrapIOResult(await io.unwatch(handle), { operation: "unwatch" });
  };
  const startWatch = async () => {
    await stopWatch();
    if (sourceMode !== "live" || !session.sourceName) return;
    const generation = watchGeneration;
    watchHandle = unwrapIOResult(await io.watch(session.sourceName, { extensions: [".md", ".markdown"] }, () => {
      // Never await this queue in a watch registration callback.
      void run(async () => {
        if (generation !== watchGeneration || sourceMode !== "live") return;
        try { await reload(); }
        catch (error) {
          watchStatus = "error";
          watchError = error instanceof MarkdStageError ? error.message : "The source could not be reloaded.";
          session.version += 1;
          publish();
        }
      }).catch(() => {});
    }), { operation: "watch", path: session.sourceName });
    watchStatus = "watching";
  };
  return Object.freeze({
    loadDeck: (relativePath, loadOptions = {}) => run(async () => {
      const prepared = await prepareSessionDeck(session, io, relativePath, loadOptions);
      commitSessionDeck(session, prepared, { preserveIndex: loadOptions.preserveIndex === true });
      watchError = "";
      if (sourceMode === "live") {
        try { await startWatch(); await reload(); }
        catch (error) { watchStatus = "error"; watchError = error.message; }
      }
      publish();
      return snapshot();
    }),
    reload: () => run(reload),
    snapshot: (options) => run(() => snapshot(options)),
    navigate: (target) => run(() => {
      requireDeck(session);
      const named = {
        next: session.index + 1, previous: session.index - 1,
        first: 0, last: session.slides.length - 1,
      };
      if (typeof target === "string" && Object.hasOwn(named, target)) target = named[target];
      if (target && typeof target === "object") {
        const index = typeof target.index === "number" && Number.isFinite(target.index);
        const delta = typeof target.delta === "number" && Number.isFinite(target.delta);
        if (index === delta) throw new MarkdStageError("invalid_input", "Exactly one of index or delta is required.");
        target = index ? target.index : session.index + target.delta;
      }
      if (typeof target !== "number" || !Number.isFinite(target)) {
        throw new MarkdStageError("invalid_input", "A slide index or navigation direction is required.");
      }
      if (navigateSession(session, target)) publish();
      return snapshot();
    }),
    setSourceMode: (mode) => run(async () => {
      if (mode !== "live" && mode !== "snapshot") throw new MarkdStageError("invalid_input", "Source mode must be live or snapshot.");
      requireDeck(session);
      sourceMode = mode;
      watchError = "";
      watchStatus = "inactive";
      if (mode === "live") {
        try { await startWatch(); await reload(); }
        catch (error) { watchStatus = "error"; watchError = error.message; }
      } else await stopWatch();
      session.version += 1;
      publish();
      return snapshot();
    }),
    listMarkdown: () => run(async () => unwrapIOResult(await io.list("", {
      extensions: [".md", ".markdown"], recursive: true, maxEntries: 10000,
    }), { operation: "list", path: "" })),
    validate: (options = {}) => run(() => {
      requireDeck(session);
      return validateLoadedDeck(session, options);
    }),
    listArchitectureAssets: () => run(() => listArchitectureAssets(io, session.sourceName, {
      caseInsensitivePaths: options.caseInsensitivePaths === true,
    })),
    importArchitectureAsset: (request) => run(() => importArchitectureAsset(io, request)),
    readArchitecture: (blockIndex, sourcePath) => run(() => {
      requireDeck(session);
      return readArchitectureBlock(io, sourcePath ?? session.sourceName, blockIndex);
    }),
    resolveArchitectureTarget: (request) => run(() => architectureTarget(request)),
    saveArchitecture: (request = {}) => run(async () => {
      requireDeck(session);
      if (!request || typeof request !== "object" || Array.isArray(request)) {
        return { ok: false, error: "invalid_input", message: "An Architecture save request is required." };
      }
      if (request.deckVersion !== undefined && request.deckVersion !== session.deckVersion) {
        return { ok: false, error: "deck_changed", message: "The deck changed. Reload before saving." };
      }
      if (request.index !== undefined || request.block !== undefined) {
        try { request = { ...request, ...architectureTarget(request) }; }
        catch (error) { return { ok: false, error: error.code, message: error.message }; }
      }
      const sourcePath = request.sourcePath ?? session.sourceName;
      if (sourcePath !== session.sourceName) {
        return { ok: false, error: "source_changed", message: "The active Markdown source changed. Reload before saving." };
      }
      const result = await writeArchitectureSource(io, {
        ...request, sourcePath, expectedMarkdown: request.expectedMarkdown ?? session.sourceMarkdown,
      }, {
        beforeWrite: (markdown) => prepareSessionDeck(session, io, sourcePath, {}, {
          markdown, slides: buildDeckSlides(markdown),
        }),
      });
      if (!result.ok) return result;
      const { prepared, ...saved } = result;
      commitSessionDeck(session, prepared, { preserveIndex: true });
      publish();
      return { ...saved, snapshot: snapshot() };
    }),
    readAsset: (path) => run(async () => {
      requireDeck(session);
      if (typeof path !== "string") throw new MarkdStageError("invalid_input", "An asset path is required.");
      const relativePath = path.replace(/^\//, "");
      let resolved;
      let maxBytes = IO_LIMITS.architectureAsset;
      const themePrefix = session.assetUrlPrefix.replace(/^\//, "");
      if (relativePath.startsWith(themePrefix)) {
        const asset = relativePath.slice(themePrefix.length);
        if (!session.customThemeAssets.has(asset)) throw new MarkdStageError("file_not_found", "The theme asset was not declared.");
        resolved = joinPath(session.customThemeDir, asset);
        maxBytes = IO_LIMITS.themeAsset;
      } else if (relativePath.startsWith("assets/") && isWorkspacePath(relativePath)) {
        resolved = (await resolveWorkspaceAsset(io, session.sourceName, relativePath.slice("assets/".length)))?.path;
      } else throw new MarkdStageError("invalid_input", "An assets-folder path is required.");
      if (!resolved) throw new MarkdStageError("file_not_found", "The asset was not found.");
      return { path: resolved, bytes: await readWorkspaceBytes(io, resolved, maxBytes) };
    }),
    subscribe: (listener) => {
      if (typeof listener !== "function") throw new TypeError("A snapshot listener is required.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => run(async () => {
      await stopWatch();
      closed = true;
      listeners.clear();
    }),
  });
}
