# Cross-surface specification: MarkdStage on Windows as an MSIX package

- Status: Draft
- Target: MarkdStage Desktop v4 (MSIX / Microsoft Store)
- Decision record: [../adr/0001-windows-native-app-packaging-and-runtime-hosting.md](../adr/0001-windows-native-app-packaging-and-runtime-hosting.md)
- Lifetime: deleted once v4 ships. Anything still true at that point moves to
  docs/architecture.md.

## What this document is

ADR 0001 records *why* the Windows app is packaged and hosted the way it is. This
document records *what to build*. It spans three surfaces — the shared JavaScript
runtime, the CLI, and the desktop app — because the decision does: replacing the
runtime's Node I/O layer with a host-implemented port changes all three at once.

It exists so that the port boundary is designed once, in writing, rather than
incidentally by whoever implements first.

Nothing here may contradict ADR 0001. Where implementation work shows a decision
in ADR 0001 to be wrong, it is corrected by a new record that supersedes it, not
by editing ADR 0001 and not by this document.

Non-goals: user interface design, theme changes, store listing copy, release
scheduling. Desktop-only behaviour (windowing, presenter view, pen input) belongs
in the desktop behaviour spec under `apps/MarkdStage.Desktop/`.

### Vocabulary

| Term | Meaning |
| --- | --- |
| Host | The native Windows code: the desktop app process and the CLI process. |
| Port | The interface the host implements and the JavaScript runtime calls. |
| Adapter | The JavaScript-side implementation of the port for one environment. |
| Node adapter | The adapter that calls `node:fs` and friends. Used by the canvas extension only. |
| Host adapter | The adapter that calls the port. Used by the desktop app and the CLI. |
| Workspace root | The absolute, canonical directory that confines every read and write. |
| Transient root | The directory for output that is not part of the workspace and does not survive the operation. |

### Current state this replaces

Node usage in the shared runtime is already confined to an I/O layer, and the
modules below are the entire surface the port has to cover.

| Concern | Modules today |
| --- | --- |
| Filesystem | `runtime/deck-session.mjs`, `runtime/output-paths.mjs`, `runtime/output.mjs`, `runtime/custom-theme.mjs`, `runtime/slide-backgrounds.mjs`, `runtime/architecture-source.mjs`, `runtime/static-files.mjs`, `scripts/markdown-files.mjs`, `scripts/markdown-watcher.mjs`, `scripts/atomic-markdown-replace.mjs` |
| Local HTTP | `runtime/presentation-server.mjs`, `runtime/architecture-editor-server.mjs` |
| Process temporary storage | `runtime/output.mjs` (browser profile directories) |
| Hashing and randomness | `runtime/output.mjs`, `runtime/presentation-server.mjs`, `runtime/architecture-editor-server.mjs` |
| Byte buffers | `runtime/pptx-package.mjs` |
| Subprocess | `runtime/browser.mjs`, `scripts/workspace-root.mjs` |

`markdown-deck.mjs`, `deck-state.mjs`, `architecture-validation.mjs`, the schema,
and `renderer/` have no Node dependency and are not touched by this work beyond
the extractions named in section 10.

---

## 1. The I/O port boundary

### 1.1 Shape

The port is an explicitly enumerated set of workspace-scoped operations. It is
not a filesystem interface: there is no `open`, no handle, no seek, no path
argument that the host does not itself resolve.

Every path argument is a **workspace-relative path** expressed with `/`
separators. Absolute paths, drive-relative paths, UNC paths, device paths, and
any segment equal to `..` are rejected by the host before anything else happens.
The JavaScript side never sends an absolute path and never receives one, except
for the single opaque display string in §1.4.

Every operation is asynchronous and returns a discriminated result
(`{ ok: true, value }` or `{ ok: false, code, message }`). The host never throws
across the boundary.

**Workspace operations**

| Operation | Arguments | Returns |
| --- | --- | --- |
| `readText` | `path`, `maxBytes` | file contents as a string (UTF-8, BOM stripped) |
| `readBytes` | `path`, `maxBytes` | `Uint8Array` |
| `stat` | `path` | `{ kind: "file" \| "directory", size, modifiedAt }` |
| `list` | `path`, `{ extensions, maxEntries, recursive }` | array of `{ path, kind, size, modifiedAt }`, workspace-relative |
| `writeBytes` | `path`, `Uint8Array`, `{ overwrite }` | the written workspace-relative path |
| `replaceText` | `path`, `contents`, `{ expectedModifiedAt }` | the written path, or `conflict` |
| `makeDirectory` | `path` | the created workspace-relative path |
| `watch` | `path`, `{ extensions }` | subscription handle; emits `{ path, kind }` change events |
| `unwatch` | handle | — |

