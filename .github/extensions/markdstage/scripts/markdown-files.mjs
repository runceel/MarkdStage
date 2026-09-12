// Utilities for finding Markdown files in the workspace.
//
// Used by the canvas 📂 button (Markdown import). These are pure functions with
// no SDK or canvas-state dependencies so both extension.mjs and the test
// harness can import them.

import { readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { isMarkdownPath } from "./markdown-path.mjs";

export { isMarkdownPath, MARKDOWN_EXTENSIONS, MARKDOWN_MAX_BYTES } from "./markdown-path.mjs";
export const MARKDOWN_SCAN_MAX_FILES = 500;
export const MARKDOWN_SCAN_MAX_DEPTH = 6;

// Directories that commonly accumulate generated output and rarely contain slide sources.
// Dot-prefixed names such as .git are excluded as a group and are not listed here.
const SKIP_DIRS = new Set(["node_modules", "vendor", "out", "dist", "build"]);

/**
 * Recursively collect Markdown files under rootDir and return `/`-separated relative paths.
 * Limit the result count and depth so traversal cannot run indefinitely in a large repository.
 *
 * @returns {Promise<{ files: string[], truncated: boolean }>}
 */
export async function listMarkdownFiles(rootDir) {
  const root = resolve(rootDir);
  const files = [];
  let truncated = false;

  const walk = async (dir, depth) => {
    if (truncated || depth > MARKDOWN_SCAN_MAX_DEPTH) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      if (truncated) return;
      if (entry.name.startsWith(".")) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(abs, depth + 1);
        continue;
      }
      if (!entry.isFile() || !isMarkdownPath(entry.name)) continue;
      if (files.length >= MARKDOWN_SCAN_MAX_FILES) {
        truncated = true;
        return;
      }
      files.push(relative(root, abs).split(sep).join("/"));
    }
  };

  await walk(root, 0);
  files.sort((a, b) => a.localeCompare(b));
  return { files, truncated };
}
