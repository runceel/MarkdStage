import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../../.github/workflows/npm-publish.yml", import.meta.url),
  "utf8",
);

test("release recovery dispatch uses a helper tag and immutable product tag", () => {
  assert.match(workflow, /workflow_dispatch:\s+inputs:\s+product_tag:[\s\S]*?required:\s*true/);
  assert.match(workflow, /workflow_call:\s+inputs:\s+product_tag:[\s\S]*?required:\s*true/);
  assert.match(workflow, /- "!v\*-recovery"/);
  assert.match(workflow, /\$\{\{ inputs\.product_tag \|\| github\.ref_name \}\}/);
  assert.match(workflow, /Recovery runs must execute from the matching \$\{PRODUCT_TAG\}-recovery tag/);
  assert.match(workflow, /git merge-base --is-ancestor "\$product_sha" origin\/main/);
});

test("release jobs build the product tag and package the published Extension distribution", () => {
  assert.equal(
    [...workflow.matchAll(/ref: \$\{\{ needs\.validate\.outputs\.release_tag \}\}/g)].length,
    6,
  );
  assert.match(workflow, /cp -a \.github\/markdstage-dist extension-stage\/markdstage/);
  assert.doesNotMatch(workflow, /cp -a \.github\/extensions\/markdstage extension-stage\/markdstage/);
});

test("recovery verifies rather than republishes npm and retains Marketplace protection", () => {
  assert.match(workflow, /Recovery runs verify the existing npm publication and never republish/);
  assert.match(workflow, /The packaged npm tarball does not match the published registry integrity/);
  assert.match(workflow, /The SLSA provenance does not identify the expected release workflow and commit/);
  assert.match(workflow, /environment: vscode-marketplace/);
  assert.match(workflow, /refs\/tags\/\$\{releaseTag\}/);
});
