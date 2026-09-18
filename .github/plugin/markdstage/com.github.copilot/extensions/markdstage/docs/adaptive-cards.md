# Adaptive Cards: static rendering and PowerPoint artwork

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
data source is supported. Expand the payload before authoring.
Actions (even empty action arrays), select/inline actions, refresh,
authentication, background images and root `fallback`/`fallbackText` are errors.
Inputs, media, unknown elements and other schema versions are not rendered as if
they were supported. Non-interactivity is fixed; links in card Markdown become
non-clickable text.

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
`markdown-sanitized`. The SDK subtree is sanitized **in place before attachment**;
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

PowerPoint contains **one bounded transparent PNG per visible card**, including
its placeholders or error panel. Card internals are not also collected as generic
HTML/text. Positions, clipping and paint order follow the rendered slide.
The export report uses `adaptive-card-rendered-as-artwork` with content impact
and the card's diagnostic locations. Error panels use `adaptive-card-<error-code>`;
fully off-slide cards have no zero-sized picture and report
`adaptive-card-outside-slide`, still with content impact.

Cards are **not editable text, shapes or tables in PowerPoint**. This increment
does not add an Adaptive Cards Scene Graph source or a native converter.
Individual Fact geometry remains aggregate-only evidence; raster fidelity is not
proof that editable conversion is feasible. Review the actual exported PPTX in
PowerPoint as well as the browser preview.
