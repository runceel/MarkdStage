import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readGuide } from "../../../.github/extensions/markdstage/markdstage-guide.mjs";
import { adaptiveCardCompatibilityCases, compatibilityDiagnostics, CARD_COMPATIBILITY_DIRECTORY } from "../../../test/harness/adaptive-card-compatibility.mjs";
import { CARD_FIXTURE_DIRECTORY } from "../../../test/harness/adaptive-cards.mjs";

const executable = process.env.MARKDSTAGE_NATIVE_CLI;
assert.ok(executable, "Set MARKDSTAGE_NATIVE_CLI to the built CLI executable or installed execution alias.");
assert.equal(process.platform, "win32", "Native CLI tests require Windows, WebView2, and an installed Chromium browser.");
const resultsRoot = fileURLToPath(new URL("../test-results/", import.meta.url));
mkdirSync(resultsRoot, { recursive: true });
const workspace = mkdtempSync(join(resultsRoot, "native-cli-"));
writeFileSync(join(workspace, "deck.md"), "# Native CLI regression\n\nFirst page.\n\n---\n\n# Second page\n\n- Native output\n- Browser round trip\n");
for (const name of [
  "valid.md", "invalid-property.md", "unsupported-version.md", "blocked-image.md",
  "quoted-invalid-property.md", "list-unsupported-version.md", "unclosed.md",
])
  copyFileSync(new URL(`./fixtures/adaptive-cards/${name}`, import.meta.url), join(workspace, name));
after(() => rmSync(workspace, { recursive: true, force: true }));

function invoke(args, expectedStatus = 0, { json = true } = {}) {
  const result = spawnSync(executable, [...args, ...(json ? ["--json"] : [])], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, expectedStatus, `${args.join(" ")} failed: ${result.stdout}\n${result.stderr}`);
  return json ? JSON.parse(result.stdout) : result.stdout;
}

function run(...args) {
  const report = invoke([...args, "deck.md", "--workspace", workspace]);
  assert.equal(report.ok, true);
  return report;
}

test("native guide includes the canonical Adaptive Cards topic without a browser", async () => {
  const report = invoke(["guide", "adaptive-cards"]);
  assert.equal(report.topic, "adaptive-cards");
  assert.equal(report.content, await readGuide("adaptive-cards"));
});

test("native validation accepts a supported schema 1.5 card", () => {
  const report = invoke(["validate", "valid.md", "--workspace", workspace]);
  assert.equal(report.ok, true);
  assert.equal(report.valid, true);
  assert.equal(report.complete, true);
  assert.deepEqual(report.diagnostics.filter((item) => item.category === "adaptive-card"), []);
});

for (const [file, code, path] of [
  ["invalid-property.md", "invalid-property", "$.body[0].text"],
  ["unsupported-version.md", "unsupported-version", "$.version"],
  ["quoted-invalid-property.md", "invalid-property", "$.body[0].text"],
  ["list-unsupported-version.md", "unsupported-version", "$.version"],
  ["unclosed.md", "unclosed-adaptive-card-fence", "$"],
]) {
  test(`native validation reports ${code} for ${file} without layout or an external browser`, () => {
    const report = invoke(["validate", file, "--workspace", workspace], 2);
    assert.equal(report.ok, false);
    assert.equal(report.valid, false);
    assert.equal(report.complete, true);
    const diagnostics = report.diagnostics.filter((item) => item.category === "adaptive-card");
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, code);
    assert.equal(diagnostics[0].path, path);
    assert.equal(diagnostics[0].file, file);
    assert.equal(diagnostics[0].sourcePath, `adaptive-card[0]${path}`);
    assert.equal(diagnostics[0].impact, "content");
    assert.equal(diagnostics[0].severity, "error");
  });
}

test("native validation text preserves card warning JSONPaths and content impact", () => {
  const text = invoke(["validate", "blocked-image.md", "--workspace", workspace], 0, { json: false });
  assert.match(text, /adaptive-card\[0\]\$\.body\[0\]\.url/);
  const report = JSON.parse(text);
  assert.equal(report.valid, true);
  const diagnostics = report.diagnostics.filter((item) => item.category === "adaptive-card");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "blocked-image");
  assert.equal(diagnostics[0].severity, "warning");
  assert.equal(diagnostics[0].path, "$.body[0].url");
  assert.equal(diagnostics[0].impact, "content");
});

test("inspect completes a native browser round trip", () => {
  const report = run("inspect", "--slide", "1");
  assert.equal(report.inspected, 1);
  assert.equal(report.width, 1280);
  assert.equal(report.height, 720);
});

