<p align="center">
  <img src="../../assets/brand/markdstage-mark.svg" alt="MarkdStage" width="96">
</p>

> 日本語版: [日本語](ja/README.md)

# MarkdStage user guide

MarkdStage provides Markdown slide authoring, diagram editing, preview, presentation, and export.
On Windows, Microsoft Store installs the desktop GUI and CLI together. The same Markdown deck
can also be opened in the GitHub Copilot Canvas Extension or the npm CLI's browser UI.

![A sample Architecture diagram open in MarkdStage Desktop](images/windows-slide.png)

## Choose how you want to work

| Surface | Best for | Main capabilities |
| --- | --- | --- |
| [**Windows Desktop and included CLI**](desktop.md) | Working with decks on Windows, with or without an external AI tool | Workspace browsing, Skill installation, Architecture editing, output preview, presenter view, native audience window, and GUI/CLI PDF and PowerPoint export |
| [**Canvas Extension**](canvas-extension.md) | Creating and revising a deck with GitHub Copilot | Markdown import, live refresh, presenter view, Architecture editing, 16:9 validation, and PDF and editable PowerPoint export |
| [**npm CLI**](cli.md) | Working in a terminal, CI, Codex, or Claude Code without the Windows package | Browser-based slide UI, deck validation, clipping diagnostics, PNG capture, PDF and PowerPoint export, and Agent Skills |

All three surfaces support Markdown, syntax-highlighted code, Mermaid, Architecture DSL, local
images, speaker notes, and the built-in dark, light, and Microsoft themes.

## Start here

1. [Install MarkdStage](installation.md) for Canvas Extension, CLI, or Desktop.
2. Follow the [quick start](quick-start.md) to open your first deck.
3. Follow the [Windows walkthrough](windows-walkthrough.md) for workspace, Skills, diagram editing, and output.
4. Learn [AI-assisted authoring](ai-assisted-authoring.md) or complete the [GitHub Copilot hands-on](copilot-hands-on.md).
5. Learn the [Markdown authoring format](markdown-authoring.md).
6. Review [themes and layouts](themes-and-layouts.md).
7. Add [diagrams and media](diagrams-and-media.md).
8. Prepare the [presentation and PDF or PowerPoint output](presenting-and-export.md).

## Feature guide

| Topic | Guide |
| --- | --- |
| Install the Canvas Extension, CLI, or Desktop app | [Installation](installation.md) |
| Windows workflow with a fictional sample, screenshots, and a short recording | [Windows walkthrough](windows-walkthrough.md) |
| AI-assisted creation, schemas, diagnostics, and targeted visual review | [AI-assisted authoring](ai-assisted-authoring.md) |
| Recorded prompt-to-PDF exercise with generated artifacts | [GitHub Copilot hands-on](copilot-hands-on.md) |
| Canvas toolbar, import, live refresh, slide list, and presenter view | [Canvas Extension](canvas-extension.md) |
| Windows workspace, Skill installation, Architecture editing, presentation, and export | [MarkdStage Desktop](desktop.md) |
| Separators, front matter, content sizes, notes, code, tables, and assets | [Markdown authoring](markdown-authoring.md) |
| Dark, light, Microsoft, custom themes, and slide layouts | [Themes and layouts](themes-and-layouts.md) |
| Mermaid, Architecture DSL, images, and visual Architecture editing | [Diagrams and media](diagrams-and-media.md) |
| Audience windows, synchronized navigation, clipping checks, and PDF and PowerPoint export | [Presenting and export](presenting-and-export.md) |
| Terminal commands, exit codes, JSON output, and Agent Skills | [MarkdStage CLI](cli.md) |
| Common setup, loading, rendering, and editing problems | [Troubleshooting](troubleshooting.md) |

## Requirements

- **Canvas Extension:** GitHub Copilot with the MarkdStage extension installed for the current
  project or user.
- **Windows GUI and packaged CLI:** Windows 10 version 1809 or later (x64 or ARM64) and
  Microsoft Edge WebView2 Runtime. Install from Microsoft Store, or choose a portable/sideloading
  alternative. GUI exports and CLI inspection/capture/export also require an installed
  Edge, Chrome, or Chromium browser. No Node.js is needed.
- **npm CLI:** Node.js 24 or later and an installed Microsoft Edge, Google Chrome, or Chromium.
- **AI assistance (optional):** an external AI tool and the matching workspace Skill, or
  GitHub Copilot App with the Canvas Extension. Desktop itself has no AI chat.
- **Deck source:** A `.md` or `.markdown` file inside the current workspace.

[Open the quick start →](quick-start.md)
