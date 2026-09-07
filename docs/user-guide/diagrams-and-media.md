# Diagrams and media

> 日本語版: [日本語](ja/diagrams-and-media.md)

MarkdStage supports Markdown images, Mermaid for automatic layout, and Architecture DSL for stable
placement and routing.

## Use Mermaid for automatic layout

Write a `mermaid` fence:

````markdown
```mermaid
flowchart LR
    A[Write Markdown] --> B[Preview]
    B --> C[Present]
```
````

Mermaid is bundled and works offline. Use it for flowcharts, sequence diagrams, class diagrams,
state diagrams, requirement diagrams, pie charts, and other automatically arranged diagrams.

Mermaid diagrams pick up the slide's background, border, text, and accent colors automatically, so
they blend into the deck's theme (including custom themes) instead of using one of Mermaid's own
fixed color schemes.

If Mermaid syntax is invalid, the slide shows an error while preserving the rest of the content.

### Editable Mermaid in PowerPoint

PowerPoint export is hybrid. Supported shapes, text, and connectors stay editable.

Unsupported or unsafe content is preserved as the smallest safe image
fallback.

The whole diagram becomes an image only when native and fallback content
cannot be separated safely.

| Diagram | Approximate editable coverage |
| --- | --- |
| Flowchart | Common nodes, subgraphs, connectors, labels, and safely representable styles |
| Sequence | Basic participants and actors, lifelines, messages, notes, activations, and common control frames |
| Class | Class compartments, common relations and markers, multiplicities, notes, and namespaces |
| State | Basic `stateDiagram-v2` states, start/end pseudo-states, labels, and simple transitions |
| ER | Exact `erDiagram` syntax; entities, attributes, relations, labels, and crow's-foot cardinalities |
| Requirement | `requirementDiagram` blocks, supported relations, labels, and markers |
| Packet / tree view | `packet` fields and bit labels; exact `treeView-beta` hierarchy lines and labels |
| Kanban | Basic columns and cards; plain ticket/assignee fields, priority bars, and simple HTML labels |
| Block | `block` / `block-beta` basic existing shapes, connectors, and simple HTML node/edge labels |
| Quadrant | `quadrantChart` quadrant rectangles, circular data points, borders/axes, titles, and axis/point labels |
| XY chart | `xychart` / `xychart-beta` rectangular bars, straight line-plot segments, ticks, axes, titles, and axis labels; vertical and horizontal orientation |
| Gantt | `gantt` ordinary tasks (done/active/critical included), task/section/title labels, date ticks, row backgrounds, rectangular excluded periods, and known rounded diamond milestones |
| Treemap | `treemap` / `treemap-beta` section/header and leaf rectangles, titles, fitting cell labels and values, with independent fill/stroke alpha |
| Ishikawa | `ishikawa` / `ishikawa-beta` normal-look spine/branch lines, cause-label rectangles, Japanese and measured multiline text, and exact filled spine-facing arrow triangles |
| Other Mermaid diagrams | Render normally in slides and use image fallback where editable conversion is unavailable |

Coverage is intentionally approximate: editability depends on the structures
and effects in the rendered diagram, not only its Mermaid type.

The exporter follows the rendered SVG rather than rebuilding layout from
source, and does not claim that every valid syntax variant is editable.

Kanban labels keep their rendered positions rather than being centered inside
cards; Japanese text, explicit line breaks, and basic bold/italic runs remain
editable. Use `kanban`, not `kanban-beta`: Mermaid 11.15.0 treats the latter's
`-beta` suffix as a column label, not a version alias. Both `block` and
`block-beta` are real aliases. Block rectangles, rounded rectangles, diamonds,
circles, double circles, cylinders, subroutines, and other already-supported
basic polygons reuse the common shape and connector adapters.

These subsets do not promise arbitrary special shapes or complex nesting.
Unknown block outlines retain their own local image while separable labels
and neighboring blocks remain editable. Rich HTML, linked ticket decorations,
embedded images/icons, unsafe effects, and transforms retain the smallest safe
label, shape, or container image. Text clipped by its original HTML viewport
also stays a local label image rather than overflowing the exported card.
No label or decoration is intentionally
discarded, and fallback diagnostics identify its source path and reason.

Quadrant and XY charts use Mermaid's rendered coordinates, including numeric or
categorical ticks, negative ranges, point radii, and each explicit line-plot
vertex. Simple rotated axis labels reuse the common text adapter. These are
editable shapes, lines, and text, **not data-backed PowerPoint charts**; no chart
layout, scale calculation, or source data workbook is recreated.

