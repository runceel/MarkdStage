# Microsoft Store listing — en-us

Canonical source for the MarkdStage Microsoft Store listing. Update this file
first, then copy the English text into Partner Center.

Character limits: description 10,000; each product feature 200; each screenshot
caption 200.

## Description

````text
MarkdStage is a Windows application for Markdown slide decks stored in local workspace folders. It connects your AI coding agent workflow to a live slide canvas: external tools such as GitHub Copilot, Claude Code, and Codex create or edit the local Markdown files, while MarkdStage previews, refines, and presents them. It provides the shared MarkdStage slide UI, theme selection, Architecture diagram editing, presentation views, and PDF and PowerPoint export. The Microsoft Store installation includes the graphical app and the markdstage command-line tool.

Workspaces and Markdown

Open a folder and choose a .md or .markdown file, or open a Markdown file directly. Browse and filter the workspace file list, and reopen recent workspaces. MarkdStage watches the local Markdown source: when your external editor or AI coding agent saves a change, the deck reloads while preserving the current slide. MarkdStage does not include a general Markdown text editor. If a reload fails, the last valid deck remains visible.

Choose dark, light, Microsoft, or custom themes. Decks can contain Architecture DSL and Mermaid diagrams, syntax-highlighted code, tables, and local images. Use Output preview to check the fixed 16:9 layout.

Quick start

1. Open a folder containing your Markdown deck, or open a .md file directly.
2. Use an external AI coding agent such as GitHub Copilot, Claude Code, or Codex to create or edit the local Markdown file. You can also edit it in any text editor; MarkdStage does not include an AI assistant or a general Markdown editor.
3. Let the agent save the Markdown file. MarkdStage reloads the deck automatically and keeps your current slide.
4. To create or edit a diagram, add an Architecture diagram section to a slide using an empty `architecture` code block, then choose More controls → Shape editing.
5. In the Architecture Editor, add or move shapes, edit text and properties, and choose Save to write the changes back to Markdown. When creating multiple slides manually, put `---` on a line by itself between slides.

To try Shape editing, ask your AI coding agent to add this empty Architecture diagram to a Markdown slide, or paste it into the local Markdown file yourself:

```architecture
```

Save the Markdown file, then choose More controls → Shape editing. The editor opens for both empty and populated Architecture diagrams. Shape editing is manual in MarkdStage; the AI coding agent creates or edits the local Markdown source, while you refine the diagram in the editor.

Architecture editing and Agent Skills

Slides with an Architecture diagram section, written as an `architecture` code block, can be opened in the native Architecture Editor from More controls → Shape editing. This includes empty blocks, so you can start a new diagram as well as edit one that already contains shapes. Add or move shapes, groups, connectors, and labels, edit their properties, then choose Save to update the code block in the Markdown file. Unsaved diagram changes do not update the deck source. If the source changed outside the editor, reload it before saving. Shape editing does not apply to Mermaid diagrams, general Markdown text, or arbitrary slide shapes.

From the workspace file list, choose Install skills… to install MarkdStage Agent Skills for Codex, Claude Code, GitHub Copilot, or a combination. These workspace-scoped instruction files teach the selected AI coding agent MarkdStage's slide format, themes, and Architecture diagram syntax, so the agent can create and update compatible decks. Modified skill files are preserved unless force overwrite is explicitly selected. The AI tools are installed and operated separately from MarkdStage.

Presentation

- Presenter view with current and next slides and Slidev/Marp-style speaker notes
- A synchronized native audience window for a projector or second screen
- F11 for audience full screen, O for the slide list, and keyboard or margin-click navigation
- Surface Pen tail-button navigation while the audience window is running

Export

Use More controls → Export PDF or Export PowerPoint… in the GUI, or export from the included CLI. GUI exports are saved beside the Markdown file with the same base name, replacing an existing .pdf or .pptx at that path.

PowerPoint output is hybrid: supported text, shapes, and connectors remain editable, while unsupported visuals or effects may become images. The PowerPoint dialog offers Mermaid Editable shapes, with image fallbacks for unsupported details, or Images to keep each diagram as one image. Not every part of a slide becomes an editable object. Review the exported file before distributing it.

````

## Product features

Enter these as seven separate bullet entries, in this order. Keep each entry under
200 characters.

### 1

```text
Open local Markdown workspaces, browse deck files, and use the shared slide UI with theme selection and 16:9 Output preview.
```


### 2

```text
Install workspace-scoped MarkdStage Agent Skills so GitHub Copilot, Claude Code, and Codex can create compatible decks; modified skill files are preserved unless force overwrite is selected.
```


### 3

```text
Connect GitHub Copilot, Claude Code, or Codex to local Markdown slide files; saved agent changes reload automatically while preserving the current slide.
```


### 4

```text
Add or edit Architecture diagrams from an `architecture` code block, including empty diagrams, then manually save changes back to Markdown with explicit Save and stale-source protection.
```


### 5

```text
Render Mermaid and Architecture diagrams, highlighted code, tables, and local images with dark, light, Microsoft, or custom themes.
```


### 6

```text
Use presenter view with current/next slides and notes, plus a synchronized native audience window with keyboard, pointer, and Surface Pen navigation.
```


### 7

```text
Export PDF and hybrid editable PowerPoint from the GUI or bundled CLI. Supported objects remain editable; unsupported visuals may become images.
```


## Screenshot captions

Upload the files in `screenshots/` in filename order. Each caption below matches
the screenshot with the same number.

### 01-architecture.png

```text
Architecture DSL rendered from a Markdown deck with groups, icons, labels, and routed connectors.
```


### 02-shape-editing.png

```text
Architecture Editor: manually add or adjust elements from an `architecture` code block, then use Save to update the Markdown source. Empty diagrams can be edited too.
```


### 03-presenter.png

```text
Presenter view shows the current slide, the next slide, and speaker notes. The synchronized audience window displays the slide.
```


### 04-pptx-editable-shapes.png

```text
Hybrid PowerPoint export: supported text and diagram objects are editable. Unsupported visuals may be retained as images.
```


### 05-code-mermaid.png

```text
Syntax-highlighted code and Mermaid diagrams displayed in the shared slide renderer.
```


### 06-custom-theme.png

```text
A custom theme applied to a Markdown deck, using local CSS and theme assets.
```
