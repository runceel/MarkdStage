// Import a diagram exported by Archify (https://github.com/tt-a1i/archify) into
// the shared scene graph.
//
// This reads Archify's *published SVG contract* and nothing else: the semantic
// classes (`c-*` component kinds, `t-*` text tones, `a-*` arrow tones) and the
// `data-*` hooks every Archify renderer is required to emit. Those are what the
// project documents and tests; the rest of the export - its CSS custom properties,
// preset styling, embedded web font and interaction-only rules - is deliberately
// ignored. Reading only the contract is what keeps this file small: the geometry
// arrives pre-computed, so there is no layout engine to maintain and a new Archify
// preset or diagram type needs no change here.
//
// The import is a repaint, not a copy. Archify's own colours are discarded and the
// diagram is redrawn from the deck's theme tokens (see derivePalette), so an
// imported diagram matches the surrounding slides on every theme and exports to
// PowerPoint as native shapes instead of a flat picture.

import { createScene, MAX_SCENE_NODES } from "./scene-graph.mjs";
import { builtinIconSvg } from "./architecture.mjs";
import {
  contrastRatio,
  ensureContrast,
  formatHex,
  mixOklab,
  oklchToRgb,
  parseRgb,
  rgbToOklch,
} from "./oklch.mjs";

export class ArchifyError extends Error {
  constructor(message) {
    super(message);
    this.name = "ArchifyError";
  }
}

/** An Archify export of a realistic diagram is ~150 KB, mostly its embedded font. */
export const MAX_ARCHIFY_SVG_BYTES = 4 * 1024 * 1024;
export const MAX_ARCHIFY_SOURCE_LENGTH = 4096;

