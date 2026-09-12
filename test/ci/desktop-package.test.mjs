import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const desktop = new URL("../../apps/MarkdStage.Desktop/", import.meta.url);

test("MSIX has one GUI application and a distinct console alias executable", async () => {
  const manifest = await readFile(new URL("src/MarkdStage.App/Package.appxmanifest", desktop), "utf8");
  assert.equal([...manifest.matchAll(/<Application\s/g)].length, 1);
  assert.match(manifest, /<Application\b[^>]*Executable="MarkdStageApp\.exe"/s);
  assert.match(manifest, /<uap5:Extension\b[^>]*Category="windows\.appExecutionAlias"[^>]*Executable="MarkdStageCli\.exe"/s);
  assert.match(manifest, /<uap5:AppExecutionAlias\b[^>]*desktop4:Subsystem="console"/);
  assert.match(manifest, /<uap5:ExecutionAlias\s+Alias="markdstage\.exe"/);
  assert.match(manifest, /<uap:FileType>\.md<\/uap:FileType>/);
  assert.match(manifest, /<uap:FileType>\.markdown<\/uap:FileType>/);
  assert.doesNotMatch(manifest, /unvirtualizedResources|broadFileSystemAccess/);
});

test("v4 release requires accepted Store identity and does not publish desktop archives", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/npm-publish.yml", import.meta.url), "utf8");
  assert.match(workflow, /STORE_ACCEPTED_SHA.*!=.*GITHUB_SHA/);
  assert.match(workflow, /vars\.MARKDSTAGE_PACKAGE_NAME/);
  assert.match(workflow, /vars\.MARKDSTAGE_PACKAGE_PUBLISHER/);
  assert.match(workflow, /vars\.MARKDSTAGE_STORE_URL/);
  assert.match(workflow, /needs: \[validate, desktop\]/);
  assert.doesNotMatch(workflow, /MarkdStage-win-(?:x64|arm64)\.zip/);
  const publication = workflow.split("- name: Create or update GitHub Release")[1].split("- name: Verify published release")[0];
  assert.doesNotMatch(publication, /\.msix/);
});
