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
`columns`, a `rows` array, and exactly one cell per column in every row. Text and fact
fields must be strings. Element IDs in the resolved card must be unique.

Common presentation properties include spacing, separators, visibility,
auto/stretch height, alignment, text sizes/weights/colors, wrapping/maxLines,
rich-text emphasis, default/emphasis/success/info/warning/danger container styles, bleed/minHeight,
auto/stretch/weighted/pixel column widths, image size/style/pixel dimensions,
and table grid/header/cell alignment. Unknown/custom properties on resolved content are removed with
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
The [versioned support matrix](#versioned-support-matrix) enumerates every
accepted type/property and its browser and PowerPoint contract. It is generated
from the validator's closed envelope plus explicit presentation declarations;
schema additions without a matching declaration fail the compatibility checks.

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
ActionSet's authored `orientation` is ignored by the owned vertical static
projection and reports `static-property-ignored`. Input constraints are
validated as metadata but are not enforced; action style/mode/tooltip/data are
not reproduced as interactive behavior. Their `static-input`, `static-action`
or `static-link` diagnostics describe that static contract, not full fidelity.

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

HostConfig v1 reads the deck font family and resolved theme tokens: `fg`, `muted`,
`accent`/`primary`, `surface`, `border`, plus the semantic `success`, `info`,
`warning`, `danger` roles (and their `surface-*`/`border-*` tints), each falling
back to `accent`/`surface`/`border` when a theme does not define them. The default
container is transparent; emphasis uses `surface`. `success`/`info`/`warning`/`danger`
containers use the matching surface/border tint. TextBlock/Fact color roles map
`accent` to `primary`, `good` to `success`, `warning` to `warning`, and `attention`
to `danger`; `default`/`dark`/`light` still use `fg`, with `muted` for subtle text.
This is not Teams/Outlook styling.
Font sizes are 16/20/24/28/32 px and weights 300/400/600; monospace uses
Consolas with the system monospace fallback. Card styles are isolated from slide
paragraph, image and table rules.

TextRun decorations follow the pinned SDK 3.0.6 precedence: when both
`underline` and `strikethrough` are true, underline replaces line-through.
Native export preserves that underline-only paint and remains editable; strike
alone still paints line-through, and italic is independent. Authored typed
properties and browser styling are not changed. This rule is specific to
TextRun, not TextBlock Markdown: supported nested `<u>`/`<s>` formatting can
still paint and export both decorations together.

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
The source `version` must be **exactly `"1.5"`**; successful
`requires.adaptiveCards: "1.4"` does not make a source `version: "1.4"` valid.

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
Browser card reports distinguish `resourceValidation: "browser-checked"` from
`"not-run"` (for example, a structural error before resource approval). Checked
does not mean every asset succeeded: placeholders retain their image diagnostics.
`complete: false` / `diagnosticsTruncated: true` remain visible through inspection,
PPTX JSON and plain-text output. Browser-only diagnostic overflow also produces
an error panel, never a ready/complete card.

PowerPoint reports include `adaptiveCards` with per-object `conversions` and an
`adaptiveCardConversionSummary`: editable native object count, approximated
elements and rasterized subtrees. Each conversion retains the authored
`sourcePath`, original source type, reason, mode and content impact. Static
input/action/media projection is classified as approximated even when its
visible text, fill and image objects are editable. Browser diagnostics remain
separate from native representability decisions.
`nativeObjects` counts actual editable objects, including those used by static
approximations; `approximated` counts conversion entries, not additional shapes.
Zero-object grouping entries are not additional native objects.
`rasterizedSubtrees` counts actual captured pictures (a shared paint context only
once), not off-slide entries without artwork. A native separator retained beside
a rasterized element has its own `.separator` conversion rather than disappearing
from the per-object accounting. Reports use existing `none`/`content` impacts,
not a separate card-only classification. PPTX `adaptiveCardsComplete` and
`adaptiveCardsTruncated` prevent a truncated diagnostic list from looking complete.

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
Links on measured text fragments use a direct text-shape hyperlink so Office
cannot add its automatic run underline to a plain SDK label. This links the
label's measured rectangle, not the entire action chip. Table Markdown links
remain run-level links with explicit color preservation.
This is not a round-trip card editor: PowerPoint edits do not change Markdown.

Review the **actual exported file** in desktop PowerPoint. The reproducible
fixture harness records browser/native-controller geometry, pre/post-collection
pixels, package object counts, read-only PowerPoint renders and edits persisted
in disposable copies. The review limits remain **2 px edges / 3 px text
baselines**, at 1280x720; missing content, obscured content or wrong stacking fail
regardless of a numeric tolerance. DOM text Ranges are **not baseline
measurements**. The implementation evidence is not the coordinator's independent
visual gate, a full WinUI/MSIX-shell test, PowerPoint Web or Impress validation.

Compatibility expansions and SDK upgrades require both the original
native/static fixtures and the official-sample-derived compatibility corpus.
The SDK/schema/HostConfig/capability/source/corpus lock, exact conversion/path
expectations, cross-engine geometry and actual PowerPoint comparisons are
separate gates. A candidate snapshot never updates approved expectations.
See the repository's Adaptive Cards fixture README for the exact upgrade,
comparison and native-host commands. Additional versions, templating, custom
registrations, HostConfig presets, remote asset allowlists and presenter
interactions are **not implemented**; each needs a separate accepted contract.

<!-- adaptive-card-support-matrix:start -->
## Versioned support matrix

Generated from the validator envelope and capability declaration revision **1**. Do not edit this section by hand.
Changing a declaration requires matching corpus/upgrade checks and actual-PPTX review. All surfaces share this matrix.

| Version/capability | Browser contract | PowerPoint contract |
| --- | --- | --- |
| Authored schema **1.5 exactly** | Resolved static subset below, not the full schema. Nested ShowCard may omit version. | Native/static approximation/bounded raster as below. |
| Other/missing root versions, including 1.0–1.4 and 1.6+ | `unsupported-version` error; never inferred or silently upgraded. | Visible bounded error panel and content diagnostic. |
| `requires.adaptiveCards` <= 1.5 or `"*"` | Capability satisfied; this does **not** admit other source versions. | Normal static conversion. |
| Other/unmet `requires` | `requires-not-met`; explicit valid fallback substitution/drop or error. | Same replacement/drop/error with authored source path and content impact. |
| SDK **3.0.6** / HostConfig **v1** | Vendored only; interactivity disabled; theme tokens only. | Same approved bytes and measured browser layout; no SDK/asset download. |

### Types and exact accepted properties

Only these properties are accepted, in these collection roles. Required fields, value types and bounds remain enforced by the validator.
The property contracts below apply only where a property is listed for the type; type-specific overrides take precedence.
A record (Fact, Choice, MediaSource, TableColumnDefinition) is not a freestanding body element.

| Type | Accepted properties | Browser | PowerPoint output mode and conditions |
| --- | --- | --- | --- |
| `AdaptiveCard` | `type`, `id`, `isVisible`, `separator`, `spacing`, `height`, `style`, `verticalContentAlignment`, `bleed`, `minHeight`, `rtl`, `version`, `$schema`, `lang`, `body`, `actions`, `selectAction`, `requires` | Pinned SDK layout; transparent owned HostConfig. | native children; bounded raster error/safety panel when validation or correlation fails |
| `TextBlock` | `type`, `id`, `isVisible`, `separator`, `spacing`, `height`, `text`, `size`, `weight`, `color`, `isSubtle`, `fontType`, `wrap`, `maxLines`, `horizontalAlignment`, `style`, `requires`, `fallback` | Sanitized Marked paragraphs, inline formatting and lists. | native measured fragments; bounded raster for lists, RTL, fragmentation, ellipsis or clipping |
| `RichTextBlock` | `type`, `id`, `isVisible`, `separator`, `spacing`, `height`, `horizontalAlignment`, `inlines`, `requires`, `fallback` | Typed TextRuns and string shorthand. | native measured runs/highlights; bounded raster if their text is unrepresentable |
| `TextRun` | `type`, `id`, `text`, `size`, `weight`, `color`, `isSubtle`, `fontType`, `italic`, `strikethrough`, `underline`, `highlight`, `selectAction`, `requires`, `fallback` | Typed styling; underline overrides strike when both flags are true in SDK 3.0.6. | native fragments and safe text-label links; same decoration precedence |
| `Container` | `type`, `id`, `isVisible`, `separator`, `spacing`, `height`, `style`, `verticalContentAlignment`, `bleed`, `minHeight`, `rtl`, `items`, `selectAction`, `requires`, `fallback` | Default/emphasis container and SDK child layout. | native measured fill/children; shared opacity/filter context captured once as bounded raster |
| `ColumnSet` | `type`, `id`, `isVisible`, `separator`, `spacing`, `height`, `style`, `bleed`, `horizontalAlignment`, `minHeight`, `columns`, `selectAction`, `requires`, `fallback` | SDK auto/stretch/weighted/pixel column layout. | native measured fills/children; no independent relayout |
| `Column` | `type`, `id`, `isVisible`, `separator`, `spacing`, `height`, `style`, `verticalContentAlignment`, `bleed`, `minHeight`, `rtl`, `width`, `items`, `selectAction`, `requires`, `fallback` | SDK column size, padding and child layout. | native measured fills/children; local unrepresentable descendants remain bounded raster |
| `Image` | `type`, `id`, `isVisible`, `separator`, `spacing`, `height`, `url`, `altText`, `width`, `size`, `style`, `horizontalAlignment`, `backgroundColor`, `selectAction`, `requires`, `fallback` | Only approved immutable local/scoped/data bytes; failures show Image unavailable. | native rectangular image; bounded raster for Person style or clipping |
| `ImageSet` | `type`, `id`, `isVisible`, `separator`, `spacing`, `height`, `imageSize`, `images`, `requires`, `fallback` | SDK image sizing and wrapping; same asset gate for each image. | native individual images subject to Image conditions |
| `FactSet` | `type`, `id`, `isVisible`, `separator`, `spacing`, `height`, `facts`, `requires`, `fallback` | SDK aggregate FactSet region and sanitized field Markdown. | native two-column LTR table only when nonempty fields correlate unambiguously to aggregate Ranges; otherwise bounded raster |
| `Table` | `type`, `id`, `isVisible`, `separator`, `spacing`, `height`, `firstRowAsHeaders`, `showGridLines`, `gridStyle`, `horizontalCellContentAlignment`, `verticalCellContentAlignment`, `rows`, `columns`, `requires`, `fallback` | SDK rows/cells/columns. | native non-merged LTR grid only with one nonempty supported TextBlock per cell, measured grid-filling columns/rows, no highlight or clipping; otherwise bounded raster |
| `TableRow` | `type`, `id`, `style`, `horizontalCellContentAlignment`, `verticalCellContentAlignment`, `cells`, `requires`, `fallback` | Typed row within Table only. | owned by native Table or its bounded raster; no separate row object |
| `TableCell` | `type`, `id`, `isVisible`, `separator`, `spacing`, `height`, `style`, `verticalContentAlignment`, `bleed`, `minHeight`, `rtl`, `items`, `selectAction`, `requires`, `fallback` | Typed container within TableRow only. | owned by native Table; unsupported child layout rasterizes that Table |
| `Input.Text` | `type`, `id`, `isVisible`, `separator`, `spacing`, `height`, `label`, `isRequired`, `errorMessage`, `value`, `placeholder`, `isMultiline`, `maxLength`, `style`, `regex`, `inlineAction`, `requires`, `fallback` | Static label and initial value/placeholder; password masks authored value. | static approximation (editable text/fill where representable); no control |
| `Input.Number` | `type`, `id`, `isVisible`, `separator`, `spacing`, `height`, `label`, `isRequired`, `errorMessage`, `value`, `placeholder`, `min`, `max`, `requires`, `fallback` | Static label and initial value/placeholder. | static approximation; no input validation |
| `Input.Date` | `type`, `id`, `isVisible`, `separator`, `spacing`, `height`, `label`, `isRequired`, `errorMessage`, `value`, `placeholder`, `min`, `max`, `requires`, `fallback` | Static label and resolved initial date/placeholder. | static approximation; no date picker |
| `Input.Time` | `type`, `id`, `isVisible`, `separator`, `spacing`, `height`, `label`, `isRequired`, `errorMessage`, `value`, `placeholder`, `min`, `max`, `requires`, `fallback` | Static label and initial time/placeholder. | static approximation; no time picker |
| `Input.Toggle` | `type`, `id`, `isVisible`, `separator`, `spacing`, `height`, `label`, `isRequired`, `errorMessage`, `value`, `title`, `valueOn`, `valueOff`, `wrap`, `requires`, `fallback` | Static label/title and On/Off/authored value. | static approximation; no toggle |
| `Input.ChoiceSet` | `type`, `id`, `isVisible`, `separator`, `spacing`, `height`, `label`, `isRequired`, `errorMessage`, `value`, `placeholder`, `style`, `isMultiSelect`, `wrap`, `choices`, `requires`, `fallback` | Static selected choice titles (unknown selections retain their value) or placeholder. | static approximation; no selection control |
| `Media` | `type`, `id`, `isVisible`, `separator`, `spacing`, `height`, `poster`, `altText`, `sources`, `requires`, `fallback` | Approved poster and static label only; sources never fetched. | static approximation with editable approved image/text where representable; no player |
| `ActionSet` | `type`, `id`, `isVisible`, `separator`, `spacing`, `height`, `orientation`, `actions`, `requires`, `fallback` | Owned vertical static action labels; no SDK interactions. | static approximation; no executable actions |
| `Action.OpenUrl` | `type`, `id`, `title`, `iconUrl`, `style`, `mode`, `tooltip`, `isEnabled`, `url`, `requires`, `fallback` | Non-clickable label; disabled/unsafe URLs retain label only. | static approximation; approved HTTP(S)/mailto/tel text-label hyperlink only |
| `Action.Submit` | `type`, `id`, `title`, `iconUrl`, `style`, `mode`, `tooltip`, `isEnabled`, `data`, `associatedInputs`, `requires`, `fallback` | Static label, never collects or submits inputs/data. | static approximation; no callback or submission |
| `Action.Execute` | `type`, `id`, `title`, `iconUrl`, `style`, `mode`, `tooltip`, `isEnabled`, `data`, `associatedInputs`, `verb`, `requires`, `fallback` | Static label, never executes verb/data. | static approximation; no callback or execution |
| `Action.ShowCard` | `type`, `id`, `title`, `iconUrl`, `style`, `mode`, `tooltip`, `isEnabled`, `card`, `requires`, `fallback` | Collapsed static label; embedded tree validated, never displayed or fetched. | static approximation; no expanded embedded content |
| `Fact` | `title`, `value` | String title/value inside aggregate FactSet; no individual rendered element. | part of correlated native FactSet table or its bounded raster |
| `Choice` | `title`, `value` | Title/value used only to resolve static selected titles. | part of static input approximation; unselected choices not displayed |
| `MediaSource` | `mimeType`, `url` | MIME/URL metadata validated; never fetched or played. | static-media diagnostic; no source/media object |
| `TableColumnDefinition` | `width`, `horizontalCellContentAlignment`, `verticalCellContentAlignment` | SDK numeric weight or pixel width and cell alignment. | native measured columns if the Table meets all representability conditions; otherwise bounded raster |

### Property behavior

Here **native** means editable measured objects; **static approximation** maps to report mode `approximated` and can still contain editable objects;
**bounded raster** maps to `rasterized` PNG artwork and is not internally editable. Unsupported/error and ignored-with-diagnostic are admission/projection outcomes,
not additional conversion modes or new impact enums. All content losses use the existing `impact: "content"`.

| Properties (on the listed types above) | Browser | PowerPoint |
| --- | --- | --- |
| `type` | Explicit typed identity; unsupported types need authored fallback or error. | Typed source identity retained in reports, never inferred from HTML. |
| `id` | Unique authored identity; DOM ids are intentionally stripped for isolation. | Report uses authored JSON path; no interactive/DOM id contract. |
| `$schema` | Metadata only; never downloaded or used to choose another schema. | No visible object. |
| `version` | Authored root must be exactly "1.5"; nested cards may omit, but cannot specify another version. | Other versions produce a bounded error panel, not a compatibility downgrade. |
| `requires` | Only adaptiveCards at or below 1.5 or "*" succeeds. All entries validated before fallback. | requires-not-met and substitution/drop diagnostics retain authored paths. |
| `fallback` | Only unsupported types/unmet requires may use typed replacement or "drop"; fatal properties cannot be rescued. | Replacement follows its own contract; omitted content has fallback-dropped, never a hidden success. |
| `body`, `items`, `columns`, `rows`, `cells`, `images`, `inlines`, `facts` | Typed collections/records with the roles declared below; RichTextBlock also accepts string inlines. | Ordered typed content; each child's type/representability contract applies. |
| `isVisible` | False is authored non-display, not an unsupported-feature drop. | No native object/artwork for hidden content. |
| `spacing`, `separator`, `height`, `minHeight`, `bleed`, `verticalContentAlignment`, `horizontalAlignment` | Owned spacing/separator and SDK measured size/alignment; no slide-wide CSS inference. | Native measured geometry/lines/fills; clipped text/images/tables use bounded raster. |
| `size`, `weight`, `color`, `isSubtle`, `fontType` | Owned font sizes/weights/palette: accent/good/warning/attention map to the primary/success/warning/danger semantic roles; other roles use fg, subtle uses muted. | Native equivalent font/paint, not guaranteed pixel-identical Office text. |
| `style` | TextBlock default/heading; container default/emphasis/success/info/warning/danger; Image default/Person; static input/action exceptions below. | Native supported styling; Image Person is bounded raster. Not a host preset. |
| `text` | TextBlock/Fact uses sanitized Markdown; TextRun is plain text. | Native supported inline formatting; lists/RTL or uncorrelated text use bounded raster. |
| `wrap`, `maxLines` | SDK wrapping/maxLines; authored clipping/ellipsis is retained. | Native only when complete text can be measured; otherwise bounded raster (no Office rewrap). |
| `italic`, `underline`, `strikethrough`, `highlight` | Typed TextRun formatting. Underline replaces strike when both true; italic is independent. | Native fragments/highlight rectangles; Markdown can independently retain both decorations. |
| `width` | Column: positive weight/auto/stretch/pixels. Image: pixels. Table column: positive weight/pixels. | Native measured size, subject to Image/Table limits. |
| `url` | Image URLs must pass the asset gate; OpenUrl and MediaSource use their distinct exceptions below. | Native approved image or placeholder; never an unvalidated second fetch. |
| `altText` | Image accessible description; Media also uses it in its static visible label. | Image alt text retained; Media label is a static approximation. |
| `backgroundColor`, `imageSize` | Image background and ImageSet small/medium/large sizes. | Native fill/approved images subject to rectangular unclipped image contract. |
| `rtl` | SDK direction is honored, including inherited direction. | RTL/bidirectional text and tables use explicit bounded raster; representable neighbors stay native. |
| `lang` | SDK language metadata; no date/time macros or templating. | No independent PPTX language/locale behavior; measured visible text is preserved. |
| `firstRowAsHeaders`, `showGridLines`, `gridStyle`, `horizontalCellContentAlignment`, `verticalCellContentAlignment` | SDK header, grid, and alignment. Only default/emphasis grid style. | Native conditional Table; disabled grid/cell spacing, RTL, highlight, clipping or complex cells use bounded raster. |
| `label`, `value`, `placeholder`, `title`, `valueOn`, `valueOff`, `choices`, `isMultiSelect` | Static input labels/initial values/choice mapping and action titles; Fact/Choice exceptions below. | Static approximation; plain generated text, not executable Markdown/control state. |
| `isRequired`, `errorMessage`, `min`, `max`, `maxLength`, `regex`, `isMultiline` | Validated metadata only; not enforced or displayed as live controls (static-input diagnostic). | No input validation behavior; initial value/placeholder approximation only. |
| `actions`, `inlineAction`, `selectAction` | Supported action roles below; static labels or selection metadata only, never browser execution. | Static approximation or safe text-label links; not a whole-chip/whole-image action. |
| `iconUrl` | URL syntax checked, icon ignored and never fetched (static-action-icon diagnostic). | No icon object; static text label only. |
| `mode`, `tooltip` | Validated but ignored by static projection (static-action/static-link diagnostic). | No action overflow menu or hover tooltip. |
| `isEnabled` | False retains disabled static action label and prevents hyperlink creation. | Static approximation without a link when disabled. |
| `data`, `associatedInputs`, `verb` | Opaque validated action data; never executed, collected or submitted (static-action diagnostic). | No payload/verb/input behavior or embedded executable data. |
| `card` | ShowCard tree validated even when collapsed; image bytes in collapsed tree are not fetched. | Static collapsed label, embedded content omitted with static-action diagnostic. |
| `poster` | Media poster uses exactly the Image asset gate. | Static approximation with native approved image, or diagnosed placeholder. |
| `sources`, `mimeType` | Media source metadata only; custom host protocols rejected, no media fetch. | static-media diagnostic; no video/audio output. |
| `orientation` | ActionSet orientation ignored by owned vertical projection (static-property-ignored). | Static approximation, not authored action layout. |

#### Type-specific property overrides

| Type / properties | Browser | PowerPoint |
| --- | --- | --- |
| `Action.OpenUrl` / `url` | Safe HTTP(S)/mailto/tel only, no credentials/controls; no browser navigation. Unsafe URL gets blocked-link; custom protocols error. | Approved text-label hyperlink only; disabled/blocked link has static label without hyperlink. |
| `MediaSource` / `url` | Validated metadata; custom protocols error. Never fetched (even an HTTP(S) URL). | No playable content; covered by static-media diagnostic. |
| `Fact` / `title`, `value` | Required strings; sanitized Markdown inside the aggregate FactSet. | Native table fields only with unambiguous Range correlation; otherwise bounded FactSet raster. |
| `Choice` / `title`, `value` | Required strings for static selection mapping; no live choices. | Selected titles only, plain text; unselected options are not displayed (static-input). |
| `Input.Text`, `Input.ChoiceSet` / `style` | Validated input style; Text password masks value; otherwise control appearance is not reproduced (static-input). | Static approximation only; no text control or dropdown. |
| `Action.OpenUrl`, `Action.Submit`, `Action.Execute`, `Action.ShowCard` / `style` | Validated action style ignored by owned emphasis labels (static-action/static-link). | Static approximation, not positive/destructive host action appearance. |
| `Input.Toggle`, `Input.ChoiceSet` / `wrap` | Validated, but projection uses owned static text layout (static-input). | Static approximation; no input-control wrapping contract. |

### Rejected, ignored and deferred features

| Feature | Browser | PowerPoint |
| --- | --- | --- |
| Unknown/custom property | On resolved content, stripped before SDK parsing with `unknown-property` at its authored path. Unused branches still receive fatal structure checks. | Remaining content uses normal conversion; diagnostic retained. |
| Invalid known property, malformed structure, prohibited property in any branch | Fatal; an unused fallback or collapsed ShowCard cannot hide it. | Bounded error panel; no partially accepted card. |
| Unknown element/action | `unsupported-element` / `unsupported-action`; only explicit static fallback may replace/drop it. | Replacement follows its type contract; drop is diagnosed. |
| Unsafe/missing/invalid/animated image | Approved local gate or deterministic placeholder; remote/redirect/custom-scheme fetching never occurs. | Same bytes/placeholder, including bounded raster; content diagnostic. |
| Safe links | No clickable browser content; only approved URL metadata retained. | Text-label HTTP(S)/mailto/tel links with original color/underline; no credentials or custom protocols. |
| Background images; refresh; authentication; dynamic choices | Unsupported/error, even in fallback/ShowCard branches. | Error artwork and diagnostic, not a hidden omission. |
| Templates, expressions, macros, custom registration, additional versions, host presets | Not implemented. No opt-in setting is provided by this contract. | Not implemented; no full Adaptive Cards/Teams/Outlook compatibility claim. |
| Remote asset allowlists; presenter interactions; richer input/media protocols | Deferred: a separate accepted contract is required before introducing network or interaction behavior. | Static semantics remain the only accepted behavior. |
| Clipping, RTL, lists, Person images, unsupported table layouts | SDK/browser appearance preserved within fixed slide bounds. | Local bounded raster with source/reason; supported neighbors remain native. |
| Shared opacity/filter paint context | Browser paints its shared context normally. | One owner captures the context and absorbs native descendants once; harmless wrappers do not force whole-card raster. |

<!-- adaptive-card-support-matrix:end -->
