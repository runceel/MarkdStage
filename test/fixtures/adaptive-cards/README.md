# Adaptive Cards architecture-spike fixtures

These local, resolved schema-1.5 payloads exercise the actual vendored SDK.
They are not mock objects, external cards, or screenshot-only approvals.
The [component findings](../../../.github/extensions/markdstage/docs/adaptive-cards-spike.md)
document the compatibility boundary and actual measurements.

| Source | Purpose | Measured CardElements / aggregate-only |
| --- | --- | --- |
| `typography.json` | TextBlock Markdown, four RichTextBlock runs, Japanese, nested default/emphasis containers, separator | 13 / 0 |
| `columns.json` | Auto, stretch, 128px and weighted columns with differing styles | 17 / 0 |
| `images.json` | Workspace SVG, data SVG, ImageSet, transparency | 7 / 0 |
| `facts-table.json` | FactSet and Table/Row/Cell semantics, header and grid styles | 13 / 3 Facts |
| `clipping.json` | Deliberately over-tall card; top visible, bottom clipped in fixed output | 4 / 0 |
| `unsupported.json` | Input.Text rejection must be visible and reported | 0 / 0 (rejected) |
| `placementSlide` in `test/harness/adaptive-cards.mjs` | Card between generic background artwork and native foreground text | 3 / 0 |

`assets/card-local.svg` is authored local artwork with transparent corners.
`assets/animated-motion.svg` is a negative fixture: local and data image inputs
must reject its `animateMotion` before rendering or raster capture. Browser
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
npx playwright test --project=visual --project=pptx adaptive-cards.spec.mjs --workers=1
```

The browser tests load real SDK objects, scramble SDK-generated class names,
reload and compare geometry/pixels, exercise all four themes, check exact
tolerance boundaries, and deny remote/redirect/SVG/implicit-image paths.
The PPTX tests perform actual export, inspect embedded picture relationships and
PNG transparency/bounds, verify stacking, and reject post-approval image changes.
They do not regenerate visual baselines.

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

## Evidence layout and interpretation

`evidence.json` records source hashes, Chromium/version, bundle size, cold-load
observations and per-theme comparisons. Each theme directory contains:

- `cards.md`, `assets/`, and the actual `cards.pptx`;
- `model.json`, `export-report.json`, and one transparent `card-N.png` per card;
- `chromium/slide-NNN.png` and typed geometry JSON;
- `webview2/slide-NNN/` with two geometry snapshots, two native PNGs and
  `native-engine.json`;
- `powerpoint/slide-NNN.png` and `powerpoint-report.json` from actual COM
  rendering, including shape names, order and pixel-converted bounds;
- `comparisons/` with Chromium-left / native-right image pairs and WebView2
  50%-opacity overlays.

The repository's existing presentation-application review tolerances are
**2 px** for edges and **3 px** for text, at 1280x720. Compare typed identity,
hierarchy, content, styles, counts and text-rectangle count exactly before
comparing geometry. Text rectangles are not actual baseline measurements.
Within-engine repetition requires zero changed pixels; across-engine image
counts are diagnostic and cannot excuse missing content or wrong stacking.
PowerPoint visual inspection is mandatory, even when picture placement is exact.

The implementation-session evidence does not replace the coordinator's
independent visual gate on the committed SHA. Record that gate separately, and
keep installed-MSIX/WinUI-shell, PowerPoint Web and Impress results distinct from
the native controller and desktop PowerPoint results.
