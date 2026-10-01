# 0008: Expose Architecture DSL editing through the canonical editor

- Status: Accepted
- Date: 2026-10-01
- Supersedes: none
- Superseded by: none

## Context

The VS Code extension needs a practical shape-editing workflow, but the shared
MarkdStage runtime already provides Architecture DSL editing, source-backed
saves, stale-source protection, and workspace confinement. A second VS Code
webview editor would duplicate parsing, rendering, persistence, and conflict
handling across product surfaces.

## Decision

The VS Code extension exposes Architecture DSL editing through the existing
CLI-backed preview and its canonical Shape editing control. The CLI/server and
shared runtime remain the owners of diagram semantics, source mutation,
validation, and security. The extension only selects the current Markdown file,
manages the process, and opens the preview URL.

The initial scope is Architecture DSL nodes, groups, connectors, and their
source-backed layout. Arbitrary Markdown shapes or a separate VS Code custom
editor are out of scope.

## Alternatives considered

- Implement a dedicated VS Code webview editor. Rejected because it would
  duplicate the canonical editor and create another persistence and conflict
  boundary.
- Add a new shape format for VS Code. Rejected because Markdown Architecture
  DSL is the product source of truth and existing surfaces already understand
  it.
- Require users to start a browser manually. Rejected because the extension can
  safely request the existing editor mode through the CLI URL.

## Consequences

### Positive

- Shape editing remains behaviorally aligned with Canvas and CLI workflows.
- Source writes retain the existing atomic and stale-source protections.
- The extension change is small and does not introduce a new renderer.

### Negative

- Editing uses the browser-based Architecture Editor rather than native VS Code
  canvas controls.
- The CLI must be compatible and available in the extension-host environment.
- Arbitrary non-Architecture Markdown shapes remain unsupported.

### Follow-up

- Add deeper VS Code integration only if user feedback shows that the browser
  editor lacks required document or navigation affordances.