test("native inspect fails on card content warnings without treating them as clipping", () => {
  for (const failOnIssues of [false, true]) {
    const report = invoke([
      "inspect", "blocked-image.md", "--workspace", workspace,
      ...(failOnIssues ? ["--fail-on-issues"] : []),
    ], failOnIssues ? 5 : 0);
    assert.equal(report.hasIssues, false);
    assert.equal(report.issueCount, 0);
    assert.equal(report.hasAdaptiveCardIssues, true);
    assert.equal(report.adaptiveCardIssueCount, 1);
    assert.equal(report.slides.length, 1);
    assert.equal(report.slides[0].pdfClipped, false);
    assert.equal(report.slides[0].status, "fits");
    assert.equal(report.slides[0].adaptiveCards.length, 1);
    const card = report.slides[0].adaptiveCards[0];
    assert.equal(card.status, "ready");
    assert.equal(card.diagnostics.length, 1);
    assert.equal(card.diagnostics[0].code, "blocked-image");
    assert.equal(card.diagnostics[0].sourcePath, "adaptive-card[0]$.body[0].url");
    assert.equal(card.diagnostics[0].severity, "warning");
    assert.equal(card.diagnostics[0].impact, "content");
  }
  const text = invoke([
    "inspect", "blocked-image.md", "--workspace", workspace, "--fail-on-issues",
  ], 5, { json: false });
  assert.match(text, /adaptive-card\[0\]\$\.body\[0\]\.url/);
  assert.match(text, /blocked-image/);
  assert.match(text, /"impact": "content"/);
});

test("capture writes a 1280x720 PNG", () => {
  const report = run("capture", "--pages", "1", "--output", "captures");
  assert.equal(report.captured, 1);
  assert.equal(report.files.length, 1);
  const bytes = readFileSync(join(workspace, "captures", "slide-001.png"));
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(bytes.readUInt32BE(16), 1280);
  assert.equal(bytes.readUInt32BE(20), 720);
});

test("PDF export completes and writes the reported document", () => {
  const report = run("export", "--output", "deck.pdf");
  const bytes = readFileSync(join(workspace, "deck.pdf"));
  assert.equal(report.format, "pdf");
  assert.equal(report.bytes, bytes.length);
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  assert.match(bytes.subarray(-1024).toString(), /%%EOF/);
  assert.equal(Object.hasOwn(report, "adaptiveCards"), false);
  assert.equal(Object.hasOwn(report, "adaptiveCardIssueCount"), false);
  assert.equal(Object.hasOwn(report, "adaptiveCardsTruncated"), false);
});

test("PowerPoint export completes and writes the presentation package", () => {
  const report = run("export", "--output", "deck.pptx");
  const bytes = readFileSync(join(workspace, "deck.pptx"));
  assert.equal(report.format, "pptx");
  assert.equal(report.bytes, bytes.length);
  assert.deepEqual(bytes.subarray(0, 4), Buffer.from([80, 75, 3, 4]));
  assert.ok(bytes.includes(Buffer.from("ppt/presentation.xml")));
  assert.ok(bytes.includes(Buffer.from("ppt/slides/slide1.xml")));
});