**Transient operations** (see §5; these are the only writes outside the workspace)

| Operation | Arguments | Returns |
| --- | --- | --- |
| `createTransientDirectory` | `purpose` (`"inspect" \| "capture" \| "pdf" \| "pptx" \| "present"`) | opaque handle |
| `removeTransientDirectory` | handle | — |

**Browser operations** (see §7; replaces `runtime/browser.mjs` process handling)

| Operation | Arguments | Returns |
| --- | --- | --- |
| `launchBrowser` | `{ url, profile: transient handle, mode: "app" \| "automation", windowSize }` | `{ handle, debuggerEndpoint? }` |
| `closeBrowser` | handle | — |

`writeBytes` and `replaceText` are atomic on the host side: write to a sibling
temporary name inside the same directory, flush, rename. The JavaScript side does
not stage temporary files in the workspace.

There is no `delete` operation. Nothing in the runtime removes workspace files
today, and adding the capability would widen the trust boundary for no caller.

### 1.2 Who resolves paths

The host, always and alone. It performs, in this order, for every call:

1. Reject non-relative or `..`-bearing input syntactically.
2. Join to the workspace root and canonicalize (`realpath`-equivalent), then
   verify the canonical result is inside the canonical workspace root.
3. Reject reparse points — symbolic links, junctions, and mount points — at
   every segment, not only the leaf.
4. Apply the size limit for the operation before reading a byte.
5. For writes, apply steps 2 and 3 to each parent directory it creates.

The JavaScript side cannot influence any of these decisions, because it has no
way to express a resolved path. `resolve`, `realpath`, and the confinement checks
in `runtime/deck-session.mjs` and `runtime/output-paths.mjs` move out of the
shared code and into the host; `isPathInside` survives only inside the Node
adapter.

Size limits stay exactly where they are today and are enforced on both sides of
the port by the same constants, passed as `maxBytes`:

| Content | Limit | Constant |
| --- | --- | --- |
| Markdown deck | 2 MiB | `MARKDOWN_MAX_BYTES` |
| Theme CSS | 64 KiB | `THEME_CSS_MAX_BYTES` |
| Theme metadata | 64 KiB | `THEME_METADATA_MAX_BYTES` |
| Theme and slide-background assets | 2 MiB | `THEME_ASSET_MAX_BYTES` |
| Architecture assets | 10 MiB | `ARCHITECTURE_ASSET_MAX_BYTES` |

The host treats `maxBytes` as a hint it is free to lower, never to raise: it
applies its own ceiling independently, so a compromised renderer cannot request
an unbounded read.

### 1.3 Error model

The host returns a code. The host adapter maps it to the `MarkdStageError` the
runtime already produces, so CLI exit codes, canvas errors, and desktop messages
do not change.

| Condition | Port code | `MarkdStageError` code |
| --- | --- | --- |
| Path escapes the workspace, or a reparse point was found | `denied` | `path_outside_workspace`; on a write target, `invalid_output_path` |
| Path is syntactically unacceptable | `denied` | `invalid_input` |
| Extension is not `.md` / `.markdown` where one is required | `unsupported` | `invalid_markdown_path` |
| File or directory does not exist, or is not a file | `missing` | `file_not_found`; for a named theme file, `theme_file_not_found` |
| File exceeds the limit for its kind | `too_large` | `file_too_large`; for a slide background, `slide_background_too_large` |
| Target exists and `overwrite` is false | `exists` | `invalid_output_path` |
| `replaceText` lost a race with an external edit | `conflict` | the existing `source_changed` save result |
| Anything else | `io_failed` | `io_failed` |

The right-hand column is the set of codes the CLI already classifies today. Only
`io_failed` is new, and it is added to the CLI's deck-error classification in the
same change, so no port failure can produce an unclassified exit code.

Two rules make this boundary safe to surface to users:

- The host message never contains an absolute path, an OS error number, or a
  distinguishing detail between "denied" and "missing" for a path outside the
  workspace. A path outside the workspace is always `denied`, whether or not it
  exists, so the port cannot be used to probe the filesystem.
