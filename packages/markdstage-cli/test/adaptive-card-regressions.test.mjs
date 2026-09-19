import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../src/cli.mjs";
import { cardMarkdownCases, fatalFallbackCases } from "../../../test/harness/adaptive-card-regressions.mjs";
import { cardFence } from "../../../test/harness/adaptive-cards.mjs";

test("CLI file validation rejects hidden fatal fallback errors and matches the rendered card blocks", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "markdstage-card-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "cards.md");
  const cases = [
    ...cardMarkdownCases().map((entry) => ({
      ...entry, valid: !entry.states.includes("error"), blocks: entry.states.length,
    })),
    ...fatalFallbackCases().map((entry) => ({
      name: entry.name, markdown: cardFence(entry.card), valid: false, blocks: 1, codes: [entry.code],
    })),
  ];
  for (const entry of cases) {
    await writeFile(file, entry.markdown);
    const output = [];
    const exit = await run(["validate", file, "--workspace", root, "--json"], {
      out: (text) => output.push(text), err: (text) => assert.fail(text),
    });
    const report = JSON.parse(output.join("\n"));
    assert.equal(exit, entry.valid ? 0 : 2, entry.name);
    assert.equal(report.valid, entry.valid, entry.name);
    assert.equal(report.adaptiveCards.blocks.length, entry.blocks, entry.name);
    assert.deepEqual(report.adaptiveCards.diagnostics.map((diagnostic) => diagnostic.code), entry.codes, entry.name);
  }
});