The chart subset supports plain Japanese text and explicit SVG text line breaks;
it does not interpret HTML line-break markup that Mermaid renders literally.
Filters, shadows, gradients, clipping/masks, decorated or stroked text, unsupported
transforms, and unknown geometry remain local shape, label, or container images.
Closed, curved, disconnected, or over-limit line paths are not approximated as
editable chart lines. Shared group effects preserve the affected subtree as one
image, without consuming separable axes, labels, or neighboring bars/points.
SVG element, scene node, connector point, and depth limits remain in force.

Ishikawa uses the bundled renderer's actual positions, line endpoints, sizes, and
text baselines, including subordinate branches. Its filled start markers become
separate editable triangles at the measured size and angle, with the tip toward
the spine; they are not replaced by approximate PowerPoint arrow presets.
Simple multiline labels use one editable text object per rendered SVG line,
preserving Mermaid's wrapping and line advance rather than recomputing layout.
Safe rectangles and individual fill/stroke alpha reuse the common primitives.

The curved fish-head outline remains **local artwork**, while its safe text
stays editable; therefore an ordinary Ishikawa export is hybrid. `handDrawn`
rough lines, arrowheads, boxes, and fish heads also remain separate local images
with safe labels editable. This is not general curved/closed-path conversion.
Changed marker geometry, direction, dimensions, units, paint effects, or unsafe
line opacity retain the affected line and its marker together as local artwork.
Text effects, clipping, unsafe transforms, and shared group effects retain the
smallest safe label or subtree, with source paths, reasons, native exclusion
masks, and paint order intact. Existing size, node, element, point, and depth
limits are unchanged; other diagram families are not expanded by this subset.

Gantt uses Mermaid's date positions, durations, task ordering, calendar exclusions,
and SVG dimensions directly. No date arithmetic or calendar layout is reimplemented.
Its known milestone is a centered square with Mermaid's 45° rotation and 0.8 scale.
The exporter preserves its corner radius and scaled stroke as an editable rotated
rounded rectangle, rather than substituting a sharp diamond. Arbitrary rotation,
skew, reflection, noncentered origins, or other CSS transforms are not recognized
as milestones and remain local images. Ordinary tasks never inherit that exception.

Gantt's faded tick groups are separated into editable lines and labels only when
their measured painted extents (including stroke padding) do not overlap and their
effects are safe. Uncertain or overlapping groups, including default top-axis
labels whose text bounds meet their tick lines, retain one local image and their
original group alpha. This is not general group-opacity flattening. Plain Japanese,
explicit SVG line breaks (including multiline section titles), and safe rotated
tick labels share the existing text adapter. Simple multiline Gantt labels use
separately positioned editable text for each rendered SVG line, preserving its
actual advance rather than PowerPoint's default paragraph spacing. Unsupported
multiline structures remain local label images. Filters, gradients, clipping, decorated
text, unusual milestones, and unknown geometry preserve the smallest safe subtree;
source ownership and native exclusion masks retain separable siblings exactly once
in their original paint order. Existing element, node, point, and depth limits apply.

Treemap uses Mermaid's rendered cell positions, sizes, hierarchy, font sizes, and
visible strings; it does not rebuild the layout. Both aliases are supported by
the bundled Mermaid 11.15.0. A leaf's known, untransformed, sibling rectangular
`userSpaceOnUse` clip can be omitted from the **native text object only** when
the measured glyph bounds fit with slack on every edge. The source clip is never
removed. Modified, rounded, transformed, external, ambiguous, or otherwise
unrecognized clips remain local text images, not a general editable clipPath.

Overflowing text stays **only that text's local artwork**, retaining the source
crop rather than leaking outside the cell. Mermaid's own hidden labels, reduced
font sizes, and already-truncated visible strings are not reconstructed or
resurrected. Plain Japanese and simple explicit SVG `tspan` lines are supported;
each multiline text line uses its measured position, not default paragraph
spacing. Rich/uncertain multiline text, stroked/decorated text, text shadows,
and filters remain local images. Cell rectangles and separable sibling labels
stay editable; shared group opacity, clipping, effects, or unsafe transforms
retain the entire affected subtree when splitting it is unsafe. Diagnostics
retain source paths and reasons, native exclusion masks avoid duplicate content,
and existing scene/element/depth limits still apply. This adds no arbitrary
clip/mask geometry, general group compositing, or data-backed PowerPoint chart.

See the presentation-ready
[Mermaid support example deck](../examples/mermaid-support.md) for representative
syntax and current coverage.

#### Common export rules

- Geometry and placement come from the rendered SVG, including connector routes,
  text bounds, and marker direction.