const ASSET_PATH_PATTERN = /^assets\/(?:[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*\/)*[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*\.[Ss][Vv][Gg]$/;

/**
 * Archify's component kinds, in the order used to spread them around the hue
 * circle. `external` is intentionally last and is rendered as a neutral so that
 * third-party boxes recede behind the system being described.
 */
const COMPONENT_KINDS = Object.freeze([
  "frontend",
  "backend",
  "database",
  "cloud",
  "security",
  "messagebus",
  "external",
]);

/**
 * Hue offsets from the deck accent, in OKLCh degrees.
 *
 * `backend` sits on the accent itself so the most common component kind is the
 * deck's own colour. The others are spaced widely enough to stay distinguishable
 * after the contrast pass, and `security` keeps a warm offset because Archify uses
 * it for trust boundaries, where a warning tone reads correctly.
 */
const KIND_HUE_OFFSETS = Object.freeze({
  backend: 0,
  frontend: 155,
  database: 55,
  cloud: -55,
  security: 110,
  messagebus: -110,
  external: null,
});

/** Archify's `data-semantic-sigil` kinds mapped onto MarkdStage's built-in icons. */
const SIGIL_ICONS = Object.freeze({
  frontend: "browser",
  backend: "api",
  database: "database",
  cloud: "cloud",
  security: "shield",
  messagebus: "queue",
  external: "external",
  start: "start",
  active: "activity",
  waiting: "waiting",
  success: "success",
  failure: "failure",
  neutral: "component",
});

/**
 * Archify's `s-*` tone classes say which component colour a sigil borrows. A sigil
 * whose tone class is missing falls back to the muted text colour.
 */
const SIGIL_TONES = Object.freeze({
  "s-frontend": "frontend",
  "s-backend": "backend",
  "s-database": "database",
  "s-cloud": "cloud",
  "s-security": "security",
  "s-messagebus": "messagebus",
  "s-external": "external",
});

/**
 * Minimum contrast against the diagram surface.
 *
 * Strokes and label text carry meaning and are held to the WCAG AA ratio for
 * non-text graphics and small text respectively. Frame outlines are structural
 * hints, so a lower ratio keeps them from competing with the components inside.
 */
const MIN_STROKE_CONTRAST = 3;
const MIN_TEXT_CONTRAST = 4.5;
const MIN_FRAME_CONTRAST = 1.6;

/** How far a component fill is mixed from the surface towards its own stroke. */
const FILL_MIX = 0.18;

/**
 * Semantic class -> palette role.
 *
 * Anything absent here is reported as a diagnostic rather than guessed at, so a
 * future Archify class shows up as a named gap instead of silently vanishing.
 */
const TEXT_ROLES = Object.freeze({
  "t-primary": "text",
  "t-muted": "textMuted",
  "t-dim": "textDim",
});

const ARROW_ROLES = Object.freeze({
  "a-default": { stroke: "arrow" },
  "a-emphasis": { stroke: "arrowEmphasis" },
  "a-security": { stroke: "securityStroke", dash: "dash" },
  "a-dashed": { stroke: "arrowMuted", dash: "dash" },
});

const FRAME_ROLES = Object.freeze({
  "c-region": { stroke: "cloudStroke", dash: "dash" },
  "c-security-group": { stroke: "securityStroke", dash: "dash" },
  "c-lane": { stroke: "frame", dash: "solid" },
});

/** Classes that exist only to paint Archify's own canvas; MarkdStage supplies its own. */
const IGNORED_CLASSES = new Set(["c-bg-rect", "c-grid"]);

function kindRole(kind, suffix) {
  return `${kind}${suffix}`;
}

/**
 * Build the diagram palette from the deck's resolved theme tokens.
 *
 * Category colours are generated by rotating the accent's hue in OKLCh while
 * keeping its lightness and chroma. Because OKLCh is perceptually uniform, every
 * derived colour keeps the accent's perceived brightness and colourfulness - the
 * naive HSL equivalent turns a vivid accent into neon and a muted accent into mud.
 * Each colour then passes a contrast check against the surface so that a theme with
 * an unusually light or dark accent still produces a readable diagram.
 */
export function derivePalette(tokens = {}) {
  const surface = parseRgb(tokens.surface) || [255, 255, 255];
  const accent = parseRgb(tokens.accent) || [64, 128, 224];
  const accentStrong = parseRgb(tokens.accentStrong) || accent;
  const foreground = parseRgb(tokens.fg) || [17, 17, 17];
  const muted = parseRgb(tokens.muted) || mixOklab(surface, foreground, 0.6);
  const border = parseRgb(tokens.border) || mixOklab(surface, foreground, 0.25);
  const { L, C, h } = rgbToOklch(accent);
  // A near-grey accent has no usable hue to rotate; widen the chroma so the derived
  // family is still separable instead of producing seven identical greys.
  const chroma = Math.max(C, 0.08);

  const palette = {
    surface: formatHex(surface),
    text: formatHex(ensureContrast(foreground, surface, MIN_TEXT_CONTRAST)),
    textMuted: formatHex(ensureContrast(muted, surface, MIN_TEXT_CONTRAST)),
    textDim: formatHex(ensureContrast(muted, surface, MIN_STROKE_CONTRAST)),
    frame: formatHex(ensureContrast(border, surface, MIN_FRAME_CONTRAST)),
    arrow: formatHex(ensureContrast(muted, surface, MIN_STROKE_CONTRAST)),
    arrowMuted: formatHex(ensureContrast(border, surface, MIN_STROKE_CONTRAST)),
    arrowEmphasis: formatHex(ensureContrast(accentStrong, surface, MIN_STROKE_CONTRAST)),
  };
  for (const kind of COMPONENT_KINDS) {
    const offset = KIND_HUE_OFFSETS[kind];
    const base = offset === null
      ? ensureContrast(muted, surface, MIN_STROKE_CONTRAST)
      : ensureContrast(oklchToRgb({ L, C: chroma, h: h + offset }), surface, MIN_STROKE_CONTRAST);
    palette[kindRole(kind, "Stroke")] = formatHex(base);
    palette[kindRole(kind, "Fill")] = formatHex(mixOklab(surface, base, FILL_MIX));
  }
  // Text tinted with a component colour appears in two places: inside the
  // component, over its fill, and on a connector-label plate, over the surface.
  // Both backgrounds must clear the small-text ratio, so the colour is checked
  // against each in turn.
  for (const kind of COMPONENT_KINDS) {
    const fill = parseRgb(palette[kindRole(kind, "Fill")]);
    const stroke = parseRgb(palette[kindRole(kind, "Stroke")]);
    palette[kindRole(kind, "Text")] = formatHex(
      ensureContrast(ensureContrast(stroke, fill, MIN_TEXT_CONTRAST), surface, MIN_TEXT_CONTRAST),
    );
  }
  return palette;
}

function classList(element) {
  const value = element.getAttribute?.("class");
  return typeof value === "string" ? value.split(/\s+/).filter(Boolean) : [];
}

function firstClass(element, table) {
  for (const name of classList(element)) {
    if (Object.hasOwn(table, name)) return table[name];
  }
  return undefined;
}

function componentKind(element, prefix = "c-") {
  for (const name of classList(element)) {
    if (name.startsWith(prefix)) {
      const kind = name.slice(prefix.length);
      if (COMPONENT_KINDS.includes(kind)) return kind;
    }
  }
  return undefined;
}

/**
 * Archify renders markers and the background grid inside `<defs>`. They are
 * templates rather than drawn content, so importing them would duplicate every
 * arrowhead and paint a grid the deck theme does not want.
 */
function isTemplateContent(element) {
  return Boolean(element.closest?.("defs, marker, pattern, clipPath, mask, symbol"));
}

function number(element, name, fallback = 0) {
  const value = Number(element.getAttribute?.(name));
  return Number.isFinite(value) ? value : fallback;
}

function box(element) {
  return {
    x: number(element, "x"),
    y: number(element, "y"),
    width: number(element, "width"),
    height: number(element, "height"),
  };
}

function sameBox(left, right) {
  const a = box(left);
  const b = box(right);
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Parse `data-composition-points`: Archify's authored polyline, `x,y;x,y;...`.
 *
 * Using the published point list rather than re-parsing the `d` attribute means
 * curved or otherwise decorated routes still import as the straight segments the
 * author actually specified.
 */
function parseCompositionPoints(value) {
  const points = [];
  for (const pair of String(value).split(";")) {
    const [x, y] = pair.split(",").map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const previous = points.at(-1);
    if (previous && previous.x === x && previous.y === y) continue;
    points.push({ x, y });
  }
  return points.length >= 2 ? points : null;
}

/** Parse a path `d` built only from absolute move/line commands. */
function parseStraightPath(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const points = [];
  for (const segment of text.split(/(?=[A-Za-z])/)) {
    const command = segment.trim()[0];
    if (command !== "M" && command !== "L") return null;
    const values = segment.slice(1).trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (values.length !== 2 || values.some((entry) => !Number.isFinite(entry))) return null;
    points.push({ x: values[0], y: values[1] });
  }
  return points.length >= 2 ? points : null;
}

/**
 * Archify's text is plain `<text>` with an explicit font-size and anchor, so the
 * label box has to be reconstructed. The estimate is deliberately generous: scene
 * text is not clipped, and a box slightly wider than the glyphs keeps centred
 * labels centred while giving PowerPoint room to re-shape the run in its own font.
 */
const AVERAGE_GLYPH_RATIO = 0.62;
const LINE_HEIGHT_RATIO = 1.35;

function textAlignment(element) {
  return { middle: "center", end: "right" }[element.getAttribute?.("text-anchor")] || "left";
}

function svgDataUrl(markup) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

/**
 * Convert a parsed Archify SVG export into a shared scene.
 *
 * @param {Element} svg Root `<svg>` element of an Archify export.
 * @param {{palette: object, fontFace?: string, path?: string}} options
 * @returns {{scene: object, diagnostics: Array<{reason: string, detail: string}>}}
 */
export function archifySvgToScene(svg, { palette, fontFace, path = "archify" } = {}) {
  if (!svg || typeof svg.querySelectorAll !== "function") {
    throw new ArchifyError("Archify import requires a parsed SVG element");
  }
  if (!palette) throw new ArchifyError("Archify import requires a palette");
  const viewBox = String(svg.getAttribute("viewBox") || "").trim().split(/\s+/).map(Number);
  if (viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value))) {
    throw new ArchifyError("Archify SVG is missing a numeric viewBox");
  }
  const [, , width, height] = viewBox;
  if (!(width > 0 && height > 0)) throw new ArchifyError("Archify SVG viewBox has no area");

  const diagnostics = [];
  const nodes = [];
  const report = (reason, detail) => diagnostics.push({ reason, detail: String(detail ?? "") });
  const push = (node) => {
    if (nodes.length >= MAX_SCENE_NODES) return false;
    nodes.push({ ...node, z: nodes.length });
    return true;
  };
  const colour = (role) => (role ? palette[role] || null : null);

  // Archify paints an opaque `c-mask` plate underneath translucent artwork so its
  // background grid does not show through. Two kinds exist and they need opposite
  // treatment:
  //   - under a component body, the plate is redundant here (the repaint uses
  //     opaque fills and drops the grid), so it is folded away to halve the shape
  //     count in PowerPoint and avoid a doubled outline;
  //   - behind a connector label, the plate is the label's backplate and must
  //     survive, otherwise the text sits directly on the line it annotates.
  const redundantMasks = new Set();
  for (const mask of svg.querySelectorAll("rect.c-mask")) {
    const sibling = mask.nextElementSibling;
    if (sibling?.localName === "rect" && sameBox(mask, sibling) && componentKind(sibling)) {
      redundantMasks.add(mask);
    }
  }

  // 1. Structural frames first: regions, trust boundaries, lanes, stages and
  //    segments all sit behind the components they contain.
  for (const frame of svg.querySelectorAll('[data-graph-role="structural-frame"]')) {
    const role = firstClass(frame, FRAME_ROLES);
    if (!role) {
      report("unsupported-frame-class", frame.getAttribute("class"));
      continue;
    }
    const id = frame.getAttribute("data-composition-frame-id");
    push({
      kind: "shape",
      preset: "roundedRect",
      sourcePath: `frames[${id ?? nodes.length}]`,
      bounds: box(frame),
      style: {
        fill: null,
        stroke: colour(role.stroke),
        strokeWidth: number(frame, "stroke-width", 1),
        dash: role.dash,
        cornerRadius: number(frame, "rx", 0),
      },
      accessibility: { title: frame.getAttribute("data-composition-frame-label") || "" },
    });
  }

  // 2. Connections. Every Archify renderer publishes the authored polyline on the
  //    element carrying the geometry, while the edge identity may live on an
  //    enclosing group, so the identity is looked up from the nearest ancestor.
  for (const edge of svg.querySelectorAll("[data-composition-points]")) {
    if (isTemplateContent(edge)) continue;
    const role = firstClass(edge, ARROW_ROLES);
    if (!role) {
      report("unsupported-edge-class", edge.getAttribute("class"));
      continue;
    }
    const points = parseCompositionPoints(edge.getAttribute("data-composition-points"));
    if (!points) {
      report("unreadable-edge-points", edge.getAttribute("data-composition-points"));
      continue;
    }
    const owner = edge.closest?.("[data-edge-id]") || edge;
    push({
      kind: "connector",
      sourcePath: `edges[${owner.getAttribute("data-edge-key") ?? nodes.length}]`,
      points,
      arrowStart: "none",
      arrowEnd: edge.hasAttribute("marker-end") ? "triangle" : "none",
      style: {
        stroke: colour(role.stroke),
        strokeWidth: number(edge, "stroke-width", 1.4),
        dash: edge.getAttribute("stroke-dasharray") ? "dot" : role.dash,
        lineCap: "round",
      },
      accessibility: { title: owner.getAttribute("data-edge-label") || "" },
    });
  }

  // 3. Rules drawn without edge identity: sequence lifelines and legend keys.
  for (const rule of svg.querySelectorAll("path:not([data-composition-points]), line:not([data-composition-points])")) {
    if (rule.closest?.(".semantic-sigil") || isTemplateContent(rule)) continue;
    if (classList(rule).some((name) => IGNORED_CLASSES.has(name))) continue;
    const role = firstClass(rule, ARROW_ROLES);
    if (!role) {
      report("unsupported-rule-class", rule.getAttribute("class"));
      continue;
    }
    const points = rule.localName === "line"
      ? [
        { x: number(rule, "x1"), y: number(rule, "y1") },
        { x: number(rule, "x2"), y: number(rule, "y2") },
      ]
      : parseStraightPath(rule.getAttribute("d"));
    if (!points) {
      report("unsupported-rule-geometry", rule.getAttribute("d"));
      continue;
    }
    push({
      kind: "connector",
      sourcePath: `rules[${nodes.length}]`,
      points,
      arrowStart: "none",
      arrowEnd: rule.hasAttribute("marker-end") ? "triangle" : "none",
      style: {
        stroke: colour(role.stroke),
        strokeWidth: number(rule, "stroke-width", 1),
        dash: rule.getAttribute("stroke-dasharray") ? "dot" : role.dash,
        lineCap: "round",
      },
    });
  }

  // 4. Component bodies, legend swatches and the surviving label backplates.
  for (const rect of svg.querySelectorAll("rect")) {
    if (rect.hasAttribute("data-graph-role") || redundantMasks.has(rect)) continue;
    if (rect.closest?.(".semantic-sigil") || isTemplateContent(rect)) continue;
    const names = classList(rect);
    if (names.some((name) => IGNORED_CLASSES.has(name))) continue;
    // Archify's canvas wash is a percentage-sized rect painted with the grid
    // pattern. It has no diagram meaning and cannot be placed in scene units.
    const bounds = box(rect);
    if (!(bounds.width > 0 && bounds.height > 0)) continue;
    const kind = componentKind(rect);
    const isLabelPlate = names.includes("c-mask");
    if (!kind && !isLabelPlate) {
      report("unsupported-shape-class", rect.getAttribute("class"));
      continue;
    }
    push({
      kind: "shape",
      preset: "roundedRect",
      sourcePath: `shapes[${nodes.length}]`,
      bounds,
      style: {
        fill: isLabelPlate ? colour("surface") : colour(kindRole(kind, "Fill")),
        stroke: isLabelPlate ? null : colour(kindRole(kind, "Stroke")),
        strokeWidth: isLabelPlate ? 0 : number(rect, "stroke-width", 1.2),
        cornerRadius: number(rect, "rx", 0),
      },
      accessibility: { title: rect.closest?.("[data-node-label]")?.getAttribute("data-node-label") || "" },
    });
  }

  // 5. Role sigils. Archify draws them as inline line art with no stable geometry
  //    contract, so only the published `data-semantic-sigil` kind is consumed and
  //    the artwork is replaced with MarkdStage's own icon for that role. That keeps
  //    the role marker visible without importing shapes this file cannot theme.
  for (const sigil of svg.querySelectorAll("[data-semantic-sigil]")) {
    const iconName = SIGIL_ICONS[sigil.getAttribute("data-semantic-sigil")];
    if (!iconName) {
      report("unsupported-sigil-kind", sigil.getAttribute("data-semantic-sigil"));
      continue;
    }
    const bounds = sigilBounds(sigil);
    if (!bounds) {
      report("unreadable-sigil-transform", sigil.getAttribute("transform"));
      continue;
    }
    const tone = firstClass(sigil, SIGIL_TONES);
    const markup = builtinIconSvg(iconName, colour(tone ? kindRole(tone, "Stroke") : "textMuted"));
    if (!markup) {
      report("unsupported-sigil-icon", iconName);
      continue;
    }
    push({
      kind: "image",
      sourcePath: `sigils[${nodes.length}]`,
      bounds,
      src: svgDataUrl(markup),
      alt: "",
      fit: "contain",
    });
  }

  // 6. Labels last so they are never covered by artwork.
  for (const text of svg.querySelectorAll("text")) {
    if (isTemplateContent(text)) continue;
    const content = (text.textContent || "").trim();
    if (!content) continue;
    // `t-primary` / `t-muted` / `t-dim` are tone names; `t-<kind>` borrows a
    // component colour, which Archify uses for labels that annotate that component.
    const textKind = componentKind(text, "t-");
    const role = firstClass(text, TEXT_ROLES)
      || (textKind ? kindRole(textKind, "Text") : undefined);
    if (!role) {
      report("unsupported-text-class", text.getAttribute("class"));
      continue;
    }
    const fontSize = number(text, "font-size", 11);
    const alignment = textAlignment(text);
    const boxWidth = Math.max(content.length * fontSize * AVERAGE_GLYPH_RATIO, fontSize);
    const anchorX = number(text, "x");
    push({
      kind: "text",
      sourcePath: `labels[${nodes.length}]`,
      bounds: {
        x: alignment === "center" ? anchorX - boxWidth / 2 : alignment === "right" ? anchorX - boxWidth : anchorX,
        // `y` is the text baseline; the box starts roughly one ascender above it.
        y: number(text, "y") - fontSize,
        width: boxWidth,
        height: fontSize * LINE_HEIGHT_RATIO,
      },
      text: {
        paragraphs: [{
          alignment,
          runs: [{
            text: content,
            fontSize,
            ...(fontFace ? { fontFace } : {}),
            fontWeight: number(text, "font-weight", 400),
            color: colour(role),
          }],
        }],
      },
      textLayout: { alignment, verticalAlignment: "middle", textWrap: "none" },
    });
  }

  if (nodes.length >= MAX_SCENE_NODES) {
    report("scene-node-limit-reached", String(MAX_SCENE_NODES));
  }

  const scene = createScene({
    width,
    height,
    source: { kind: "architecture", path },
    accessibility: {
      title: svg.querySelector("title")?.textContent?.trim() || "Imported diagram",
      description: svg.querySelector("desc")?.textContent?.trim() || "",
    },
    nodes,
  });
  return { scene, diagnostics };
}

/**
 * Read a sigil's placement from its `translate(x y) scale(s)` transform.
 *
 * Archify emits exactly this form for sigils, and the shapes inside are authored
 * on a 16x16 grid. Anything else is reported rather than approximated.
 */
function sigilBounds(sigil) {
  const transform = String(sigil.getAttribute("transform") || "");
  const match = transform.match(
    /^translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)\s*scale\(\s*(-?[\d.]+)\s*\)$/,
  );
  if (!match) return null;
  const [x, y, scale] = match.slice(1, 4).map(Number);
  if (![x, y, scale].every(Number.isFinite) || scale <= 0) return null;
  const size = 16 * scale;
  return { x, y, width: size, height: size };
}

