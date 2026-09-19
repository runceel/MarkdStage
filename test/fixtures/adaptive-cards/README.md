# Adaptive Cards rendering and export fixtures

These local, resolved schema-1.5 payloads exercise the actual vendored SDK.
They are not mock objects, external cards, or screenshot-only approvals.
The [component findings](../../../.github/extensions/markdstage/docs/adaptive-cards-spike.md)
retain the Phase 0 measurements. The current
[static-card contract](../../../.github/extensions/markdstage/docs/adaptive-cards.md)
documents the shipping envelope, diagnostics and image placeholders.

| Source | Purpose | Measured CardElements / aggregate-only |
| --- | --- | --- |
| `typography.json` | TextBlock Markdown, four RichTextBlock runs, Japanese, nested default/emphasis containers, separator | 13 / 0 |
| `columns.json` | Auto, stretch, 128px and weighted columns with differing styles | 17 / 0 |
| `images.json` | Workspace SVG, data SVG, ImageSet, transparency | 7 / 0 |
| `facts-table.json` | FactSet and Table/Row/Cell semantics, header and grid styles | 13 / 3 Facts |
| `clipping.json` | Deliberately over-tall card; top visible, bottom clipped in fixed output | 4 / 0 |
| `unsupported.json` | Custom.Widget rejection must be visible and reported | 0 / 0 (rejected) |
| `placementSlide` in `test/harness/adaptive-cards.mjs` | Card between generic background artwork and native foreground text | 3 / 0 |
| `fallbacks.json` | Unmet capability with static replacement; explicit Custom.Widget drop, both reported | 3 / 0 |
| `blocked-images.json` | Local animateMotion, missing file, external URL; three deterministic placeholders with surrounding text preserved | 10 / 0 |
| `malformed.json` | Invalid TextBlock text type; structural error panel before SDK loading | 0 / 0 (rejected) |
| `multipleCardsSlide` in the harness | Two native cards and one malformed-card picture with separate ownership | 5 / 0 |
| `boundarySlide` in the harness | Card inside generic HTML crossing the bottom/right page edges | 3 / 0 |
| `mixed-native.json` | Native neighbors around Person-image/list artwork; styled runs and a safe link | projected typed tree |
| `native-text.json` | English, long wrapping, Japanese, Markdown link and bounded RTL with a native Latin neighbor | projected typed tree |
| `static-inputs.json` | All seven input examples, initial values/placeholder and explicit static treatment | original and projected typed trees |
| `static-actions-media.json` | Submit/Execute/OpenUrl/collapsed ShowCard and approved poster, no media fetch | original and projected typed trees |

The review cases are ordered as the table above: **12 fixture pages per theme**,
followed by the four native/static-projection pages: **16 fixture pages per
theme** and an automatically appended back cover on page **17**. The Phase 1
whole-card-raster count is historical, not the Phase 2 expectation. The native
fixtures currently produce **122 editable native objects, 26 static
approximations and 12 bounded card PNGs per theme**; approximated objects can
still be editable. Individual facts retain aggregate-only SDK geometry, but
their supported content is a real editable PowerPoint table.
Phase 0's first seven fixture pages remain in their original order. The expected
state/codes for every card are declared in
`adaptiveCardReviewCases`; scripts check them rather than assuming one card per
page or accepting any visible image. Unsupported-card fixtures now use a
genuinely unsupported custom element, not inputs that Phase 2 intentionally
projects into static values.

`assets/card-local.svg` is authored local artwork with transparent corners.
`assets/animated-motion.svg` is a negative fixture: local and data image inputs
must reject its `animateMotion` before rendering or raster capture, now preserving
the surrounding card with a `blocked-image` placeholder instead of discarding it. Browser
regressions also cover `animate`, legacy `animateColor`, `animateTransform`, and
`set` through the same asset inspection path.
The harness constructs slide fragments from these JSON files. The review script
also writes a normal CLI Markdown deck with `---` separators and copies only
the required assets into its isolated artifact workspace.

## Automated checks

From the repository root (Windows paths shown):

```powershell
npm run sync --prefix .\packages\markdstage-cli
node --test .\.github\extensions\markdstage\test\adaptive-card.test.mjs .\.github\extensions\markdstage\test\vendor-assets.test.mjs
npx playwright test --project=visual --project=pptx adaptive-card --workers=1
```

