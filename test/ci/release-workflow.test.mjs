import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    [...workflow.matchAll(/ref: \$\{\{ needs\.validate\.outputs\.release_sha \}\}/g)].length,
    6,
  );
  assert.match(workflow, /cp -a \.github\/markdstage-dist extension-stage\/markdstage/);
  assert.doesNotMatch(workflow, /cp -a \.github\/extensions\/markdstage extension-stage\/markdstage/);
});

test("recovery verifies rather than republishes npm and retains Marketplace protection", () => {
  assert.match(workflow, /Recovery runs verify the existing npm publication and never republish/);
  assert.match(workflow, /The packaged npm tarball does not match the published registry integrity/);
  assert.match(workflow, /The SLSA provenance does not identify the expected release workflow and commit/);
  assert.match(workflow, /integrity\.slice\("sha512-"\.length\), "base64"\)\.toString\("hex"\)/);
  assert.match(workflow, /environment: vscode-marketplace/);
  assert.match(workflow, /refs\/tags\/\$\{releaseTag\}/);
});

test("npm provenance verification accepts the registry's hexadecimal SLSA digest", () => {
  const script = workflow.match(
    /node - "\$RUNNER_TEMP\/markdstage-attestations\.json"[\s\S]*?<<'NODE'\n([\s\S]*?)\n          NODE/,
  )?.[1]?.replace(/^          /gm, "");
  assert.ok(script, "expected the npm provenance verification script");

  const productSha = "2ee5fa20ce228a4f6aa9b105afe83ab6d2061730";
  const releaseTag = "v4.6.3";
  const repository = "runceel/MarkdStage";
  const digestHex = "0123456789abcdef".repeat(8);
  const integrity = `sha512-${Buffer.from(digestHex, "hex").toString("base64")}`;
  const statement = {
    predicateType: "https://slsa.dev/provenance/v1",
    subject: [{ digest: { sha512: digestHex } }],
    predicate: {
      buildDefinition: {
        externalParameters: {
          workflow: {
            ref: `refs/tags/${releaseTag}`,
            repository: `https://github.com/${repository}`,
            path: ".github/workflows/npm-publish.yml",
          },
        },
        resolvedDependencies: [{ digest: { gitCommit: productSha } }],
      },
    },
  };
  const dir = mkdtempSync(join(tmpdir(), "markdstage-provenance-"));
  const attestationPath = join(dir, "attestations.json");
  const writeAttestations = () => writeFileSync(
    attestationPath,
    JSON.stringify({
      attestations: [{
        predicateType: "https://slsa.dev/provenance/v1",
        bundle: {
          dsseEnvelope: {
            payload: Buffer.from(JSON.stringify(statement)).toString("base64"),
          },
        },
      }],
    }),
  );

  try {
    writeAttestations();
    const args = [attestationPath, integrity, productSha, releaseTag, repository];
    const valid = spawnSync(process.execPath, ["-", ...args], {
      input: script,
      encoding: "utf8",
    });
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);

    statement.subject[0].digest.sha512 = "f".repeat(128);
    writeAttestations();
    const invalid = spawnSync(process.execPath, ["-", ...args], {
      input: script,
      encoding: "utf8",
    });
    assert.notEqual(invalid.status, 0, "a mismatched registry digest must fail");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
