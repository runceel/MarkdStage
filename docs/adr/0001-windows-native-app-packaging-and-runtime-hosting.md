# 0001: Windows native app packaging and runtime hosting

- Status: Accepted
- Date: 2026-09-12
- Supersedes: none
- Superseded by: none

## Context

MarkdStage exposes the same deck through three surfaces: a Copilot canvas
extension hosted by Node, a command-line tool, and a Windows desktop app. The
shared JavaScript runtime is the single source of truth for parsing, validation,
and slide rendering, and the product requires every surface to produce equivalent
output.

We want to distribute the desktop surface through the Microsoft Store as an MSIX
package, with four requirements: Store distribution, operation on machines that
have no Node installed, an AI-facing CLI, and a workspace model where the folder
the user opens is the app's home.

The following constraints were established by measurement on Windows 11, against a
locally registered package rather than one signed and distributed through the
store, and by reading the packaging schema and store policy. They are the reason
the decision looks the way it does.

**Working directory is not a reliable input.** A process started through an app
execution alias inherits the caller's working directory, and arguments, standard
output, and exit codes propagate normally. A process started from the Start menu
gets the system directory instead, which is not writable by the app. The two
entry points therefore cannot share a working-directory-derived workspace model.

**Packaged writes are redirected for some paths and not others.** Files newly
created directly under the roaming or local application-data roots are redirected
into per-package storage and are invisible to other tools, while writes into
pre-existing subdirectories and into other locations pass through. The behaviour
is path-dependent and does not match the documentation closely enough to rely on.
Disabling virtualization requires a restricted capability that is not available to
us.

**A single application entry can still expose console commands.** The alias
extension can name its own executable and subsystem, so one packaged application
can publish a console entry point. The manifest schema warns that packages with
multiple application entries may not pass Store certification, so this matters.

**The shared runtime's Node dependency is confined to an I/O layer.** Deck
parsing, deck state, and architecture validation have no Node and no DOM
dependency at all; rendering has no Node dependency. Node is used only for
filesystem access, path handling, process temporary storage, hashing, byte
buffers, and a local HTTP server. The PowerPoint container is built without
compression, so it needs no platform compression library.

**Store policy forbids acquiring a third-party runtime at run time.** Bundling a
runtime inside the signed package is permitted; downloading and installing one is
not.

## Decision

**One package, one application entry.** The desktop app ships as a single MSIX
with a single application entry. The CLI is published through an app execution
alias that names a console executable inside the same package.

**The workspace root is explicit and absolute.** It is chosen by the user, or
derived from an activation argument using the same resolution rule the CLI uses
for its workspace option, and it is persisted as an absolute path. The process
working directory is never an input to workspace resolution on any surface.

**No language runtime is bundled or acquired.** The shared JavaScript runtime runs
inside the app's embedded browser. Its Node I/O layer is replaced by a port that
the native host implements.

**The port layer has swappable adapters and one implementation of the logic
above it.** The canvas extension keeps a Node adapter; the desktop app and CLI use
the host adapter. Parsing, validation, and rendering are never forked per host.
The desktop app's separate parser implementation is retired.

**The native host owns the trust boundary.** Content in a workspace is untrusted
input, so the JavaScript side receives only an explicitly enumerated set of
workspace-scoped operations. Path confinement, link-traversal rejection, and size
limits live in the host at the port boundary, not in the JavaScript runtime.
Read-only assets are exposed through a virtual host mapping; mutation and
enumeration go through the port.

**An installed Chromium-based browser is a documented prerequisite for the CLI.**
Commands that need full browser layout — layout inspection, image capture, and
export — drive the installed browser. The GUI uses its own visible embedded
browser for the same work and does not depend on an external browser.

**The embedded browser runtime is detected at run time.** Its packaging-level
dependency declaration is silently ignored outside App Installer distribution, so
availability is checked in code and surfaced to the user.

## Alternatives considered

- **Bundle a Node runtime.** Policy-compliant and would require no JavaScript
  change, but costs roughly 77 MB per architecture and permanently keeps two I/O
  stories alive. Once the port layer exists it buys nothing, because the port is
  needed for the GUI regardless.
- **Install a Node runtime on first run.** Rejected: Store policy prohibits
  acquiring and installing third-party software at run time.
- **Render from the CLI using an offscreen embedded browser.** This would remove
  the external browser prerequisite and give both surfaces one engine version. The
  embedded browser has no supported invisible rendering mode, so it would require
  an unsupported offscreen window arrangement. Rejected because an installed
  Chromium-based browser is an acceptable prerequisite. See Negative consequences
  for what this costs.
- **Reimplement the runtime natively.** Rejected: it would duplicate the single
  source of truth and guarantee rendering divergence between surfaces.
- **Multiple application entries, one per executable.** Rejected on Store
  certification risk, since the alias extension makes it unnecessary.

## Consequences

### Positive

- The package carries no third-party language runtime, which keeps the download
  small and removes a class of licensing and certification questions.
- Parsing, validation, and rendering have exactly one implementation, so surface
  equivalence is structural rather than maintained by hand.
- Security-relevant path handling is concentrated in one native boundary that can
  be tested independently of the runtime.
- The workspace model behaves identically whether the app is launched from the
  Start menu, from a file association, or from a shell.

### Negative

- The GUI and the CLI use two different browser engine instances, so their output
  can diverge across engine versions. Output equivalence must be tested on both
  paths rather than assumed.
- Enterprise policy can disable remote debugging on the installed browser, which
  disables the CLI commands that require full browser layout. This is a supported
  configuration in hardened fleets and it is a known limitation, not a bug.
- The port boundary is a new security surface. A defect there exposes the user's
  filesystem to untrusted workspace content.
- Shared configuration must never be newly created directly under the
  application-data roots, or it becomes invisible to the other surfaces.

### Follow-up

- The desktop surface keeps a second deck parser until it is retired. Until then
  the single-source-of-truth invariant above is a target, not a fact. Retiring it
  is a conversion of the existing app, not a rewrite: the host process, its
  workspace confinement, and its Windows-specific presentation behaviour already
  match this record and are carried forward.
- No current-state architecture document exists. One is needed once the port
  boundary is implemented, describing the surfaces and the port as they then are;
  this record explains only why they are that way.
- The desktop surface ships today as a standalone archive. Moving to store
  distribution needs an overlap period and an end-of-life announcement for the
  archive, because the two are installed and updated by different mechanisms.
- The browser prerequisite has to reach users: the installation and CLI guides and
  the store listing must state it, because store policy requires a dependency to
  be declared up front rather than discovered at run time.
- Status stays under review on three points that were measured on a locally
  registered package rather than a signed one distributed through the store:
  alias behaviour end to end, the temporary-profile path the CLI hands to the
  external browser under package virtualization, and behaviour when remote
  debugging is disabled by policy. The first two would change how the package is
  assembled but not this decision. If the third proves common enough to make the
  CLI unusable in managed environments, the rejected offscreen-rendering
  alternative has to be reopened in a new record that supersedes this one.
