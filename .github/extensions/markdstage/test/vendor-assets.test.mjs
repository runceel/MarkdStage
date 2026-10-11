import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { sendChunkedVendorAsset } from "../hosts/node/static-files.mjs";
import { reconstructAsset, splitAsset } from "../scripts/vendor-assets.mjs";

test("reconstructs ordered chunks and rejects tampering", async () => {
  const root = await mkdtemp(join(tmpdir(), "presentation-vendor-test-"));
  const vendorDir = join(root, "vendor");
  const manifestPath = join(vendorDir, "vendor-assets.lock.json");
  const source = Buffer.from("first chunk\nsecond chunk\n");
  await mkdir(vendorDir, { recursive: true });
  await writeFile(join(vendorDir, "mermaid.min.js.part-0001"), source.subarray(0, 12));
  await writeFile(join(vendorDir, "mermaid.min.js.part-0002"), source.subarray(12));
  const { createHash } = await import("node:crypto");
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      chunkSize: 1024,
      assets: {
        "mermaid.min.js": {
          size: source.length,
          sha256: digest(source),
          chunks: [
            { index: 1, file: "mermaid.min.js.part-0001", size: 12, sha256: digest(source.subarray(0, 12)) },
            { index: 2, file: "mermaid.min.js.part-0002", size: source.length - 12, sha256: digest(source.subarray(12)) },
          ],
        },
      },
    }),
  );
  assert.deepEqual(await reconstructAsset(vendorDir, "mermaid.min.js", manifestPath), source);
  await writeFile(join(vendorDir, "mermaid.min.js.part-0002"), Buffer.from("tampered"));
  await assert.rejects(
    reconstructAsset(vendorDir, "mermaid.min.js", manifestPath),
    /Integrity check failed/,
  );
});

test("reconstructs gzip assets and rejects corrupt or truncated stored bytes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "markdstage-vendor-gzip-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vendorDir = join(root, "vendor");
  const manifestPath = join(vendorDir, "vendor-assets.lock.json");
  const file = "mermaid.min.js.gz.part-0001";
  const source = Buffer.from("bundled mermaid source\n".repeat(50));
  const stored = gzipSync(source, { level: 9 });
  const { createHash } = await import("node:crypto");
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  await mkdir(vendorDir, { recursive: true });
  await writeFile(join(vendorDir, file), stored);
  const manifest = {
    schemaVersion: 1,
    chunkSize: 1024,
    assets: {
      "mermaid.min.js": {
        size: source.length,
        sha256: digest(source),
        encoding: "gzip",
        storedSize: stored.length,
        storedSha256: digest(stored),
        chunks: [{ index: 1, file, size: stored.length, sha256: digest(stored) }],
      },
    },
  };
  const saveManifest = () => writeFile(manifestPath, JSON.stringify(manifest));
  await saveManifest();
  assert.deepEqual(await reconstructAsset(vendorDir, "mermaid.min.js", manifestPath), source);

  const corrupted = Buffer.from(stored);
  corrupted[corrupted.length - 1] ^= 0xff;
  await writeFile(join(vendorDir, file), corrupted);
  manifest.assets["mermaid.min.js"].storedSha256 = digest(corrupted);
  manifest.assets["mermaid.min.js"].chunks[0].sha256 = digest(corrupted);
  await saveManifest();
  await assert.rejects(
    reconstructAsset(vendorDir, "mermaid.min.js", manifestPath),
    /Unable to decompress vendor asset/,
  );

  const wrongSource = Buffer.from("unexpected but valid gzip source");
  const wrongStored = gzipSync(wrongSource, { level: 9 });
  await writeFile(join(vendorDir, file), wrongStored);
  manifest.assets["mermaid.min.js"].storedSize = wrongStored.length;
  manifest.assets["mermaid.min.js"].storedSha256 = digest(wrongStored);
  manifest.assets["mermaid.min.js"].chunks[0].size = wrongStored.length;
  manifest.assets["mermaid.min.js"].chunks[0].sha256 = digest(wrongStored);
  await saveManifest();
  await assert.rejects(
    reconstructAsset(vendorDir, "mermaid.min.js", manifestPath),
    /Integrity check failed for reconstructed/,
  );

  const truncated = stored.subarray(0, stored.length - 4);
  await writeFile(join(vendorDir, file), truncated);
  manifest.assets["mermaid.min.js"].storedSize = truncated.length;
  manifest.assets["mermaid.min.js"].storedSha256 = digest(truncated);
  manifest.assets["mermaid.min.js"].chunks[0].size = truncated.length;
  manifest.assets["mermaid.min.js"].chunks[0].sha256 = digest(truncated);
  await saveManifest();
  await assert.rejects(
    reconstructAsset(vendorDir, "mermaid.min.js", manifestPath),
    /Unable to decompress vendor asset/,
  );
});

test("the generated production distribution serves original vendor bytes", async () => {
  const sourceVendor = fileURLToPath(new URL("../vendor/", import.meta.url));
  const distributionVendor = fileURLToPath(new URL("../../../markdstage-dist/vendor/", import.meta.url));
  const sourceManifest = join(sourceVendor, "vendor-assets.lock.json");
  const distributionManifest = join(distributionVendor, "vendor-assets.lock.json");
  const manifest = JSON.parse(await readFile(distributionManifest, "utf8"));
  for (const assetName of Object.keys(manifest.assets)) {
    const response = {
      headers: new Map(),
      setHeader(name, value) { this.headers.set(name, value); },
      end(bytes) { this.body = bytes; },
    };
    await sendChunkedVendorAsset(
      response,
      distributionVendor,
      distributionManifest,
      assetName,
    );
    assert.equal(response.statusCode, 200, assetName);
    assert.equal(response.headers.get("Content-Type"), "text/javascript; charset=utf-8");
    assert.deepEqual(
      response.body,
      await reconstructAsset(sourceVendor, assetName, sourceManifest),
      assetName,
    );
  }
});

test("adding a pinned SDK preserves every existing locked asset", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "markdstage-vendor-add-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vendor = join(root, "vendor"), manifest = join(vendor, "vendor-assets.lock.json");
  const source = join(root, "upstream.js");
  await writeFile(source, "const original = true;");
  await splitAsset(source, vendor, manifest, "mermaid.min.js", "11.15.0");
  const original = JSON.parse(await readFile(manifest, "utf8")).assets["mermaid.min.js"];
  await writeFile(source, "const adaptive = true;");
  await splitAsset(source, vendor, manifest, "adaptivecards.min.js", "3.0.6", "adaptivecards");
  const assets = JSON.parse(await readFile(manifest, "utf8")).assets;
  assert.deepEqual(assets["mermaid.min.js"], original);
  assert.equal(assets["adaptivecards.min.js"].upstream.version, "3.0.6");
  assert.equal(assets["adaptivecards.min.js"].upstream.name, "adaptivecards");
  assert.equal((await reconstructAsset(vendor, "adaptivecards.min.js", manifest)).toString(), "const adaptive = true;");
  await assert.rejects(splitAsset(source, vendor, manifest, "../escape.js", "1"), /simple file/);
});
