import { access, readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pluginRoot = join(root, ".github", "plugin", "markdstage");
const extensionRoot = join(pluginRoot, "com.github.copilot", "extensions", "markdstage");
const manifestPath = join(pluginRoot, "plugin.json");
const cliManifestPath = join(root, "packages", "markdstage-cli", "package.json");

const fail = (message) => {
  throw new Error(message);
};

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    else files.push(path);
  }
  return files;
}

async function main() {
  if (!(await exists(manifestPath))) fail("Missing .github/plugin/markdstage/plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const cliManifest = JSON.parse(await readFile(cliManifestPath, "utf8"));
  if (manifest.$schema !== "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json") {
    fail("plugin.json has an unexpected Agent Plugins schema URL");
  }
  if (manifest.name !== "markdstage") fail('plugin.json name must be "markdstage"');
  if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(manifest.version)) {
    fail("plugin.json version must be SemVer");
  }
  if (manifest.version !== cliManifest.version) {
    fail(`plugin.json version ${manifest.version} does not match CLI version ${cliManifest.version}`);
  }
  if (!manifest.keywords.includes("canvas")) fail('plugin.json keywords must include "canvas"');
  if (manifest.extensions?.["com.github.copilot"]?.logo !== "assets/preview.png") {
    fail('plugin.json logo must be "assets/preview.png"');
  }
  if (!(await stat(join(pluginRoot, "assets", "preview.png"))).isFile()) {
    fail("Missing assets/preview.png");
  }
  if (!(await stat(join(extensionRoot, "extension.mjs"))).isFile()) {
    fail("Missing com.github.copilot/extensions/markdstage/extension.mjs");
  }
  if (await exists(join(extensionRoot, "test"))) {
    fail("Generated plugin must not contain the extension test directory");
  }
  const files = await collectFiles(extensionRoot);
  for (const file of files) {
    const content = await readFile(file).catch(() => null);
    if (content === null) continue;
    if (file.endsWith("vendor/vendor-assets.lock.json")) {
      const manifest = JSON.parse(content.toString("utf8"));
      if (!manifest.assets?.["mermaid.min.js"]) fail("Vendor manifest is missing mermaid.min.js");
    }
  }
  console.log(`awesome-copilot plugin checks passed (${relative(root, pluginRoot)})`);
}

await main();
