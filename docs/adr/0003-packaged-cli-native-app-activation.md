# 0003: Packaged CLI interactive commands activate the native app

- Status: Accepted
- Date: 2026-09-13
- Supersedes: ADR 0001 interactive CLI execution clause only
- Superseded by: none

## Context

The Windows package includes both a console execution alias and a native
presentation app. Opening a separate browser for interactive CLI commands creates
a second presentation lifecycle, bypassing the app's workspace-window reuse and
native audience window. A shell user should reach the same installed app as a
Start-menu or file activation, while automation commands remain console tools.

ADR 0001's single application entry and host-owned path boundary remain binding.
ADR 0002's caller-current-directory default also remains binding. Starting a
process is not sufficient evidence that the app accepted a requested workspace,
file, or presentation mode.

## Decision

The packaged Windows CLI hands bare invocations, direct Markdown paths, `preview`,
and `present` to the installed native app by default. `--no-open` explicitly
retains the existing long-running local server. The npm CLI remains browser-based.

Activation uses Windows `IApplicationActivationManager` against the current
package's single `!App` entry, with versioned structured launch arguments.
Requests join the existing `AppInstance` lifecycle and canonical-workspace window
registry rather than creating an independent application or browser session.
The app owns presentation state, watching, and the native audience window;
repeated presentation requests must not toggle or duplicate that window.

The CLI resolves shell-relative paths before handoff. Both the CLI and app enforce
the shared canonicalization, link-rejection, containment, existence, and Markdown
file rules. A same-user private per-request pipe carries the app's acknowledgement.
The CLI reports success only after acceptance, not merely after Windows activation
succeeds. Rejection or a missing acknowledgement is a nonzero activation failure.

This supersedes only the interactive execution portion of ADR 0001's CLI browser
policy. Console inspection, capture, and export still require an installed
Chromium-based browser; interactive native presentation uses WebView2. No language
runtime, second package application entry, or external browser is introduced for
native interaction.

## Alternatives considered

- Keep browser launch as the packaged default. This preserves the npm lifecycle
  but loses native audience behavior and canonical-workspace window reuse.
- Start the packaged executable directly. This bypasses the package-supported
  activation boundary and couples the launcher to executable placement.
- Return success when Windows accepts activation. This cannot distinguish a
  usable request from application rejection or initialization failure.
- Replace all console commands with native-app requests. This changes automation
  and external-browser rendering requirements unnecessarily.

## Consequences

### Positive

- Shell and graphical entry points share native workspace and presentation state.
- Interactive commands return promptly after acceptance without owning a server.
- Agents can distinguish accepted requests from launch failures.

### Negative

- Packaged and npm interactive lifecycles differ and must be disclosed.
- The acknowledgement channel adds a bounded, same-user IPC trust boundary.
- Native theme selection belongs to the app: interactive CLI theme overrides
  are rejected unless `--no-open` is selected, rather than silently ignored.

### Follow-up

- Keep the [CLI execution model](../specs/windows-app-msix.md#7-cli-execution-model),
  bilingual guides, and packaged Windows acceptance checklist aligned.
