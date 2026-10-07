# 0011: Incremental reveals use shared semantic schedules

- Status: Accepted
- Date: 2026-10-07
- Supersedes: none
- Superseded by: none

## Context

Presenters need progressive list and Architecture diagram content without
duplicating Markdown, changing logical slide counts, or introducing arbitrary
animation code. MarkdStage runs the same authored deck through Canvas, Node
browser presentation, Desktop, and PowerPoint export, so a host-local counter or
an export-only timeline would make those surfaces disagree.

One Architecture target may emit several editable objects, and one list may
emit a text shape containing multiple paragraphs. Unsupported output conversion
must not silently merge requested steps. Generated timing XML can be structurally
checked, but only presentation-application playback proves the resulting click
behavior.

## Decision

- Reserved, block-bound Markdown comments compile into one ordered, slide-local
  reveal schedule. Lists target logical items according to their selected nested
  policy; Architecture steps target IDs scoped to the following diagram.
- The shared session owns both slide index and reveal position. Advance and
  rewind are build actions; direct slide navigation is a separate action and
  resets the destination to its initial state. Source reload preserves the
  position only when the current slide and its schedule are unchanged.
- Presentation rendering hides unrevealed targets without changing completed
  layout geometry and removes hidden targets from accessibility interaction.
  Reading, editing, inspection, PDF, and image output always render the complete
  slide.
- PPTX output retains semantic provenance through native object and paragraph
  generation. Every object emitted for one semantic target shares its authored
  step. If a fallback combines objects from different steps, the requested
  animation is rejected instead of flattened or silently collapsed.
- The initial native effect is click-triggered Appear. Browser behavior does not
  establish PowerPoint accessibility or application compatibility; supported
  PowerPoint playback and accessibility require separate verification.

## Alternatives considered

- Keep a browser-local build counter. Rejected because presenter, audience, and
  native-host views could diverge or lose rapid actions.
- Duplicate slides for every build. Rejected because content is repeated and
  slide counts/page numbers change.
- Animate only in PPTX or only in the browser. Rejected because authored steps
  must have equivalent behavior across presentation surfaces.
- Rasterize a whole diagram or slide to manufacture animation. Rejected because
  it loses editability and cannot preserve independent semantic steps.
- Expose arbitrary PresentationML, JavaScript, or CSS animation in Markdown.
  Rejected because the requested model is deliberately small and portable.

## Consequences

### Positive

- Markdown remains the readable source of truth and each build adds content
  without creating another logical slide.
- Browser state, host navigation, and native output share deterministic
  grouping and order.
- Native PowerPoint objects remain editable when their target provenance is
  preserved; unsupported schedules fail explicitly.

### Negative

- The parser, session snapshot, host action contract, renderer, and PPTX writer
  must retain compatible schedule semantics.
- Native output is limited to representable paragraph/object targets and
  click-triggered Appear; it is not a general animation timeline.
- PowerPoint and browser accessibility behavior are separate contracts.

### Follow-up

- Verify click-by-click output in PowerPoint desktop and PowerPoint for the web;
  evaluate LibreOffice Impress separately. XML presence and package checks are
  not playback evidence.
- Evaluate PowerPoint accessibility independently of browser `aria-hidden` and
  `inert` behavior.
- Keep the authoring grammar, limits, and diagnostics in the canonical guide and
  user-facing presentation documentation.
