// Canvas-independent deck session.
//
// A session owns the deck (slides split from one Markdown file), the resolved
// theme, and the current slide index. It carries exactly the fields the shared
// output runtime (PDF export, PNG capture, layout inspection) expects, so the
// CLI and the Canvas Extension drive the same implementation.

import { isAbsolute, relative, resolve, sep } from "node:path";
import { MARKDOWN_MAX_BYTES, isMarkdownPath } from "../scripts/markdown-path.mjs";
import { MarkdStageError } from "./errors.mjs";
import { isPathInside } from "./output-paths.mjs";
import { createNodeIO, resolveNodeWorkspace } from "./io-node.mjs";
import { unwrapIOResult } from "./io.mjs";
import { readMarkdownDeck } from "./deck-reader.mjs";
import { createSessionState, prepareSessionDeck, commitSessionDeck, navigateSession } from "./session-state.mjs";
export { clampIndex, resolveDeckTheme } from "./session-state.mjs";

export async function resolveDeckFile(file, workspaceRoot, io) {
  if (typeof file !== "string" || !file.trim()) {
    throw new MarkdStageError("invalid_input", "A Markdown file path is required.");
  }
  const absolute = resolve(file);
  if (!isMarkdownPath(absolute)) {
    throw new MarkdStageError(
      "invalid_markdown_path",
      `Only .md and .markdown files can be presented: ${file}`,
    );
  }
  const root = resolve(workspaceRoot);
  if (!isPathInside(root, absolute)) {
    throw new MarkdStageError(
      "path_outside_workspace",
      "Markdown files must stay inside the workspace.",
    );
  }
  const sourceName = workspaceRelative(root, absolute);
  const adapter = io ?? await createNodeIO({ workspaceRoot: root });
  const info = unwrapIOResult(await adapter.stat(sourceName), { operation: "stat", path: sourceName });
  if (info.kind !== "file") {
    throw new MarkdStageError("file_not_found", `Not a file: ${file}`);
  }
  if (info.size > MARKDOWN_MAX_BYTES) {
    throw new MarkdStageError(
      "file_too_large",
      `Markdown files must be ${MARKDOWN_MAX_BYTES} bytes or smaller: ${file}`,
    );
  }
  return { path: absolute, workspaceRoot: root };
}

export async function readDeckSlides(path, { io, sourceName } = {}) {
  if (io) return readMarkdownDeck(sourceName ?? path, io);
  const absolute = resolve(path);
  const root = resolve(absolute, "..");
  const adapter = await createNodeIO({ workspaceRoot: root });
  return readMarkdownDeck(sourceName ?? workspaceRelative(root, absolute), adapter);
}

function workspaceRelative(root, path) {
  const rel = relative(root, path);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return "";
  return rel.split(sep).join("/");
}

/**
 * Build a deck session for one Markdown file.
 *
 * `assetUrlPrefix` lets the presentation server serve theme assets below its
 * unguessable per-process URL token.
 */
export async function createDeckSession({
  file,
  workspaceRoot,
  theme,
  themeFile,
  assetUrlPrefix = "/theme-assets/",
  log,
  io,
} = {}) {
  if (file !== undefined && (typeof file !== "string" || !isAbsolute(file))) {
    throw new MarkdStageError("invalid_input", "Workspace resolution requires absolute arguments.");
  }
  // With an explicitly scoped adapter, its stat is authoritative even for a
  // virtual file. Resolve only the native workspace, not a second disk source.
  const selected = await resolveNodeWorkspace({ workspaceRoot, file: io && workspaceRoot ? undefined : file });
  const root = selected.workspaceRoot;
  const adapter = io ?? await createNodeIO({ workspaceRoot: root });
  const requestedRoot = workspaceRoot ?? root;
  const sourceArgument = (value) => {
    if (value === undefined) return value;
    if (typeof value !== "string" || !isAbsolute(value)) {
      throw new MarkdStageError("invalid_input", "Workspace resolution requires absolute arguments.");
    }
    return isPathInside(requestedRoot, value) ? resolve(root, relative(requestedRoot, value)) : value;
  };
  const initialFile = selected.file ?? sourceArgument(file);
  const resolved = initialFile ? await resolveDeckFile(initialFile, root, adapter) : null;
  const session = {
    ...createSessionState({ theme, themeFile, assetUrlPrefix }),
    file: resolved?.path ?? "",
    workspaceRoot: resolved?.workspaceRoot ?? root,
    sourceName: resolved
      ? workspaceRelative(resolved.workspaceRoot, resolved.path)
      : "",
    exportJobs: new Map(),
    exporting: false,
    clients: new Set(),
    log,
  };

  const loadFile = async (file, sourceName, preserveIndex) => {
    if (!file) {
      throw new MarkdStageError("no_deck", "Open a Markdown file first.");
    }
    const prepared = await prepareSessionDeck(session, adapter, sourceName);
    return commitSessionDeck(session, prepared, { file, preserveIndex });
  };

  session.load = async ({ preserveIndex = false } = {}) =>
    loadFile(session.file, session.sourceName, preserveIndex);

  session.openFile = async (nextFile, { preserveIndex = false } = {}) => {
    const source = sourceArgument(nextFile);
    const selected = io
      ? { workspaceRoot: session.workspaceRoot, file: source }
      : await resolveNodeWorkspace({ workspaceRoot: session.workspaceRoot, file: source });
    const next = await resolveDeckFile(selected.file, selected.workspaceRoot, adapter);
    return loadFile(next.path, workspaceRelative(next.workspaceRoot, next.path), preserveIndex);
  };

  session.navigate = (target) => navigateSession(session, target);

  if (session.file) await session.load();
  return session;
}
