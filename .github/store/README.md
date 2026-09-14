# Microsoft Store assets

Everything needed to fill in the MarkdStage listing in Microsoft Store Partner
Center. The release steps that use these files are in
[`../RELEASING.md`](../RELEASING.md).

Nothing in this folder ships inside the app package or the Extension ZIP.

## Contents

| Path | Purpose |
| --- | --- |
| `listing-en-us.md` | Canonical listing text: description, seven product features, and six screenshot captions. English is submitted; Japanese translations are for review. |
| `logos/` | Store art submitted to Partner Center as PNG. |
| `screenshots/` | Listing screenshots, named in upload order. |
| `scripts/` | PowerShell helpers used to produce the PNG files. |

The editable sources for the Store art live with the rest of the brand artwork
in [`../../assets/brand/`](../../assets/brand/).

## Store art

| Partner Center slot | Source | Submitted PNG | Size |
| --- | --- | --- | --- |
| 9:16 poster art | `assets/brand/store-poster-9x16.svg` | `logos/PosterArt-1440x2160.png` | 1440x2160 |
| 1:1 box art | `assets/brand/store-boxart-1x1.svg` | `logos/BoxArt-2160x2160.png` | 2160x2160 |
| 16:9 super hero art | `assets/brand/store-superhero-16x9.svg` | `logos/SuperHeroArt-1920x1080.png` | 1920x1080 |

All three reuse the app icon's visual language: a midnight tile, a warm amber
stage spotlight, and the Markdown hash standing in the light.

Constraints these files already satisfy, which must be preserved when editing:

- Full bleed with no transparency, so the Store can composite them on any background.
- No rounded corners, borders, or drop shadows; Partner Center applies its own masking.
- At least 10% of each edge is free of essential content, because tiles are cropped.
- Super hero art contains no product title, as Partner Center requires, and keeps
  its left third dark so the overlaid title and logo stay readable.

Regenerate a PNG after editing an SVG:

```powershell
.github\store\scripts\Render-Svg.ps1 `
  -Svg assets\brand\store-poster-9x16.svg `
  -Out .github\store\logos\PosterArt-1440x2160.png `
  -Width 1440 -Height 2160
```

`Render-Svg.ps1` rasterizes through headless Microsoft Edge, so no image editor
or extra dependency is required.

## Screenshots

Upload in filename order. The sequence follows the listing narrative: AI drafts
the deck, you correct it, you present it, you take the result with you.

| File | Shows |
| --- | --- |
| `01-architecture.png` | An Architecture DSL diagram rendered from Markdown. |
| `02-shape-editing.png` | The Architecture Editor with an element selected. |
| `03-presenter.png` | Presenter view with current slide, next slide, and notes. |
| `04-pptx-editable-shapes.png` | The PowerPoint export with individual shapes in the selection pane. |
| `05-code-mermaid.png` | Syntax-highlighted code and a Mermaid diagram. |
| `06-custom-theme.png` | A fictional company's custom theme. |

All six are 1920x1080, above the 1366x768 Store minimum.

`01`, `02`, `03`, and `05` come from the repository-root `slides.md`. `06` comes
from the sample deck in
[`docs/user-guide/examples/custom-theme-helioworks/`](../../docs/user-guide/examples/custom-theme-helioworks/),
whose fictional "Helioworks" branding exists so no real customer artwork appears
in the listing.

To retake a shot, place the app window and capture it:

```powershell
.github\store\scripts\Capture-MarkdStage.ps1 `
  -OutFile .github\store\screenshots\01-architecture.png `
  -TitleLike 'MarkdStage*' -X 100 -Y 0 -Width 1920 -Height 1080
```

The script is DPI-aware per monitor and measures the window with
`DWMWA_EXTENDED_FRAME_BOUNDS`, so the captured image is exactly the requested
size regardless of display scaling. Pass `-ListOnly` to see candidate windows,
and `-ProcessLike` to capture a different application, such as `*POWERPNT*` for
the PowerPoint export shot.

`Mask-Region.ps1` fills rectangles with a sampled background color. Use it to
remove the signed-in account name and avatar before committing a screenshot that
includes another application's title bar:

```powershell
.github\store\scripts\Mask-Region.ps1 `
  -InFile capture.png -OutFile .github\store\screenshots\04-pptx-editable-shapes.png `
  -Rect '1730,4,42,42' -SampleFrom '1700,20'
```

Never commit a screenshot containing an account name, avatar, email address, or
customer data.

## Editing the listing text

1. Edit `listing-en-us.md` first so the repository stays the source of truth.
2. Keep each product feature under 200 characters and each screenshot caption
   under 200 characters.
3. Keep the Japanese translation in step with the English text.
4. Copy the English blocks into Partner Center.

Describe only shipped behavior. The description discloses the Microsoft Edge
WebView2 Runtime requirement, and states that PDF and PowerPoint export run
through the included command-line tool, which additionally needs an installed
Chromium-based browser.
