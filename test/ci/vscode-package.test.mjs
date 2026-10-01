import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function text(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("VS Code extension uses the unified MarkdStage product version", async () => {
  const cli = JSON.parse(await text("../../packages/markdstage-cli/package.json"));
  const extension = JSON.parse(await text("../../packages/markdstage-vscode/package.json"));
  assert.equal(extension.version, cli.version);
});

test("VS Code preview command ships a theme-aware toolbar icon", async () => {
  const extension = JSON.parse(await text("../../packages/markdstage-vscode/package.json"));
  const preview = extension.contributes.commands.find(({ command }) => command === "markdstage.preview");
  assert.deepEqual(preview.icon, {
    light: "media/preview-light.svg",
    dark: "media/preview-dark.svg",
  });
  for (const path of [preview.icon.light, preview.icon.dark]) {
    assert.match(await text(`../../packages/markdstage-vscode/${path}`), /<svg/);
  }
});

test("CI builds and packages the VS Code extension independently", async () => {
  const workflow = await text("../../.github/workflows/ci.yml");
  assert.match(workflow, /^  vscode:$/m);
  assert.match(workflow, /working-directory: packages\/markdstage-vscode/);
  assert.match(workflow, /run: npm test/);
  assert.match(workflow, /run: npm run build/);
  assert.match(workflow, /run: npm run package/);
  assert.match(workflow, /check_job "VS Code extension"/);
});

test("release publishes a versioned VSIX and checksum", async () => {
  const workflow = await text("../../.github/workflows/npm-publish.yml");
  assert.match(workflow, /Package VS Code extension/);
  assert.match(workflow, /markdstage-vscode-\$\{version\}\.vsix/);
  assert.match(workflow, /markdstage-vscode-\$\{version\}\.vsix\.sha256/);
  assert.match(workflow, /sha256sum -c markdstage-vscode-\*\.vsix\.sha256/);
  assert.match(workflow, /"markdstage-vscode-\$\{version\}\.vsix"/);
});