- The JavaScript side never re-words a host message into a path. Messages that
  need to name a file name it with the workspace-relative path it asked for.

### 1.4 Read-only assets versus mutations

ADR 0001 splits these deliberately: read-only assets are exposed through a
virtual host mapping, mutation and enumeration go through the port.

| Category | Mechanism |
| --- | --- |
| Packaged renderer, styles, scripts, vendor bundles, editor assets | Virtual host mapping over the package's `Web/` folder, read-only. |
| Workspace media the *browser* fetches for itself: images, video, fonts, custom theme CSS and its assets, slide background images | Virtual host mapping over the workspace root, read-only. |
| Deck Markdown, theme metadata JSON, architecture sources — anything the *JavaScript* reads as data | Port `readText` / `readBytes`. |
| Directory listing, Markdown file discovery, watching | Port `list` / `watch`. |
| Every write: exports, captures, Markdown saves, asset uploads | Port `writeBytes` / `replaceText` / `makeDirectory`. |

The rule behind the split: if bytes are consumed by the engine without the
runtime inspecting them, they go through the mapping; if the runtime looks at
them, or changes anything, they go through the port.

The workspace mapping is rooted at the canonical workspace root and rebound
whenever the workspace changes. It is read-only and it does not follow reparse
points out of the root. Media URLs handed to the renderer are mapping URLs, which
is why the runtime still needs the existing `assetUrlPrefix` seam. The one
absolute path the JavaScript side may receive is the workspace root as a display
string for the title bar and the CLI's messages; it is never an input to any port
call.

---

## 2. Adapter split

### 2.1 Selection

By explicit injection at the process entry point. Never by sniffing
(`typeof process`, `globalThis.chrome`, user agent, or similar).

- `runtime/io.mjs` declares the port interface and holds the installed adapter.
  Calling it before an adapter is installed is a programming error and throws.
- The canvas extension's entry point installs `runtime/io-node.mjs`.
- The desktop app's renderer bootstrap and the CLI's script bootstrap install
  `runtime/io-host.mjs`, bound to the host bridge object the host injected.
- Tests install an in-memory adapter, which is the reason the seam is injected
  rather than imported.

A CI guard fails the build if any file under `.github/extensions/markdstage/`
other than `runtime/io-node.mjs` imports a `node:` module. That guard is the
mechanical form of this section, and it is added in the same change as the port.

### 2.2 What may differ, what must never fork

May differ per adapter: transport and marshalling, concurrency limits, the watch
implementation, where transient directories live, how a browser process is
launched and terminated.

Must never fork — one implementation, shared by every surface:

- Deck parsing (`markdown-deck.mjs`) and deck state (`deck-state.mjs`).
- Speaker-note extraction and slide-title derivation (see §10).
- Theme resolution, custom theme validation, architecture validation and schema.
- Rendering (`renderer/`) and layout reporting.
- PowerPoint and PDF construction.
- Error codes and the messages attached to them.

A behaviour difference between the canvas extension and the desktop app that is
not in the "may differ" list is a defect in the port, not a platform difference
to be worked around above it.

---

## 3. Byte buffer dependency

`runtime/pptx-package.mjs` is the only module that depends on Node's `Buffer`.
The dependency is shallow, and the measured facts are favourable:

- The container is written with the ZIP *store* method. No compression library
  is involved on any platform.
- CRC-32 is computed by the module's own table-driven implementation, not by a
  platform primitive.
- Everything `Buffer` is used for here — `alloc`, `from`, `concat`,
  `writeUInt32LE`, `readUInt32LE`, `subarray`, `isBuffer` — is expressible with
  `Uint8Array` and `DataView`.

The change is therefore a mechanical substitution: `Uint8Array` for storage,
`DataView` for little-endian fields, `TextEncoder` for UTF-8 entry names, a small
`concat` helper, and a byte-signature check that no longer depends on `Buffer`
comparison. The public shape of the module changes from `Buffer` to `Uint8Array`;
callers that hand the result to the port already pass bytes.

**Order of work, which is not negotiable:** the existing PowerPoint output tests
are fixed as golden output *before* the change, not after. Concretely, the commit
that records the golden bytes must pass against the unmodified module, so that
the substitution is verified against output produced by code that predates it. A
golden file written after the rewrite proves only that the rewrite agrees with
itself.

---

## 4. Local HTTP surface

**The JavaScript side keeps no HTTP abstraction.** The host owns routing
entirely.