- Theme colors, supported styles and alpha, and simple Japanese or multiline text
  are preserved when they can be represented safely as native PowerPoint
  objects.

- Effect-free text can retain simple 2D rotation in addition to translation and
  uniform scaling. Gantt milestone shapes recognize only the known centered
  transform described above.

- Semantic markers such as arrowheads, diamonds, inheritance triangles, crosses,
  start/end states, and crow's-foot terminals are retained when their rendered
  form is supported.

- Complex transforms, effects, HTML, embedded icons or images, and unknown
  geometry use a local image fallback when native conversion would change their
  appearance.

- A local fallback does not consume supported sibling nodes, connectors, labels,
  or control frames. Those siblings remain editable whenever ownership can be
  separated safely.

#### Fallback behavior

- Visible Mermaid content is preserved in the exported presentation.

- The smallest safe node, label, connector, marker, decoration, or control frame
  is preferred for image fallback.

- The whole diagram is rasterized only when shared effects, transforms,
  compositing, or ownership make local separation unsafe.

- Mermaid types outside the editable set still render in the slide and typically
  export as a diagram image.

- The export report identifies fallback use with its reason and source path.

## Use Architecture DSL for stable placement

Write JSON in an `architecture` fence when element positions, dimensions, containers, or connector
routes must remain stable:

````markdown
```architecture
{
  "version": 1,
  "canvas": { "width": 1200, "height": 500 },
  "elements": [
    {
      "type": "node",
      "id": "client",
      "x": 80,
      "y": 160,
      "width": 260,
      "height": 140,
      "text": "Client",
      "icon": "browser"
    },
    {
      "type": "node",
      "id": "api",
      "x": 700,
      "y": 160,
      "width": 260,
      "height": 140,
      "text": "API",
      "icon": "api"
    },
    {
      "type": "connector",
      "from": "client",
      "to": "api",
      "routing": "orthogonal",
      "label": "HTTPS"
    }
  ]
}
```
````

Nodes support rectangle, rounded rectangle, ellipse, diamond, triangle, hexagon, and parallelogram
shapes. These additive values remain compatible with Architecture DSL v1 and export as native
PowerPoint shapes. Groups support row, column, grid, and layered layouts. Connectors support
straight, orthogonal, and polyline routing.

Connector line patterns use the existing `style.dash` value. Omit it for a solid line, use
`"dash": "1 5"` for a dotted line, or use another numeric pattern such as `"10 6"` for a dashed
line.

## Adjust placement in the Canvas Extension

For a deck created directly in the canvas without a Markdown source association, select
**More controls > Shape editing** to enter the lightweight placement editor. Select an element,
drag it, or use the arrow keys. The editor provides Undo, Redo, and layout release.

![Architecture placement editing in the Canvas Extension](images/canvas-architecture-edit.png)

Decks created directly in the canvas keep placement changes in canvas state.

Leave edit mode before presenting.

## Use the Advanced Architecture Editor

For Markdown imported with **More controls > Open Markdown**, select
**More controls > Shape editing** to open the dedicated editor directly. If the current slide
contains multiple Architecture blocks, select the diagram from the picker first.

![The Advanced Architecture Editor with an API node selected](images/architecture-editor.png)

The editor can:

- Add, duplicate, reorder, and delete nodes, groups, images, and connectors
- Change text, shape, icon, position, size, style, ports, routing, and parent group
- Apply or release group layouts
- Select or import assets
- Pan in both directions by dragging blank canvas space
- Collapse Elements and Properties; medium windows keep them as nonmodal docks,
  while narrow windows use nonblocking overlays
- Keep secondary commands in **More** so the canvas remains the primary surface
- Start an empty diagram with **Add first shape**
- Undo and redo draft changes

Changes remain a draft until you select **Save**. If the Markdown changes externally, the editor
does not overwrite it; reload the source and reapply the intended change.

Advanced editing requires a source-backed deck imported through **More controls > Open Markdown**
and an existing `architecture` block. An empty block is valid and can be populated by the editor:

````markdown
```architecture
```
````

## Add images

Standard Markdown images use `/assets/...`:

```markdown
![Accessible description](/assets/system-overview.png)
```

Architecture icons and standalone images omit the leading slash:

```json
{
  "type": "image",
  "id": "map",
  "src": "assets/map.svg",
  "fit": "contain",
  "ariaLabel": "Regional system map",
  "x": 80,
  "y": 80,
  "width": 720,
  "height": 420
}
```

Use `contain`, `cover`, or `stretch` for Architecture image fitting. Supported local formats are
SVG, PNG, WebP, JPEG, and JPG.

[Next: Presenting and export →](presenting-and-export.md)
