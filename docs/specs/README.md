# Specifications

This directory holds cross-surface specifications: documents that say *what to
build* when the work spans more than one surface and cannot be tracked in an
issue.

A specification is transient. It carries its own lifetime in its header, and it
is deleted once the work it describes ships; anything still true at that point
moves into the current-state architecture documentation.

An [architecture decision record](../adr/README.md) answers *why* a design was
chosen and is append-only. A specification answers *what to build* and is revised
freely — but it may never contradict a record. If specification work shows a
decision to be wrong, a new record supersedes the old one.

## Index

| Document | Status | Target |
| --- | --- | --- |
| [windows-app-msix.md](windows-app-msix.md) | Draft | MarkdStage Desktop v4 (MSIX / Microsoft Store) |
