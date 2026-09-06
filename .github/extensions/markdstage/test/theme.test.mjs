import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_THEME,
  mapThemeMetadataAssets,
  mermaidThemeVariables,
  normalizeTheme,
  parseThemeMetadata,
  parseThemeVariables,
  resolveFrontMatterTheme,
  serializeThemeVariables,
  themeMetadataAssetPaths,
} from "../renderer/theme.mjs";

test("theme resolution defaults to dark and reads front matter", () => {
  assert.equal(normalizeTheme("unknown"), DEFAULT_THEME);
  assert.deepEqual(
    resolveFrontMatterTheme([
      ["---", "theme: custom", "theme-file: ./brand.css", "---", "# Title"].join("\n"),
    ]),
    { theme: "custom", themeFile: "./brand.css" },
  );
});

test("theme CSS accepts custom properties and a root wrapper", () => {
  const variables = parseThemeVariables(`
    :root {
      --bg: #101820;
      --accent: linear-gradient(90deg, #00a4ef, #7fba00);
    }
  `);
  assert.deepEqual(variables, {
    "--bg": "#101820",
    "--accent": "linear-gradient(90deg, #00a4ef, #7fba00)",
  });
  assert.equal(
    serializeThemeVariables(variables),
    "--bg:#101820;--accent:linear-gradient(90deg, #00a4ef, #7fba00);",
  );
});

test("Mermaid colors are derived from the rendered slide theme", () => {
  const colors = {
    "--bg": "#101820",
    "--surface": "#17232d",
    "--border": "#31536b",
    "--fg": "#ffffff",
    "--body": "#d8e6ef",
    "--accent": "#42d3ff",
    "--accent-strong": "#a6f36b",
    "--accent-soft": "rgba(66, 211, 255, .14)",
    "--accent-line": "rgba(66, 211, 255, .46)",
  };

  assert.deepEqual(
    mermaidThemeVariables({
      // Values come back with surrounding whitespace from getComputedStyle;
      // the helper must trim them before handing them to Mermaid.
      getPropertyValue: (name) => ` ${colors[name]} `,
    }),
    {
      background: "#101820",
      primaryColor: "#17232d",
      primaryTextColor: "#ffffff",
      primaryBorderColor: "#31536b",
      secondaryColor: "rgba(66, 211, 255, .14)",
      secondaryTextColor: "#a6f36b",
      secondaryBorderColor: "rgba(66, 211, 255, .46)",
      tertiaryColor: "#101820",
      tertiaryTextColor: "#d8e6ef",
      tertiaryBorderColor: "#31536b",
      lineColor: "#42d3ff",
      textColor: "#ffffff",
      mainBkg: "#17232d",
      nodeBorder: "#31536b",
      clusterBkg: "rgba(66, 211, 255, .14)",
      clusterBorder: "rgba(66, 211, 255, .46)",
      titleColor: "#ffffff",
      edgeLabelBackground: "#101820",
    },
  );
});

test("section backgrounds accept layered gradients and a print override", () => {
  const variables = parseThemeVariables(`
    --section-bg:
      linear-gradient(55deg, transparent 76%, #42d3ff 77%, transparent 78%),
      radial-gradient(110% 55% at 60% 115%, #42d3ff, #315b32 42%, transparent 72%),
      #0b1320;
    --print-section-bg: var(--section-bg);
  `);
  assert.deepEqual(variables, {
    "--section-bg":
      "linear-gradient(55deg, transparent 76%, #42d3ff 77%, transparent 78%),\n" +
      "      radial-gradient(110% 55% at 60% 115%, #42d3ff, #315b32 42%, transparent 72%),\n" +
      "      #0b1320",
    "--print-section-bg": "var(--section-bg)",
  });
});

test("theme CSS rejects selectors and unsafe values", () => {
  assert.throws(() => parseThemeVariables(".deck { color: red; }"), /only --custom-property/);
  assert.throws(() => parseThemeVariables("--bg: url(https://example.test/bg.png);"), /unsafe/);
});

test("theme metadata accepts folder-local assets and maps them to served URLs", () => {
  const metadata = parseThemeMetadata({
    version: 1,
    cover: {
      background: { image: "assets/cover.svg" },
      logo: { image: "assets/brand/logo.svg", alt: "Example" },
    },
    backcover: {
      logo: { image: "assets/brand/logo.svg", alt: "Example" },
      copyright: "Copyright Example",
    },
  });
  assert.deepEqual(themeMetadataAssetPaths(metadata), [
    "assets/cover.svg",
    "assets/brand/logo.svg",
  ]);
  assert.deepEqual(
    mapThemeMetadataAssets(metadata, (path) => `/theme-assets/${path}`),
    {
      version: 1,
      cover: {
        background: { image: "/theme-assets/assets/cover.svg" },
        logo: { image: "/theme-assets/assets/brand/logo.svg", alt: "Example" },
      },
      backcover: {
        logo: { image: "/theme-assets/assets/brand/logo.svg", alt: "Example" },
        copyright: "Copyright Example",
      },
    },
  );
});

test("theme metadata rejects unsafe paths and invalid shapes", () => {
  assert.throws(
    () => parseThemeMetadata({ version: 1, cover: { background: { image: "../cover.svg" } } }),
    /safe path/,
  );
  assert.throws(
    () =>
      parseThemeMetadata({
        version: 1,
        cover: { logo: { image: "assets/logo.svg", alt: "" } },
      }),
    /non-empty/,
  );
  assert.throws(() => parseThemeMetadata({ version: 2 }), /version must be 1/);
  assert.throws(() => parseThemeMetadata({ version: 1, vendor: "Example" }), /not supported/);
});
