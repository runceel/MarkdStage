# MarkdStage Desktop

**Markdown, ready for the stage.**

MarkdStage (pronounced "marked stage") is a WinUI 3 app that displays Markdown with the same
renderer as the MarkdStage canvas, independently of the GitHub Copilot App.

## Features

- Open `.md` and `.markdown` files with the Windows file picker.
- Open the same full slide-view application as `markdstage <file.md>`.
- Switch to presenter view for current/next slides and Slidev/Marp-style speaker notes.
- Open the slide list from the shared controls or with O, then jump to any slide.
- Navigate with the arrow keys, PageUp/PageDown, Space, Home, and End.
- On the current slide in the audience and presenter views, left-click or tap a margin to move
  forward and right-click a margin to move back.
- Reload automatically when the Markdown file is saved while preserving the current slide.
- Preserve the last valid deck when a reload fails.
- Install packaged MarkdStage Agent Skills for Codex, Claude Code, and GitHub Copilot into an open
  workspace, with explicit force-overwrite control for locally modified files.
- Open the audience view as a native WinUI 3 window from the shared MarkdStage controls.
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
and WebView2 event delivery after forced garbage collection. Run them natively on
both x64 and ARM64 (CI uses separate runners):

```powershell
dotnet test tests\MarkdStage.Cli.Tests\MarkdStage.Cli.Tests.csproj -c Release -r win-arm64 -p:Platform=ARM64
dotnet build src\MarkdStage.Cli\MarkdStage.Cli.csproj -c Release -r win-arm64 -p:Platform=ARM64
$env:MARKDSTAGE_NATIVE_CLI = (Resolve-Path "src\MarkdStage.Cli\bin\ARM64\Release\net10.0-windows10.0.26100.0\win-arm64\MarkdStageCli.exe").Path
node --test tests\native-cli.test.mjs
```

Use `win-x64` and `Platform=x64` for x64. The command smoke tests require WebView2
and an installed Chromium browser, bound each command to 120 seconds, and verify
inspection results and actual PNG/PDF/PowerPoint files. For installed-MSIX
acceptance, set `MARKDSTAGE_NATIVE_CLI` to the installed `markdstage.exe` alias
instead; source-build smoke tests do not replace package activation checks.

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
and writes `artifacts\MarkdStage-Store.msixupload` plus its SHA-256 checksum. Upload
the `.msixupload` file to Microsoft Store Partner Center. GitHub Release MSIX files
are separately signed sideloading packages and are not Store submission inputs.

Microsoft Edge WebView2 Runtime is required on the target system. The audience view uses a native
window built into the app, so a separate Edge, Chrome, or Chromium installation is not required.

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
**Save**, rejecting stale saves when the Markdown changed externally. General Markdown editing and
PDF export, and a timer remain outside the scope of the initial release.

## Desktop v4 packages and Microsoft Store submission

The v4 implementation provides both portable Windows packages and MSIX packages.
GitHub Releases contain the portable ZIPs and signed sideloading MSIX files. The
Microsoft Store upload package is created locally after the GitHub Release and
submitted separately through Partner Center. Package identity/publisher values must
match Partner Center before Store submission.

Portable packages are self-contained and include `MarkdStageApp.exe`,
`MarkdStageCli.exe`, the Windows App SDK/.NET runtime, and the shared renderer
assets. They do not include Node.js. Extract the ZIP and run
`MarkdStageApp.exe`. The portable packages remain available from GitHub Releases
until a future Store cutover is explicitly announced.

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

### Store listing prerequisite disclosure

**MarkdStage — Markdown, ready for the stage.** Present Markdown decks with a
current/next-slide presenter view, speaker notes, a synchronized audience window,
and Surface Pen navigation. Open your own workspace folders; your content stays
in your files. The graphical app is a presenter, not a PDF/PowerPoint exporter.
PDF and PowerPoint exports are available through the included command-line tool.

Microsoft Edge WebView2 Runtime is required. The included command-line tool opens
the native app for interactive use, including presentation; no separate browser
is needed for those commands. Command-line inspection, capture, and export
additionally require installed Microsoft Edge, Google Chrome, or Chromium.
Organization policy disabling remote debugging prevents inspection, capture, and
export. No browser or runtime is downloaded or installed by MarkdStage.

### Windows acceptance before submission

Run these checks on a locally registered package for both supported architectures;
a successful source build is not a substitute for package activation tests.

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

**Local verification:** all eight behavioral acceptance groups passed for ARM64
and x64 using isolated registered test packages on an ARM64 host. This does not
establish native x64 hardware coverage or Store-distributed package acceptance,
and does not indicate a deployment or release.

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
  inspection, PNG, PDF, and editable PowerPoint output. Repeat with the
  Store-distributed package before submission approval; this remains a Store
  submission blocker until measured.
- Test folder/file picker, file association, drag-and-drop, `.git` worktree files,
  explicit workspace containment, symlinks/junctions/mount points, and size limits.
- Test recent-folder order/limit, unavailable-folder locate/remove, loss of an
  open workspace, one window per canonical root, and independent navigation across
  different workspaces. Failed reloads must retain the displayed deck.
- Test current/next previews, notes, audience open/close, F11/Esc, overview, pointer
  navigation, Surface Pen, custom themes, and existing representative decks.
- Test missing WebView2/inaccessible data storage: selectable full-window
  recovery text, vendor link, retry, and a still movable/closable window.
- Verify restart persists only recent workspaces, window geometry, and chosen
  theme; uninstall leaves workspace content intact. Check that no GUI export
  controls or archive detection/migration appear.

## Specification lifetime

This file documents what the app does today. Store-specific acceptance behavior is specified in
[docs/desktop-behaviour-msix.md](docs/desktop-behaviour-msix.md) until the Store listing ships.
