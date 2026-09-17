> 日本語版: [日本語](ja/installation.md)

# Install MarkdStage

On Windows, the Microsoft Store package installs the GUI and CLI together. Use the npm distribution
for a browser-based CLI, or install the Canvas Extension to work inside GitHub Copilot App.
These are alternatives; you do not need all of them.

## Windows: Microsoft Store

### Requirements

- Windows 10 version 1809 or later, on x64 or ARM64.
- Microsoft Edge WebView2 Runtime for the native UI and shared script execution.
- Installed Microsoft Edge, Google Chrome, or Chromium for layout inspection, PNG capture,
  and PDF/PowerPoint export, including export from the GUI.

The Windows package includes its .NET and Windows App SDK components. **Node.js and npm are not
required.** MarkdStage does not download or install third-party runtimes. Browser remote debugging
must be permitted for inspection, capture, and export; MarkdStage does not change organization policy.

### Install and open a workspace

1. Install [MarkdStage from Microsoft Store](https://apps.microsoft.com/detail/9N9DG772RM03).
2. Start **MarkdStage** from the Windows Start menu.
3. Select **Open folder…** and choose a folder for your Markdown, assets, and themes.
4. Select a Markdown file from the workspace list, or use **Open Markdown file…**.
5. If using an external AI tool, select **Install skills…** to install the appropriate Agent Skill
   into that workspace. Open the same folder in the AI tool.

See the [Desktop guide](desktop.md) for controls and the
[Windows walkthrough](windows-walkthrough.md) for screenshots and a sample.

### Use the included command

Open a new terminal after installation:

```powershell
markdstage --version
Get-Command markdstage -All
```

The package registers the `markdstage` app execution alias. If it is unavailable, check
**App execution aliases** in Windows Settings and reopen the terminal. If an npm installation
takes precedence, `Get-Command markdstage -All` shows the alternatives. There is no need to install
the npm package to repair the Store alias.

| Windows operation | Runtime used |
| --- | --- |
| Native workspace, slide preview, Architecture editing, presentation | WebView2 |
| GUI PDF/PowerPoint export | WebView2 and installed Edge, Chrome, or Chromium |
| CLI help, version, `guide`, `skill` | No browser |
| CLI `validate` | WebView2 |
| CLI `inspect`, `capture`, `export` | WebView2 and installed Edge, Chrome, or Chromium |

### Portable ZIP and sideloading alternatives

The [latest release](https://github.com/runceel/markdstage/releases/latest) provides x64 and ARM64
ZIPs, MSIX packages, and SHA-256 checksums. Download a trusted release matching your architecture
and compare its hash with the supplied `.sha256` file before use:

```powershell
Get-FileHash .\MarkdStage-win-arm64.zip -Algorithm SHA256
```

For a portable installation, extract the **entire** ZIP and run `MarkdStageApp.exe`. Open your
workspace from the GUI. `MarkdStageCli.exe` provides console operations such as validation and
export; a ZIP does not register the Store's `markdstage` alias. Native CLI-to-GUI activation requires
an installed MSIX package. Portable CLI browser serving uses `--no-open`; see the [CLI guide](cli.md).

For a release's signed sideloading MSIX, follow your organization's installation policy. Before
installing the matching MSIX, trust that release's `MarkdStage.cer` in the local machine's
**Trusted People** certificate store. Do this only after verifying the source and certificate;
Store installation does not require this manual certificate step.

## GitHub Copilot Canvas Extension

When this repository is opened as a project, the extension under
`.github/extensions/markdstage/` loads at project scope.

To install it at user scope in another repository, choose a trusted release tag and ask GitHub
Copilot:

> Install MarkdStage at user scope from the following GitHub repository folder.
>
> `https://github.com/runceel/markdstage/tree/<release-tag>/.github/extensions/markdstage`

Review local extension code before installing it. A release tag or commit SHA provides a
reproducible installation.

## MarkdStage CLI (npm)

These instructions install the browser-based npm CLI. For the Windows package's
native-app CLI, install [MarkdStage from Microsoft Store](https://apps.microsoft.com/detail/9N9DG772RM03)
and see [Windows package behavior](#windows-package-behavior).

### Requirements

- Node.js 24 or later.
- An installed Microsoft Edge, Google Chrome, or Chromium. MarkdStage never downloads a browser.

### Install

Run directly with `npx`, or install globally:

```console
npx @markdstage/markdstage --workspace .
npx @markdstage/markdstage slides.md
npm install --global @markdstage/markdstage
```

The first command explicitly selects the current folder and opens an empty UI. The second opens
`slides.md` in live slide view.

For offline installation, download the versioned `markdstage-markdstage-<version>.tgz` asset and
its `.sha256` checksum from the [GitHub Release](https://github.com/runceel/markdstage/releases),
verify the checksum, then install the tarball locally:

```powershell
Get-FileHash .\markdstage-markdstage-<version>.tgz -Algorithm SHA256
npm install --global .\markdstage-markdstage-<version>.tgz
```

## Windows package behavior

The Store package includes the `markdstage` console alias and does not require
Node.js. The GUI includes Architecture editing, output preview, presenter view,
and PDF/PowerPoint export. CLI commands provide diagnostics and automation for the same files.

WebView2 Runtime is required for the app and the packaged CLI's script execution.
Bare invocation, direct Markdown, `preview`, and `present` activate the installed
native app; they do **not** require a separate Chromium browser. `present` opens
presenter view and the native audience window. Layout inspection, capture, PDF,
and PowerPoint export still require installed Edge, Chrome, or Chromium. Remote
debugging disabled by enterprise policy prevents inspection/capture/export;
installing MarkdStage does not change that policy. Help, version, `guide`, and
skill commands do not require a browser. These and `validate`, `inspect`,
`capture`, and `export` remain console operations.
The app links to Microsoft's runtime download page and never downloads or installs
third-party runtimes itself.

The packaged CLI uses the caller's current directory as its workspace when invoked
without a Markdown file or `--workspace`, with no file selected. Existing workspace
windows are reused. Relative file and workspace arguments resolve against that
same directory. The command exits successfully only after the app accepts the
request; failures/timeouts return a nonzero `activation_failed` error.
`--no-open` explicitly retains the long-running local server until Ctrl+C.
Native Markdown watching is always enabled (`--watch` is accepted). Native handoff
rejects `--theme` / `--theme-file`: choose the theme in the app or use `--no-open`.
`skill install` and `skill check` also default to the current directory when
`--root` and `--workspace` are omitted. See the [CLI guide](cli.md) for JSON output.

The npm CLI remains browser-based. If npm and the package both provide
`markdstage`, check command resolution with `Get-Command markdstage`;
`npx @markdstage/markdstage` explicitly runs npm.

When moving from an extracted portable package to the Store package, open the
same workspace and then remove the old extracted application folder to avoid
command ambiguity. There is no archive detection or automatic preference
migration: recent folders and window/theme preferences start fresh. Your
Markdown, assets, and themes remain unchanged. Uninstalling the package removes
its private settings and temporary data, not files in your workspaces.
