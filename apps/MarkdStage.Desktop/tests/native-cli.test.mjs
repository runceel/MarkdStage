import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readGuide } from "../../../.github/extensions/markdstage/markdstage-guide.mjs";
import { adaptiveCardCompatibilityCases, compatibilityDiagnostics, CARD_COMPATIBILITY_DIRECTORY } from "../../../test/harness/adaptive-card-compatibility.mjs";
import { CARD_FIXTURE_DIRECTORY } from "../../../test/harness/adaptive-cards.mjs";

const executable = process.env.MARKDSTAGE_NATIVE_CLI;
assert.ok(executable, "Set MARKDSTAGE_NATIVE_CLI to the built CLI executable or installed execution alias.");
assert.equal(process.platform, "win32", "Native CLI tests require Windows, WebView2, and an installed Chromium browser.");
const expectedProductVersion = JSON.parse(readFileSync(new URL("../../../packages/markdstage-cli/package.json", import.meta.url), "utf8")).version;
const resultsRoot = fileURLToPath(new URL("../test-results/", import.meta.url));
mkdirSync(resultsRoot, { recursive: true });
const workspace = mkdtempSync(join(resultsRoot, "native-cli-"));
writeFileSync(join(workspace, "deck.md"), "# Native CLI regression\n\nFirst page.\n\n---\n\n# Second page\n\n- Native output\n- Browser round trip\n");
writeFileSync(join(workspace, "architecture.md"), [
  "# Architecture",
  "",
  "```architecture",
  JSON.stringify({
    version: 1,
    elements: [
      { type: "node", id: "n1", x: 80, y: 80, width: 240, height: 120, text: "Host" },
    ],
  }),
  "```",
  "",
].join("\n"));
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

async function readyEvent(operation, extraArgs = []) {
  const child = spawn(executable, [
    operation,
    "deck.md",
    "--workspace",
    workspace,
    "--no-open",
    "--json-lines",
    ...extraArgs,
  ], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  let timeout;
  try {
    const line = await Promise.race([
      new Promise((resolve, reject) => {
        child.stdout.on("data", () => {
          const end = stdout.indexOf("\n");
          if (end >= 0) resolve(stdout.slice(0, end).trimEnd());
        });
        child.once("error", reject);
        child.once("exit", code => reject(new Error(`CLI exited before ready (${code}): ${stdout}\n${stderr}`)));
      }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out waiting for ready event.")), 120_000);
      }),
    ]);
    const event = JSON.parse(line);
    const response = await fetch(event.url);
    const state = await (await fetch(new URL("state", event.url))).json();
    return { event, state, responseStatus: response.status, responseBody: await response.text(), stdout: () => stdout, stderr: () => stderr };
  } finally {
    clearTimeout(timeout);
    child.kill();
    await new Promise(resolve => child.once("exit", resolve));
  }
}

test("native preview and present stream one bounded ready event", async () => {
  for (const [operation, sourceMode, extraArgs] of [
    ["preview", "snapshot", []],
    ["present", "live", ["--watch"]],
  ]) {
    const result = await readyEvent(operation, [
      ...extraArgs,
      "--architecture-editor-target",
      "same",
    ]);
    assert.deepEqual(Object.keys(result.event), [
      "type",
      "url",
      "operation",
      "workspace",
      "sourceMode",
      "version",
    ]);
    assert.equal(result.event.type, "ready");
    assert.equal(result.event.operation, operation);
    assert.equal(result.event.workspace, workspace);
    assert.equal(result.event.sourceMode, sourceMode);
    assert.equal(new URL(result.event.url).searchParams.has("presenter"), operation === "present");
    assert.equal(result.event.version, expectedProductVersion);
    assert.equal(result.responseStatus, 200);
    assert.equal(result.state.architectureDetailedEditTarget, "same");
    assert.equal(result.state.presenterWindowAvailable, true);
    assert.equal(result.state.presenterRunning, false);
    assert.equal(result.state.pdfExportAvailable, true);
    assert.equal(result.state.pptxExportAvailable, true);
    assert.match(result.responseBody, /MarkdStage/);
    assert.equal(result.stdout().trim().split(/\r?\n/).length, 1);
    assert.equal(result.stderr(), "");
  }
});