`runtime/presentation-server.mjs` and `runtime/architecture-editor-server.mjs`
stop being servers. Each is split in two:

- The *routing and transport* half — `createServer`, loopback binding, the
  unguessable URL token, `Host` and `Origin` validation, CSP headers, static file
  serving, server-sent events — is deleted from the runtime and implemented by
  the host. The desktop app already has this: its native server serves the shared
  renderer over loopback with a per-process token, and the CLI uses the same
  native server.
- The *behaviour* half — build state, navigate, import a deck, start and poll an
  export, toggle source mode, save edited architecture DSL — becomes a set of
  plain asynchronous functions that take and return plain objects. The host calls
  them; they never see a request or a response.

`runtime/static-files.mjs` is retired: MIME mapping and static serving become
host responsibilities, and `safeJoin` is superseded by §1.2.

This keeps one renderer and one set of behaviours while removing the second
security surface. It also means the token, the loopback check, and the origin
check have exactly one implementation per surface rather than one per runtime
module.

---

## 5. Transient storage

The runtime must stop using the process temporary directory. Under MSIX, writes
are redirected for some locations and not others, and the behaviour is
path-dependent rather than uniform, so a default temporary directory is not a
location the implementation can reason about.

**The transient root is named by the host, not discovered by the runtime.**

| Host | Transient root |
| --- | --- |
| Packaged desktop app and packaged CLI | The package's own temporary storage folder, obtained from the platform's application-data API. |
| Unpackaged development builds and the canvas extension | The process temporary directory, as today. |

Why the package's own temporary folder is the safe choice:

- It is the package's private store, so nothing written there is subject to the
  redirection that makes newly created files under the application-data roots
  invisible to other tools.
- It is a real path under the user's profile, so an *external* process — the
  installed browser the CLI drives — can use it as a profile directory.
- The system reclaims it, so an interrupted run leaks nothing permanent.

Rules:

- Every transient directory is created through `createTransientDirectory` with a
  purpose, and is named `markdstage-<purpose>-<random>`.
- The owner removes it on completion and on failure. The host additionally sweeps
  directories older than 24 hours at startup, because a killed browser leaves
  its profile behind.
- Shared configuration is never newly created directly under the roaming or local
  application-data roots, per ADR 0001.

Open item, deferred: whether an external browser run under a different integrity
or package context can always write the package temporary folder is one of the
three points ADR 0001 keeps under review, because it was measured on a locally
registered package. Owner: @runceel, before the first Store submission. If it
fails, the fallback is a per-user directory under `%LOCALAPPDATA%\MarkdStage\`
created by the installer's first run, which is a pre-existing subdirectory and
therefore not redirected.

---

## 6. Hashing

Node's hashing and randomness primitives move to the platform's **web crypto
interface**, not through the port. They are computation, not I/O; routing them
through the port would put a native round trip in a hot path for no security
benefit.

| Use today | Replacement |
| --- | --- |
| `createHash("sha256")` for the image cache key in `runtime/output.mjs` | `crypto.subtle.digest("SHA-256")`. The call sites are already asynchronous. |
| `randomUUID()` for per-run tokens in `runtime/output.mjs` | `crypto.randomUUID()` |
| `randomBytes(24)` for URL tokens in the two servers | Removed from the runtime: the token becomes a host responsibility under §4. |

Web crypto is available in Node 19+, in the embedded browser, and in the CLI's
JavaScript engine, so this is one implementation on every surface. Note that
`crypto.subtle` requires a secure context; loopback origins qualify, which the
host must preserve when it chooses the renderer's origin.

---

## 7. CLI execution model

Commands do not all need the same machinery. This split is fixed:

| Command group | Commands today | Needs |
| --- | --- | --- |
| Skill install, guide | `skill`, `guide`, `help` | Host code only. No JavaScript engine, no browser. |
| Validate | `validate` | A JavaScript engine. Deck parsing, deck state, and architecture validation have no Node and no DOM dependency, so no browser is required. |
| Present, preview | `present`, `preview` | The native server that already exists, plus the user's browser opened as a window. No automation protocol. |
| Inspect, capture, export | `inspect`, `capture`, `export` | A full browser engine, driven over the automation protocol. Per ADR 0001 this is the installed Chromium-based browser. |

Consequences the implementation must honour:

- `skill` and `guide` must work with no browser installed and must not pay
  engine startup cost. Their content ships as data in the package; the host reads
  and prints it.
- `validate` must work with no browser installed. It executes the pure modules
  in an engine without layout or DOM, and produces the same diagnostics and exit
  codes as today.
- `inspect`, `capture`, and `export` fail with a clear, documented message when
  no Chromium-based browser is installed, or when policy has disabled remote
  debugging. ADR 0001 calls the latter a known limitation, not a bug; the message
  must say so rather than implying a defect.

Open item, deferred: which engine hosts `validate`. The candidate is the embedded
browser with no visible window, used for script execution only — which does not
reopen ADR 0001's rejected offscreen-*rendering* alternative, because no layout
or capture is involved. The fallback, if that proves unsupportable, is to run
`validate` through the same installed browser the automation commands use, at the
cost of the "no browser required" property above. Owner: @runceel, decided in the
stage that builds the CLI host.

---

## 8. Packaging layout

One package, one application entry, per ADR 0001.

```
MarkdStage/
  MarkdStageApp.exe       Windows-subsystem app. The single <Application> entry.
  MarkdStageCli.exe       Console-subsystem launcher. The alias target.
  Web/                    Renderer, styles, vendor bundles. Virtual host mapping root.
  Shared/                 The shared JavaScript runtime.
  Assets/                 Package logos and tiles.
