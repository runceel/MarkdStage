import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { checkAdaptiveCardContract, contractDifferences } from "../scripts/adaptive-card-upgrade-guard.mjs";
import { generateAdaptiveCardContract } from "../../.github/extensions/markdstage/scripts/generate-adaptive-card-contract.mjs";
import { CARD_COMPATIBILITY_DIRECTORY, adaptiveCardCompatibilityCases } from "../harness/adaptive-card-compatibility.mjs";

test("pinned SDK/schema/HostConfig/capability/corpus/source fingerprints and generated matrix require explicit upgrade review", async () => {
  const contract = await checkAdaptiveCardContract();
  await generateAdaptiveCardContract({ check: true });
  assert.equal(contract.review.automaticBaselineUpdateAllowed, false);
  assert.equal(contract.review.independentActualPowerPointApprovalRequired, true);
  assert.equal(contract.review.edgeTolerancePx, 2);
  assert.equal(contract.review.textBaselineTolerancePx, 3);
  assert.equal(contract.review.repeatChangedPixels, 0);
  for (const [section, key] of [
    ["sdk", "version"], ["sdk", "sha256"], ["schema", "version"], ["schema", "envelopeSha256"],
    ["capability", "revision"], ["capability", "sha256"], ["capability", "supportMatrixSha256"],
    ["hostConfig", "version"], ["files", "test/fixtures/adaptive-cards/compatibility/output-expectations.json"],
  ]) {
    const candidate = structuredClone(contract);
    candidate[section][key] = "drift";
    assert.deepEqual(contractDifferences(contract, candidate).map((entry) => entry.path), [`$.${section}.${key}`]);
  }
  for (const theme of ["dark", "light", "microsoft", "custom"]) {
    const candidate = structuredClone(contract);
    candidate.hostConfig.resolvedSha256[theme] = "new defaults";
    assert.equal(contractDifferences(contract, candidate).length, 1);
  }
});

test("official samples retain pinned provenance, license, explicit reductions and one exact expectation per case", async () => {
  const provenance = JSON.parse(await readFile(join(CARD_COMPATIBILITY_DIRECTORY, "provenance.json"), "utf8"));
  assert.match(provenance.commit, /^[a-f0-9]{40}$/);
  assert.equal(provenance.upstream, "https://github.com/microsoft/AdaptiveCards");
  assert.equal(provenance.license, "MIT");
  const license = await readFile(join(CARD_COMPATIBILITY_DIRECTORY, "LICENSE"), "utf8");
  assert.match(license, /Copyright \(c\) 2017 Microsoft/);
  assert.match(license, /Permission is hereby granted/);
  const fixtures = (await readdir(CARD_COMPATIBILITY_DIRECTORY)).filter((name) =>
    name.endsWith(".json") && !["contract-lock.json", "output-expectations.json", "provenance.json"].includes(name));
  assert.deepEqual(provenance.samples.map((sample) => sample.file).sort(), fixtures.sort());
  for (const sample of provenance.samples) {
    assert.ok(sample.adaptations.length > 50);
    assert.ok(sample.urls.length);
    for (const url of sample.urls) assert.ok(url.startsWith(`${provenance.upstream}/blob/${provenance.commit}/samples/`));
    const card = JSON.parse(await readFile(join(CARD_COMPATIBILITY_DIRECTORY, sample.file), "utf8"));
    assert.equal(card.version, "1.5");
  }
  const cases = await adaptiveCardCompatibilityCases();
  const output = JSON.parse(await readFile(join(CARD_COMPATIBILITY_DIRECTORY, "output-expectations.json"), "utf8"));
  assert.deepEqual(Object.keys(output), cases.map((entry) => entry.name));
  for (const entry of Object.values(output)) {
    assert.equal(Object.values(entry.nativeTypes).reduce((sum, count) => sum + count, 0), entry.counts[0]);
    assert.equal(entry.conversions.filter((conversion) => conversion[2] === "approximated").length, entry.counts[1]);
    assert.equal(entry.fallbacks.filter((fallback) => fallback[2]).length, entry.counts[2]);
    assert.equal(entry.conversions.reduce((sum, conversion) => sum + conversion[4], 0), entry.counts[0]);
    for (const [path, type, mode, reason, count] of entry.conversions) {
      assert.match(path, /^adaptive-card\[0\]\$/);
      assert.ok(type && reason);
      assert.ok(["native", "approximated", "rasterized"].includes(mode));
      assert.ok(Number.isInteger(count) && count >= 0);
    }
  }
});
