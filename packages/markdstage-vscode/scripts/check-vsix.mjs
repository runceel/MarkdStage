import { basename, resolve } from "node:path";
import AdmZip from "adm-zip";

const file = resolve(process.argv[2] ?? "markdstage-vscode.vsix");
const entries = new AdmZip(file).getEntries().map((entry) => entry.entryName);
const required = [
  "extension/package.json",
  "extension/readme.md",
  "extension/dist/extension.js",
  "extension/LICENSE.txt",
  "extension/media/preview-dark.svg",
  "extension/media/preview-light.svg",
];
const forbidden = [
  "extension/src/",
  "extension/test/",
  "extension/scripts/",
  "extension/package-lock.json",
  "extension/node_modules/",
];

for (const entry of required) {
  if (!entries.includes(entry)) {
    throw new Error(`${basename(file)} is missing required content: ${entry}`);
  }
}
for (const entry of forbidden) {
  if (entries.some((candidate) => candidate.startsWith(entry))) {
    throw new Error(`${basename(file)} unexpectedly contains: ${entry}`);
  }
}
console.log(`${basename(file)} content matches the extension packaging contract.`);
