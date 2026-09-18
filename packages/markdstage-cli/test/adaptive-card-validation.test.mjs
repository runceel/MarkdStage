import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.mjs";
import { EXIT_DECK, EXIT_OK } from "../src/exit.mjs";

const card = (body, version = "1.5") => JSON.stringify({ type: "AdaptiveCard", version, body });
const fence = (source) => `\`\`\`adaptive-card\n${source}\n\`\`\``;

test("CLI validates cards without browser or SDK work and preserves locations in JSON and text", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "markdstage-card-validation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "cards.md");
  await writeFile(file, [
    "---\ndeck: Card validation\n---", "## Card validation",
    fence(card([{ type: "TextBlock", text: 42 }])),
    fence(card([], "1.6")),
    fence(card([{ type: "Other", fallback: { type: "TextBlock", text: "Safe fallback" } }])),
  ].join("\n\n"));
  for (const json of [true, false]) {
    const output = [];
    const code = await run(["validate", file, "--workspace", root, ...(json ? ["--json"] : [])], {
      out: (text) => output.push(text), err: (text) => assert.fail(text),
    });
    assert.equal(code, EXIT_DECK);
    const text = output.join("\n");
    if (json) {
      const report = JSON.parse(text);
      assert.equal(report.valid, false);
      assert.equal(report.diagnostics.filter((entry) => entry.category === "adaptive-card").length, 4);
      assert.ok(report.diagnostics.every((entry) => entry.file === file && entry.impact === "content"));
      assert.equal(report.adaptiveCards.resourceValidation, "deferred-to-browser");
    } else {
      assert.match(text, /adaptive-card\[0\]\$\.body\[0\]\.text/);
      assert.match(text, /unsupported-version/);
      assert.match(text, /fallback-substituted/);
      assert.doesNotMatch(text, /OK: the deck is valid/);
    }
  }
  await writeFile(file, fence(card([{ type: "Image", url: "https://blocked.example/image.png" }])));
  const output = [];
  assert.equal(await run(["validate", file, "--workspace", root, "--json"], {
    out: (text) => output.push(text), err: (text) => assert.fail(text),
  }), EXIT_OK);
  const report = JSON.parse(output.join("\n"));
  assert.equal(report.valid, true, "a blocked image is a diagnosed placeholder, not a malformed card");
  assert.equal(report.diagnostics[0].code, "blocked-image");
  assert.equal(report.diagnostics[0].severity, "warning");
});
