import { parseArchitecture } from "../renderer/architecture.mjs";
import { ArchitectureError } from "../renderer/architecture-diagnostics.mjs";
import { findArchitectureBlocks, replaceArchitectureBlock } from "../scripts/markdown-blocks.mjs";
import { isMarkdownPath } from "../scripts/markdown-path.mjs";
import { IO_LIMITS, isWorkspacePath, unwrapIOResult } from "./io.mjs";
import { MarkdStageError } from "./errors.mjs";

export function validateArchitectureSource(source) {
  try {
    parseArchitecture(source);
    return null;
  } catch (error) {
    if (!(error instanceof ArchitectureError)) throw error;
    return {
      ok: false, error: "invalid_architecture",
      message: error.message || "The diagram is invalid.",
      diagnostic: error.diagnostic, validation: error.validation,
    };
  }
}

export function prepareArchitectureReplacement({ markdown, expectedMarkdown, blockIndex, source }) {
  if (!Number.isInteger(blockIndex) || blockIndex < 0 || typeof source !== "string" ||
      typeof markdown !== "string" || typeof expectedMarkdown !== "string") {
    return { ok: false, error: "invalid_input", message: "A block index, source, and Markdown snapshot are required." };
  }
  if (new TextEncoder().encode(source).byteLength > IO_LIMITS.markdown) {
    return { ok: false, error: "source_file_too_large", message: "The diagram source is too large to edit." };
  }
  const invalid = validateArchitectureSource(source);
  if (invalid) return invalid;
  if (markdown !== expectedMarkdown &&
      (!markdown.startsWith("\uFEFF") || markdown.slice(1) !== expectedMarkdown)) {
    return { ok: false, error: "source_changed", message: "The source Markdown changed outside the editor. Reload before saving." };
  }
  const next = replaceArchitectureBlock(markdown, blockIndex, source);
  if (next === null) return { ok: false, error: "block_not_found", message: "The Architecture block no longer exists." };
  if (new TextEncoder().encode(next).byteLength > IO_LIMITS.markdown) {
    return { ok: false, error: "source_file_too_large", message: "The Markdown file is too large to edit." };
  }
  return { ok: true, markdown: next };
}

export async function readArchitectureDocument(io, sourcePath) {
  if (!isWorkspacePath(sourcePath) || !isMarkdownPath(sourcePath)) {
    throw new MarkdStageError("invalid_source_path", "sourcePath must be a Markdown file inside the workspace.");
  }
  const before = unwrapIOResult(await io.stat(sourcePath), { operation: "stat", path: sourcePath });
  if (before.kind !== "file") throw new MarkdStageError("source_file_not_found", "The source Markdown file was not found.");
  if (before.size > IO_LIMITS.markdown) throw new MarkdStageError("source_file_too_large", "The Markdown file is too large to edit.");
  // readText deliberately strips the BOM. Source editing must retain it on disk.
  const bytes = unwrapIOResult(await io.readBytes(sourcePath, IO_LIMITS.markdown), { operation: "readBytes", path: sourcePath });
  if (!(bytes instanceof Uint8Array)) throw new MarkdStageError("io_failed", "The workspace did not return Markdown bytes.");
  if (bytes.byteLength > IO_LIMITS.markdown) {
    throw new MarkdStageError("source_file_too_large", "The Markdown file is too large to edit.");
  }
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const markdown = new TextDecoder().decode(bytes);
  const after = unwrapIOResult(await io.stat(sourcePath), { operation: "stat", path: sourcePath });
  if (before.modifiedAt !== after.modifiedAt || before.size !== after.size || after.kind !== "file") {
    throw new MarkdStageError("source_changed", "The source Markdown changed while it was being read.");
  }
  return { markdown, bom, modifiedAt: after.modifiedAt };
}

export async function readArchitectureBlock(io, sourcePath, blockIndex) {
  if (!Number.isInteger(blockIndex) || blockIndex < 0) {
    throw new MarkdStageError("invalid_block_index", "blockIndex must be a non-negative integer.");
  }
  const document = await readArchitectureDocument(io, sourcePath);
  const block = findArchitectureBlocks(document.markdown)[blockIndex];
  if (!block) throw new MarkdStageError("block_not_found", "The Architecture block was not found.");
  const invalid = validateArchitectureSource(block.body);
  if (invalid) throw Object.assign(new MarkdStageError(invalid.error, invalid.message), {
    diagnostic: invalid.diagnostic, validation: invalid.validation,
  });
  return { ...document, sourcePath, blockIndex, source: block.body };
}

export async function writeArchitectureSource(io, {
  sourcePath, blockIndex, source, expectedMarkdown,
}, { beforeWrite } = {}) {
  if (!Number.isInteger(blockIndex) || blockIndex < 0 || typeof source !== "string" ||
      typeof expectedMarkdown !== "string") {
    return { ok: false, error: "invalid_input", message: "A block index, source, and Markdown snapshot are required." };
  }
  if (new TextEncoder().encode(source).byteLength > IO_LIMITS.markdown) {
    return { ok: false, error: "source_file_too_large", message: "The diagram source is too large to edit." };
  }
  const invalid = validateArchitectureSource(source);
  if (invalid) return invalid;
  try {
    const current = await readArchitectureDocument(io, sourcePath);
    const replacement = prepareArchitectureReplacement({
      markdown: current.bom ? `\uFEFF${current.markdown}` : current.markdown,
      expectedMarkdown, blockIndex, source,
    });
    if (!replacement.ok) return replacement;
    const diskMarkdown = replacement.markdown;
    const markdown = diskMarkdown.replace(/^\uFEFF/, "");
    // Prepare the entire replacement deck before making a persistent mutation.
    const prepared = await beforeWrite?.(markdown);
    unwrapIOResult(await io.replaceText(sourcePath, diskMarkdown, { expectedModifiedAt: current.modifiedAt }), {
      operation: "replaceText", path: sourcePath,
    });
    return { ok: true, sourcePath, blockIndex, markdown, ...(prepared ? { prepared } : {}) };
  } catch (error) {
    return {
      ok: false, error: error.code || "source_write_failed",
      message: error instanceof MarkdStageError ? error.message : "The source Markdown could not be saved.",
    };
  }
}
