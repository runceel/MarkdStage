import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const source = resolve(repository, ".github/extensions/markdstage");
const output = resolve(process.argv[2] ?? "");
if (!process.argv[2] || output === repository || output === source)
  throw new Error("Pass a dedicated native package assets directory.");
const roots = ["runtime/host-bootstrap.mjs", "runtime/portable-output.mjs", "renderer/speaker-notes.mjs"];
const seen = new Set();
const dependencies = /(?:\b(?:import|export)\s+(?:[^;"']*?\s+from\s*)?|\bimport\s*\()\s*["']([^"']+)["']/gu;

async function copyModule(name) {
  if (seen.has(name)) return;
  if (name.startsWith("../") || name.includes("\\") || name.startsWith("/"))
    throw new Error(`Module escapes the shared package: ${name}`);
  seen.add(name);
  const path = resolve(source, name);
  const text = await readFile(path, "utf8");
  if (extname(name) === ".mjs" || extname(name) === ".js") {
    if (/\b(?:from\s*|import\s*(?:\(\s*)?)["']node:/u.test(text))
      throw new Error(`A Node module entered the native package: ${name}`);
    for (const match of text.matchAll(dependencies)) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) throw new Error(`Nonportable import in ${name}: ${specifier}`);
      const dependency = relative(source, resolve(dirname(path), specifier)).split(sep).join("/");
      await copyModule(dependency);
    }
  }
  const destination = resolve(output, "Shared", name);
  await mkdir(dirname(destination), { recursive: true });
  await cp(path, destination);
}

await rm(resolve(output, "Shared"), { recursive: true, force: true });
for (const root of roots) await copyModule(root);
for (const name of await readdir(resolve(source, "schema"))) {
  if (name.endsWith(".json")) await copyModule(`schema/${name}`);
}
await mkdir(resolve(output, "CliData"), { recursive: true });
await cp(fileURLToPath(new URL("host.html", import.meta.url)), resolve(output, "CliData/host.html"));
await cp(fileURLToPath(new URL("host.mjs", import.meta.url)), resolve(output, "CliData/host.mjs"));
await writeFile(resolve(output, "CliData/shared-modules.json"), JSON.stringify([...seen].sort()), "utf8");
