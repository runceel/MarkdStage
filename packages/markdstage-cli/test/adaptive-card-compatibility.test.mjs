import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readGuide, formatExportReport } from "../src/runtime.mjs";
import { adaptiveCardCompatibilityCases, compatibilityDiagnostics } from "../../../test/harness/adaptive-card-compatibility.mjs";
import { formatExportReport as canonicalFormat } from "../../../.github/extensions/markdstage/runtime/export-report.mjs";
import { run } from "../src/cli.mjs";

test("generated npm shared runtime retains official corpus diagnostics and deferred browser work", async (t) => {
  const cases = await adaptiveCardCompatibilityCases();
  const workspace = fileURLToPath(new URL(`../../../test-results/phase3-cli-${crypto.randomUUID()}/`, import.meta.url));
  await mkdir(workspace, { recursive: true });
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const file = join(workspace, "compatibility.md");
  await writeFile(file, cases.map((entry) => entry.markdown).join("\n\n---\n\n"));
  const output = [];
  const exit = await run(["validate", file, "--workspace", workspace, "--json"],
    { out: (line) => output.push(line), err: (line) => assert.fail(line) });
  assert.equal(exit, 2);
  const report = JSON.parse(output.join("\n"));
  assert.equal(report.valid, false);
  assert.equal(report.complete, false);
  assert.equal(report.truncated, true);
  assert.equal(report.adaptiveCards.resourceValidation, "deferred-to-browser");
  for (const [index, entry] of cases.entries()) {
    const diagnostics = report.adaptiveCards.diagnostics.filter((item) => item.slideIndex === index);
    assert.deepEqual(compatibilityDiagnostics(diagnostics), entry.static.diagnostics, entry.name);
    for (const diagnostic of diagnostics) {
      assert.equal(diagnostic.sourcePath, `adaptive-card[0]${diagnostic.path}`);
      assert.equal(diagnostic.page, index + 1);
      assert.equal(diagnostic.file, file);
    }
  }
});

test("npm guide and text formatter are the generated canonical capability/report contract", async () => {
  assert.equal(await readGuide("adaptive-cards"),
    await readFile(new URL("../../../.github/extensions/markdstage/docs/adaptive-cards.md", import.meta.url), "utf8"));
  assert.match(await readGuide("adaptive-cards"), /Versioned support matrix/);
  assert.match(await readGuide("adaptive-cards"), /static-property-ignored/);
  const report = { format: "pptx", total: 1, bytes: 100, path: "cards.pptx", theme: "dark",
    adaptiveCards: [{ page: 1, blockIndex: 0, complete: false, resourceValidation: "not-run",
      diagnostics: [{ severity: "error", code: "unsupported-version", sourcePath: "adaptive-card[0]$.version", message: "Unsupported.", impact: "content" }] }] };
  assert.equal(formatExportReport(report), canonicalFormat(report));
  assert.match(formatExportReport(report), /unsupported-version; content impact/);
});
