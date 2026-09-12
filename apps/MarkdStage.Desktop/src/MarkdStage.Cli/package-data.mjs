// Build-time only. The package reads this data without starting JavaScript.
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readGuide } from "../../../../.github/extensions/markdstage/markdstage-guide.mjs";
import { buildSkillFiles, SKILL_TARGETS } from "../../../../packages/markdstage-cli/src/skills.mjs";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const topics = ["overview", "slide-format", "themes", "custom-themes", "theme-schema", "architecture-dsl", "architecture-schema"];
const guides = Object.fromEntries(await Promise.all(topics.map(async topic => [topic, await readGuide(topic)])));
const skills = {};
for (const target of Object.keys(SKILL_TARGETS)) {
  skills[target] = Object.fromEntries(await buildSkillFiles(target));
  skills[target]["SKILL.md"] = skills[target]["SKILL.md"]
    .replace("- Node.js 24 or later.", "- The installed MarkdStage MSIX package and Microsoft Edge WebView2 Runtime.")
    .replace("- An installed Microsoft Edge, Google Chrome, or Chromium (never downloaded automatically).",
      "- An installed Microsoft Edge, Google Chrome, or Chromium for inspect, capture, and export (never downloaded automatically).")
    .replace("- The CLI: `npx @markdstage/markdstage <command>` or `npm install --global @markdstage/markdstage`.",
      "- The packaged CLI: `markdstage <command>`; no Node.js or npm is required.")
    .replace("| `markdstage` |", "| `markdstage --workspace <folder>` |");
}
const version = JSON.parse(await readFile(resolve(root, "packages/markdstage-cli/package.json"), "utf8")).version;
const output = process.argv[2];
if (!output) throw new Error("Pass the package staging directory.");
await mkdir(resolve(output, "CliData"), { recursive: true });
await writeFile(resolve(output, "CliData/commands.json"), JSON.stringify({ version, guides, skills }), "utf8");
