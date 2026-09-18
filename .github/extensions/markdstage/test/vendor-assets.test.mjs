import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
