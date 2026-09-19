# 0005: Adaptive Cards use SDK semantics and policy-checked raster output

- Status: Accepted
- Date: 2026-09-19
- Supersedes: none
- Superseded by: none

## Context

Adaptive Cards adds an upstream HTML renderer to the shared slide pipeline.
Browser layout is useful evidence, but the SDK's generated CSS classes and DOM
hierarchy are not a semantic interchange contract. Treating them as one would
couple every product surface and future PowerPoint conversion to implementation
details of another renderer.

The architecture spike for [#228](https://github.com/runceel/MarkdStage/issues/228)
uses the real, pinned SDK in Chromium and a native WebView2 controller. Public
object-to-element references provide measurable geometry for the exercised static
CardElements. Some semantic objects, notably individual facts, have no public
rendered element. This distinction prevents an unconditional claim that the
entire schema is ready for editable conversion.

Cards also introduce untrusted Markdown and resource references. Raster output
must not become an alternative route around the existing asset trust boundary.
The [component findings](../../.github/extensions/markdstage/docs/adaptive-cards-spike.md)
record the tested subset, engine versions, measurements, and remaining gaps.

## Decision

The canonical shared renderer owns the card integration on every surface.
Official SDK objects supply semantic identity, properties, order, and hierarchy.
Their public rendered-element references supply geometry and text-layout
measurements only. Generated class names, DOM hierarchy, and arbitrary computed
styles do not determine card semantics.

MarkdStage owns a versioned, limited HostConfig and isolates card content from
slide stylesheet selectors. The SDK and supported schema are pinned. The SDK is
vendored and loaded only when a card fence is present; it is not downloaded by
the running product.

Card payloads are resolved JSON with non-interactive presentation semantics.
The spike explicitly diagnoses excluded capabilities instead of delegating
unsupported content to an opaque SDK fallback. Markdown passes through the
existing marked and DOMPurify stack.

Card resources are approved before SDK rendering. Only bounded, supported data
images and host-confined, same-origin workspace assets are eligible. Remote
resources and redirects are denied. The renderer and raster output consume the
same approved image bytes. Neither an SDK fallback nor PowerPoint fallback can
relax that policy.

Phase 0 exports whole-card artwork through the existing bounded PowerPoint
fallback contract. Dedicated collection owns that artwork before generic HTML
collection. The shared Scene Graph remains unchanged: measurement evidence is
not permission to extend its closed contract or introduce a native converter.

## Alternatives considered

- Infer semantics from generated HTML/CSS. Rejected because it replaces the
  stable typed model with upstream implementation details.
- Implement card layout independently of the SDK. Rejected because that would
  duplicate host configuration, text, columns, and fallback layout before
  feasibility is established.
- Adopt another product's HostConfig. Rejected because its appearance and
  compatibility policies are not MarkdStage's contract.
- Add editable scene or direct PowerPoint elements immediately. Deferred because
  some semantic objects lack individual geometry and editable text has a
  different layout engine. A bounded raster result provides executable evidence
  without committing to those assumptions.
- Permit remote images only for screenshots. Rejected because identical card
  input would cross different trust boundaries depending on its output format.

## Consequences

### Positive

- All surfaces share semantic, styling, resource, and error decisions.
- Raster output preserves the browser result without a second layout engine.
- Later native work can distinguish measured support from aggregate-only or
  rejected content instead of claiming support through silent omission.

### Negative

- Whole-card output is not editable inside PowerPoint.
- The initial compatibility envelope is deliberately narrower than schema 1.5.
- Local image approval and SDK startup add work only on card-bearing slides.
- Isolation and upstream changes require actual browser-engine verification.

### Follow-up

- The independent visual gate must inspect the committed candidate's exported
  file, not just the measured geometry or this decision.
- Later editable work must explicitly choose and test its scene/PPTX contract.
  Individual Fact geometry remains an open strategy question, not a permanent
  decision that FactSet must always be rasterized.
- If object geometry cannot be correlated reliably, or actual engines exceed
  the established layout tolerances, retain raster-only export rather than
  proceeding with editable conversion.
