import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import { loadCustomTheme } from "../runtime/custom-theme.mjs";

const css = await readFile(new URL("../renderer/slides.css", import.meta.url), "utf8");
const renderer = await readFile(new URL("../renderer/renderer.js", import.meta.url), "utf8");

test("custom theme sizing tokens also win on the fixed output surface", () => {
  // Layer order, not specificity, decides: the fixed 1280x720 rules are more
  // specific than the injected theme selector but sit in the earlier layer.
  assert.match(css, /@layer markdstage\.base, markdstage\.theme, markdstage\.size;/);
  const base = css.match(/@layer markdstage\.base\{\s*body\.fixed-output-mode \.deck\{[^}]*\}\s*\}/);
  assert.ok(base, "the fixed output tokens must live in the markdstage.base layer");
  assert.match(base[0], /--deck-pad-x:84px/);
  assert.match(base[0], /--slide-body-size:22px/);
  assert.match(
    renderer,
    /@layer markdstage\.theme\{:root\[data-theme="custom"\], \.deck\[data-theme="custom"\]/,
  );
});

test("size presets stay in the last layer and gain a compact step", () => {
  const presets = css.split("@layer markdstage.size{").slice(1);
  assert.equal(presets.length, 2, "responsive and fixed presets both belong to markdstage.size");
  for (const block of presets) {
    for (const level of ["compact", "large", "xlarge"]) {
      assert.match(block, new RegExp(`\\.deck\\.size-${level}\\{`));
    }
  }
  assert.match(
    css,
    /body\.fixed-output-mode \.deck\.size-compact\{[^}]*--slide-h1-size:\s*40px;[^}]*--slide-body-size:\s*18px;[^}]*--slide-code-size:\s*13px;/,
  );
  assert.match(renderer, /SIZE_MODES = new Set\(\["auto", "compact", "normal", "large", "xlarge"\]\)/);
  assert.match(renderer, /\(auto\|compact\|normal\|large\|xlarge\)/);
  assert.match(renderer, /deck\.classList\.remove\("size-compact", "size-large", "size-xlarge"\)/);
  // A theme with its own type scale keeps it: auto sizing must not enlarge it.
  assert.match(renderer, /customThemeSizesSlides && deck\.dataset\.theme === "custom"/);
});

test("fixed output dimensions and decoration read theme tokens", () => {
  assert.match(css, /body\.fixed-output-mode \.kicker\{\s*font-size:var\(--kicker-size,\s*12px\);/);
  assert.match(css, /max-height:var\(--slide-image-max-height,\s*346px\)/);
  assert.match(css, /max-height:var\(--mermaid-max-height,\s*317px\)/);
  assert.match(css, /max-height:var\(--architecture-max-height,\s*504px\)/);
  assert.match(css, /border-top:var\(--rule-width,\s*1px\) solid var\(--rule-color,\s*var\(--border\)\)/);
  assert.match(css, /font-size:var\(--table-font-size,\s*\.9em\)/);
  assert.match(css, /border:var\(--table-border-width,\s*1px\) solid var\(--border\)/);
  assert.match(css, /padding:var\(--table-cell-padding,\s*\.55em \.8em\)/);
  assert.match(css, /\.deck :is\(h1,h2,h3,h4,h5,h6\)\{\s*font-family:var\(--heading-font,\s*inherit\);/);
  assert.match(css, /code\{\s*font-family:var\(--code-font,\s*"Cascadia Code"/);
});

test("custom theme loading warns about properties outside the theme schema", async () => {
  const workspace = resolve(`.theme-sizing-test-${randomUUID()}`);
  const themeDir = join(workspace, "themes", "brand");
  try {
    await mkdir(themeDir, { recursive: true });
    await writeFile(
      join(themeDir, "theme.css"),
      ":root{--slide-body-size:16px;--rule-width:3px;--slide-bodysize:16px;}",
    );
    const loaded = await loadCustomTheme(workspace, "", "themes/brand/theme.css");
    assert.equal(loaded.css, "--slide-body-size:16px;--rule-width:3px;--slide-bodysize:16px;");
    assert.deepEqual(loaded.warnings, [
      {
        code: "unknown_theme_property",
        message:
          "Unknown custom theme property: --slide-bodysize. It is applied as-is, but no " +
          "standard layout uses it; see schema/theme-v1.json for the supported properties.",
      },
    ]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
