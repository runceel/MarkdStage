# Adaptive Cards: static rendering and editable PowerPoint

Use a block-level `adaptive-card` fence containing **fully resolved JSON**.
The supported schema is pinned to **1.5**, the official vendored JavaScript SDK
to **3.0.6**, and the MarkdStage HostConfig to **v1**. This is a deliberately
limited static presentation host, not a complete Teams or Outlook host.
The SDK loads only on card-bearing pages; no runtime download is required.
Card fences are selected from the same pinned Marked token tree used for
rendering, including nested Markdown lists and blockquotes. Top-level speaker
notes and literal fenced examples are not card content. Browser source
association follows each token, not a second scanner's occurrence count.

````markdown
## Quarterly update

```adaptive-card
{
  "type": "AdaptiveCard",
  "version": "1.5",
  "body": [
    {
      "type": "TextBlock",
      "text": "Release **ready**",
      "size": "Large",
      "weight": "Bolder",
      "wrap": true
    },
    {
      "type": "FactSet",
      "facts": [
        { "title": "Owner", "value": "Platform team" },
        { "title": "Status", "value": "Reviewed" }
      ]
    }
  ]
}
```
````

## Supported static envelope

Use explicit types in all element collections. Supported body elements are
TextBlock, RichTextBlock/TextRun, Container, ColumnSet/Column, Image/ImageSet,
FactSet, and Table/TableRow/TableCell. String RichTextBlock inlines are also
accepted. Containers and columns require `items`; tables require nonempty
`columns`, `rows`, and exactly one cell per column in every row. Text and fact
fields must be strings. Element IDs in the resolved card must be unique.

Common presentation properties include spacing, separators, visibility,
auto/stretch height, alignment, text sizes/weights/colors, wrapping/maxLines,
rich-text emphasis, default/emphasis container styles, bleed/minHeight,
auto/stretch/weighted/pixel column widths, image size/style/pixel dimensions,
and table grid/header/cell alignment. Unknown/custom properties are removed with
`unknown-property` content diagnostics, not handed to the SDK as extensions.
Invalid known properties are errors, not silently coerced values.

The JSON limit is **262,144 UTF-8 bytes**, **256 objects/arrays**, and **16 levels
of nesting**, including fallback branches and embedded image data. A card reports
at most 100 diagnostics; truncation is explicit and is not successful validation.
Deck validation inspects at most 200 slides/blocks, 2,097,152 characters and
200 card diagnostics before reporting incomplete validation.

No templating package, `${...}`, `$data`, `$when`, date/time macros, or external
data source is supported. Expand the payload before authoring. Refresh,
authentication, background images and root `fallback`/`fallbackText` remain
errors. Custom host protocols never execute or become PowerPoint links.
Unknown elements and other schema
versions are not rendered as if supported.

### Explicitly static inputs, actions and media

The browser remains non-interactive: `supportsInteractivity` is always false.
The original official SDK model is retained, but is never rendered with live
controls. An owned projection produces typed static text/containers/images,
with the original authored source locations, for every surface:

| Authored content | Static presentation |
| --- | --- |
| Input.Text, Number, Date, Time, Toggle, ChoiceSet | Initial value, selected choice titles or placeholder with an explicit non-interactive label; no editing, validation or submission |
| Action.Submit / Execute | Static labeled chips, with `static-action` content diagnostics; no payload, verb or callback executes |
| Action.OpenUrl / supported selectAction | Non-clickable browser label; a safe PowerPoint text-label hyperlink, not a whole-shape action |
| Action.ShowCard | Collapsed labeled chip; embedded card structure is still validated, but its content is not rendered or fetched |
| Media | Approved poster image and static media label; source URLs are never fetched or played |

Input/action behavior is not portable to PowerPoint. `static-input`,
`static-action`, `static-link` and `static-media` diagnostics make these
limitations explicit. Generated labels are plain SDK TextRuns, not executable
HTML or Markdown. Unsafe links retain a static label without a hyperlink.
The PowerPoint link policy permits absolute HTTP(S), mailto and tel URLs without
credentials or controls, then applies the pinned rendered-link sanitizer.
This is a separate policy from image fetching: an allowed link never authorizes
a remote image or media request.

### Requirements and explicit fallback

The only advertised capability is `adaptiveCards: "1.5"`. Requirements for this
capability at or below 1.5, or `"*"`, succeed. An unmet or unknown capability
reports `requires-not-met`. An unsupported element reports `unsupported-element`.
Without an authored static fallback these become a visible error card.

