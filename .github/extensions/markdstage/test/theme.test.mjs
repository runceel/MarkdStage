import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_THEME,
  mapThemeMetadataAssets,
  mermaidC4ThemeVariables,
  mermaidThemeVariables,
  normalizeTheme,
  parseThemeMetadata,
  parseThemeVariables,
  resolveFrontMatterTheme,
  resolveThemeBackground,
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
    "--code": "#1f2d3a",
    "--border": "#31536b",
    "--fg": "#ffffff",
    "--muted": "#8ba2b4",
    "--body": "#d7e3f0",
    "--accent": "#42d3ff",
    "--accent-strong": "#a6f36b",
    "--accent-soft": "rgba(66, 211, 255, .14)",
    "--accent-line": "rgba(66, 211, 255, .46)",
  };

  const variables = mermaidThemeVariables({
    // Values come back with surrounding whitespace from getComputedStyle;
    // the helper must trim them before handing them to Mermaid.
    getPropertyValue: (name) => ` ${colors[name]} `,
  });
  assert.deepEqual(mermaidC4ThemeVariables(variables), {
    person_bg_color: "#17232d",
    person_border_color: "#ffffff",
    external_person_bg_color: "#1f2d3a",
    external_person_border_color: "#ffffff",
    system_bg_color: "#1f2d3a",
    system_border_color: "#ffffff",
    system_db_bg_color: "#1f2d3a",
    system_db_border_color: "#ffffff",
    system_queue_bg_color: "#1f2d3a",
    system_queue_border_color: "#ffffff",
    external_system_bg_color: "#1f2d3a",
    external_system_border_color: "#ffffff",
    external_system_db_bg_color: "#1f2d3a",
    external_system_db_border_color: "#ffffff",
    external_system_queue_bg_color: "#1f2d3a",
    external_system_queue_border_color: "#ffffff",
    container_bg_color: "#31536b",
    container_border_color: "#ffffff",
    container_db_bg_color: "#31536b",
    container_db_border_color: "#ffffff",
    container_queue_bg_color: "#31536b",
    container_queue_border_color: "#ffffff",
    external_container_bg_color: "#101820",
    external_container_border_color: "#ffffff",
    external_container_db_bg_color: "#101820",
    external_container_db_border_color: "#ffffff",
    external_container_queue_bg_color: "#101820",
    external_container_queue_border_color: "#ffffff",
    component_bg_color: "#101820",
    component_border_color: "#ffffff",
    component_db_bg_color: "#101820",
    component_db_border_color: "#ffffff",
    component_queue_bg_color: "#101820",
    component_queue_border_color: "#ffffff",
    external_component_bg_color: "#101820",
    external_component_border_color: "#ffffff",
    external_component_db_bg_color: "#101820",
    external_component_db_border_color: "#ffffff",
    external_component_queue_bg_color: "#101820",
    external_component_queue_border_color: "#ffffff",
  });
  const genericKeys = [
    "background",
    "primaryColor",
    "primaryTextColor",
    "primaryBorderColor",
    "secondaryColor",
    "secondaryTextColor",
    "secondaryBorderColor",
    "tertiaryColor",
    "tertiaryTextColor",
    "tertiaryBorderColor",
    "lineColor",
    "textColor",
    "mainBkg",
    "nodeBorder",
    "clusterBkg",
    "clusterBorder",
    "titleColor",
    "edgeLabelBackground",
    "noteBkgColor",
    "noteBorderColor",
    "noteTextColor",
    "pie1",
  ];
  assert.deepEqual(Object.fromEntries(genericKeys.map((key) => [key, variables[key]])), {
      background: "#101820",
      primaryColor: "#17232d",
      primaryTextColor: "#ffffff",
      primaryBorderColor: "#31536b",
      secondaryColor: "#a6f36b",
      secondaryTextColor: "#101820",
      secondaryBorderColor: "rgba(66, 211, 255, .46)",
      tertiaryColor: "#8ba2b4",
      tertiaryTextColor: "#101820",
      tertiaryBorderColor: "#31536b",
      lineColor: "#42d3ff",
      textColor: "#ffffff",
      mainBkg: "#17232d",
      nodeBorder: "#31536b",
      clusterBkg: "rgba(66, 211, 255, .14)",
      clusterBorder: "rgba(66, 211, 255, .46)",
      titleColor: "#ffffff",
      edgeLabelBackground: "#101820",
      noteBkgColor: "rgba(66, 211, 255, .14)",
      noteBorderColor: "rgba(66, 211, 255, .46)",
      noteTextColor: "#a6f36b",
      pie1: "#42d3ff",
  });

  assert.deepEqual(
    Object.fromEntries(
      [
        "person_bg_color",
        "person_border_color",
        "external_person_bg_color",
        "system_bg_color",
        "container_bg_color",
        "external_container_bg_color",
        "component_bg_color",
        "external_component_bg_color",
        "archEdgeColor",
        "archEdgeArrowColor",
        "archGroupBorderColor",
        "archGroupBorderWidth",
        "emUiFill",
        "emUiStroke",
        "emProcessorFill",
        "emProcessorStroke",
        "emReadModelFill",
        "emReadModelStroke",
        "emCommandFill",
        "emCommandStroke",
        "emEventFill",
        "emEventStroke",
        "emSwimlaneBackgroundOdd",
        "emSwimlaneBackgroundStroke",
        "emArrowhead",
        "emRelationStroke",
        "attributeBackgroundColorOdd",
        "attributeBackgroundColorEven",
      ].map((key) => [key, variables[key]]),
    ),
    {
      person_bg_color: "#17232d",
      person_border_color: "#ffffff",
      external_person_bg_color: "#1f2d3a",
      system_bg_color: "#1f2d3a",
      container_bg_color: "#31536b",
      external_container_bg_color: "#101820",
      component_bg_color: "#101820",
      external_component_bg_color: "#101820",
      archEdgeColor: "#42d3ff",
      archEdgeArrowColor: "#42d3ff",
      archGroupBorderColor: "#42d3ff",
      archGroupBorderWidth: "1",
      emUiFill: "#17232d",
      emUiStroke: "#42d3ff",
      emProcessorFill: "rgba(66, 211, 255, .14)",
      emProcessorStroke: "#42d3ff",
      emReadModelFill: "#1f2d3a",
      emReadModelStroke: "#a6f36b",
      emCommandFill: "#101820",
      emCommandStroke: "#42d3ff",
      emEventFill: "rgba(66, 211, 255, .46)",
      emEventStroke: "#a6f36b",
      emSwimlaneBackgroundOdd: "rgba(66, 211, 255, .14)",
      emSwimlaneBackgroundStroke: "#42d3ff",
      emArrowhead: "#42d3ff",
      emRelationStroke: "#42d3ff",
      attributeBackgroundColorOdd: "#17232d",
      attributeBackgroundColorEven: "#1f2d3a",
    },
  );
});