test("native preview streams a host-targeted Architecture Editor event", async () => {
  const child = spawn(executable, [
    "preview",
    "architecture.md",
    "--workspace",
    workspace,
    "--watch",
    "--no-open",
    "--json-lines",
    "--architecture-editor-target",
    "host",
  ], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const lines = [];
  const waiters = [];
  createInterface({ input: child.stdout }).on("line", line => {
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else lines.push(line);
  });
  const nextLine = () => lines.length
    ? Promise.resolve(lines.shift())
    : new Promise(resolve => waiters.push(resolve));
  try {
    const ready = JSON.parse(await nextLine());
    const state = await (await fetch(new URL("state", ready.url))).json();
    assert.equal(state.architectureDetailedEditTarget, "host");
    const response = await fetch(new URL("architecture-editor/open", ready.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: new URL(ready.url).origin,
      },
      body: JSON.stringify({ index: 0, block: 0 }),
    });
    assert.deepEqual(await response.json(), { ok: true, openedByHost: true });
    const event = JSON.parse(await nextLine());
    assert.equal(event.type, "architecture-editor");
    assert.equal(event.version, expectedProductVersion);
    assert.equal(event.previewUrl, ready.url);
    assert.match(event.url, /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{32}\/architecture-editor\/[a-f0-9]{32}\/$/);
  } finally {
    child.kill();
    if (child.exitCode === null) {
      await new Promise(resolve => child.once("exit", resolve));
    }
  }
});

test("native no-open server exports beside the source and owns one audience window", async () => {
  const child = spawn(executable, ["present", "deck.md", "--workspace", workspace, "--no-open", "--json-lines"], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  const firstLine = new Promise((resolve, reject) => {
    createInterface({ input: child.stdout }).once("line", resolve);
    child.once("exit", code => reject(new Error(`CLI exited before ready (${code}).`)));
  });
  try {
    const ready = JSON.parse(await firstLine);
    const headers = { "content-type": "application/json", origin: new URL(ready.url).origin };
    const post = async (route, body = {}, method = "POST") =>
      (await fetch(new URL(route, ready.url), { method, headers, body: method === "POST" ? JSON.stringify(body) : undefined })).json();
    const state = async () => (await fetch(new URL("state", ready.url))).json();

    const pdf = await post("export");
    assert.equal(pdf.ok, true);
    assert.equal(pdf.path, "deck.pdf");
    assert.equal(readFileSync(join(workspace, "deck.pdf")).subarray(0, 5).toString("latin1"), "%PDF-");
    const pptx = await post("export-pptx", { mermaidImageFallback: false });
    assert.equal(pptx.ok, true);
    assert.equal(pptx.path, "deck.pptx");
    assert.equal(readFileSync(join(workspace, "deck.pptx")).subarray(0, 2).toString("latin1"), "PK");

    assert.deepEqual(await post("present"), { ok: true, alreadyRunning: false });
    assert.equal((await state()).presenterRunning, true);
    assert.deepEqual(await post("present"), { ok: true, alreadyRunning: true });
    assert.deepEqual(await post("present", undefined, "DELETE"), { ok: true });
    assert.equal((await state()).presenterRunning, false);
  } finally {
    child.kill();
    if (child.exitCode === null) await new Promise(resolve => child.once("exit", resolve));
    rmSync(join(workspace, "deck.pdf"), { force: true });
    rmSync(join(workspace, "deck.pptx"), { force: true });
  }
});

test("native json-lines rejects unsupported and ambiguous invocations", () => {
  for (const args of [
    ["validate", "deck.md", "--workspace", workspace, "--json-lines"],
    ["guide", "--json-lines"],
    ["skill", "check", "--json-lines"],
    ["preview", "deck.md", "--workspace", workspace, "--json-lines"],
    ["preview", "deck.md", "--workspace", workspace, "--no-open", "--json", "--json-lines"],
  ]) {
    const result = spawnSync(executable, args, {
      cwd: workspace,
      encoding: "utf8",
      windowsHide: true,
      timeout: 120_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.error, "usage_error");
    assert.equal(result.stderr, "");
  }
});

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
