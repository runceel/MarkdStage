<p align="center">
  <a href="https://github.com/runceel/markdstage">
    <img src="./assets/brand/markdstage-mark.svg" alt="MarkdStage" width="96">
  </a>
</p>

<h1 align="center">MarkdStage</h1>

<p align="center">
  <a href="./README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="https://github.com/runceel/markdstage/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/runceel/markdstage/actions/workflows/ci.yml/badge.svg"></a>
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-FFB547?labelColor=0B1020"></a>
  <img alt="Source format: Markdown" src="https://img.shields.io/badge/source-Markdown-F7F4ED?labelColor=0B1020">
  <img alt="Windows: x64 and ARM64" src="https://img.shields.io/badge/Windows-x64%20%7C%20ARM64-F7F4ED?labelColor=0B1020">
</p>

<p align="center">
  <a href="https://runceel.github.io/MarkdStage/en/">Website</a> |
  <a href="#use-the-canvas-extension">Canvas Extension</a> |
  <a href="#use-markdstage-desktop">Desktop</a> |
  <a href="#use-the-cli">CLI</a> |
  <a href="#community-macos-app">macOS app</a> |
  <a href="#see-markdown-on-stage">Examples</a> |
  <a href="#markdown-format">Markdown format</a> |
  <a href="#documentation">Documentation</a> |
  <a href="https://github.com/runceel/markdstage/releases">Releases</a>
</p>

