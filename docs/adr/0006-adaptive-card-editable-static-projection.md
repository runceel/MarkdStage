# 0006: Adaptive Cards use a typed static projection and bounded native export

- Status: Accepted
- Date: 2026-09-19
- Supersedes: the raster-only export restriction in [0005](0005-adaptive-card-semantic-and-raster-boundary.md)
- Superseded by: none

## Context

The pinned SDK supplies stable identities and geometry for the initial static
card elements, but does not supply a PowerPoint renderer. Individual Facts have
typed content without individual rendered-element references. Interactive
protocol state has no portable meaning in an ordinary presentation. Treating
generated HTML as a semantic model, enabling interaction to obtain a screenshot,
or reimplementing the entire card layout engine would cross the established
ownership and trust boundaries.

Editing supported card content is useful even when a neighboring feature cannot
be represented faithfully. Browser and Office text engines are different, so
editable output requires both explicit representability limits and actual
presentation-application review.

## Decision

The canonical shared renderer retains the original official SDK model as the
semantic source. A host-owned, explicitly non-interactive projection represents
input values, action labels, collapsed disclosure and approved media posters.
The projection is shared by every browser and output surface. It retains
authored provenance; it does not run callbacks, submit data or enable SDK
interactivity.

Native conversion traverses the projected typed SDK tree. Public rendered
references and text Ranges provide only geometry and text-layout evidence.
Formatting comes from the pinned, sanitized Markdown representation and the
owned HostConfig, not generated classes, DOM hierarchy or arbitrary CSS.
For aggregate-only Facts, typed fields are correlated to text within the public
FactSet region. A failed correlation is not permission to guess a layout.

Common shapes, measured text, images and separators use the shared Scene Graph
with an explicit `adaptive-card` source. Native tables and text-run hyperlinks
use the existing direct PowerPoint model; card-specific protocol concepts do
not expand the Scene Graph. Measured text lines are not rewrapped by Office.

Unrepresentable content is captured at the nearest reliable subtree boundary.
That subtree has one owner and no duplicate native descendants. Whole-card
artwork remains the safety boundary for missing correlation, structural errors
or unaccounted visible SDK output. Collection does not mutate the rendered
appearance. Temporary export masks preserve layout and clipping and are isolated
from normal display.

Native images, media posters and every raster fallback use the same immutable,
pre-approved bytes and deck-wide resource budget. Hyperlink approval is distinct
from asset fetching and retains the existing rendered-link sanitizer. A permitted
PowerPoint link never enables interaction or network loading in the browser.
Reports distinguish native, approximated and rasterized content with authored
locations and content impact across all hosts.

## Alternatives considered

- Keep every card as one image. Rejected as the default because it loses editing
  even where typed content and measured geometry are reliable.
- Infer facts, formatting and columns from SDK HTML/CSS. Rejected because this
  makes upstream implementation details a cross-surface semantic dependency.
- Add table and action nodes to the shared scene contract. Rejected because the
  existing PowerPoint table/link model already expresses the necessary output,
  while actions and inputs have no corresponding portable scene behavior.
- Implement independent card layout. Rejected because it would duplicate the
  SDK's wrapping, spacing and column rules instead of measuring their result.
- Turn on interactivity for rendering, then remove event handlers. Rejected
  because it creates an unnecessary executable state and a second browser/output
  contract.
- Use identical-wrap or pixel-identical-text claims. Rejected because Office
  and browser text engines require bounded measurement and visual verification.

## Consequences

### Positive

- Supported text, fills, images and tables remain independently editable.
- A local unsupported feature does not destroy editing of supported neighbors.
- All surfaces share static semantics, provenance, diagnostics and resource
  approval; export cannot create a more permissive asset path.

### Negative

- Text is split into measured fragments rather than one reflowing card.
- Correlation, font behavior and native tables require pinned-engine regression
  evidence and real PowerPoint inspection.
- The supported native subset is narrower than the browser schema envelope;
  bounded artwork is an intentional outcome, not a silent success substitute.

### Follow-up

- The coordinator's independent actual-PPTX visual gate applies to the committed
  candidate. Implementation-session renders and XML checks do not replace it.
- Keep exact representability limits in the component guide and fixture tests.
  The current architecture describes the enduring cross-surface boundary.
