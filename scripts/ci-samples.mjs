import { mkdtemp, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CLI = join(REPO_ROOT, "packages", "markdstage-cli", "bin", "markdstage.mjs");
const KNOWN_SAMPLES = [
  "slides.md",
  "site/examples/architecture.md",
  "site/examples/azure-hub-spoke.md",
  "site/examples/markdown.md",
];

function normalizePath(path) {
  return path.trim().replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function isSamplePath(path) {
  return (
    path === "slides.md" ||
    path.startsWith("site/examples/") ||
    path === "docs/user-guide/diagrams-and-media.md" ||
    path === "docs/user-guide/ja/diagrams-and-media.md" ||
    path.startsWith("docs/user-guide/examples/") ||
    path === ".github/extensions/markdstage/README.md"
  );
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function run(args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`markdstage ${args.join(" ")} failed (${signal ?? code})`));
    });
  });
}

async function readStdin() {
  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input.split(/\r?\n/).map(normalizePath).filter(Boolean);
}

async function main() {
  const changed = await readStdin();
  const changedSamples = [...new Set(changed.filter(isSamplePath))];
  const candidates = changedSamples.length ? changedSamples : KNOWN_SAMPLES;
  let files = [];

  for (const relative of candidates) {
    const file = join(REPO_ROOT, relative);
    if (await exists(file)) files.push({ file, relative });
  }

  if (files.length === 0 && changedSamples.length) {
    for (const relative of KNOWN_SAMPLES) {
      const file = join(REPO_ROOT, relative);
      if (await exists(file)) files.push({ file, relative });
    }
  }

  if (files.length === 0) {
    throw new Error("Sample verification selected no existing decks.");
  }

  const output = await mkdtemp(join(REPO_ROOT, ".ci-samples-"));
  try {
    for (const { file, relative } of files) {
      console.log(`Checking sample: ${relative}`);
      await run(["validate", file, "--json"]);
      await run(["inspect", file, "--all", "--fail-on-issues"]);
      const pdf = join(output, `${relative.replaceAll("/", "_")}.pdf`);
      const pptx = join(output, `${relative.replaceAll("/", "_")}.pptx`);
      await run(["export", file, "--output", pdf]);
      await run(["export", file, "--output", pptx]);
      for (const artifact of [pdf, pptx]) {
        const result = await stat(artifact);
        if (result.size === 0) throw new Error(`Sample export is empty: ${artifact}`);
      }
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