MarkdStage is an open-source application for authoring, reviewing, presenting, and exporting
Markdown slides. The Windows application provides workspace browsing, visual Architecture diagram
editing, output preview, presenter and audience views, and PDF and PowerPoint export.
[Microsoft Store](https://apps.microsoft.com/detail/9N9DG772RM03) installs both the GUI and the
`markdstage` CLI. The GUI can also install Agent Skills into a workspace.

The same Markdown format is available in GitHub Copilot Canvas and the npm CLI. AI assistance is
optional: edit source text in your text editor, or use an external AI tool with MarkdStage guidance.
MarkdStage Desktop does not contain an AI chat interface.

<a id="why-markdstage"></a>

## Workflow

| Stage | What you can do |
| --- | --- |
| **Create** | Write Markdown in a text editor, copy an example, or ask an AI tool for a draft. Canvas guidance and Agent Skills describe the slide format and themes. |
| **Refine** | Edit wording in the source file. Use the Architecture Editor in Desktop, Canvas, or the CLI browser UI to change diagram shapes, properties, and connections. |
| **Inspect** | Ask AI to check whether the content fits. It uses layout diagnostics and images of selected slides to identify areas that need revision. |
| **Present** | Keep speaker notes and the next slide in view while a synchronized audience window shows the presentation. |
| **Share** | Export PDF for viewing or hybrid editable PowerPoint for review and further editing. Recipients do not need MarkdStage. |

Diagnostics supplement visual review; they do not judge every design decision. Review every page
of the final output before distribution. PowerPoint keeps supported text, lists, tables, code, and
Architecture diagrams editable, with image fallbacks for unsupported representations. PowerPoint
changes do not round-trip to Markdown. See [presenting and export](./docs/user-guide/presenting-and-export.md)
for supported elements and fallback details.

## Ways to use MarkdStage

| Surface | Purpose |
| --- | --- |
| **[Windows Desktop and included CLI](#use-markdstage-desktop)** | Browse a workspace, install Agent Skills, edit Architecture diagrams, review slides, present, and export from the GUI; use the included CLI for diagnostics and automation. |
| **[Canvas with GitHub Copilot](#use-the-canvas-extension)** | Draft and revise in the GitHub Copilot App, refine Architecture diagrams visually, and present or export from Canvas. |
| **[npm CLI + Agent Skill](#use-the-cli)** | Use a terminal, CI, Claude Code, or Codex with the browser-based UI. No Canvas host is required. |
| **[Editing without AI](#present-without-ai)** | Write Markdown yourself or start from an example, then open it in Desktop, Canvas, or the CLI. |
| **MarkStageForMac** (third-party) | Present on macOS with the community-built native app. Developed and supported outside this repository |

## Use MarkdStage Desktop

Install [MarkdStage from Microsoft Store](https://apps.microsoft.com/detail/9N9DG772RM03).
One installation provides the Windows application and the `markdstage` console alias.
**Node.js and npm are not required for the Windows package.**

1. Start **MarkdStage** from the Windows Start menu.
2. Select **Open folder…** and choose the folder containing your Markdown and assets.
3. If using an AI tool, select **Install skills…**, choose Codex, Claude Code, or GitHub Copilot,
   and select **Install**. Use the same folder in that tool. Skill installation is optional and
   does not install the AI tool or the Canvas Extension.
4. Select a Markdown file from the workspace list. Edit its text in your text editor; Desktop
   refreshes the preview when you save.
5. On an Architecture slide, select **More controls > Shape editing**. Edit the diagram and
   select **Save** to write the changes back to Markdown.
6. Use **Output preview**, **Presenter view**, **Export PDF**, or **Export PowerPoint…** from
   **More controls**.

![MarkdStage Desktop with a sample Architecture slide and its editing, presentation, and export commands](./docs/user-guide/images/windows-controls.png)

Native viewing uses Microsoft Edge WebView2 Runtime. Layout inspection, PNG capture, and
PDF/PowerPoint export additionally require an installed Edge, Chrome, or Chromium browser.
MarkdStage does not download these runtimes.

The [Windows guide](./docs/user-guide/desktop.md) explains workspace navigation and Skill
installation. The [Windows walkthrough](./docs/user-guide/windows-walkthrough.md) includes a
fictional sample, screenshots, and example AI requests covering diagram editing through export.
For portable ZIPs and signed sideloading packages, see
[installation](./docs/user-guide/installation.md) and the
[v4.2.8 release](https://github.com/runceel/markdstage/releases/tag/v4.2.8).

## Use the canvas Extension

When you open this repository as a project, `.github/extensions/markdstage/` loads at project
scope. To Install the current **[v4.2.8 release](https://github.com/runceel/markdstage/releases/tag/v4.2.8)**
at user scope in another repository, ask GitHub Copilot:

> Install MarkdStage at user scope from the following GitHub repository folder.
>
> `https://github.com/runceel/markdstage/tree/v4.2.8/.github/extensions/markdstage`

The Extension runs local code in the user's environment. Review its contents before installation,
and use a trusted release tag or commit SHA for a reproducible install. The `main` branch tracks
the latest development version.

### Minimal workflow

With the Extension installed, provide notes or a source file and ask Copilot:

> Create five slides for a technical audience from these notes. Save them as `slides.md` with
> the dark theme and display them in MarkdStage Canvas.

There is no need to create `slides.md` first. For a focused revision, try:

> Keep the theme and shorten only the explanation on slide 2.

1. Refine wording in Markdown or use the [Architecture Editor](#see-markdown-on-stage) for diagram changes.
2. Ask Copilot, "Check whether the content fits on the slides." The canvas starts in **More controls > Output preview**; toggle it to compare the retained responsive layout.
3. Navigate with **◀ ▶**, the **arrow keys**, or the **☰ slide list**. Surface Pen navigation is available in supported environments.
4. Open the presentation window or export PDF / PowerPoint from **More controls**. Check the final output before sharing.

For an existing deck, ask: "Present this deck using `slides.md`."
The [AI authoring guide](./docs/user-guide/ai-assisted-authoring.md) explains how Copilot uses
format references, the active deck, and diagnostics.

You can also open Markdown directly from the workspace with **More controls > Open Markdown** or
the `I` key, without using AI. In a Git repository, the workspace is the repository root;
otherwise it is the folder opened for the current session. When calling `open_canvas` directly,
use canvas ID **`MarkdStage`**.

```text
canvasId: MarkdStage
```

### Install through Awesome Copilot

This repository also contains the generated external-plugin layout used for an
awesome-copilot submission at `.github/plugin/markdstage/`. It is regenerated from the
canonical `.github/extensions/markdstage/` source with `npm run awesome:sync` and verified
without writing by:

```console
npm run awesome:check
```

CI and the release workflow run the verification, so the committed plugin tree cannot fall
behind the Extension.

The generated plugin runs locally in the Copilot host. It uses a loopback server bound to
`127.0.0.1`, reads and writes Markdown and assets inside the selected workspace, and may launch
an already-installed Edge, Chrome, or Chromium browser for the presenter and browser-backed
exports. It does not download a browser or require a remote service or API key. The plugin
manifest version must match the CLI product version; publish updates only from a new immutable
release tag or commit SHA. Do not edit awesome-copilot's `plugins/external.json` from this
repository; listing and approval are maintained by awesome-copilot.

## Use the CLI

The [MarkdStage CLI](./docs/user-guide/cli.md) works without Canvas in Claude Code, Codex,
terminals, and CI. The **npm CLI** requires **Node.js 24 or later** and an installed
**Microsoft Edge, Google Chrome, or Chromium**; it does not download a browser.
See the [installation guide](./docs/user-guide/installation.md) for prerequisites and offline installation.

**Windows Store users already have the CLI; do not install npm just to use it.**
Bare `markdstage`, a Markdown path, and `preview` open or reuse the native workspace window;
`present` also opens the native audience window. Diagnostics and exports remain console commands.
See the [CLI guide](./docs/user-guide/cli.md) for flags, prerequisites, and differences from npm.

### Install and ask for a draft

If you chose the npm distribution, install it first:

```console
npm install --global @markdstage/markdstage
```

With either distribution, run the Skill command in your deck folder, or use Desktop's
**Install skills…** button. This example selects Claude Code:

```console
markdstage skill install --target claude
```

For Codex, replace the Skill registration line with `markdstage skill install --target codex`.
**Choose one; both are not required.** Skills provide the format and command guidance from
`markdstage guide`. They are installed in `.claude/skills/markdstage/` or
`.agents/skills/markdstage/` in that folder.

Open the same folder in your chosen agent, attach notes or source material, and ask:

> Use the markdstage skill to create five slides for a technical audience from these notes in
> `slides.md`. Use the dark theme, preview the deck, and check the layout.

> Keep the theme and shorten only the explanation on slide 2.

### Refine, inspect, and deliver

```console
markdstage slides.md
```

Edit Markdown in your text editor; the UI reloads on save. The npm browser UI includes the pencil
placement editor and **Advanced edit** for Architecture diagrams. Placement changes save
immediately; the detailed designer keeps a draft until **Save** writes it back to Markdown.

Ask the same agent to check fit in natural language:

> Check whether the content fits on the slides. Identify any clipping and review images of the pages that need a closer look.

The AI follows the Skill's workflow to validate structure and inspect layout, using the results to
identify areas that need revision. You do not need to name the diagnostic commands.

<details>
<summary>How AI uses the diagnostics</summary>

`inspect` (CLI) and `inspect_layout` (Canvas) are intended primarily for AI to diagnose clipping
after rendering. They return structured information about clipped pages and elements in fixed
16:9 output, so the AI can narrow down areas needing revision without first capturing every slide.

With the CLI, the AI uses `validate` for structure, themes, and DSL, and `inspect` for fit.
It uses `capture --pages` when selected pages need image review. See the
[CLI guide](./docs/user-guide/cli.md) for manual use and CI integration.

</details>

After refinement, ask AI to present or export, or run the following commands yourself:

```console
markdstage present slides.md
markdstage export slides.md --output slides.pdf
markdstage export slides.md --output slides.pptx
```

With npm, `present` opens the same full UI with presenter view selected; select
**Start presentation** to open the synchronized audience window. With the Windows
package, `present` opens presenter view and the native audience window immediately;
repeating the command reuses that window. Review every page of the final export
before distribution.

<a id="present-without-ai"></a>

## Edit and present without AI

Write Markdown yourself, use the [minimal format below](#markdown-format), or download a
[source-backed example](https://runceel.github.io/MarkdStage/en/#examples) and save it as `slides.md`.
No Skill registration is needed. With the Windows Store installation:

```console
markdstage --workspace .
markdstage slides.md
markdstage present slides.md
```

For the npm distribution without a global install:

```console
npx @markdstage/markdstage --workspace .
npx @markdstage/markdstage slides.md
npx @markdstage/markdstage present slides.md
```

These `npx` commands use the unchanged browser-based npm CLI. The first opens an empty
Canvas-equivalent UI for the current workspace. The second opens
`slides.md` with automatic refresh. Both the npm CLI UI and Canvas open files through
**More controls > Open Markdown**. Desktop opens files from its workspace list or
**Open Markdown file…** picker.

<a id="community-macos-app"></a>

## Community macOS app

[MarkStageForMac](https://github.com/07JP27/MarkStageForMac) is a native macOS app built by the
MarkdStage community. It is developed, released, and supported outside this repository.

<a id="see-markdown-on-stage"></a>

## Examples

The same source and renderer connect editing, preview, presentation, and export.
The [website examples](https://runceel.github.io/MarkdStage/en/#examples) include rendered slides
and downloadable Markdown.

<table>
  <tr>
    <td width="50%">
      <img src="./assets/readme/simple-slide.png" alt="A standard Markdown slide rendered by MarkdStage">
    </td>
    <td width="50%">
      <img src="./assets/readme/architecture-dsl.png" alt="An Architecture DSL diagram rendered in a MarkdStage slide">
    </td>
  </tr>
  <tr>
    <td valign="top">
      <strong>Standard Markdown</strong><br>
      Write headings, lists, emphasis, code, tables, and images directly. Mermaid is also available
      when automatic diagram layout is useful.
    </td>
    <td valign="top">
      <strong>Architecture DSL</strong><br>
      Put JSON in an <code>architecture</code> fence to specify groups, icons, placement, and
      connector routing.
    </td>
  </tr>
</table>

### Network architecture example

The [Azure hub-spoke example](./site/examples/azure-hub-spoke.md) uses Architecture DSL v1 to
combine a shared hub, four spoke VNets, nested subnets and VMs, and distinct connection types.
Network positions are fixed, while VM rows are laid out automatically. A separate traffic view
explains internet egress through Azure Firewall without mixing packet flow with VNet connectivity.

[![Azure hub-spoke topology rendered from Architecture DSL, with four spokes and shared hub services](./assets/readme/azure-hub-spoke/slide-002.png)](./site/examples/azure-hub-spoke.md)

This is an original conceptual diagram based on
[Microsoft Learn's hub-spoke architecture](https://learn.microsoft.com/azure/architecture/networking/architecture/hub-spoke),
using generic built-in icons rather than official Azure artwork. No renderer changes or external
image assets are needed to render the deck. GitHub shows `architecture` fences as code, so the
preview links to the editable Markdown source.
See the [worked example](./docs/user-guide/diagrams-and-media.md#example-azure-hub-spoke-network)
for how to open and edit the diagram in MarkdStage.

### Choose the diagram format

Use **Mermaid** for automatic, relationship-driven layout; its colors can follow the deck theme.
Use **Architecture DSL** to specify positions, sizes, groups, and connectors as part of a slide's
composition. Both are supported; choose by the kind of diagram you need.

An Architecture diagram can be refined directly. In Desktop, open the Markdown from the workspace
list; in Canvas, use **More controls > Open Markdown**. Then choose **More controls > Shape editing**
to open the source-backed Architecture Editor.
The Architecture Editor can add, remove, arrange, and inspect nodes, groups, images, and connectors.
Changes remain a draft until **Save** writes them back to Markdown. The CLI's `preview --watch`
also provides visual Architecture editing.

<p align="center">
  <img src="./assets/readme/architecture-editor.png" alt="The Azure hub-spoke diagram in Architecture Editor, with Hub VNet selected and its properties visible" width="100%">
</p>

See the [diagrams and media guide](./docs/user-guide/diagrams-and-media.md) for both formats.

## Markdown format

```markdown
---
title: Sample
theme: dark
layout: title
---

# Sample presentation

---

## Second slide

- Use standard Markdown
- Write code and Mermaid directly

<!--
Speaker notes:
Introduce the Markdown and Mermaid examples here.
-->
```

The leading front matter supplies shared deck settings. Per-slide front matter can override values
such as `layout`, `size`, and `theme`. Put speaker notes in a top-level HTML comment on each slide;
they appear in presenter view and are exported as readable plain text in the corresponding
PowerPoint notes pane. They remain absent from regular slides, the audience window, and PDF output.

## Documentation

- [User guide](./docs/user-guide/README.md)
- [Installation and prerequisites](./docs/user-guide/installation.md)
- [Windows Desktop: workspaces, Skills, editing, and export](./docs/user-guide/desktop.md)
- [Windows walkthrough with screenshots](./docs/user-guide/windows-walkthrough.md)
- [AI-assisted authoring](./docs/user-guide/ai-assisted-authoring.md)
- [GitHub Copilot hands-on](./docs/user-guide/copilot-hands-on.md)
- [Agent Skill installation](./docs/user-guide/cli.md#agent-skills)
- [Canvas Extension specification and actions](./.github/extensions/markdstage/README.md)
- [MarkdStage Desktop](./apps/MarkdStage.Desktop/README.md)
- [MarkdStage CLI](./docs/user-guide/cli.md)
- [Diagrams and media](./docs/user-guide/diagrams-and-media.md)
- [Presenting and export compatibility](./docs/user-guide/presenting-and-export.md)
- [Custom theme authoring](./.github/extensions/markdstage/docs/custom-theme-authoring.md)
- [Product principles](./PRODUCT.md)
- [Brand and design system](./DESIGN.md)
- [Current architecture](./docs/architecture.md)
- [Architecture decision records](./docs/adr/README.md)
- [Release process](./.github/RELEASING.md)
- [Third-party notices](./.github/extensions/markdstage/THIRD-PARTY-NOTICES.md)
- [MIT License](./LICENSE)

## Repository structure

| Path | Contents |
| --- | --- |
| `.github/extensions/markdstage/` | Canvas Extension, renderer, bundled open-source software, and schemas |
| `packages/markdstage-cli/` | `@markdstage/markdstage` CLI package and the Agent Skill generator used by CLI and Desktop installers |
| `apps/MarkdStage.Desktop/` | WinUI 3 desktop app |
| `assets/brand/` | MarkdStage logo, lockup, and README banner |
| `assets/readme/` | Rendered slide and Architecture Editor examples |
| `docs/user-guide/images/` | User-guide screenshots and the Windows walkthrough recording |
| `site/` | Bilingual GitHub Pages website, content, and source-backed examples |
| `slides.md` | Sample deck that demonstrates the features |

## Website development

The [website](https://runceel.github.io/MarkdStage/en/) is generated from `site/` using
Node.js 24 or later, with no build dependencies:

```console
npm run preview:site
```

Open `http://127.0.0.1:4173/MarkdStage/` for Japanese or append `en/` for English.
Restart the command after editing the source. `npm run build:site` produces only
the public files in `_site/`; set `SITE_URL` to the full deployment base URL when
building for another host. `PORT` changes the local preview port.

Edit both `site/content/ja.json` and `site/content/en.json` together. Shared links,
the CLI command, and the trusted Canvas release tag live in
`site/content/product.json`. The examples in `site/examples/` match their PNGs
in `site/assets/examples/`; after editing an example, regenerate its first slide
with the [CLI's `capture --pages 1` command](./docs/user-guide/cli.md) and replace
the matching PNG. Windows screenshots are reused from `docs/user-guide/images/`.

`npm run test:site` uses the existing Node, Playwright, and axe-core test tools
(install test dependencies with `npm ci` and Chromium with
`npx playwright install chromium` if needed).
The **GitHub Pages** workflow checks pull requests without deploying. Once
changes reach `main`, it publishes the checked `_site/` artifact; it can also
be run manually against `main`. Pages must use **GitHub Actions** as its source.
The workflow reads the existing Pages URL and does not change custom domains,
DNS, or HTTPS settings.

## License

The original portions of this repository are released under the MIT License. See
[THIRD-PARTY-NOTICES.md](./.github/extensions/markdstage/THIRD-PARTY-NOTICES.md) for licenses and
copyright notices for bundled open-source software.
