# Quick start

> 日本語版: [日本語](ja/quick-start.md)

This walkthrough uses the included [`examples/quick-start.md`](examples/quick-start.md) deck. Copy
it to your own workspace or use it directly from this repository.

## 1. Create a Markdown deck

A minimal deck contains front matter, a title, and `---` slide separators:

```markdown
---
title: My first deck
theme: dark
layout: title
---

# My first deck

Markdown, ready for the stage.

---

## Next slide

- Write standard Markdown
- Keep one main idea per slide
```

Save the file with a `.md` or `.markdown` extension.

At the top level, a line containing only `---` after a blank line separates
slides. Do not use custom markers such as `<!-- slide -->`. If a slide ends with
a top-level HTML comment, leave a blank line between the closing comment and the
next `---` separator.

## 2. Open it in the Canvas Extension

Use either method:

- Ask GitHub Copilot: `Present this deck using docs/user-guide/examples/quick-start.md.`
- Open the MarkdStage canvas, select **More controls > Open Markdown**, and choose the file.

The complete deck opens immediately. Use **◀**, **▶**, the arrow keys, or **☰** to navigate.

![The Canvas Extension showing a Markdown deck and its presentation controls](images/canvas-main.png)

## 3. Open it in the CLI application

Run the CLI with the Markdown path to open the Canvas-equivalent UI with live
refresh enabled:

```console
npx @markdstage/markdstage docs/user-guide/examples/quick-start.md
```

Run `markdstage` without a file to open an empty UI, then select
**More controls > Open Markdown**.

## 4. Open it in MarkdStage Desktop

1. Download the appropriate portable ZIP from the
   [latest MarkdStage release](https://github.com/runceel/markdstage/releases/latest).
2. Extract the ZIP.
3. Run `MarkdStageApp.exe`.
4. Select **Open Markdown** and choose the same file.

The main window shows the current slide, next slide, and current speaker notes.

![MarkdStage Desktop showing current and next slides with speaker notes](images/desktop-main.png)

## 5. Present

- **Canvas Extension:** Select **More controls > External window** for an external audience window,
  or **More controls > Presenter view** to keep the current slide, next slide, and notes together.
- **CLI:** Use the same controls, or start directly in presenter view with
  `markdstage present slides.md`.
- **Desktop:** Select **Start presentation** to open the synchronized audience window.
- Press `F11` in the audience window for fullscreen and `Esc` to leave fullscreen.

## 6. Export a PDF or PowerPoint

Export from the Canvas Extension:

1. Select **More controls > Output preview** and correct any clipping warning.
2. Select **More controls > Export PDF**, or **More controls > Export PowerPoint** for a hybrid
   deck whose text, tables, code, and Architecture DSL stay editable in PowerPoint.
3. Use the generated 16:9 file from the workspace.

Or export the same output from the CLI, without installing the Canvas Extension:

```console
npx @markdstage/markdstage export slides.md --output slides.pdf
npx @markdstage/markdstage export slides.md --output slides.pptx
```

The CLI application also exposes **Export PDF** and **Export PowerPoint** in
**More controls**. MarkdStage Desktop does not export.

## Next steps

- [Complete the GitHub Copilot hands-on](copilot-hands-on.md)
- [Create slides with GitHub Copilot](ai-assisted-authoring.md)
- [Use the Canvas Extension](canvas-extension.md)
- [Use MarkdStage Desktop](desktop.md)
- [Author Markdown slides](markdown-authoring.md)
