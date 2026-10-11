import { buildDeckSlides } from "../markdown-deck.mjs";
import { isMarkdownPath, MARKDOWN_MAX_BYTES } from "../scripts/markdown-path.mjs";
import { MarkdStageError } from "./errors.mjs";
import { getIO, isWorkspacePath, unwrapIOResult } from "./io.mjs";

// Capture the workspace adapter for the whole operation, including when the
// default adapter changes while another window is reading its deck.
export async function readMarkdownDeck(path, io = getIO()) {
  if (!isWorkspacePath(path)) {
    throw new MarkdStageError("invalid_input", "A workspace-relative Markdown path is required.");
  }
  if (!isMarkdownPath(path)) {
    throw new MarkdStageError("invalid_markdown_path", "Only .md and .markdown files can be presented.");
  }
  const text = unwrapIOResult(await io.readText(path, MARKDOWN_MAX_BYTES), {
    operation: "readText",
    path,
  });
  if (typeof text !== "string") {
    throw new MarkdStageError("io_failed", "The workspace did not return Markdown text.");
  }
  if (text.length > MARKDOWN_MAX_BYTES ||
      new TextEncoder().encode(text).byteLength > MARKDOWN_MAX_BYTES) {
    throw new MarkdStageError("file_too_large", "Markdown files must be 2 MiB or smaller.");
  }
  const markdown = text.replace(/^\uFEFF/, "");
  const slides = buildDeckSlides(markdown);
  if (!slides.length) {
    throw new MarkdStageError("empty_markdown", `The Markdown file has no slides: ${path}`);
  }
  return { markdown, slides };
}
