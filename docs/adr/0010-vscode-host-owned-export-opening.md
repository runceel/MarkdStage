# 0010: VS Code owns opening completed exports

- Status: Accepted
- Date: 2026-10-02
- Supersedes: none
- Superseded by: none

## Context

After a PDF or PowerPoint export, the preview shows the saved path as a link
that asks the serving CLI to open the file with the operating system. Within VS
Code this link is unreliable: the packaged Windows CLI does not serve that route,
so the link fails, and in remote workspaces the CLI host is not the machine where
the user works, so opening the file there is not useful.

The extension already owns CLI process lifecycle and projection of product UI
into VS Code, and ADR 0009 established post-startup host events on the versioned
JSON-lines stream.

## Decision

When the extension requests host ownership of exports, the CLI reports each
completed export as a versioned JSON-lines event containing the owning preview,
the format, and the absolute saved path. The export response tells the preview
that the host owns opening, and the preview shows the location as plain text.

The extension accepts only events for the preview it owns, with the detected CLI
version, a path inside the workspace, and an extension matching the format. It
shows a VS Code notification offering to reveal the file and, in local
workspaces, to open it. Export behavior and output remain in the CLI.

The extension requests this mode only from CLI versions that support it, so
older compatible CLIs keep their existing behavior.

## Alternatives considered

- Add the open-export route to the packaged Windows CLI as the VS Code
  solution. Rejected because opening still happens on the CLI host, which is
  wrong for remote workspaces and bypasses VS Code's notification surface. The
  route is still provided for browser use outside VS Code.
- Keep the in-page link. Rejected because it fails on the packaged CLI and gives
  no VS Code-native feedback.

## Consequences

### Positive

- Export completion uses VS Code's notification and Explorer surfaces.
- Remote workspaces do not open files on the remote host.
- Both CLI implementations behave the same for the host.

### Negative

- The wrapper protocol gains another post-startup event that both CLIs must
  preserve.
- The feature activates only with CLI versions newer than 4.4.0.

### Follow-up

- Keep protocol tests on both CLI implementations and the VS Code session
  manager.
- Outside VS Code, both CLI implementations serve the in-page open-export route
  with the same workspace, extension, and same-origin checks.
