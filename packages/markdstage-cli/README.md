# MarkdStage CLI

Present, validate, inspect, capture, and export MarkdStage Markdown decks from a terminal — no GitHub Copilot canvas required.

The CLI reuses the very same Markdown parser, renderer, Architecture DSL
validation, theme handling, and PDF/PNG/PowerPoint pipeline as the MarkdStage canvas
Extension, so a deck looks identical in Copilot, MarkdStage Desktop, the CLI, and
exported PDF, or hybrid editable PowerPoint deck.

## Requirements

- Node.js 24 or later.
- An installed Microsoft Edge, Google Chrome, or Chromium. MarkdStage never
  downloads a browser.

## Install

```console
npx @markdstage/markdstage --workspace .
npx @markdstage/markdstage slides.md
npm install --global @markdstage/markdstage
```

For offline installation, download the versioned `.tgz` asset from the
[GitHub Release](https://github.com/runceel/markdstage/releases) and install it locally:

```console
npm install --global .\markdstage-markdstage-<version>.tgz
```

## Commands

```console
markdstage --workspace .
markdstage slides.md
markdstage present slides.md
markdstage preview slides.md --watch
markdstage validate slides.md --json
markdstage inspect slides.md --json
markdstage capture slides.md --pages 2,4
markdstage export slides.md --output slides.pdf
markdstage export slides.md --output slides.pptx
markdstage export slides.md --output slides.pptx --mermaid-image-fallback
markdstage guide architecture-dsl
markdstage skill install --target codex
markdstage skill install --target claude
```

`markdstage --workspace .` opens an empty Canvas-equivalent UI for the explicitly chosen workspace.
Choose **Open Markdown** to load a deck. `markdstage slides.md` opens the same UI
in slide view with automatic refresh enabled.

| Command | Description |
| --- | --- |
| `present` | Opens the full MarkdStage UI in presenter view. Open Markdown, automatic refresh, editing, export, and audience controls remain available. `--watch` starts in live mode, and `--no-open` serves the UI without launching a browser. |
| `preview` | Opens the same full UI in slide view. It is a compatibility/convenience entry point; `--watch` starts in live mode, and `--no-open` serves the UI without launching a browser. |
| `validate` | Checks deck structure, Architecture DSL blocks, themes, and theme paths. |
| `inspect` | Reports the same compact 1280x720 clipping diagnostics as the canvas `inspect_layout` action. `--slide <n>` limits it to one page, `--all` includes slides that fit, `--fail-on-issues` exits with code 5. |
| `capture` | Writes 1280x720 PNG files. Without `--pages` only the slides reported as clipped are captured. |
| `export` | Produces the same 16:9 PDF or hybrid editable PowerPoint as the canvas Extension. PowerPoint output includes speaker-note Markdown as readable plain text notes. The `--output` extension selects the format; PDF remains the default. Use `--mermaid-image-fallback` with an explicit `.pptx` output to place each Mermaid diagram as one image instead of editable PowerPoint shapes, equivalent to choosing **Images** in the UI export dialog. |
| `guide` | Prints the canonical `markdstage_guide` topics. |
| `skill` | Installs or checks the portable Agent Skills for Codex (`.agents/skills/markdstage/`), Claude Code (`.claude/skills/markdstage/`), and GitHub Copilot (`.github/skills/markdstage/`). Locally modified files are never overwritten without `--force`. |
| `help` | Shows the overview, or the help for one command. `markdstage help <command>` prints the same text as `markdstage <command> --help`. |

Application options: `--workspace <dir>`, `--theme <name>`,
`--theme-file <path>`, `--no-open`, and `--json`. Use `--help` and `--version`
for global information.

Workspace resolution never defaults to the process working directory. Supply
`--workspace` or a Markdown file. Without `--workspace`, a file selects its nearest
ancestor containing a `.git` entry, or its containing directory if there is none;
Git need not be installed. Relative command-line arguments are first made absolute
against the caller's directory. Files outside an explicit workspace are rejected.
This is an intentional change from the archive-era bare invocation.

## Architecture editing

Run `markdstage slides.md` for the live authoring workflow. The browser starts
in the fixed 16:9 output preview and remains in viewing mode.
Select **Output preview** to switch to the retained responsive layout. Select
the pencil control to move Architecture elements; editing automatically switches
to the responsive layout, and those placement changes are saved atomically to
the matching `architecture` fence. Select **Advanced edit** to add, update,
duplicate, reparent, or delete elements in the detailed designer, then select
**Save**.

The server rejects a save if the Markdown changed outside the editor. Successful
saves reload the watched deck without changing the current slide. Automatic
refresh can be toggled without disabling Architecture editing. Presenter,
capture, inspect, and export views contain no editing UI.

```console
markdstage help
markdstage help capture
markdstage capture --help
```

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | success |
| 1 | usage error |
| 2 | deck or input error |
| 3 | environment error (no Chromium-based browser) |
| 4 | rendering or output failure |
| 5 | layout or validation issues were found |

## Security

- Presentation servers bind to loopback only and serve every route below an
  unguessable per-process URL token.
- Requests must carry a loopback `Host` header, and mutating routes require a
  same-origin `Origin` header. Mutable state is served with `no-store`.
- Deck files, assets, themes, and generated output stay inside the resolved
  workspace (canonical paths, symlink checks, and size limits included).

## Development

The package mirrors the canonical runtime from
`.github/extensions/markdstage/` into `shared/` before packing and testing:

```console
npm run sync    # refresh shared/
npm test        # node --test
npm run skills  # regenerate the repository Agent Skills
```

## License

MIT
