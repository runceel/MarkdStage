import { ASSET_EXTENSIONS, ASSET_PATH_PATTERN } from "../renderer/architecture.mjs";
import { IO_LIMITS, isWorkspacePath, unwrapIOResult } from "./io.mjs";
import { MarkdStageError } from "./errors.mjs";
import { joinPath, sourceRoots } from "./workspace-assets.mjs";

export const ARCHITECTURE_ASSET_MAX_BYTES = IO_LIMITS.architectureAsset;
export const ARCHITECTURE_ASSET_LIST_MAX = 1000;
const CONTENT_TYPES = Object.freeze({
  svg: new Set(["image/svg+xml", "text/xml", "application/xml"]),
  png: new Set(["image/png"]), webp: new Set(["image/webp"]),
  jpg: new Set(["image/jpeg"]), jpeg: new Set(["image/jpeg"]),
});

function fail(code, message) {
  throw new MarkdStageError(code, message);
}

function supportedExtension(filename) {
  if (typeof filename !== "string") return "";
  const name = filename.split(/[\\/]/).at(-1);
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return ASSET_EXTENSIONS.includes(extension) ? extension : "";
}

function assertContentType(extension, contentType) {
  const normalized = String(contentType || "").split(";", 1)[0].trim().toLowerCase();
  if (!normalized || normalized === "application/octet-stream") return;
  if (!CONTENT_TYPES[extension]?.has(normalized)) {
    fail("asset_content_type_mismatch", `The ${normalized} content type does not match .${extension}.`);
  }
}

function hasSupportedSignature(content, extension) {
  if (extension === "png") {
    return content.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => content[index] === byte);
  }
  if (extension === "jpg" || extension === "jpeg") {
    return content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  }
  if (extension === "webp") {
    return content.length >= 12 &&
      [82, 73, 70, 70].every((byte, index) => content[index] === byte) &&
      [87, 69, 66, 80].every((byte, index) => content[index + 8] === byte);
  }
  if (extension === "svg") {
    const source = new TextDecoder().decode(content.subarray(0, Math.min(content.length, 16 * 1024)));
    if (/<!doctype/i.test(source)) return false;
    return /^\uFEFF?\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(source);
  }
  return false;
}

export function normalizeArchitectureAssetName(filename) {
  const extension = supportedExtension(filename);
  if (!extension) fail("unsupported_asset_type", "Only SVG, PNG, WebP, JPG, and JPEG images can be imported.");
  const rawStem = filename.slice(0, -(extension.length + 1));
  const stem = rawStem.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "")
    .replace(/[-_.]+$/, "").slice(0, 160) || "image";
  return { stem, extension };
}

async function assetRoot(io, path, { create = false } = {}) {
  const result = await io.stat(path);
  if (result?.ok === false && result.code === "missing") {
    if (!create) return false;
    unwrapIOResult(await io.makeDirectory(path), { operation: "makeDirectory", path });
    return true;
  }
  if (result?.ok === false && result.code === "denied") {
    fail("asset_root_outside_workspace", "The assets folder must resolve inside the workspace.");
  }
  const info = unwrapIOResult(result, { operation: "stat", path });
  if (info.kind !== "directory") fail("asset_root_unavailable", "The workspace assets path is not a directory.");
  return true;
}

function comparePaths(left, right) {
  const a = left.path.split("/");
  const b = right.path.split("/");
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const order = a[index].localeCompare(b[index], "en");
    if (order) return order;
  }
  return a.length - b.length;
}

export async function listArchitectureAssets(io, sourcePath = "", { caseInsensitivePaths = false } = {}) {
  const assets = [];
  const seen = new Set();
  for (const sourceRoot of sourceRoots(sourcePath)) {
    const root = joinPath(sourceRoot, "assets");
    if (!await assetRoot(io, root)) continue;
    const entries = unwrapIOResult(await io.list(root, {
      extensions: ASSET_EXTENSIONS.map((extension) => `.${extension}`),
      recursive: true, maxEntries: 10000,
    }), { operation: "list", path: root });
    for (const entry of entries.slice().sort(comparePaths)) {
      if (assets.length >= ARCHITECTURE_ASSET_LIST_MAX) return assets;
      if (entry.kind !== "file" || !isWorkspacePath(entry.path) ||
          !entry.path.startsWith(`${root}/`) || !supportedExtension(entry.path) ||
          entry.size > ARCHITECTURE_ASSET_MAX_BYTES) continue;
      const path = `assets/${entry.path.slice(root.length + 1)}`;
      if (!ASSET_PATH_PATTERN.test(path)) continue;
      const key = caseInsensitivePaths ? path.toLowerCase() : path;
      if (seen.has(key)) continue;
      seen.add(key);
      assets.push({ path, size: entry.size });
    }
  }
  return assets;
}

export async function importArchitectureAsset(io, { filename, contentType, content } = {}) {
  if (!(content instanceof Uint8Array) || content.length === 0) fail("empty_asset", "Choose a non-empty image file.");
  if (content.length > ARCHITECTURE_ASSET_MAX_BYTES) fail("asset_too_large", "Images must be 10 MB or smaller.");
  const { stem, extension } = normalizeArchitectureAssetName(filename);
  assertContentType(extension, contentType);
  if (!hasSupportedSignature(content, extension)) {
    fail("asset_signature_mismatch", `The file contents do not match the .${extension} image format.`);
  }
  const bytes = new Uint8Array(content);
  await assetRoot(io, "assets", { create: true });
  for (let index = 1; index < 10000; index += 1) {
    const suffix = index === 1 ? "" : `-${index}`;
    const path = `assets/${stem}${suffix}.${extension}`;
    if (!ASSET_PATH_PATTERN.test(path)) fail("invalid_asset_name", "The imported image name is not safe for Architecture DSL.");
    const result = await io.writeBytes(path, bytes, { overwrite: false });
    if (result?.ok === false && result.code === "exists") continue;
    unwrapIOResult(result, { operation: "writeBytes", path });
    return { path, size: bytes.length };
  }
  fail("asset_name_exhausted", "A unique filename could not be allocated.");
}
