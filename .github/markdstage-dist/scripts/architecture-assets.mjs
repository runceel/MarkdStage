// Node entry adapter; parsing, validation, naming, listing, and import are shared.
import { isAbsolute, relative, sep } from "node:path";
import { createNodeIO } from "../runtime/io-node.mjs";
import {
  importArchitectureAsset as importAsset,
  listArchitectureAssets as listAssets,
} from "../runtime/architecture-assets.mjs";
export {
  ARCHITECTURE_ASSET_MAX_BYTES, ARCHITECTURE_ASSET_LIST_MAX,
  normalizeArchitectureAssetName,
} from "../runtime/architecture-assets.mjs";

export async function listArchitectureAssets(workspaceRoot, sourcePath = "") {
  const io = await createNodeIO({ workspaceRoot });
  const source = isAbsolute(sourcePath) ? relative(workspaceRoot, sourcePath).split(sep).join("/") : sourcePath;
  return listAssets(io, source, { caseInsensitivePaths: process.platform === "win32" });
}

export async function importArchitectureAsset(workspaceRoot, options) {
  return importAsset(await createNodeIO({ workspaceRoot }), options);
}
