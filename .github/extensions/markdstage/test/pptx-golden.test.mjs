import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildPptxPackage, inspectPptxPackage } from "../runtime/pptx-package.mjs";

const fixtureUrl = new URL("./fixtures/pptx-golden-inputs.json", import.meta.url);
const { cases } = JSON.parse(await readFile(fixtureUrl, "utf8"));

// Frozen by the Buffer implementation before the Windows host-port rewrite.
// Never regenerate these expected packages from the implementation under test.
for (const [name, input] of Object.entries(cases)) {
  test(`${name} PowerPoint matches the pre-port golden package byte for byte`, async () => {
    const model = {
      ...input,
      assets: input.assets.map(({ dataBase64, ...asset }) => ({
        ...asset,
        data: Buffer.from(dataBase64, "base64"),
      })),
    };
    const expected = await readFile(new URL(`./fixtures/pptx-${name}.golden.pptx`, import.meta.url));
    const actual = Buffer.from(buildPptxPackage(model));

    assert.deepEqual(actual, expected);
    assert.deepEqual(Buffer.from(buildPptxPackage(model)), expected, "repeated builds stay deterministic");

    const summary = inspectPptxPackage(actual);
    assert.equal(summary.valid, true);
    assert.equal(summary.title, input.title);
    assert.equal(summary.slideCount, 2);
    assert.equal(summary.notesCount, 1);
    assert.equal(summary.mediaCount, 1);
    assert.deepEqual(summary.dimensions, { widthEmu: 12192000, heightEmu: 6858000 });
    assert.ok(actual.includes(model.assets[0].data), "PNG bytes remain unchanged");
    assert.ok(actual.includes(Buffer.from(name === "image" ? "画像の説明" : "発表者ノート")),
      "non-Latin speaker notes remain UTF-8");
    if (name === "editable") {
      assert.ok(actual.includes(Buffer.from("日本語 &amp; &lt;編集&gt; — Ελληνικά 🚀")),
        "editable text preserves UTF-8 and XML escaping");
    }
  });
}
