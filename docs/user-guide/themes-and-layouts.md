# Themes and layouts

> 日本語版: [日本語](ja/themes-and-layouts.md)

Themes define colors and typography. Layouts define how an individual slide positions its content.

## Built-in themes

Set the deck-wide theme in front matter:

```markdown
---
theme: dark
---
```

| Theme | Use it for |
| --- | --- |
| `dark` | The default dark navy presentation style |
| `light` | Bright, neutral presentations |
| `microsoft` | Microsoft, Fluent, or Office-inspired presentations |
| `custom` | Organizational colors and cover assets |

The Canvas Extension can apply an explicit theme when opening a deck. That choice takes precedence
over Markdown front matter; otherwise `dark` is the default.

## Slide layouts

### Title

Use a title layout for the first slide:

```markdown
---
layout: title
---

# Product launch

Technical briefing
```

### Standard

Omit `layout` for a normal slide. The first H1 or H2 stays in the title region and the body starts
below it.

### Section

Use a section divider between chapters:

```markdown
---
layout: section
---

## Architecture
```

Keep section slides short.

### Center

Use `layout: center` for a small amount of content that should be vertically centered:

```markdown
---
layout: center
---

## One decision

Adopt the shared platform.
```

### Back cover

The Canvas Extension appends a back cover automatically. Add `logo` or `copyright` in front matter
or custom-theme metadata when you want those values displayed.

## Create a custom theme

Use a folder containing `theme.css` and optional metadata:

```text
themes/brand/
  theme.css
  theme.json
  assets/
    cover.svg
    logo.svg
```

Reference it from Markdown:

```markdown
---
theme: custom
theme-file: themes/brand/theme.css
---
```

`theme.css` contains CSS custom-property declarations only:

```css
:root {
  --bg: #101820;
  --fg: #ffffff;
  --body: #d7e3ef;
  --accent: #00a4ef;
  --surface: #182b3a;
  --border: #31536b;
}
```

Selectors, `@import`, `url()`, JavaScript, and paths outside the workspace are rejected. A sibling
`theme.json` can define slide backgrounds, a cover image, cover/back-cover logos,
and copyright.

```json
{
  "version": 1,
  "background": { "image": "assets/common.png" },
  "layouts": {
    "default": { "background": { "image": "assets/default.webp" } },
    "center": { "background": { "image": "assets/center.jpg" } }
  }
}
```

Each background entry accepts an optional `alt` string. Paths are relative to
`theme.json`, confined to its `assets/` folder using the existing safe asset
path grammar. Unknown keys and invalid values are rejected.

## Background images

Override one slide's background in **any theme and layout**, including title,
section, and back cover:

```markdown
---
layout: center
background-image: /assets/background.png
---

## One decision
```

The `assets/background.png` alias without a leading slash is also supported.
This setting is never inherited by later slides, even when it appears in the
file's initial front matter. Images are found in `assets/` beside the Markdown
first, then workspace-root `assets/`. With no source name, only workspace-root
assets are used. These deck assets are separate from theme-folder assets.

Theme and per-slide background images accept only `.svg`, `.png`, `.webp`,
`.jpg`, and `.jpeg`, up to 2 MiB per file. Remote and `data:` URLs are not allowed.
For per-slide images, write literal filenames (spaces and percent signs are
supported) with `/` separators. Source paths are not URL-decoded: `%20` is
literal filename text, not a space. Queries, fragments, backslashes, and
`.` / `..` segments are rejected. Symlinks cannot escape the assets folder
or workspace.

| Layout | Background precedence |
| --- | --- |
| Standard (`default`) | Per-slide image → `layouts.default.background` → root `background` → existing background |
| `center` | Per-slide image → `layouts.center.background` → root `background` → existing background |
| `title` | Per-slide image → `cover.background` → existing cover background |
| `section` / `backcover` | Per-slide image → existing layout background |

The common theme background applies only to default/center. Images are centered
and cropped to cover the slide, behind content and logos, with existing colors
or gradients beneath. No additional overlay or per-layout color settings are
added. Existing covers, logos, and CSS-only themes remain unchanged when no new
images are specified.

Only an **absent** setting triggers fallback. An invalid value, missing file, or
image larger than 2 MiB is an error, never a silent substitution.

For the complete property reference, see
[Custom theme authoring](../../.github/extensions/markdstage/docs/custom-theme-authoring.md).

## Check layout before presenting

Content can look acceptable in a flexible canvas but clip in fixed 16:9 output. In the Canvas
Extension, select **More controls > Output preview** and resolve every warning before exporting.

[Next: Diagrams and media →](diagrams-and-media.md)
