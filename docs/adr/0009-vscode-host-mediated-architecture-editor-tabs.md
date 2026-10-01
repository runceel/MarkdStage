# 0009: VS Code mediates Architecture Editor tabs

- Status: Accepted
- Date: 2026-10-01
- Supersedes: none
- Superseded by: none

## Context

The canonical preview can request an Architecture Editor session asynchronously.
Ordinary browsers can project that session into another window, but VS Code's
built-in browser does not reliably preserve browser-created popup navigation.
Pre-opening a blank page creates a visible `about:blank` tab, while same-tab
navigation discards the preview and adds unnecessary return navigation.

The CLI must continue to own editor creation, source access, saves, and workspace
security. The VS Code extension already owns process lifecycle and projection of
CLI product surfaces into VS Code.

## Decision

For VS Code integration, the CLI creates or reuses the canonical Architecture
Editor session and reports its URL over the existing versioned JSON-lines
process stream. The preview does not navigate when this host-targeted operation
succeeds.

The extension accepts only compatible loopback editor events from the CLI
process it owns, applies remote URI projection when required, and opens the URL
in a separate VS Code browser tab. Editor behavior and persistence remain
entirely in the CLI and shared runtime.

## Alternatives considered

- Let the preview use `window.open`. Rejected because popup creation and
  asynchronous navigation are unreliable in the built-in browser and can leave
  blank tabs.
- Navigate the preview tab to the editor. Rejected because it removes the
  preview context and requires explicit return navigation.
- Implement a VS Code-specific editor. Rejected for the ownership and drift
  reasons recorded in ADR 0008.

## Consequences

### Positive

- Preview and editor remain open as independent VS Code tabs.
- The canonical editor and source-save protections remain shared across
  surfaces.
- Remote extension hosts can use VS Code's existing URI projection boundary.

### Negative

- The wrapper protocol includes post-startup events in addition to readiness.
- Both npm and packaged Windows CLIs must preserve the same host-event contract.
- The extension must reject incompatible or non-loopback editor events.

### Follow-up

- Keep protocol tests on both CLI implementations and the VS Code session
  manager.
