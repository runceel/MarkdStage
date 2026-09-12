# MarkdStage Desktop behaviour specification (MSIX)

- Status: Draft
- Target: MarkdStage Desktop v4 (MSIX / Microsoft Store)
- Decision record: ../../../docs/adr/0001-windows-native-app-packaging-and-runtime-hosting.md
- Related spec: ../../../docs/specs/windows-app-msix.md
- Lifetime: deleted once v4 ships. Behaviour that is still current at that point
  moves into this component's README.

## Scope

This document describes what the user of the desktop app sees and does in v4. It
covers the launch and workspace flow, the behaviour that is carried forward from
the shipped app unchanged, the behaviour that changes, the migration away from
the archive build, and where the user meets the prerequisites.

It is not an architecture document. The port boundary, the adapter split, the
packaging layout, the CLI, and the workspace resolution rule itself belong to the
[cross-surface spec](../../../docs/specs/windows-app-msix.md) and are referenced
from here rather than restated. Where this document and that one appear to
disagree, that one wins on mechanism and this one wins on what the user sees.

v4 is a conversion of the shipped app, not a rewrite. The host process, its
windows, its workspace confinement, its asset resolution, and its Windows
specific presentation behaviour are carried forward. The only component the
conversion removes is the app's separate deck parser and its supporting types;
everything else in the host is either unchanged or changed only where a section
below says so.

## 1. Launch and workspace flow

The folder the user opens is the app's home. A window holds exactly one workspace
root for as long as it is open, and that root is an absolute path that came from
the user or from an activation argument. The process working directory is never
consulted, because a launch from the Start menu supplies the system directory,
which the app cannot write to.

### 1.1 Launch with no arguments

The main window opens on a **start screen** rather than a modal picker. A modal
folder picker at startup would put a dialog in front of an app the user has not
seen yet and would leave nothing behind when dismissed.

The start screen shows:

- The recent workspaces, most recently opened first, at most ten. Each entry
  shows the folder name and its full path.
- **Open folder…**, which opens the folder picker and makes the chosen folder the
  workspace root.
- **Open Markdown file…**, which opens the file picker; the workspace root is then
  derived from the chosen file by the shared resolution rule.

Choosing a recent workspace or a folder loads the workspace and leaves the window
in its deck-less state: no deck is opened automatically, even when the folder
contains exactly one Markdown file. The user picks the deck from the workspace,
which is the same behaviour the CLI has when it is started without a file.

### 1.2 Activation with a file

File association activation, drag and drop onto the window or the app icon, *Open
with*, and a path passed on the command line through the app execution alias are
one flow. In each case the app receives a file path, and the workspace root comes
from applying the shared resolution rule to that path — the same rule the CLI
applies to a file argument. That rule is defined once, in the cross-surface spec,
and is not restated or re-derived here.

The deck opens directly and the start screen is not shown. If a drag and drop
carries more than one file, the first Markdown file is opened and the rest are
ignored.

### 1.3 A file outside the current workspace

Opening a Markdown file that lies outside the current window's workspace root
never re-roots that window. Re-rooting would invalidate the asset resolution and
the confinement boundary of a deck that may be on screen in front of an audience.

Instead:

- If the window has a deck loaded, the file opens in a **new window** with its own
  workspace root, resolved as in 1.2. The existing window is untouched.
- If the window is still on the start screen, that window is reused.

The file is never refused. Refusal would make *Open with* fail for exactly the
files users reach for most.

### 1.4 A remembered workspace that is gone

A recent entry whose folder cannot be resolved — moved, renamed, deleted, or on a
disconnected drive — is not removed silently and the app does not search for it.
It is shown dimmed and marked **Unavailable**, keeping its recorded path visible
so the user can recognise which folder it was.

Selecting it opens a message with the recorded path and two actions:

> **This folder isn't available**
> `D:\decks\quarterly-review`
> It may have been moved, renamed, or deleted, or it may be on a drive that isn't
> connected.
>
> **Locate folder…**  **Remove from list**

**Locate folder…** opens the folder picker and repoints the entry, preserving its
position in the list. **Remove from list** deletes the entry. Neither action
touches anything on disk inside the workspace.

The same message appears when a workspace disappears while a window holds it. The
window keeps the last valid deck on screen, as it already does for a failed
reload, and file watching for that root stops until the folder is located again.

### 1.5 Multiple windows

Multiple windows may be open with different workspace roots at the same time, and
each keeps its own deck, presenter window, watcher, and navigation state. A given
workspace root is held by at most one window: opening a workspace that is already
open activates the existing window instead of creating a second one, so that two
watchers never drive two copies of the same deck.

Closing the last window exits the app.

