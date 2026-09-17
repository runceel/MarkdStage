// Portable Agent Skill generation.
//
// Every reference file is generated from readGuide(topic) so the skills cannot
// drift from the canonical MarkdStage documentation. The generated tree follows
// the Agent Skills specification: a SKILL.md with YAML front matter (name +
// description) plus progressive-disclosure reference files.

import { GUIDE_TOPICS } from "./commands/guide.mjs";
import { readGuide } from "./runtime.mjs";

export const SKILL_TARGETS = {
  codex: {
    label: "Codex",
    directory: [".agents", "skills", "markdstage"],
  },
  claude: {
    label: "Claude Code",
    directory: [".claude", "skills", "markdstage"],
  },
  copilot: {
    label: "GitHub Copilot",
    directory: [".github", "skills", "markdstage"],
  },
};

const DESCRIPTION =
  "Turn Markdown into 16:9 slides with the MarkdStage CLI. Use when the user asks to create, " +
  "refine, present, preview, validate, inspect, screenshot, or export a Markdown deck " +
  '("present slides.md", "turn this file into slides", "export the deck to PDF or PowerPoint", ' +
  '"check whether my slides fit", "import an Archify SVG"). Provides a deterministic create-review-deliver workflow, ' +
  "Architecture DSL editing, theme validation, 1280x720 clipping diagnostics, " +
  "targeted PNG capture, and PDF/PowerPoint export.";

function frontMatter(fields) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function canvasNote(target) {
  if (target !== "copilot") return "";
  return [
    "",
    "## Canvas adapter",
    "",
    "Inside GitHub Copilot with the MarkdStage canvas Extension installed, prefer the",
    "canvas: pass `sourcePath: \"slides.md\"` to the `open` input of canvas ID `MarkdStage`",
    "for live, source-backed editing. Use the CLI commands below when the canvas is not",
    "available, or for validation, PNG capture, and PDF export in a terminal or CI job.",
  ].join("\n");
}

