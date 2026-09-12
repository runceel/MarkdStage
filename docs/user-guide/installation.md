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

## MarkdStage CLI

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

1. Download the x64 or ARM64 portable ZIP from the
   [latest release](https://github.com/runceel/markdstage/releases/latest).
2. Extract the complete folder.
3. Run `MarkdStageApp.exe`.

See [MarkdStage Desktop](desktop.md) for presenting and navigation instructions.

### Desktop v4 / Microsoft Store transition

The MSIX conversion is in development; the instructions above remain for the
published archive release. Store availability must be announced only after package
acceptance. The v4 package includes the `markdstage` console alias and does not
require Node.js. The desktop app is a **presenter**, with no PDF or PowerPoint
export buttons; exports remain CLI-only.

WebView2 Runtime is required for the app and the packaged CLI's script execution.
Present/preview and layout inspection, capture, PDF, and PowerPoint export also
require an installed Chromium-based browser. Remote debugging disabled by enterprise
policy prevents inspection/capture/export; installing MarkdStage does not change
that policy. `help`, `guide`, and skill installation do not require a browser.
The app links to Microsoft's runtime download page and never downloads or installs
third-party runtimes itself.

The packaged CLI requires explicit paths: use a Markdown file or `--workspace`
for deck commands, and `--root` (or `--workspace`) for `skill install` / `skill check`.

The first Store release is the archive cutover: **no further archive updates of any
kind will be published after it**. Install the Store version, open the same workspace,
then delete the old extracted application folder. Keeping both installations is not
a supported configuration. There is no archive detection or automatic migration:
recent folders and window/theme preferences start fresh. Your Markdown, assets,
and themes remain unchanged. Uninstalling the package removes its private settings
and temporary data, not files in your workspaces.
