import { ensureBackCover } from "../deck-state.mjs";
import { DEFAULT_THEME, normalizeTheme, resolveFrontMatterTheme } from "../renderer/theme.mjs";
import { deriveTitle } from "../renderer/slide-title.mjs";
import { extractSpeakerNotes } from "../renderer/speaker-notes.mjs";
import { readMarkdownDeck } from "./deck-reader.mjs";
import { readCustomTheme } from "./theme-reader.mjs";
import { validateBackgrounds } from "./workspace-assets.mjs";
import { MarkdStageError } from "./errors.mjs";

export function clampIndex(value, total) {
  const index = Number(value);
  if (!Number.isFinite(index) || total <= 0) return 0;
  return Math.max(0, Math.min(Math.trunc(index), total - 1));
}

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

export function createSessionState({ theme, themeFile, assetUrlPrefix = "/theme-assets/" } = {}) {
  return {
    file: "", sourceName: "", url: "", version: 0, deckVersion: 0,
    sourceMarkdown: "", markdown: "", slides: [], index: 0, mode: "deck",
    theme: DEFAULT_THEME, themeLocked: false, customThemeFile: "",
    customThemeCss: "", customThemeDir: "", customThemeMeta: null,
    customThemeAssets: new Set(), customThemeWarnings: [],
    requestedTheme: theme, requestedThemeFile: themeFile, assetUrlPrefix,
  };
}

export async function prepareSessionDeck(session, io, sourceName, options = {}, deck) {
  if (!options || typeof options !== "object" || Array.isArray(options) ||
      ["theme", "themeFile"].some((key) => options[key] != null && typeof options[key] !== "string")) {
    throw new MarkdStageError("invalid_input", "Deck options must contain string theme and themeFile values.");
  }
  const { markdown, slides } = deck ?? await readMarkdownDeck(sourceName, io);
  await validateBackgrounds(io, sourceName, slides);
  const requestedTheme = Object.hasOwn(options, "theme") ? options.theme : session.requestedTheme;
  const requestedThemeFile = Object.hasOwn(options, "themeFile") ? options.themeFile : session.requestedThemeFile;
  const selection = resolveDeckTheme({ slides, explicitTheme: requestedTheme, explicitThemeFile: requestedThemeFile });
  const custom = selection.theme === "custom"
    ? await readCustomTheme(io, sourceName, selection.themeFile, { assetUrlPrefix: session.assetUrlPrefix })
    : { file: "", css: "", dir: "", metadata: null, assets: [], warnings: [] };
  return {
    sourceName, sourceMarkdown: markdown, slides: ensureBackCover(slides.slice()),
    theme: selection.theme, themeLocked: selection.themeLocked,
    customThemeFile: custom.file, customThemeCss: custom.css, customThemeDir: custom.dir,
    customThemeMeta: custom.metadata, customThemeAssets: new Set(custom.assets),
    customThemeWarnings: custom.warnings, requestedTheme, requestedThemeFile,
  };
}

export function commitSessionDeck(session, prepared, { preserveIndex = false, file = prepared.sourceName } = {}) {
  const index = clampIndex(preserveIndex ? session.index : 0, prepared.slides.length);
  Object.assign(session, prepared, { file, index, markdown: prepared.slides[index] ?? "" });
  session.deckVersion += 1;
  session.version += 1;
  return session.slides.length;
}

export function navigateSession(session, target) {
  const next = clampIndex(target, session.slides.length);
  if (next === session.index) return false;
  session.index = next;
  session.markdown = session.slides[next] ?? "";
  session.version += 1;
  return true;
}

export function requireDeck(session) {
  if (!session.sourceName) throw new MarkdStageError("no_deck", "Open a Markdown file first.");
}

export function snapshotSession(session, { offset = 0 } = {}) {
  const index = clampIndex(session.index + clampOffset(offset), session.slides.length);
  return {
    version: session.version, deckVersion: session.deckVersion,
    sourceName: session.sourceName, sourceMarkdown: session.sourceMarkdown,
    slides: session.slides.slice(), titles: session.slides.map(deriveTitle),
    notes: session.slides.map(extractSpeakerNotes),
    index, total: session.slides.length, markdown: session.slides[index] ?? "",
    mode: session.mode, theme: session.theme, themeLocked: session.themeLocked,
    customThemeFile: session.customThemeFile, customThemeCss: session.customThemeCss,
    customThemeDir: session.customThemeDir,
    customThemeMeta: session.customThemeMeta ? JSON.parse(JSON.stringify(session.customThemeMeta)) : null,
    customThemeAssets: [...session.customThemeAssets],
    customThemeWarnings: session.customThemeWarnings.map((warning) => ({ ...warning })),
    sourceBacked: Boolean(session.sourceName),
  };
}

function clampOffset(offset) {
  return Math.max(-1, Math.min(1, Math.trunc(Number(offset)) || 0));
}