The browser tests load real SDK objects, scramble SDK-generated class names,
reload and compare geometry/pixels, exercise all four themes, check exact
tolerance boundaries, and deny remote/redirect/SVG/implicit-image paths.
The PPTX tests perform actual export, inspect native text/shapes/lines/images and
two genuine tables, inspect bounded picture relationships and PNG transparency,
verify stacking, and reject post-approval image changes. Native collection is
checked before/after for identical browser geometry and pixels. The entire
native model is compared across engines, not just the card's outside rectangle.
They do not regenerate visual baselines.
The Canvas test runs the production Extension HTTP host and export endpoint;
only Copilot registration transport is stubbed. It is not an app-UI automation
or an installed-MSIX test. The shared scanner, browser-free CLI validation,
sanitizer, lazy load, URL policy, exact image budgets, animation denial and
font/image readiness each have targeted regressions.

`test/pptx/adaptive-card-decorations.spec.mjs` reuses the unchanged
`mixed-native.json` failure case and adds a separate four-combination
underline/strike matrix with regular, italic and safe-link runs. Across all four
themes it compares actual SDK paint, retained typed properties, before/after
collection pixels, native runs and real exported PPTX formatting. TextRun's
pinned underline-over-strike precedence does not suppress combined decorations
in TextBlock Markdown or alter the existing fixture counts.

Do not run `test:cli`/`sync` concurrently with tests that import its `shared`
mirror: synchronization replaces that directory. Test outputs may be redirected
with Playwright's `--output` option to a session artifact directory.

## Reproduce Chromium + real WebView2 + actual PPTX

Install/restore only as required by the normal repository dependency workflow.
The Windows-only probe uses the existing Desktop STA dispatcher and
WindowsAppSDK dependency, but creates a **visible 1280x720 CoreWebView2
controller**, not the CLI's hidden 1x1 script host. It records the actual
runtime version, executable, process ID, projection, scale, and viewport.
It neither impersonates WebView2 with a Chromium user agent nor starts the
WinUI application.

```powershell
dotnet build .\apps\MarkdStage.Desktop\tests\MarkdStage.WebView2.Probe\MarkdStage.WebView2.Probe.csproj -p:Platform=ARM64 -r win-arm64
$probe = (Resolve-Path .\apps\MarkdStage.Desktop\tests\MarkdStage.WebView2.Probe\bin\ARM64\Debug\net10.0-windows10.0.26100.0\win-arm64\MarkdStage.WebView2.Probe.exe).Path
$output = '<absolute-session-artifact-directory>'
npm run sync --prefix .\packages\markdstage-cli
node .\test\scripts\adaptive-cards-review.mjs $output --webview2-probe $probe
.\test\scripts\render-adaptive-cards-review.ps1 -ArtifactDirectory $output
node .\test\scripts\measure-adaptive-cards-powerpoint.mjs $output
.\test\scripts\measure-adaptive-cards-links.ps1 -ArtifactDirectory $output
```

Use `Platform=x64`, `win-x64`, and the corresponding output path for x64.
Omitting `--webview2-probe` still generates Chromium/PPTX evidence, but records
WebView2 as **not run**, never as passed. The scripts do not install an engine.
PowerPoint COM must be available for the last command; a missing application is
a blocker to record, not permission to relabel browser captures as PowerPoint.
The script closes only the presentations it opened and quits PowerPoint only
when it started empty and has no other open presentations.

The standalone probe interface is:

```text
MarkdStage.WebView2.Probe <loopback-http-url> <absolute-expression.js> <absolute-output-directory>
```

The expression is evaluated twice with native Core CDP `awaitPromise`. The
probe captures both runs with `CoreWebView2.CapturePreviewAsync`, closes its
own controller/process, and removes its isolated profile.

The PowerPoint script opens every original read-only, correlates actual native
shapes and card pictures to the model, and checks their order and placement.
It then edits **existing** native text, fill, position, image and table objects
in a disposable copy, saves/reopens that copy, verifies persisted values and
renders the edited pages. It never proves editing by adding substitute objects
or by merely finding XML tags. Original hashes must remain unchanged. A missing
native type or mismatched native shape is a failure.

## Evidence layout and interpretation

