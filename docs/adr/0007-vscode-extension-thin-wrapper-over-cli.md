# 0007: VS Code extension is a thin wrapper over the CLI

- Status: Accepted
- Date: 2026-10-01
- Supersedes: none
- Superseded by: none

## Context

Adding VS Code as a MarkdStage surface introduces a second host lifecycle and,
for remote workspaces, a split between the local user interface and the
environment that owns workspace access. MarkdStage already has a CLI boundary
that owns parsing, rendering, validation, Agent Skill generation, and
security-sensitive workspace operations.

Reimplementing or bundling those responsibilities in the extension would create
another product runtime, another security boundary, and another generated Skill
copy to keep compatible. Allowing the extension and CLI to version independently
would also make support and diagnostics depend on combinations rather than one
product identity.

The initial extension must provide an integrated preview without introducing a
separate browser distribution. VS Code Web cannot provide the same external CLI
process and extension-host environment assumed by this boundary.

## Decision

The VS Code extension is a thin wrapper over an independently installed,
compatible MarkdStage CLI. The CLI owns parsing, rendering, validation, Agent
Skill generation, and security enforcement. The extension owns workspace
discovery, installation and compatibility guidance, CLI process lifecycle,
diagnostics, and projection of MarkdStage UI into VS Code.

The extension does not bundle the CLI or a generated Agent Skill copy. The
extension and CLI use one MarkdStage product version rather than independently
versioned product components.

Initial preview uses VS Code's built-in browser surface. For remote workspaces,
the CLI must be available in the environment that runs the extension host.
Installing it only on the local UI machine is insufficient. A VS Code Web
extension is not supported initially.

## Alternatives considered

- Bundle the CLI and generated Skill in the extension. Rejected because it
  duplicates distribution artifacts, obscures which runtime owns security, and
  creates another copy that can drift from other MarkdStage surfaces.
- Reimplement parsing, rendering, validation, or security in the extension.
  Rejected because it forks shared product behavior and moves trust decisions
  into an additional host adapter.
- Allow independent extension and CLI versions. Rejected because compatibility
  would become a matrix of component combinations rather than one supported
  product version.
- Run a local CLI against remote workspaces. Rejected because workspace access
  and process ownership belong to the remote extension-host environment.
- Support VS Code Web in the initial architecture. Rejected because the browser
  extension host does not provide the external CLI process boundary selected
  for the product.

## Consequences

### Positive

- VS Code gains an integrated surface without creating another product runtime
  or security implementation.
- CLI behavior, diagnostics, Skill generation, and workspace protections remain
  aligned with other CLI-backed workflows.
- Remote workspace execution follows VS Code's extension-host placement rather
  than crossing the local/remote workspace boundary.
- One product version defines compatibility and support.

### Negative

- Users must install a compatible CLI in every environment that hosts the
  extension, including remote development environments.
- The extension cannot operate when the CLI is unavailable or incompatible; it
  must guide installation or correction instead of silently substituting local
  behavior.
- VS Code Web remains unavailable until a different execution and trust
  boundary is accepted.
- The built-in browser constrains the initial preview to capabilities available
  through the VS Code host.

### Follow-up

- Keep the current architecture surface table, cross-surface invariants, and
  release versioning aligned as the VS Code surface is introduced.
- Revisit Web support only through a later architecture decision that defines
  its runtime and security boundary.
