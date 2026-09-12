# MarkdStage Desktop

**Markdown, ready for the stage.**

MarkdStage (pronounced "marked stage") is a WinUI 3 app that displays Markdown with the same
renderer as the MarkdStage canvas, independently of the GitHub Copilot App.

## Features

- Open `.md` and `.markdown` files with the Windows file picker.
- Preview the current and next slides in 16:9.
- Show Slidev/Marp-style HTML comments as speaker notes for the current slide.
- Open the slide overview from the toolbar or with O, then jump to any slide.
- Navigate with the arrow keys, PageUp/PageDown, Space, Home, and End.
- On the current slide in the audience and presenter views, left-click or tap a margin to move
  forward and right-click a margin to move back.
- Reload automatically when the Markdown file is saved while preserving the current slide.
- Preserve the last valid deck when a reload fails.
- Open the audience view as a native WinUI 3 window with a full-bleed WebView2 in the same process.
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
preview in the presenter view is display-only.

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

Run the UI Automation tests while the app is running.

```powershell
tests\MarkdStage.UiTests\ui-tests.ps1 -AppPid <PID>
```

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

Markdown editing, PDF export, the Architecture editor, and a timer are outside the scope of the
initial release.

## Desktop v4 package and Store cutover

The v4 implementation targets MSIX; it has not been released to the Store by this
change. Package identity/publisher values must match Partner Center before Store
submission. The existing [MSIX specification](docs/desktop-behaviour-msix.md) stays
in place until v4 ships.

The first Store release ends archive distribution immediately: no new archive
builds or updates of any kind follow it. Install the Store version and remove the
old extracted app folder; retaining both is not supported. There is no archive
detection or state migration. Recent workspaces and window/theme settings start
fresh, but decks, assets, and themes are unchanged. Uninstall removes package-owned
settings and temporary data, never workspace files.

The packaged CLI uses the alias `markdstage` and does not bundle or acquire Node.
Pass a Markdown file or `--workspace`; a process working directory alone is not a
workspace. Relative shell arguments are made absolute before the common resolution
rule. A file chooses its nearest `.git` ancestor or its containing folder, without
requiring Git.

For packaged skill installation, specify the target root explicitly, for example
`markdstage skill install --target codex --root C:\decks`. `help` and `guide`
need no workspace or browser.

### Store listing prerequisite disclosure

**MarkdStage — Markdown, ready for the stage.** Present Markdown decks with a
current/next-slide presenter view, speaker notes, a synchronized audience window,
and Surface Pen navigation. Open your own workspace folders; your content stays
in your files. The graphical app is a presenter, not a PDF/PowerPoint exporter.
PDF and PowerPoint exports are available through the included command-line tool.

Microsoft Edge WebView2 Runtime is required. The command-line presentation,
inspection, capture, and export commands additionally require an installed
Microsoft Edge, Google Chrome, or Chromium browser. Organization policy disabling
remote debugging prevents inspection, capture, and export. No browser or runtime
is downloaded or installed by MarkdStage.

### Windows acceptance before submission

Run these checks on a locally registered package for both supported architectures;
a successful source build is not a substitute for package activation tests.

- Verify the package has one application entry, Start-menu activation opens the
  native window, and `markdstage` resolves to the console launcher. Run from a
  different directory, with Unicode/spaced filenames and redirected UTF-8 output.
- Test every CLI command, large JSON output, stdin/stdout pipelines, exact exit
  codes, Ctrl+C/Ctrl+Break, and browser/profile cleanup after cancellation and crash.
- Test `validate` with no external browser installed. Test layout/export commands
  with no browser and with remote debugging disabled by policy.
- Confirm external Chromium can write the package temporary profile and produce
  inspection, PNG, PDF, and editable PowerPoint output. Repeat with the
  Store-distributed package before submission approval; this remains a release
  blocker until measured.
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

This file documents what the app does today. The user-facing behaviour planned for the MSIX /
Microsoft Store version is specified in
[docs/desktop-behaviour-msix.md](docs/desktop-behaviour-msix.md) until that version ships.
