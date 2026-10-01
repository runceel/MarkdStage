import { readFile } from "node:fs/promises";

const extension = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const cli = JSON.parse(await readFile(new URL("../../markdstage-cli/package.json", import.meta.url), "utf8"));
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function core(version) {
  const match = SEMVER.exec(String(version));
  return match ? match.slice(1).map(Number) : undefined;
}

function compare(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return Math.sign(a[index] - b[index]);
  }
  return 0;
}

const minimumCliVersion = extension.markdstage?.minimumCliVersion;
const minimum = core(minimumCliVersion);
const current = core(extension.version);

if (extension.version !== cli.version) {
  console.error(`Version mismatch: extension ${extension.version}, CLI ${cli.version}.`);
  process.exitCode = 1;
} else if (!minimum || !current) {
  console.error(`markdstage.minimumCliVersion must be a stable semantic version; found ${minimumCliVersion}.`);
  process.exitCode = 1;
} else if (compare(minimum, current) > 0) {
  console.error(`markdstage.minimumCliVersion ${minimumCliVersion} is newer than extension ${extension.version}.`);
  process.exitCode = 1;
} else {
  console.log(`Version ${extension.version} matches the CLI; minimum compatible CLI is ${minimumCliVersion}.`);
}