### 1.6 Persisted state

The app persists only the recent workspace list, the last window size and
position, and the last chosen theme. Deck content, navigation position, and
presenter state are not persisted.

This state is desktop-only and is not shared with the CLI. It is written to the
packaged app's own local storage, which is the location MSIX removes on uninstall
and which the app can write to from every activation path. Because files newly
created directly under the roaming or local application-data roots are redirected
into per-package storage and become invisible to other tools, no state that any
other surface has to read may be placed there. This spec introduces no such
shared state; if v4 later needs some, its location is decided in the
cross-surface spec, not here.

On uninstall, Windows removes the persisted state with the package. Nothing
inside any workspace folder is touched: decks, assets, and theme files are the
user's files and the app never deletes them. The installation guide states this,
so that uninstalling is not something a user has to be brave about.

## 2. Behaviour carried forward unchanged

The following is settled behaviour of the shipped app. It is carried forward as
it is and is not open for redesign as part of the packaging work. An implementer
who finds themselves designing any of it should stop.

- **Presenter and audience windows.** The presenter view shows the current and
  next slide in 16:9; the audience view is a native window with a full-bleed
  embedded browser in the same process, opened at 1280x720 with a standard title
  bar in the default Windows position. F11 enters full screen and Esc returns to
  windowed mode, without disturbing Esc handling inside the slide. State stays
  synchronised whether the presentation is started or ended from the main window,
  the audience window is closed directly, or the app exits.
- **Speaker notes.** Top-level HTML comments on a slide are the notes for that
  slide; comments inside code fences and `slide-size` directives are excluded.
- **Surface Pen controls.** Active only while an audience window opened from the
  main window is running. A single tail-button press moves forward and a hold
  moves back. Removing, connecting, or docking the pen never launches the app or
  the audience window, and pen input never opens or closes the audience window.
- **Slide overview.** Opened from the toolbar or with O, and jumping to any slide
  from it.
- **Keyboard and pointer navigation.** Arrow keys, PageUp/PageDown, Space, Home,
  and End. On the current slide in the audience and presenter views, a left click
  or tap on a margin moves forward and a right click on a margin moves back,
  excluding interactive areas such as slide content, links, and images. The
  next-slide preview in the presenter view stays display-only.
- **Deck file watching.** Saving the Markdown file reloads the deck while
  preserving the current slide, and a failed reload retains the last valid deck.
- **Window sizing.** The DPI-aware sizing of the main window and the audience
  window is unchanged.
- **Workspace confinement and asset resolution.** Paths outside the workspace,
  junction and symlink escapes, and oversized files are rejected; background
  images stay restricted to local SVG, PNG, WebP, JPG, and JPEG files no larger
  than 2 MiB; assets resolve next to the Markdown file first and then from the
  workspace root. Under the port boundary these checks move into the host side of
  that boundary, which is where they already live; the rules themselves and the
  messages the user sees do not change.
- **Embedded browser policy.** Same-origin navigation only, no developer tools,
  no context menu.
- **Themes and rendering.** Dark, light, Microsoft, and custom themes, Mermaid,
  code highlighting, the Architecture DSL, and local images.

## 3. Behaviour that changes

### 3.1 The embedded browser runtime is missing

The packaging-level dependency declaration for the embedded browser runtime is
silently ignored outside App Installer distribution, so a store install can reach
a machine without the runtime. Detection is therefore a run-time check and the
missing runtime is a designed state, not an unhandled error.

The check runs once at startup, before any deck is loaded. When it fails, the
main window shows a full-window message in place of the start screen rather than
a transient notification, because nothing in the app can work without the
runtime:

> **MarkdStage can't start**
> MarkdStage needs the Microsoft Edge WebView2 Runtime, which isn't installed on
> this PC. Most Windows PCs already have it; on this one it's missing or its data
> folder isn't accessible.
>
> **Get the runtime**  **Try again**

**Get the runtime** opens the vendor's download page in the user's browser. The
app never downloads or installs the runtime itself: acquiring a third-party
runtime at run time is prohibited by store policy, and this is the reason the
link is a link and not a button that fixes the problem. **Try again** re-runs the
check in place, so a user who installs the runtime does not have to work out that
a restart is required; if it still fails, the same message stays on screen.

The window remains movable, resizable, and closable while the message is shown,
and the message text is selectable so it can be pasted into a support request.

If the runtime is present but a single view fails to initialise later — a data
folder permission problem, for instance — the app keeps the existing in-window
error surface and the existing wording rather than the full-window message, which
is reserved for "nothing will work".

### 3.2 PDF and PowerPoint export in the graphical app

