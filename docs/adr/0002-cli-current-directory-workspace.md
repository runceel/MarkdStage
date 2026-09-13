# 0002: CLI current-directory workspace default

- Status: Accepted
- Date: 2026-09-13
- Supersedes: ADR 0001 workspace-root clause only
- Superseded by: none

## Context

ADR 0001 rejected the process working directory as a workspace input for every
surface because a Start-menu launch receives a system directory. That constraint
is valid for the GUI but unnecessarily removed normal shell behavior from the
execution-alias CLI. A user who starts the CLI from a repository root reasonably
expects that directory to be the workspace, including for skill installation.

The CLI and GUI still need identical path confinement after a root is selected.
The change is only about how a shell invocation selects its default root.

## Decision

A CLI application invocation with no file and no `--workspace` uses the caller's
current directory as the workspace. CLI skill installation and checking use the
same directory when neither `--root` nor `--workspace` is supplied.

The GUI does not use its process working directory. It continues to select a
workspace from user interaction, activation, or persisted state. All selected
roots are made absolute and pass through the same canonicalization, link
rejection, and confinement boundary.

## Alternatives considered

- Require explicit roots on every CLI invocation. This is unambiguous but makes
  the execution alias behave unlike ordinary repository-oriented command-line
  tools and caused valid invocations from a repository root to fail.
- Apply the current directory to both GUI and CLI launches. This would make
  Start-menu behavior depend on an implementation-provided system directory and
  would not represent user intent.

## Consequences

### Positive

- Running `markdstage` from a repository root opens that repository immediately.
- Running `markdstage skill install` installs into the current repository by
  default.
- Explicit file and workspace behavior, including confinement, is unchanged.

### Negative

- GUI and CLI launch defaults are intentionally different and must be documented
  and tested separately.
- Scripts that relied on a bare CLI invocation failing must pass an explicit
  invalid path if they need to test input errors.

### Follow-up

- Keep packaged and npm CLI behavior aligned for application and skill commands.
