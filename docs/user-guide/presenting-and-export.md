# Presenting and export

> 日本語版: [日本語](ja/presenting-and-export.md)

Canvas, Desktop, and the CLI share the renderer and output model. All three provide presenter view,
fixed output preview, and PDF/PowerPoint export. Review final output on the target environment,
because installed fonts and browser versions can affect rendering.

Normal preview, presenter current/next previews, and the audience window share a fixed 1280x720
logical viewport. Each surface scales the whole slide uniformly; windows that are not 16:9 show
letterboxing rather than reflowing content. The responsive toggle is for editing only and is not
equivalent to presentation or export output.

## Compare presentation features

| Feature | Canvas Extension | Desktop | npm CLI |
| --- | --- | --- | --- |
| Current slide | Yes | Yes | Yes |
| Next-slide preview | Presenter view | Presenter view | Presenter view |
| Speaker notes | Presenter view | Presenter view | Presenter view |
| Slide overview | Yes | Yes | Yes |
| External/audience window | Yes | Yes | Yes |
| Synchronized navigation | Yes | Yes | Yes |
| Fullscreen audience view | `F11` | `F11` | `F11` |
| 16:9 clipping preview | Yes | Yes | UI and `markdstage inspect` |
| PDF export | Yes | GUI and included CLI | UI and `markdstage export --output slides.pdf` |
| Editable PowerPoint export | Yes | GUI and included CLI | UI and `markdstage export --output slides.pptx` |
| Surface Pen | Supported on Windows | Supported while audience window is open | No |

The **packaged Windows CLI** opens the native Desktop app for interactive
commands, so its interactive features follow the Desktop column. `present` also
opens the native audience window and repeated requests reuse it. The npm CLI is
unchanged and browser-based; packaged `--no-open` retains the local server UI.
`inspect`, `capture`, and `export` remain console commands in both distributions
and require an external Chromium browser. Native interaction uses WebView2 only.
Desktop's GUI exports also use an installed Chromium browser; WebView2 alone is sufficient for
native viewing, but not for export.

## Prepare presenter view

Select **More controls > Presenter view** in Desktop, Canvas, or the CLI application. Confirm:

- The current slide is correct.
- The next slide preview is useful.
- Speaker notes contain only presenter guidance.
- The slide list has clear titles.

![Desktop presenter view with the current slide, next slide, and speaker notes](images/windows-presenter.png)

## Open the audience window

- **Canvas:** Select **More controls > External window**, or select **Start presentation** in
  presenter view.
- **npm CLI:** Use the same controls. `markdstage present slides.md` starts with
  presenter view already open.
- **Packaged Windows CLI:** `markdstage present slides.md` opens presenter view
  and the native audience window directly. Repeating it does not close or
  duplicate the audience window.
- **Desktop:** Select **Start presentation** in presenter view, or **More controls > External window**
  from slide view.

Move the new window to the audience display. Press `F11` for fullscreen and `Esc` to leave
fullscreen. Navigation from the presenter and audience surfaces remains synchronized.

## Check fixed 16:9 output

In Desktop, Canvas, or the CLI UI, ensure **More controls > Output preview** is enabled.
It starts enabled; toggle it only if it is currently off.
The slide
is letterboxed with the exact 1280x720 typography, spacing, and content limits used by PDF output.

If content exceeds the fixed page, MarkdStage shows a clipping warning:

![A 16:9 preview warning that the current slide clips vertically](images/canvas-layout-warning.png)

Resolve the warning by shortening content, splitting the slide, using a more appropriate layout, or
reducing an explicitly enlarged content size.

You can also ask Copilot to inspect the deck's PDF layout and identify pages that need revision.

## Export PDF

These UI steps apply to Desktop, Canvas, and the browser-based CLI UI.
Alternatively, run `markdstage export slides.md --output slides.pdf`.

1. Reload the source if it changed after the deck opened.
2. Ensure **More controls > Output preview** is enabled and resolve clipping warnings.
3. Select **More controls > Export PDF**.
4. Open the generated PDF from the workspace and review every page.

When the deck was loaded from Markdown, the GUI derives the PDF name from
the source filename and save it beside the source Markdown file. The exported file contains one 16:9
page per slide, including the back cover, with
backgrounds, images, highlighted code, Mermaid, and Architecture diagrams.

Speaker notes and Architecture editing controls are excluded. GUI export replaces an existing
output with the same derived filename. Copy previous output first, or use CLI `--output` for a
different name.