The graphical app does not gain export entry points in v4. There is no *Export to
PDF* and no *Export to PowerPoint* command in any menu, toolbar, or context menu,
and no export-related item appears in the app at all.

Export stays a CLI capability. Packaging the app does not make export a desktop
feature, and the v4 work is deliberately not the place to design an export
experience — file naming, overwrite prompts, page range, progress, and
cancellation are a feature, not a side effect of a port. The store listing
describes the app as a presenter, not an exporter, so that the omission does not
read as a defect. Adding these entry points later is a normal feature decision
and does not require revisiting this spec.

### 3.3 Deck loading once the separate parser is retired

The app's own deck parser and its supporting types are removed and deck parsing
comes from the shared runtime, which is the single source of truth for every
surface. The intent is that nothing visible changes. In practice the two
implementations can disagree, and every disagreement is user visible somewhere:

- how a deck is split into slides at edge cases such as `---` without a
  preceding blank line, front matter, and horizontal rules inside fenced code;
- which comments become speaker notes;
- the slide titles shown in the overview;
- the wording and the precision of the message shown when a deck fails to load.

Where the two differ, the shared runtime's result is correct by definition and
the app's previous result was a divergence from the other surfaces. Each such
difference is a behaviour change that is listed in the v4 release notes with the
deck shape that triggers it, so a user whose deck renders differently can find
out why. A difference that is worse than the previous behaviour is a bug in the
shared runtime and is fixed there, for all surfaces, rather than patched in the
host.

Deck loading gains no new user-facing step: no conversion prompt, no migration,
no re-save. Decks that open in the archive build open in v4.

## 4. Migration from the archive build

The shipped app is distributed as standalone x64 and arm64 archives attached to
releases, installed and updated by hand. The store package is installed and
updated by a different mechanism, and neither can update the other. Both will
exist on users' machines at the same time, and the same machine can carry both.

**Parallel publication.** Both distributions are published for at least the first
two releases after v4 reaches the store, and for at least three months, whichever
is longer. This gives users who install by hand, and users on machines where the
store is unavailable, a supported path across at least one ordinary update cycle.
During the overlap the archive build receives fixes but no new features.

**Detection in the archive build.** The archive build checks at startup whether
the store package is registered on the machine. When it is, it shows a dismissible
bar at the top of the main window:

> MarkdStage is also installed from the Microsoft Store on this PC. This portable
> copy won't update itself. [What's changing]

The bar is dismissible per version and never blocks the app. The archive build
does not launch, install, uninstall, or import from the store version; it states
the situation and stays out of the way.

**User state does not transfer.** The store version starts with an empty recent
workspace list and default window state. Nothing is imported and nothing is
migrated, because the archive build's state is per-installation and the store
package's storage is per-package. The user loses no content: decks, assets, and
themes are files in folders the user owns, and the store version reaches them by
opening the same folder. This is stated in the installation guide, in the release
notes of the first store release, and behind the bar's *What's changing* link.

**End of life.** The end of the archive build is announced in three places: the
release notes of the release that starts the overlap period, the installation
guide, and this component's README. The final archive release says in its notes
that it is the last one and repeats where to get the store version. Existing
archives stay downloadable from their releases after the end of life; they are
simply no longer updated.

## 5. Prerequisites as the user experiences them

An installed Chromium-based browser is a documented prerequisite of the CLI, and
the embedded browser runtime is a documented prerequisite of the graphical app.
Store policy requires a dependency to be declared up front rather than discovered
at run time, so the listing text is part of this deliverable. The user meets these
statements in three places, and they must agree with each other.

**The store listing.** The System Requirements section states:

> Requires the Microsoft Edge WebView2 Runtime, which is already present on most
> Windows 11 PCs and on Windows 10 PCs kept up to date. If it is missing,
> MarkdStage links you to Microsoft's free download on first run.
>
> The included `markdstage` command line tool additionally needs an installed
> Chromium-based browser (Microsoft Edge, Google Chrome, or another Chromium
> browser) for its layout inspection, image capture, and export commands. The app
> itself does not.

**The installation guide.** `docs/user-guide/installation.md` states the same two
prerequisites for the store package, keeps the existing statement for the archive
build, and says which commands the browser prerequisite applies to. The CLI guide
keeps its own statement of the browser prerequisite.

**In the app.** The only in-app statement is the missing-runtime message in 3.1.
The app does not warn about the browser prerequisite, because the graphical app
does not use an external browser; that warning belongs to the CLI commands that
need one.

## Open points

- The exact overlap window in section 4 is a release-planning decision. The rule
  stated there is the floor, not the schedule.
- The final store listing copy is subject to store editorial limits on length;
  the text in section 5 is the content that must survive editing, not the exact
  characters.
