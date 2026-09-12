// Canvas-independent deck session.
//
// A session owns the deck (slides split from one Markdown file), the resolved
// theme, and the current slide index. It carries exactly the fields the shared
// output runtime (PDF export, PNG capture, layout inspection) expects, so the
// CLI and the Canvas Extension drive the same implementation.

import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { ensureBackCover } from "../deck-state.mjs";
import { MARKDOWN_MAX_BYTES, isMarkdownPath } from "../scripts/markdown-path.mjs";
import { resolveWorkspaceRoot } from "../scripts/workspace-root.mjs";
import { DEFAULT_THEME, normalizeTheme, resolveFrontMatterTheme } from "../renderer/theme.mjs";
import { MarkdStageError } from "./errors.mjs";
import { loadCustomTheme } from "./custom-theme.mjs";
import { loadSlideBackgrounds } from "./slide-backgrounds.mjs";
import { isPathInside } from "./output-paths.mjs";
import { createNodeIO } from "./io-node.mjs";
import { unwrapIOResult } from "./io.mjs";
import { readMarkdownDeck } from "./deck-reader.mjs";

export function clampIndex(value, total) {
  let index = Number(value);
  if (!Number.isFinite(index)) return 0;
  index = Math.trunc(index);
  if (total <= 0) return 0;
  if (index < 0) return 0;
  if (index >= total) return total - 1;
  return index;
}

// Front matter selects the theme unless the caller passes an explicit one; an
// explicit theme locks the deck so per-slide front matter cannot override it.
export function resolveDeckTheme({ slides, explicitTheme, explicitThemeFile }) {
  const frontMatter = resolveFrontMatterTheme(slides);
  const hasExplicitTheme = typeof explicitTheme === "string" && explicitTheme.trim().length > 0;
  const theme = hasExplicitTheme ? normalizeTheme(explicitTheme) : frontMatter.theme;
  const themeFile = explicitThemeFile?.trim() || frontMatter.themeFile;
  return {
    theme: themeFile && (!hasExplicitTheme || theme === "custom") ? "custom" : theme,
    themeFile,
    themeLocked: hasExplicitTheme,
  };
}

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
  // An explicit --workspace wins; otherwise confine the deck to its Git
  // repository root (or the folder holding the Markdown file).
  const deckDirectory = file ? resolve(file, "..") : process.cwd();
  const requestedRoot = workspaceRoot
    ? resolve(workspaceRoot)
    : resolveWorkspaceRoot(deckDirectory, deckDirectory);
  let root;
  let adapter;
  try {
    root = await realpath(requestedRoot);
    adapter = io ?? await createNodeIO({ workspaceRoot: root });
  } catch (_) {
    throw new MarkdStageError(
      "workspace_not_found",
      `Could not read workspace directory: ${requestedRoot}`,
    );
  }
  // Canonicalize the selected workspace without resolving away links inside it.
  const sourceArgument = (value) => {
    if (typeof value !== "string" || !value.trim()) return value;
    const absolute = resolve(value);
    return isPathInside(requestedRoot, absolute)
      ? resolve(root, relative(requestedRoot, absolute))
      : absolute;
  };
  const resolved = file ? await resolveDeckFile(sourceArgument(file), root, adapter) : null;
  const session = {
    file: resolved?.path ?? "",
    workspaceRoot: resolved?.workspaceRoot ?? root,
    sourceName: resolved
      ? workspaceRelative(resolved.workspaceRoot, resolved.path)
      : "",
    url: "",
    version: 0,
    deckVersion: 0,
    sourceMarkdown: "",
    markdown: "",
    slides: [],
    index: 0,
    mode: "deck",
    theme: DEFAULT_THEME,
    themeLocked: false,
    customThemeFile: "",
    customThemeCss: "",
    customThemeDir: "",
    customThemeMeta: null,
    customThemeAssets: new Set(),
    customThemeWarnings: [],
    exportJobs: new Map(),
    exporting: false,
    clients: new Set(),
    requestedTheme: theme,
    requestedThemeFile: themeFile,
    assetUrlPrefix,
    log,
  };

  const loadFile = async (file, sourceName, preserveIndex) => {
    if (!file) {
      throw new MarkdStageError("no_deck", "Open a Markdown file first.");
    }
    const { markdown, slides } = await readMarkdownDeck(sourceName, adapter);
    await loadSlideBackgrounds(session.workspaceRoot, sourceName, slides);
    const selection = resolveDeckTheme({
      slides,
      explicitTheme: session.requestedTheme,
      explicitThemeFile: session.requestedThemeFile,
    });
    const custom =
      selection.theme === "custom"
        ? await loadCustomTheme(
            session.workspaceRoot,
            sourceName,
            selection.themeFile,
            { assetUrlPrefix: session.assetUrlPrefix },
          )
        : { file: "", css: "", dir: "", metadata: null, assets: [] };
    session.file = file;
    session.sourceName = sourceName;
    session.theme = selection.theme;
    session.themeLocked = selection.themeLocked;
    session.customThemeFile = custom.file;
    session.customThemeCss = custom.css;
    session.customThemeDir = custom.dir;
    session.customThemeMeta = custom.metadata;
    session.customThemeAssets = new Set(custom.assets);
    session.customThemeWarnings = custom.warnings ?? [];
    session.sourceMarkdown = markdown;
    session.slides = ensureBackCover(slides.slice());
    session.index = clampIndex(preserveIndex ? session.index : 0, session.slides.length);
    session.markdown = session.slides[session.index] ?? "";
    session.deckVersion += 1;
    session.version += 1;
    return session.slides.length;
  };

  session.load = async ({ preserveIndex = false } = {}) =>
    loadFile(session.file, session.sourceName, preserveIndex);

  session.openFile = async (nextFile, { preserveIndex = false } = {}) => {
    const next = await resolveDeckFile(sourceArgument(nextFile), session.workspaceRoot, adapter);
    return loadFile(next.path, workspaceRelative(next.workspaceRoot, next.path), preserveIndex);
  };

  session.navigate = (target) => {
    const next = clampIndex(target, session.slides.length);
    if (next === session.index) return false;
    session.index = next;
    session.markdown = session.slides[session.index] ?? "";
    session.version += 1;
    return true;
  };

  if (session.file) await session.load();
  return session;
}
