import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, ".github", "extensions", "markdstage");
const pluginRoot = join(root, ".github", "plugin", "markdstage");
const destination = join(pluginRoot, "com.github.copilot", "extensions", "markdstage");
const previewSource = join(root, ".github", "store", "screenshots", "01-architecture.png");
const previewDestination = join(pluginRoot, "assets", "preview.png");

const excludedDirectories = new Set(["test"]);
const excludedFiles = new Set(["copilot-extension.json"]);

async function copyExtensionDirectory(from, to) {
  await rm(to, { recursive: true, force: true });
  await mkdir(to, { recursive: true });
  const entries = await (await import("node:fs/promises")).readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    if (entry.isFile() && excludedFiles.has(entry.name)) continue;
    const fromPath = join(from, entry.name);
    const toPath = join(to, entry.name);
    await cp(fromPath, toPath, { recursive: true });
  }
}

async function main() {
  await copyExtensionDirectory(source, destination);
  await mkdir(dirname(previewDestination), { recursive: true });
  await cp(previewSource, previewDestination);

  const manifestPath = join(pluginRoot, "plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const extensionEntry = join(destination, "extension.mjs");
  const preview = await stat(previewDestination);
  if (!(await stat(extensionEntry)).isFile()) {
    throw new Error(`Missing Canvas entry point: ${relative(root, extensionEntry)}`);
  }
  if (preview.size === 0) {
    throw new Error(`Preview image is empty: ${relative(root, previewDestination)}`);
  }
  if (manifest.extensions?.["com.github.copilot"]?.logo !== "assets/preview.png") {
    throw new Error('plugin.json must set com.github.copilot.logo to "assets/preview.png"');
  }

  await writeFile(
    join(pluginRoot, "GENERATED-FROM.txt"),
    "Generated from .github/extensions/markdstage by scripts/sync-awesome-copilot-plugin.mjs.\n",
    "utf8",
  );
  console.log(`Synchronized ${relative(root, destination)}`);
}

await main();
