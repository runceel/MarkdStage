# Test fixtures

These decks are loaded by `test/harness/deck.mjs`.

## Format

The Extension accepts an array of Markdown fragments, one per slide. Splitting the original
Markdown into fragments is the Skill's responsibility (the generative AI). Tests do not reimplement
those splitting rules; they specify the same fragments passed to the Extension.

Because fragments can contain front matter delimited by `---`, use a nonconflicting
`<!-- slide -->` line to separate slides.

```markdown
---
layout: title
---

# Title slide

<!-- slide -->

---
page: 2
total: 2
---

## Second slide
```

## Files

| File | Purpose |
| --- | --- |
| `architecture-visual.md` | Visual regression fixture. Contains only Architecture DSL, without Mermaid, to stabilize pixel comparisons |
| `layout-visual.md` | Regression fixture for H1/H2 in `layout: section`, optional kicker/footer, theme backgrounds, and PDF output |
| `standard-title.md` | DOM, coordinate, and PDF regression fixture that pins a regular slide's leading H1/H2 to the top title region |
| `print-mixed.md` | PDF regression fixture with Mermaid and Architecture DSL on one slide (a single fragment without separators) |
| `mermaid/class-relations.mmd`, `mermaid/class-relations.svg` | Class composition, directed association, dependency, and multiplicity source plus fixed SVG generated with bundled Mermaid 11.15.0 (`theme: default`, `securityLevel: strict`, ID `fixture-class-relations`) |
| `mermaid/flowchart-additional-shapes.mmd`, `mermaid/flowchart-additional-shapes.svg` | Seeded legacy and modern subroutine, base-bottom/base-top trapezoid, and reverse-parallelogram source plus fixed SVG generated with bundled Mermaid 11.15.0 (`theme: default`, `securityLevel: strict`, ID `fixture-flowchart-additional-shapes`) |
| `mermaid/class-containers.mmd`, `mermaid/class-containers.svg` | Seeded attached/standalone class notes, nested namespaces, cross-namespace and nested-class relations, labels, multiplicities, and known markers plus fixed SVG generated with bundled Mermaid 11.15.0 (`theme: default`, `securityLevel: strict`, ID `fixture-class-containers`) |
| `mermaid/sequence-decorations.mmd`, `mermaid/sequence-decorations.svg` | Sequence actors, mirrored participants, box/rect backgrounds, autonumber, and nested loop/alt/opt/par source plus fixed SVG generated with bundled Mermaid 11.15.0 (`theme: default`, `securityLevel: strict`, ID `fixture-sequence-decorations`) |
| `mermaid/paint-alpha.mmd`, `mermaid/paint-alpha.svg` | Seeded Japanese/multiline flowchart source with independent color, element, fill, and stroke alpha plus fixed SVG generated with bundled Mermaid 11.15.0 (`theme: default`, `securityLevel: strict`, ID `fixture-paint-alpha`) |
| `mermaid/rotated-text.mmd`, `mermaid/rotated-text.svg` | XY chart source with ordinary title/tick labels and a 270-degree y-axis title plus fixed SVG generated with bundled Mermaid 11.15.0 (`theme: default`, `securityLevel: strict`, ID `fixture-rotated-text`) |
| `mermaid/packet.mmd`, `mermaid/packet.svg` | Three-row packet source with wrapped ranges, varied bit widths, Japanese/escaped-newline labels, bit offsets, and a title plus fixed SVG generated with bundled Mermaid 11.15.0 (`theme: default`, `securityLevel: strict`, ID `fixture-packet`) |
| `mermaid/tree-view.mmd`, `mermaid/tree-view.svg` | Multi-level `treeView-beta` source with siblings, leaves, Japanese/quoted-newline labels, and the renderer-generated root plus fixed SVG generated with bundled Mermaid 11.15.0 (`theme: default`, `securityLevel: strict`, ID `fixture-tree-view`) |
| `mermaid/state-basic.mmd`, `mermaid/state-basic.svg` | Seeded `stateDiagram-v2` source with LR layout, start/end pseudo-states, forward and reverse routes, Japanese/multiline state and transition labels, a dashed/alpha transition, and independently translucent state fill/stroke plus fixed SVG generated with bundled Mermaid 11.15.0 (`theme: default`, `securityLevel: strict`, ID `fixture-state-basic`) |

The PDF regression suite inserts `print-mixed.md` before the back cover in
`architecture-visual.md`, then verifies print output with Mermaid and Architecture DSL together.

## Editable diagram verification in presentation applications

Run this check for a release that changes diagram rendering. Automated scene and DrawingML tests
do not substitute for opening the file in a presentation application.

1. Use the mixed diagram fixture and the Mermaid cases in `test/pptx/mermaid-scene.spec.mjs`.
   Include Japanese and multiline labels, class-defined colors, subgraphs, bidirectional/dashed
   connectors, edge labels, additional node shapes, and both native and unsupported diagram types.
   Repeat with dark, light, microsoft, and a custom theme. Test fragments use the separator above;
   when preparing a CLI deck, use ordinary `---` slide separators instead.
2. Capture every selected page with `markdstage capture <deck.md> --pages 1-<last> --output <png-dir>`
   and export that same source/theme with `markdstage export <deck.md> --output <deck.pptx>` and
   `markdstage export <deck.md> --output <deck.pdf>`. Retain the export report and source revision.
3. Open the PPTX in PowerPoint desktop, PowerPoint for Web, and LibreOffice Impress. Record each
   application's version, operating system, installed fonts, theme, and any repair/import warnings.
   Missing fonts are an environment difference to investigate, not grounds to silently refresh a baseline.
4. In a disposable copy, independently select and edit a native node's text, fill, position, and
   size. Edit a connector's line style, color, and position. Confirm Japanese text, arrow ends,
   label backgrounds, group stacking, and fallback pictures remain intact. Verify that only
   unsupported elements are pictures and that their source paths/reasons appear in the report.
5. In PowerPoint desktop, export all slides as PNG at **1280 × 720**, without modifying the
   original deck. On Windows, the following PowerShell uses PowerPoint's own renderer:

   ```powershell
   $app = New-Object -ComObject PowerPoint.Application
   $deck = $null
   try {
     $deck = $app.Presentations.Open((Resolve-Path "<deck.pptx>").Path, -1, 0, 0)
     $deck.Export("<absolute-output-directory>", "PNG", 1280, 720)
   } finally {
     if ($null -ne $deck) { $deck.Close() }
     $app.Quit()
   }
   ```

6. Compare these PNGs with the fixed-output captures side by side and as a 50%-opacity overlay.
   Check text content/wrapping, diagram bounds, connector endpoints, arrows, clipping, and z-order.
   As review tolerances at 1280 × 720, allow up to **2 px** of edge/endpoint displacement and
   **3 px** of text-baseline displacement. Missing objects, obscured labels, changed text, lost
   arrows, or incorrect stacking always fail, even if a global image difference is small.
7. Keep an approved **PowerPoint-rendered** PNG baseline separately for each application/version,
   font environment, theme, and slide. For repeat renders in that same environment, use the existing
   Playwright image snapshot matcher with `threshold: 0.2` and `maxDiffPixelRatio: 0.01` as an
   initial review threshold; inspect every changed diagram region even below that threshold.
   Do not apply these tolerances to the zero-difference Chromium visual suite, and do not compare
   PowerPoint against Chromium with a mandatory global pixel match. Baseline updates require a
   reviewed explanation, not just a passing numeric score.

Record desktop, Web, and Impress results separately as pass, fail, or **not run**, with screenshots
and discrepancy notes. The procedure is not evidence that a particular application has been tested.
