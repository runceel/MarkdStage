# MarkdStage

MarkdStage is a GitHub Copilot Canvas for creating, refining, presenting, and exporting
Markdown-based slide decks.

## Installation

```console
copilot plugin install markdstage@awesome-copilot
```

The plugin is a local Canvas extension. It runs bundled Node.js code in the user's environment,
starts loopback HTTP servers bound to `127.0.0.1`, and reads or writes Markdown and asset files
inside the selected workspace. Presenter and PDF / PNG / PowerPoint export features may launch an
already-installed Microsoft Edge, Google Chrome, or Chromium browser. The extension does not
download a browser or require a remote service or API key.

Review the source before installation and prefer an immutable release tag or commit SHA.

## Features

- Display and navigate Markdown slides in the `MarkdStage` Canvas.
- Render Mermaid and Architecture diagrams with theme-aware editing.
- Import Markdown from the workspace and optionally watch it for changes.
- Open a synchronized presenter window.
- Inspect fixed 1280x720 layout output and export PDF or editable PowerPoint.
- Use the `markdstage_guide` tool for slide-format, theme, and Architecture DSL guidance.

## Requirements

- A GitHub Copilot host that supports Canvas extensions and the Agent Plugins format.
- Node.js supplied by the host for the Canvas extension.
- An installed Edge, Chrome, or Chromium browser for presenter and browser-backed export features.

## License

MarkdStage is distributed under the MIT License. Bundled third-party software and notices are
documented in `com.github.copilot/extensions/markdstage/THIRD-PARTY-NOTICES.md`.

## Source

This plugin is part of [MarkdStage](https://github.com/runceel/markdstage).
