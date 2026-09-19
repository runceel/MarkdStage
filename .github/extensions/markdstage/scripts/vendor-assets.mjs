import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_CHUNK_SIZE = 512 * 1024;
export const MANIFEST_NAME = "vendor-assets.lock.json";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function chunkName(sourceName, index) {
  return `${sourceName}.part-${String(index + 1).padStart(4, "0")}`;
}

export async function readManifest(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!manifest || manifest.schemaVersion !== 1 || !manifest.assets ||
      !Number.isInteger(manifest.chunkSize) || manifest.chunkSize <= 0) {
    throw new Error(`Invalid vendor asset manifest: ${manifestPath}`);
  }
  return manifest;
}

export async function reconstructAsset(vendorDir, assetName, manifestPath) {
  const manifest = await readManifest(manifestPath);
  const asset = manifest.assets[assetName];
  if (!asset || !Array.isArray(asset.chunks) || asset.chunks.length === 0) {
    throw new Error(`Missing manifest entry for vendor asset: ${assetName}`);
  }
  const chunks = [];
  let total = 0;
  for (const [index, entry] of asset.chunks.entries()) {
    if (entry.index !== index + 1 || typeof entry.file !== "string") {
      throw new Error(`Invalid chunk ordering for ${assetName}`);
    }
    const data = await readFile(join(vendorDir, entry.file));
    if (data.length !== entry.size || sha256(data) !== entry.sha256) {
      throw new Error(`Integrity check failed for ${entry.file}`);
    }
    if (data.length > manifest.chunkSize) {
      throw new Error(`Chunk exceeds configured size: ${entry.file}`);
    }
    chunks.push(data);
    total += data.length;
  }
  const result = Buffer.concat(chunks);
  if (total !== asset.size || result.length !== asset.size || sha256(result) !== asset.sha256) {
    throw new Error(`Integrity check failed for reconstructed ${assetName}`);
  }
  return result;
}

export async function splitAsset(sourcePath, vendorDir, manifestPath, assetName, upstreamVersion, upstreamName = "mermaid") {
  if (!/^[a-z][a-z0-9.-]*\.js$/.test(assetName) ||
      !/^[a-z][a-z0-9.-]*$/.test(upstreamName)) {
    throw new Error("Vendor asset and upstream package names must be simple file/package names.");
  }
  let previous;
  try {
    previous = await readManifest(manifestPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const source = await readFile(sourcePath);
  if (source.length === 0) throw new Error("A vendor asset must not be empty.");
  const chunkSize = previous?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunks = [];
  await mkdir(vendorDir, { recursive: true });
  for (let offset = 0, index = 0; offset < source.length; offset += chunkSize, index += 1) {
    const data = source.subarray(offset, Math.min(offset + chunkSize, source.length));
    const file = chunkName(assetName, index);
    await writeFile(join(vendorDir, file), data);
    chunks.push({
      index: index + 1,
      file,
      size: data.length,
      sha256: sha256(data),
    });
  }
  const manifest = {
    schemaVersion: 1,
    chunkSize,
    assets: {
      ...previous?.assets,
      [assetName]: {
        source: assetName,
        size: source.length,
        sha256: sha256(source),
        upstream: {
          name: upstreamName,
          version: upstreamVersion,
          source: `https://www.npmjs.com/package/${upstreamName}`,
        },
        chunks,
      },
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function verifyManifest(vendorDir, manifestPath) {
  const manifest = await readManifest(manifestPath);
  for (const assetName of Object.keys(manifest.assets)) {
    await reconstructAsset(vendorDir, assetName, manifestPath);
  }
  return manifest;
}

function usage() {
  console.error(
    "Usage: node vendor-assets.mjs split <source> <vendor-dir> <manifest> [upstream-version] [asset-name] [package-name]\n" +
      "       node vendor-assets.mjs verify <vendor-dir> <manifest>",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , command, ...args] = process.argv;
  try {
    if (command === "split" && args.length >= 3) {
      const assetName = args[4] || "mermaid.min.js";
      await splitAsset(
        resolve(args[0]),
        resolve(args[1]),
        resolve(args[2]),
        assetName,
        args[3] || "unknown",
        args[5] || "mermaid",
      );
      console.log(`Split ${assetName} into locked vendor chunks.`);
    } else if (command === "verify" && args.length === 2) {
      const manifest = await verifyManifest(resolve(args[0]), resolve(args[1]));
      console.log(`Verified ${Object.keys(manifest.assets).length} vendor asset(s).`);
    } else {
      usage();
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
