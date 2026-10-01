import { readFile } from "node:fs/promises";

const extension = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const cli = JSON.parse(await readFile(new URL("../../markdstage-cli/package.json", import.meta.url), "utf8"));

if (extension.version !== cli.version) {
  console.error(`Version mismatch: extension ${extension.version}, CLI ${cli.version}.`);
  process.exitCode = 1;
} else {
  console.log(`Version ${extension.version} matches the CLI.`);
}