/**
 * Parse the body of an ```archify fence.
 *
 * The fence names one SVG file: Archify is an agent skill, so in practice the
 * agent writes the export into `assets/` and adds this one line. Keeping the fence
 * to a bare path means there is no second dialect to learn or to keep in step with
 * Archify's own options.
 */
export function parseArchifySource(source) {
  const text = String(source ?? "");
  if (text.length > MAX_ARCHIFY_SOURCE_LENGTH) {
    throw new ArchifyError(`archify block exceeds ${MAX_ARCHIFY_SOURCE_LENGTH} characters`);
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (lines.length === 0) {
    throw new ArchifyError("archify block must name an SVG file under assets/");
  }
  if (lines.length > 1) {
    throw new ArchifyError("archify block must contain exactly one asset path");
  }
  const [src] = lines;
  if (!ASSET_PATH_PATTERN.test(src)) {
    throw new ArchifyError(
      `"${src}" must be a path to an .svg file under assets/, without "." or ".." segments`,
    );
  }
  return { src };
}

/**
 * Parse SVG markup exported by Archify.
 *
 * Uses DOMParser rather than innerHTML so the markup is never attached to the
 * live document, and rejects parser errors instead of rendering a partial tree.
 */
export function parseArchifySvg(markup, { document: documentRef = globalThis.document } = {}) {
  if (typeof markup !== "string" || !markup.trim()) {
    throw new ArchifyError("Archify SVG file is empty");
  }
  const Parser = documentRef?.defaultView?.DOMParser || globalThis.DOMParser;
  if (!Parser) throw new ArchifyError("Archify import requires a DOMParser");
  const parsed = new Parser().parseFromString(markup, "image/svg+xml");
  if (parsed.querySelector("parsererror")) throw new ArchifyError("Archify SVG file is not valid XML");
  const svg = parsed.documentElement;
  if (svg?.localName !== "svg") throw new ArchifyError("Archify file does not contain an <svg> root");
  return svg;
}

export const ARCHIFY_ASSET_PATH_PATTERN = ASSET_PATH_PATTERN;
export const ARCHIFY_COMPONENT_KINDS = COMPONENT_KINDS;
export const ARCHIFY_SIGIL_ICONS = SIGIL_ICONS;
