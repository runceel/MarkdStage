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
  assert.deepEqual(
    mermaidC4ThemeVariables({ ...variables, lineColor: "ignored" }),
    Object.fromEntries(
      Object.entries(variables).filter(([name]) => name.endsWith("_bg_color") || name.endsWith("_border_color")),
    ),
  );
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
    primaryBorderColor: "#8ba2b4",
    secondaryColor: "#a6f36b",
    secondaryTextColor: "#101820",
    secondaryBorderColor: "#42d3ff",
    tertiaryColor: "#8ba2b4",
    tertiaryTextColor: "#101820",
    tertiaryBorderColor: "#8ba2b4",
    lineColor: "#42d3ff",
    textColor: "#ffffff",
    mainBkg: "#17232d",
    nodeBorder: "#8ba2b4",
    clusterBkg: "rgba(66, 211, 255, .14)",
    clusterBorder: "#42d3ff",
    titleColor: "#ffffff",
    edgeLabelBackground: "#101820",
    noteBkgColor: "rgba(66, 211, 255, .14)",
    noteBorderColor: "rgba(66, 211, 255, .46)",
    noteTextColor: "#a6f36b",
    pie1: "#42d3ff",
  });
  assert.equal(variables.rowOdd, colors["--surface"]);
  assert.equal(variables.rowEven, colors["--code"]);
  assert.deepEqual(variables.packet, {
    startByteColor: colors["--fg"],
    endByteColor: colors["--fg"],
    labelColor: colors["--fg"],
    titleColor: colors["--fg"],
    blockStrokeColor: colors["--muted"],
    blockFillColor: colors["--surface"],
  });
  assert.deepEqual(variables.treeView, {
    labelColor: colors["--fg"],
    lineColor: colors["--muted"],
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

test("C4 selects text-safe roles per fill even with bright accents or a dark backdrop", () => {
  const colors = {
    "--bg": "#101820", "--surface": "#fff", "--code": "#f3f4f6",
    "--border": "#888", "--fg": "#15181f", "--body": "#333a44",
    "--accent": "#00bfff", "--accent-strong": "#0af",
  };
  const variables = mermaidThemeVariables({ getPropertyValue: (name) => colors[name] || "" });
  assert.equal(variables.person_bg_color, colors["--fg"]);
  assert.equal(variables.system_bg_color, colors["--body"]);
  assert.equal(variables.container_bg_color, colors["--body"]);
  assert.equal(variables.component_bg_color, colors["--bg"]);
  assert.equal(variables.primaryColor, colors["--surface"]);
  assert.equal(variables.lineColor, colors["--accent"]);
});

test("C4 resolves CSS color syntax for contrast without rewriting palette values", () => {
  const colors = {
    "--bg": "white", "--surface": "hsl(0, 0%, 100%)", "--code": "rgb(95% 95% 95%)",
    "--border": "#888", "--fg": "midnightblue", "--body": "#333a44",
    "--accent": "deepskyblue", "--accent-strong": "#0af",
  };
  const resolved = {
    white: "#ffffff", "hsl(0, 0%, 100%)": "#ffffff", "rgb(95% 95% 95%)": "#f2f2f2",
    midnightblue: "#191970", deepskyblue: "#00bfff",
  };
  const variables = mermaidThemeVariables(
    { getPropertyValue: (name) => colors[name] || "" },
    (value) => resolved[value] || value,
  );
  assert.equal(variables.person_bg_color, "midnightblue");
  assert.equal(variables.system_bg_color, "#333a44");
  assert.equal(variables.container_bg_color, "#333a44");
  assert.equal(variables.background, "white");
  assert.equal(variables.primaryColor, "hsl(0, 0%, 100%)");
});

test("C4 prefers solid fills and enforces the white-text contrast threshold", () => {
  for (const fill of ["#0000", "#00000000", "rgba(0,0,0,.1)", "rgb(0 0 0 / 10%)", "#777"]) {
    const colors = { "--surface": fill, "--fg": "#15181f", "--body": "#333a44" };
    const variables = mermaidThemeVariables({ getPropertyValue: (name) => colors[name] || "" });
    assert.equal(variables.person_bg_color, "#15181f", fill);
  }
  for (const fill of ["#000f", "#000000ff", "rgb(0% 0% 0% / 100%)", "#767676"]) {
    const colors = { "--surface": fill, "--fg": "#15181f" };
    const variables = mermaidThemeVariables({ getPropertyValue: (name) => colors[name] || "" });
    assert.equal(variables.person_bg_color, fill);
  }
});

test("categorical fills stay distinct and support one foreground across diagram families", () => {
  const luminance = (hex) => [1, 3, 5].reduce((sum, offset, index) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return sum + [0.2126, 0.7152, 0.0722][index] *
      (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  }, 0);
  const contrast = (left, right) =>
    (Math.max(luminance(left), luminance(right)) + 0.05) /
    (Math.min(luminance(left), luminance(right)) + 0.05);
  for (const [background, foreground, accent, surface, code] of [
    ["#0e1117", "#f0f4fa", "#4ea8ff", "#161b22", "#1b2330"],
    ["#ffffff", "#15181f", "#4f46e5", "#ffffff", "#f3f4f6"],
    ["#ffffff", "#201f1e", "#0078d4", "#ffffff", "#f3f2f1"],
    ["#102030", "#fefefe", "#ff9900", "#203040", "#25394d"],
    ["#ffffff", "#15181f", "#008aaa", "#ffffff", "#f3f4f6"],
  ]) {
    const colors = {
      "--bg": background, "--fg": foreground, "--accent": accent,
      "--surface": surface, "--code": code, "--muted": "#888888",
    };
    const theme = mermaidThemeVariables({ getPropertyValue: (name) => colors[name] || "" });
    assert.equal(theme.darkMode, background !== "#ffffff");
    const scales = Array.from({ length: 12 }, (_, index) => theme[`cScale${index}`]);
    assert.equal(new Set(scales).size, 12);
    for (const [index, fill] of scales.entries()) {
      assert.ok(contrast(foreground, fill) >= 4.5, `${foreground} on ${fill}`);
      assert.ok(contrast(background, fill) >= 3, `${fill} against ${background}`);
      assert.equal(theme[`cScaleLabel${index}`], foreground);
      assert.equal(theme[`cScalePeer${index}`], fill);
      assert.equal(theme[`cScaleInv${index}`], colors["--muted"]);
      if (index < 8) assert.equal(theme[`fillType${index}`], fill);
    }
    assert.equal(theme.git0, scales[0]);
    assert.equal(theme.gitBranchLabel0, foreground);
    assert.deepEqual(theme.xyChart.plotColorPalette.split(",").slice(0, 2), [scales[0], foreground]);
    assert.equal(theme.xyChart.backgroundColor, background);
    for (const key of ["titleColor", "xAxisTitleColor", "xAxisLabelColor", "yAxisTitleColor", "yAxisLabelColor"]) {
      assert.equal(theme.xyChart[key], foreground);
    }
    for (const key of ["xAxisTickColor", "xAxisLineColor", "yAxisTickColor", "yAxisLineColor"]) {
      assert.equal(theme.xyChart[key], colors["--muted"]);
    }
    for (const fill of [theme.taskBkgColor, theme.activeTaskBkgColor, theme.doneTaskBkgColor, theme.critBkgColor]) {
      assert.ok(contrast(foreground, fill) >= 4.5, `Gantt ${foreground} on ${fill}`);
    }
    assert.equal(theme.doneTaskBkgColor, code);
    assert.equal(theme.taskTextColor, foreground);
    assert.equal(theme.taskTextDarkColor, foreground);
    assert.equal(theme.taskTextOutsideColor, foreground);
    assert.notEqual(theme.critBkgColor, theme.activeTaskBkgColor);
    assert.notEqual(theme.critBorderColor, theme.activeTaskBorderColor);
  }
});

test("categorical adaptation resolves CSS colors without changing the source palette", () => {
  const colors = { "--bg": "white", "--fg": "midnightblue", "--accent": "teal", "--surface": "white" };
  const resolved = { white: "#ffffff", midnightblue: "#191970", teal: "#008080" };
  const theme = mermaidThemeVariables(
    { getPropertyValue: (name) => colors[name] || "" },
    (value) => resolved[value] || value,
  );
  assert.equal(theme.darkMode, false);
  assert.match(theme.cScale0, /^#[0-9a-f]{6}$/);
  assert.equal(theme.cScaleLabel0, "midnightblue");
  assert.equal(theme.background, "white");
  assert.equal(theme.lineColor, "teal");
  for (const background of ["", "rgba(0,0,0,.5)", "unresolved"]) {
    const fallback = mermaidThemeVariables({
      getPropertyValue: (name) => name === "--bg" ? background : colors[name] || "",
    });
    assert.equal(fallback.cScale0, undefined);
    assert.equal(fallback.background, background);
  }
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