`evidence.json` records source hashes, Chromium/version, bundle size, cold-load
observations and per-theme comparisons. Each theme directory contains:

- `cards.md`, `assets/`, and the actual `cards.pptx`;
- `model.json`, `export-report.json`, and transparent `card-N.png` (or
  `card-N-M.png` for page N with multiple bounded fallback subtrees);
- `chromium/slide-NNN.png` and typed geometry/native scene/model JSON;
- `webview2/slide-NNN/` with two geometry snapshots, two native PNGs and
  `native-engine.json`;
- `powerpoint/slide-NNN.png` for all 17 pages and `powerpoint-report.json` from
  actual COM rendering, including shape names, order, pixel-converted bounds,
  original file hash, native counts and per-page placement differences;
- `editability-report.json` and disposable edited PPTX/PNG copies;
- `comparisons/` with Chromium-left / native-right image pairs and WebView2
  50%-opacity overlays.

`powerpoint-baseline-measurements.json` records a separate pixel-based check of
baseline-aligned capital glyphs in actual browser and PowerPoint renders.
It uses measured flat-background/ink coverage so thin ClearType stems are not
mistaken for a capital's top crossbar. Its **3 px** limit is unchanged. It
explicitly excludes underlines, italic and non-Latin baselines; those still
require actual-image review, not a claimed baseline derived from a Range.
`powerpoint-link-measurements.json` verifies actual PowerPoint link addresses,
RGB colors and underline states; merely writing an explicit run color is not
enough to disable Office's automatic hyperlink styling.

The repository's existing presentation-application review tolerances are
**2 px** for edges and **3 px** for text, at 1280x720. Compare typed identity,
hierarchy, content, styles, counts and text-rectangle count exactly before
comparing geometry. Text rectangles are not actual baseline measurements.
Within-engine repetition requires zero changed pixels; across-engine image
counts are diagnostic and cannot excuse missing content or wrong stacking.
PowerPoint visual inspection is mandatory, even when native/picture placement is exact.
The COM script also compares every actual card picture to its integer capture
bounds (0.02 px allowance for COM floating-point representation, not a visual
tolerance). Page 9 must retain all three placeholders and both text blocks;
page 11 must contain three distinct cards, with only its error card rasterized;
page 12 must remain partially clipped
with no duplicate card in the generic parent artwork. Its positioned card must
paint above the in-flow footer rule and page badge, matching Chromium: the footer
must not cross or obscure the visible card label. Page 7 separately checks that
an explicitly higher-z native foreground still paints above the card. Page 13
must retain its native siblings, local image/list artwork and link label, without
duplicates. Its final italic TextRun must remain underlined **without** a strike,
matching SDK 3.0.6 paint even though both authored decoration flags are true.
Page 14 keeps the RTL subtree as artwork and native English/Japanese
neighbors. Pages 15/16 never contain a live control or media player. PowerPoint
hyperlinks must retain the browser's text color/decoration, not Office's default
blue-link styling.

The implementation-session evidence does not replace the coordinator's
independent visual gate on the committed SHA. Record that gate separately, and
keep installed-MSIX/WinUI-shell, PowerPoint Web and Impress results distinct from
the native controller and desktop PowerPoint results.

## Official-sample compatibility corpus

`compatibility/` adds **17 separate pages and a back cover**, without changing the
original 16-page native fixture suite. Its expected counts per theme are **64
native objects, 23 approximation entries and 16 bounded card pictures**.
Approximation entries are semantic conversion records, not additional shapes:
their editable objects are already included in the native count.

The five reduced payloads come from official Microsoft AdaptiveCards ActivityUpdate,
FlightUpdateTable, InputsWithValidation, MediaInColumnSet, SimpleFallback and
Element.Requires samples. [provenance.json](compatibility/provenance.json) pins
every upstream URL to commit `8b62e1d5700192578050a4fe255658811e67ce43`, records
all reductions/mutations and distinguishes original MarkdStage assets. The
[upstream MIT license](compatibility/LICENSE) is retained. No external sample
images, portraits or media are copied; the tests never retrieve upstream samples
or runtime assets. Negative remote URL strings must be rejected before fetch.