For these two conditions only, an element may provide a supported object as
`fallback`, or `"drop"`. A parent may provide the fallback for an unsupported
child. The replacement must be valid for that collection and passes the **same**
structural, Markdown and image policy. `fallback-substituted` and
`fallback-dropped` identify the authored path and content impact; dropping is
never silently treated as full fidelity. Root cards cannot be dropped.
The full typed structure, all `requires` entries and fallback branches are checked
before capability resolution. Malformed properties and prohibited
resource/interaction properties are fatal and cannot be rescued by a fallback,
including errors after an unsupported sibling or in an unused fallback.

```json
{
  "type": "TextBlock",
  "text": "Host-specific content",
  "requires": { "anotherHost": "1.0" },
  "fallback": { "type": "TextBlock", "text": "Static replacement", "wrap": true }
}
```

## Images and security

Use `assets/card.png` (or `/assets/card.png`), resolved from `assets/` beside the
Markdown and then workspace-root `assets/`. An absolute same-origin URL must
remain within that host's scoped assets route. Same origin alone does not grant
access to arbitrary endpoints. Workspace path, link/junction, origin, MIME and
atomic-write protections remain host-owned.

Supported image data is PNG, JPEG, static GIF and restricted static SVG.
External HTTP(S), file, blob, javascript and other schemes, redirects, query
strings, fragments and traversal are blocked. Images retain the **10 MiB each /
100 MiB aggregate** decoded-byte limits; the aggregate image budget and approved
byte cache are shared across the rendered deck, not reset for each card.
The JSON limit also bounds inline image data.

SVG scripts, foreign HTML, stylesheets, external references and animation are
rejected, including `animate`, `animateColor`, `animateMotion`,
`animateTransform`, `set`, `discard` and CSS animation/transition paths.
Animated GIF and APNG are rejected. MIME signatures and decoding are checked.
Rendering and export reuse approved data bytes, never an unvalidated second URL.

A blocked, missing, over-limit, invalid or undecodable **image** becomes a
deterministic **Image unavailable** placeholder at that Image's location.
The rest of the card remains visible, accompanied by a content diagnostic such
as `blocked-image`, `invalid-image` or `image-load-failed`. This is different from
a malformed card, which becomes a whole-card error panel.
There is no remote-asset exception for screenshots or fallbacks.

TextBlock/Fact Markdown uses the existing marked + DOMPurify pipeline with a
formatting-only allowlist. Unsafe tags and resource/link attributes produce
`markdown-sanitized`. Safe link semantics are retained separately for PowerPoint;
all browser href attributes are removed before attachment.
The SDK subtree is sanitized **in place before attachment**;
typed SDK identity is retained, while DOM IDs and keyboard focus are removed.
Additional unsafe output produces `sdk-subtree-sanitized`. Public SDK rendered
references supply geometry; generated classes, hierarchy and computed CSS do not
supply semantics.

## Appearance and readiness

HostConfig v1 reads only the deck font family and resolved `fg`, `muted`,
`accent`, `surface` and `border` theme tokens. The default card is transparent;
emphasis containers use `surface`. Foreground roles other than accent intentionally
use `fg`, with `muted` for subtle text. This is not Teams/Outlook styling.
Font sizes are 16/20/24/28/32 px and weights 300/400/600; monospace uses
Consolas with the system monospace fallback. Card styles are isolated from slide
paragraph, image and table rules.

Cards finish loading permitted images and fonts, including fonts introduced by
card content, before auto-sizing, inspection, PNG/PDF capture or PowerPoint
readiness. Fixed output is 1280x720. Oversized cards are clipped, not resized to
an invented layout; inspect before exporting and split dense content.

## Diagnostics and output

`markdstage validate slides.md --json` checks JSON, the static schema,
requirements/fallbacks and URL syntax **without loading the SDK or fetching
resources**. Browser-only Markdown sanitization, SDK parse warnings, image bytes,
missing assets and layout require `markdstage inspect slides.md --json` or Canvas
`inspect_layout`. Static validation explicitly reports
`resourceValidation: "deferred-to-browser"`; it is not proof that assets loaded.

Diagnostics include `category: "adaptive-card"`, stable `code`, `severity`,
`impact: "content"` and a JSON `path`, plus slide/card `sourcePath` such as
`adaptive-card[0]$.body[1].url`. Deck validation also reports the source file and
the Marked `markdownPath`. Exact top-level fence lines use the visible Markdown
body as their basis, not absolute file offsets; nested/normalized token positions
have null line fields instead of guessed offsets.
Browser inspection exposes bounded `adaptiveCards` details and
`hasAdaptiveCardIssues` separately from clipping. `inspect --fail-on-issues`
fails for either clipping or card content diagnostics. Visible card notes show
the first three diagnostics (errors first on error panels); JSON reports retain
the bounded full detail.
Unexpected SDK parse/validation warnings are reported and produce an error
panel, rather than accepting an unexplained SDK substitution.

