import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { buildPptxPackage, inspectPptxPackage } from "../runtime/pptx-package.mjs";

const PNG = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
]);

function model(data = PNG) {
  return {
    title: "日本語 & Ελληνικά 🚀",
    assets: [{ id: "png", data }],
    slides: [
      { backgroundAssetId: "png", notes: "発表者ノート 🌍", elements: [] },
      { elements: [] },
    ],
  };
}

function viewsOf(bytes) {
  assert.equal(bytes.byteLength % 2, 0);
  const padded = new Uint8Array(bytes.byteLength + 32).fill(0xff);
  padded.set(bytes, 16);
  return [
    ["Uint8Array", bytes],
    ["ArrayBuffer", bytes.slice().buffer],
    ["sliced Uint8Array", padded.subarray(16, 16 + bytes.byteLength)],
    ["sliced Buffer", Buffer.from(padded.buffer, 16, bytes.byteLength)],
    ["sliced DataView", new DataView(padded.buffer, 16, bytes.byteLength)],
    ["sliced Uint16Array", new Uint16Array(padded.buffer, 16, bytes.byteLength / 2)],
  ];
}

test("PNG assets use the raw bytes of ArrayBuffers and offset views, including Buffer", () => {
  const expected = buildPptxPackage(model());
  assert.equal(Object.getPrototypeOf(expected), Uint8Array.prototype);
  for (const [name, data] of viewsOf(PNG)) {
    const bytes = buildPptxPackage(model(data));
    assert.deepEqual(bytes, expected, name);
    assert.equal(inspectPptxPackage(bytes).mediaCount, 1, name);
  }
});

test("inspection respects the exact byteOffset and byteLength of every byte view", () => {
  let input = model();
  let bytes = buildPptxPackage(input);
  if (bytes.byteLength % 2) {
    input = { ...input, title: `${input.title}!` };
    bytes = buildPptxPackage(input);
  }
  const expected = inspectPptxPackage(bytes);
  for (const [name, view] of viewsOf(bytes)) {
    assert.deepEqual(inspectPptxPackage(view), expected, name);
  }
  assert.equal(expected.byteLength, bytes.byteLength);
  assert.equal(expected.title, input.title);
  assert.equal(expected.notesCount, 1);
});

test("byte normalization rejects non-byte inputs without coercion", () => {
  for (const value of [undefined, null, 42, "ZIP", [], {}, { buffer: PNG.buffer }]) {
    assert.throws(() => inspectPptxPackage(value), {
      name: "TypeError",
      message: /PowerPoint package must be an ArrayBuffer or typed array view/,
    });
    assert.throws(() => buildPptxPackage({ ...model(), assets: [{ id: "png", data: value }] }), {
      name: "TypeError",
      message: /Invalid PowerPoint model: assets\[0\]\.data must be an ArrayBuffer or typed array view/,
    });
  }
});

test("inspection rejects corrupted stored ZIP records through bounded offset views", () => {
  const original = buildPptxPackage(model());
  const view = new DataView(original.buffer, original.byteOffset, original.byteLength);
  const eocd = original.byteLength - 22;
  const central = view.getUint32(eocd + 16, true);
  const firstData = 30 + view.getUint16(26, true) + view.getUint16(28, true);
  const cases = [
    ["EOCD signature", (bytes) => { bytes[eocd] ^= 1; }, /EOCD record is missing/],
    ["EOCD comment length", (_, data) => data.setUint16(eocd + 20, 1, true), /EOCD length is inconsistent/],
    ["central offset", (_, data) => data.setUint32(eocd + 16, 0xffffffff, true), /central directory is inconsistent/],
    ["central size", (_, data) => data.setUint32(eocd + 12, 0, true), /central directory is inconsistent/],
    ["central signature", (bytes) => { bytes[central] ^= 1; }, /central directory entry is missing/],
    ["central count", (_, data) => data.setUint16(eocd + 10, 0, true), /central directory size is inconsistent/],
    ["compression", (_, data) => data.setUint16(central + 10, 8, true), /is not stored/],
    ["compressed size", (_, data) => data.setUint32(central + 20, 0, true), /is not stored/],
    ["local offset", (_, data) => data.setUint32(central + 42, 0xffffffff, true), /local header .* is missing/],
    ["local signature", (bytes) => { bytes[0] ^= 1; }, /local header .* is missing/],
    ["local name", (bytes) => { bytes[30] ^= 1; }, /local data .* is inconsistent/],
    ["local extra length", (_, data) => data.setUint16(28, 0xffff, true), /local data .* is inconsistent/],
    ["data CRC", (bytes) => { bytes[firstData] ^= 1; }, /local data .* is inconsistent/],
    ["central CRC", (_, data) => data.setUint32(central + 16, 0, true), /local data .* is inconsistent/],
  ];
  for (const [name, corrupt, error] of cases) {
    const padded = new Uint8Array(original.byteLength + 32).fill(0xff);
    padded.set(original, 16);
    const bytes = padded.subarray(16, 16 + original.byteLength);
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    corrupt(bytes, data);
    assert.throws(() => inspectPptxPackage(data), error, name);
  }
  for (const length of [0, 1, 21, original.byteLength - 1]) {
    assert.throws(() => inspectPptxPackage(original.subarray(0, length)), /Invalid ZIP:/);
  }
});

test("the package module imports, builds golden bytes, and inspects without global Buffer", () => {
  const moduleUrl = new URL("../runtime/pptx-package.mjs", import.meta.url).href;
  const fixturesUrl = new URL("./fixtures/", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import assert from "node:assert/strict";
    import { readFile } from "node:fs/promises";
    globalThis.Buffer = undefined;
    const { buildPptxPackage, inspectPptxPackage } = await import(${JSON.stringify(moduleUrl)});
    const { cases } = JSON.parse(await readFile(new URL("pptx-golden-inputs.json", ${JSON.stringify(fixturesUrl)}), "utf8"));
    for (const [name, input] of Object.entries(cases)) {
      const model = { ...input, assets: input.assets.map(({ dataBase64, ...asset }) => ({
        ...asset, data: Uint8Array.from(atob(dataBase64), (character) => character.charCodeAt(0)),
      })) };
      const actual = buildPptxPackage(model);
      const expected = await readFile(new URL("pptx-" + name + ".golden.pptx", ${JSON.stringify(fixturesUrl)}));
      assert.equal(Object.getPrototypeOf(actual), Uint8Array.prototype);
      assert.deepEqual(actual, new Uint8Array(expected));
      assert.equal(inspectPptxPackage(actual).title, input.title);
      assert.equal(inspectPptxPackage(actual).notesCount, 1);
    }
  `], { encoding: "utf8", timeout: 30_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
