> 日本語版: [日本語](ja/installation.md)

# Install MarkdStage

Choose the surface that matches how you want to work. The Canvas Extension is for authoring with
GitHub Copilot, the CLI is for terminal and automation workflows, and Desktop is for presenting on
Windows.

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

## MarkdStage Desktop

### Requirements

- Windows.
- Microsoft Edge WebView2 Runtime.

The portable package already includes the required .NET and Windows App SDK components.

### Install and start

Install [MarkdStage from Microsoft Store](https://apps.microsoft.com/detail/9N9DG772RM03).
The Store package includes the native app and the `markdstage` console alias.

Portable and signed sideloading packages from existing GitHub releases remain
available when Store installation is not suitable:

1. Download the x64 or ARM64 portable ZIP from the
   [latest release](https://github.com/runceel/markdstage/releases/latest).
2. Extract the complete folder.
3. Run `MarkdStageApp.exe`.

See [MarkdStage Desktop](desktop.md) for presenting and navigation instructions.

### Windows package behavior

The Store package includes the `markdstage` console alias and does not require
Node.js. The desktop app is a **presenter**, with no PDF or PowerPoint export
buttons; exports remain CLI-only.

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
