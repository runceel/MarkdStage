# Adaptive Cards Phase 0: executable spike

This is the bounded implementation and evidence for
[#228](https://github.com/runceel/MarkdStage/issues/228), not the Phase 1 product
contract or a Phase 2 editable converter. The durable boundary is
[ADR 0005](https://github.com/runceel/MarkdStage/blob/main/docs/adr/0005-adaptive-card-semantic-and-raster-boundary.md).
Reproduction commands and fixture ownership are in the
[fixture documentation](https://github.com/runceel/MarkdStage/blob/main/test/fixtures/adaptive-cards/README.md).

## Compatibility envelope

An `adaptive-card` fence accepts resolved JSON with `type: "AdaptiveCard"`,
`version: "1.5"`, and a `body` array. The official JavaScript SDK is **3.0.6**;
parsing uses its **1.5** serialization context and validation events. This is
not a claim that every schema-1.5 feature is implemented or that the spike is
a complete JSON Schema validator.

The exercised static elements are TextBlock, RichTextBlock/TextRun, Container,
ColumnSet/Column, Image/ImageSet, FactSet, and Table/TableRow/TableCell. Explicit
supported types are required in element collections. String RichTextBlock
inlines remain an SDK-supported shorthand.

The input ceiling is **262,144 UTF-8 bytes**, **256 JSON objects/arrays**, and
**16 JSON nesting levels**, including inline data images. The existing image
limits of **10 MiB per image** and **100 MiB total** also apply to loaded assets.
The byte ceiling intentionally makes the spike narrower than the image limits.

Invalid JSON, unsupported versions/types, SDK parse/validation events, image
failures, and missing rendered geometry produce a visible diagnostic card.
Actions (including empty action collections), inputs, select/inline actions,
refresh, authentication, background images, templating, `requires`, and SDK
`fallback`/`fallbackText` are explicitly rejected. They are not silently dropped
or delegated to the SDK. Compatibility/fallback expansion belongs to later work.

## Resource and Markdown policy

All JSON image URLs are checked before the first resource is fetched or the SDK
renders. Images may use `assets/...`, `/assets/...`, their scoped same-origin
equivalent, or supported PNG/JPEG/GIF/SVG data URLs. Other origins, schemes,
redirects, traversal/encoded traversal, query strings, and fragments are denied.
Only the host's approved assets route is eligible; same origin alone does not
authorize arbitrary endpoints.

Workspace reads retain the host's canonical-path, link, origin, content-type,
and size checks. Browser reads are additionally bounded while streaming, MIME
signatures are checked, and approved bytes become data images before rendering.
SVG scripts, foreign HTML, animation, external references/stylesheets/entities,
and escaped CSS resource references are rejected. Both local and data SVGs reject
`animate`, `animateColor`, `animateMotion`, `animateTransform`, and `set` before
SDK rendering, with a visible `blocked-image` diagnostic. Capturing the card rechecks
its SDK image references and public image elements against the approved bytes.
An asset error produces safe diagnostic artwork, never an unsafe screenshot.

Card Markdown uses the existing marked and DOMPurify libraries with a small
formatting-only allowlist. Resource tags and link attributes are removed and
reported as `markdown-sanitized`; retained links are non-interactive text.
JSON image rejection and Markdown sanitization both prohibit network access,
including during export. Sanitization diagnostics accompany the card's fallback
report; fatal card diagnostics are also visible on the slide.

## Semantic and measurement interface

The renderer creates `.adaptive-card-host[data-adaptive-card-block]`.
`data-adaptive-card-state` becomes `ready` or `error` before output readiness.
The host's open shadow root contains SDK output and MarkdStage-owned Markdown
styles, isolating it from `.body` paragraph/table/image selectors.

`getAdaptiveCardModel(host)` exposes the real parsed SDK card for the spike.
`collectAdaptiveCardGeometry(host, deck)` returns a JSON-safe version-1 snapshot:

- SDK, schema and HostConfig versions, status and diagnostics;
- host bounds and typed objects with type, authored ID (or null), sourcePath,
  parentPath, bounds, text rectangles and style facts;
- separate `renderedElement`, `hidden`, and `aggregate-only` coverage.

Traversal uses SDK collection APIs, not DOM children. Paths describe the typed
tree, not byte offsets into source JSON. Image elements and separators use their
public SDK references for readiness/resource checks and measurement. Text-node
Ranges measure text layout inside an already identified object's rendered
element; they never infer object kind, hierarchy, or style. Coordinates are
deck-relative, corrected for deck scale, and retained to **0.001 px**.

The style snapshot is detached JSON. This matters because Playwright preserves
JavaScript `undefined` values while the native JSON transport omits them.
The initial transport comparison exposed that difference; normalizing the
snapshot, rather than ignoring semantic differences in the comparison, fixes it.

## HostConfig v1 and style facts

The minimal HostConfig takes only the deck font family and resolved `fg`,
`muted`, `accent`, `surface`, and `border` palette tokens. Default containers are
transparent; emphasis containers use `surface`. This is not Teams/Outlook
styling. Other foreground color roles intentionally use the default foreground
in this minimal configuration.

| Fact | Source of truth |
| --- | --- |
| Type, identity, parent/order, text, wrapping, visibility | SDK typed objects and effective-property getters |
| Text sizes 16/20/24/28/32 px; weights 300/400/600 | MarkdStage HostConfig font definitions |
| TextBlock line heights 20/26/31/36/42 px | HostConfig; TextRun inherits the owned 26 px rich-text context |
| Container color/padding, spacing, separator color/thickness | Effective SDK style/padding plus HostConfig |
| Column auto/stretch/weight/pixel intent | SDK `width` / SizeAndUnit |
| Image intent and pixel dimensions | SDK Image properties |
| Table columns, header/grid/cell semantics | SDK Table/Row/Cell objects and HostConfig |
| Bold/italic/code/link formatting within TextBlock Markdown | Sanitized marked formatting plus owned shadow styles, not SDK-generated classes |
| Actual columns, wrapping and glyph rectangles | Public rendered elements and text Ranges |

**No arbitrary SDK computed-style inspection is used as a style source.** The
only computed-style input is the allowlisted deck palette/font context.
Individual Markdown formatting spans are not SDK TextRuns; later native work
must use the sanitized Markdown semantics or explicitly retain a fallback.

Two limitations are significant:

- **Fact** has typed title/value, but SDK 3.0.6 constructs temporary internal
  TextBlocks and exposes no individual Fact rendered element. FactSet aggregate
  geometry is measured; its three fixture Facts explicitly have null bounds.
  This is an unresolved native strategy, not a permanent raster-only rule for
  FactSet. Phase 2 must assess facts + aggregate bounds + HostConfig and any
  explicitly justified additional measurement.
- A separator's public element bounds include spacing, not just its painted
  stroke. For example, the typography fixture has a **12 px** separator box for
  a **1 px** line and **22 px** spacing. Only connected, visible authored
  separators are reported. Likewise, weighted columns use SDK flex layout:
  the fixture measures **177.094 / 352.906 / 530 px**, not an invented exact
  pixel ratio, because percentage bases interact with padding and gaps.

## PowerPoint boundary and scene evaluation

The dedicated card collector runs before generic HTML collection, owns exactly
one whole-card fallback, and reports `adaptive-card[blockIndex]` and a reason.
The existing `pptxFallback` mask/capture/package flow supplies transparency,
slide clipping and paint order. Both Node and portable/native CDP paths align
card crops to integer pixels; no extra picture is collected from card internals.

The card host is an isolated, positioned paint unit. Actual image inspection
found an initial mismatch: a neighboring positioned HTML background painted
above a static card in the browser while PPTX put the card above it. The host
stacking boundary fixes that mismatch. The collision fixture now checks real
browser hit-testing as well as model order and actual PowerPoint pictures.
Equal geometry alone would not have caught this defect.

**Phase 0 uses the existing direct PPTX fallback model.** Adding a Scene Graph
source solely to wrap the same PNG would enlarge a closed contract without
testing an editable representation. No source/node kinds or native converters
are added.

For later editable work, the preferred starting point is an intentional minimal
scene source extension reusing existing text/shape/image/connector primitives,
not another generic HTML converter. FactSet/Table need a separate decision:
the current Scene Graph has no table node, while the PPTX writer already accepts
native tables. A bounded direct table bridge versus a table scene extension
must be evaluated in Phase 2. This spike does not settle that untested choice.

## Measurements: Windows ARM64, 2026-09-19

The source fixtures were rendered as **7 pages in each of 4 themes** (dark,
light, microsoft, custom). The same capture URL and snapshot were opened in
Playwright Chromium and a real visible CoreWebView2 controller. This is native
WebView2 evidence, **not a UA spoof and not execution of the WinUI shell**.

| Environment / check | Actual result |
| --- | --- |
| Playwright Chromium | 151.0.7922.34, 1280x720, DPR 1, reduced motion |
| Native WebView2 | 153.0.4234.46, ARM64, Core projection 1.0.3719.77 |
| Native controller | 1280x720, DPR/rasterization/zoom 1, visible; actual `msedgewebview2.exe` path and PID recorded |
| Native probe | Desktop STA dispatcher, WindowsAppSDK 2.4.0; built locally with .NET SDK 11.0.100-rc.1.26425.128 |
| Measured static coverage per theme | **57 CardElements**, plus **3 aggregate-only Facts**; one deliberately rejected interactive card |
| Chromium vs WebView2 geometry | **0 px** maximum element/edge and text-rectangle difference for measured objects in all 28 pages |
| Within-engine repetition | Geometry and visible pixels identical in two measurements/captures per page |
| Across-engine visible pixels | Not identical: up to **45,148 / 921,600** changed pixels in the multiline typography fixture; side-by-side/overlay evidence retained, separate from geometry verdict |
| PowerPoint desktop | **16.0.20430.20048**; all 4 actual PPTX files opened read-only and 28 fixture pages rendered to 1280x720 PNG |
| PowerPoint card pictures | Exactly one per fixture page; **0 px** placement/size difference from integer capture bounds; original PPTX SHA-256 unchanged |
| WinUI application shell, installed MSIX activation | Not run by this spike's probe |
| PowerPoint for Web / LibreOffice Impress | Not run |

The comparison enforces the repository's **2 px edge** and **3 px text** review
tolerances; missing objects, changed text/style/identity, changed text-rectangle
counts, or wrong order fail independently. Ranges expose text rectangles,
**not typographic baselines**. Actual PowerPoint baselines and visual occlusion
still require image inspection; geometry equality alone is not acceptance.
The intended over-tall fixture must remain clipped, and the unsupported input
must remain a diagnostic, in every output.

SDK bytes: **334,964**, gzip size **83,266**, one chunk below the existing
**524,288-byte** ceiling. SHA-256:
`5e7c13f3300ae7b89b34703501e08d709fbb6635f1c6755b92495577a77344f2`.
The official SDK license and bundle notice are retained. No additional vendor
chunking mechanism is needed.

Three cold-document samples on the recorded machine requested **zero** card
resources for ordinary Markdown, and exactly the adapter plus one SDK resource
for a card. Measured ready times were **368.5-522.0 ms** without a card and
**428.8-523.7 ms** with the multiline typography card (medians **383.9 / 429.5 ms**).
These are local observations, not a latency SLA or a controlled SDK-only CPU
benchmark. The SDK request body was 334,964 bytes; gzip size above is a measured
compression size, not the local server's wire encoding.

## Go / no-go

**Conditional go for the next rendering/raster layer.** The measured static
CardElements correlate stably without DOM/CSS semantic inference, and the real
whole-card PPTX pipeline is executable. **No unconditional go for editable
conversion:** Facts remain aggregate-only, Markdown spans need a semantic
strategy, native text layout is untested, and the committed candidate must pass
the coordinator's independent exported-file visual gate.

The geometry kill criterion was not observed for the measured subset. It has
not been evaluated for every schema object or unexercised property. A future
genuine correlation/stability failure must retain raster output and be reported,
not hidden by tolerance changes or wholesale screenshot regeneration.
