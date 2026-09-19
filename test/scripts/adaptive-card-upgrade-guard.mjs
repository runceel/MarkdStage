import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { adaptiveCardCapabilities } from "../../.github/extensions/markdstage/renderer/adaptive-card-capabilities.mjs";
import { adaptiveCardSchemaEnvelope } from "../../.github/extensions/markdstage/renderer/adaptive-card-validation.mjs";
import { createAdaptiveCardHostConfig } from "../../.github/extensions/markdstage/renderer/adaptive-card.mjs";
import { adaptiveCardSupportMatrix } from "../../.github/extensions/markdstage/scripts/generate-adaptive-card-contract.mjs";
import { reconstructAsset } from "../../.github/extensions/markdstage/scripts/vendor-assets.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const extension = ".github/extensions/markdstage/";
export const CARD_CONTRACT_LOCK = resolve(root, "test/fixtures/adaptive-cards/compatibility/contract-lock.json");
const hash = (value) => createHash("sha256").update(typeof value === "string" || value instanceof Uint8Array ? value : JSON.stringify(value)).digest("hex");
const text = async (path) => (await readFile(resolve(root, path), "utf8")).replace(/\r\n?/g, "\n");
const PALETTES = {
  dark: { fontFamily: "Segoe UI, sans-serif", fg: "#f4f4f4", muted: "#a0a0a0", accent: "#7c5cff", surface: "#222222", border: "#444444" },
  light: { fontFamily: "Segoe UI, sans-serif", fg: "#202020", muted: "#606060", accent: "#6748d9", surface: "#eeeeee", border: "#cccccc" },
  microsoft: { fontFamily: "Segoe UI, sans-serif", fg: "#242424", muted: "#616161", accent: "#0078d4", surface: "#f3f2f1", border: "#d1d1d1" },
  custom: { fontFamily: "Consolas, monospace", fg: "#fefefe", muted: "#adbccc", accent: "#ff6600", surface: "#203040", border: "#405060" },
};

