> 日本語版: [日本語](ja/vscode.md)

# Visual Studio Code extension

The MarkdStage extension for Visual Studio Code adds preview, presenter, validation, and Agent
Skill commands to Markdown editing. It is a thin wrapper over an installed MarkdStage CLI: the CLI
remains responsible for parsing, rendering, validation, workspace security, and Skill generation.

## Install the prerequisites

Install the VSIX from a trusted MarkdStage release, then install a compatible MarkdStage CLI in the
environment where the VS Code extension host runs.

- **Local Windows:** install [MarkdStage from Microsoft Store](https://apps.microsoft.com/detail/9N9DG772RM03).
  The Store package includes the `markdstage` command and does not require Node.js.
- **macOS or Linux:** install Node.js 24 or later, then install
  `@markdstage/markdstage` globally with npm.
- **Remote SSH, WSL, or Dev Containers:** install the npm CLI in that remote environment. A
  MarkdStage command installed only on the local computer cannot read the remote workspace.

```console
npm install --global @markdstage/markdstage
markdstage --version
```

The extension never installs or updates MarkdStage automatically. If it cannot find the command,
use its installation action and retry detection after installation. When the command is not on
`PATH`, set **MarkdStage: Executable Path** to the packaged or portable CLI executable.

## Preview and present

Open a `.md` or `.markdown` file and run **MarkdStage: Preview Current Markdown** or
**MarkdStage: Present Current Markdown** from the Command Palette.

The extension starts the installed CLI with a loopback-only `--no-open` server and automatic source
watching, then opens its token-scoped URL in Visual Studio Code's built-in browser. If the built-in
browser is unavailable, the extension offers to open the URL in the default external browser.
Starting the same view again replaces its existing session. Use **MarkdStage: Stop Preview Sessions**
to stop all owned servers; they are also stopped when the extension deactivates.

Preview and presenter commands require a trusted workspace because they execute an installed
program and read workspace content. The browser UI provides the same MarkdStage controls as the
CLI, including slide navigation, presenter notes, Architecture editing, output preview, the
external audience window (**Start presentation**), and PDF/PowerPoint export beside the source
file. These controls behave the same with the npm CLI and the packaged Windows CLI; the audience
window and export require an installed Chromium browser.

Run **MarkdStage: Edit Architecture Diagram** to open the same preview, then choose
**More controls > Shape editing** on a slide containing an Architecture DSL diagram. The command
is an editor-focused alias for preview; it does not use a separate VS Code editor or a private
editing mode. Shape editing is available directly in ordinary preview as well. It edits only
Architecture DSL diagrams; the Markdown source remains the source of truth and is updated through
the CLI's existing source-backed save path. In VS Code's built-in browser, the Architecture Editor
opens in a separate built-in browser tab while the preview remains open. The extension opens this
tab from a versioned loopback event emitted by the CLI rather than relying on browser pop-ups.
Save the diagram in the editor, then return to the preview tab and run validation if you want to
check the resulting source.

## Validate a deck

Run **MarkdStage: Validate Current Markdown** to invoke the installed CLI's structured validation.
Errors and warnings are shown in the Problems panel and remain aligned with the CLI version in use.
Save and validate again after correcting the Markdown.

## Install the GitHub Copilot Skill

After the CLI is detected, run **MarkdStage: Install GitHub Copilot Skill** for the current
workspace. The extension invokes:

```console
markdstage skill install --target copilot --root <workspace> --json
```

The generated Skill is written to `.github/skills/markdstage/`. It comes from the installed CLI,
not from a second copy bundled with the VS Code extension, so its instructions match that CLI's
commands and deck format.

Run **MarkdStage: Check GitHub Copilot Skill** after upgrading MarkdStage. Locally modified files
are reported as conflicts and are not overwritten. Force overwrite is available only after an
explicit confirmation.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| MarkdStage CLI is not found | Install the Store package on local Windows or the npm CLI in the extension-host environment, then retry detection. |
| The wrong CLI is selected on Windows | Run `Get-Command markdstage -All`, then set **MarkdStage: Executable Path** explicitly. |
| Preview does not start | Check the MarkdStage output channel for CLI stderr and confirm that the workspace is trusted. |
| A remote workspace cannot find the local CLI | Install the npm CLI inside Remote SSH, WSL, or the Dev Container. |
| Skill installation reports conflicts | Review the locally modified Skill files before explicitly choosing force overwrite. |