function skillBody(target) {
  const label = SKILL_TARGETS[target].label;
  return `# MarkdStage

Markdown is the single source of truth. MarkdStage renders each Markdown fragment
between \`---\` separators as one 1280x720 (16:9) slide. Desktop, Canvas, and the CLI
share the renderer and output model; review final output for font and browser differences.

## Requirements

- Windows Store/MSIX package: includes the GUI and \`markdstage\` CLI; no Node.js
  or npm installation is required. Native viewing and validation use WebView2.
- npm distribution: requires Node.js 24 or later and an installed Microsoft Edge,
  Google Chrome, or Chromium. Use \`npx @markdstage/markdstage <command>\` or
  \`npm install --global @markdstage/markdstage\` only when this distribution is wanted.
- Layout inspection, PNG capture, and PDF/PowerPoint export require installed Edge,
  Chrome, or Chromium, including Windows GUI exports. Browsers are never downloaded automatically.

On Windows, check \`Get-Command markdstage -All\` if both distributions are installed.
Do not add npm just to use the Store CLI. Desktop's **Install skills…** writes this
workspace guidance; it does not install the AI tool or the Canvas Extension.

## Recommended authoring workflow

1. Establish the source material, audience, objective, approximate length, theme,
   required diagrams, and output format.
2. Read only the relevant guidance. Start with
   \`markdstage guide slide-format\`, then retrieve \`themes\`,
   \`custom-themes\`, or \`architecture-schema\` when needed. Before drafting
   Architecture DSL, read the compact \`architecture-schema\` contract first;
   use \`architecture-dsl\` for advanced behavior.
3. Create the complete deck as one Markdown source file (see
   \`references/slide-format.md\`).
4. Validate structure, themes, and Architecture DSL before visual review:
   \`markdstage validate slides.md --json\`. Review diagnostic codes, JSON Pointers,
   and completeness, fix independent issues together, and preserve the same
   validated content when presenting. Suggestions are never automatic repairs.
5. Use \`markdstage slides.md\` for live source-backed authoring.
   It reloads on save without losing the current slide and keeps the last valid
   deck while a save is incomplete.
6. Check fixed 16:9 output with \`markdstage inspect slides.md --json\`. Use
   \`--slide <n>\` after localized changes and \`--fail-on-issues\` in CI.
7. Run \`markdstage capture slides.md\` only after inspection. Without
   \`--pages\`, it captures only clipped slides; use \`--pages 2,4\` for pages
   whose balance, spacing, or diagrams need visual judgment.
8. Revise Markdown and repeat validation plus targeted inspection until the deck
   is valid, unclipped, concise, and visually balanced.
9. Deliver from the same source with \`markdstage present slides.md\`,
   \`markdstage export slides.md --output slides.pdf\`, or
   \`markdstage export slides.md --output slides.pptx\`.

The Store/MSIX \`markdstage slides.md\` opens or reuses the native workspace window.
Use **More controls > Shape editing** for its Architecture Editor and **Save** to
write the draft to Markdown. The native GUI also provides output preview,
presenter view, and PDF/PowerPoint export. Edit general Markdown text in an external editor.
The native \`present\` command also opens the audience window; it returns after app
acceptance instead of keeping a presentation server in the terminal.

With npm, the browser starts in viewing mode on the fixed 16:9 output surface.
Keep **Output preview** enabled for fixed-layout review; turning it off shows the
responsive layout. **More controls > Shape editing** opens the detailed designer
directly for a source-backed deck. Move elements or adjust properties, then select
**Save** to write the draft to Markdown; moving a shape does not save immediately.
Automatic refresh can be toggled without disabling Architecture editing.

Never hand-write HTML or CSS for a slide. Fix layout problems by shortening the
content or by changing the layout in front matter. Prefer structured validation
and layout diagnostics over capturing every slide.

## Archify imports

Use an \`archify\` fence to import an SVG exported by Archify:

\`\`\`\`markdown
\`\`\`archify
assets/checkout-architecture.svg
\`\`\`
\`\`\`\`

The fence contains one local \`.svg\` path, not JSON or inline SVG. Save the file
under Markdown-adjacent or workspace-root \`assets/\` and omit the leading slash.
MarkdStage preserves geometry, applies the deck theme, and exports supported
shapes, connectors, and text as editable PowerPoint objects. Re-export in Archify
and refresh to update it; the Architecture Editor does not edit imported SVGs.
Preview to check import errors; \`validate\` does not validate imported Archify SVGs.
Read \`references/slide-format.md\` or \`markdstage guide slide-format\` for
the complete path rules and import behavior.

## Commands

| Command | Purpose |
| --- | --- |
| \`markdstage\` | Open an empty Canvas-equivalent UI and choose Markdown from the workspace. |
| \`markdstage <file>\` | Open the full UI in live slide view with automatic refresh, editing, presenting, and UI export. |
| \`markdstage present <file> [--watch]\` | Open presenter view; Store/MSIX also opens the native audience window. Native watching is always on; npm \`--watch\` enables it initially. |
| \`markdstage preview <file> [--watch]\` | Open slide view in the native app (Store/MSIX) or browser (npm). Native watching is always on; npm \`--watch\` enables it initially. |
| \`markdstage validate <file> [--json]\` | Check deck structure, Architecture DSL blocks, and themes. |
| \`markdstage inspect <file> [--json]\` | Report 1280x720 clipping diagnostics for the deck or one slide; use \`--fail-on-issues\` for quality gates. |
| \`markdstage capture <file> [--pages 2,4]\` | Write 1280x720 PNG files; without \`--pages\` only clipped slides are captured. |
| \`markdstage export <file> [--output slides.pdf|slides.pptx]\` | Produce a 16:9 PDF or hybrid editable PowerPoint. |
| \`markdstage guide <topic>\` | Print the canonical MarkdStage authoring guide. |

Exit codes: \`0\` success, \`1\` usage error, \`2\` deck or input error, \`3\`
environment error (including missing Chromium or native activation failure),
\`4\` rendering failure, \`5\` issues found with \`--fail-on-issues\`.

## References

Read the reference that matches the task before writing Markdown:

- \`references/slide-format.md\` — slide fragments, front matter, layouts, Archify SVG imports.
- \`references/themes.md\` — built-in themes.
- \`references/custom-themes.md\` — custom theme authoring and \`theme-file\`.
- \`references/theme-schema.md\` — custom theme properties.
- \`references/architecture-dsl.md\` — Architecture DSL v1 diagrams.
- \`references/architecture-schema.md\` — Architecture DSL schema summary.
- \`references/overview.md\` — how MarkdStage works.

## Notes for ${label}

Run the CLI through the shell. Presentation servers bind to loopback with an
unguessable per-process URL token, and every generated file stays inside the
workspace.${canvasNote(target)}
`;
}

const REFERENCE_HEADERS = {
  overview: "MarkdStage overview",
  "slide-format": "Slide fragment format",
  themes: "Built-in themes",
  "custom-themes": "Custom theme authoring",
  "theme-schema": "Custom theme schema",
  "architecture-dsl": "Architecture DSL v1",
  "architecture-schema": "Architecture DSL schema summary",
};

/**
 * Build every file of the generated skill as a `path -> contents` map.
 * Paths use POSIX separators and are relative to the skill directory.
 */
export async function buildSkillFiles(target) {
  if (!SKILL_TARGETS[target]) {
    throw new Error(`Unknown skill target: ${target}`);
  }
  const files = new Map();
  files.set(
    "SKILL.md",
    `${frontMatter({
      name: "markdstage",
      description: DESCRIPTION,
      license: "MIT",
    })}\n\n${skillBody(target)}`,
  );
  for (const topic of GUIDE_TOPICS) {
    const content = (await readGuide(topic)).trim();
    const parts = [
      "<!-- Generated by `markdstage skill install`. Do not edit by hand. -->",
      `<!-- Source: markdstage_guide topic "${topic}" -->`,
      "",
    ];
    if (!content.startsWith("#")) {
      parts.push(`# ${REFERENCE_HEADERS[topic]}`, "");
    }
    parts.push(content, "");
    files.set(`references/${topic}.md`, parts.join("\n"));
  }
  return files;
}
