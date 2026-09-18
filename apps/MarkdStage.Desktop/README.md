# MarkdStage Desktop

MarkdStage is a workspace-based Windows application for Markdown slide decks. It uses WinUI 3
and the shared MarkdStage slide UI and renderer for viewing decks, editing Architecture diagrams,
presenting, and exporting, independently of the GitHub Copilot App.

## Installation and requirements

Install MarkdStage from the [Microsoft Store](https://apps.microsoft.com/detail/9N9DG772RM03).
One installation includes the graphical app and the `markdstage` command-line tool. Node.js is
not required. Portable ZIPs and signed sideloading packages are alternatives described below.

- Windows 10 version 1809 (build 17763) or later, on x64 or ARM64.
- Microsoft Edge WebView2 Runtime for the native UI and CLI validation. The slide view,
  Architecture Editor, presenter view, and native audience window need no separate browser.
- An installed Microsoft Edge, Google Chrome, or Chromium for layout-dependent CLI inspection,
  PNG capture, and PDF/PowerPoint export from either the GUI or CLI.

MarkdStage does not download or install browsers or runtimes. Browser policy that disables
remote debugging prevents layout inspection, capture, and export.

## Features

- Open a workspace folder, browse and filter its deck files, and return to recent workspaces.
- Open `.md` and `.markdown` files with the Windows file picker or drag and drop.
- Use the shared slide controls, theme selection, and fixed 16:9 Output preview.
- Switch to presenter view for current/next slides and Slidev/Marp-style speaker notes.
- Open the slide list from the shared controls or with O, then jump to any slide.
- Navigate with the arrow keys, PageUp/PageDown, Space, Home, and End.
- On the current slide in the audience and presenter views, left-click or tap a margin to move
  forward and right-click a margin to move back.
- Reload automatically when the Markdown file is saved while preserving the current slide.
- Preserve the last valid deck when a reload fails.
- Install packaged MarkdStage Agent Skills for Codex, Claude Code, and GitHub Copilot into an open
  workspace, with explicit force-overwrite control for locally modified files.
- Edit existing Architecture DSL diagrams in a native editor window and write changes back to
  Markdown with explicit **Save**.
- Open the audience view as a native WinUI 3 window from the shared MarkdStage controls.
- Export PDF and hybrid editable PowerPoint from the GUI or the included CLI.
- Support dark, light, Microsoft, and custom themes; Mermaid; code highlighting; Architecture DSL;
  and local images.

The audience window opens at 1280x720 with a standard title bar in the default Windows position.
Press F11 to enter full screen and Esc to return to windowed mode. Esc in windowed mode does not
interfere with the slide's existing behavior. State stays synchronized whether the presentation is
started or ended from the main window, the audience window is closed directly, or the app exits.

Surface Pen controls are active only while the audience window opened from the main window is
running. Press the tail button once to move forward and hold it to move back. Removing, connecting,
or docking the pen never launches the app or audience window, and pen input never opens or closes
the audience window.

Margin clicks exclude interactive areas such as slide content, links, and images. The next-slide
preview in presenter view is display-only. Opening a Markdown file starts in the normal slide view;
presenter view is an explicit transition from the same controls used by the CLI application.

## Development environment

1. Install the Copilot CLI plugin.

   ```powershell
   copilot plugin marketplace add microsoft/win-dev-skills
   copilot plugin install winui@win-dev-skills
   ```

2. Install .NET SDK 10.x and WinApp CLI 0.6.0 or later, and enable Developer Mode.
3. Run `scripts\BuildAndRun.ps1 --arch arm64` or
   `scripts\BuildAndRun.ps1 --arch x64`.

`BuildAndRun.ps1` uses the analyzer bundled with the WinUI plugin and
`winapp run --debug-output`. CI runs `dotnet build` and `dotnet test` without depending on the
plugin.

## Testing

```powershell
dotnet test tests\MarkdStage.Core.Tests\MarkdStage.Core.Tests.csproj
npm run test:unit
```

The Windows-only CLI tests exercise the native message layout, STA message pump,
WebView2 event delivery after forced garbage collection, and the production
packaged script host. They verify the generated validation/scanner-module closure,
SHA-256-identical validation/scanner modules, the pinned Marked lexer, and Adaptive Cards SDK chunks over
the native virtual-host mapping, and schema diagnostics without loading the SDK
or launching an external browser, including quoted/list-prefixed, info-suffixed,
and unclosed card fences. The Core tests also verify the modules and
assembled SDK bytes through the native HTTP `PresentationServer`.
Run them natively on both x64 and ARM64 (CI uses separate runners):

```powershell
dotnet test tests\MarkdStage.Cli.Tests\MarkdStage.Cli.Tests.csproj -c Release -r win-arm64 -p:Platform=ARM64
dotnet build src\MarkdStage.Cli\MarkdStage.Cli.csproj -c Release -r win-arm64 -p:Platform=ARM64
$env:MARKDSTAGE_NATIVE_CLI = (Resolve-Path "src\MarkdStage.Cli\bin\ARM64\Release\net10.0-windows10.0.26100.0\win-arm64\MarkdStageCli.exe").Path
node --test tests\native-export-report.test.mjs tests\native-cli.test.mjs
```

Use `win-x64` and `Platform=x64` for x64. The command smoke tests verify the
packaged `guide adaptive-cards` topic, valid and invalid schema diagnostics,
inspection results, and actual PNG/PDF/PowerPoint files, including Adaptive Card
PNG and whole-card raster PowerPoint output. They require WebView2 and an
installed Chromium browser and bound each command to 120 seconds. To run only
the guide and validation checks, without an external Chromium browser:

```powershell
node --test --test-name-pattern "guide|validation" tests\native-cli.test.mjs
```

These tests exercise native host and CLI paths, not the complete WinUI shell.
For installed-MSIX
acceptance, set `MARKDSTAGE_NATIVE_CLI` to the installed `markdstage.exe` alias
instead; source-build smoke tests do not replace package activation checks.

The optional `tests\MarkdStage.WebView2.Probe` console harness measures real
1280x720 WebView2 rendering using the existing STA dispatcher. It is not the
hidden CLI script host or a test of the WinUI shell. See the
[Adaptive Cards fixture instructions](../../test/fixtures/adaptive-cards/README.md)
for engine comparison, actual PPTX generation, and PowerPoint COM inspection.

## MSIX build

Publish the GUI and console launcher into one package, including Windows App SDK,
.NET, and the shared JavaScript/renderer assets. Use a publisher matching your
development signing certificate:

```powershell
scripts\Publish.ps1 -Architecture x64 -CertificatePath <certificate.pfx> -Publisher <certificate-subject>
scripts\Publish.ps1 -Architecture arm64 -CertificatePath <certificate.pfx> -Publisher <certificate-subject>
```

The output is `artifacts\MarkdStage-win-<architecture>.msix` and a SHA-256 checksum.
The single application entry is `MarkdStageApp.exe`; the `markdstage.exe` execution
alias targets `MarkdStageCli.exe`. For unsigned Store submission artifacts use
`-Unsigned -PackageName <Partner-Center-name> -Publisher <Partner-Center-publisher>`.
Unsigned output is not an installable public release. Supply `-Version <major.minor.patch.0>`
when preparing the product release; use the actual Store identity, not the checked-in
development placeholder.

Create the unsigned multi-architecture Partner Center upload package locally:

```powershell
scripts\CreateStorePackage.ps1 -Version <major.minor.patch.0>
```

The script uses the Store identity in `Package.appxmanifest`, builds x64 and ARM64,
and writes `artifacts\MarkdStage-Store-<version>.msixupload` plus its SHA-256 checksum. The
standard release process runs this script as its final step after GitHub Release and
npm verification. Upload the `.msixupload` file to Microsoft Store Partner Center
only when submission is explicitly requested. GitHub Release MSIX files are
separately signed sideloading packages and are not Store submission inputs.

Microsoft Edge WebView2 Runtime is required on the target system. The audience view uses a native
window built into the app and needs no separate browser. GUI and CLI exports require an installed
Edge, Chrome, or Chromium, as described under Installation and requirements.

## Markdown and assets

- Separate slides with `---` after a blank line.
- Resolve the `assets\` folder next to the Markdown file first, then the `assets\` folder at the
  nearest Git root.
- For Markdown files outside Git, treat the file's directory as the workspace root.
- Resolve `theme-file` from the Markdown directory first, then the Git root.
- Custom theme metadata supports decorative `background` images at the root and under
  `layouts.default.background` and `layouts.center.background`, using `{ "image": "assets/image.png" }`
  with optional `alt` text.
- Set `background-image: /assets/image.png` (or `assets/image.png`) on any slide to override its
  background. This does not inherit from the first slide. Filenames may contain spaces, Unicode,
  parentheses, dotfiles, and literal percent signs; do not URL-encode them in Markdown.
- Background images must be local SVG, PNG, WebP, JPG, or JPEG files no larger than 2 MiB.
  Invalid declarations fail before loading or reloading the deck, retaining the last valid state;
  background requests also recheck confinement, format, and size.
- Write speaker notes in top-level HTML comments on each slide. Comments inside code fences and
  `slide-size` directives are excluded from speaker notes.
- Reject paths outside the workspace, junction or symlink escapes, and oversized files.

For a source-backed deck, **More controls → Shape editing** opens the shared Architecture Editor
in a native window. It edits existing `architecture` fences only and writes changes explicitly on
**Save**, rejecting stale saves when the Markdown changed externally. The app does not include a
general Markdown text editor: edit slide text and other Markdown in an external editor or AI tool,
then save the file to reload the deck.

### GUI Agent Skills installation

Open a workspace and choose **Install skills…** from its file list. Select Codex, Claude Code,
GitHub Copilot, or a combination, then choose **Install**. The installer writes only to the
selected workspace:

- Codex: `.agents\skills\markdstage`
- Claude Code: `.claude\skills\markdstage`
- GitHub Copilot: `.github\skills\markdstage`

Modified skill files are left untouched unless **Force overwrite modified skill files** is
selected. Review conflicts before using this option; it replaces local edits in the selected skill
directories. Installing Skills writes instruction files, not an AI client. AI tools are installed
and operated separately and have their own data-handling policies.

### PDF and PowerPoint export

With a deck open, use **More controls → Output preview** to check the fixed 16:9 layout. Choose
**Export PDF** or **Export PowerPoint…** from the same menu. GUI exports are saved beside the source
Markdown with the same base name and a `.pdf` or `.pptx` extension, replacing an existing export at
that path. The completion notification shows the saved path; select it to open the file with its
Windows-associated application.

PowerPoint output is hybrid: supported text, shapes, and connectors remain editable, while
unsupported visuals or effects may be retained as images. In the PowerPoint dialog, Mermaid
**Editable shapes** uses editable objects where supported and image fallbacks for unsupported
details; **Images** keeps each Mermaid diagram as one image. Not every part of a slide becomes an
editable PowerPoint object. Review the exported file before distributing it.

The included CLI supports the same output formats:

```powershell
markdstage export slides.md --output slides.pdf
markdstage export slides.md --output slides.pptx
```

Both GUI and CLI exports require the external Chromium-based browser described above. Export
paths must remain inside the workspace.

CLI export text reports whole-card PowerPoint artwork reasons and card warnings with their
page, source JSONPath, severity, message, and diagnostic code, matching the npm CLI.
`--json` retains the structured report; PDF card decks additionally include `adaptiveCards`,
`adaptiveCardIssueCount`, and `adaptiveCardsTruncated`. Those fields are absent on card-free PDF decks.

## Desktop packages and Microsoft Store distribution

MarkdStage is available from the
[Microsoft Store](https://apps.microsoft.com/detail/9N9DG772RM03). GitHub Releases
also contain portable ZIPs and signed sideloading MSIX files. The Microsoft Store
upload package is created locally as the final release step after the GitHub
Release is verified, then submitted separately through Partner Center only on
explicit request. Package identity/publisher values must match Partner Center.

Portable packages are self-contained and include `MarkdStageApp.exe`,
`MarkdStageCli.exe`, the Windows App SDK/.NET runtime, and the shared renderer
assets. They do not include Node.js. Extract the ZIP and run
`.\MarkdStageApp.exe`, or open a single file with
`.\MarkdStageApp.exe "C:\decks\slides.md"`. The graphical executable accepts no
arguments or one `.md`/`.markdown` path; it does not parse CLI subcommands or
`--workspace`. Use the folder picker to choose a workspace.

The portable `.\MarkdStageCli.exe` supports console commands, including export.
Native GUI handoff requires an installed package and its execution alias; for a
portable local server, use `.\MarkdStageCli.exe preview slides.md --no-open`.
These packages remain available when Store installation is not suitable.

The packaged CLI uses the alias `markdstage` and does not bundle or acquire Node.
Bare invocation, direct Markdown, `preview`, and `present` activate the installed
native app through the current package's single application entry, reusing its
`AppInstance` and canonical-workspace window. Bare invocation opens the caller's
current directory with no file selected; a reused workspace shows its file list
and stops its audience window, retaining the previous deck behind the list.
Direct Markdown and `preview` select slide view; `present` enters presenter view
and opens the native audience window, reusing it on repeated requests. Native
`present` requires a file; file-less `present` is supported only with `--no-open`.

Relative file and `--workspace` arguments are made absolute against the caller's
directory before the common resolution rule. A file chooses its nearest `.git`
ancestor or containing folder, without requiring Git. Both CLI and app enforce
canonicalization, link rejection, containment, existence, and Markdown extensions.
The CLI returns success only after the app acknowledges acceptance, including its
actual `processId` and `windowId` for automation; rejection or timeout is an
`activation_failed` environment error. See the
[CLI guide](../../docs/user-guide/cli.md) for the acceptance JSON contract.

`--watch` uses always-enabled native Markdown watching. `--theme` and `--theme-file`
are rejected on native handoff: choose the theme in the app or use `--no-open`.
`--no-open` explicitly keeps the existing local server running until Ctrl+C, with
its theme overrides and watch handling intact. The npm CLI is unchanged and
browser-based.

Packaged skill installation also defaults to the current directory; specify another
target root with, for example, `markdstage skill install --target codex --root C:\decks`.
Help, version, `guide`, and `skill` need no browser. These and `validate`, `inspect`,
`capture`, and `export` stay console-only and never activate the presentation app.

`inspect --fail-on-issues` exits with code 5 for clipping or Adaptive Card content
diagnostics. Card warnings and image placeholders are not clipping:
`hasAdaptiveCardIssues` and `adaptiveCardIssueCount` report them separately from
`hasIssues` and `issueCount`. Inspection text and JSON output retain the card diagnostic
code, JSONPath, source path, severity, and content impact.

### Store listing prerequisite disclosure

MarkdStage is a workspace-based Windows application for Markdown slide decks.
The Microsoft Store installation includes the graphical app and CLI, without
Node.js. The GUI provides the shared slide UI, theme selection, workspace-scoped
Agent Skills installation, Architecture editing with explicit Save, presenter
view, and a synchronized native audience window. PDF and hybrid editable
PowerPoint exports are available from both the GUI and CLI.

Windows 10 version 1809 or later and Microsoft Edge WebView2 Runtime are required.
The included command-line tool opens the native app for interactive use, including
presentation; no separate browser is needed for those commands or for validation.
Command-line layout inspection and capture, plus GUI and CLI export, additionally
require installed Microsoft Edge, Google Chrome, or Chromium.
Organization policy disabling remote debugging prevents inspection, capture, and
export. No browser or runtime is downloaded or installed by MarkdStage.

Decks and installed Skills remain in local workspace files. MarkdStage does not
require a MarkdStage account or upload decks to a MarkdStage service. Separately
used AI assistants and services have their own data-handling policies.

### Windows package acceptance

Run these checks for package changes and before Store submission. A successful
source build is not a substitute for package activation tests.

From the repository root, run the durable packaged-activation harness:

```powershell
.\apps\MarkdStage.Desktop\scripts\Test-PackagedActivation.ps1 -CliPath markdstage.exe -ArtifactsDirectory .\artifacts\packaged-activation-x64
```

`-CliPath` defaults to `markdstage.exe`; supply the path to the **installed
execution alias** if needed to avoid an npm command or another installation.
`-ArtifactsDirectory` selects the results/screenshot directory; use a separate
directory for each architecture/run. The script exercises an **already registered
package** in an interactive Windows desktop session. It does not install or
register a package. Review its artifacts alongside the manual checks below.

**Verification:** all eight behavioral acceptance groups passed for ARM64 and x64
using isolated registered test packages. The published Store package has also
completed Store-distributed activation, WebView2, and external-browser
verification. Repeat the relevant checks for future package submissions.

- Verify the package has one application entry, Start-menu activation opens the
  native window, and `markdstage` resolves to the console launcher. Run from a
  different directory, with Unicode/spaced filenames and redirected UTF-8 output.
- With no app running, test bare `markdstage`, direct Markdown,
  `preview <file>`, and `present <file>` through the installed alias, not an
  unpackaged executable. Expect native windows and no external browser.
- Run bare `markdstage` from a repository root and a non-repository directory
  different from the package directory. Confirm the caller's directory is the
  workspace and no file is selected, including a folder with exactly one deck.
  Repeat with `--workspace .` and a relative explicit workspace.
- Test relative and absolute `.md` / `.markdown` paths, quoted paths containing
  spaces and Unicode, and file-derived `.git` roots (including worktree markers)
  versus containing-directory fallback. Combine a relative file and relative
  `--workspace`; both must resolve against caller CWD, not the app directory.
- Repeat requests with the app already running, including a workspace opened
  through the GUI and equivalent canonical spellings/casing of the same root.
  Confirm one workspace window is reused. A workspace-only request shows its
  file list and stops the audience window, while retaining the loaded deck behind
  the list; a different root opens an independent workspace window.
- Confirm direct Markdown and `preview` start in normal slide view; `present`
  enters presenter view and opens the synchronized native audience window.
  Repeat `present` and verify the same audience window remains open, with no
  duplicate or toggle-close. Native `present` without a file must return a usage
  error; `present --no-open` without a file must retain headless serving.
- Check `--json` acceptance after both cold and redirected activation: exit `0`,
  `ok: true`, `accepted: true`, absolute `workspace`, absolute `file` or JSON
  `null`, the requested `mode`, and the actual native `processId` / `windowId`.
  Verify these identify the accepting app and reused workspace window, rather
  than treating the activation API's process ID as acceptance.
- Test missing files/directories, non-Markdown files, out-of-workspace files,
  symlinks/junctions, and inaccessible roots. Verify CLI rejection and app-side
  revalidation, including a file removed between CLI validation and app acceptance.
  Test app rejection, unavailable activation, and missing/late acknowledgement:
  no false success, nonzero environment error `activation_failed`, normal
  `{ok:false,error,message}` JSON, and bounded waiting.
- Test `--watch` and its omission: native saves reload automatically either way.
  Test both `--theme` and `--theme-file` on native handoff: usage error with
  instructions to choose the theme in the app or use `--no-open`, never silent
  ignore. With `--no-open`, verify no app/browser launch, long-running local
  serving, retained theme overrides/watch flags, and Ctrl+C cleanup.
- Verify help/version/guide/skill/validate/inspect/capture/export remain console
  operations with no native app activation. Confirm interactive native commands
  work with WebView2 but no external Chromium installed; retain the external
  browser requirement for inspect/capture/export.
- Test every CLI command, large JSON output, stdin/stdout pipelines, exact exit
  codes, Ctrl+C/Ctrl+Break, and browser/profile cleanup after cancellation and crash.
- Test `validate` with no external browser installed. Test layout/export commands
  with no browser and with remote debugging disabled by policy.
- Confirm external Chromium can write the package temporary profile and produce
  inspection, PNG, PDF, and editable PowerPoint output. Repeat this check with
  the Store-distributed candidate before future submission approval.
- Test folder/file picker, file association, drag-and-drop, `.git` worktree files,
  explicit workspace containment, symlinks/junctions/mount points, and size limits.
- Test recent-folder order/limit, unavailable-folder locate/remove, loss of an
  open workspace, one window per canonical root, and independent navigation across
  different workspaces. Failed reloads must retain the displayed deck.
- Test current/next previews, notes, audience open/close, F11/Esc, overview, pointer
  navigation, Surface Pen, custom themes, and existing representative decks.
- Test **Install skills…** from an open workspace: selected Codex, Claude Code,
  and Copilot targets only; unchanged files preserved; modified files reported
  as conflicts unless force overwrite is explicitly selected.
- Test **Shape editing** in a native Architecture Editor window. Diagram changes
  must not update the Markdown before **Save**; saving updates the existing
  fence and reloads the deck. An external source change must reject a stale save.
- Test GUI **Output preview**, **Export PDF**, and **Export PowerPoint…** with a
  disposable deck. Verify output beside the source, same-name replacement,
  completion/error notifications, and opening the saved file. Check both Mermaid
  output choices and hybrid editability. Missing browsers or blocked remote
  debugging must report export failure, not success.
- Test missing WebView2/inaccessible data storage: selectable full-window
  recovery text, vendor link, retry, and a still movable/closable window.
- Verify restart persists only recent workspaces, window geometry, and chosen
  theme; uninstall leaves workspace content intact. Check that no general
  Markdown text editor or archive detection/migration appears.

Cross-surface boundaries and invariants are documented in
[`docs/architecture.md`](../../docs/architecture.md). This file remains the
current source for Desktop-specific behavior and package acceptance checks.
