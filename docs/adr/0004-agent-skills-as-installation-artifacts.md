# 0004: Agent Skills are installation artifacts

- Status: Accepted
- Date: 2026-09-16
- Supersedes: none
- Superseded by: none

## Context

MarkdStage provides Agent Skills for Codex, Claude Code, and GitHub Copilot. The
Skills teach users' agents how to author, validate, inspect, present, and export
MarkdStage decks. They are derived from the same guide topics shipped by the
Canvas Extension, npm CLI, and Windows package.

Checking generated Skills into `.agents/skills/`, `.claude/skills/`, or
`.github/skills/` also makes them discoverable while contributors are developing
MarkdStage itself. That loads user-facing presentation instructions into a
software-engineering workspace, where they are unrelated to most repository work
and can conflict with repository development instructions.

The product still needs deterministic Skills in npm and Windows distributions,
and installation must continue to protect files that users have modified locally.

## Decision

Agent Skills are generated installation artifacts. Their content is produced
from the canonical MarkdStage guide topics by the shared Skill generator.

The MarkdStage development repository does not check generated MarkdStage Skills
into agent discovery directories. The npm CLI, packaged CLI, and Desktop install
the generated files into the selected user's workspace only when requested.

CI verifies the generator and each distribution path directly. It checks
deterministic content, target-specific adaptations, packaged inclusion,
installation and check modes, and preservation of locally modified files. CI does
not compare against repository-local generated copies.

## Alternatives considered

- Keep generated Skills in all three repository discovery directories. This
  makes the final files easy to inspect but automatically loads product-usage
  instructions during product development.
- Keep a hand-written Skill source in a non-discovery directory. This duplicates
  the canonical guide and creates another source that can drift from the product.
- Maintain Skills in a separate repository. This avoids local discovery but
  introduces cross-repository versioning and release coordination for artifacts
  that are already generated with the product.

## Consequences

### Positive

- MarkdStage development sessions receive development instructions without
  automatically loading the user-facing presentation Skill.
- The canonical guide remains the single content source for every Skill target.
- npm and Windows packages exercise the same generation path used for user
  installation.

### Negative

- The completed generated Skill tree is not browsable directly in the source
  repository.
- Distribution tests must continue to cover generation and packaging because a
  checked-in copy no longer exposes drift in a normal source diff.

### Follow-up

- Keep the current architecture document and release checks aligned when a new
  Agent Skill target or distribution surface is introduced.
