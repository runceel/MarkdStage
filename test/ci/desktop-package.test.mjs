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

test("v4 release publishes portable and signed desktop packages independently of Store submission", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/npm-publish.yml", import.meta.url), "utf8");
  const releaseProcess = await readFile(new URL("../../.github/RELEASING.md", import.meta.url), "utf8");
  const publishScript = await readFile(new URL("scripts/Publish.ps1", desktop), "utf8");
  assert.doesNotMatch(workflow, /MARKDSTAGE_STORE_ACCEPTED_SHA|MARKDSTAGE_STORE_URL/);
  assert.doesNotMatch(workflow, /vars\.MARKDSTAGE_PACKAGE_(?:NAME|PUBLISHER)/);
  assert.match(workflow, /Verify successful CI for release commit/);
  assert.match(workflow, /api\.github\.com\/repos\/\$\{GITHUB_REPOSITORY\}\/actions\/workflows\/ci\.yml\/runs\?head_sha=\$\{GITHUB_SHA\}&status=success&event=push&branch=main/);
  assert.doesNotMatch(workflow, /successful_runs=\$\(gh api/);
  assert.doesNotMatch(workflow, /- name: Complete test suite/);
  assert.match(workflow, /Read package identity/);
  assert.match(workflow, /Package\.appxmanifest/);
  assert.match(workflow, /secrets\.MARKDSTAGE_SIGNING_CERTIFICATE_BASE64/);
  assert.match(workflow, /secrets\.MARKDSTAGE_SIGNING_CERTIFICATE_PASSWORD/);
  assert.match(workflow, /winget install --id Microsoft\.WinAppCli --version 0\.6\.1/);
  assert.match(workflow, /Verify release package signatures/);
  assert.match(workflow, /needs: \[validate, desktop\]/);
  assert.doesNotMatch(publishScript, /Archive format is only supported for pre-v4 releases/);
  const publication = workflow.split("- name: Create or update GitHub Release")[1].split("- name: Verify published release")[0];
  assert.match(publication, /MarkdStage-win-x64\.zip/);
  assert.match(publication, /MarkdStage-win-arm64\.zip/);
  assert.match(publication, /MarkdStage-win-x64\.msix/);
  assert.match(publication, /MarkdStage-win-arm64\.msix/);
  assert.match(publication, /MarkdStage\.cer/);
  const postRelease = releaseProcess.split("## Post-release verification")[1];
  assert.match(postRelease, /final release step/);
  assert.match(postRelease, /CreateStorePackage\.ps1 -Version <major\.minor\.patch\.0>/);
  assert.match(postRelease, /MarkdStage-Store\.msixupload\.sha256/);
  assert.match(postRelease, /does not submit it to Partner Center/);
});
