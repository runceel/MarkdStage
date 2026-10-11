import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  adaptiveCardCapabilities, ADAPTIVE_CARD_PROPERTY_CONTRACTS, ADAPTIVE_CARD_PROPERTY_OVERRIDES,
} from "../renderer/adaptive-card-capabilities.mjs";

export const CARD_MATRIX_START = "<!-- adaptive-card-support-matrix:start -->";
export const CARD_MATRIX_END = "<!-- adaptive-card-support-matrix:end -->";
const code = (values) => values.map((value) => `\`${value}\``).join(", ");
const cell = (value) => value.replaceAll("|", "\\|").replaceAll("\n", " ");

export function adaptiveCardSupportMatrix() {
  const contract = adaptiveCardCapabilities();
  const lines = [
    CARD_MATRIX_START,
    "## Versioned support matrix",
    "",
    `Generated from the validator envelope and capability declaration revision **${contract.revision}**. Do not edit this section by hand.`,
    "Changing a declaration requires matching corpus/upgrade checks and actual-PPTX review. All surfaces share this matrix.",
    "",
    "| Version/capability | Browser contract | PowerPoint contract |",
    "| --- | --- | --- |",
    `| Authored schema **${contract.schemaVersion} exactly** | Resolved static subset below, not the full schema. Nested ShowCard may omit version. | Native/static approximation/bounded raster as below. |`,
    '| Other/missing root versions, including 1.0–1.4 and 1.6+ | `unsupported-version` error; never inferred or silently upgraded. | Visible bounded error panel and content diagnostic. |',
    '| `requires.adaptiveCards` <= 1.5 or `"*"` | Capability satisfied; this does **not** admit other source versions. | Normal static conversion. |',
    '| Other/unmet `requires` | `requires-not-met`; explicit valid fallback substitution/drop or error. | Same replacement/drop/error with authored source path and content impact. |',
    `| SDK **${contract.sdkVersion}** / HostConfig **v${contract.hostConfigVersion}** | Vendored only; interactivity disabled; theme tokens only. | Same approved bytes and measured browser layout; no SDK/asset download. |`,
    "",
    "### Types and exact accepted properties",
    "",
    "Only these properties are accepted, in these collection roles. Required fields, value types and bounds remain enforced by the validator.",
    "The property contracts below apply only where a property is listed for the type; type-specific overrides take precedence.",
    "A record (Fact, Choice, MediaSource, TableColumnDefinition) is not a freestanding body element.",
    "",
    "| Type | Accepted properties | Browser | PowerPoint output mode and conditions |",
    "| --- | --- | --- | --- |",
  ];
  for (const [type, entry] of Object.entries(contract.types)) {
    lines.push(`| \`${type}\` | ${code(Object.keys(entry.properties))} | ${cell(entry.browser)} | ${cell(entry.pptx)} |`);
  }
  lines.push("", "### Property behavior", "",
    "Here **native** means editable measured objects; **static approximation** maps to report mode `approximated` and can still contain editable objects;",
    "**bounded raster** maps to `rasterized` PNG artwork and is not internally editable. Unsupported/error and ignored-with-diagnostic are admission/projection outcomes,",
    "not additional conversion modes or new impact enums. All content losses use the existing `impact: \"content\"`.",
    "",
    "| Properties (on the listed types above) | Browser | PowerPoint |", "| --- | --- | --- |");
  for (const entry of ADAPTIVE_CARD_PROPERTY_CONTRACTS) {
    lines.push(`| ${code(entry.properties)} | ${cell(entry.browser)} | ${cell(entry.pptx)} |`);
  }
  lines.push("", "#### Type-specific property overrides", "",
    "| Type / properties | Browser | PowerPoint |", "| --- | --- | --- |");
  for (const entry of ADAPTIVE_CARD_PROPERTY_OVERRIDES) {
    lines.push(`| ${code(entry.types)} / ${code(entry.properties)} | ${cell(entry.browser)} | ${cell(entry.pptx)} |`);
  }
  lines.push("", "### Rejected, ignored and deferred features", "",
    "| Feature | Browser | PowerPoint |", "| --- | --- | --- |",
    "| Unknown/custom property | On resolved content, stripped before SDK parsing with `unknown-property` at its authored path. Unused branches still receive fatal structure checks. | Remaining content uses normal conversion; diagnostic retained. |",
    "| Invalid known property, malformed structure, prohibited property in any branch | Fatal; an unused fallback or collapsed ShowCard cannot hide it. | Bounded error panel; no partially accepted card. |",
    "| Unknown element/action | `unsupported-element` / `unsupported-action`; only explicit static fallback may replace/drop it. | Replacement follows its type contract; drop is diagnosed. |",
    "| Unsafe/missing/invalid/animated image | Approved local gate or deterministic placeholder; remote/redirect/custom-scheme fetching never occurs. | Same bytes/placeholder, including bounded raster; content diagnostic. |",
    "| Safe links | No clickable browser content; only approved URL metadata retained. | Text-label HTTP(S)/mailto/tel links with original color/underline; no credentials or custom protocols. |",
    "| Background images; refresh; authentication; dynamic choices | Unsupported/error, even in fallback/ShowCard branches. | Error artwork and diagnostic, not a hidden omission. |",
    "| Templates, expressions, macros, custom registration, additional versions, host presets | Not implemented. No opt-in setting is provided by this contract. | Not implemented; no full Adaptive Cards/Teams/Outlook compatibility claim. |",
    "| Remote asset allowlists; presenter interactions; richer input/media protocols | Deferred: a separate accepted contract is required before introducing network or interaction behavior. | Static semantics remain the only accepted behavior. |",
    "| Clipping, RTL, lists, Person images, unsupported table layouts | SDK/browser appearance preserved within fixed slide bounds. | Local bounded raster with source/reason; supported neighbors remain native. |",
    "| Shared opacity/filter paint context | Browser paints its shared context normally. | One owner captures the context and absorbs native descendants once; harmless wrappers do not force whole-card raster. |",
    "", CARD_MATRIX_END);
  return lines.join("\n");
}

export async function generateAdaptiveCardContract({ check = false } = {}) {
  const file = new URL("../docs/adaptive-cards.md", import.meta.url);
  const current = await readFile(file, "utf8");
  const start = current.indexOf(CARD_MATRIX_START), end = current.indexOf(CARD_MATRIX_END);
  const generated = adaptiveCardSupportMatrix();
  const next = start === -1 && end === -1 ? `${current.trimEnd()}\n\n${generated}\n`
    : start >= 0 && end > start ? current.slice(0, start) + generated + current.slice(end + CARD_MATRIX_END.length)
      : (() => { throw new Error("Malformed Adaptive Card matrix markers."); })();
  if (check && current !== next) throw new Error("Adaptive Card support matrix drifted. Run npm run generate:adaptive-cards, review its diff and the compatibility gate.");
  if (!check) await writeFile(file, next);
  return generated;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generateAdaptiveCardContract({ check: process.argv.includes("--check") });
}
