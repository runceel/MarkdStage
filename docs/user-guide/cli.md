> 日本語版: [日本語](ja/cli.md)

# MarkdStage CLI

The MarkdStage CLI presents, validates, inspects, captures, and exports Markdown decks from a
terminal. It runs without the GitHub Copilot canvas. Console commands work in Codex, Claude Code,
CI jobs, and remote shells; native interactive commands require a Windows desktop session.

The CLI uses the same Markdown parser, renderer, theme handling, Architecture DSL validation, and
PDF/PNG pipeline as the Canvas Extension, so a deck looks identical on every surface.

## Installation

See the [installation guide](installation.md) for package availability, prerequisites, npm
installation, and offline tarballs. There are two distributions:

- **Packaged Windows CLI (Desktop v4 / MSIX):** no Node.js requirement. Interactive
  commands activate the installed native app and use WebView2, not an external
  browser. `validate` uses WebView2 for script execution; `inspect`, `capture`, and
  `export` still require installed Edge, Chrome, or Chromium.
- **npm CLI (`@markdstage/markdstage`):** requires Node.js 24 or later and uses a
  browser-based UI. Its existing server and browser behavior is unchanged.

Both expose `markdstage`. If both are installed, check which command your shell
resolves (`Get-Command markdstage` in PowerShell); `npx @markdstage/markdstage`
explicitly selects npm.

## Commands

```console
markdstage
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
```

With the **packaged Windows CLI**, `markdstage` opens the native app for the caller's
current directory, with no file selected. `markdstage --workspace .` does the same
explicitly. An already open workspace reuses its window and shows the file list.
This stops its audience window; the previous deck remains retained behind the list.
`markdstage slides.md` loads the file in normal slide view with automatic refresh.

With **npm**, the same commands open the browser-based Canvas-equivalent UI.
Without a file it starts empty; use **Open Markdown** to choose a deck.

| Command | Description |
| --- | --- |
| `present` | Packaged: opens/reuses the native workspace window in presenter view and opens the native audience window. Repeating it reuses the audience window instead of closing or duplicating it. npm: opens the browser UI in presenter view; use **Start presentation** for its audience window. |
| `preview` | Opens normal slide view: the native app when packaged, the browser UI with npm. |
| `validate` | Checks deck structure, Architecture DSL blocks, themes, and theme paths. |
| `inspect` | Reports the same compact 1280x720 clipping diagnostics as the canvas `inspect_layout` action. Use `--slide <n>` for one page, `--all` to include slides that fit, and `--fail-on-issues` to exit with code 5. |
| `capture` | Writes 1280x720 PNG files. Without `--pages` only the slides reported as clipped are captured. |
| `export` | Produces the same 16:9 PDF or hybrid editable PowerPoint as the Canvas Extension. The `--output` extension selects the format; PDF remains the default. Use `--mermaid-image-fallback` with an explicit `.pptx` output to place each Mermaid diagram as one image instead of editable PowerPoint shapes, equivalent to choosing **Images** in the UI export dialog. |
| `guide` | Prints the canonical MarkdStage authoring guide: `overview`, `slide-format`, `themes`, `custom-themes`, `theme-schema`, `architecture-dsl`, and `architecture-schema`. |
| `skill` | Installs or checks the portable Agent Skills. |
| `help` | Shows the overview, or the help for one command. `markdstage help <command>` prints the same text as `markdstage <command> --help`. |

### Interactive options and lifetime

| Option | Packaged native app handoff | npm / packaged `--no-open` |
| --- | --- | --- |
| `--workspace <dir>` | Selects the native workspace; reuses the window for its canonical root. | Selects the server's workspace. |
| `--watch` | Accepted; native Markdown watching is always enabled, even without this flag. | Retains existing watch handling. |
| `--theme <name>`, `--theme-file <path>` | Usage error: choose the theme in the app or add `--no-open`. Overrides are never silently ignored. | Existing theme overrides are supported. |
| `--no-open` | Bypasses app activation and runs the existing headless local server. | Serves the UI without opening a browser. |
| `--json` | Reports app acceptance, then exits. | Retains existing server output. |

The packaged CLI returns after the app accepts the request; the native app keeps
running independently. `--no-open` instead keeps the console server running until
Ctrl+C. It is the explicit choice for headless serving, not an activation request.
Native `present` requires a Markdown file and otherwise returns a usage error.
`markdstage present --no-open` retains file-less headless serving.
For example:

```console
markdstage preview slides.md --no-open --watch --theme dark
```

`help`, `--help`, `--version`, `guide`, `skill`, `validate`, `inspect`, `capture`,
and `export` remain console operations and never activate the native app.

A bare invocation uses the current directory as the workspace. A file without
`--workspace` selects its nearest ancestor with a `.git` entry, otherwise its
containing directory. Relative arguments are resolved against the caller's
directory before this rule is applied, including a relative `--workspace`.
Workspaces must be existing directories; files must exist, use `.md` or `.markdown`,
and remain inside the canonical workspace. Packaged CLI and app both apply the same canonicalization,
link-rejection, and containment checks. `skill install` and `skill check` also use
the current directory unless `--root` or `--workspace` is supplied.

```console
markdstage help
markdstage help capture
markdstage capture --help
```

## Recommended authoring workflow

1. Define the source material, audience, objective, approximate length, theme, required diagrams,
   and final output.
2. Read only the guidance needed for the deck. Start with
   `markdstage guide slide-format`, then retrieve `themes`, `custom-themes`, or
   `architecture-dsl` when necessary.