export async function adaptiveCardContractSnapshot() {
  const capability = adaptiveCardCapabilities();
  const manifest = JSON.parse(await text(`${extension}vendor/vendor-assets.lock.json`));
  const vendor = manifest.assets["adaptivecards.min.js"];
  assert.equal(vendor.upstream.version, capability.sdkVersion, "Validator and vendor SDK versions differ.");
  const bytes = await reconstructAsset(resolve(root, extension, "vendor"), "adaptivecards.min.js",
    resolve(root, extension, "vendor/vendor-assets.lock.json"));
  assert.equal(hash(bytes), vendor.sha256);
  const notices = await text(`${extension}THIRD-PARTY-NOTICES.md`);
  assert.ok(notices.includes(`Adaptive Cards ${capability.sdkVersion}`), "SDK notice/version drift.");
  const denied = () => { throw new Error("Upgrade fingerprinting must not render, fetch or execute."); };
  const sandbox = { console, fetch: denied, setTimeout: denied, clearTimeout: denied };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.runInNewContext(bytes.toString(), sandbox, { timeout: 5_000 });
  const hostConfigs = Object.fromEntries(Object.entries(PALETTES).map(([name, palette]) => {
    const config = createAdaptiveCardHostConfig(sandbox.AdaptiveCards, palette);
    assert.equal(config.supportsInteractivity, false);
    return [name, hash(JSON.parse(JSON.stringify(config)))];
  }));
  const sources = [
    "adaptive-card.mjs", "adaptive-card-validation.mjs", "adaptive-card-capabilities.mjs",
    "adaptive-card-static.mjs", "adaptive-card-markdown.mjs", "adaptive-card-pptx.mjs",
    "fenced-blocks.mjs", "marked-lexer.mjs", "image-source.mjs",
    "renderer.js", "slides.css", "scene-graph.mjs", "scene-pptx.mjs",
  ].map((file) => `${extension}renderer/${file}`);
  sources.push(...["pptx-package.mjs", "output-model.mjs", "output-cdp.mjs", "layout-report.mjs", "deck-validation.mjs", "export-report.mjs"]
    .map((file) => `${extension}runtime/${file}`),
  `${extension}vendor/marked.min.js`, `${extension}vendor/purify.min.js`,
  `${extension}vendor/adaptivecards.LICENSE`, `${extension}vendor/adaptivecards.min.js.LICENSE.txt`,
  "test/harness/adaptive-cards.mjs", "test/harness/adaptive-card-compatibility.mjs",
  "test/scripts/adaptive-card-upgrade-guard.mjs", "test/scripts/adaptive-cards-review.mjs",
  "test/scripts/compare-adaptive-cards-review.mjs");
  const fixtures = "test/fixtures/adaptive-cards/";
  for (const directory of [fixtures, `${fixtures}assets/`, `${fixtures}compatibility/`]) {
    for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
      if (entry.isFile() && !["README.md", "contract-lock.json"].includes(entry.name)) sources.push(directory + entry.name);
    }
  }
  const files = {};
  for (const path of sources.sort()) {
    files[path] = hash(/\.(?:png|jpe?g|gif)$/i.test(path) ? await readFile(resolve(root, path)) : await text(path));
  }
  return {
    schemaVersion: 1,
    sdk: { version: capability.sdkVersion, sha256: vendor.sha256, bytes: vendor.size },
    schema: { version: capability.schemaVersion, envelopeSha256: hash(adaptiveCardSchemaEnvelope()) },
    capability: { revision: capability.revision, sha256: hash(capability), supportMatrixSha256: hash(adaptiveCardSupportMatrix()) },
    hostConfig: { version: capability.hostConfigVersion, fixturePalettes: PALETTES, resolvedSha256: hostConfigs },
    review: { viewport: { width: 1280, height: 720, dpr: 1 }, edgeTolerancePx: 2, textBaselineTolerancePx: 3,
      repeatChangedPixels: 0, independentActualPowerPointApprovalRequired: true,
      webview2: "Real CoreWebView2 controller; not WinUI/MSIX shell", automaticBaselineUpdateAllowed: false },
    files,
  };
}

export function contractDifferences(expected, actual, path = "$") {
  if (expected && actual && typeof expected === "object" && typeof actual === "object") {
    return [...new Set([...Object.keys(expected), ...Object.keys(actual)])].flatMap((key) =>
      contractDifferences(expected[key], actual[key], `${path}.${key}`));
  }
  return expected === actual ? [] : [{ path, expected, actual }];
}

export async function checkAdaptiveCardContract() {
  const expected = JSON.parse(await readFile(CARD_CONTRACT_LOCK, "utf8"));
  const actual = await adaptiveCardContractSnapshot();
  const differences = contractDifferences(expected, actual);
  assert.deepEqual(differences, [], "Adaptive Card contract drift: inspect the changed paths, create candidate evidence, compare both suites and obtain independent actual-PPTX approval. Never blindly replace the lock/baselines.");
  return actual;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--check" && process.argv.length === 3) {
    await checkAdaptiveCardContract();
    console.log("Adaptive Card SDK/schema/HostConfig/capability/corpus lock matches.");
  } else if (process.argv[2] === "--candidate" && process.argv.length === 4) {
    const destination = resolve(process.argv[3]);
    const local = relative(root, destination);
    assert.ok(local && !local.startsWith("..") && !/^[A-Za-z]:/.test(local) && destination !== CARD_CONTRACT_LOCK,
      "Write a candidate artifact inside this checkout, never over the committed contract lock.");
    await writeFile(destination, JSON.stringify(await adaptiveCardContractSnapshot(), null, 2) + "\n", { flag: "wx" });
    console.log(`Candidate only: ${destination}. This is not baseline approval and --check still uses the committed lock.`);
  } else throw new Error("Usage: adaptive-card-upgrade-guard.mjs --check | --candidate <new-artifact.json>");
}