The shared corpus harness explicitly declares each mutation, static/browser
diagnostic code, severity, content impact and authored path, plus visible and
absent text. It covers native and mixed output, conditional/non-grid tables,
static input/action/media projections, exact source versions, unknown
types/properties, requires/substitution/drop, fatal unused fallback, credentialed
and custom links, blocked/missing/invalid/animated images and diagnostic overflow.
[output-expectations.json](compatibility/output-expectations.json) additionally
pins every conversion's source path/type/mode/reason/native-object count and
bounded-picture ownership. Its `counts` tuple is native objects, approximation
entries, rasterized subtrees; conversion tuples are source path, source type,
mode, reason, native objects. These are executable expectations, not claims that
unmodified upstream samples are fully supported.

```powershell
npm run check:adaptive-cards
npm run sync --prefix .\packages\markdstage-cli
node --test .\.github\extensions\markdstage\test\adaptive-card*.test.mjs
npx playwright test --project=pptx adaptive-card-compatibility adaptive-cards-canvas --workers=1
# Use the real probe built above; the default is all four themes.
node .\test\scripts\adaptive-cards-review.mjs '<absolute-corpus-output>' --suite compatibility --webview2-probe $probe
.\test\scripts\render-adaptive-cards-review.ps1 -ArtifactDirectory '<absolute-corpus-output>'
node .\test\scripts\measure-adaptive-cards-powerpoint.mjs '<absolute-corpus-output>'
.\test\scripts\measure-adaptive-cards-links.ps1 -ArtifactDirectory '<absolute-corpus-output>'
```

The original review command without `--suite compatibility` remains mandatory:
it locks **122 / 26 / 12** and the F01 decoration, hyperlink, clipping and p7/p12
stacking regressions. The corpus does not replace those fixtures.
`--themes dark` is useful for a targeted investigation, **not** a four-theme gate.
Each corpus export writes `compatibility-output.json`, `export-report.txt`,
the normal JSON report/model, actual PPTX and all normal review images.

The production Canvas HTTP/export test and source-built native CLI consume
these same cases and expectations. Canvas only stubs Copilot registration
transport, not the renderer/exporter; it is not live Copilot UI coverage.
Both Canvas fixtures declare their own `.git` root inside the owned fixture
directory. The tests assert that the production workspace resolver selects that
directory and that actual PPTX/PDF output paths remain inside it. This prevents
the default repository-local Playwright output from resolving `cards.md` or
exports against an unrelated ancestor repository. Do not remove the marker or
change product path policy to make a fixture pass. Exercise both locations:

```powershell
npx playwright test --project=pptx adaptive-cards-canvas --workers=1
npx playwright test --project=pptx adaptive-cards-canvas --workers=1 --output '<absolute-owned-artifact-directory>'
```

The native CLI tests exercise actual WebView2 script-host validation, native
asset serving and external-browser export. Run from the repository root:

```powershell
dotnet test .\apps\MarkdStage.Desktop\tests\MarkdStage.Core.Tests\MarkdStage.Core.Tests.csproj -p:Platform=ARM64 -r win-arm64
dotnet test .\apps\MarkdStage.Desktop\tests\MarkdStage.Cli.Tests\MarkdStage.Cli.Tests.csproj -p:Platform=ARM64 -r win-arm64
dotnet build .\apps\MarkdStage.Desktop\src\MarkdStage.Cli\MarkdStage.Cli.csproj -p:Platform=ARM64 -r win-arm64
$env:MARKDSTAGE_NATIVE_CLI = (Resolve-Path .\apps\MarkdStage.Desktop\src\MarkdStage.Cli\bin\ARM64\Debug\net10.0-windows10.0.26100.0\win-arm64\MarkdStageCli.exe).Path
node --test .\apps\MarkdStage.Desktop\tests\native-export-report.test.mjs .\apps\MarkdStage.Desktop\tests\native-cli.test.mjs
```

Use the corresponding x64 runtime/platform on an x64 machine. Source binaries,
real CoreWebView2-controller probes and Windows PowerPoint COM are not
installed-MSIX activation or full WinUI-shell evidence. Linux/Chromium runs must
record Windows/Office checks as not run. A product-tool naming conflict with an
installed user tool does not authorize renaming tools or changing user settings.

## SDK / HostConfig / compatibility upgrade gate

