# Architecture decision records

This directory records architecture-level decisions for MarkdStage: the ones that
constrain more than one surface, move a trust or ownership boundary, or would be
expensive to reverse.

An ADR answers *why the current architecture is the way it is*. It is append-only.
Superseded records stay in place; a later ADR supersedes them.

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
| [0001](0001-windows-native-app-packaging-and-runtime-hosting.md) | Windows native app packaging and runtime hosting | Accepted | Ship one MSIX with a single application entry, host the shared JS runtime in the embedded browser behind a host-owned I/O port, bundle no language runtime, and treat an installed Chromium-based browser as a CLI prerequisite. |

## Writing a new record

Copy [`0000-template.md`](0000-template.md), take the next free number, and add a
row to the index above in the same change.
