import { IO_LIMITS } from "../runtime/io.mjs";

export const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
export const MARKDOWN_MAX_BYTES = IO_LIMITS.markdown;

export function isMarkdownPath(path) {
  if (typeof path !== "string") return false;
  const name = path.split(/[\\/]/).at(-1);
  const dot = name.lastIndexOf(".");
  return dot > 0 && MARKDOWN_EXTENSIONS.has(name.slice(dot).toLowerCase());
}