3. Create the complete Markdown deck as the source of truth and separate slides with `---` after a
   blank line.
4. Run `markdstage validate slides.md --json` and fix structure, theme, and Architecture DSL errors
   before visual review.
5. Run `markdstage slides.md` while editing. The native app (packaged) or browser
   (npm) reloads on save, preserves the current slide, and keeps the last valid
   deck if a save is temporarily incomplete.
6. Run `markdstage inspect slides.md --json` to find fixed 16:9 clipping. Use `--slide <n>` after a
   localized change and `--fail-on-issues` in CI or other quality gates.
7. Run `markdstage capture slides.md` only after inspection. It captures clipped slides by default;
   use `--pages 2,4` when specific pages need visual review for balance, spacing, or diagrams.
8. Revise the Markdown and repeat validation plus targeted inspection until the deck is valid,
   unclipped, concise, and visually balanced.
9. Switch to **Presenter view** in the UI (or start with
   `markdstage present slides.md`), run
   `markdstage export slides.md --output slides.pdf`, or use
   `markdstage export slides.md --output slides.pptx`.

Prefer structured validation and layout diagnostics over capturing every slide. Review every final
export before distribution.

## Architecture editing in watch mode

The following browser editing workflow applies to **npm** and the UI served with
packaged `--no-open`. Native app handoff opens slide view with automatic watching;
use the app's **More controls → Shape editing** for its native Architecture editor.

`markdstage slides.md` with npm is the live authoring environment:

1. Select the pencil control on a slide containing Architecture DSL.
2. Drag an element or use the arrow keys. Placement edits are saved atomically
   to the matching `architecture` fence.
3. Select **Advanced edit** for the detailed designer. It can add, update,
   duplicate, reparent, and delete supported elements.
4. Select **Save** in the detailed designer to write its draft to Markdown.

If the source changed outside the editor, the save is rejected instead of
overwriting it. After a successful save, watch mode reloads the deck and keeps
the current slide. A temporarily incomplete Markdown save leaves the last valid
deck on screen.

Architecture editing is available in the full application whether automatic
refresh is currently on or off. Presenter, capture, inspect, and export output
contains no editing UI. There is no separate edit command or edit option.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | success; for packaged interactive commands, the native app accepted the request |
| 1 | usage error |
| 2 | deck or input error |
| 3 | environment error (for example missing Chromium for output commands, or `activation_failed` for native handoff) |
| 4 | rendering or output failure |
| 5 | layout or validation issues were found |

`--json` prints machine-readable output for every command, including errors, so CI jobs and agents
can act on the result.

For packaged native activation, success means the app acknowledged acceptance,
not merely that Windows launched a process:

```json
{"ok":true,"accepted":true,"workspace":"C:\\decks","file":"C:\\decks\\slides.md","mode":"preview","processId":1234,"windowId":5678}
```

`file` is `null` for a workspace-only request; `mode` is `"preview"` or `"present"`.
`processId` and `windowId` identify the actual accepting native app and workspace
window for automation; the numbers above are examples. App rejection,
activation failure, or acknowledgement timeout returns nonzero with
`{"ok":false,"error":"activation_failed","message":"..."}`. CLI-side usage and input
validation failures retain their normal error codes and the same failure shape.

## Agent Skills

`markdstage skill install` writes a portable Agent Skill that teaches an AI agent the MarkdStage
Markdown format and the CLI commands. Reference files are generated from the same guide topics as
`markdstage guide`, so they never drift from the product. The files are generated when the command
runs; they are not copied from Agent Skill discovery directories in the MarkdStage source
repository.

| Target | Directory |
| --- | --- |
| `codex` | `.agents/skills/markdstage/` |
| `claude` | `.claude/skills/markdstage/` |
| `copilot` | `.github/skills/markdstage/` (Canvas adapter included) |

```console
markdstage skill install --target codex
markdstage skill install --target claude,codex --root .
markdstage skill check --target all
```

Locally modified files are reported as conflicts and are never overwritten without `--force`.

## Security

- Native handoff uses the package's registered application entry and a same-user
  private per-request acknowledgement channel. The app revalidates incoming paths.
- Local presentation servers bind to loopback only and serve every route below an unguessable
  per-process URL token.
- Requests must carry a loopback `Host` header, mutating routes require a same-origin `Origin`
  header, and mutable state is served with `no-store`.
- Deck files, assets, themes, and generated output stay inside the resolved workspace. Use
  `--workspace <dir>` to set it explicitly; otherwise a file selects its Git root
  or containing folder, and a workspace-only invocation uses the caller's current directory.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `PDF export requires Microsoft Edge, Google Chrome, or Chromium.` (exit code 3) | Install a Chromium-based browser, or run the command on a machine that has one. |
| `... is outside the workspace.` (exit code 2) | Move the file into the workspace, or pass `--workspace` with the directory that contains it. |
| `activation_failed` (exit code 3) | Check the installed package and WebView2, and that the native app can accept requests in your Windows session. Use `--no-open` only if you want a local server instead. |
| `--theme` / `--theme-file` rejected during native launch (exit code 1) | Choose the theme in the app, or use `--no-open` for server-side overrides. |
| The deck does not reload while presenting | npm/server: re-run `present` with `--watch`. Native app: watching is already enabled; check file access and reload errors. |
| Slides are clipped in the PDF | Run `markdstage inspect` and shorten the reported slides, or change their layout. |
