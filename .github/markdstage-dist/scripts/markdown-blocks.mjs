// Small utilities for replacing ```architecture fences in slide Markdown.
//
// Architecture diagram editing **rewrites the source DSL in place** rather than
// maintaining a diff against rendered output. The new DSL produced by the editing
// UI must therefore be restored precisely to the nth ```architecture fence in the source slide.
//
// Imported by both production `extension.mjs` and the test harness
// (`test/harness/server.mjs`). Keep this free of runtime npm dependencies because
// the extension is distributed as a ZIP.

import { findFencedBlocks } from "../renderer/fenced-blocks.mjs";
export { findFencedBlocks } from "../renderer/fenced-blocks.mjs";

/**
 * Split Markdown into body text plus the line's newline sequence. This preserves
 * every byte of newline data outside the fence during replacement.
 *
 * Uses the same boundaries as the fence scanner, so line numbers match its results.
 */
function splitLinesWithEol(markdown) {
  const text = String(markdown);
  const out = [];
  const re = /\r\n|\r|\n/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ text: text.slice(last, m.index), eol: m[0] });
    last = re.lastIndex;
  }
  out.push({ text: text.slice(last), eol: "" });
  return out;
}

/** Newline sequence for inserted lines; use the document's dominant sequence. */
function dominantEol(lines) {
  let crlf = 0;
  let lf = 0;
  for (const line of lines) {
    if (line.eol === "\r\n") crlf += 1;
    else if (line.eol === "\n") lf += 1;
  }
  return crlf > lf ? "\r\n" : "\n";
}

/**
 * Scan ```architecture fences in Markdown.
 * Each item contains { index, open, end, indent, body }.
 * - index: zero-based sequence among architecture fences only (matching the
 *   renderer's `code.language-architecture` occurrence order)
 * - open / end: opening and closing fence line numbers (end is lines.length when unclosed)
 * - body: raw text inside the fence
 */
export function findArchitectureBlocks(markdown) {
  return findFencedBlocks(markdown, "architecture");
}

/**
 * Return Markdown with the contents of the nth ```architecture fence replaced.
 * Return null rather than throwing when the target is absent so the caller can return 404.
 *
 * Preserve the fence lines themselves (` ``` ` and ` ``` `) and replace only the
 * contents. Apply the opening fence's indentation to the new body.
 *
 * Preserve all lines outside the fence, including newline sequences. This prevents
 * saving CRLF Markdown from converting the entire file to LF and changing every line in git diff.
 */
export function replaceArchitectureBlock(markdown, blockIndex, source) {
  const blocks = findArchitectureBlocks(markdown);
  const target = blocks.find((b) => b.index === blockIndex);
  if (!target) return null;
  const lines = splitLinesWithEol(markdown);
  // Match inserted newlines to the opening fence line. If that line has no newline,
  // as with an unclosed fence at EOF, use the document's dominant sequence.
  const eol = lines[target.open]?.eol || dominantEol(lines);
  // Remove trailing blank lines before insertion so a final JSON newline does not add blank lines.
  const body = String(source).replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  const inserted = body.length
    ? body
        .split("\n")
        .map((line) => ({ text: target.indent && line ? target.indent + line : line, eol }))
    : [];
  const head = lines.slice(0, target.open + 1);
  const tail = lines.slice(target.end);
  // For an unclosed fence (empty tail), preserve the source's lack of a final newline.
  if (!tail.length && inserted.length) inserted[inserted.length - 1].eol = "";
  return [...head, ...inserted, ...tail].map((line) => line.text + line.eol).join("");
}

/**
 * Convert a slide-local architecture block index to its index in the complete imported Markdown.
 * Return null for appended slides absent from the source file, such as an automatically added back cover.
 */
export function importedArchitectureBlockIndex(slides, slideIndex, blockIndex) {
  if (
    !Array.isArray(slides) ||
    !Number.isInteger(slideIndex) ||
    !Number.isInteger(blockIndex) ||
    slideIndex < 0 ||
    slideIndex >= slides.length ||
    blockIndex < 0
  ) {
    return null;
  }
  const localBlocks = findArchitectureBlocks(slides[slideIndex]);
  if (blockIndex >= localBlocks.length) return null;
  let globalIndex = blockIndex;
  for (let i = 0; i < slideIndex; i += 1) {
    globalIndex += findArchitectureBlocks(slides[i]).length;
  }
  return globalIndex;
}

/**
 * Replace the target fence in imported Markdown only when it matches the current deck.
 * Fail closed with source_changed if external edits moved or changed the target.
 */
export function replaceImportedArchitectureBlock(
  markdown,
  slides,
  slideIndex,
  blockIndex,
  source,
  expectedMarkdown = null,
) {
  if (typeof expectedMarkdown === "string" && markdown !== expectedMarkdown) {
    return { ok: false, reason: "source_changed" };
  }
  const globalIndex = importedArchitectureBlockIndex(slides, slideIndex, blockIndex);
  if (globalIndex === null) return { ok: false, reason: "block_not_found" };

  const expected = findArchitectureBlocks(slides[slideIndex])[blockIndex];
  const actual = findArchitectureBlocks(markdown)[globalIndex];
  if (!actual) return { ok: false, reason: "source_changed" };
  if (actual.body !== expected.body) return { ok: false, reason: "source_changed" };

  const next = replaceArchitectureBlock(markdown, globalIndex, source);
  if (next === null) return { ok: false, reason: "block_not_found" };
  return { ok: true, markdown: next, globalIndex };
}