[contract-lock.json](compatibility/contract-lock.json) pins the SDK bytes/version,
authored schema/envelope, capability revision and generated matrix, resolved
HostConfig defaults for four fixed palette probes, relevant parser/render/export
sources, Marked/DOMPurify bytes, original fixtures, local assets, corpus provenance
and exact output expectations. Text fingerprints normalize only line endings.
HostConfig probes inspect the real vendored SDK without rendering or networking;
they are not a substitute for the four actual theme renders.
`test:schema` and the targeted guard test fail on drift. CI cannot silently
accept a changed declaration, fallback, renderer, output count or corpus.

1. **Before changing the dependency**, retain clean accepted-SHA evidence for
   **both** suites using the commands above. Use a separate, clean candidate
   checkout and separate output directories; never overwrite accepted evidence.
   Record browser, WebView2, OS/fonts and actual PowerPoint versions. A fixture
   hash difference is a corpus change needing explicit review, not an SDK delta.
2. For an explicitly requested upgrade only, acquire a reviewed npm archive in
   a checkout-local staging directory (`npm pack adaptivecards@<version>
   --pack-destination .\test-results\adaptive-card-upgrade`). Check upstream
   release notes/API/property and license changes, then extract locally. Split
   the reviewed bundle with the existing vendor tool:

   ```powershell
   node .\.github\extensions\markdstage\scripts\vendor-assets.mjs split .\test-results\adaptive-card-upgrade\package\dist\adaptivecards.min.js .\.github\extensions\markdstage\vendor .\.github\extensions\markdstage\vendor\vendor-assets.lock.json <version> adaptivecards.min.js adaptivecards
   npm run test:vendor
   ```

   Retain the upstream LICENSE and embedded bundle notice; update the canonical
   SDK constant/notices together. Do **not** automatically broaden the source
   version, requires capability, properties or HostConfig. No product runtime
   SDK download is introduced. Startup chunk verification remains mandatory.
3. Make the narrowly accepted canonical changes and update declarations/docs.
   Run `npm run generate:adaptive-cards`; review its diff. Start with the targeted
   unit/corpus/browser tests, then `test:schema`, `test:docs`, `test:vendor`,
   `test:unit`, `test:cli`, native host/CLI tests when affected, and the existing
   Markdown/Mermaid/Architecture/Archify/PDF/PPTX regressions. Synchronize
   `shared` **before**, not during, browser tests; regenerate/check Awesome
   Copilot with `npm run awesome:sync` and `npm run awesome:check`.
4. Run both four-theme review suites against the candidate using actual WebView2
   and PowerPoint. Compare **each suite separately** to its accepted directory:

   ```powershell
   node .\test\scripts\compare-adaptive-cards-review.mjs '<before-baseline>' '<after-baseline>' '.\test-results\upgrade-baseline-comparison'
   node .\test\scripts\compare-adaptive-cards-review.mjs '<before-corpus>' '<after-corpus>' '.\test-results\upgrade-corpus-comparison'
   ```

   The destination must be new. `comparison.json` lists source/SDK changes,
   exact semantic/count/path failures, unchanged **2 px** edge / **3 px** text
   rectangle limits, and pixel changes in Chromium, real WebView2 and actual
   PowerPoint. It writes before/after PNG pairs and changed-image overlays.
   Missing Windows/Office artifacts or any pixel change returns exit 2 for
   investigation/explicit review, never an automatic snapshot refresh.
   Actual capital-glyph baseline checks retain their separate **3 px** limit;
   text rectangles are not baselines. Review every page for missing/obscured
   content and confirm persisted existing-object edits and hyperlinks.
5. Only after independent actual-PPTX visual approval, record the reviewed
   expectation changes and approval evidence in the PR/gate record. A candidate
   fingerprint is deliberately **not** written to the committed lock:

   ```powershell
   node .\test\scripts\adaptive-card-upgrade-guard.mjs --candidate .\test-results\adaptive-card-upgrade\candidate-contract.json
   npm run check:adaptive-cards
   ```

   `--candidate` refuses overwrite and cannot target `contract-lock.json`.
   `--check` continues failing until a human-reviewed lock change is committed;
   there is no `--update` or visual-approval bypass. Update source, matrix,
   precise corpus expectations and approved lock together, then rerun checks.
   Retain the accepted and candidate evidence. Neither a fingerprint change
   nor successful XML/COM measurements self-declares independent visual approval.
