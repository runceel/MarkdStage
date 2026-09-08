export const BUILTIN_THEMES = new Set(["dark", "light", "microsoft"]);
export const THEMES = new Set([...BUILTIN_THEMES, "custom"]);
export const DEFAULT_THEME = "dark";
export const THEME_METADATA_VERSION = 1;
export const THEME_ASSET_MAX_BYTES = 2 * 1024 * 1024;

const THEME_ASSET_SEGMENT = "[A-Za-z0-9][A-Za-z0-9_-]*(?:\\.[A-Za-z0-9_-]+)*";
const THEME_ASSET_PATTERN = new RegExp(
  `^assets/(?:${THEME_ASSET_SEGMENT}/)*${THEME_ASSET_SEGMENT}\\.(?:svg|png|webp|jpg|jpeg)$`,
  "i",
);

export function normalizeTheme(value) {
  const theme = typeof value === "string" ? value.trim().toLowerCase() : "";
  return THEMES.has(theme) ? theme : DEFAULT_THEME;
}

export function parseFrontMatter(markdown) {
  const meta = {};
  const text = String(markdown ?? "").replace(/\r\n?/g, "\n");
  const trimmed = text.replace(/^[\n \t\uFEFF]+/, "");
  if (!trimmed.startsWith("---\n") && trimmed !== "---") return meta;
  const lines = trimmed.split("\n");
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") break;
    const separator = lines[index].indexOf(":");
    if (separator <= 0) continue;
    const key = lines[index].slice(0, separator).trim();
    const value = lines[index]
      .slice(separator + 1)
      .trim()
      .replace(/^["']+|["']+$/g, "");
    if (key) meta[key] = value;
  }
  return meta;
}

export function resolveFrontMatterTheme(slides) {
  for (const slide of Array.isArray(slides) ? slides : []) {
    const meta = parseFrontMatter(slide);
    if (typeof meta.theme === "string" && meta.theme.trim()) {
      return {
        theme: normalizeTheme(meta.theme),
        themeFile: typeof meta["theme-file"] === "string" ? meta["theme-file"].trim() : "",
      };
    }
    if (typeof meta["theme-file"] === "string" && meta["theme-file"].trim()) {
      return { theme: "custom", themeFile: meta["theme-file"].trim() };
    }
  }
  return { theme: DEFAULT_THEME, themeFile: "" };
}

function stripCssComments(css) {
  return String(css ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
}

export function parseThemeVariables(css) {
  let body = stripCssComments(css).trim();
  if (body.startsWith(":root")) {
    const match = body.match(/^:root\s*\{([\s\S]*)\}\s*$/);
    if (!match) throw new Error("custom theme CSS must contain only a complete :root block");
    body = match[1].trim();
  }
  const variables = {};
  for (const declaration of body.split(";")) {
    const item = declaration.trim();
    if (!item) continue;
    const match = item.match(/^(--[A-Za-z0-9_-]+)\s*:\s*(.+)$/s);
    if (!match) {
      throw new Error("custom theme CSS may contain only --custom-property declarations");
    }
    const value = match[2].trim();
    if (
      !value ||
      /<\/?style\b|@import\b|expression\s*\(|javascript\s*:|url\s*\(/i.test(value)
    ) {
      throw new Error(`custom theme CSS contains an unsafe value for ${match[1]}`);
    }
    variables[match[1]] = value;
  }
  if (Object.keys(variables).length === 0) {
    throw new Error("custom theme CSS must define at least one custom property");
  }
  return variables;
}

export function serializeThemeVariables(variables) {
  return Object.entries(variables)
    .map(([name, value]) => `${name}:${value};`)
    .join("");
}

// Mermaid's "base" theme accepts a `themeVariables` palette instead of one of
// its built-in named themes (dark/default/neutral/forest). Deriving that
// palette from the rendered deck's custom properties makes Mermaid diagrams
// share the slide's background, border, and text colors instead of only
// approximating the deck theme, and it reuses the same primary/secondary
// roles as the Architecture DSL (nodes: surface+border+fg, groups:
// accent-soft+accent-line+accent-strong) so both diagram types match.
//
// `secondaryColor`/`tertiaryColor` also back many categorical fills across
// Mermaid's diagram types (pie slices, git graph nodes, venn/quadrant charts,
// activation highlights, ...), so they must stay solid and clearly visible
// against `--bg` rather than reusing the translucent `--accent-soft` wash or
// `--bg` itself, which rendered those fills nearly invisible. `noteBkgColor`/
// `noteBorderColor`/`noteTextColor` are hardcoded by Mermaid's base theme
// (always a pale yellow) unless set explicitly, so sequence-diagram notes
// need their own override to follow the deck theme too.
export function mermaidThemeVariables(style) {
  const read = (name) => style.getPropertyValue(name).trim();
  const background = read("--bg");
  const surface = read("--surface");
  const code = read("--code");
  const border = read("--border");
  const foreground = read("--fg");
  const muted = read("--muted");
  const body = read("--body");
  const accent = read("--accent");
  const accentStrong = read("--accent-strong");
  const accentSoft = read("--accent-soft");
  const accentLine = read("--accent-line");
  const lightBackground = isLightColor(background);

  // C4 text is white unless the source explicitly supplies a font color. Keep
  // its themed fills dark enough for that renderer default on light themes,
  // while retaining several distinct roles for people, systems, containers,
  // and components.
  const c4Colors = lightBackground
    ? [foreground, accentStrong, accent, body]
    : [surface, code, border, background];
  const [c4Person, c4System, c4Container, c4Component] = c4Colors;
  const c4External = lightBackground ? foreground : code;
  const c4ExternalAlt = lightBackground ? body : background;

  return {
    background,
    primaryColor: surface,
    primaryTextColor: foreground,
    primaryBorderColor: border,
    secondaryColor: accentStrong,
    secondaryTextColor: background,
    secondaryBorderColor: accentLine,
    tertiaryColor: muted,
    tertiaryTextColor: background,
    tertiaryBorderColor: border,
    lineColor: accent,
    textColor: foreground,
    mainBkg: surface,
    nodeBorder: border,
    clusterBkg: accentSoft,
    clusterBorder: accentLine,
    titleColor: foreground,
    edgeLabelBackground: background,
    noteBkgColor: accentSoft,
    noteBorderColor: accentLine,
    noteTextColor: accentStrong,
    pie1: accent,

    // C4's documented shape variables are read by its renderer, unlike the
    // generic primary/secondary roles above. The database and queue variants
    // intentionally follow their containing shape's semantic color.
    person_bg_color: c4Person,
    person_border_color: foreground,
    external_person_bg_color: c4External,
    external_person_border_color: foreground,
    system_bg_color: c4System,
    system_border_color: foreground,
    system_db_bg_color: c4System,
    system_db_border_color: foreground,
    system_queue_bg_color: c4System,
    system_queue_border_color: foreground,
    external_system_bg_color: c4External,
    external_system_border_color: foreground,
    external_system_db_bg_color: c4External,
    external_system_db_border_color: foreground,
    external_system_queue_bg_color: c4External,
    external_system_queue_border_color: foreground,
    container_bg_color: c4Container,
    container_border_color: foreground,
    container_db_bg_color: c4Container,
    container_db_border_color: foreground,
    container_queue_bg_color: c4Container,
    container_queue_border_color: foreground,
    external_container_bg_color: c4ExternalAlt,
    external_container_border_color: foreground,
    external_container_db_bg_color: c4ExternalAlt,
    external_container_db_border_color: foreground,
    external_container_queue_bg_color: c4ExternalAlt,
    external_container_queue_border_color: foreground,
    component_bg_color: c4Component,
    component_border_color: foreground,
    component_db_bg_color: c4Component,
    component_db_border_color: foreground,
    component_queue_bg_color: c4Component,
    component_queue_border_color: foreground,
    external_component_bg_color: c4ExternalAlt,
    external_component_border_color: foreground,
    external_component_db_bg_color: c4ExternalAlt,
    external_component_db_border_color: foreground,
    external_component_queue_bg_color: c4ExternalAlt,
    external_component_queue_border_color: foreground,

    // Architecture-beta exposes these roles directly in its SVG CSS.
    archEdgeColor: accent,
    archEdgeArrowColor: accent,
    archGroupBorderColor: accent,
    archGroupBorderWidth: "1",

    // Event Modeling exposes a fill/stroke pair for each entity kind and
    // separate roles for lanes and relations.
    emUiFill: surface,
    emUiStroke: accent,
    emProcessorFill: accentSoft,
    emProcessorStroke: accent,
    emReadModelFill: code,
    emReadModelStroke: accentStrong,
    emCommandFill: background,
    emCommandStroke: accent,
    emEventFill: accentLine,
    emEventStroke: accentStrong,
    emSwimlaneBackgroundOdd: accentSoft,
    emSwimlaneBackgroundStroke: accent,
    emArrowhead: accent,
    emRelationStroke: accent,
    attributeBackgroundColorOdd: surface,
    attributeBackgroundColorEven: code,
  };
}

const C4_THEME_VARIABLE = /^(?:external_)?(?:person|system|container|component)(?:_(?:db|queue))?_(?:bg|border)_color$/;

export function mermaidC4ThemeVariables(themeVariables) {
  return Object.fromEntries(
    Object.entries(themeVariables).filter(([name]) => C4_THEME_VARIABLE.test(name)),
  );
}

function isLightColor(value) {
  const match = String(value || "").match(
    /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$|^rgba?\(\s*([0-9.]+%?)\s*,\s*([0-9.]+%?)\s*,\s*([0-9.]+%?)/i,
  );
  if (!match) return false;
  const channels = match[1]
    ? (match[1].length <= 4
        ? [...match[1].slice(0, 3)].map((channel) => Number.parseInt(channel + channel, 16))
        : [0, 2, 4].map((index) => Number.parseInt(match[1].slice(index, index + 2), 16)))
    : match.slice(2, 5).map((channel) => {
        const numeric = Number.parseFloat(channel);
        return channel.endsWith("%") ? numeric * 2.55 : numeric;
      });
  const luminance = channels.reduce(
    (sum, channel, index) => sum + [0.2126, 0.7152, 0.0722][index] * relativeLuminance(channel),
    0,
  );
  return luminance > 0.5;
}

function relativeLuminance(channel) {
  const normalized = Math.max(0, Math.min(255, channel)) / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function assertPlainObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value;
}

function assertOnlyKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${path}.${key} is not supported`);
  }
}

function parseImage(value, path, { altRequired = false } = {}) {
  const image = assertPlainObject(value, path);
  assertOnlyKeys(image, new Set(["image", "alt"]), path);
  if (
    typeof image.image !== "string" ||
    image.image.length > 200 ||
    !THEME_ASSET_PATTERN.test(image.image)
  ) {
    throw new Error(
      `${path}.image must be a safe path under the theme assets/ folder using svg, png, webp, jpg, or jpeg`,
    );
  }
  if (image.alt !== undefined && typeof image.alt !== "string") {
    throw new Error(`${path}.alt must be a string`);
  }
  const alt = typeof image.alt === "string" ? image.alt.trim() : "";
  if (altRequired && !alt) throw new Error(`${path}.alt must be a non-empty string`);
  return { image: image.image, ...(alt ? { alt } : {}) };
}

export function parseThemeMetadata(value) {
  const metadata = typeof value === "string" ? JSON.parse(value) : value;
  const root = assertPlainObject(metadata, "theme metadata");
  assertOnlyKeys(
    root,
    new Set(["$schema", "version", "background", "layouts", "cover", "backcover"]),
    "theme metadata",
  );
  if (root.version !== THEME_METADATA_VERSION) {
    throw new Error(`theme metadata version must be ${THEME_METADATA_VERSION}`);
  }

  const result = { version: THEME_METADATA_VERSION };
  if (root.background !== undefined) {
    result.background = parseImage(root.background, "background");
  }
  if (root.layouts !== undefined) {
    const layouts = assertPlainObject(root.layouts, "layouts");
    assertOnlyKeys(layouts, new Set(["default", "center"]), "layouts");
    result.layouts = {};
    for (const layout of ["default", "center"]) {
      if (layouts[layout] === undefined) continue;
      const entry = assertPlainObject(layouts[layout], `layouts.${layout}`);
      assertOnlyKeys(entry, new Set(["background"]), `layouts.${layout}`);
      if (entry.background !== undefined) {
        result.layouts[layout] = {
          background: parseImage(entry.background, `layouts.${layout}.background`),
        };
      }
    }
    if (Object.keys(result.layouts).length === 0) delete result.layouts;
  }
  if (root.cover !== undefined) {
    const cover = assertPlainObject(root.cover, "cover");
    assertOnlyKeys(cover, new Set(["background", "logo"]), "cover");
    result.cover = {};
    if (cover.background !== undefined) {
      result.cover.background = parseImage(cover.background, "cover.background");
    }
    if (cover.logo !== undefined) {
      result.cover.logo = parseImage(cover.logo, "cover.logo", { altRequired: true });
    }
    if (Object.keys(result.cover).length === 0) delete result.cover;
  }

  if (root.backcover !== undefined) {
    const backcover = assertPlainObject(root.backcover, "backcover");
    assertOnlyKeys(backcover, new Set(["logo", "copyright"]), "backcover");
    result.backcover = {};
    if (backcover.logo !== undefined) {
      result.backcover.logo = parseImage(backcover.logo, "backcover.logo", {
        altRequired: true,
      });
    }
    if (backcover.copyright !== undefined) {
      if (typeof backcover.copyright !== "string") {
        throw new Error("backcover.copyright must be a string");
      }
      result.backcover.copyright = backcover.copyright;
    }
    if (Object.keys(result.backcover).length === 0) delete result.backcover;
  }
  return result;
}

export function resolveThemeBackground(metadata, layout) {
  const normalized = typeof layout === "string" ? layout.trim().toLowerCase() : "";
  if (normalized === "title") return metadata?.cover?.background;
  if (normalized === "section" || normalized === "backcover") return undefined;
  const key = normalized === "center" ? "center" : "default";
  return metadata?.layouts?.[key]?.background ?? metadata?.background;
}

export function themeMetadataAssetPaths(metadata) {
  const paths = [];
  const add = (entry) => {
    if (entry?.image && !paths.includes(entry.image)) paths.push(entry.image);
  };
  add(metadata?.cover?.background);
  add(metadata?.cover?.logo);
  add(metadata?.backcover?.logo);
  add(metadata?.background);
  add(metadata?.layouts?.default?.background);
  add(metadata?.layouts?.center?.background);
  return paths;
}

export function mapThemeMetadataAssets(metadata, mapAsset) {
  const mapped = new Map();
  const mapImage = (entry) => {
    if (!entry) return undefined;
    if (!mapped.has(entry.image)) mapped.set(entry.image, mapAsset(entry.image));
    return { ...entry, image: mapped.get(entry.image) };
  };
  return {
    version: metadata.version,
    ...(metadata.background ? { background: mapImage(metadata.background) } : {}),
    ...(metadata.layouts
      ? {
          layouts: Object.fromEntries(
            ["default", "center"]
              .filter((layout) => metadata.layouts[layout])
              .map((layout) => [
                layout,
                metadata.layouts[layout].background
                  ? { background: mapImage(metadata.layouts[layout].background) }
                  : {},
              ]),
          ),
        }
      : {}),
    ...(metadata.cover
      ? {
          cover: {
            ...(metadata.cover.background
              ? { background: mapImage(metadata.cover.background) }
              : {}),
            ...(metadata.cover.logo ? { logo: mapImage(metadata.cover.logo) } : {}),
          },
        }
      : {}),
    ...(metadata.backcover
      ? {
          backcover: {
            ...(metadata.backcover.logo
              ? { logo: mapImage(metadata.backcover.logo) }
              : {}),
            ...("copyright" in metadata.backcover
              ? { copyright: metadata.backcover.copyright }
              : {}),
          },
        }
      : {}),
  };
}
