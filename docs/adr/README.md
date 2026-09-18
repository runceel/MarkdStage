# Architecture decision records

This directory records architecture-level decisions for MarkdStage: the ones that
constrain more than one surface, move a trust or ownership boundary, or would be
expensive to reverse.

This file is the canonical policy for maintaining architecture documentation.

## Documentation policy

| Document | Responsibility | Maintenance |
| --- | --- | --- |
| [`docs/architecture.md`](../architecture.md) | Current cross-surface structure, boundaries, ownership, and invariants | Rewrite when the current design changes. Do not retain decision history or an ADR index. |
| ADRs in this directory | Context, alternatives, decisions, and consequences that explain why the architecture was chosen | Append only. Keep superseded records and supersede them with a later ADR. |
| [`docs/specs/`](../specs/README.md) | Temporary implementation requirements for cross-surface work | Revise during implementation, then remove or reduce to a compatibility redirect after the work ships. |
| Component documentation and code | Local behavior and implementation details | Keep authoritative details close to the component that implements them. |

The architecture document and ADRs may link to each other, but must not duplicate
the same explanation. Link from the current architecture to an ADR only where an
implementer needs the rationale for a specific rule.

Anything that can be learned by reading the code — function names, algorithms,
file layouts, local UI behaviour — does not belong here.

## Status values

| Status | Meaning |
| --- | --- |
| `Proposed` | Still under discussion. Not yet binding. |
| `Accepted` | The decision is in force. Implementation and verification may still be outstanding; those belong in the record's follow-up. |
| `Superseded` | Replaced by a later ADR. The record is kept unchanged. |

## Index

| # | Title | Status | Decision in one line |
| --- | --- | --- | --- |
| [0001](0001-windows-native-app-packaging-and-runtime-hosting.md) | Windows native app packaging and runtime hosting | Accepted (partially superseded) | Ship one MSIX with a single application entry and a host-owned I/O port, with no bundled language runtime; workspace defaults are superseded by 0002 and interactive CLI execution by 0003. |
| [0002](0002-cli-current-directory-workspace.md) | CLI current-directory workspace default | Accepted | Use the caller's current directory when CLI application or skill commands omit an explicit root, while keeping GUI launch independent of process cwd. |
| [0003](0003-packaged-cli-native-app-activation.md) | Packaged CLI interactive commands activate the native app | Accepted | Hand packaged interactive requests to the installed app and report success only after acceptance; retain explicit headless serving and external-browser console output commands. |
| [0004](0004-agent-skills-as-installation-artifacts.md) | Agent Skills are installation artifacts | Accepted | Generate Skills from canonical guides into user workspaces and keep them out of the development repository's agent discovery directories. |
| [0005](0005-adaptive-card-semantic-and-raster-boundary.md) | Adaptive Cards use SDK semantics and policy-checked raster output | Accepted | Keep typed SDK semantics separate from measured DOM geometry, share pre-render asset policy, and retain bounded whole-card output until native conversion is explicitly validated. |

## Writing a new record

Copy [`0000-template.md`](0000-template.md), take the next free number, and add a
row to the index above in the same change.