PowerPoint reports include `adaptiveCards` with per-object `conversions` and an
`adaptiveCardConversionSummary`: editable native object count, approximated
elements and rasterized subtrees. Each conversion retains the authored
`sourcePath`, original source type, reason, mode and content impact. Static
input/action/media projection is classified as approximated even when its
visible text, fill and image objects are editable. Browser diagnostics remain
separate from native representability decisions.

## Editable subset and bounded fallback

| Object | Native output and current limits |
| --- | --- |
| TextBlock | Measured, unwrapped text fragments; paragraphs, bold, italic, underline, strike, inline code and safe links from sanitized Marked content |
| RichTextBlock / TextRun | Individually positioned styled runs, highlight rectangles and permitted text-label links; no SDK-class inference |
| Container / ColumnSet / Column | Measured rectangles and typed children; default/emphasis fills, measured auto/stretch/weight/pixel columns, owned spacing and padding |
| Image / ImageSet | Individual native images from the same approved immutable bytes; normal rectangular image treatment |
| FactSet | Native two-column LTR PowerPoint table, including supported Markdown; typed fact fields correlate to text measurements inside the public aggregate region |
| Table | Native non-merged LTR table with measured columns/rows filling the grid, grid and fills; one supported nonempty TextBlock per cell, grid enabled, no cell highlight |
| Separators | Native PowerPoint lines at the SDK's measured painted border, not the entire spacing box |

FactSet does **not** pretend that Facts have individual SDK rendered elements.
It matches typed title/value text to aggregate text Ranges before deriving table
column starts and row spacing. Empty fields or failed/ambiguous correlation
retain bounded FactSet artwork. Unsupported table cell content, non-grid cell
spacing, RTL ordering, highlight or clipping retains bounded Table artwork rather than an
invented table layout. The direct table model honors measured row heights and
explicit cell text insets and measured per-line horizontal offsets. Measured
row layout is opt-in; ordinary Markdown tables keep their established behavior.

PowerPoint does not rewrap measured card text. A line may contain several
editable text fragments, rather than one reflowing text box for the entire
card. Segoe UI light/semibold faces preserve the owned weight intent; native
font rendering is not claimed pixel-identical to the browser. English, Japanese
and long text have deterministic fixtures. Bidirectional/RTL text currently
uses explicit `adaptive-card-bidirectional-text` artwork while supported
neighbors remain editable.

Markdown lists, fragmented/ellipsized or clipped text, Person images, unsupported
table layouts and other unrepresentable subtrees use bounded transparent PNGs.
Typical reasons include `adaptive-card-markdown-list`,
`adaptive-card-text-fragmentation`, `adaptive-card-clipped-text`,
`adaptive-card-image-style`, `adaptive-card-clipped-image` and
`adaptive-card-table-cell-content`. Diagnostic notes are separate
`adaptive-card-diagnostic-note` artwork. These images are **not editable**
internally; their neighboring native objects are.

Fallback roots do not contain duplicate native descendants. Card roots are
excluded from generic HTML collection, including when nested in generic HTML.
Native collection does not change browser content, styling, geometry or pixels.
Only temporary output capture activates shadow-scoped visibility masks.
Browser-owned intersection geometry supplies native clipping, including nested
overflow and positioned elements that escape a non-containing ancestor's clip.
Text and images requiring unrepresentable clipping use local artwork.
An unsupported shared opacity/filter paint context is owned and captured once,
including all its cards, rather than independently blending duplicate fragments.
Its report uses `adaptive-card-paint-context` and identifies shared card sources.
Original paint order is retained,
including positioned cards over footer artwork and explicit higher-z neighbors.

Whole-card safety fallback is reserved for structural error panels, unavailable
correlation or unowned visible SDK content, with an explicit reason such as
`adaptive-card-unowned-visible-content`. Error panels retain
`adaptive-card-<error-code>`. Fully off-slide content has no zero-size picture and
reports `adaptive-card-outside-slide` with content impact. No fallback can bypass
resource approval or fetch a second copy of an image.

The common Scene Graph explicitly accepts `adaptive-card` sources and reuses
shape/text/image/connector primitives. Tables and hyperlinks remain direct
PowerPoint model features; no card action, input or table scene kind is added.
Scene underline/strikethrough have equivalent SVG and PowerPoint mappings.
This is not a round-trip card editor: PowerPoint edits do not change Markdown.

Review the **actual exported file** in desktop PowerPoint. The reproducible
fixture harness records browser/native-controller geometry, pre/post-collection
pixels, package object counts, read-only PowerPoint renders and edits persisted
in disposable copies. The review limits remain **2 px edges / 3 px text
baselines**, at 1280x720; missing content, obscured content or wrong stacking fail
regardless of a numeric tolerance. DOM text Ranges are **not baseline
measurements**. The implementation evidence is not the coordinator's independent
visual gate, a full WinUI/MSIX-shell test, PowerPoint Web or Impress validation.
