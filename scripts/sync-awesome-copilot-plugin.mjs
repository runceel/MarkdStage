import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, ".github", "extensions", "markdstage");
const pluginRoot = join(root, ".github", "plugin", "markdstage");
const extensionRelative = join("com.github.copilot", "extensions", "markdstage");
// The marketplace preview represents the Canvas Extension, so it uses a Canvas screenshot rather
// than a MarkdStage Desktop one.
const previewSource = join(root, "docs", "user-guide", "images", "canvas-architecture-edit.png");
const previewRelative = join("assets", "preview.png");
const generatedFromRelative = "GENERATED-FROM.txt";
const generatedFrom =
  "Generated from .github/extensions/markdstage by scripts/sync-awesome-copilot-plugin.mjs.\n";

const excludedDirectories = new Set(["test"]);
const excludedFiles = new Set(["copilot-extension.json"]);

async function copyExtensionDirectory(from, to) {
  await rm(to, { recursive: true, force: true });
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    if (entry.isFile() && excludedFiles.has(entry.name)) continue;
    await cp(join(from, entry.name), join(to, entry.name), { recursive: true });
  }
}

// Generate the complete tree that the committed plugin directory must equal. Both the writing and
// the verifying command use this, so --check can never diverge from what --sync would produce.
async function generate(target) {
  await copyExtensionDirectory(source, join(target, extensionRelative));
  await mkdir(join(target, dirname(previewRelative)), { recursive: true });
  await cp(previewSource, join(target, previewRelative));
  await writeFile(join(target, generatedFromRelative), generatedFrom, "utf8");

  const entryPoint = join(target, extensionRelative, "extension.mjs");
  if (!(await stat(entryPoint)).isFile()) {
    throw new Error(`Missing Canvas entry point: ${relative(target, entryPoint)}`);
  }
  if ((await stat(join(target, previewRelative))).size === 0) {
    throw new Error(`Preview image is empty: ${previewRelative}`);
  }

  const manifest = JSON.parse(await readFile(join(pluginRoot, "plugin.json"), "utf8"));
  if (manifest.extensions?.["com.github.copilot"]?.logo !== "assets/preview.png") {
    throw new Error('plugin.json must set com.github.copilot.logo to "assets/preview.png"');
  }
}

// plugin.json and the plugin README are hand-maintained, so they are never generated or compared.
const handMaintainedFiles = new Set(["plugin.json", "README.md"]);

async function collectRelativeFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!prefix && handMaintainedFiles.has(entry.name)) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await collectRelativeFiles(join(directory, entry.name), path)));
    else files.push(path);
  }
  return files;
}

function toSystemPath(base, relativePath) {
  return join(base, ...relativePath.split("/"));
}

async function compare(expectedRoot) {
  const expected = new Set(await collectRelativeFiles(expectedRoot));
  const actual = new Set(await collectRelativeFiles(pluginRoot));
  const problems = [];

  for (const path of [...expected].sort()) {
    if (!actual.has(path)) {
      problems.push(`missing: ${path}`);
      continue;
    }
    const [expectedBytes, actualBytes] = await Promise.all([
      readFile(toSystemPath(expectedRoot, path)),
      readFile(toSystemPath(pluginRoot, path)),
    ]);
    if (!expectedBytes.equals(actualBytes)) problems.push(`out of date: ${path}`);
  }

  for (const path of [...actual].sort()) {
    if (!expected.has(path)) problems.push(`unexpected: ${path}`);
  }

  return problems;
}

async function main() {
  const check = process.argv.includes("--check");
  if (!check) {
    await generate(pluginRoot);
    console.log(`Synchronized ${relative(root, join(pluginRoot, extensionRelative))}`);
    return;
  }

  const workspace = await mkdtemp(join(tmpdir(), "markdstage-awesome-"));
  try {
    await generate(workspace);
    const problems = await compare(workspace);
    if (problems.length > 0) {
      console.error(
        `The generated plugin tree in ${relative(root, pluginRoot)} does not match ` +
          ".github/extensions/markdstage:",
      );
      for (const problem of problems) console.error(`  ${problem}`);
      console.error("Run: npm run awesome:sync");
      process.exitCode = 1;
      return;
    }
    console.log(`The generated plugin tree is up to date (${relative(root, pluginRoot)}).`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

await main();