```

The console entry point is published through the app execution alias extension on
the single application entry, naming its own executable and declaring the console
subsystem. The alias the user types is `markdstage`, matching the npm package's
command so documentation and muscle memory carry over. A second `<Application>`
entry must not be added: the manifest schema warns that packages with multiple
application entries may not pass Store certification, and the alias extension
makes one unnecessary.

Two naming rules that are easy to get wrong:

- **The alias name and the file name are independent.** The alias extension's
  `Name` is what appears on `PATH` (`markdstage.exe`); its `Executable` is the
  file inside the package (`MarkdStageCli.exe`). They do not have to match, and
  here they deliberately do not.
- **No two file names in the package may differ only by case.** The Windows
  filesystem is case-insensitive, so `MarkdStage.exe` and `markdstage.exe` cannot
  coexist in one folder. The GUI keeps the assembly name it already has,
  `MarkdStageApp.exe`, and the launcher is `MarkdStageCli.exe`.

**The launcher is not thin.** It owns, and is tested for:

- **Standard stream inheritance.** It inherits the caller's standard input,
  output, and error handles rather than creating pipes, so redirection and
  piping behave as they do for any console tool.
- **Deadlock avoidance on large output.** If it must interpose on a stream — for
  example to talk to a child engine — it pumps every stream concurrently. A
  single-threaded read of one stream while another fills its buffer deadlocks on
  exactly the outputs we produce, such as a full `--json` layout report.
- **Interrupt handling.** A console control handler catches Ctrl+C and
  Ctrl+Break, cancels the operation, and returns the conventional exit code.
- **Console encoding.** UTF-8 for console output, no BOM when output is
  redirected, and no mangling of deck titles in non-Latin scripts.
- **Exit codes.** The runtime's existing exit codes propagate unchanged.
- **Process-tree termination.** Every browser it launches is created in a job
  object that terminates on close, so an interrupt or a crash cannot leave an
  orphaned browser holding a transient profile directory.
- **No working-directory assumptions.** See §9.

---

## 9. Workspace resolution

One rule, shared by the GUI and the CLI's `--workspace` option. It has to be one
rule because asset resolution and path confinement are derived from it on both
surfaces, and a difference between them is a security difference.

The rule cannot be derived from the working directory: a process started through
an alias inherits the caller's working directory, while one started from the
Start menu gets the system directory, which the app cannot write.

Given an optional workspace path `W` and an optional file path `F`:

1. **`W` is given.** The root is `W` made absolute and canonical. It must exist
   and be a directory. If `F` is given and is not inside the root, the operation
   fails with `path_outside_workspace`. This is the CLI's `--workspace` and the
   GUI's "open folder".
2. **`W` is absent and `F` is given.** The root is the nearest ancestor directory
   of `F` that contains a `.git` entry (file or directory); if there is none, it
   is the directory containing `F`. The result is canonicalized. This covers the
   CLI's file argument and GUI activation by file association or drag and drop.
3. **Neither is given.** There is no derived root. The GUI reopens the last
   workspace, which is persisted as an absolute path, and asks the user to choose
   a folder if there is none or it no longer exists. The packaged CLI fails with
   `invalid_input` and a message naming `--workspace`; it does not fall back to
   the working directory.

Notes that keep this consistent with ADR 0001 and with today's behaviour:

- A relative path on the command line is made absolute against the caller's
  working directory *before* resolution begins. That is argument resolution.
  Workspace resolution itself receives an absolute path and never consults the
  working directory, and case 3 proves it: no argument means no root, not the
  working directory.
- Rule 2 matches what both surfaces already do — `scripts/workspace-root.mjs`
  and the desktop app's loader both walk up to a `.git` marker — with one
  deliberate change: the `git rev-parse` subprocess is dropped in favour of the
  marker walk alone. The packaged app cannot rely on Git being installed, and the
  two paths must not disagree when it is not.
- The root is persisted and passed as an absolute canonical path. It is resolved
  once per session, not per operation.

---

## 10. Retiring the duplicate parser

ADR 0001 retires the desktop app's separate deck parser. This is a conversion of
the existing app, not a rewrite: its host process, workspace confinement, and
Windows-specific presentation behaviour are carried forward.

| Retired | Replaced by |
| --- | --- |
| `MarkdownDeckParser.cs` — deck parsing, front-matter inheritance, back cover | `markdown-deck.mjs` (`buildDeckSlides`) and `deck-state.mjs` (`ensureBackCover`). |
| `SpeakerNotesExtractor.cs` | `renderer/speaker-notes.mjs`, which already extracts notes for the presenter view and for PowerPoint export. |
| `SlideTitleDeriver.cs` | The title derivation in `renderer/renderer.js`, extracted into a shared module so the host's slide list and the renderer's own list cannot disagree. Extracting it is part of this work, not a prerequisite. |
| `DeckDocument.cs` — parsed representation | A data-transfer type deserialized from the deck snapshot the runtime produces. It carries no parsing logic and no defaults; a field the runtime does not send does not exist. |
| `PresentationSession.cs` — slides, current index, version counters | `deck-state.mjs` owns the deck and the index. The host keeps only what is genuinely native: window state, the presenter window, and the thread-safe mirror of the last snapshot it received for rendering and for restoring after a reload. |

**How the host obtains a parsed deck.** It does not parse and it does not read
the Markdown. It calls the runtime — the inbound half of the port — with the
workspace-relative path of the deck. The runtime reads the file through
`readText`, parses it, resolves the theme, and returns a snapshot containing the
slides, their titles, their speaker notes, the theme state, the source path, and
a version counter. The host stores that snapshot and navigates by asking the
runtime for the next state. Every read it would previously have done itself now
happens on the other side of the port, under §1.2.

The C# parser's existing tests are not deleted with it. They become the
conformance corpus: the same inputs are run against the shared runtime and must
produce the same slides, titles, and notes. A disagreement is a defect in one of
them and has to be resolved before the C# implementation is removed. Until it is
removed, ADR 0001's single-source-of-truth invariant is a target, not a fact.

---

## Stages

Each stage is independently shippable and leaves the product working.

| Stage | Contents | Done when |
| --- | --- | --- |
| 1. Port seam | `runtime/io.mjs`, the Node adapter, the CI guard, §3's byte-buffer change with its golden output. | Every surface runs through the adapter with no behaviour change and no `node:` import outside the adapter. |
| 2. Host adapter and server inversion | §4's split, §5's transient root, §6's crypto move, the desktop app hosting the shared runtime. | The desktop app renders through the shared runtime with its own parser still present. |
| 3. Parser retirement | §10, including the conformance corpus. | The C# parser and its four companions are deleted. |
| 4. Packaging | §8's layout and launcher, §9's resolution rule on both surfaces, the browser prerequisite in the guides and the listing. | A locally registered package passes the CLI and GUI acceptance runs; the archive gets its end-of-life announcement. |

## Open items

Every question this document was written to answer is answered above, except the
two deferred explicitly:

| Item | Section | Owner | Due |
| --- | --- | --- | --- |
| Whether the package temporary folder is writable by the external browser end to end, on a Store-distributed package | §5 | @runceel | Before first Store submission |
| Which engine hosts `validate` | §7 | @runceel | Stage 4 |

ADR 0001 keeps a third point under review — behaviour when remote debugging is
disabled by policy. It is not an open item for this document, because §7 already
specifies the behaviour in that case. If it proves common enough to make the CLI
unusable in managed environments, ADR 0001 says what happens: a new record
supersedes it. This specification would then be revised, not the record.