test("Mermaid C4 fills switch to dark text-safe colors on light themes", () => {
  const colors = {
    "--bg": "#ffffff",
    "--surface": "#ffffff",
    "--code": "#f3f4f6",
    "--border": "#e5e7eb",
    "--fg": "#15181f",
    "--muted": "#5b6470",
    "--body": "#333a44",
    "--accent": "#4f46e5",
    "--accent-strong": "#4338ca",
    "--accent-soft": "#eef2ff",
    "--accent-line": "#c7d2fe",
  };
  const variables = mermaidThemeVariables({
    getPropertyValue: (name) => colors[name] || "",
  });
  assert.deepEqual(
    {
      person: variables.person_bg_color,
      system: variables.system_bg_color,
      container: variables.container_bg_color,
      component: variables.component_bg_color,
      external: variables.external_system_bg_color,
      edge: variables.archEdgeColor,
      lane: variables.emSwimlaneBackgroundOdd,
    },
    {
      person: "#15181f",
      system: "#4338ca",
      container: "#4f46e5",
      component: "#333a44",
      external: "#15181f",
      edge: "#4f46e5",
      lane: "#eef2ff",
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

test("theme backgrounds resolve normalized layouts without leaking into special layouts", () => {
  const background = { image: "assets/common.png" };
  const standard = { image: "assets/default.webp" };
  const center = { image: "assets/center.jpg" };
  const cover = { image: "assets/title.svg" };
  const metadata = parseThemeMetadata({
    version: 1,
    background,
    layouts: { default: { background: standard }, center: { background: center } },
    cover: { background: cover },
  });
  for (const layout of [undefined, null, "", "default", " DEFAULT ", "closing", "unknown"]) {
    assert.deepEqual(resolveThemeBackground(metadata, layout), standard);
  }
  assert.deepEqual(resolveThemeBackground(metadata, " CENTER "), center);
  assert.deepEqual(resolveThemeBackground(metadata, " TITLE "), cover);
  for (const layout of ["section", " SECTION ", "backcover", " BACKCOVER "]) {
    assert.equal(resolveThemeBackground(metadata, layout), undefined);
  }
  for (const layout of ["default", "center"]) {
    assert.deepEqual(resolveThemeBackground({ background }, layout), background);
    assert.equal(resolveThemeBackground({ version: 1 }, layout), undefined);
    assert.equal(resolveThemeBackground(undefined, layout), undefined);
    const other = layout === "center" ? "default" : "center";
    assert.deepEqual(
      resolveThemeBackground({ background, layouts: { [other]: { background: cover } } }, layout),
      background,
    );
    assert.equal(
      resolveThemeBackground({ layouts: { [other]: { background: cover } } }, layout),
      undefined,
    );
  }
  assert.equal(resolveThemeBackground({ background }, "title"), undefined);
  assert.equal(resolveThemeBackground(undefined, "title"), undefined);
});

test("theme background assets are enumerated and mapped once per unique path", () => {
  const metadata = parseThemeMetadata({
    version: 1,
    background: { image: "assets/shared.png", alt: " Common " },
    layouts: {
      default: { background: { image: "assets/default.webp" } },
      center: { background: { image: "assets/shared.png", alt: "Center" } },
    },
    cover: {
      background: { image: "assets/cover.svg" },
      logo: { image: "assets/logo.jpeg", alt: "Logo" },
    },
    backcover: {
      logo: { image: "assets/logo.jpeg", alt: "Back logo" },
      copyright: "Example",
    },
  });
  assert.deepEqual(themeMetadataAssetPaths(metadata), [
    "assets/cover.svg", "assets/logo.jpeg", "assets/shared.png", "assets/default.webp",
  ]);
  const calls = [];
  const mapped = mapThemeMetadataAssets(metadata, (path) => {
    calls.push(path);
    return `/theme-assets/${path}`;
  });
  assert.equal(calls.length, 4);
  assert.deepEqual(new Set(calls), new Set(themeMetadataAssetPaths(metadata)));
  assert.deepEqual(mapped, {
    version: 1,
    background: { image: "/theme-assets/assets/shared.png", alt: "Common" },
    layouts: {
      default: { background: { image: "/theme-assets/assets/default.webp" } },
      center: { background: { image: "/theme-assets/assets/shared.png", alt: "Center" } },
    },
    cover: {
      background: { image: "/theme-assets/assets/cover.svg" },
      logo: { image: "/theme-assets/assets/logo.jpeg", alt: "Logo" },
    },
    backcover: {
      logo: { image: "/theme-assets/assets/logo.jpeg", alt: "Back logo" },
      copyright: "Example",
    },
  });
  assert.equal(metadata.background.image, "assets/shared.png");
});

test("empty and legacy theme metadata retain existing behavior", () => {
  const metadata = parseThemeMetadata({
    version: 1, layouts: { default: {}, center: {} }, cover: {}, backcover: {},
  });
  assert.deepEqual(metadata, { version: 1 });
  assert.deepEqual(themeMetadataAssetPaths(metadata), []);
  assert.deepEqual(mapThemeMetadataAssets(metadata, () => assert.fail()), { version: 1 });
  const legacy = parseThemeMetadata({
    version: 1,
    cover: { background: { image: "assets/title.png" } },
    backcover: { copyright: "" },
  });
  assert.deepEqual(resolveThemeBackground(legacy, "title"), legacy.cover.background);
  assert.equal(resolveThemeBackground(legacy, "default"), undefined);
  assert.equal(resolveThemeBackground(legacy, "center"), undefined);
});

test("theme backgrounds reject invalid entries instead of using fallback", () => {
  for (const background of [
    null, [], "assets/background.png", {}, { image: 1 },
    { image: "/assets/background.png" }, { image: "assets/../background.png" },
    { image: "https://example.test/background.png" }, { image: "data:image/png;base64,AA==" },
    { image: "assets/background.gif" }, { image: "assets/background.png", alt: 5 },
    { image: "assets/background.png", color: "#fff" },
  ]) {
    for (const fields of [
      { background },
      { layouts: { default: { background } } },
      { layouts: { center: { background } } },
    ]) {
      assert.throws(() => parseThemeMetadata({ version: 1, ...fields }));
    }
  }
  for (const layouts of [
    null, [], "default", { title: {} }, { section: {} }, { backcover: {} },
    { default: null }, { center: [] }, { default: { color: "#fff" } },
    { center: { image: "assets/center.png" } },
  ]) {
    assert.throws(() => parseThemeMetadata({ version: 1, layouts }));
  }
});
