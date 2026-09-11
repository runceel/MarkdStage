import assert from "node:assert/strict";
import test from "node:test";
import {
  ImageSourceError,
  MAX_IMAGE_BYTES,
  MAX_TOTAL_IMAGE_BYTES,
  checkImageBytes,
  decodePercentImageData,
  inspectImageSource,
} from "../renderer/image-source.mjs";
import { createScene, SceneGraphError, validateScene } from "../renderer/scene-graph.mjs";
import { MAX_PPTX_ASSET_BYTES, MAX_PPTX_TOTAL_ASSET_BYTES } from "../runtime/output.mjs";

const dataUrl = (data, mime = "image/png") => `data:${mime};base64,${data.toString("base64")}`;
const imageScene = (src) => createScene({
  source: { kind: "architecture", path: "architecture[0]" }, width: 100, height: 100,
  nodes: [{
    kind: "image", sourcePath: "elements[0].icon", z: 0,
    bounds: { x: 0, y: 0, width: 100, height: 100 }, src, alt: "Icon", fit: "fill",
  }],
});

test("image source limits are shared with PowerPoint asset preparation", () => {
  assert.equal(MAX_IMAGE_BYTES, MAX_PPTX_ASSET_BYTES);
  assert.equal(MAX_TOTAL_IMAGE_BYTES, MAX_PPTX_TOTAL_ASSET_BYTES);
  assert.doesNotThrow(() => checkImageBytes(MAX_IMAGE_BYTES, "slide 2 image 3",
    MAX_TOTAL_IMAGE_BYTES - MAX_IMAGE_BYTES));
  assert.throws(() => checkImageBytes(MAX_IMAGE_BYTES, "slide 2 image 3",
    MAX_TOTAL_IMAGE_BYTES - MAX_IMAGE_BYTES + 1), /slide 2 image 3: image assets total.*100 MiB/);
});

test("valid embedded image sources bypass only the generic string ceiling", () => {
  const source = dataUrl(Buffer.alloc(8192, 42));
  assert.ok(source.length > 8192);
  assert.equal(inspectImageSource(source).byteLength, 8192);
  assert.doesNotThrow(() => validateScene(imageScene(source)));
  assert.equal(inspectImageSource("a".repeat(8192)), null);
  assert.throws(() => validateScene(imageScene("a".repeat(8193))), SceneGraphError);
  const scene = imageScene(source);
  scene.nodes[0].alt = "a".repeat(8193);
  assert.throws(() => validateScene(scene), /alt exceeds 8192 characters/);
});

test("base64 limits use exact decoded sizes, including the padded boundary", () => {
  assert.equal(inspectImageSource(dataUrl(Buffer.alloc(MAX_IMAGE_BYTES))).byteLength, MAX_IMAGE_BYTES);
  assert.throws(() => inspectImageSource(dataUrl(Buffer.alloc(MAX_IMAGE_BYTES + 1)), "slide 7 image 2"),
    /slide 7 image 2: image is 10485761 bytes.*limit is 10 MiB/);
  for (const mime of ["image/png", "image/jpeg", "image/gif", "image/svg+xml"]) {
    assert.equal(inspectImageSource(dataUrl(Buffer.from("ab"), mime)).contentType, mime);
  }
  assert.equal(inspectImageSource("DATA:IMAGE/PNG;base64,YWI").byteLength, 2);
});

test("percent data uses actual UTF-8 or binary bytes and preserves encoded SVG text", () => {
  const text = '<svg xmlns="http://www.w3.org/2000/svg"><text>\u65e5\u672c\u8a9e \u{1f600}</text></svg>';
  for (const payload of [text, encodeURIComponent(text)]) {
    const image = inspectImageSource(`data:image/svg+xml;charset=utf-8,${payload}`);
    assert.equal(image.byteLength, Buffer.byteLength(text));
    assert.equal(Buffer.from(decodePercentImageData(image)).toString("utf8"), text);
  }
  const binary = inspectImageSource("data:image/png,%89PNG%0D%0A%1A%0A");
  assert.deepEqual(Buffer.from(decodePercentImageData(binary)),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(inspectImageSource(`data:image/svg+xml,${"a".repeat(MAX_IMAGE_BYTES)}`).byteLength, MAX_IMAGE_BYTES);
  assert.throws(() => inspectImageSource(`data:image/svg+xml,${"a".repeat(MAX_IMAGE_BYTES + 1)}`),
    /10485761 bytes.*10 MiB/);
});

test("invalid data images are rejected with bounded contextual errors, not payloads", () => {
  const invalid = [
    "data:image/png;base64,!", "data:image/png;base64,A",
    "data:image/png;base64,AA=A", "data:image/png;base64,AA===",
    "data:image/png;base64,AAAA=", "data:image/png;base64,AA-_",
    "data:image/png;base64,", "data:image/png;base64",
    "data:image/png;base64;base64,AAAA", "data:image/png;gzip,AAAA",
    "data:text/html;base64,AAAA", "data:image/webp;base64,AAAA",
    "data:image/svg+xml,%GG", "data:image/svg+xml,%0", "data:image/svg+xml,%",
    "data:image/svg+xml,\ud800", "data:image/svg+xml,\udc00",
    `data:image/png;${"a".repeat(256)},AAAA`,
    `data:image/png;base64,${"A".repeat(MAX_IMAGE_BYTES * 3 + 257)}`,
  ];
  for (const source of invalid) {
    assert.throws(() => inspectImageSource(source, "slide 4 image 2"), (error) => {
      assert.ok(error instanceof ImageSourceError);
      assert.match(error.message, /^slide 4 image 2:/);
      assert.ok(error.message.length < 200);
      assert.ok(!error.message.includes(source));
      return true;
    });
  }
  assert.throws(() => validateScene(imageScene(invalid[0])), (error) => {
    assert.ok(error instanceof SceneGraphError);
    assert.match(error.message, /scene.nodes\[0\].src \(elements\[0\].icon\):.*invalid base64/);
    return true;
  });
});