## Export editable PowerPoint

These UI controls are available in Desktop, Canvas, and the browser-based CLI UI.
The equivalent command is `markdstage export slides.md --output slides.pptx`.

1. Reload the source if it changed after the deck opened.
2. Ensure **More controls > Output preview** is enabled and resolve clipping warnings.
3. Select **More controls > Export PowerPoint**, or run
   `markdstage export slides.md --output slides.pptx`.

4. Open the generated presentation and review every slide and its notes.

If the deck contains Mermaid diagrams, **Export PowerPoint…** opens a small dialog.
Choose **Editable shapes** (the default) or **Images**, then select **Export**.
Images keep each diagram together but its text and lines cannot be edited individually.
**Cancel** or **Esc** closes the dialog without exporting. Each opening resets to
editable shapes; the choice is not saved. Decks without Mermaid export immediately.

When the deck was loaded from Markdown, the GUI saves the PowerPoint beside
the source Markdown file using a name derived from the source filename.

Native PowerPoint objects stay editable; anything the converter cannot express natively becomes a
fallback picture that is positioned individually rather than flattened into a full-slide image.

| Markdown element | In PowerPoint |
| --- | --- |
| Headings, paragraphs, links | Native editable text |
| Bullet and numbered lists | One editable text box per contiguous list, including nested levels, with bullet colors from the slide theme |
| Simple tables | Native editable table |
| Fenced code blocks | Native text with editable syntax-highlighted runs, indentation, blank lines, monospace typography, backgrounds, borders, and accent edges |
| Architecture DSL nodes, groups, and connector labels | AutoShapes with their labels stored inside the shape |
| Architecture DSL icons | Transparent foreground pictures above those shapes |
| Images, including supported SVG | Individual pictures |
| Speaker notes | Plain text in the slide's notes pane |
| Mermaid diagrams | Native editable shapes, text, and connectors, with per-element fallback pictures for unsupported SVG details |
| Adaptive Cards | Supported static text, shapes, images, separators, FactSet and Table layouts stay editable; unsupported subtrees and error panels use bounded pictures |
| Decorative backgrounds, gradients, and code-block shadows | Fallback picture |
| Unsupported image effects and HTML/CSS | Fallback picture |

The export report lists every fallback instead of silently omitting it.
Icons and decorations count as fallback items even when Architecture diagram shapes, labels,
and connectors remain editable.

Adaptive Card reports include per-object `adaptiveCards` conversions and an
`adaptiveCardConversionSummary`, distinguishing native objects, static approximations
and rasterized subtrees with reasons, source locations and content impact.
Unsupported children do not require flattening their supported neighbors.
Static input/action/media representations remain non-interactive even when their
text, fills or images are editable. Invalid cards retain a visible error panel;
missing/blocked images retain deterministic placeholders and the remaining content.
`inspect` reports these separately from clipping; run
`inspect --fail-on-issues` before delivery. Fully off-slide cards have no
zero-sized image and report `adaptive-card-outside-slide`.
See [Adaptive Card authoring and limits](diagrams-and-media.md#render-static-adaptive-cards).

The exported presentation creates one slide master for each theme used in the deck, with named
`title`, `default`, `center`, `section`, and `backcover` layouts. Theme-common backgrounds and top
bars live in layout artwork, while supported cover logos are separate layout pictures.
Slide-specific decorations such as footer rules, page-number frames, and kicker marks are cropped to
their painted bounds.

The default font stack is Segoe UI, Segoe Pro, Yu Gothic UI, Yu Gothic, then the system's generic
Latin/Japanese sans-serif fallback. Native Japanese text uses Yu Gothic UI as its primary East Asian
font, while Latin text keeps the font selected by the rendered slide. Exported native text is marked
as not requiring proofing, so
PowerPoint does not add spelling or grammar underlines.

PowerPoint export uses the same 13.333333 x 7.5 inch page size and frozen in-memory deck snapshot as
PDF export, including temporary slide replacements and the automatic back cover. Architecture
editing controls are excluded. The result aims for practical fidelity, not pixel-perfect Chromium
equivalence or general HTML/CSS conversion.

For release validation, follow the [presentation-application verification procedure](../../test/fixtures/README.md#editable-diagram-verification-in-presentation-applications).
It covers independent object editing in PowerPoint desktop, PowerPoint for Web, and LibreOffice
Impress, plus tolerance-based comparison of PNGs rendered by PowerPoint itself.

[Next: Troubleshooting →](troubleshooting.md)
