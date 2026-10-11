import { IO_LIMITS, isWorkspacePath, unwrapIOResult } from "./io.mjs";
import { MarkdStageError } from "./errors.mjs";
import { parseSlideBackground } from "../renderer/slide-background.mjs";
import { parseFrontMatter } from "../renderer/theme.mjs";

export function parentPath(path) {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

export function joinPath(root, path) {
  return root ? `${root}/${path}` : path;
}

export function sourceRoots(sourceName) {
  if (sourceName && !isWorkspacePath(sourceName)) {
    throw new MarkdStageError("invalid_input", "A workspace-relative source path is required.");
  }
  return [...new Set([parentPath(sourceName || ""), ""])];
}

export async function findWorkspaceFile(io, candidates) {
  for (const path of candidates) {
    if (!isWorkspacePath(path)) {
      throw new MarkdStageError("invalid_input", "A workspace-relative asset path is required.");
    }
    const result = await io.stat(path);
    if (result?.ok === false && result.code === "missing") continue;
    const info = unwrapIOResult(result, { operation: "stat", path });
    if (info.kind === "file") return { path, ...info };
  }
  return null;
}

export async function resolveWorkspaceAsset(io, sourceName, assetPath) {
  if (!isWorkspacePath(assetPath)) {
    throw new MarkdStageError("invalid_input", "A relative assets-folder path is required.");
  }
  return findWorkspaceFile(io, sourceRoots(sourceName).map((root) =>
    joinPath(root, `assets/${assetPath}`)));
}

export async function resolveBackground(io, sourceName, value) {
  let canonical;
  try {
    canonical = parseSlideBackground(value);
  } catch (error) {
    throw new MarkdStageError("invalid_slide_background", error.message);
  }
  if (!canonical) return null;
  let asset;
  try {
    asset = await resolveWorkspaceAsset(io, sourceName, canonical.slice("/assets/".length));
  } catch {
    throw new MarkdStageError("invalid_slide_background", `Invalid background-image ${canonical}.`);
  }
  if (!asset) {
    throw new MarkdStageError("slide_background_not_found", `Background image was not found: ${canonical}`);
  }
  if (asset.size > IO_LIMITS.themeAsset) {
    throw new MarkdStageError("slide_background_too_large", `Background image must be 2 MiB or smaller: ${canonical}`);
  }
  return asset.path;
}

export async function validateBackgrounds(io, sourceName, slides) {
  for (let index = 0; index < slides.length; index += 1) {
    const meta = parseFrontMatter(slides[index]);
    if (!Object.hasOwn(meta, "background-image")) continue;
    try {
      await resolveBackground(io, sourceName, meta["background-image"]);
    } catch (error) {
      throw new MarkdStageError(error.code || "invalid_slide_background", `Slide ${index + 1}: ${error.message}`);
    }
  }
}

export async function readWorkspaceBytes(io, path, maxBytes) {
  const bytes = unwrapIOResult(await io.readBytes(path, maxBytes), { operation: "readBytes", path });
  if (!(bytes instanceof Uint8Array)) {
    throw new MarkdStageError("io_failed", "The workspace did not return asset bytes.");
  }
  if (bytes.byteLength > maxBytes) {
    throw new MarkdStageError("file_too_large", "The asset exceeds its size limit.");
  }
  return bytes;
}
