# MarkdStage for VS Code

This extension is a thin workspace-host wrapper over the independently installed
MarkdStage CLI. It does not bundle the CLI, parser, renderer, validator, or
generated Agent Skill content.

The extension and CLI share one product version. Version `4.5.1` of this
extension recommends MarkdStage CLI `4.5.1` and accepts any CLI from the
`markdstage.minimumCliVersion` declared in `package.json` up to the same major
version. An older but compatible CLI shows an update recommendation; a CLI below
the minimum or with a newer major version is rejected with installation guidance.

## Commands

- **MarkdStage: Refresh / Detect CLI**
- **MarkdStage: Preview Current Markdown**
- **MarkdStage: Present Current Markdown**
- **MarkdStage: Validate Current Markdown**
- **MarkdStage: Install GitHub Copilot Skill**
- **MarkdStage: Check GitHub Copilot Skill**
- **MarkdStage: Stop Preview Sessions**

Preview and presentation run the CLI with live watching, wait for its bounded
`--json-lines` ready event, validate that the returned URL is loopback-only, and
open it in VS Code Simple Browser. If Simple Browser is unavailable, the URL is
opened in the external browser. Sessions are owned by the extension and stopped
when requested or when the extension deactivates.

When a PDF or PowerPoint export finishes in a preview, the extension offers
actions to open the saved file or reveal it in the Explorer view.

Validation runs `markdstage validate --json` and publishes the best available
CLI ranges to a `DiagnosticCollection`.

Skill commands use:

```text
markdstage skill <install|check> --target copilot --root <workspace> --json
```

Locally modified generated files are not overwritten unless the user explicitly
confirms a force overwrite.

## CLI discovery and installation

Set `markdstage.executablePath` to a preferred executable in the extension-host
environment. Discovery tries that path first and then `markdstage` from `PATH`.
Candidates must successfully return a semantic product version from `--version`
that is within the compatible range.

The extension never installs the CLI automatically. On local Windows it links
to the Microsoft Store first. On other platforms and remote extension hosts it
links to the npm package and installation documentation. Remote workspaces need
the CLI installed in the remote extension-host environment.

## Workspace Trust and support

CLI detection, other process execution, and workspace writes are disabled until
the workspace is trusted. Virtual workspaces and VS Code Web are not supported.

## Development

```powershell
npm install
npm test
npm run build
npm run package
```

`npm run check:version` compares this package version with
`../markdstage-cli/package.json` and verifies that `markdstage.minimumCliVersion`
is a stable version no newer than the extension. Packaging creates `markdstage-vscode.vsix` and
then verifies that the VSIX contains the manifest, README, license, and bundled
extension entry point while excluding source, tests, scripts, lockfile, and
`node_modules`.

To try the extension against the in-repo CLI, run `node scripts\dev-vscode.mjs
[--cli node|native] [workspace-folder]` from the repository root. It builds the
extension and the selected CLI (`node`: `packages/markdstage-cli`, the default;
`native`: the Windows `MarkdStageCli.exe` from `apps/MarkdStage.Desktop`), puts a
`markdstage` launcher for it first on `PATH`, and opens an isolated VS Code
instance (`.dev/vscode/<cli>/`) with this extension loaded and Workspace Trust
disabled, so an installed release CLI is never picked up. Set
`MARKDSTAGE_VSCODE` to use a different VS Code launcher. To exercise Restricted
Mode, launch VS Code manually without `--disable-workspace-trust`.