for (const format of ["pdf", "pptx"]) {
  test(`native ${format.toUpperCase()} export preserves card diagnostics in JSON and text`, () => {
    const output = `card-warning.${format}`;
    const args = ["export", "blocked-image.md", "--workspace", workspace, "--output", output];
    const report = invoke(args);
    assert.equal(report.ok, true);
    assert.equal(report.format, format);
    assert.equal(report.bytes, readFileSync(join(workspace, output)).length);
    const cards = report.adaptiveCards;
    assert.equal(cards.length, 1);
    assert.equal(cards[0].page, 1);
    assert.equal(cards[0].slideIndex, 0);
    assert.equal(cards[0].diagnostics.length, 1);
    assert.equal(cards[0].diagnostics[0].code, "blocked-image");
    assert.equal(cards[0].diagnostics[0].severity, "warning");
    assert.equal(cards[0].diagnostics[0].sourcePath, "adaptive-card[0]$.body[0].url");
    assert.equal(cards[0].diagnostics[0].impact, "content");
    if (format === "pdf") {
      assert.equal(report.adaptiveCardIssueCount, 1);
      assert.equal(report.adaptiveCardsTruncated, false);
    }
    const text = invoke(args, 0, { json: false });
    assert.match(text, /^Exported \d+ slide\(s\) to card-warning\.(?:pdf|pptx)/);
    assert.match(text, /warning slide 1: adaptive-card\[0\]\$\.body\[0\]\.url .* \(blocked-image; content impact\)/);
    if (format === "pptx")
      assert.match(text, /rasterized slide 1: adaptive-card\[0\]\$\.diagnostics \(adaptive-card-diagnostic-note; content impact\)/);
  });
}

  test("actual native CLI preserves official corpus validation/export paths, output modes and incomplete status", async () => {
    const cases = await adaptiveCardCompatibilityCases();
    cpSync(join(CARD_FIXTURE_DIRECTORY, "assets"), join(workspace, "assets"), { recursive: true });
    writeFileSync(join(workspace, "compatibility.md"), cases.map((entry) => entry.markdown).join("\n\n---\n\n"));
    const validated = invoke(["validate", "compatibility.md", "--workspace", workspace], 2);
    assert.equal(validated.complete, false);
    assert.equal(validated.truncated, true);
    assert.equal(validated.adaptiveCards.resourceValidation, "deferred-to-browser");
    for (const [index, entry] of cases.entries()) {
      assert.deepEqual(compatibilityDiagnostics(validated.adaptiveCards.diagnostics.filter((item) => item.slideIndex === index)),
        entry.static.diagnostics, entry.name);
    }
    const expected = JSON.parse(readFileSync(join(CARD_COMPATIBILITY_DIRECTORY, "output-expectations.json"), "utf8"));
    const args = ["export", "compatibility.md", "--workspace", workspace, "--output", "compatibility.pptx"];
    const report = invoke(args);
    assert.equal(report.ok, true);
    assert.equal(report.adaptiveCardsComplete, false);
    assert.equal(report.adaptiveCardsTruncated, true);
    assert.deepEqual(report.adaptiveCardConversionSummary, { nativeObjects: 64, approximated: 23, rasterizedSubtrees: 16 });
    for (const [index, entry] of cases.entries()) {
      const card = report.adaptiveCards[index];
      assert.equal(card.slideIndex, index); assert.equal(card.page, index + 1); assert.equal(card.blockIndex, 0);
      assert.equal(card.complete, entry.static.complete);
      assert.deepEqual(compatibilityDiagnostics(card.diagnostics), entry.browser.diagnostics, entry.name);
      assert.deepEqual(card.conversions.map(({ sourcePath, sourceType, mode, reason, nativeObjects }) =>
        [sourcePath, sourceType, mode, reason, nativeObjects]), expected[entry.name].conversions, entry.name);
      for (const diagnostic of card.diagnostics) assert.equal(diagnostic.sourcePath, `adaptive-card[0]${diagnostic.path}`);
    }
    const text = invoke(args, 0, { json: false });
    assert.match(text, /64 editable native objects, 23 approximated elements, 16 rasterized subtrees/);
    assert.match(text, /Card validation is incomplete/);
    assert.match(text, /unsupported-version; content impact/);
    assert.match(text, /adaptive-card\[0\]\$\.body\[2\]\.fallback/);
    const inspect = invoke(["inspect", "compatibility.md", "--workspace", workspace, "--fail-on-issues"], 5);
    assert.equal(inspect.hasAdaptiveCardIssues, true);
  });

test("native PNG and PowerPoint output render a static Adaptive Card with the pinned SDK", () => {
  const file = join(workspace, "deck.md");
  const original = readFileSync(file, "utf8");
  const card = readFileSync(new URL("../../../test/fixtures/adaptive-cards/typography.json", import.meta.url), "utf8");
  try {
    writeFileSync(file, `## Native Adaptive Card\n\n\`\`\`adaptive-card\n${card}\n\`\`\``);
    const capture = run("capture", "--pages", "1", "--output", "card-captures");
    assert.equal(capture.captured, 1);
    const png = readFileSync(join(workspace, "card-captures", "slide-001.png"));
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(png.readUInt32BE(16), 1280);
    assert.equal(png.readUInt32BE(20), 720);
    const report = run("export", "--output", "card.pptx");
    const cards = report.adaptiveCards;
    assert.equal(cards.length, 1);
    assert.ok(cards[0].nativeObjectCount >= 20);
    assert.equal(cards[0].rasterizedSubtreeCount, 0);
    assert.equal(report.fallbacks.filter((fallback) => fallback.type === "adaptive-card").length, 0);
    const bytes = readFileSync(join(workspace, "card.pptx"));
    assert.equal(report.bytes, bytes.length);
    assert.ok(bytes.includes(Buffer.from("Typed objects, measured geometry")));
    assert.ok(bytes.includes(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  } finally {
    writeFileSync(file, original);
  }
});
