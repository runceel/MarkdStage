import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const executable = process.env.MARKDSTAGE_NATIVE_CLI;
assert.ok(executable, "Set MARKDSTAGE_NATIVE_CLI to the built CLI executable or installed execution alias.");
assert.equal(process.platform, "win32", "Native CLI tests require Windows, WebView2, and an installed Chromium browser.");
const workspace = mkdtempSync(join(tmpdir(), "markdstage-native-cli-"));
writeFileSync(join(workspace, "deck.md"), "# Native CLI regression\n\nFirst page.\n\n---\n\n# Second page\n\n- Native output\n- Browser round trip\n");
after(() => rmSync(workspace, { recursive: true, force: true }));

function run(...args) {
  const result = spawnSync(executable, [...args, "deck.md", "--workspace", workspace, "--json"], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${args.join(" ")} failed: ${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  return report;
}

test("inspect completes a native browser round trip", () => {
  const report = run("inspect", "--slide", "1");
  assert.equal(report.inspected, 1);
  assert.equal(report.width, 1280);
  assert.equal(report.height, 720);
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
