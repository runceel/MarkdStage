import { MarkdStageError } from "./errors.mjs";
import { IO_LIMITS, unwrapIOResult } from "./io.mjs";
import { findWorkspaceFile, joinPath, parentPath, sourceRoots } from "./workspace-assets.mjs";
import {
  mapThemeMetadataAssets, parseThemeMetadata, parseThemeVariables,
  serializeThemeVariables, themeMetadataAssetPaths,
} from "../renderer/theme.mjs";

export const THEME_METADATA_NAME = "theme.json";
export const THEME_METADATA_MAX_BYTES = IO_LIMITS.themeMetadata;
export const THEME_CSS_MAX_BYTES = IO_LIMITS.themeCss;

// Kept in sync with schema/theme-v1.json by the portable runtime tests.
export const KNOWN_THEME_VARIABLES = Object.freeze([
  "--bg", "--fg", "--muted", "--body", "--accent", "--accent-strong",
  "--accent-soft", "--accent-line", "--surface", "--code", "--code-fg",
  "--border", "--syntax-comment", "--syntax-keyword", "--syntax-string",
  "--syntax-number", "--syntax-title", "--syntax-type", "--syntax-meta",
  "--syntax-variable", "--syntax-addition", "--syntax-addition-bg",
  "--syntax-deletion", "--syntax-deletion-bg", "--glow-1", "--glow-2",
  "--topbar", "--kicker-mark", "--cover-bg", "--cover-topbar",
  "--cover-text-align", "--cover-content-align", "--cover-content-self",
  "--cover-content-width", "--cover-logo-width", "--section-bg",
  "--backcover-bg", "--backcover-logo-width", "--print-slide-bg",
  "--print-cover-bg", "--print-section-bg", "--ms-font", "--heading-font",
  "--code-font", "--ms-red", "--ms-green", "--ms-blue", "--ms-yellow",
  "--deck-pad-y", "--deck-pad-x", "--slide-h1-size", "--slide-h2-size",
  "--slide-h3-size", "--slide-body-size", "--slide-code-size", "--kicker-size",
  "--slide-image-max-height", "--mermaid-max-height", "--architecture-max-height",
  "--rule-width", "--rule-color", "--table-font-size", "--table-cell-padding",
  "--table-border-width",
]);
const knownVariables = new Set(KNOWN_THEME_VARIABLES);

async function readThemeText(io, path, limit) {
  const text = unwrapIOResult(await io.readText(path, limit), { operation: "readText", path, kind: "theme" });
  if (typeof text !== "string") throw new Error("The theme must contain UTF-8 text.");
  if (new TextEncoder().encode(text).byteLength > limit) {
    throw new Error("Custom theme files must be 64 KiB or smaller.");
  }
  return text;
}

export async function readCustomTheme(io, sourceName, themeFile, { assetUrlPrefix = "/theme-assets/" } = {}) {
  if (typeof themeFile !== "string" || !themeFile.trim()) {
    throw new MarkdStageError("invalid_theme_file", "custom theme requires themeFile or front matter theme-file.");
  }
  let found;
  try {
    // Legacy callers allow a leading ./; it is never passed across the port.
    const name = themeFile.trim().replace(/^(?:\.\/)+/, "");
    found = await findWorkspaceFile(io, sourceRoots(sourceName).map((root) => joinPath(root, name)));
  } catch (error) {
    throw new MarkdStageError("invalid_theme_file", error.message);
  }
  if (!found) throw new MarkdStageError("theme_file_not_found", `Could not read custom theme file: ${themeFile}`);
  try {
    const css = await readThemeText(io, found.path, THEME_CSS_MAX_BYTES);
    const dir = parentPath(found.path);
    const metadataPath = joinPath(dir, THEME_METADATA_NAME);
    const metadataInfo = await findWorkspaceFile(io, [metadataPath]);
    const metadata = metadataInfo
      ? parseThemeMetadata(await readThemeText(io, metadataPath, THEME_METADATA_MAX_BYTES)) : null;
    const assets = metadata ? themeMetadataAssetPaths(metadata) : [];
    for (const assetPath of assets) {
      const asset = await findWorkspaceFile(io, [joinPath(dir, assetPath)]);
      if (!asset) throw new Error(`Custom theme asset was not found: ${assetPath}`);
      if (asset.size > IO_LIMITS.themeAsset) {
        throw new Error(`Custom theme asset must be 2 MiB or smaller: ${assetPath}`);
      }
    }
    const variables = parseThemeVariables(css);
    return {
      file: found.path, dir, css: serializeThemeVariables(variables),
      metadata: metadata ? mapThemeMetadataAssets(metadata, (path) => `${assetUrlPrefix}${path}`) : null,
      assets,
      warnings: Object.keys(variables).filter((name) => !knownVariables.has(name)).map((name) => ({
        code: "unknown_theme_property",
        message: `Unknown custom theme property: ${name}. It is applied as-is, but no standard ` +
          "layout uses it; see schema/theme-v1.json for the supported properties.",
      })),
    };
  } catch (error) {
    throw new MarkdStageError("invalid_theme_file", error.message);
  }
}
