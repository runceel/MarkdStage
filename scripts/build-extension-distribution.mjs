import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { reconstructAsset } from "../.github/extensions/markdstage/scripts/vendor-assets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, ".github", "extensions", "markdstage");
const distribution = join(root, ".github", "markdstage-dist");
const aggregateBudget = 4_500_000;
const fileBudget = 1_000_000;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const chunkName = (assetName, index) => `${assetName}.gz.part-${String(index + 1).padStart(4, "0")}`;

async function collectFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await collectFiles(join(directory, entry.name), path)));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

async function compressVendorAssets(target) {
  const vendorDir = join(target, "vendor");
  const manifestPath = join(vendorDir, "vendor-assets.lock.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const [assetName, asset] of Object.entries(manifest.assets)) {
    const bytes = await reconstructAsset(vendorDir, assetName, manifestPath);
    const compressed = gzipSync(bytes, { level: 9, mtime: 0 });
    // Avoid a host-specific gzip OS marker in the committed distribution.
    compressed[9] = 0xff;
    for (const chunk of asset.chunks) await rm(join(vendorDir, chunk.file));

    const chunks = [];
    for (let offset = 0, index = 0; offset < compressed.length; offset += manifest.chunkSize, index += 1) {
      const chunk = compressed.subarray(offset, Math.min(offset + manifest.chunkSize, compressed.length));
      const file = chunkName(assetName, index);
      await writeFile(join(vendorDir, file), chunk);
      chunks.push({ index: index + 1, file, size: chunk.length, sha256: hash(chunk) });
    }
    manifest.assets[assetName] = {
      ...asset,
      encoding: "gzip",
      storedSize: compressed.length,
      storedSha256: hash(compressed),
      chunks,
    };
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function generate(target) {
  await rm(target, { recursive: true, force: true });
  await cp(source, target, { recursive: true });
  for (const name of ["test", "test-results", "playwright-report", "node_modules"]) {
    await rm(join(target, name), { recursive: true, force: true });
  }
  for (const name of ["package.json", "package-lock.json"]) {
    await rm(join(target, name), { force: true });
  }
  await compressVendorAssets(target);
}

async function verifyRuntimeAssets(target) {
  const manifestPath = join(target, "vendor", "vendor-assets.lock.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const [name, asset] of Object.entries(manifest.assets)) {
    if (asset.encoding !== "gzip" || !asset.storedSize || !asset.storedSha256) {
      throw new Error(`Distribution vendor asset is not gzip-encoded with integrity metadata: ${name}`);
    }
    await reconstructAsset(join(target, "vendor"), name, manifestPath);
  }
}

async function reportAndEnforceBudget(target) {
  const files = await collectFiles(target);
  const sizes = await Promise.all(files.map(async (path) => ({
    path,
    size: (await stat(join(target, ...path.split("/")))).size,
  })));
  const total = sizes.reduce((sum, file) => sum + file.size, 0);
  console.log(`Extension distribution: ${total.toLocaleString("en-US")} bytes across ${files.length} files`);
  console.log("Largest files (actual bytes):");
  for (const file of sizes.sort((a, b) => b.size - a.size).slice(0, 10)) {
    console.log(`  ${file.size.toLocaleString("en-US")}  ${file.path}`);
  }
  const oversized = sizes.filter((file) => file.size >= fileBudget);
  if (oversized.length > 0) {
    throw new Error(`Distribution files must be smaller than ${fileBudget} bytes: ${
      oversized.map((file) => file.path).join(", ")
    }`);
  }
  if (total >= aggregateBudget) {
    throw new Error(`Distribution must stay below ${aggregateBudget} bytes; got ${total}`);
  }
}

async function compareWithGenerated(target) {
  const expected = await collectFiles(target);
  const actual = await collectFiles(distribution);
  const problems = [];
  for (const path of expected) {
    if (!actual.includes(path)) {
      problems.push(`missing: ${path}`);
      continue;
    }
    const [expectedBytes, actualBytes] = await Promise.all([
      readFile(join(target, ...path.split("/"))),
      readFile(join(distribution, ...path.split("/"))),
    ]);
    if (!expectedBytes.equals(actualBytes)) problems.push(`out of date: ${path}`);
  }
  for (const path of actual) {
    if (!expected.includes(path)) problems.push(`unexpected: ${path}`);
  }
  if (problems.length > 0) {
    throw new Error(
      `Generated Extension distribution is stale (${relative(root, distribution)}):\n` +
        `${problems.map((problem) => `  ${problem}`).join("\n")}\nRun: npm run extension:sync`,
    );
  }
}

const check = process.argv.includes("--check");
const target = check
  ? await mkdtemp(join(tmpdir(), "markdstage-extension-"))
  : distribution;
try {
  await generate(target);
  const required = [
    "copilot-extension.json",
    "extension.mjs",
    "README.md",
    "THIRD-PARTY-NOTICES.md",
    "markdstage-guide.mjs",
    "schema/architecture-v1.schema.json",
    "schema/theme-v1.json",
  ];
  for (const path of required) {
    if (!(await stat(join(target, ...path.split("/")))).isFile()) {
      throw new Error(`Required Extension distribution file is missing: ${path}`);
    }
  }
  await verifyRuntimeAssets(target);
  await reportAndEnforceBudget(target);
  if (check) {
    await compareWithGenerated(target);
    console.log(`Generated Extension distribution is current (${relative(root, distribution)}).`);
  } else {
    console.log(`Generated ${relative(root, distribution)} from ${relative(root, source)}.`);
  }
} finally {
  if (check) await rm(target, { recursive: true, force: true });
}
