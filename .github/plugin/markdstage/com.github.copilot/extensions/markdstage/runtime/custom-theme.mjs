// Compatibility entry point for Node CLI and canvas callers.
import { isAbsolute, relative, sep } from "node:path";
import { createNodeIO } from "./io-node.mjs";
import { readCustomTheme } from "./theme-reader.mjs";
export { THEME_METADATA_NAME, THEME_METADATA_MAX_BYTES, THEME_CSS_MAX_BYTES } from "./theme-reader.mjs";

export async function loadCustomTheme(workspaceRoot, sourceName, themeFile, options = {}) {
  const io = options.io ?? await createNodeIO({ workspaceRoot });
  const source = isAbsolute(sourceName || "")
    ? relative(workspaceRoot, sourceName).split(sep).join("/") : sourceName;
  return readCustomTheme(io, source, themeFile, options);
}
