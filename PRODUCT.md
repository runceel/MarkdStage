# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

Developers, technical speakers, and documentation authors preparing technical presentations with AI or by editing Markdown directly. They need to turn source material into a draft, refine wording and diagram positions themselves, check fit, and present. Recipients may review or redistribute the result in PDF viewers or PowerPoint without adopting MarkdStage.

## Product Purpose

MarkdStage connects AI-assisted drafting, direct refinement, layout review, presentation, and sharing. Content is managed in Markdown and appearance through themes, so authors can focus a revision on the text or diagram rather than reauthoring the whole design. Success means an author can move from source material to a reviewed presentation and a file recipients can use in their usual tools. AI assistance is optional; Markdown remains the authoring source.

## Positioning

MarkdStage lets authors ask AI for a draft without sending every small revision back through AI. Wording can be edited as text, and Architecture diagram composition can be adjusted visually and saved to the same Markdown. The GitHub Copilot canvas is one integration; the host-independent CLI and portable Agent Skills support Claude Code and Codex, and the standalone Windows presenter supports delivery without an AI host.

A shared renderer connects themed preview, presentation, clipping inspection, and export.
Mermaid provides automatic relationship-driven layout and theme-aware colors. Architecture DSL
provides explicit position, size, and group composition with visual editing. These are complementary
choices, not a hierarchy of diagram formats. Hybrid PowerPoint export keeps supported elements
editable and uses reported image fallbacks where needed; recipients do not need MarkdStage.

## Operating Context

- A GitHub Copilot canvas Extension renders decks inside a repository workspace.
- An optional Skill converts or summarizes Markdown into slide-sized fragments and opens the canvas.
- A WinUI 3 desktop app hosts the same renderer in a WebView2 shell, opens Markdown independently of GitHub Copilot, and provides current-slide, next-slide, and speaker-note views.
- A Node.js command-line interface presents, validates, inspects, captures, and exports the same decks without any canvas host, so it also runs in Codex, Claude Code, CI jobs, and remote shells, and it installs portable Agent Skills.
- Presentations are controlled through canvas controls, keyboard navigation, and supported Surface Pen actions.
- Decks may be exported as 16:9 PDF files or as hybrid editable PowerPoint presentations.
- The canvas can preview the PDF-equivalent fixed 16:9 surface and warn when
  content will be clipped, and the CLI reports the same diagnostics as machine-readable output.
- A third-party community project provides a native macOS presenter. It is not built, released, or supported from this repository.

## Capabilities and Constraints

- Markdown remains the source format and uses `---` slide separators plus optional front matter.
- The renderer supports GFM content, syntax-highlighted code, Mermaid, Architecture DSL, local images, speaker notes, and custom themes.
- Mermaid and Architecture DSL intentionally have different roles: automatic relationship-driven layout versus stable, theme-aware slide composition with visual editing.
- Canvas, desktop, CLI, PDF, and PowerPoint output must preserve equivalent slide rendering.
- PowerPoint export must emit supported content as native PowerPoint objects, keep fenced code editable with its syntax highlighting, place speaker notes in the notes pane, and report every element degraded to a fallback picture instead of omitting it silently.
- AI-facing layout inspection should return compact geometry first and generate
  1280×720 PNGs only for pages that require visual analysis.
- `inspect` (CLI) and `inspect_layout` (Canvas) are primarily agent-facing diagnostics.
  User-facing onboarding should lead with asking AI to check fit, then explain how the agent
  uses structured results and selected images. Manual and CI use remain available.
- Structural validation and rendered clipping diagnostics are distinct. Selected image review
  supplements diagnostics, and every page of final output should be reviewed before distribution.
- Separating content and theme supports focused edits, not a guarantee of unchanged layout after
  text revisions. No exact token savings or automatic design-quality guarantees are claimed.
- PowerPoint is a delivery and editing format, not a round-trip source: edits there are not
  synchronized back to Markdown, and not every representation is a native editable object.
- Local Extension distribution must remain self-contained with no runtime npm dependency.
- The CLI is published to npm and must stay usable without the Copilot canvas, with machine-readable output and stable exit codes for agents and CI.
- Workspace path and asset access stay constrained by the existing security model.
- The primary canvas ID is `MarkdStage`; the former `presentation` ID will not remain as an alias.
- Existing action concepts such as loading a deck, navigating, opening a presenter, and exporting PDF or PowerPoint remain stable.

## Brand Commitments

- Product name: **MarkdStage**
- Pronunciation: **marked stage**
- Primary tagline: **Markdown, ready for the stage.**
- Alternate tagline: **Markdown, take the stage.**
- The brand is independent of the GitHub and Copilot names while accurately describing integrations.
- The visual identity combines a Markdown `#` mark with a stage spotlight.
- The confirmed color direction is Midnight Ink with Spotlight Amber.
- The brand voice is creator-first, focused, confident, technical, and approachable.

## Evidence on Hand

- `README.md` documents the current feature set and distribution model.
- `slides.md` is a working demonstration deck.
- `.github/extensions/markdstage/` contains the production canvas Extension and renderer, and is the single source of truth mirrored to the other surfaces.
- `apps/MarkdStage.Desktop/` contains the production Windows desktop application.
- `packages/markdstage-cli/` contains the published `@markdstage/markdstage` command-line interface and the portable Agent Skills it installs.
- Automated unit, schema, editing, visual, accessibility, performance, PDF, PowerPoint, cross-language parser conformance, and .NET tests exist.
- No customer testimonials, usage metrics, or commercial claims are available and none should be invented.

## Product Principles

1. Keep Markdown as the authoring source and themes separate from content.
2. Connect AI drafting with direct refinement; keep non-AI authoring and presentation available.
3. Let AI use layout diagnostics to guide revision without replacing human judgment or final-output review.
4. Keep authoring, live presentation, and exported output visually consistent across surfaces.
5. Share supported editable content in the recipient's tools without requiring MarkdStage.
6. Support technical content with complementary diagram formats and explicit fallback limits.
7. Add product branding to the application experience, never as an unsolicited watermark on user decks.

## Accessibility & Inclusion

Keyboard navigation, visible focus, semantic slide output, readable contrast, reduced interface ambiguity, and automated accessibility checks are release requirements. Brand changes must preserve existing canvas and desktop accessibility behavior.
