import {
  MAX_CONNECTOR_POINTS,
  MAX_GROUP_DEPTH,
  MAX_SCENE_NODES,
  MAX_TEXT_PARAGRAPHS,
  MAX_TEXT_RUNS,
  createScene,
  normalizeRotationAngle,
  normalizeScene,
  validateScene,
} from "./scene-graph.mjs";

export const DEFAULT_MERMAID_SCENE_OPTIONS = Object.freeze({
  path: "mermaid.svg",
  simplifyTolerance: 2,
  sampleStep: 4,
});

const SVG_NS = "http://www.w3.org/2000/svg";
const SHAPE_TAGS = new Set(["rect", "circle", "ellipse", "polygon"]);
const IGNORED_TAGS = new Set([
  "defs",
  "desc",
  "feDropShadow",
  "filter",
  "linearGradient",
  "marker",
  "metadata",
  "script",
  "stop",
  "style",
  "title",
]);
const VISUAL_TAGS = new Set([
  "circle",
  "ellipse",
  "foreignObject",
  "image",
  "line",
  "path",
  "polygon",
  "polyline",
  "rect",
  "text",
  "use",
]);
const LINE_CAPS = new Set(["butt", "round", "square"]);
const SEQUENCE_FRAME_KINDS = new Set(["loop", "alt", "opt", "par"]);

function finiteNumberOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nonEmptyStringOr(value, fallback) {
  return typeof value === "string" && value ? value : fallback;
}

function roundedMetric(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

export function decomposeSimpleSvgTransform(matrix, tolerance = 0.001) {
  if (!matrix || !["a", "b", "c", "d", "e", "f"].every((key) =>
    typeof matrix[key] === "number" && Number.isFinite(matrix[key]))) return null;
  const scaleX = Math.hypot(matrix.a, matrix.b);
  const scaleY = Math.hypot(matrix.c, matrix.d);
  const scale = (scaleX + scaleY) / 2;
  const relativeTolerance = Math.max(0, finiteNumberOr(tolerance, 0.001));
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  const dot = matrix.a * matrix.c + matrix.b * matrix.d;
  if (!(scale > 0) || determinant <= 0 ||
      Math.abs(scaleX - scaleY) > relativeTolerance * Math.max(scaleX, scaleY) ||
      Math.abs(dot) > relativeTolerance * scaleX * scaleY) return null;
  const rotation = normalizeRotationAngle(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI);
  if (rotation === null) return null;
  const radians = rotation * Math.PI / 180;
  const cosine = Math.cos(radians) * scale;
  const sine = Math.sin(radians) * scale;
  const reconstructionTolerance = relativeTolerance * Math.max(1, scale);
  if (Math.max(
    Math.abs(matrix.a - cosine),
    Math.abs(matrix.b - sine),
    Math.abs(matrix.c + sine),
    Math.abs(matrix.d - cosine),
  ) > reconstructionTolerance) return null;
  return { rotation, scale };
}

function definedEntries(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function tagName(element) {
  return element?.tagName || "";
}

function localName(element) {
  return element?.localName || tagName(element);
}

function hasClass(element, name) {
  return Boolean(element?.classList?.contains(name));
}

export function classifyMermaidDiagramRoute(diagramType, svgClass = "", hasRoot = false) {
  const classes = String(svgClass).split(/\s+/);
  if (diagramType === "sequence") return "sequence";
  if (diagramType === "class" && hasRoot) return "class";
  if (diagramType === "er") {
    return hasRoot && classes.includes("erDiagram") ? "er" : null;
  }
  if (diagramType === "packet") return "packet";
  if (diagramType === "treeView") return "treeView";
  if (diagramType === "stateDiagram") {
    return hasRoot && classes.includes("statediagram") ? "state" : null;
  }
  if (hasRoot && classes.includes("flowchart")) return "flowchart";
  return null;
}

function firstElementChild(element) {
  return [...(element?.children || [])].find((child) => child.nodeType === 1) || null;
}

function directChildren(element, selector = null) {
  const children = [...(element?.children || [])].filter((child) => child.nodeType === 1);
  return selector ? children.filter((child) => child.matches(selector)) : children;
}

function pointKey(point) {
  return `${roundedMetric(point.x)},${roundedMetric(point.y)}`;
}

function parsePoints(points) {
  if (Array.isArray(points)) {
    return points
      .map((point) => ({ x: Number(point.x), y: Number(point.y) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  }
  return String(points || "")
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x, y };
    })
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

export function polygonPointsSignature(points, precision = 2) {
  const factor = 10 ** precision;
  return parsePoints(points)
    .map((point) => `${Math.round(point.x * factor) / factor},${Math.round(point.y * factor) / factor}`)
    .join(" ");
}

function normalizePolygon(points) {
  const parsed = parsePoints(points);
  if (!parsed.length) return [];
  const minX = Math.min(...parsed.map((point) => point.x));
  const minY = Math.min(...parsed.map((point) => point.y));
  const width = Math.max(...parsed.map((point) => point.x)) - minX || 1;
  const height = Math.max(...parsed.map((point) => point.y)) - minY || 1;
  return parsed.map((point) => ({
    x: Math.round(((point.x - minX) / width) * 1000) / 1000,
    y: Math.round(((point.y - minY) / height) * 1000) / 1000,
  }));
}

function closeToPoint(point, x, y, tolerance) {
  return Math.abs(point.x - x) <= tolerance && Math.abs(point.y - y) <= tolerance;
}

function closeMetric(left, right, tolerance) {
  return Math.abs(left - right) <= tolerance;
}

function classifyHeightBasedQuadrilateral(points) {
  const [a, b, c, d] = points;
  if (!a || points.length !== 4) return null;
  const height = a.y - c.y;
  const tolerance = Math.max(0.05, Math.abs(height) * 0.002);
  if (!(height > 0) ||
      !closeMetric(a.y, b.y, tolerance) ||
      !closeMetric(c.y, d.y, tolerance)) return null;
  const halfHeight = height / 2;
  if (closeMetric(d.x, a.x + halfHeight, tolerance) &&
      closeMetric(b.x, c.x + halfHeight, tolerance)) return "trapezoid";
  if (closeMetric(a.x, d.x + halfHeight, tolerance) &&
      closeMetric(c.x, b.x + halfHeight, tolerance)) return "invertedTrapezoid";
  if (closeMetric(a.x, d.x + halfHeight, tolerance) &&
      closeMetric(b.x, c.x + halfHeight, tolerance)) return "reverseParallelogram";
  return null;
}

export function classifyPolygonPreset(points, options = {}) {
  const fallbackPreset = options.fallbackPreset === null ? null : nonEmptyStringOr(options.fallbackPreset, "rect");
  const tolerance = finiteNumberOr(options.tolerance, 0.04);
  const parsed = parsePoints(points);
  const heightBased = classifyHeightBasedQuadrilateral(parsed);
  if (heightBased) return heightBased;
  const normalized = normalizePolygon(parsed);
  if (normalized.length === 4) {
    const [a, b, c, d] = normalized;
    if (
      closeToPoint(a, 0.5, 1, tolerance) &&
      closeToPoint(b, 1, 0.5, tolerance) &&
      closeToPoint(c, 0.5, 0, tolerance) &&
      closeToPoint(d, 0, 0.5, tolerance)
    ) {
      return "diamond";
    }
    if (
      closeToPoint(a, 0, 1, tolerance) &&
      closeToPoint(b, 0.8, 1, tolerance) &&
      closeToPoint(c, 1, 0, tolerance) &&
      closeToPoint(d, 0.2, 0, tolerance)
    ) {
      return "parallelogram";
    }
  }
  if (normalized.length === 6) {
    const [a, b, c, d, e, f] = normalized;
    if (a.x > 0 && a.x < 0.5 && closeToPoint(a, a.x, 1, tolerance) &&
        closeToPoint(b, 1 - a.x, 1, tolerance) && closeToPoint(c, 1, 0.5, tolerance) &&
        closeToPoint(d, b.x, 0, tolerance) && closeToPoint(e, a.x, 0, tolerance) &&
        closeToPoint(f, 0, 0.5, tolerance)) return "hexagon";
  }
  if (normalized.length === 3 &&
      normalized.some((point) => closeToPoint(point, 0.5, 0, tolerance)) &&
      normalized.some((point) => closeToPoint(point, 0, 1, tolerance)) &&
      normalized.some((point) => closeToPoint(point, 1, 1, tolerance))) return "triangle";
  return fallbackPreset;
}

export function isKnownSequenceTab(points, tolerance = 0.002) {
  const normalized = normalizePolygon(points);
  if (normalized.length !== 5) return false;
  return [
    [0, 0],
    [1, 0],
    [1, 0.65],
    [0.832, 1],
    [0, 1],
  ].every(([x, y], index) => closeToPoint(normalized[index], x, y, tolerance));
}

function markerReferenceId(value) {
  const text = String(value || "").trim();
  return /^url\(["']?[^"')]*#([^"')]+)["']?\)$/i.exec(text)?.[1] || text.replace(/^#/, "");
}

export function markerIdToArrow(value) {
  const marker = markerReferenceId(value);
  if (!marker) return "none";
  if (/(?:^|_)stateDiagram-barbEnd$/.test(marker)) return "stealth";
  if (/point(?:Start|End)(?:-margin)?$/i.test(marker)) return "triangle";
  if (/circle(?:Start|End)(?:-margin)?$/i.test(marker)) return "oval";
  if (/diamond(?:Start|End)(?:-margin)?$/i.test(marker)) return "diamond";
  if (/arrow(?:Start|End)(?:-margin)?$/i.test(marker)) return "arrow";
  if (/(?:^|[-_])composition(?:Start|End)(?:-margin)?$/i.test(marker)) return "diamond";
  if (/(?:^|[-_])dependency(?:Start|End)(?:-margin)?$/i.test(marker)) return "stealth";
  if (/-arrowhead$/.test(marker)) return "triangle";
  if (/-openarrowhead$/.test(marker)) return "arrow";
  if (/-filled-head$/.test(marker)) return "stealth";
  return "none";
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

export function simplifyPolyline(points, tolerance = DEFAULT_MERMAID_SCENE_OPTIONS.simplifyTolerance) {
  const parsed = parsePoints(points);
  const distinct = parsed.filter((point, index) => index === 0 || pointKey(point) !== pointKey(parsed[index - 1]));
  if (distinct.length < 3) return distinct;
  const threshold = Math.max(0, finiteNumberOr(tolerance, DEFAULT_MERMAID_SCENE_OPTIONS.simplifyTolerance));
  const keep = new Set([0, distinct.length - 1]);
  const pending = [[0, distinct.length - 1]];
  // Bound error against the original samples. Repeatedly deleting nearby points
  // can otherwise collapse a scaled self-message's entire return into one line.
  while (pending.length) {
    const [start, end] = pending.pop();
    let farthest = -1;
    let distance = threshold;
    for (let index = start + 1; index < end; index += 1) {
      const candidate = distanceToSegment(distinct[index], distinct[start], distinct[end]);
      if (candidate > distance) {
        farthest = index;
        distance = candidate;
      }
    }
    if (farthest !== -1) {
      keep.add(farthest);
      pending.push([start, farthest], [farthest, end]);
    }
  }
  return distinct.filter((_, index) => keep.has(index));
}

function normalizeColor(value, resolveColor = (entry) => entry) {
  const resolved = resolveColor(value);
  const text = String(resolved || "").trim();
  if (!text || text === "none" || text === "transparent" || text === "rgba(0, 0, 0, 0)") return null;
  return text;
}

function parseMetric(value) {
  const number = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(number) ? number : undefined;
}

function parseOpacity(value, fallback = 1) {
  const number = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function optionalOpacity(value, omitDefault = false) {
  const number = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(number)) return undefined;
  const opacity = Math.max(0, Math.min(1, number));
  return omitDefault && opacity === 1 ? undefined : opacity;
}

function cssColorParts(value) {
  const text = String(value || "").trim();
  if (!text || text === "none" || text === "transparent") return null;
  const hex = /^#([0-9a-f]{3,8})$/i.exec(text);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      digits = [...digits].map((digit) => digit + digit).join("");
    }
    if (digits.length !== 6 && digits.length !== 8) return null;
    return {
      rgb: digits.slice(0, 6).toLowerCase(),
      alpha: digits.length === 8 ? Number.parseInt(digits.slice(6), 16) / 255 : 1,
    };
  }
  const rgb = /^rgba?\((.*)\)$/i.exec(text);
  if (!rgb) return null;
  let channels;
  let alpha;
  if (rgb[1].includes(",")) {
    const parts = rgb[1].split(",").map((part) => part.trim());
    if (parts.length !== 3 && parts.length !== 4) return null;
    channels = parts.slice(0, 3);
    alpha = parts[3];
  } else {
    const parts = rgb[1].split("/").map((part) => part.trim());
    if (parts.length > 2) return null;
    channels = parts[0].split(/\s+/).filter(Boolean);
    alpha = parts[1];
  }
  if (channels.length !== 3) return null;
  const values = channels.map((channel) => {
    const percent = channel.endsWith("%");
    const number = Number.parseFloat(channel);
    return percent ? Math.round((number * 255) / 100) : Math.round(number);
  });
  if (values.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255)) return null;
  const alphaValue = alpha === undefined
    ? 1
    : alpha.endsWith("%")
      ? Number.parseFloat(alpha) / 100
      : Number.parseFloat(alpha);
  if (!Number.isFinite(alphaValue) || alphaValue < 0 || alphaValue > 1) return null;
  return {
    rgb: values.map((channel) => channel.toString(16).padStart(2, "0")).join(""),
    alpha: alphaValue,
  };
}

function effectiveFillAlpha(style = {}) {
  if (!style.fill) return 0;
  return (cssColorParts(style.fill)?.alpha ?? 1) *
    (style.opacity ?? 1) * (style.fillOpacity ?? 1);
}

function effectiveStrokeAlpha(style = {}) {
  if (!style.stroke || style.strokeWidth === 0) return 0;
  return (cssColorParts(style.stroke)?.alpha ?? 1) *
    (style.opacity ?? 1) * (style.strokeOpacity ?? 1);
}

function localOpacity(element) {
  return parseOpacity(getComputedStyle(element).opacity);
}

function dashToSceneDash(value) {
  const text = String(value || "").trim();
  if (!text || text === "none" || text === "0" || text === "0px") return "solid";
  const values = text
    .split(/[,\s]+/)
    .map((part) => Number.parseFloat(part))
    .filter(Number.isFinite);
  if (values.length && values.every((value) => value === 0)) return "solid";
  if (values.length >= 2 && values[0] <= 2 && values[1] >= values[0] * 2) return "dot";
  if (values.length >= 2) return "dash";
  if (values.length === 1 && values[0] <= 2) return "dot";
  return "dash";
}

function normalizeAlignment(value) {
  const text = String(value || "").toLowerCase();
  if (text === "left" || text === "center" || text === "right" || text === "justify") return text;
  if (text === "end") return "right";
  return "center";
}

export function cssStyleToSceneStyle(style = {}, options = {}) {
  const resolveColor = typeof options.resolveColor === "function" ? options.resolveColor : (value) => value;
  const strokeWidth = parseMetric(style.strokeWidth);
  const cornerRadius = parseMetric(style.cornerRadius ?? style.rx);
  return definedEntries({
    fill: style.fill !== undefined ? normalizeColor(style.fill, resolveColor) : undefined,
    stroke: style.stroke !== undefined ? normalizeColor(style.stroke, resolveColor) : undefined,
    strokeWidth,
    dash: style.dash !== undefined || style.strokeDasharray !== undefined
      ? dashToSceneDash(style.dash ?? style.strokeDasharray)
      : undefined,
    opacity: optionalOpacity(style.opacity),
    fillOpacity: optionalOpacity(style.fillOpacity, true),
    strokeOpacity: optionalOpacity(style.strokeOpacity, true),
    cornerRadius,
  });
}

export function primaryFontFamily(value) {
  // getComputedStyle returns the whole CSS stack, but PowerPoint needs one literal typeface.
  const first = String(value ?? "").split(",")[0].trim().replace(/^["']|["']$/g, "");
  return first || undefined;
}

export function textToSceneText(text, style = {}, options = {}) {
  const resolveColor = typeof options.resolveColor === "function" ? options.resolveColor : (value) => value;
  const lines = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const paragraphs = (lines.length ? lines : [""]).map((line) => {
    const fontWeight = parseMetric(style.fontWeight);
    return {
      alignment: normalizeAlignment(style.textAlign || style.alignment),
      runs: [
        definedEntries({
          text: line,
          fontSize: parseMetric(style.fontSize),
          fontFace: primaryFontFamily(style.fontFamily),
          fontWeight,
          bold: Number.isFinite(fontWeight) ? fontWeight >= 600 : undefined,
          italic: String(style.fontStyle || "").toLowerCase() === "italic" || undefined,
          color: style.color !== undefined ? normalizeColor(style.color, resolveColor) : undefined,
          opacity: Number.isFinite(Number(style.opacity)) ? Math.max(0, Math.min(1, Number(style.opacity))) : undefined,
        }),
      ],
    };
  });
  return { paragraphs };
}

function countSceneNodes(nodes, depth = 1) {
  let count = 0;
  let maxDepth = depth;
  let connectorPoints = 0;
  let paragraphs = 0;
  let runs = 0;
  const visitText = (text) => {
    if (!text?.paragraphs) return;
    paragraphs += text.paragraphs.length;
    runs += text.paragraphs.reduce((total, paragraph) => total + (paragraph.runs?.length || 0), 0);
  };
  for (const node of nodes || []) {
    count += 1;
    maxDepth = Math.max(maxDepth, depth);
    visitText(node.text);
    visitText(node.label?.text);
    if (node.kind === "connector") connectorPoints = Math.max(connectorPoints, node.points?.length || 0);
    if (node.kind === "group") {
      const nested = countSceneNodes(node.children, depth + 1);
      count += nested.count;
      maxDepth = Math.max(maxDepth, nested.maxDepth);
      connectorPoints = Math.max(connectorPoints, nested.connectorPoints);
      paragraphs += nested.paragraphs;
      runs += nested.runs;
    }
  }
  return { count, maxDepth, connectorPoints, paragraphs, runs };
}

export function fallbackSceneForReason(scene, reason, bounds = {}) {
  const width = finiteNumberOr(scene?.width, finiteNumberOr(bounds.width, 0));
  const height = finiteNumberOr(scene?.height, finiteNumberOr(bounds.height, 0));
  return createScene({
    width,
    height,
    source: { kind: "mermaid", path: nonEmptyStringOr(scene?.source?.path, DEFAULT_MERMAID_SCENE_OPTIONS.path) },
    nodes: [
      {
        kind: "fallback",
        sourcePath: "svg",
        z: 0,
        bounds: {
          x: finiteNumberOr(bounds.x, 0),
          y: finiteNumberOr(bounds.y, 0),
          width,
          height,
        },
        reason,
      },
    ],
  });
}

export function enforceSceneLimits(scene, options = {}) {
  const stats = countSceneNodes(scene?.nodes || []);
  const reasons = [];
  if (stats.count > MAX_SCENE_NODES) reasons.push(`scene node count exceeds ${MAX_SCENE_NODES}`);
  if (stats.maxDepth > MAX_GROUP_DEPTH) reasons.push(`group depth exceeds ${MAX_GROUP_DEPTH}`);
  if (stats.connectorPoints > MAX_CONNECTOR_POINTS) reasons.push(`connector points exceed ${MAX_CONNECTOR_POINTS}`);
  if (stats.paragraphs > MAX_TEXT_PARAGRAPHS) reasons.push(`text paragraphs exceed ${MAX_TEXT_PARAGRAPHS}`);
  if (stats.runs > MAX_TEXT_RUNS) reasons.push(`text runs exceed ${MAX_TEXT_RUNS}`);
  if (!reasons.length) return { scene, diagnostics: [] };
  const reason = nonEmptyStringOr(options.reason, `mermaid-scene-limit-exceeded: ${reasons.join(", ")}`);
  return {
    scene: fallbackSceneForReason(scene, reason, options.bounds),
    diagnostics: [{ path: "scene", kind: "fallback", reason }],
  };
}

function normalizeOptions(options = {}) {
  return {
    path: nonEmptyStringOr(options.path, DEFAULT_MERMAID_SCENE_OPTIONS.path),
    deck: options.deck || null,
    resolveColor: typeof options.resolveColor === "function" ? options.resolveColor : (value) => value,
    simplifyTolerance: finiteNumberOr(options.simplifyTolerance, DEFAULT_MERMAID_SCENE_OPTIONS.simplifyTolerance),
    sampleStep: finiteNumberOr(options.sampleStep, DEFAULT_MERMAID_SCENE_OPTIONS.sampleStep),
    includeSourceElements: options.includeSourceElements === true,
    sourceElements: new Map(),
  };
}

function boundsOf(element, deck) {
  const rect = element.getBoundingClientRect();
  const deckRect = deck.getBoundingClientRect();
  return {
    x: roundedMetric(rect.left - deckRect.left),
    y: roundedMetric(rect.top - deckRect.top),
    width: roundedMetric(rect.width),
    height: roundedMetric(rect.height),
  };
}

function svgSize(svg, deck) {
  const rect = boundsOf(svg, deck);
  if (rect.width > 0 && rect.height > 0) return { width: rect.width, height: rect.height };
  const [, , width, height] = String(svg.getAttribute("viewBox") || "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return {
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0,
  };
}

function computedSvgStyle(element, options) {
  const style = getComputedStyle(element);
  return cssStyleToSceneStyle({
    fill: style.fill,
    stroke: style.stroke,
    strokeWidth: Number.parseFloat(style.strokeWidth) * elementScale(element),
    strokeDasharray: style.strokeDasharray,
    opacity: effectiveOpacity(element),
    fillOpacity: style.fillOpacity,
    strokeOpacity: style.strokeOpacity,
    rx: element.getAttribute("rx"),
  }, options);
}

function computedConnectorStyle(element, options) {
  const style = getComputedStyle(element);
  const lineCap = LINE_CAPS.has(style.strokeLinecap) ? style.strokeLinecap : undefined;
  const { fillOpacity: _fillOpacity, ...paint } = computedSvgStyle(element, options);
  return definedEntries({
    ...paint,
    fill: null,
    lineCap,
  });
}

function computedTextStyle(element, options) {
  const style = getComputedStyle(element);
  return {
    fontFamily: style.fontFamily,
    fontSize: roundedMetric(Number.parseFloat(style.fontSize) * elementScale(element)),
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    color: element.namespaceURI === SVG_NS ? style.fill : style.color,
    textAlign: element.namespaceURI === SVG_NS
      ? ({ start: "left", middle: "center", end: "right" }[style.textAnchor] || "left")
      : style.textAlign,
    opacity: effectiveOpacity(element) *
      (element.namespaceURI === SVG_NS ? parseOpacity(style.fillOpacity) : 1),
    resolveColor: options.resolveColor,
  };
}

function elementScale(element) {
  const svgElement = element.namespaceURI === SVG_NS ? element : element.closest("foreignObject");
  const matrix = svgElement?.getScreenCTM?.();
  return matrix ? Math.hypot(matrix.a, matrix.b) : 1;
}

function effectiveOpacity(element) {
  let opacity = 1;
  for (let current = element; current; current = current.parentElement) {
    opacity *= localOpacity(current);
    if (localName(current) === "svg") break;
  }
  return opacity;
}

function textGeometrySource(element) {
  if (!element) return null;
  if (element.namespaceURI !== SVG_NS) return element.closest?.("foreignObject") || null;
  if (localName(element) === "text" || localName(element) === "foreignObject") return element;
  const candidates = [...element.querySelectorAll("text, foreignObject")]
    .filter((candidate) => !candidate.parentElement?.closest("text, foreignObject"));
  return candidates.length === 1 ? candidates[0] : null;
}

function hasUnsupportedCoordinateList(element, name) {
  if (!element.hasAttribute(name)) return false;
  const list = element[name]?.baseVal;
  if (!list || !Number.isInteger(list.numberOfItems) || list.numberOfItems > 1) return true;
  if (list.numberOfItems === 0) return element.getAttribute(name).trim() !== "";
  const value = list.getItem(0)?.value;
  return !Number.isFinite(value) || (name === "dx" && Math.abs(value) > 0.000001);
}

function hasUnsupportedTextSemantics(source) {
  return [source, ...source.querySelectorAll("*")].some((child, index) => {
    const style = getComputedStyle(child);
    if (child.namespaceURI !== SVG_NS) {
      return [style.transform, style.rotate, style.scale, style.translate]
        .some((value) => value && value !== "none");
    }
    if (localName(child) === "textPath" ||
        child.hasAttribute("textLength") ||
        child.hasAttribute("lengthAdjust") ||
        String(child.getAttribute("rotate") || "").trim() ||
        ["x", "y", "dx", "dy"].some((name) => hasUnsupportedCoordinateList(child, name))) {
      return true;
    }
    return index > 0 && (child.hasAttribute("transform") ||
      [style.transform, style.rotate, style.scale, style.translate]
        .some((value) => value && value !== "none"));
  });
}

function measuredTextGeometry(element, deck) {
  const source = textGeometrySource(element);
  const matrix = source?.getScreenCTM?.();
  const transform = decomposeSimpleSvgTransform(matrix);
  if (!source || !transform || hasUnsupportedTextSemantics(source)) return null;
  if (transform.rotation === 0) return { bounds: boundsOf(element, deck) };
  const box = source.getBBox?.();
  if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
      !(box.width > 0) || !(box.height > 0)) return null;
  const center = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(matrix);
  const deckRect = deck.getBoundingClientRect();
  const width = box.width * transform.scale;
  const height = box.height * transform.scale;
  return {
    bounds: {
      x: roundedMetric(center.x - deckRect.left - width / 2),
      y: roundedMetric(center.y - deckRect.top - height / 2),
      width: roundedMetric(width),
      height: roundedMetric(height),
    },
    rotation: transform.rotation,
  };
}

function labelInfo(root, selector, deck, options) {
  const label = root.querySelector(selector);
  const text = label?.innerText?.trim() || label?.textContent?.trim() || "";
  if (!text) return null;
  const geometry = measuredTextGeometry(label, deck);
  return {
    text: structuredLabelText(label, options),
    element: label,
    ...(geometry || { bounds: boundsOf(label, deck), unsupportedTransform: true }),
  };
}

function structuredLabelText(element, options) {
  const paragraphs = [];
  let runs = [];
  const flush = () => {
    if (!runs.length) return;
    runs[0].text = runs[0].text.trimStart();
    runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd();
    if (runs.some((run) => run.text)) {
      paragraphs.push({ alignment: normalizeAlignment(computedTextStyle(element, options).textAlign), runs });
    }
    runs = [];
  };
  const walk = (node) => {
    if (node.nodeType === 3) {
      const text = (node.textContent || "").replace(/\s+/g, " ");
      if (text) {
        const run = textToSceneText("x", computedTextStyle(node.parentElement, options), options).paragraphs[0].runs[0];
        runs.push({ ...run, text });
      }
      return;
    }
    const tag = localName(node);
    if (IGNORED_TAGS.has(tag)) return;
    if (tag === "br") { flush(); return; }
    const block = tag === "p" || tag === "div";
    const newSvgLine = tag === "tspan" && (
      Number.parseFloat(node.getAttribute("dy")) !== 0 && Number.isFinite(Number.parseFloat(node.getAttribute("dy"))) ||
      node.hasAttribute("y") && node.getAttribute("y") !== element.getAttribute("y")
    );
    if (newSvgLine) flush();
    if (block) flush();
    for (const child of node.childNodes || []) walk(child);
    if (block) flush();
  };
  walk(element);
  flush();
  return { paragraphs: paragraphs.length ? paragraphs : textToSceneText("", computedTextStyle(element, options), options).paragraphs };
}

function markerFallbackPadding(element, style) {
  let padding = 20;
  for (const value of [style.markerStart, style.markerMid, style.markerEnd]) {
    if (!value || value === "none") continue;
    const marker = element.ownerSVGElement?.querySelector(`#${CSS.escape(markerReferenceId(value))}`);
    if (localName(marker) !== "marker") continue;
    const refX = marker.refX.baseVal.value;
    const refY = marker.refY.baseVal.value;
    const unit = (marker.getAttribute("markerUnits") || "strokeWidth") === "strokeWidth" ? parseMetric(style.strokeWidth) : 1;
    const view = marker.viewBox.baseVal;
    const viewScale = marker.hasAttribute("viewBox") && view.width > 0 && view.height > 0
      ? Math.max(marker.markerWidth.baseVal.value / view.width, marker.markerHeight.baseVal.value / view.height) : 1;
    for (const child of directChildren(marker)) {
      if (typeof child.getBBox !== "function") continue;
      const box = child.getBBox();
      const stroke = parseMetric(getComputedStyle(child).strokeWidth) || 0;
      const matrix = new DOMMatrix(getComputedStyle(child).transform === "none" ? undefined : getComputedStyle(child).transform);
      const markerMatrix = new DOMMatrix(getComputedStyle(marker).transform === "none" ? undefined : getComputedStyle(marker).transform);
      const transform = markerMatrix.multiply(matrix);
      for (const [x, y] of [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]) {
        const point = new DOMPoint(x, y).matrixTransform(transform);
        // A radius is independent of the tangent/orient and safe for either end.
        const radius = (Math.hypot(point.x - refX, point.y - refY) +
          stroke * 4 * Math.max(Math.hypot(transform.a, transform.b), Math.hypot(transform.c, transform.d))) * viewScale * unit;
        if (Number.isFinite(radius)) padding = Math.max(padding, radius);
      }
    }
  }
  return padding;
}

function fallbackNode(element, z, deck, reason, sourcePath) {
  let bounds = boundsOf(element, deck);
  if (["path", "line", "polyline"].includes(localName(element))) {
    const style = getComputedStyle(element);
    const marked = [style.markerStart, style.markerMid, style.markerEnd].some((value) => value && value !== "none");
    const padding = Math.max(1, Number.parseFloat(getComputedStyle(element).strokeWidth) || 0,
      marked ? markerFallbackPadding(element, style) : 0) *
      Math.max(elementScale(element), Math.abs(element.getScreenCTM()?.d || 1));
    bounds = { x: bounds.x - padding, y: bounds.y - padding,
      width: bounds.width + 2 * padding, height: bounds.height + 2 * padding };
  }
  return {
    kind: "fallback",
    id: element.getAttribute?.("id") || undefined,
    sourcePath,
    z,
    bounds,
    reason,
    meta: { mermaid: { tag: tagName(element), class: element.getAttribute?.("class") || "" } },
  };
}

function rectPreset(shape) {
  const rx = Number.parseFloat(shape.getAttribute("rx") || "0");
  const ry = Number.parseFloat(shape.getAttribute("ry") || "0");
  return rx > 0 || ry > 0 ? "roundedRect" : "rect";
}

function shapePresetFor(shape) {
  if (localName(shape) === "rect") return rectPreset(shape);
  if (localName(shape) === "circle" || localName(shape) === "ellipse") return "ellipse";
  if (localName(shape) === "polygon") return classifyPolygonPreset(shape.getAttribute("points"), { fallbackPreset: null });
  return null;
}

function relativeBounds(bounds, origin) {
  return { ...bounds, x: bounds.x - origin.x, y: bounds.y - origin.y };
}

function relativeFallbackNode(element, z, deck, reason, sourcePath, origin) {
  const fallback = fallbackNode(element, z, deck, reason, sourcePath);
  fallback.bounds = relativeBounds(fallback.bounds, origin);
  return fallback;
}

function unsupportedVisualEffect(element, descendants = true) {
  return [element, ...(descendants ? element.querySelectorAll("*") : [])].some((child) => {
    const style = getComputedStyle(child);
    return (style.filter && style.filter !== "none") ||
      (style.clipPath && style.clipPath !== "none") ||
      (style.maskImage && style.maskImage !== "none") ||
      (style.mixBlendMode && style.mixBlendMode !== "normal") ||
      (style.paintOrder && style.paintOrder !== "normal") ||
      (style.vectorEffect && style.vectorEffect !== "none") ||
      (localName(child) === "g" && Number.parseFloat(style.opacity) < 1 &&
        child.querySelectorAll([...VISUAL_TAGS].join(",")).length > 1) ||
      /url\(/i.test(`${style.fill} ${style.stroke}`);
  });
}

function markerPrimitiveSupportsArrow(primitive, arrow) {
  const tag = localName(primitive);
  if (arrow === "oval") return tag === "circle";
  if (arrow === "arrow") return tag === "path" || tag === "polyline";
  return ["triangle", "diamond", "stealth"].includes(arrow) &&
    (tag === "path" || tag === "polygon");
}

function markerPaintMatchesConnector(marker, primitive, element, arrow) {
  const lineStyle = getComputedStyle(element);
  const lineColor = cssColorParts(lineStyle.stroke);
  if (!lineColor || !normalizeColor(lineStyle.stroke) || !(parseMetric(lineStyle.strokeWidth) > 0)) {
    return false;
  }
  const referenceOpacity = effectiveOpacity(element);
  const lineAlpha = lineColor.alpha *
    parseOpacity(lineStyle.strokeOpacity) * referenceOpacity;
  const markerStyle = getComputedStyle(primitive);
  const markerOpacity = localOpacity(marker) * localOpacity(primitive);
  const paints = [];
  const visible = { fill: false, stroke: false };
  for (const channel of ["fill", "stroke"]) {
    if (channel === "stroke" && !(parseMetric(markerStyle.strokeWidth) > 0)) continue;
    const value = markerStyle[channel];
    if (!normalizeColor(value)) continue;
    const color = cssColorParts(value);
    if (!color) return false;
    const alpha = color.alpha *
      parseOpacity(markerStyle[`${channel}Opacity`]) *
      markerOpacity *
      referenceOpacity;
    if (alpha <= 0.000001) continue;
    if (channel === "stroke" && !solidMarkerDash(markerStyle.strokeDasharray)) return false;
    visible[channel] = true;
    paints.push({ color, alpha });
  }
  if (lineAlpha > 0.000001 && paints.length === 0) return false;
  if (lineAlpha > 0.000001 &&
      (arrow === "arrow" ? !visible.stroke || visible.fill : !visible.fill)) return false;
  return paints.every(({ color, alpha }) =>
    color.rgb === lineColor.rgb && Math.abs(alpha - lineAlpha) <= 0.000001);
}

function connectorArrow(value, element, placement) {
  const id = markerReferenceId(value);
  const arrow = markerIdToArrow(value);
  if (arrow === "none") return "none";
  const relation = /(?:^|[-_])(composition|dependency)(Start|End)(?:-margin)?$/i.exec(id);
  const sequenceHead = /-filled-head$/.test(id);
  const stateBarb = /(?:^|_)stateDiagram-barbEnd$/.test(id);
  const marker = element.ownerSVGElement.querySelector(`#${CSS.escape(id)}`);
  const children = marker ? directChildren(marker) : [];
  const primitive = children[0];
  if (localName(marker) !== "marker" || children.length !== 1 ||
      !markerPrimitiveSupportsArrow(primitive, arrow) ||
      unsupportedVisualEffect(marker) ||
      [marker, primitive].some((part) => {
        const style = getComputedStyle(part);
        return style.display === "none" ||
          (style.visibility === "hidden" &&
            (!element.ownerDocument.body.classList.contains("mermaid-loading") ||
              part.style.visibility === "hidden" || part.getAttribute("visibility") === "hidden")) ||
          style.transform !== "none" || style.rotate !== "none" ||
          style.scale !== "none" || style.translate !== "none";
      })) return "none";
  // Mermaid 11.15.0 emits this forward-facing marker only at the end. Its
  // concave filled geometry is a stealth head, not an open asynchronous head.
  if (sequenceHead && (placement !== "end" || marker.getAttribute("orient") !== "auto" ||
      (marker.getAttribute("markerUnits") || "strokeWidth") !== "strokeWidth" ||
      marker.hasAttribute("viewBox") ||
      [["refX", 15.5], ["refY", 7], ["markerWidth", 20], ["markerHeight", 28]]
        .some(([name, value]) => Number(marker.getAttribute(name)) !== value))) return "none";
  if (stateBarb && (placement !== "end" || marker.getAttribute("orient") !== "auto" ||
      marker.getAttribute("markerUnits") !== "userSpaceOnUse" ||
      marker.hasAttribute("viewBox") ||
      parseMetric(getComputedStyle(element).strokeWidth) !== 1 ||
      [["refX", 19], ["refY", 7], ["markerWidth", 20], ["markerHeight", 14]]
        .some(([name, value]) => Number(marker.getAttribute(name)) !== value))) return "none";
  if (relation || sequenceHead || stateBarb) {
    // The pinned class renderer uses a filled diamond or a concave (stealth) head,
    // not the hollow diamond/triangle used for aggregation and inheritance.
    const d = primitive.getAttribute("d") || "";
    if (d.replace(/[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?|[\s,]/gi, "") !== "MLLLZ") return "none";
    const values = d.match(/[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/gi)?.map(Number) || [];
    const expected = stateBarb ? [19, 7, 9, 13, 14, 7, 9, 1]
      : sequenceHead ? [18, 7, 9, 13, 14, 7, 9, 1]
      : relation[1].toLowerCase() === "composition" ? [18, 7, 9, 13, 1, 7, 9, 1]
      : relation[2].toLowerCase() === "start" ? [5, 7, 9, 13, 1, 7, 9, 1] : [18, 7, 9, 13, 14, 7, 9, 1];
    if (values.length !== expected.length || values.some((value, index) => value !== expected[index])) return "none";
  }
  return markerPaintMatchesConnector(marker, primitive, element, arrow) ? arrow : "none";
}

// These are the actual Mermaid 11.15.0 outlines, not arrow presets. In particular
// the two extension margin polygons are different from the regular triangles.
export function knownMarkerGeometry(id, tag, geometry) {
  const name = markerReferenceId(id);
  const numbers = String(geometry).match(/[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/gi)?.map(Number) || [];
  const commands = String(geometry).replace(/[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?|[\s,]/gi, "");
  const relation = /(?:^|[-_])(extension|aggregation)(Start|End)(-margin)?$/i.exec(name);
  const cross = /(?:^|[-_])cross(Start|End)(-margin)?$/i.exec(name);
  let expected;
  let syntax;
  let kind;
  let strokes;
  if (relation) {
    const start = relation[2].toLowerCase() === "start";
    kind = relation[1].toLowerCase() === "aggregation" ? "hollow-diamond" : "hollow-triangle";
    if (kind === "hollow-diamond") {
      expected = [18, 7, 9, 13, 1, 7, 9, 1];
      syntax = "MLLLZ";
      strokes = [[[18, 7], [9, 13], [1, 7], [9, 1], [18, 7]]];
    } else if (relation[3]) {
      expected = start ? [10, 7, 18, 13, 18, 1] : [10, 1, 10, 13, 18, 7];
      syntax = "";
      strokes = [start ? [[10, 7], [18, 13], [18, 1], [10, 7]] : [[10, 1], [10, 13], [18, 7], [10, 1]]];
    } else {
      expected = start ? [1, 7, 18, 13, 1] : [1, 1, 13, 18, 7];
      syntax = start ? "MLVZ" : "MVLZ";
      strokes = [start ? [[1, 7], [18, 13], [18, 1], [1, 7]] : [[1, 1], [1, 13], [18, 7], [1, 1]]];
    }
  } else if (cross || /-crosshead$/.test(name)) {
    kind = "cross";
    expected = cross ? cross[2] ? [1, 1, 14, 14, 1, 14, 14, 1] : [1, 1, 9, 9, 10, 1, -9, 9]
      : [1, 2, 6, 7, 6, 2, 1, 7];
    syntax = cross && !cross[2] ? "MlMl" : "MLML";
    if (cross && !cross[2] && commands === "MLML") {
      expected = [1, 1, 10, 10, 10, 1, 1, 10];
      syntax = "MLML";
    }
    strokes = cross ? cross[2] ? [[[1, 1], [14, 14]], [[1, 14], [14, 1]]]
      : [[[1, 1], [10, 10]], [[10, 1], [1, 10]]] : [[[1, 2], [6, 7]], [[6, 2], [1, 7]]];
  } else return null;
  if (tag !== (syntax ? "path" : "polygon") || commands !== syntax ||
      numbers.length !== expected.length || numbers.some((value, index) => value !== expected[index])) return null;
  return { kind, strokes: strokes.map((stroke) => stroke.map(([x, y]) => ({ x, y }))) };
}

// Work from the curve's control points, not the simplified polyline: its first
// chord can have a different direction, especially on self and short messages.
export function markerEndpointTangents(d) {
  const text = String(d || "");
  if (text.replace(/[MLHVCSQTmlhvcsqt]|[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?|[\s,]/g, "")) return null;
  const tokens = text.match(/[MLHVCSQTmlhvcsqt]|[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/g) || [];
  if (tokens.length > MAX_SCENE_NODES * 8) return null;
  const sizes = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2 };
  let index = 0;
  let command = "";
  let previous = "";
  let current = { x: 0, y: 0 };
  let control;
  let start;
  let firstDirection;
  let lastDirection;
  while (index < tokens.length) {
    if (/^[a-z]$/i.test(tokens[index])) command = tokens[index++];
    const upper = command.toUpperCase();
    const count = sizes[upper];
    if (!count || index + count > tokens.length || (!start && upper !== "M")) return null;
    const values = tokens.slice(index, index + count).map(Number);
    if (!values.every(Number.isFinite)) return null;
    index += count;
    const relative = command !== upper;
    const point = (offset) => ({
      x: values[offset] + (relative ? current.x : 0),
      y: values[offset + 1] + (relative ? current.y : 0),
    });
    let end;
    let controls = [];
    if (upper === "H") end = { x: values[0] + (relative ? current.x : 0), y: current.y };
    else if (upper === "V") end = { x: current.x, y: values[0] + (relative ? current.y : 0) };
    else end = point(count - 2);
    if (upper === "M") {
      if (start) return null;
      start = end;
      command = relative ? "l" : "L";
    } else {
      if (upper === "C") controls = [point(0), point(2)];
      if (upper === "Q") controls = [point(0)];
      if (upper === "S" || upper === "T") {
        const reflect = (upper === "S" ? ["C", "S"] : ["Q", "T"]).includes(previous);
        controls = [reflect ? { x: 2 * current.x - control.x, y: 2 * current.y - control.y } : current];
        if (upper === "S") controls.push(point(0));
      }
      const initial = [...controls, end].find((point) => point.x !== current.x || point.y !== current.y);
      const final = [...controls].reverse().concat(current).find((point) => point.x !== end.x || point.y !== end.y);
      if (!firstDirection && initial) firstDirection = { x: initial.x - current.x, y: initial.y - current.y };
      if (final) lastDirection = { x: end.x - final.x, y: end.y - final.y };
      control = controls.at(-1);
    }
    current = end;
    previous = upper;
  }
  return firstDirection && lastDirection ? {
    start: { point: start, direction: firstDirection }, end: { point: current, direction: lastDirection },
  } : null;
}

function solidMarkerDash(value) {
  if (!value || value === "none") return true;
  const values = value.split(/[,\s]+/).map(Number.parseFloat);
  return values.every((value) => value === 0) ||
    (values.length % 2 === 0 && values.every((value, index) => Number.isFinite(value) && (index % 2 === 0 ? value > 0 : value === 0)));
}

function renderedPathData(path) {
  const computed = getComputedStyle(path).d;
  if (!computed) return path.getAttribute("d") || "";
  return /^path\(["'](.*)["']\)$/.exec(computed)?.[1] || "";
}

function markerParts(value, element, placement, deck, options) {
  const id = markerReferenceId(value);
  const marker = element.ownerSVGElement.querySelector(`#${CSS.escape(id)}`);
  const children = marker ? directChildren(marker) : [];
  const outline = children[0];
  if (localName(marker) !== "marker" || children.length !== 1 || unsupportedVisualEffect(marker)) return null;
  const geometry = knownMarkerGeometry(id, localName(outline),
    localName(outline) === "path" ? renderedPathData(outline) : outline.getAttribute("points"));
  if (!geometry) return null;
  const paint = getComputedStyle(outline);
  const markerStyle = getComputedStyle(marker);
  const lineStyle = getComputedStyle(element);
  const matrix = element.getScreenCTM();
  const scale = elementScale(element);
  if (!matrix || Math.abs(matrix.a - matrix.d) > 0.001 || Math.abs(matrix.b) > 0.001 || Math.abs(matrix.c) > 0.001 ||
      !normalizeColor(paint.stroke) || !(parseMetric(paint.strokeWidth) > 0) || effectiveOpacity(element) !== 1 ||
      !normalizeColor(lineStyle.stroke) || !(parseMetric(lineStyle.strokeWidth) > 0) ||
      roundedMetric(parseMetric(lineStyle.strokeWidth) * scale) <= 0 ||
      (localName(element) === "path" && normalizeColor(lineStyle.fill)) ||
      (geometry.kind !== "cross" && normalizeColor(paint.fill)) ||
      !solidMarkerDash(paint.strokeDasharray) || parseMetric(paint.strokeDashoffset) !== 0 ||
      paint.strokeLinecap !== "butt" || paint.strokeLinejoin !== "miter" || Number(paint.strokeMiterlimit) !== 4 ||
      [element, marker, outline].some((part) => {
        const style = getComputedStyle(part);
        return (part === element && Number(style.opacity) !== 1) || (part !== element && (style.transform !== "none" ||
          style.rotate !== "none" || style.scale !== "none" || style.translate !== "none")) ||
          (style.vectorEffect && style.vectorEffect !== "none") ||
          (style.mixBlendMode && style.mixBlendMode !== "normal") ||
          (style.paintOrder && style.paintOrder !== "normal") ||
          style.display === "none" || (style.visibility === "hidden" &&
            (!element.ownerDocument.body.classList.contains("mermaid-loading") ||
              part.style.visibility === "hidden" || part.getAttribute("visibility") === "hidden"));
      })) return null;
  const units = marker.getAttribute("markerUnits") || "strokeWidth";
  if (!["strokeWidth", "userSpaceOnUse"].includes(units)) return null;
  const unitScale = units === "strokeWidth" ? parseMetric(lineStyle.strokeWidth) : 1;
  const metric = (name, fallback) => {
    const raw = marker.getAttribute(name);
    return raw === null ? fallback : /^[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?(?:px)?$/i.test(raw.trim()) ? Number.parseFloat(raw) : NaN;
  };
  const width = metric("markerWidth", 3);
  const height = metric("markerHeight", 3);
  const ref = { x: metric("refX", 0), y: metric("refY", 0) };
  let sx = 1;
  let sy = 1;
  let tx = 0;
  let ty = 0;
  if (marker.hasAttribute("viewBox")) {
    const box = marker.getAttribute("viewBox").trim().split(/[\s,]+/).map(Number);
    if (box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) return null;
    const aspect = (marker.getAttribute("preserveAspectRatio") || "xMidYMid meet").trim();
    const match = /^(none|x(Min|Mid|Max)Y(Min|Mid|Max))(?:\s+(meet|slice))?$/.exec(aspect);
    if (!match) return null;
    sx = width / box[2];
    sy = height / box[3];
    if (match[1] !== "none") {
      sx = sy = (match[4] === "slice" ? Math.max : Math.min)(sx, sy);
      tx = (width - box[2] * sx) * ({ Min: 0, Mid: 0.5, Max: 1 }[match[2]]);
      ty = (height - box[3] * sy) * ({ Min: 0, Mid: 0.5, Max: 1 }[match[3]]);
    }
    tx -= box[0] * sx;
    ty -= box[1] * sy;
  }
  if (![width, height, ref.x, ref.y, sx, sy, unitScale].every(Number.isFinite) ||
      width <= 0 || height <= 0 || unitScale <= 0 || Math.abs(sx - sy) > 0.001) return null;
  // Clipping through the known strokes needs a local picture, not shortened or
  // missing terminals. Normal bundled marker viewports contain their vertices.
  if (markerStyle.overflow !== "visible" && geometry.strokes.flat().some((point) =>
    point.x * sx + tx < 0 || point.x * sx + tx > width || point.y * sy + ty < 0 || point.y * sy + ty > height)) return null;
  const endpoints = localName(element) === "path" ? markerEndpointTangents(renderedPathData(element)) : (() => {
    const start = { x: Number(element.getAttribute("x1")), y: Number(element.getAttribute("y1")) };
    const end = { x: Number(element.getAttribute("x2")), y: Number(element.getAttribute("y2")) };
    const direction = { x: end.x - start.x, y: end.y - start.y };
    return direction.x || direction.y ? { start: { point: start, direction }, end: { point: end, direction } } : null;
  })();
  if (!endpoints) return null;
  const endpoint = endpoints[placement];
  const orient = marker.getAttribute("orient") || "0";
  let angle;
  if (orient === "auto" || orient === "auto-start-reverse") {
    angle = Math.atan2(endpoint.direction.y, endpoint.direction.x) + (orient === "auto-start-reverse" && placement === "start" ? Math.PI : 0);
  } else if (/^[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?(?:deg|rad|grad|turn)?$/i.test(orient)) {
    angle = marker.orientAngle.baseVal.value * Math.PI / 180;
  } else return null;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const strokes = geometry.strokes.map((stroke) => stroke.map((point) => {
    const x = (point.x - ref.x) * sx * unitScale;
    const y = (point.y - ref.y) * sy * unitScale;
    return screenPoint(element, { x: endpoint.point.x + cosine * x - sine * y,
      y: endpoint.point.y + sine * x + cosine * y }, deck);
  }));
  if (strokes.some((stroke) => stroke.slice(1).some((point, index) => pointKey(point) === pointKey(stroke[index])))) return null;
  const strokeWidth = parseMetric(paint.strokeWidth) * scale * unitScale * sx;
  if (roundedMetric(strokeWidth) <= 0) return null;
  const style = {
    ...cssStyleToSceneStyle({
      fill: "none",
      stroke: paint.stroke,
      strokeWidth,
      strokeDasharray: "none",
      strokeOpacity: paint.strokeOpacity,
      opacity: localOpacity(marker) * localOpacity(outline),
    }, options),
    fill: null,
    dash: "solid",
    lineCap: "butt",
  };
  if (geometry.kind === "cross" && effectiveStrokeAlpha(style) < 1) return null;
  return {
    kind: geometry.kind, placement, strokes,
    style,
  };
}

function connectorMarkers(element, deck, options) {
  const style = getComputedStyle(element);
  const start = style.markerStart || element.getAttribute("marker-start");
  const end = style.markerEnd || element.getAttribute("marker-end");
  const arrowStart = connectorArrow(start, element, "start");
  const arrowEnd = connectorArrow(end, element, "end");
  const parts = [start, end].map((value, index) => {
    if (!value || value === "none" || (index === 0 ? arrowStart : arrowEnd) !== "none") return null;
    return markerParts(value, element, index === 0 ? "start" : "end", deck, options);
  });
  return {
    arrowStart,
    arrowEnd,
    parts: parts.filter(Boolean),
    unsupported: [[start, arrowStart], [end, arrowEnd]].some(([value, arrow], index) => value && value !== "none" && arrow === "none" && !parts[index]) ||
      // Attached arrow presets paint with the main line. An explicit start must
      // precede an attached end marker, which that representation cannot ensure.
      Boolean(parts[0] && arrowEnd !== "none") ||
      Boolean(style.markerMid && style.markerMid !== "none"),
  };
}

function markedConnector(connector, markers, element, options) {
  if (!markers.parts.length) return connector;
  const children = [{ ...connector, sourcePath: `${connector.sourcePath}.line` }];
  for (const marker of markers.parts) {
    for (const [index, points] of marker.strokes.entries()) children.push({
      kind: "connector", sourcePath: `${connector.sourcePath}.markers.${marker.placement}[${index}]`,
      points, style: marker.style, arrowStart: "none", arrowEnd: "none",
      meta: { mermaid: { kind: "marker", shape: marker.kind, placement: marker.placement } },
    });
  }
  const points = children.flatMap((child) => child.points);
  const bounds = { x: Math.min(...points.map((point) => point.x)), y: Math.min(...points.map((point) => point.y)) };
  bounds.width = Math.max(...points.map((point) => point.x)) - bounds.x;
  bounds.height = Math.max(...points.map((point) => point.y)) - bounds.y;
  for (const child of children) {
    options.sourceElements.set(child.sourcePath, element);
    child.points = child.points.map((point) => ({ x: point.x - bounds.x, y: point.y - bounds.y }));
  }
  return { ...compositeGroup(connector.sourcePath, connector.z, bounds, children, "marked-connector"),
    meta: { mermaid: { kind: "marked-edge" } } };
}

function nodeText(group, deck, options) {
  const label = labelInfo(group, "span.nodeLabel, text", deck, options);
  return {
    label,
    ...(label ? { text: label.text } : {}),
    ...(label?.rotation !== undefined ? { rotation: label.rotation } : {}),
    textLayout: { alignment: "center", verticalAlignment: "middle", textWrap: "none" },
  };
}

function paintedPathStyle(paths, options) {
  const fill = paths.find((path) => getComputedStyle(path).fill !== "none") || paths[0];
  const stroke = paths.find((path) => getComputedStyle(path).stroke !== "none") || fill;
  const fillStyle = computedSvgStyle(fill, options);
  return {
    ...computedSvgStyle(stroke, options),
    fill: fillStyle.fill,
    ...(fillStyle.fillOpacity !== undefined ? { fillOpacity: fillStyle.fillOpacity } : {}),
  };
}

function compatiblePathPaint(paths, options) {
  const style = paintedPathStyle(paths, options);
  return style.dash === "solid" && paths.every((path) => {
    const paint = computedSvgStyle(path, options);
    return paint.opacity === style.opacity &&
      (!paint.fill || (paint.fill === style.fill && paint.fillOpacity === style.fillOpacity)) &&
      (!paint.stroke || (paint.stroke === style.stroke && paint.strokeWidth === style.strokeWidth &&
        paint.strokeOpacity === style.strokeOpacity && paint.dash === style.dash));
  });
}

function compositeGroup(sourcePath, z, bounds, children, shape, kind = "node") {
  return {
    kind: "group", sourcePath, z, bounds,
    children: children.map((child, index) => ({ ...child, z: z + (index + 1) / (children.length + 1) })),
    style: { fill: null, stroke: null, strokeWidth: 0 },
    meta: { mermaid: { kind, shape } },
  };
}

function stadiumParts(shape, group, sourcePath, z, deck, options) {
  const bounds = boundsOf(shape, deck);
  const style = paintedPathStyle(directChildren(shape, "path"), options);
  if (!opaqueCompositeStyle(style) || !compatiblePathPaint(directChildren(shape, "path"), options)) {
    return fallbackNode(group, z, deck, "unsupported-mermaid-composite-paint", sourcePath);
  }
  const radius = bounds.height / 2;
  const children = [0, bounds.width - bounds.height].map((x, index) => ({
    kind: "shape", sourcePath: `${sourcePath}.parts[${index}]`, z: index,
    bounds: { x, y: 0, width: bounds.height, height: bounds.height },
    preset: "ellipse", style,
  }));
  children.push({
    kind: "shape", sourcePath: `${sourcePath}.parts[2]`, z: 2,
    bounds: { x: radius, y: 0, width: bounds.width - bounds.height, height: bounds.height },
    preset: "rect", style: { ...style, stroke: null, strokeWidth: 0 },
  });
  for (const y of [0, bounds.height]) children.push({
    kind: "connector", sourcePath: `${sourcePath}.parts[${children.length}]`, z: children.length,
    points: [{ x: radius, y }, { x: bounds.width - radius, y }], style: { ...style, fill: null },
  });
  const label = labelInfo(group, "span.nodeLabel, text", deck, options);
  if (label?.unsupportedTransform) {
    return fallbackNode(group, z, deck, "unsupported-mermaid-node-label-transform", sourcePath);
  }
  if (label) children.push({
    kind: "text", sourcePath: `${sourcePath}.label`, z: children.length,
    bounds: relativeBounds(label.bounds, bounds), text: label.text,
    textLayout: { alignment: "center", verticalAlignment: "middle", textWrap: "none" },
    ...(label.rotation !== undefined ? { rotation: label.rotation } : {}),
  });
  if (label) options.sourceElements.set(`${sourcePath}.label`, label.element);
  return compositeGroup(sourcePath, z, bounds, children, "stadium");
}

function opaqueCompositeStyle(style, requireFill = true) {
  return (!requireFill || style.fill) &&
    style.dash === "solid" &&
    (!style.fill || effectiveFillAlpha(style) === 1) &&
    (!style.stroke || style.strokeWidth === 0 || effectiveStrokeAlpha(style) === 1);
}

function isStadiumPath(path) {
  const box = path.getBBox();
  const radius = box.height / 2;
  if (radius <= 0 || box.width < box.height) return false;
  const length = path.getTotalLength();
  const start = path.getPointAtLength(0);
  const end = path.getPointAtLength(length);
  if (Math.hypot(start.x - end.x, start.y - end.y) > 0.01) return false;
  for (let index = 0; index < 64; index += 1) {
    const point = path.getPointAtLength(length * index / 64);
    const x = point.x - box.x;
    const y = point.y - box.y;
    const distance = x < radius ? Math.abs(Math.hypot(x - radius, y - radius) - radius)
      : x > box.width - radius ? Math.abs(Math.hypot(x - box.width + radius, y - radius) - radius)
      : Math.min(Math.abs(y), Math.abs(y - box.height));
    if (distance > 0.25) return false;
  }
  return true;
}

function matchingOutline(path, reference, distanceFromOutline) {
  const bounds = path.getBBox();
  const expected = reference.getBBox();
  const screen = path.getScreenCTM();
  const referenceScreen = reference.getScreenCTM();
  if (["a", "b", "c", "d", "e", "f"].some((key) => Math.abs(screen[key] - referenceScreen[key]) > 0.001) ||
      ["x", "y", "width", "height"].some((key) => Math.abs(bounds[key] - expected[key]) > 0.25)) return false;
  const length = path.getTotalLength();
  if (!Number.isFinite(length) || length <= 0) return false;
  for (let index = 0; index <= 128; index += 1) {
    const point = path.getPointAtLength(length * index / 128);
    if (distanceFromOutline(point, expected) > 0.25) return false;
  }
  return true;
}

function matchingStadiumOutline(path, reference) {
  return matchingOutline(path, reference, (point, box) => {
    const radius = box.height / 2;
    const x = point.x - box.x;
    const y = point.y - box.y;
    return x < radius ? Math.abs(Math.hypot(x - radius, y - radius) - radius)
      : x > box.width - radius ? Math.abs(Math.hypot(x - box.width + radius, y - radius) - radius)
      : Math.min(Math.abs(y), Math.abs(y - box.height));
  });
}

function subroutineGeometry(shape) {
  const points = parsePoints(shape.getAttribute("points"));
  if (points.length !== 10) return null;
  const [a, b, c, d, e, f, g, h, i, j] = points;
  const height = a.y - d.y;
  const width = b.x - a.x;
  const tolerance = Math.max(0.01, Math.max(Math.abs(width), Math.abs(height)) * 0.0001);
  const same = (left, right) => closeMetric(left, right, tolerance);
  if (!(width > 0 && height > 0) ||
      !same(a.y, b.y) || !same(b.x, c.x) || !same(c.y, d.y) || !same(d.x, a.x) ||
      !same(e.x, a.x) || !same(e.y, a.y) ||
      !same(f.x, a.x - 8) || !same(f.y, a.y) ||
      !same(g.x, b.x + 8) || !same(g.y, a.y) ||
      !same(h.x, g.x) || !same(h.y, d.y) ||
      !same(i.x, f.x) || !same(i.y, d.y) ||
      !same(j.x, f.x) || !same(j.y, f.y)) return null;
  return { left: a.x, right: b.x, top: d.y, bottom: a.y };
}

function subroutineParts(shape, group, sourcePath, z, deck, options) {
  const geometry = subroutineGeometry(shape);
  if (!geometry) return null;
  const style = computedSvgStyle(shape, options);
  const connectorStyle = computedConnectorStyle(shape, options);
  if (!opaqueCompositeStyle(style, false)) {
    return fallbackNode(group, z, deck, "unsupported-mermaid-composite-paint", sourcePath);
  }
  const bounds = boundsOf(shape, deck);
  const children = [{
    kind: "shape", sourcePath: `${sourcePath}.parts[0]`, z: 0,
    bounds: { x: 0, y: 0, width: bounds.width, height: bounds.height },
    preset: "rect", style,
  }];
  if (style.stroke && style.strokeWidth !== 0) {
    for (const x of [geometry.left, geometry.right]) {
      const top = screenPoint(shape, { x, y: geometry.top }, deck);
      const bottom = screenPoint(shape, { x, y: geometry.bottom }, deck);
      children.push({
        kind: "connector", sourcePath: `${sourcePath}.parts[${children.length}]`, z: children.length,
        points: [top, bottom].map((point) => ({ x: point.x - bounds.x, y: point.y - bounds.y })),
        style: { ...connectorStyle, lineCap: "butt" },
        arrowStart: "none",
        arrowEnd: "none",
      });
    }
  }
  const label = labelInfo(group, "span.nodeLabel, text", deck, options);
  if (label?.unsupportedTransform) {
    return fallbackNode(group, z, deck, "unsupported-mermaid-node-label-transform", sourcePath);
  }
  if (label) children.push({
    kind: "text", sourcePath: `${sourcePath}.label`, z: children.length,
    bounds: relativeBounds(label.bounds, bounds), text: label.text,
    textLayout: { alignment: "center", verticalAlignment: "middle", textWrap: "none" },
    ...(label.rotation !== undefined ? { rotation: label.rotation } : {}),
  });
  if (label) options.sourceElements.set(`${sourcePath}.label`, label.element);
  return compositeGroup(sourcePath, z, bounds, children, "subroutine");
}

function cylinderParts(path, group, sourcePath, z, deck, options) {
  const d = path.getAttribute("d") || "";
  // The pinned renderer draws a cylinder with move, arc, arc, line, arc, line.
  if (d.replace(/[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?|[\s,]/gi, "") !== "Maalal") return null;
  const numbers = d.match(/[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/gi)?.map(Number) || [];
  if (numbers.length !== 27) return null;
  const [x, ry, rx] = numbers;
  if ([2, 9, 18].some((offset) => numbers[offset + 2] !== 0 ||
      numbers[offset + 3] !== 0 || numbers[offset + 4] !== 0)) return null;
  if (x !== 0 || rx <= 0 || ry <= 0 ||
      numbers[3] !== ry || numbers[7] !== 2 * rx || numbers[8] !== 0 ||
      numbers[9] !== rx || numbers[10] !== ry || numbers[14] !== -2 * rx ||
      numbers[15] !== 0 || numbers[16] !== 0 || numbers[18] !== rx ||
      numbers[19] !== ry || numbers[23] !== 2 * rx || numbers[24] !== 0 ||
      numbers[25] !== 0 || numbers[26] !== -numbers[17]) return null;
  const bounds = boundsOf(path, deck);
  const capHeight = 2 * ry * bounds.height / path.getBBox().height;
  if (capHeight <= 0 || capHeight >= bounds.height) return null;
  const style = computedSvgStyle(path, options);
  if (!opaqueCompositeStyle(style)) {
    return fallbackNode(group, z, deck, "unsupported-mermaid-composite-paint", sourcePath);
  }
  const children = [];
  const addShape = (preset, partBounds, partStyle) => children.push({
    kind: "shape", sourcePath: `${sourcePath}.parts[${children.length}]`, z: children.length,
    preset, bounds: partBounds, style: partStyle,
  });
  addShape("ellipse", { x: 0, y: bounds.height - capHeight, width: bounds.width, height: capHeight }, style);
  addShape("rect", { x: 0, y: capHeight / 2, width: bounds.width, height: bounds.height - capHeight },
    { ...style, stroke: null, strokeWidth: 0 });
  for (const side of [0, bounds.width]) children.push({
    kind: "connector", sourcePath: `${sourcePath}.parts[${children.length}]`, z: children.length,
    points: [{ x: side, y: capHeight / 2 }, { x: side, y: bounds.height - capHeight / 2 }],
    style: { ...style, fill: null },
  });
  addShape("ellipse", { x: 0, y: 0, width: bounds.width, height: capHeight }, style);
  const label = labelInfo(group, "span.nodeLabel, text", deck, options);
  if (label?.unsupportedTransform) {
    return fallbackNode(group, z, deck, "unsupported-mermaid-node-label-transform", sourcePath);
  }
  if (label) children.push({
    kind: "text", sourcePath: `${sourcePath}.label`, z: children.length,
    bounds: relativeBounds(label.bounds, bounds), text: label.text,
    textLayout: { alignment: "center", verticalAlignment: "middle", textWrap: "none" },
    ...(label.rotation !== undefined ? { rotation: label.rotation } : {}),
  });
  if (label) options.sourceElements.set(`${sourcePath}.label`, label.element);
  return compositeGroup(sourcePath, z, bounds, children, "cylinder");
}

function nodeShape(group, sourceIndex, z, deck, options, config = {}) {
  const sourcePath = nonEmptyStringOr(config.sourcePath, `nodes[${sourceIndex}]`);
  const mermaidKind = nonEmptyStringOr(config.kind, "node");
  const labelKind = nonEmptyStringOr(config.labelKind, "node-label");
  if (unsupportedVisualEffect(group) || group.querySelector("img, image, svg, .katex, use")) {
    return fallbackNode(group, z, deck, "unsupported-mermaid-node-content", sourcePath);
  }
  const shape = directChildren(group).find((child) => hasClass(child, "label-container"));
  if (!shape) return fallbackNode(group, z, deck, "unsupported-mermaid-node-structure", sourcePath);
  if (directChildren(group).some((child) => child !== shape && !hasClass(child, "label"))) {
    return fallbackNode(group, z, deck, "unsupported-mermaid-node-shape", sourcePath);
  }
  const initialPreset = shapePresetFor(shape);
  if (["trapezoid", "invertedTrapezoid", "reverseParallelogram"].includes(initialPreset) &&
      !hasUniformAxisAlignedScale(shape)) {
    return fallbackNode(group, z, deck, "unsupported-mermaid-height-based-shape-transform", sourcePath);
  }
  if (unsupportedAxisAlignedTransform(shape)) {
    return fallbackNode(group, z, deck, "unsupported-mermaid-node-transform", sourcePath);
  }
  if (localName(shape) === "path") {
    const cylinder = cylinderParts(shape, group, sourcePath, z, deck, options);
    if (cylinder) return cylinder;
  }
  if (localName(shape) === "polygon") {
    const subroutine = subroutineParts(shape, group, sourcePath, z, deck, options);
    if (subroutine) return subroutine;
  }
  if (localName(shape) === "g") {
    const circles = directChildren(shape, "circle");
    if (circles.length === 2 && directChildren(shape).length === 2 &&
        hasClass(circles[0], "outer-circle") && hasClass(circles[1], "inner-circle")) {
      const bounds = boundsOf(shape, deck);
      const nodeLabel = nodeText(group, deck, options);
      if (nodeLabel.label?.unsupportedTransform) {
        return fallbackNode(group, z, deck, "unsupported-mermaid-node-label-transform", sourcePath);
      }
      const children = circles.map((circle, index) => ({
        kind: "shape", sourcePath: `${sourcePath}.circles[${index}]`, z: index,
        bounds: relativeBounds(boundsOf(circle, deck), bounds), preset: "ellipse",
        style: computedSvgStyle(circle, options),
        ...(index === 1 && nodeLabel.label?.rotation === undefined
          ? { text: nodeLabel.text, textLayout: nodeLabel.textLayout }
          : {}),
      }));
      if (nodeLabel.label?.rotation !== undefined) {
        children.push({
          kind: "text",
          sourcePath: `${sourcePath}.label`,
          z: children.length,
          bounds: relativeBounds(nodeLabel.label.bounds, bounds),
          text: nodeLabel.text,
          textLayout: nodeLabel.textLayout,
          rotation: nodeLabel.label.rotation,
        });
        options.sourceElements.set(`${sourcePath}.label`, nodeLabel.label.element);
      }
      return compositeGroup(sourcePath, z, bounds, children, "double-circle", mermaidKind);
    }
    const paths = directChildren(shape, "path");
    if (paths.length === 2 && directChildren(shape).length === 2 && isStadiumPath(paths[0]) &&
        matchingStadiumOutline(paths[1], paths[0])) {
      return stadiumParts(shape, group, sourcePath, z, deck, options);
    }
  }
  const preset = initialPreset;
  if (!preset || directChildren(group).some((child) => child !== shape && !hasClass(child, "label"))) {
    return fallbackNode(group, z, deck, "unsupported-mermaid-node-shape", sourcePath);
  }
  const label = labelInfo(group, "span.nodeLabel, text", deck, options);
  const bounds = boundsOf(shape, deck);
  if (label?.rotation !== undefined || label?.unsupportedTransform) {
    const shapePath = `${sourcePath}.shape`;
    const labelPath = `${sourcePath}.label`;
    options.sourceElements.set(shapePath, shape);
    options.sourceElements.set(labelPath, label.element);
    const children = [{
      kind: "shape",
      id: group.getAttribute("id") || undefined,
      sourcePath: shapePath,
      z: 0,
      bounds: { x: 0, y: 0, width: bounds.width, height: bounds.height },
      preset,
      style: computedSvgStyle(shape, options),
      meta: {
        mermaid: definedEntries({
          kind: mermaidKind,
          tag: localName(shape),
          polygonSignature: localName(shape) === "polygon"
            ? polygonPointsSignature(shape.getAttribute("points"))
            : undefined,
        }),
      },
    }];
    children.push(label.unsupportedTransform
      ? relativeFallbackNode(
          label.element,
          1,
          deck,
          "unsupported-mermaid-text-transform",
          labelPath,
          bounds,
        )
      : {
          kind: "text",
          sourcePath: labelPath,
          z: 1,
          bounds: relativeBounds(label.bounds, bounds),
          text: label.text,
          textLayout: { alignment: "center", verticalAlignment: "middle", textWrap: "none" },
          rotation: label.rotation,
          meta: { mermaid: { kind: labelKind } },
        });
    return compositeGroup(sourcePath, z, bounds, children, localName(shape), mermaidKind);
  }
  return definedEntries({
    kind: "shape",
    id: group.getAttribute("id") || undefined,
    sourcePath,
    z,
    bounds,
    preset,
    style: computedSvgStyle(shape, options),
    text: label?.text,
    textLayout: {
      alignment: "center",
      verticalAlignment: "middle",
      textWrap: "none",
    },
    meta: {
      mermaid: definedEntries({
        kind: mermaidKind,
        tag: localName(shape),
        polygonSignature: localName(shape) === "polygon" ? polygonPointsSignature(shape.getAttribute("points")) : undefined,
      }),
    },
  });
}

function clusterGroup(group, sourceIndex, z, deck, options) {
  const sourcePath = `clusters[${sourceIndex}]`;
  const rect = directChildren(group, "rect")[0];
  if (!rect) return fallbackNode(group, z, deck, "unsupported-mermaid-cluster-structure", sourcePath);
  if (unsupportedVisualEffect(group) || group.querySelector("img, image, svg, .katex, use") ||
      directChildren(group).some((child) => child !== rect && !hasClass(child, "cluster-label"))) {
    return fallbackNode(group, z, deck, "unsupported-mermaid-cluster-content", sourcePath);
  }
  if (!hasUniformAxisAlignedScale(rect)) {
    return fallbackNode(group, z, deck, "unsupported-mermaid-cluster-transform", sourcePath);
  }
  const label = labelInfo(group, "span.nodeLabel", deck, options);
  const bounds = boundsOf(rect, deck);
  if (label?.rotation !== undefined || label?.unsupportedTransform) {
    const labelPath = `${sourcePath}.label`;
    options.sourceElements.set(sourcePath, rect);
    options.sourceElements.set(labelPath, label.element);
    return {
      kind: "group",
      id: group.getAttribute("id") || undefined,
      sourcePath,
      z,
      bounds,
      children: [
        label.unsupportedTransform
          ? relativeFallbackNode(
              label.element,
              0,
              deck,
              "unsupported-mermaid-text-transform",
              labelPath,
              bounds,
            )
          : {
              kind: "text",
              sourcePath: labelPath,
              z: 0,
              bounds: relativeBounds(label.bounds, bounds),
              text: label.text,
              textLayout: {
                alignment: "center",
                verticalAlignment: "middle",
                textWrap: "none",
              },
              rotation: label.rotation,
              meta: { mermaid: { kind: "cluster-label" } },
            },
      ],
      style: computedSvgStyle(rect, options),
      meta: { mermaid: { kind: "cluster" } },
    };
  }
  return definedEntries({
    kind: "group",
    id: group.getAttribute("id") || undefined,
    sourcePath,
    z,
    bounds,
    children: [],
    style: computedSvgStyle(rect, options),
    text: label?.text,
    textLayout: {
      alignment: "center",
      verticalAlignment: "top",
      textWrap: "none",
      textInsets: { left: 4, top: 4, right: 4, bottom: 4 },
    },
    meta: { mermaid: { kind: "cluster" } },
  });
}

function screenPoint(svg, point, deck) {
  const matrix = svg.getScreenCTM();
  const transformed = matrix ? new DOMPoint(point.x, point.y).matrixTransform(matrix) : point;
  const rect = deck.getBoundingClientRect();
  return {
    x: roundedMetric(transformed.x - rect.left),
    y: roundedMetric(transformed.y - rect.top),
  };
}

function sampledPathPoints(path, deck, options) {
  const total = path.getTotalLength();
  const sampleCount = Math.max(2, Math.round(total / Math.max(1, options.sampleStep)) + 1);
  if (!Number.isFinite(total) || sampleCount > MAX_SCENE_NODES) throw new Error("path sampling limit exceeded");
  const raw = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const distance = total * (index / (sampleCount - 1));
    raw.push(screenPoint(path, path.getPointAtLength(distance), deck));
  }
  return {
    raw,
    simplified: simplifyPolyline(raw, options.simplifyTolerance),
  };
}

function connectorPath(path, sourcePath, z, deck, options) {
  try {
    const markers = connectorMarkers(path, deck, options);
    if (unsupportedVisualEffect(path) || markers.unsupported) {
      return fallbackNode(path, z, deck, "unsupported-mermaid-edge-style", sourcePath);
    }
    if (!supportsConnectorTransform(path)) {
      return fallbackNode(path, z, deck, "unsupported-mermaid-edge-transform", sourcePath);
    }
    // Sampling across multiple subpaths joins disconnected strokes with invented lines.
    const commands = renderedPathData(path).match(/[a-df-z]/gi) || [];
    if (commands.filter((command) => command.toLowerCase() === "m").length !== 1 ||
        commands.some((command) => command.toLowerCase() === "z")) {
      return fallbackNode(path, z, deck, "unsupported-mermaid-edge-path", sourcePath);
    }
    const points = sampledPathPoints(path, deck, options);
    if (points.simplified.length < 2 || pointKey(points.raw[0]) === pointKey(points.raw.at(-1))) {
      return fallbackNode(path, z, deck, "unsupported-mermaid-edge-path", sourcePath);
    }
    const id = path.getAttribute("data-id") || path.getAttribute("id") || "";
    return markedConnector(definedEntries({
      kind: "connector",
      id: path.getAttribute("id") || undefined,
      sourcePath,
      z,
      points: points.simplified,
      style: computedSvgStyle(path, options),
      arrowStart: markers.arrowStart,
      arrowEnd: markers.arrowEnd,
      meta: {
        mermaid: {
          kind: "edge",
          id,
          rawPointCount: points.raw.length,
          simplifiedPointCount: points.simplified.length,
        },
      },
    }), markers, path, options);
  } catch (error) {
    return fallbackNode(path, z, deck, `unsupported-mermaid-edge-path: ${error?.message || "path sampling failed"}`, sourcePath);
  }
}

function hasAncestorInSet(element, set) {
  for (let current = element; current; current = current.parentElement) {
    if (set?.has(current)) return true;
  }
  return false;
}

function readEdgeLabels(root, deck, options, consumed, config = {}) {
  const labels = new Map();
  const selector = config.recursive
    ? "g.edgeLabels > g.edgeLabel, g.edgeLabels > g.edgeTerminals"
    : ":scope > g.edgeLabels > g.edgeLabel, :scope > g.edgeLabels > g.edgeTerminals";
  for (const [index, group] of [...root.querySelectorAll(selector)].entries()) {
    if (hasAncestorInSet(group, config.blocked || consumed)) continue;
    consumed?.add(group);
    const terminal = hasClass(group, "edgeTerminals");
    const labelGroup = group.querySelector(":scope > g.label");
    const id = labelGroup?.getAttribute("data-id") || "";
    let key = id || `unidentified-${index}`;
    while (labels.has(key)) key += `-${index}`;
    const collection = terminal ? "edgeTerminals" : "edgeLabels";
    const sourcePath = config.sourcePathPrefix
      ? `${config.sourcePathPrefix}.${collection}[${key}]`
      : `${collection}[${key}]`;
    options.sourceElements?.set(sourcePath, group);
    const extra = terminal ? group.cloneNode(true) : null;
    extra?.querySelectorAll("span.edgeLabel, text").forEach((label) => label.remove());
    if (group.querySelector("img, image, svg, .katex, use, path, line, polygon, polyline, circle, ellipse, rect") ||
        (terminal && (group.querySelectorAll("span.edgeLabel, text").length > 1 || extra.textContent.trim())) ||
        unsupportedVisualEffect(group)) {
      labels.set(key, { fallback: fallbackNode(group, 0, deck,
        "unsupported-mermaid-edge-label", sourcePath) });
      continue;
    }
    const label = labelInfo(group, "span.edgeLabel, text", deck, options);
    const background = group.querySelector(".edgeLabel p, span.edgeLabel, rect");
    const backgroundStyle = background && getComputedStyle(background);
    if (label && label.bounds.width > 0 && label.bounds.height > 0) {
      const fill = normalizeColor(backgroundStyle?.backgroundColor === "rgba(0, 0, 0, 0)"
        ? (background?.localName === "rect" ? backgroundStyle.fill : null)
        : backgroundStyle?.backgroundColor, options.resolveColor);
      const svgPaint = background?.namespaceURI === SVG_NS
        ? computedSvgStyle(background, options)
        : null;
      const opacity = background ? effectiveOpacity(background) : 1;
      if (label.unsupportedTransform || (label.rotation !== undefined && fill)) {
        labels.set(key, { fallback: fallbackNode(group, 0, deck,
          "unsupported-mermaid-edge-label", sourcePath) });
        continue;
      }
      if (label.rotation !== undefined) options.sourceElements?.set(sourcePath, label.element);
      labels.set(key, {
        ...label,
        sourcePath,
        terminal,
        style: definedEntries({
          fill,
          stroke: null,
          strokeWidth: 0,
          fillOpacity: svgPaint?.fillOpacity,
          opacity: opacity === 1 ? undefined : opacity,
        }),
      });
    } else if (group.textContent.trim() || [...group.querySelectorAll("rect, path, image, use")].some(isVisibleUnknown)) {
      labels.set(key, { fallback: fallbackNode(group, 0, deck, "unsupported-mermaid-edge-label", sourcePath) });
    }
  }
  return labels;
}

function isKnownContainer(element) {
  return (
    hasClass(element, "root") ||
    hasClass(element, "clusters") ||
    hasClass(element, "edgePaths") ||
    hasClass(element, "edgeLabels") ||
    hasClass(element, "edgeLabel") ||
    hasClass(element, "label") ||
    hasClass(element, "nodes")
  );
}

function isVisibleUnknown(element) {
  if (IGNORED_TAGS.has(tagName(element)) || IGNORED_TAGS.has(localName(element))) return false;
  if (isKnownContainer(element)) return false;
  if (!VISUAL_TAGS.has(localName(element)) && localName(element) !== "g") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

function isVisibleVisualSubtree(element) {
  if (IGNORED_TAGS.has(tagName(element)) || IGNORED_TAGS.has(localName(element)) ||
      getComputedStyle(element).display === "none" ||
      (!VISUAL_TAGS.has(localName(element)) && localName(element) !== "g")) return false;
  const elements = [element, ...element.querySelectorAll([...VISUAL_TAGS].join(","))];
  return elements.some((candidate) => {
    const rect = candidate.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  });
}

function collectUnexpectedVisuals(
  container,
  deck,
  startZ,
  sourcePath,
  consumed = new Set(),
  options = {},
  config = {},
) {
  const fallbacks = [];
  const depthLimit = Number.isInteger(config.depthLimit) ? config.depthLimit : Number.POSITIVE_INFINITY;
  const walk = (element, depth) => {
    if (consumed.has(element)) return;
    if (IGNORED_TAGS.has(tagName(element)) || IGNORED_TAGS.has(localName(element))) return;
    if (getComputedStyle(element).display === "none") return;
    const containsConsumed = [...consumed].some((child) => element.contains(child));
    if (!containsConsumed && depth > depthLimit && isVisibleVisualSubtree(element)) {
      const path = `${sourcePath}.unknown[${fallbacks.length}]`;
      const reason = nonEmptyStringOr(config.depthReason, "unsupported-mermaid-svg-depth");
      options.sourceElements?.set(path, element);
      fallbacks.push(fallbackNode(element, startZ + fallbacks.length, deck, reason, path));
      return;
    }
    if (!containsConsumed && isVisibleUnknown(element)) {
      const path = `${sourcePath}.unknown[${fallbacks.length}]`;
      options.sourceElements?.set(path, element);
      if (localName(element) === "text" && !element.querySelector(":not(tspan)") &&
          !unsupportedVisualEffect(element)) {
        fallbacks.push(measuredText(element, path, startZ + fallbacks.length, deck, options));
      } else {
        const reason = unsupportedAxisAlignedTransform(element, false)
          ? "unsupported-mermaid-svg-element-transform"
          : "unsupported-mermaid-svg-element";
        fallbacks.push(fallbackNode(element, startZ + fallbacks.length, deck, reason, path));
      }
      return;
    }
    for (const child of directChildren(element)) walk(child, depth + 1);
  };
  for (const child of directChildren(container)) walk(child, 1);
  return fallbacks;
}

function appendEdgeLabels(nodes, labels) {
  for (const [id, label] of labels) {
    if (label.fallback) nodes.push({ ...label.fallback, z: nodes.length });
    else if (label.rotation !== undefined) {
      nodes.push({
        kind: "text", sourcePath: label.sourcePath, z: nodes.length,
        bounds: label.bounds, text: label.text, rotation: label.rotation,
        textLayout: { alignment: "center", verticalAlignment: "middle", textWrap: "none" },
        meta: { mermaid: { kind: label.terminal ? "edge-terminal" : "edge-label", edgeId: id } },
      });
    } else {
      nodes.push({
        kind: "shape", sourcePath: label.sourcePath, z: nodes.length,
        bounds: label.bounds, preset: "rect", style: label.style,
        text: label.text,
        textLayout: { alignment: "center", verticalAlignment: "middle", textWrap: "none" },
        meta: { mermaid: { kind: label.terminal ? "edge-terminal" : "edge-label", edgeId: id } },
      });
    }
  }
}

function diagramScene(svg, size, options, nodes) {
  return {
    scene: createScene({
      ...size, source: { kind: "mermaid", path: options.path },
      accessibility: { title: svg.getAttribute("aria-label") || svg.getAttribute("aria-roledescription") || "Mermaid" },
      nodes,
    }),
    diagnostics: [],
  };
}

function unsupportedContainers(root, deck, nodes, options) {
  const consumed = new Set();
  for (const [index, container] of directChildren(root, "g").entries()) {
    if (!isKnownContainer(container)) continue;
    const reason = unsupportedVisualEffect(container, false)
      ? "unsupported-mermaid-container-style"
      : isClassCollection(container) && !hasUniformAxisAlignedScale(container)
        ? "unsupported-mermaid-container-transform"
        : "";
    if (!reason) continue;
    const sourcePath = `root.containers[${index}]`;
    consumed.add(container);
    options.sourceElements.set(sourcePath, container);
    nodes.push(fallbackNode(container, nodes.length, deck, reason, sourcePath));
  }
  return consumed;
}

function preservePaintOrder(nodes, sourceElements) {
  nodes.sort((left, right) => {
    const a = sourceElements.get(left.sourcePath);
    const b = sourceElements.get(right.sourcePath);
    if (!a || !b || a === b) return left.z - right.z;
    const position = a.compareDocumentPosition(b);
    return position & 4 ? -1 : position & 2 ? 1 : left.z - right.z;
  });
  const assignZ = (node, z, span) => {
    node.z = z;
    node.children?.forEach((child, index, children) =>
      assignZ(child, z + (index + 1) * span / (children.length + 1), span / (children.length + 1)));
  };
  nodes.forEach((node, index) => assignZ(node, index, 1));
}

function measuredText(element, sourcePath, z, deck, options, meta) {
  const geometry = measuredTextGeometry(element, deck);
  if (!geometry) {
    return fallbackNode(element, z, deck, "unsupported-mermaid-text-transform", sourcePath);
  }
  return definedEntries({
    kind: "text", sourcePath, z, bounds: geometry.bounds,
    text: structuredLabelText(element, options),
    textLayout: { alignment: "center", verticalAlignment: "middle", textWrap: "none" },
    rotation: geometry.rotation,
    meta,
  });
}

function simpleDiagramText(element, sourcePath, z, deck, options, meta, styleReason) {
  const bounds = boundsOf(element, deck);
  if (!(bounds.width > 0 || bounds.height > 0) && !element.textContent?.trim()) return null;
  if (unsupportedVisualEffect(element)) {
    return fallbackNode(element, z, deck, styleReason, sourcePath);
  }
  return measuredText(element, sourcePath, z, deck, options, meta);
}

function simpleDiagramShape(element, sourcePath, z, deck, options, meta, reasons) {
  const preset = shapePresetFor(element);
  if (!preset) return fallbackNode(element, z, deck, reasons.geometry, sourcePath);
  if (unsupportedVisualEffect(element)) {
    return fallbackNode(element, z, deck, reasons.style, sourcePath);
  }
  if (!hasUniformAxisAlignedScale(element)) {
    return fallbackNode(element, z, deck, reasons.transform, sourcePath);
  }
  return definedEntries({
    kind: "shape",
    id: element.getAttribute("id") || undefined,
    sourcePath,
    z,
    bounds: boundsOf(element, deck),
    preset,
    style: computedSvgStyle(element, options),
    meta,
  });
}

function simpleDiagramLine(element, sourcePath, z, deck, options, meta, reasons) {
  const coordinates = numericAttributes(element, ["x1", "y1", "x2", "y2"]);
  const style = getComputedStyle(element);
  if (!coordinates) return fallbackNode(element, z, deck, reasons.geometry, sourcePath);
  if (unsupportedVisualEffect(element) ||
      [style.markerStart, style.markerMid, style.markerEnd].some((value) => value && value !== "none")) {
    return fallbackNode(element, z, deck, reasons.style, sourcePath);
  }
  if (!decomposeSimpleSvgTransform(element.getScreenCTM?.())) {
    return fallbackNode(element, z, deck, reasons.transform, sourcePath);
  }
  const [x1, y1, x2, y2] = coordinates;
  const points = [
    screenPoint(element, { x: x1, y: y1 }, deck),
    screenPoint(element, { x: x2, y: y2 }, deck),
  ];
  if (pointKey(points[0]) === pointKey(points[1])) {
    return fallbackNode(element, z, deck, reasons.geometry, sourcePath);
  }
  return {
    kind: "connector",
    id: element.getAttribute("id") || undefined,
    sourcePath,
    z,
    points,
    style: computedConnectorStyle(element, options),
    arrowStart: "none",
    arrowEnd: "none",
    meta,
  };
}

function numericAttributes(element, names) {
  const rawValues = names.map((name) => element.getAttribute(name));
  if (rawValues.some((value) => value === null)) return null;
  const values = rawValues.map(Number);
  return values.every(Number.isFinite) ? values : null;
}

function sameMetric(left, right, tolerance = 0.01) {
  return Math.abs(left - right) <= tolerance;
}

function hasUniformAxisAlignedScale(element) {
  const transform = decomposeSimpleSvgTransform(element?.getScreenCTM?.());
  return Boolean(transform) && transform.rotation === 0;
}

function supportsConnectorTransform(element) {
  const matrix = element?.getScreenCTM?.();
  return Boolean(matrix) &&
    ["a", "b", "c", "d", "e", "f"].every((key) =>
      typeof matrix[key] === "number" && Number.isFinite(matrix[key])) &&
    matrix.a > 0 &&
    matrix.d > 0 &&
    Math.abs(matrix.b) <= 0.001 &&
    Math.abs(matrix.c) <= 0.001;
}

function unsupportedAxisAlignedTransform(element, descendants = true) {
  return [element, ...(descendants ? element.querySelectorAll("*") : [])].some((child) => {
    if (child.namespaceURI !== SVG_NS || typeof child.getScreenCTM !== "function") return false;
    return !hasUniformAxisAlignedScale(child);
  });
}

function sequenceActorInfo(group) {
  if (!hasClass(group, "actor-man")) return null;
  const placement = hasClass(group, "actor-top") ? "top"
    : hasClass(group, "actor-bottom") ? "bottom" : "";
  if (!placement || (hasClass(group, "actor-top") && hasClass(group, "actor-bottom"))) return null;
  const name = group.getAttribute("name") || "";
  const actorId = group.getAttribute("data-id") || name;
  if (!name || !actorId) return null;
  if (placement === "top" && (
    group.getAttribute("data-et") !== "participant" ||
    group.getAttribute("data-type") !== "actor" ||
    group.getAttribute("data-id") !== name
  )) return null;
  const children = directChildren(group);
  if (!hasUniformAxisAlignedScale(group) ||
      children.some((child) => localName(child) !== "text" && !hasUniformAxisAlignedScale(child))) return null;
  const lines = children.filter((child) => localName(child) === "line");
  const circles = children.filter((child) => localName(child) === "circle");
  const labels = children.filter((child) => localName(child) === "text");
  if (lines.length !== 4 || circles.length !== 1 || labels.length < 1 ||
      children.length !== lines.length + circles.length + labels.length ||
      labels.some((label) => !hasClass(label, "actor") || !hasClass(label, "actor-man") ||
        label.querySelector(":not(tspan)"))) return null;
  const torso = lines.find((line) => /^actor-man-torso\d+$/.test(line.id));
  const arms = lines.find((line) => /^actor-man-arms\d+$/.test(line.id));
  const legs = lines.filter((line) => line !== torso && line !== arms && !line.id);
  const circle = circles[0];
  const circleMetrics = numericAttributes(circle, ["cx", "cy", "r"]);
  const torsoMetrics = torso && numericAttributes(torso, ["x1", "y1", "x2", "y2"]);
  const armsMetrics = arms && numericAttributes(arms, ["x1", "y1", "x2", "y2"]);
  const legMetrics = legs.map((line) => numericAttributes(line, ["x1", "y1", "x2", "y2"]));
  if (!circleMetrics || !torsoMetrics || !armsMetrics || legMetrics.some((metrics) => !metrics)) return null;
  const [cx, cy, radius] = circleMetrics;
  const [torsoX1, torsoY1, torsoX2, torsoY2] = torsoMetrics;
  const [armsX1, armsY1, armsX2, armsY2] = armsMetrics;
  if (!(radius > 0) || !sameMetric(torsoX1, cx) || !sameMetric(torsoX2, cx) ||
      !sameMetric(torsoY1, cy + radius) || !(torsoY2 > torsoY1) ||
      !sameMetric(armsY1, armsY2) || !(armsX1 < cx && armsX2 > cx) ||
      !sameMetric((armsX1 + armsX2) / 2, cx) ||
      !(armsY1 > torsoY1 && armsY1 < torsoY2)) return null;
  const hip = { x: torsoX2, y: torsoY2 };
  const outerLegPoints = [];
  for (const metrics of legMetrics) {
    const [x1, y1, x2, y2] = metrics;
    const firstIsHip = sameMetric(x1, hip.x) && sameMetric(y1, hip.y);
    const secondIsHip = sameMetric(x2, hip.x) && sameMetric(y2, hip.y);
    if (firstIsHip === secondIsHip) return null;
    const outer = firstIsHip ? { x: x2, y: y2 } : { x: x1, y: y1 };
    if (!(outer.y > hip.y) || sameMetric(outer.x, hip.x)) return null;
    outerLegPoints.push(outer);
  }
  if (!(outerLegPoints.some((point) => point.x < hip.x) &&
      outerLegPoints.some((point) => point.x > hip.x))) return null;
  const parts = new Map([
    [torso, "torso"],
    [arms, "arms"],
    [circle, "head"],
  ]);
  legs.forEach((line, index) => parts.set(line,
    (legMetrics[index][0] < hip.x || legMetrics[index][2] < hip.x) ? "left-leg" : "right-leg"));
  labels.forEach((label, index) => parts.set(label, `label[${index}]`));
  return { actorId, placement, parts };
}

function straightSequenceConnector(element, sourcePath, z, deck, options, meta, reason) {
  if (!hasUniformAxisAlignedScale(element)) {
    return fallbackNode(element, z, deck, reason, sourcePath);
  }
  const coordinates = numericAttributes(element, ["x1", "y1", "x2", "y2"]);
  const markers = connectorMarkers(element, deck, options);
  if (!coordinates || markers.unsupported || markers.parts.length ||
      markers.arrowStart !== "none" || markers.arrowEnd !== "none") {
    return fallbackNode(element, z, deck, reason, sourcePath);
  }
  const [x1, y1, x2, y2] = coordinates;
  const points = [
    screenPoint(element, { x: x1, y: y1 }, deck),
    screenPoint(element, { x: x2, y: y2 }, deck),
  ];
  if (pointKey(points[0]) === pointKey(points[1])) {
    return fallbackNode(element, z, deck, reason, sourcePath);
  }
  return {
    kind: "connector", sourcePath, z, points,
    style: computedConnectorStyle(element, options),
    arrowStart: "none", arrowEnd: "none", meta,
  };
}

function sequenceFrameInfo(group) {
  if (group.getAttribute("data-et") !== "control-structure") return null;
  const children = directChildren(group);
  if (!hasUniformAxisAlignedScale(group) ||
      children.some((child) => localName(child) !== "text" && !hasUniformAxisAlignedScale(child))) return null;
  const lines = children.filter((child) => localName(child) === "line" && hasClass(child, "loopLine"));
  const tabs = children.filter((child) => localName(child) === "polygon" && hasClass(child, "labelBox"));
  const kindLabels = children.filter((child) => localName(child) === "text" && hasClass(child, "labelText"));
  const conditionLabels = children.filter((child) => localName(child) === "text" && hasClass(child, "loopText"));
  const sectionLabels = children.filter((child) => localName(child) === "text" && hasClass(child, "sectionTitle"));
  if (tabs.length !== 1 || kindLabels.length !== 1 || conditionLabels.length !== 1 ||
      children.length !== lines.length + tabs.length + kindLabels.length +
        conditionLabels.length + sectionLabels.length ||
      lines.length !== 4 + sectionLabels.length) return null;
  const kind = kindLabels[0].textContent.trim();
  const controlId = group.getAttribute("data-id") || "";
  if (!controlId || !SEQUENCE_FRAME_KINDS.has(kind)) return null;
  const lineMetrics = lines.map((line) => numericAttributes(line, ["x1", "y1", "x2", "y2"]));
  if (lineMetrics.some((metrics) => !metrics)) return null;
  const [[left, top, right, topEnd], [rightStart, topStart, rightEnd, bottom],
    [leftEnd, bottomStart, rightBottom, bottomEnd], [leftStart, topLeft, leftBottom, bottomLeft]] = lineMetrics;
  if (!(right > left && bottom > top) ||
      !sameMetric(top, topEnd) ||
      !sameMetric(rightStart, right) || !sameMetric(topStart, top) ||
      !sameMetric(rightEnd, right) ||
      !sameMetric(leftEnd, left) || !sameMetric(bottomStart, bottom) ||
      !sameMetric(rightBottom, right) || !sameMetric(bottomEnd, bottom) ||
      !sameMetric(leftStart, left) || !sameMetric(topLeft, top) ||
      !sameMetric(leftBottom, left) || !sameMetric(bottomLeft, bottom)) return null;
  for (const divider of lineMetrics.slice(4)) {
    const [x1, y1, x2, y2] = divider;
    if (!sameMetric(x1, left) || !sameMetric(x2, right) ||
        !sameMetric(y1, y2) || !(y1 > top && y1 < bottom)) return null;
  }
  const parts = new Map();
  lines.forEach((line, index) => parts.set(line, index < 4 ? `outline[${index}]` : `divider[${index - 4}]`));
  parts.set(tabs[0], "tab");
  parts.set(kindLabels[0], "kind");
  parts.set(conditionLabels[0], "condition[0]");
  sectionLabels.forEach((label, index) => parts.set(label, `condition[${index + 1}]`));
  return {
    controlId,
    frameLeft: left,
    frameTop: top,
    kind,
    parts,
  };
}

function sequenceBoxInfo(group, svg) {
  const allowedAttributes = new Set(["style", "data-pptx-z-order"]);
  if (group.parentElement !== svg || [...group.attributes].some((attribute) => !allowedAttributes.has(attribute.name)) ||
      hasClass(group, "actor-man")) return null;
  const children = directChildren(group);
  const backgrounds = children.filter((child) => localName(child) === "rect" && hasClass(child, "rect"));
  const titles = children.filter((child) => localName(child) === "text" && hasClass(child, "text"));
  if (backgrounds.length !== 1 || titles.length > 1 ||
      children.length !== backgrounds.length + titles.length ||
      !hasUniformAxisAlignedScale(group) ||
      backgrounds.some((background) => !hasUniformAxisAlignedScale(background))) return null;
  return {
    parts: new Map([
      [backgrounds[0], "background"],
      ...(titles.length ? [[titles[0], "title"]] : []),
    ]),
  };
}

function isSequenceNumberLine(element) {
  return localName(element) === "line" &&
    /-sequencenumber$/.test(markerReferenceId(element.getAttribute("marker-start")));
}

function sequenceNumberBackground(element, sourcePath, z, deck, options) {
  const fallback = () => fallbackNode(element, z, deck,
    "unsupported-mermaid-sequence-number-background", sourcePath);
  const coordinates = numericAttributes(element, ["x1", "y1", "x2", "y2"]);
  const style = getComputedStyle(element);
  const markerId = markerReferenceId(style.markerStart || element.getAttribute("marker-start"));
  const marker = element.ownerSVGElement.querySelector(`#${CSS.escape(markerId)}`);
  const children = marker ? directChildren(marker) : [];
  const circle = children[0];
  if (!coordinates || !sameMetric(coordinates[0], coordinates[2]) ||
      !sameMetric(coordinates[1], coordinates[3]) ||
      (style.markerMid && style.markerMid !== "none") ||
      (style.markerEnd && style.markerEnd !== "none") ||
      localName(marker) !== "marker" || children.length !== 1 || localName(circle) !== "circle" ||
      marker.hasAttribute("viewBox") ||
      (marker.getAttribute("markerUnits") || "strokeWidth") !== "strokeWidth" ||
      marker.getAttribute("orient") !== "auto" ||
      unsupportedVisualEffect(marker) || unsupportedVisualEffect(element)) return fallback();
  const markerMetrics = numericAttributes(marker, ["refX", "refY", "markerWidth", "markerHeight"]);
  const circleMetrics = numericAttributes(circle, ["cx", "cy", "r"]);
  if (!markerMetrics || !circleMetrics ||
      ![15, 15, 60, 40].every((value, index) => sameMetric(markerMetrics[index], value)) ||
      ![15, 15, 6].every((value, index) => sameMetric(circleMetrics[index], value))) return fallback();
  const matrix = element.getScreenCTM();
  const strokeWidth = parseMetric(style.strokeWidth);
  const circleStyle = getComputedStyle(circle);
  const fill = normalizeColor(circleStyle.fill, options.resolveColor);
  if (!matrix || Math.abs(matrix.b) > 0.001 || Math.abs(matrix.c) > 0.001 ||
      matrix.a <= 0 || matrix.d <= 0 || Math.abs(matrix.a - matrix.d) > 0.001 ||
      !(strokeWidth > 0) || !fill ||
      normalizeColor(circleStyle.stroke) ||
      [element, marker, circle].some((part) => getComputedStyle(part).transform !== "none")) return fallback();
  const center = screenPoint(element, { x: coordinates[0], y: coordinates[1] }, deck);
  const radiusX = circleMetrics[2] * strokeWidth * matrix.a;
  const radiusY = circleMetrics[2] * strokeWidth * matrix.d;
  const paint = cssStyleToSceneStyle({
    fill: circleStyle.fill,
    fillOpacity: circleStyle.fillOpacity,
    opacity: effectiveOpacity(element) * localOpacity(marker) * localOpacity(circle),
  }, options);
  return {
    kind: "shape", sourcePath, z,
    bounds: {
      x: roundedMetric(center.x - radiusX),
      y: roundedMetric(center.y - radiusY),
      width: roundedMetric(radiusX * 2),
      height: roundedMetric(radiusY * 2),
    },
    preset: "ellipse",
    style: { ...paint, fill, stroke: null, strokeWidth: 0 },
    meta: { mermaid: { kind: "sequence-number-background", nativeMask: "connector" } },
  };
}

function sequenceScene(svg, deck, size, options) {
  const nodes = [];
  const walk = (element, context = null) => {
    const tag = localName(element);
    if (IGNORED_TAGS.has(tag)) return;
    if (getComputedStyle(element).display === "none") return;
    const sourcePath = `sequence[${nodes.length}]`;
    options.sourceElements?.set(sourcePath, element);
    if (unsupportedVisualEffect(element, tag !== "g")) {
      nodes.push(fallbackNode(element, nodes.length, deck, "unsupported-mermaid-sequence-style", sourcePath));
      return;
    }
    if (tag === "g") {
      if (hasClass(element, "actor-man")) {
        const actor = sequenceActorInfo(element);
        if (!actor) {
          nodes.push(fallbackNode(element, nodes.length, deck,
            "unsupported-mermaid-sequence-actor", sourcePath));
          return;
        }
        for (const child of directChildren(element)) {
          walk(child, { kind: "actor", ...actor, part: actor.parts.get(child) });
        }
        return;
      }
      if (element.getAttribute("data-et") === "control-structure") {
        const frame = sequenceFrameInfo(element);
        if (!frame) {
          nodes.push(fallbackNode(element, nodes.length, deck,
            "unsupported-mermaid-sequence-frame", sourcePath));
          return;
        }
        for (const child of directChildren(element)) {
          walk(child, { contextType: "frame", ...frame, part: frame.parts.get(child) });
        }
        return;
      }
      const box = sequenceBoxInfo(element, svg);
      if (box) {
        for (const child of directChildren(element)) {
          walk(child, { kind: "box", part: box.parts.get(child) });
        }
        return;
      }
      if (!hasUniformAxisAlignedScale(element)) {
        nodes.push(fallbackNode(element, nodes.length, deck,
          "unsupported-mermaid-sequence-transform", sourcePath));
        return;
      }
      for (const child of directChildren(element)) walk(child, context);
      return;
    }
    if (["circle", "ellipse", "polygon", "rect"].includes(tag) &&
        !hasUniformAxisAlignedScale(element)) {
      nodes.push(fallbackNode(element, nodes.length, deck,
        "unsupported-mermaid-sequence-element-transform", sourcePath));
      return;
    }
    if (context?.kind === "actor" && tag === "line") {
      nodes.push(straightSequenceConnector(element, sourcePath, nodes.length, deck, options, {
        mermaid: {
          kind: "sequence-actor-part",
          actorId: context.actorId,
          placement: context.placement,
          part: context.part,
        },
      }, "unsupported-mermaid-sequence-actor-part"));
      return;
    }
    if (context?.kind === "actor" && tag === "circle" && context.part === "head") {
      nodes.push({
        kind: "shape", sourcePath, z: nodes.length, bounds: boundsOf(element, deck),
        preset: "ellipse", style: computedSvgStyle(element, options),
        meta: { mermaid: {
          kind: "sequence-actor-part",
          actorId: context.actorId,
          placement: context.placement,
          part: context.part,
        } },
      });
      return;
    }
    if (context?.contextType === "frame" && tag === "line") {
      nodes.push(straightSequenceConnector(element, sourcePath, nodes.length, deck, options, {
        mermaid: {
          kind: "sequence-frame-line",
          frame: context.kind,
          controlId: context.controlId,
          part: context.part,
        },
      }, "unsupported-mermaid-sequence-frame-line"));
      return;
    }
    if (context?.contextType === "frame" && tag === "polygon" && context.part === "tab") {
      const points = parsePoints(element.getAttribute("points"));
      if (!isKnownSequenceTab(points) || !sameMetric(points[0]?.x, context.frameLeft) ||
          !sameMetric(points[0]?.y, context.frameTop) ||
          !sameMetric(points[1]?.x - points[0]?.x, 50) ||
          !sameMetric(points[4]?.y - points[0]?.y, 20)) {
        nodes.push(fallbackNode(element, nodes.length, deck,
          "unsupported-mermaid-sequence-frame-tab", sourcePath));
      } else {
        nodes.push({
          kind: "shape", sourcePath, z: nodes.length, bounds: boundsOf(element, deck),
          preset: "sequenceTab", style: computedSvgStyle(element, options),
          meta: { mermaid: {
            kind: "sequence-frame-tab",
            frame: context.kind,
            controlId: context.controlId,
          } },
        });
      }
      return;
    }
    if (context?.contextType === "frame" && tag === "text") {
      nodes.push(element.querySelector(":not(tspan)")
        ? fallbackNode(element, nodes.length, deck,
            "unsupported-mermaid-sequence-frame-label", sourcePath)
        : measuredText(element, sourcePath, nodes.length, deck, options, {
            mermaid: {
              kind: "sequence-frame-label",
              frame: context.kind,
              controlId: context.controlId,
              part: context.part,
            },
          }));
      return;
    }
    if (context?.kind === "box" && tag === "rect" && context.part === "background") {
      nodes.push({
        kind: "shape", sourcePath, z: nodes.length, bounds: boundsOf(element, deck),
        preset: rectPreset(element), style: computedSvgStyle(element, options),
        meta: { mermaid: { kind: "sequence-box-background" } },
      });
      return;
    }
    if (context?.kind === "box" && tag === "text" && context.part === "title") {
      nodes.push(element.querySelector(":not(tspan)")
        ? fallbackNode(element, nodes.length, deck,
            "unsupported-mermaid-sequence-box-title", sourcePath)
        : measuredText(element, sourcePath, nodes.length, deck, options, {
            mermaid: { kind: "sequence-box-title" },
          }));
      return;
    }
    if (tag === "rect" && hasClass(element, "rect") && element.parentElement === svg) {
      nodes.push({
        kind: "shape", sourcePath, z: nodes.length, bounds: boundsOf(element, deck),
        preset: rectPreset(element), style: computedSvgStyle(element, options),
        meta: { mermaid: { kind: "sequence-background" } },
      });
      return;
    }
    if (isSequenceNumberLine(element)) {
      nodes.push(sequenceNumberBackground(element, sourcePath, nodes.length, deck, options));
      return;
    }
    if (tag === "rect" && /^(?:actor|activation\d+|note)(?:\s|$)/.test(element.getAttribute("class") || "")) {
      nodes.push({ kind: "shape", sourcePath, z: nodes.length, bounds: boundsOf(element, deck),
        preset: rectPreset(element), style: computedSvgStyle(element, options) });
      return;
    }
    if (tag === "text" && /^(?:actor|messageText|noteText|sequenceNumber)(?:\s|$)/.test(element.getAttribute("class") || "") &&
        !element.querySelector(":not(tspan)")) {
      nodes.push(measuredText(element, sourcePath, nodes.length, deck, options,
        hasClass(element, "sequenceNumber")
          ? { mermaid: { kind: "sequence-number" } }
          : context?.kind === "actor"
            ? { mermaid: {
                kind: "sequence-actor-label",
                actorId: context.actorId,
                placement: context.placement,
                part: context.part,
              } }
            : undefined));
      return;
    }
    if (tag === "path" && (hasClass(element, "messageLine0") || hasClass(element, "messageLine1"))) {
      nodes.push(normalizeColor(getComputedStyle(element).fill)
        ? fallbackNode(element, nodes.length, deck, "unsupported-mermaid-sequence-style", sourcePath)
        : connectorPath(element, sourcePath, nodes.length, deck, options));
      return;
    }
    const markers = tag === "line" ? connectorMarkers(element, deck, options) : null;
    if (tag === "line" && /^(?:actor-line|messageLine\d+)(?:\s|$)/.test(element.getAttribute("class") || "") &&
        !markers.unsupported) {
      if (!supportsConnectorTransform(element)) {
        nodes.push(fallbackNode(element, nodes.length, deck,
          "unsupported-mermaid-edge-transform", sourcePath));
        return;
      }
      nodes.push(markedConnector({
        kind: "connector", sourcePath, z: nodes.length,
        points: [1, 2].map((index) => screenPoint(element, {
          x: Number(element.getAttribute(`x${index}`)), y: Number(element.getAttribute(`y${index}`)),
        }, deck)),
        style: computedSvgStyle(element, options),
        arrowStart: markers.arrowStart,
        arrowEnd: markers.arrowEnd,
      }, markers, element, options));
      return;
    }
    if (VISUAL_TAGS.has(tag)) nodes.push(fallbackNode(
      element,
      nodes.length,
      deck,
      unsupportedAxisAlignedTransform(element, false)
        ? "unsupported-mermaid-sequence-element-transform"
        : "unsupported-mermaid-sequence-element",
      sourcePath,
    ));
  };
  for (const child of directChildren(svg)) walk(child);
  return diagramScene(svg, size, options, nodes);
}

function isRectanglePath(path) {
  const d = path?.getAttribute("d") || "";
  if (d.replace(/[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?|[\s,]/gi, "") !== "MLLL") return false;
  const values = d.match(/[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/gi)?.map(Number) || [];
  return values.length === 8 && values[0] === values[6] && values[2] === values[4] &&
    values[1] === values[3] && values[5] === values[7];
}

function rectangularOutlinePaths(outline, options) {
  const paths = outline ? directChildren(outline, "path") : [];
  if (paths.length !== 2 || directChildren(outline).length !== 2 || !isRectanglePath(paths[0]) ||
      paths.some((path) => computedSvgStyle(path, options).dash !== "solid") ||
      !matchingOutline(paths[1], paths[0], (point, box) =>
        Math.min(Math.abs(point.x - box.x), Math.abs(point.x - box.x - box.width),
          Math.abs(point.y - box.y), Math.abs(point.y - box.y - box.height)))) return null;
  return paths;
}

function classOutlineNode(paths, sourcePath, z, bounds, options, meta) {
  const collapsed = paintedPathStyle(paths, options);
  const translucent = (collapsed.fill && effectiveFillAlpha(collapsed) < 1) ||
    (collapsed.stroke && collapsed.strokeWidth !== 0 && effectiveStrokeAlpha(collapsed) < 1);
  if (compatiblePathPaint(paths, options) && !translucent) {
    return {
      kind: "shape", sourcePath, z, bounds, preset: "rect", style: collapsed,
      ...(meta ? { meta } : {}),
    };
  }
  const children = paths.map((path, index) => ({
    kind: "shape",
    sourcePath: `${sourcePath}.paths[${index}]`,
    z: index,
    bounds: { x: 0, y: 0, width: bounds.width, height: bounds.height },
    preset: "rect",
    style: computedSvgStyle(path, options),
    ...(meta ? { meta: { ...meta, mermaid: { ...meta.mermaid, part: `path[${index}]` } } } : {}),
  }));
  const group = compositeGroup(sourcePath, z, bounds, children, "class-outline");
  if (meta) group.meta = meta;
  return group;
}

function classParts(group, outline, options) {
  const paths = rectangularOutlinePaths(outline, options);
  if (!paths) return null;
  const labels = [...group.querySelectorAll("span.nodeLabel, text")]
    .filter((label) => !label.parentElement.closest("span.nodeLabel, text"));
  const dividers = [...group.querySelectorAll(":scope > g.divider > path")];
  const covered = new Set([...paths, ...labels, ...dividers]);
  for (const visual of group.querySelectorAll([...VISUAL_TAGS].join(","))) {
    if (covered.has(visual) || labels.some((label) => label.contains(visual))) continue;
    if (localName(visual) === "foreignObject" && labels.some((label) => visual.contains(label))) {
      const extra = visual.cloneNode(true);
      extra.querySelectorAll("span.nodeLabel, text").forEach((label) => label.remove());
      if (!extra.textContent.trim()) continue;
    }
    return null;
  }
  return { paths, labels, dividers };
}

const SAFE_CLASS_LABEL_TAGS = new Set([
  "b",
  "br",
  "div",
  "em",
  "foreignObject",
  "g",
  "i",
  "p",
  "rect",
  "span",
  "strong",
  "text",
  "tspan",
]);

function safeClassLabel(element) {
  if (!element || unsupportedVisualEffect(element) || element.querySelector("img, image, svg, .katex, use")) return false;
  for (const child of [element, ...element.querySelectorAll("*")]) {
    if (!SAFE_CLASS_LABEL_TAGS.has(localName(child))) return false;
    const style = getComputedStyle(child);
    if (localName(child) === "rect") {
      const bounds = child.getBoundingClientRect();
      if ((bounds.width > 0.1 || bounds.height > 0.1) &&
          (normalizeColor(style.fill) || (normalizeColor(style.stroke) && parseMetric(style.strokeWidth) > 0))) return false;
    }
    if (child.namespaceURI !== SVG_NS && (
      normalizeColor(style.backgroundColor) ||
      style.textDecorationLine && style.textDecorationLine !== "none" ||
      style.boxShadow && style.boxShadow !== "none" ||
      style.textShadow && style.textShadow !== "none" ||
      ["Top", "Right", "Bottom", "Left"].some((side) =>
        parseMetric(style[`border${side}Width`]) > 0 && style[`border${side}Style`] !== "none")
    )) return false;
  }
  return Boolean(element.innerText?.trim() || element.textContent?.trim());
}

function isClassNoteGroup(group) {
  return Boolean(directChildren(group).find((child) => hasClass(child, "noteLabel"))) ||
    /-note\d+$/.test(group.getAttribute("id") || "");
}

function classNoteParts(group, options) {
  const children = directChildren(group);
  const outline = children.find((child) => hasClass(child, "label-container"));
  const label = children.find((child) => hasClass(child, "noteLabel"));
  const paths = rectangularOutlinePaths(outline, options);
  if (!outline || !label || !paths || !safeClassLabel(label) ||
      children.some((child) => child !== outline && child !== label)) return null;
  return { outline, label, paths };
}

function namespaceEntries(root, deck) {
  return [...root.querySelectorAll("g.cluster")].map((group, index) => {
    const frames = directChildren(group, "rect");
    const frame = frames[0] || null;
    return {
      group,
      index,
      frame,
      bounds: frame ? boundsOf(frame, deck) : boundsOf(group, deck),
      parent: null,
      children: [],
      depth: 1,
    };
  });
}

function boundsContain(outer, inner, tolerance = 0.5) {
  return outer.width > inner.width + tolerance &&
    outer.height > inner.height + tolerance &&
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance;
}

function classNamespaceHierarchy(root, deck) {
  // Mermaid 11.15.0 emits nested namespace frames as flat cluster siblings.
  // Rebuild only their bounded visual hierarchy; edges and class nodes stay independent.
  const entries = namespaceEntries(root, deck);
  for (const entry of entries) {
    const parents = entries
      .filter((candidate) => candidate !== entry && boundsContain(candidate.bounds, entry.bounds))
      .sort((left, right) => left.bounds.width * left.bounds.height - right.bounds.width * right.bounds.height);
    entry.parent = parents[0] || null;
    entry.parent?.children.push(entry);
  }
  const visited = new Set();
  const visit = (entry, depth) => {
    if (visited.has(entry)) return;
    visited.add(entry);
    entry.depth = depth;
    entry.children.sort((left, right) => left.index - right.index);
    entry.children.forEach((child) => visit(child, depth + 1));
  };
  entries.filter((entry) => !entry.parent).sort((left, right) => left.index - right.index)
    .forEach((entry) => visit(entry, 1));
  entries.filter((entry) => !visited.has(entry)).forEach((entry) => {
    entry.depth = MAX_GROUP_DEPTH + 1;
  });
  return entries;
}

function isClassCollection(element) {
  return ["clusters", "edgePaths", "edgeLabels", "nodes"].some((name) => hasClass(element, name));
}

function unsupportedClassContainers(root, deck, nodes, options) {
  const consumed = new Set();
  const blocked = new Set();
  const containers = [...root.querySelectorAll("g")].filter(isClassCollection);
  for (const [index, container] of containers.entries()) {
    if (hasAncestorInSet(container.parentElement, blocked)) continue;
    const reason = unsupportedVisualEffect(container, false)
      ? "unsupported-mermaid-container-style"
      : !hasUniformAxisAlignedScale(container)
        ? "unsupported-mermaid-container-transform"
        : "";
    if (!reason) continue;
    const sourcePath = `root.containers[${index}]`;
    consumed.add(container);
    blocked.add(container);
    options.sourceElements.set(sourcePath, container);
    nodes.push(fallbackNode(container, nodes.length, deck, reason, sourcePath));
  }
  return { consumed, blocked };
}

function appendClassNamespaces(root, deck, nodes, options, consumed, blocked) {
  for (const entry of classNamespaceHierarchy(root, deck).sort((left, right) => left.index - right.index)) {
    const { group, index, frame, depth } = entry;
    if (hasAncestorInSet(group, blocked)) continue;
    const sourcePath = `namespaces[${index}]`;
    if (depth > MAX_GROUP_DEPTH) {
      consumed.add(group);
      blocked.add(group);
      options.sourceElements.set(sourcePath, group);
      nodes.push(fallbackNode(group, nodes.length, deck,
        `unsupported-mermaid-class-namespace-depth: exceeds ${MAX_GROUP_DEPTH}`, sourcePath));
      continue;
    }
    if (!hasUniformAxisAlignedScale(group) ||
        (frame && !hasUniformAxisAlignedScale(frame))) {
      consumed.add(group);
      blocked.add(group);
      options.sourceElements.set(sourcePath, group);
      nodes.push(fallbackNode(group, nodes.length, deck,
        "unsupported-mermaid-class-namespace-transform", sourcePath));
      continue;
    }
    if (unsupportedVisualEffect(group, false)) {
      consumed.add(group);
      blocked.add(group);
      options.sourceElements.set(sourcePath, group);
      nodes.push(fallbackNode(group, nodes.length, deck,
        "unsupported-mermaid-class-namespace-style", sourcePath));
      continue;
    }
    const children = directChildren(group);
    const labels = children.filter((child) => hasClass(child, "cluster-label"));
    if (frame) {
      options.sourceElements.set(sourcePath, frame);
      nodes.push(unsupportedVisualEffect(frame)
        ? fallbackNode(frame, nodes.length, deck,
            "unsupported-mermaid-class-namespace-frame", sourcePath)
        : {
            kind: "group",
            id: group.getAttribute("id") || undefined,
            sourcePath,
            z: nodes.length,
            bounds: boundsOf(frame, deck),
            children: [],
            style: computedSvgStyle(frame, options),
            meta: { mermaid: { kind: "class-namespace", depth } },
          });
      consumed.add(frame);
    }
    for (const [labelIndex, label] of labels.entries()) {
      const labelPath = `${sourcePath}.labels[${labelIndex}]`;
      options.sourceElements.set(labelPath, label);
      nodes.push(safeClassLabel(label)
        ? measuredText(label, labelPath, nodes.length, deck, options, {
            mermaid: { kind: "class-namespace-label", depth },
          })
        : fallbackNode(label, nodes.length, deck,
            "unsupported-mermaid-class-namespace-label", labelPath));
      consumed.add(label);
    }
    for (const [childIndex, child] of children.entries()) {
      if (child === frame || labels.includes(child) ||
          (localName(child) === "g" &&
            (isClassCollection(child) || hasClass(child, "cluster") || hasClass(child, "node")))) continue;
      if (!isVisibleVisualSubtree(child)) continue;
      const childPath = `${sourcePath}.unknown[${childIndex}]`;
      options.sourceElements.set(childPath, child);
      nodes.push(fallbackNode(child, nodes.length, deck,
        "unsupported-mermaid-class-namespace-decoration", childPath));
      consumed.add(child);
    }
  }
}

function specialDiagramStructureFallback(svg, deck, size, options, reason) {
  return {
    scene: fallbackSceneForReason(
      createScene({ ...size, source: { kind: "mermaid", path: options.path } }),
      reason,
      boundsOf(svg, deck),
    ),
    diagnostics: [{ path: "svg", kind: "fallback", reason }],
  };
}

function packetElementRole(element) {
  const roles = [
    hasClass(element, "packetBlock") ? "field" : "",
    hasClass(element, "packetLabel") ? "label" : "",
    hasClass(element, "packetByte") ? "bit" : "",
  ].filter(Boolean);
  if (roles.length !== 1) return roles.length ? "invalid" : "";
  if (roles[0] !== "bit") return roles[0];
  const start = hasClass(element, "start");
  const end = hasClass(element, "end");
  return start === end ? "invalid" : start ? "start" : "end";
}

function packetFieldBox(element) {
  try {
    const box = element.getBBox?.();
    return box && [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
      box.width > 0 && box.height > 0
      ? box
      : null;
  } catch (_) {
    return null;
  }
}

function packetBitLabelsMatchField(field, start, end) {
  if (localName(start) !== "text" || (end && localName(end) !== "text")) return false;
  const box = packetFieldBox(field);
  const startX = Number(start.getAttribute("x"));
  const startY = Number(start.getAttribute("y"));
  const startAnchor = start.getAttribute("text-anchor") || getComputedStyle(start).textAnchor;
  if (!box || !Number.isFinite(startX) || !Number.isFinite(startY) ||
      !sameMetric(startY, box.y - 2)) return false;
  if (!end) {
    return startAnchor === "middle" && sameMetric(startX, box.x + box.width / 2);
  }
  const endX = Number(end.getAttribute("x"));
  const endY = Number(end.getAttribute("y"));
  const endAnchor = end.getAttribute("text-anchor") || getComputedStyle(end).textAnchor;
  return startAnchor === "start" &&
    endAnchor === "end" &&
    Number.isFinite(endX) &&
    Number.isFinite(endY) &&
    sameMetric(startX, box.x) &&
    sameMetric(endX, box.x + box.width) &&
    sameMetric(endY, startY);
}

function validPacketRowStructure(row, showBits) {
  const children = directChildren(row)
    .filter((child) => packetElementRole(child));
  let index = 0;
  let fields = 0;
  while (index < children.length) {
    const field = children[index++];
    const label = children[index++];
    if (packetElementRole(field) !== "field" || packetElementRole(label) !== "label") {
      return false;
    }
    fields += 1;
    if (!showBits) continue;
    const start = children[index++];
    if (packetElementRole(start) !== "start") return false;
    const end = packetElementRole(children[index]) === "end" ? children[index++] : null;
    if (!packetBitLabelsMatchField(field, start, end)) return false;
  }
  return fields > 0;
}

function packetScene(svg, deck, size, options) {
  const nodes = [];
  const consumed = new Set();
  const rows = directChildren(svg, "g")
    .filter((group) => directChildren(group, "rect.packetBlock").length > 0);
  const titles = directChildren(svg, "text.packetTitle");
  if (!rows.length || titles.length !== 1) {
    return specialDiagramStructureFallback(
      svg,
      deck,
      size,
      options,
      "unsupported-mermaid-packet-structure",
    );
  }
  const showBits = rows.some((row) =>
    directChildren(row).some((child) => hasClass(child, "packetByte")));

  for (const [rowIndex, row] of rows.entries()) {
    const children = directChildren(row);
    const sourcePath = `packet.rows[${rowIndex}]`;
    const unsupportedRowStyle = unsupportedVisualEffect(row, false);
    if (!validPacketRowStructure(row, showBits) || unsupportedRowStyle) {
      consumed.add(row);
      options.sourceElements.set(sourcePath, row);
      nodes.push(fallbackNode(
        row,
        nodes.length,
        deck,
        unsupportedRowStyle
          ? "unsupported-mermaid-packet-row-style"
          : "unsupported-mermaid-packet-row-structure",
        sourcePath,
      ));
      continue;
    }

    let fieldIndex = 0;
    let labelIndex = 0;
    let bitIndex = 0;
    for (const child of children) {
      let childPath;
      let node;
      if (hasClass(child, "packetBlock")) {
        childPath = `${sourcePath}.fields[${fieldIndex}]`;
        node = localName(child) === "rect"
          ? simpleDiagramShape(
              child,
              childPath,
              nodes.length,
              deck,
              options,
              { mermaid: { kind: "packet-field", row: rowIndex, index: fieldIndex } },
              {
                geometry: "unsupported-mermaid-packet-field-geometry",
                style: "unsupported-mermaid-packet-field-style",
                transform: "unsupported-mermaid-packet-field-transform",
              },
            )
          : fallbackNode(
              child,
              nodes.length,
              deck,
              "unsupported-mermaid-packet-field-geometry",
              childPath,
            );
        fieldIndex += 1;
      } else if (hasClass(child, "packetLabel")) {
        childPath = `${sourcePath}.labels[${labelIndex}]`;
        node = localName(child) === "text"
          ? simpleDiagramText(
              child,
              childPath,
              nodes.length,
              deck,
              options,
              { mermaid: { kind: "packet-field-label", row: rowIndex, index: labelIndex } },
              "unsupported-mermaid-packet-text-style",
            )
          : fallbackNode(
              child,
              nodes.length,
              deck,
              "unsupported-mermaid-packet-label",
              childPath,
            );
        labelIndex += 1;
      } else if (hasClass(child, "packetByte")) {
        const placement = hasClass(child, "start") ? "start" : hasClass(child, "end") ? "end" : "";
        childPath = `${sourcePath}.bits[${bitIndex}]`;
        node = localName(child) === "text" && placement &&
            hasClass(child, "start") !== hasClass(child, "end")
          ? simpleDiagramText(
              child,
              childPath,
              nodes.length,
              deck,
              options,
              { mermaid: { kind: "packet-bit-label", row: rowIndex, index: bitIndex, placement } },
              "unsupported-mermaid-packet-text-style",
            )
          : fallbackNode(
              child,
              nodes.length,
              deck,
              "unsupported-mermaid-packet-bit-label",
              childPath,
            );
        bitIndex += 1;
      } else {
        continue;
      }
      consumed.add(child);
      options.sourceElements.set(childPath, child);
      if (node) nodes.push(node);
    }
  }

  const title = titles[0];
  consumed.add(title);
  options.sourceElements.set("packet.title", title);
  const titleNode = simpleDiagramText(
    title,
    "packet.title",
    nodes.length,
    deck,
    options,
    { mermaid: { kind: "packet-title" } },
    "unsupported-mermaid-packet-text-style",
  );
  if (titleNode) nodes.push(titleNode);
  nodes.push(...collectUnexpectedVisuals(
    svg,
    deck,
    nodes.length,
    "packet",
    consumed,
    options,
    {
      depthLimit: MAX_GROUP_DEPTH,
      depthReason: "unsupported-mermaid-packet-depth",
    },
  ));
  return diagramScene(svg, size, options, nodes);
}

function treeViewScene(svg, deck, size, options) {
  const roots = directChildren(svg, "g.tree-view");
  if (roots.length !== 1) {
    return specialDiagramStructureFallback(
      svg,
      deck,
      size,
      options,
      "unsupported-mermaid-tree-view-structure",
    );
  }
  const root = roots[0];
  const children = directChildren(root);
  const labels = children.filter((child) => hasClass(child, "treeView-node-label"));
  const lines = children.filter((child) => hasClass(child, "treeView-node-line"));
  if (!labels.length || !lines.length) {
    return specialDiagramStructureFallback(
      svg,
      deck,
      size,
      options,
      "unsupported-mermaid-tree-view-structure",
    );
  }

  const nodes = [];
  const consumed = new Set();
  if (unsupportedVisualEffect(root, false)) {
    consumed.add(root);
    options.sourceElements.set("treeView", root);
    nodes.push(fallbackNode(
      root,
      nodes.length,
      deck,
      "unsupported-mermaid-tree-view-style",
      "treeView",
    ));
  } else {
    let labelIndex = 0;
    let lineIndex = 0;
    for (const child of children) {
      let sourcePath;
      let node;
      if (hasClass(child, "treeView-node-label")) {
        sourcePath = `treeView.labels[${labelIndex}]`;
        node = localName(child) === "text"
          ? simpleDiagramText(
              child,
              sourcePath,
              nodes.length,
              deck,
              options,
              { mermaid: { kind: "tree-view-label", index: labelIndex } },
              "unsupported-mermaid-tree-view-text-style",
            )
          : fallbackNode(
              child,
              nodes.length,
              deck,
              "unsupported-mermaid-tree-view-label",
              sourcePath,
            );
        labelIndex += 1;
      } else if (hasClass(child, "treeView-node-line")) {
        sourcePath = `treeView.lines[${lineIndex}]`;
        node = localName(child) === "line"
          ? simpleDiagramLine(
              child,
              sourcePath,
              nodes.length,
              deck,
              options,
              { mermaid: { kind: "tree-view-branch", index: lineIndex } },
              {
                geometry: "unsupported-mermaid-tree-view-line-geometry",
                style: "unsupported-mermaid-tree-view-line-style",
                transform: "unsupported-mermaid-tree-view-line-transform",
              },
            )
          : fallbackNode(
              child,
              nodes.length,
              deck,
              "unsupported-mermaid-tree-view-line-geometry",
              sourcePath,
            );
        lineIndex += 1;
      } else {
        continue;
      }
      consumed.add(child);
      options.sourceElements.set(sourcePath, child);
      if (node) nodes.push(node);
    }
    nodes.push(...collectUnexpectedVisuals(
      root,
      deck,
      nodes.length,
      "treeView",
      consumed,
      options,
      {
        depthLimit: MAX_GROUP_DEPTH,
        depthReason: "unsupported-mermaid-tree-view-depth",
      },
    ));
  }
  nodes.push(...collectUnexpectedVisuals(
    svg,
    deck,
    nodes.length,
    "svg",
    new Set([root]),
    options,
    {
      depthLimit: MAX_GROUP_DEPTH,
      depthReason: "unsupported-mermaid-tree-view-depth",
    },
  ));
  return diagramScene(svg, size, options, nodes);
}

function stateCirclePathMatches(path, radius) {
  if (localName(path) !== "path") return false;
  const data = renderedPathData(path);
  const commands = data
    .replace(/[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?|[\s,]/gi, "");
  const numbers = data.match(/[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/gi)?.map(Number) || [];
  if (commands !== `M${"C".repeat(37)}` || numbers.length !== 224) return false;
  const box = path.getBBox?.();
  if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
      Math.abs(box.x + radius) > 0.03 ||
      Math.abs(box.y + radius) > 0.03 ||
      Math.abs(box.width - radius * 2) > 0.03 ||
      Math.abs(box.height - radius * 2) > 0.03) return false;
  const length = path.getTotalLength?.();
  if (!Number.isFinite(length) || length <= 0) return false;
  for (let index = 0; index <= 64; index += 1) {
    const point = path.getPointAtLength(length * index / 64);
    if (Math.abs(Math.hypot(point.x, point.y) - radius) > 0.03) return false;
  }
  return true;
}

function stateEndNode(group, sourcePath, z, deck, options) {
  const outer = directChildren(group);
  const shell = outer[0];
  const shellChildren = directChildren(shell);
  const inner = shellChildren[2];
  const outerPaths = shellChildren.slice(0, 2);
  const innerPaths = directChildren(inner);
  const paths = [...outerPaths, ...innerPaths];
  if (outer.length !== 1 || localName(shell) !== "g" || !hasClass(shell, "outer-path") ||
      shellChildren.length !== 3 || outerPaths.some((path) => localName(path) !== "path") ||
      localName(inner) !== "g" || innerPaths.length !== 2 ||
      innerPaths.some((path) => localName(path) !== "path") ||
      renderedPathData(outerPaths[0]) !== renderedPathData(outerPaths[1]) ||
      renderedPathData(innerPaths[0]) !== renderedPathData(innerPaths[1]) ||
      !outerPaths.every((path) => stateCirclePathMatches(path, 7)) ||
      !innerPaths.every((path) => stateCirclePathMatches(path, 2.5))) {
    return fallbackNode(group, z, deck, "unsupported-mermaid-state-end-geometry", sourcePath);
  }
  if (unsupportedVisualEffect(group)) {
    return fallbackNode(group, z, deck, "unsupported-mermaid-state-end-style", sourcePath);
  }
  if (paths.some((path) => !hasUniformAxisAlignedScale(path))) {
    return fallbackNode(group, z, deck, "unsupported-mermaid-state-end-transform", sourcePath);
  }
  const bounds = boundsOf(outerPaths[0], deck);
  const children = paths.map((path, index) => {
    const childPath = `${sourcePath}.parts[${index}]`;
    options.sourceElements.set(childPath, path);
    return {
      kind: "shape",
      sourcePath: childPath,
      z: index,
      bounds: relativeBounds(boundsOf(path, deck), bounds),
      preset: "ellipse",
      style: computedSvgStyle(path, options),
      meta: {
        mermaid: {
          kind: "state-end-part",
          ring: index < 2 ? "outer" : "inner",
          paint: index % 2 === 0 ? "fill" : "stroke",
        },
      },
    };
  });
  return compositeGroup(sourcePath, z, bounds, children, "state-end", "state-end");
}

function stateNode(group, sourcePath, z, deck, options) {
  const children = directChildren(group);
  options.sourceElements.set(sourcePath, group);
  if (children.length === 1 && localName(children[0]) === "circle" &&
      hasClass(children[0], "state-start")) {
    const circle = children[0];
    if (unsupportedVisualEffect(group, false)) {
      return fallbackNode(group, z, deck, "unsupported-mermaid-state-start-style", sourcePath);
    }
    options.sourceElements.set(sourcePath, circle);
    return simpleDiagramShape(
      circle,
      sourcePath,
      z,
      deck,
      options,
      { mermaid: { kind: "state-start" } },
      {
        geometry: "unsupported-mermaid-state-start-geometry",
        style: "unsupported-mermaid-state-start-style",
        transform: "unsupported-mermaid-state-start-transform",
      },
    );
  }
  if (children.length === 1 && localName(children[0]) === "g" &&
      hasClass(children[0], "outer-path")) {
    return stateEndNode(group, sourcePath, z, deck, options);
  }
  if (hasClass(group, "statediagram-note")) {
    return fallbackNode(group, z, deck, "unsupported-mermaid-state-note", sourcePath);
  }
  const shape = children.find((child) =>
    localName(child) === "rect" && hasClass(child, "basic") && hasClass(child, "label-container"));
  const label = children.find((child) => localName(child) === "g" && hasClass(child, "label"));
  if (hasClass(group, "statediagram-state") && shape && label) {
    if (children.length !== 2) {
      return fallbackNode(group, z, deck, "unsupported-mermaid-state-node-content", sourcePath);
    }
    if (!safeClassLabel(label)) {
      return fallbackNode(group, z, deck, "unsupported-mermaid-state-label", sourcePath);
    }
    return nodeShape(group, 0, z, deck, options, {
      sourcePath,
      kind: "state",
      labelKind: "state-label",
    });
  }
  if (hasClass(group, "statediagram-state") &&
      group.querySelector("rect.title-state, line.divider")) {
    return fallbackNode(group, z, deck, "unsupported-mermaid-state-description", sourcePath);
  }
  if (hasClass(group, "statediagram-state")) {
    return fallbackNode(group, z, deck, "unsupported-mermaid-state-special-node", sourcePath);
  }
  return fallbackNode(group, z, deck, "unsupported-mermaid-state-node", sourcePath);
}

function hasVisibleStateClusterContent(group) {
  if (group.textContent?.trim()) return true;
  return [...group.querySelectorAll([...VISUAL_TAGS].join(","))].some((element) => {
    if (["foreignObject", "image", "use"].includes(localName(element))) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) return true;
    }
    const style = getComputedStyle(element);
    const fill = normalizeColor(style.fill) &&
      cssColorParts(style.fill)?.alpha * parseOpacity(style.fillOpacity) * effectiveOpacity(element) > 0.000001;
    const stroke = normalizeColor(style.stroke) && parseMetric(style.strokeWidth) > 0 &&
      cssColorParts(style.stroke)?.alpha * parseOpacity(style.strokeOpacity) * effectiveOpacity(element) > 0.000001;
    return Boolean(fill || stroke);
  });
}

function stateScene(svg, root, deck, size, options) {
  const rootContainers = (current) =>
    Object.fromEntries(["clusters", "edgePaths", "edgeLabels", "nodes"].map((name) => [
      name,
      directChildren(current, `g.${name}`),
    ]));
  if (Object.values(rootContainers(root)).some((entries) => entries.length !== 1)) {
    return specialDiagramStructureFallback(
      svg,
      deck,
      size,
      options,
      "unsupported-mermaid-state-structure",
    );
  }

  const nodes = [];
  const consumed = new Set();
  const visitRoot = (current, prefix, depth) => {
    const containers = rootContainers(current);
    if (Object.values(containers).some((entries) => entries.length !== 1)) {
      const sourcePath = `${prefix}.root`;
      consumed.add(current);
      options.sourceElements.set(sourcePath, current);
      nodes.push(fallbackNode(
        current,
        nodes.length,
        deck,
        "unsupported-mermaid-state-region-structure",
        sourcePath,
      ));
      return;
    }
    if (depth > MAX_GROUP_DEPTH) {
      const sourcePath = `${prefix}.root`;
      consumed.add(current);
      options.sourceElements.set(sourcePath, current);
      nodes.push(fallbackNode(
        current,
        nodes.length,
        deck,
        "unsupported-mermaid-state-depth",
        sourcePath,
      ));
      return;
    }
    if (depth > 0 && unsupportedVisualEffect(current, false)) {
      const sourcePath = `${prefix}.root`;
      consumed.add(current);
      options.sourceElements.set(sourcePath, current);
      nodes.push(fallbackNode(
        current,
        nodes.length,
        deck,
        "unsupported-mermaid-state-region-style",
        sourcePath,
      ));
      return;
    }
    if (depth > 0 && !hasUniformAxisAlignedScale(current)) {
      const sourcePath = `${prefix}.root`;
      consumed.add(current);
      options.sourceElements.set(sourcePath, current);
      nodes.push(fallbackNode(
        current,
        nodes.length,
        deck,
        "unsupported-mermaid-state-region-transform",
        sourcePath,
      ));
      return;
    }

    for (const [index, cluster] of directChildren(containers.clusters[0], "g").entries()) {
      consumed.add(cluster);
      const sourcePath = `${prefix}.containers[${index}]`;
      options.sourceElements.set(sourcePath, cluster);
      if (!hasVisibleStateClusterContent(cluster)) continue;
      const reason = hasClass(cluster, "statediagram-cluster-alt")
        ? "unsupported-mermaid-state-parallel"
        : hasClass(cluster, "statediagram-cluster")
          ? "unsupported-mermaid-state-compound"
          : hasClass(cluster, "note-cluster")
            ? "unsupported-mermaid-state-note"
            : "unsupported-mermaid-state-container";
      nodes.push(fallbackNode(cluster, nodes.length, deck, reason, sourcePath));
    }

    const edgeLabels = readEdgeLabels(current, deck, options, consumed, {
      sourcePathPrefix: prefix,
    });
    for (const [index, path] of directChildren(containers.edgePaths[0], "path").entries()) {
      if (!hasClass(path, "transition")) continue;
      consumed.add(path);
      const sourcePath = `${prefix}.transitions[${index}]`;
      options.sourceElements.set(sourcePath, path);
      nodes.push(hasClass(path, "note-edge")
        ? fallbackNode(path, nodes.length, deck, "unsupported-mermaid-state-note", sourcePath)
        : connectorPath(path, sourcePath, nodes.length, deck, options));
    }
    appendEdgeLabels(nodes, edgeLabels);

    let nodeIndex = 0;
    let regionIndex = 0;
    for (const child of directChildren(containers.nodes[0], "g")) {
      if (hasClass(child, "node")) {
        consumed.add(child);
        nodes.push(stateNode(
          child,
          `${prefix}.nodes[${nodeIndex++}]`,
          nodes.length,
          deck,
          options,
        ));
      } else if (hasClass(child, "root")) {
        visitRoot(child, `${prefix}.regions[${regionIndex++}]`, depth + 1);
      }
    }
  };
  visitRoot(root, "state", 0);
  nodes.push(...collectUnexpectedVisuals(root, deck, nodes.length, "root", consumed, options));
  nodes.push(...collectUnexpectedVisuals(svg, deck, nodes.length, "svg", new Set([root]), options));
  return diagramScene(svg, size, options, nodes);
}

function classScene(svg, root, deck, size, options) {
  const nodes = [];
  const { consumed, blocked } = unsupportedClassContainers(root, deck, nodes, options);
  appendClassNamespaces(root, deck, nodes, options, consumed, blocked);
  const edges = [...new Set(root.querySelectorAll("path.relation"))];
  for (const [index, path] of edges.entries()) {
    if (hasAncestorInSet(path, blocked)) continue;
    consumed.add(path);
    options.sourceElements?.set(`edges[${index}]`, path);
    nodes.push(connectorPath(path, `edges[${index}]`, nodes.length, deck, options));
  }
  appendEdgeLabels(nodes, readEdgeLabels(root, deck, options, consumed, { recursive: true, blocked }));
  let classIndex = 0;
  let noteIndex = 0;
  const classNodes = [...new Set(root.querySelectorAll("g.node"))];
  for (const group of classNodes) {
    if (hasAncestorInSet(group, blocked)) continue;
    consumed.add(group);
    const note = isClassNoteGroup(group);
    const sourcePath = note ? `notes[${noteIndex++}]` : `classes[${classIndex++}]`;
    options.sourceElements?.set(sourcePath, group);
    if (note) {
      const parts = classNoteParts(group, options);
      if (!hasUniformAxisAlignedScale(group) ||
          (parts && unsupportedAxisAlignedTransform(parts.outline))) {
        nodes.push(fallbackNode(group, nodes.length, deck,
          "unsupported-mermaid-class-note-transform", sourcePath));
        continue;
      }
      if (unsupportedVisualEffect(group) || !parts) {
        nodes.push(fallbackNode(group, nodes.length, deck, "unsupported-mermaid-class-note", sourcePath));
        continue;
      }
      nodes.push(classOutlineNode(
        parts.paths,
        sourcePath,
        nodes.length,
        boundsOf(parts.outline, deck),
        options,
        { mermaid: { kind: "class-note" } },
      ));
      options.sourceElements.set(sourcePath, parts.outline);
      const labelPath = `${sourcePath}.label`;
      options.sourceElements.set(labelPath, parts.label);
      nodes.push(measuredText(parts.label, labelPath, nodes.length, deck, options, {
        mermaid: { kind: "class-note-label" },
      }));
      continue;
    }
    const outline = group.querySelector(":scope > g.label-container");
    const children = directChildren(group);
    const parts = outline && classParts(group, outline, options);
    if (!hasUniformAxisAlignedScale(group) ||
        (parts && [...parts.paths, ...parts.dividers].some((part) =>
          !hasUniformAxisAlignedScale(part)))) {
      nodes.push(fallbackNode(group, nodes.length, deck,
        "unsupported-mermaid-class-node-transform", sourcePath));
      continue;
    }
    if (unsupportedVisualEffect(group) || !parts ||
        group.querySelector("img, image, svg, .katex, use") ||
        children.some((child) => child !== outline &&
          !["annotation-group", "label-group", "members-group", "methods-group", "divider"].some((name) => hasClass(child, name)))) {
      nodes.push(fallbackNode(group, nodes.length, deck, "unsupported-mermaid-class-node", sourcePath));
      continue;
    }
    nodes.push(classOutlineNode(
      parts.paths,
      sourcePath,
      nodes.length,
      boundsOf(outline, deck),
      options,
    ));
    options.sourceElements.set(sourcePath, outline);
    for (const [labelIndex, label] of parts.labels.entries()) {
      options.sourceElements?.set(`${sourcePath}.labels[${labelIndex}]`, label);
      nodes.push(measuredText(label, `${sourcePath}.labels[${labelIndex}]`, nodes.length, deck, options));
    }
    for (const [dividerIndex, divider] of parts.dividers.entries()) {
      options.sourceElements?.set(`${sourcePath}.dividers[${dividerIndex}]`, divider);
      const box = divider.getBBox();
      if (box.height > 0.1) {
        nodes.push(fallbackNode(divider, nodes.length, deck, "unsupported-mermaid-class-divider",
          `${sourcePath}.dividers[${dividerIndex}]`));
      } else {
        nodes.push({
          kind: "connector", sourcePath: `${sourcePath}.dividers[${dividerIndex}]`, z: nodes.length,
          points: [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y }].map((point) => screenPoint(divider, point, deck)),
          style: computedConnectorStyle(divider, options),
        });
      }
    }
  }
  nodes.push(...collectUnexpectedVisuals(root, deck, nodes.length, "root", consumed, options));
  nodes.push(...collectUnexpectedVisuals(svg, deck, nodes.length, "svg", new Set([root]), options));
  return diagramScene(svg, size, options, nodes);
}

function exactPathGeometry(value, commands, numbers) {
  const data = String(value || "");
  const actualCommands = data
    .replace(/[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?|[\s,]/gi, "");
  const actualNumbers = data
    .match(/[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/gi)
    ?.map(Number) || [];
  return actualCommands === commands &&
    actualNumbers.length === numbers.length &&
    actualNumbers.every((number, index) => number === numbers[index]);
}

function exactCircleGeometry(primitive, cx, cy, radius) {
  return primitive?.tag === "circle" &&
    primitive.cx === cx &&
    primitive.cy === cy &&
    primitive.r === radius;
}

function exactErPath(primitive, commands, numbers) {
  return primitive?.tag === "path" &&
    exactPathGeometry(primitive.d, commands, numbers);
}

export function knownErMarkerGeometry(id, primitives) {
  const match = /(?:^|_)er-(onlyOne|zeroOrOne|oneOrMore|zeroOrMore)(Start|End)$/
    .exec(markerReferenceId(id));
  if (!match || !Array.isArray(primitives)) return null;
  const markerClass = match[1];
  const placement = match[2] === "Start" ? "start" : "end";
  const cardinality = {
    onlyOne: "only-one",
    zeroOrOne: "zero-or-one",
    oneOrMore: "one-or-more",
    zeroOrMore: "zero-or-more",
  }[markerClass];
  const line = (x1, y1, x2, y2, index = 0, primitive = 0) => ({
    kind: "polyline",
    component: "bar",
    index,
    primitive,
    points: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
  });
  const circle = (cx, cy, radius, primitive = 0) => ({
    kind: "circle",
    component: "circle",
    primitive,
    cx,
    cy,
    radius,
  });
  const crowFoot = (left, center, right, primitive = 0) => ({
    kind: "quadratic-loop",
    component: "crow-foot",
    primitive,
    start: { x: left, y: 18 },
    firstControl: { x: center, y: 0 },
    opposite: { x: right, y: 18 },
    secondControl: { x: center, y: 36 },
  });
  let markerWidth;
  let markerHeight;
  let refX;
  let refY;
  let parts;
  if (markerClass === "onlyOne") {
    markerWidth = 18;
    markerHeight = 18;
    refX = placement === "start" ? 0 : 18;
    refY = 9;
    const expected = placement === "start"
      ? [9, 0, 9, 18, 15, 0, 15, 18]
      : [3, 0, 3, 18, 9, 0, 9, 18];
    if (primitives.length !== 1 ||
        !exactErPath(primitives[0], "MLML", expected)) return null;
    parts = placement === "start"
      ? [line(9, 0, 9, 18, 0), line(15, 0, 15, 18, 1)]
      : [line(3, 0, 3, 18, 0), line(9, 0, 9, 18, 1)];
  } else if (markerClass === "zeroOrOne") {
    markerWidth = 30;
    markerHeight = 18;
    refX = placement === "start" ? 0 : 30;
    refY = 9;
    const circleMetrics = placement === "start" ? [21, 9, 6] : [9, 9, 6];
    const lineMetrics = placement === "start" ? [9, 0, 9, 18] : [21, 0, 21, 18];
    if (primitives.length !== 2 ||
        !exactCircleGeometry(primitives[0], ...circleMetrics) ||
        !exactErPath(primitives[1], "ML", lineMetrics)) return null;
    parts = [
      circle(...circleMetrics),
      line(...lineMetrics, 0, 1),
    ];
  } else if (markerClass === "oneOrMore") {
    markerWidth = 45;
    markerHeight = 36;
    refX = placement === "start" ? 18 : 27;
    refY = 18;
    const expected = placement === "start"
      ? [0, 18, 18, 0, 36, 18, 18, 36, 0, 18, 42, 9, 42, 27]
      : [3, 9, 3, 27, 9, 18, 27, 0, 45, 18, 27, 36, 9, 18];
    const commands = placement === "start" ? "MQQML" : "MLMQQ";
    if (primitives.length !== 1 ||
        !exactErPath(primitives[0], commands, expected)) return null;
    parts = placement === "start"
      ? [crowFoot(0, 18, 36), line(42, 9, 42, 27)]
      : [line(3, 9, 3, 27), crowFoot(9, 27, 45)];
  } else {
    markerWidth = 57;
    markerHeight = 36;
    refX = placement === "start" ? 18 : 39;
    refY = 18;
    const circleMetrics = placement === "start" ? [48, 18, 6] : [9, 18, 6];
    const expected = placement === "start"
      ? [0, 18, 18, 0, 36, 18, 18, 36, 0, 18]
      : [21, 18, 39, 0, 57, 18, 39, 36, 21, 18];
    if (primitives.length !== 2 ||
        !exactCircleGeometry(primitives[0], ...circleMetrics) ||
        !exactErPath(primitives[1], "MQQ", expected)) return null;
    parts = [
      circle(...circleMetrics),
      placement === "start"
        ? crowFoot(0, 18, 36, 1)
        : crowFoot(21, 39, 57, 1),
    ];
  }
  return {
    markerClass,
    cardinality,
    placement,
    markerWidth,
    markerHeight,
    refX,
    refY,
    parts,
  };
}

function erMarkerPrimitive(element) {
  if (localName(element) === "path") {
    return { tag: "path", d: renderedPathData(element) };
  }
  if (localName(element) === "circle") {
    const metrics = numericAttributes(element, ["cx", "cy", "r"]);
    return metrics
      ? { tag: "circle", cx: metrics[0], cy: metrics[1], r: metrics[2] }
      : { tag: "circle" };
  }
  return { tag: localName(element) };
}

function visibleSvgPart(part) {
  const style = getComputedStyle(part);
  return style.display !== "none" &&
    (style.visibility !== "hidden" ||
      (part.ownerDocument.body.classList.contains("mermaid-loading") &&
        part.style.visibility !== "hidden" &&
        part.getAttribute("visibility") !== "hidden")) &&
    style.transform === "none" &&
    style.rotate === "none" &&
    style.scale === "none" &&
    style.translate === "none";
}

function erQuadraticLoopPoints(part, steps = 16) {
  const sample = (start, control, end) =>
    Array.from({ length: steps + 1 }, (_, index) => {
      const t = index / steps;
      const inverse = 1 - t;
      return {
        x: inverse * inverse * start.x +
          2 * inverse * t * control.x +
          t * t * end.x,
        y: inverse * inverse * start.y +
          2 * inverse * t * control.y +
          t * t * end.y,
      };
    });
  return [
    ...sample(part.start, part.firstControl, part.opposite),
    ...sample(part.opposite, part.secondControl, part.start).slice(1),
  ];
}

function erTerminalParts(value, relation, placement, sourcePath, deck, options) {
  const id = markerReferenceId(value);
  const marker = relation.ownerSVGElement.querySelector(`#${CSS.escape(id)}`);
  const children = marker ? directChildren(marker) : [];
  const geometry = knownErMarkerGeometry(id, children.map(erMarkerPrimitive));
  if (localName(marker) !== "marker" || !geometry || geometry.placement !== placement) {
    return { reason: "unsupported-mermaid-er-terminal-geometry" };
  }
  if (!hasClass(marker, "marker") ||
      !hasClass(marker, "er") ||
      !hasClass(marker, geometry.markerClass) ||
      (marker.getAttribute("markerUnits") || "strokeWidth") !== "strokeWidth" ||
      marker.hasAttribute("viewBox") ||
      marker.hasAttribute("preserveAspectRatio") ||
      marker.getAttribute("orient") !== "auto") {
    return { reason: "unsupported-mermaid-er-terminal-geometry" };
  }
  const markerMetrics = numericAttributes(
    marker,
    ["markerWidth", "markerHeight", "refX", "refY"],
  );
  if (!markerMetrics ||
      ![
        geometry.markerWidth,
        geometry.markerHeight,
        geometry.refX,
        geometry.refY,
      ].every((value, index) => sameMetric(markerMetrics[index], value)) ||
      getComputedStyle(marker).overflow !== "hidden") {
    return { reason: "unsupported-mermaid-er-terminal-geometry" };
  }
  if (unsupportedVisualEffect(marker) ||
      !visibleSvgPart(marker) ||
      children.some((child) => !visibleSvgPart(child))) {
    return { reason: "unsupported-mermaid-er-terminal-style" };
  }
  const relationStyle = getComputedStyle(relation);
  const relationMatrix = relation.getScreenCTM();
  const relationScale = elementScale(relation);
  const unitScale = parseMetric(relationStyle.strokeWidth);
  if (!relationMatrix ||
      Math.abs(relationMatrix.a - relationMatrix.d) > 0.001 ||
      Math.abs(relationMatrix.b) > 0.001 ||
      Math.abs(relationMatrix.c) > 0.001 ||
      !(relationMatrix.a > 0) ||
      !(unitScale > 0)) {
    return { reason: "unsupported-mermaid-er-terminal-transform" };
  }
  if (effectiveOpacity(relation) !== 1) {
    return { reason: "unsupported-mermaid-er-terminal-compositing" };
  }
  const endpoints = markerEndpointTangents(renderedPathData(relation));
  const endpoint = endpoints?.[placement];
  if (!endpoint) return { reason: "unsupported-mermaid-er-terminal-geometry" };
  const angle = Math.atan2(endpoint.direction.y, endpoint.direction.x);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const transformPoint = (point) => {
    const x = (point.x - geometry.refX) * unitScale;
    const y = (point.y - geometry.refY) * unitScale;
    return screenPoint(relation, {
      x: endpoint.point.x + cosine * x - sine * y,
      y: endpoint.point.y + sine * x + cosine * y,
    }, deck);
  };
  const markerOpacity = localOpacity(marker);
  const nodes = [];
  for (const [partIndex, part] of geometry.parts.entries()) {
    const primitive = children[part.primitive];
    if (part.kind === "circle") {
      if (localName(primitive) !== "circle" ||
          unsupportedVisualEffect(primitive)) {
        return { reason: "unsupported-mermaid-er-terminal-style" };
      }
      const primitiveStyle = getComputedStyle(primitive);
      const fill = normalizeColor(primitiveStyle.fill, options.resolveColor);
      const stroke = normalizeColor(primitiveStyle.stroke, options.resolveColor);
      const strokeWidth = parseMetric(primitiveStyle.strokeWidth);
      if (!stroke || !cssColorParts(primitiveStyle.stroke) ||
          !(strokeWidth > 0) ||
          (fill && !cssColorParts(primitiveStyle.fill)) ||
          !solidMarkerDash(primitiveStyle.strokeDasharray) ||
          parseMetric(primitiveStyle.strokeDashoffset) !== 0) {
        return { reason: "unsupported-mermaid-er-terminal-style" };
      }
      const center = transformPoint({ x: part.cx, y: part.cy });
      const radius = part.radius * unitScale * relationScale;
      if (!(radius > 0) || !Number.isFinite(radius)) {
        return { reason: "unsupported-mermaid-er-terminal-geometry" };
      }
      nodes.push({
        kind: "shape",
        sourcePath: `${sourcePath}.terminals.${placement}[${partIndex}]`,
        z: nodes.length,
        bounds: {
          x: roundedMetric(center.x - radius),
          y: roundedMetric(center.y - radius),
          width: roundedMetric(radius * 2),
          height: roundedMetric(radius * 2),
        },
        preset: "ellipse",
        style: cssStyleToSceneStyle({
          fill: primitiveStyle.fill,
          stroke: primitiveStyle.stroke,
          strokeWidth: strokeWidth * unitScale * relationScale,
          strokeDasharray: primitiveStyle.strokeDasharray,
          opacity: markerOpacity * localOpacity(primitive),
          fillOpacity: primitiveStyle.fillOpacity,
          strokeOpacity: primitiveStyle.strokeOpacity,
        }, options),
        meta: {
          mermaid: {
            kind: "er-terminal",
            cardinality: geometry.cardinality,
            placement,
            component: part.component,
          },
        },
      });
      continue;
    }
    if (localName(primitive) !== "path" ||
        unsupportedVisualEffect(primitive)) {
      return { reason: "unsupported-mermaid-er-terminal-style" };
    }
    const primitiveStyle = getComputedStyle(primitive);
    const stroke = normalizeColor(primitiveStyle.stroke, options.resolveColor);
    const strokeWidth = parseMetric(primitiveStyle.strokeWidth);
    if (!stroke ||
        !cssColorParts(primitiveStyle.stroke) ||
        !(strokeWidth > 0) ||
        normalizeColor(primitiveStyle.fill, options.resolveColor) ||
        !solidMarkerDash(primitiveStyle.strokeDasharray) ||
        parseMetric(primitiveStyle.strokeDashoffset) !== 0 ||
        primitiveStyle.strokeLinecap !== "butt" ||
        primitiveStyle.strokeLinejoin !== "miter" ||
        Number(primitiveStyle.strokeMiterlimit) !== 4) {
      return { reason: "unsupported-mermaid-er-terminal-style" };
    }
    const style = {
      ...cssStyleToSceneStyle({
        fill: "none",
        stroke: primitiveStyle.stroke,
        strokeWidth: strokeWidth * unitScale * relationScale,
        strokeDasharray: "none",
        strokeOpacity: primitiveStyle.strokeOpacity,
        opacity: markerOpacity * localOpacity(primitive),
      }, options),
      fill: null,
      dash: "solid",
      lineCap: "butt",
    };
    if (part.kind === "quadratic-loop" && effectiveStrokeAlpha(style) < 1) {
      return { reason: "unsupported-mermaid-er-terminal-compositing" };
    }
    const localPoints = part.kind === "quadratic-loop"
      ? erQuadraticLoopPoints(part)
      : part.points;
    const points = localPoints
      .map(transformPoint)
      .filter((point, index, entries) =>
        index === 0 || pointKey(point) !== pointKey(entries[index - 1]));
    if (points.length < 2) {
      return { reason: "unsupported-mermaid-er-terminal-geometry" };
    }
    nodes.push({
      kind: "connector",
      sourcePath: `${sourcePath}.terminals.${placement}[${partIndex}]`,
      z: nodes.length,
      points,
      style,
      arrowStart: "none",
      arrowEnd: "none",
      meta: {
        mermaid: {
          kind: "er-terminal",
          cardinality: geometry.cardinality,
          placement,
          component: part.component,
          ...(part.index !== undefined ? { part: part.index } : {}),
        },
      },
    });
  }
  return { geometry, nodes };
}

function markedErRelation(connector, terminals, relation, options) {
  const children = [{
    ...connector,
    sourcePath: `${connector.sourcePath}.line`,
  }, ...terminals.flatMap((terminal) => terminal.nodes)];
  const xs = [];
  const ys = [];
  for (const child of children) {
    if (child.kind === "connector") {
      xs.push(...child.points.map((point) => point.x));
      ys.push(...child.points.map((point) => point.y));
    } else {
      xs.push(child.bounds.x, child.bounds.x + child.bounds.width);
      ys.push(child.bounds.y, child.bounds.y + child.bounds.height);
    }
  }
  const bounds = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
  for (const child of children) {
    options.sourceElements.set(child.sourcePath, relation);
    if (child.kind === "connector") {
      child.points = child.points.map((point) => ({
        x: point.x - bounds.x,
        y: point.y - bounds.y,
      }));
    } else {
      child.bounds = relativeBounds(child.bounds, bounds);
    }
  }
  return {
    ...compositeGroup(
      connector.sourcePath,
      connector.z,
      bounds,
      children,
      "er-marked-relation",
    ),
    meta: { mermaid: { kind: "er-marked-relation" } },
  };
}

function erRelationPath(path, sourcePath, z, deck, options) {
  const fallback = (reason) => fallbackNode(path, z, deck, reason, sourcePath);
  try {
    if (!hasClass(path, "relationshipLine") ||
        path.getAttribute("data-et") !== "edge" ||
        path.getAttribute("data-edge") !== "true") {
      return fallback("unsupported-mermaid-er-relation-structure");
    }
    const css = getComputedStyle(path);
    const style = computedConnectorStyle(path, options);
    if (unsupportedVisualEffect(path) ||
        normalizeColor(css.fill, options.resolveColor) ||
        !normalizeColor(css.stroke, options.resolveColor) ||
        !cssColorParts(css.stroke) ||
        !(parseMetric(css.strokeWidth) > 0) ||
        parseMetric(css.strokeDashoffset) !== 0 ||
        css.strokeLinecap !== "butt" ||
        css.strokeLinejoin !== "miter" ||
        Number(css.strokeMiterlimit) !== 4 ||
        !["solid", "dash"].includes(style.dash) ||
        (css.markerMid && css.markerMid !== "none")) {
      return fallback("unsupported-mermaid-er-relation-style");
    }
    const matrix = path.getScreenCTM();
    if (!supportsConnectorTransform(path) ||
        !matrix ||
        Math.abs(matrix.a - matrix.d) > 0.001) {
      return fallback("unsupported-mermaid-er-relation-transform");
    }
    const commands = renderedPathData(path).match(/[a-df-z]/gi) || [];
    if (commands.filter((command) => command.toLowerCase() === "m").length !== 1 ||
        commands.some((command) => command.toLowerCase() === "z")) {
      return fallback("unsupported-mermaid-er-relation-path");
    }
    const start = css.markerStart || path.getAttribute("marker-start");
    const end = css.markerEnd || path.getAttribute("marker-end");
    if (!start || start === "none" || !end || end === "none") {
      return fallback("unsupported-mermaid-er-terminal-geometry");
    }
    const terminals = [
      erTerminalParts(start, path, "start", sourcePath, deck, options),
      erTerminalParts(end, path, "end", sourcePath, deck, options),
    ];
    const unsupported = terminals.find((terminal) => terminal.reason);
    if (unsupported) return fallback(unsupported.reason);
    const points = sampledPathPoints(path, deck, options);
    if (points.simplified.length < 2 ||
        pointKey(points.raw[0]) === pointKey(points.raw.at(-1))) {
      return fallback("unsupported-mermaid-er-relation-path");
    }
    const id = path.getAttribute("data-id") || path.getAttribute("id") || "";
    return markedErRelation({
      kind: "connector",
      id: path.getAttribute("id") || undefined,
      sourcePath,
      z,
      points: points.simplified,
      style,
      arrowStart: "none",
      arrowEnd: "none",
      meta: {
        mermaid: {
          kind: "er-relation",
          id,
          identification: style.dash === "dash" ? "non-identifying" : "identifying",
          rawPointCount: points.raw.length,
          simplifiedPointCount: points.simplified.length,
        },
      },
    }, terminals, path, options);
  } catch (error) {
    return fallback(
      `unsupported-mermaid-er-relation-path: ${error?.message || "path sampling failed"}`,
    );
  }
}

function erRectPart(element, sourcePath, z, deck, options, meta, reasons) {
  options.sourceElements.set(sourcePath, element);
  if (unsupportedVisualEffect(element)) {
    return fallbackNode(element, z, deck, reasons.style, sourcePath);
  }
  const paths = rectangularOutlinePaths(element, options);
  if (!paths) return fallbackNode(element, z, deck, reasons.geometry, sourcePath);
  if (!hasUniformAxisAlignedScale(element) ||
      paths.some((path) => !hasUniformAxisAlignedScale(path))) {
    return fallbackNode(element, z, deck, reasons.transform, sourcePath);
  }
  return classOutlineNode(
    paths,
    sourcePath,
    z,
    boundsOf(element, deck),
    options,
    meta,
  );
}

function erTextPart(element, sourcePath, z, deck, options, meta) {
  options.sourceElements.set(sourcePath, element);
  const bounds = boundsOf(element, deck);
  if (!(bounds.width > 0 || bounds.height > 0) &&
      !element.textContent?.trim()) return null;
  if (!safeClassLabel(element)) {
    return fallbackNode(
      element,
      z,
      deck,
      "unsupported-mermaid-er-text",
      sourcePath,
    );
  }
  return measuredText(element, sourcePath, z, deck, options, meta);
}

function erDividerPaths(element, options) {
  const paths = directChildren(element, "path");
  if (paths.length !== 2 ||
      directChildren(element).length !== 2 ||
      paths.some((path) => computedSvgStyle(path, options).dash !== "solid")) {
    return null;
  }
  const data = renderedPathData(paths[0]);
  if (data
    .replace(/[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?|[\s,]/gi, "") !== "MLLL") {
    return null;
  }
  const values = data
    .match(/[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/gi)
    ?.map(Number) || [];
  if (values.length !== 8) return null;
  const points = Array.from({ length: 4 }, (_, index) => ({
    x: values[index * 2],
    y: values[index * 2 + 1],
  }));
  const width = Math.max(...points.map((point) => point.x)) -
    Math.min(...points.map((point) => point.x));
  const height = Math.max(...points.map((point) => point.y)) -
    Math.min(...points.map((point) => point.y));
  const horizontal = width > 0.1 && height <= 0.001;
  const vertical = height > 0.1 && width <= 0.001;
  if (!horizontal && !vertical) return null;
  const matched = matchingOutline(paths[1], paths[0], (point, box) =>
    horizontal
      ? Math.min(
          Math.abs(point.y - box.y),
          Math.abs(point.y - box.y - box.height),
        )
      : Math.min(
          Math.abs(point.x - box.x),
          Math.abs(point.x - box.x - box.width),
        ));
  return matched ? { paths, horizontal } : null;
}

function erDividerPart(element, sourcePath, z, deck, options, index) {
  options.sourceElements.set(sourcePath, element);
  if (unsupportedVisualEffect(element)) {
    return fallbackNode(
      element,
      z,
      deck,
      "unsupported-mermaid-er-divider-style",
      sourcePath,
    );
  }
  const geometry = erDividerPaths(element, options);
  if (!geometry) {
    return fallbackNode(
      element,
      z,
      deck,
      "unsupported-mermaid-er-divider-geometry",
      sourcePath,
    );
  }
  const { paths, horizontal } = geometry;
  if (!hasUniformAxisAlignedScale(element) ||
      paths.some((path) => !hasUniformAxisAlignedScale(path))) {
    return fallbackNode(
      element,
      z,
      deck,
      "unsupported-mermaid-er-divider-transform",
      sourcePath,
    );
  }
  const box = paths[0].getBBox?.();
  if (!box ||
      ![box.x, box.y, box.width, box.height].every(Number.isFinite)) {
    return fallbackNode(
      element,
      z,
      deck,
      "unsupported-mermaid-er-divider-geometry",
      sourcePath,
    );
  }
  const strokeStyle = getComputedStyle(paths[1]);
  if (!normalizeColor(strokeStyle.stroke, options.resolveColor) ||
      !cssColorParts(strokeStyle.stroke) ||
      !(parseMetric(strokeStyle.strokeWidth) > 0) ||
      parseMetric(strokeStyle.strokeDashoffset) !== 0 ||
      strokeStyle.strokeLinecap !== "butt" ||
      strokeStyle.strokeLinejoin !== "miter" ||
      Number(strokeStyle.strokeMiterlimit) !== 4) {
    return fallbackNode(
      element,
      z,
      deck,
      "unsupported-mermaid-er-divider-geometry",
      sourcePath,
    );
  }
  const points = horizontal
    ? [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y }]
    : [{ x: box.x, y: box.y }, { x: box.x, y: box.y + box.height }];
  return {
    kind: "connector",
    sourcePath,
    z,
    points: points.map((point) => screenPoint(paths[1], point, deck)),
    style: computedConnectorStyle(paths[1], options),
    arrowStart: "none",
    arrowEnd: "none",
    meta: {
      mermaid: {
        kind: "er-divider",
        orientation: horizontal ? "horizontal" : "vertical",
        index,
      },
    },
  };
}

function erAttributedEntityParts(group, entityIndex, z, deck, options) {
  const children = directChildren(group);
  const outer = children.filter((child) => hasClass(child, "outer-path"));
  const rows = children.filter((child) =>
    hasClass(child, "row-rect-odd") || hasClass(child, "row-rect-even"));
  const names = children.filter((child) =>
    hasClass(child, "label") && hasClass(child, "name"));
  const labelColumns = ["type", "name", "keys", "comment"];
  const attributes = Object.fromEntries(labelColumns.map((column) => [
    column,
    children.filter((child) =>
      hasClass(child, "label") &&
      hasClass(child, `attribute-${column}`)),
  ]));
  const dividers = children.filter((child) => hasClass(child, "divider"));
  const attributed = outer.length ||
    rows.length ||
    names.length ||
    dividers.length ||
    Object.values(attributes).some((entries) => entries.length);
  if (!attributed) return null;
  const sourcePath = `entities[${entityIndex}]`;
  const roleCount = (child) => [
    hasClass(child, "outer-path"),
    hasClass(child, "row-rect-odd"),
    hasClass(child, "row-rect-even"),
    hasClass(child, "label") && hasClass(child, "name"),
    ...labelColumns.map((column) =>
      hasClass(child, "label") &&
      hasClass(child, `attribute-${column}`)),
    hasClass(child, "divider"),
  ].filter(Boolean).length;
  const malformed = outer.length !== 1 ||
    rows.length < 1 ||
    names.length !== 1 ||
    dividers.length !== 5 ||
    Object.values(attributes).some((entries) => entries.length !== rows.length) ||
    children.some((child) => roleCount(child) > 1) ||
    rows.some((row, index) =>
      hasClass(row, index % 2 === 0 ? "row-rect-even" : "row-rect-odd")) ||
    (group.getAttribute("data-look") &&
      group.getAttribute("data-look") !== "classic");
  if (malformed ||
      !hasUniformAxisAlignedScale(group) ||
      unsupportedVisualEffect(group, false)) {
    options.sourceElements.set(sourcePath, group);
    return [fallbackNode(
      group,
      z,
      deck,
      malformed
        ? "unsupported-mermaid-er-entity-structure"
        : !hasUniformAxisAlignedScale(group)
          ? "unsupported-mermaid-er-entity-transform"
          : "unsupported-mermaid-er-entity-style",
      sourcePath,
    )];
  }
  const nodes = [];
  const append = (node) => {
    if (node) nodes.push(node);
  };
  append(erRectPart(
    outer[0],
    `${sourcePath}.box`,
    z + nodes.length,
    deck,
    options,
    { mermaid: { kind: "er-entity-box", entity: entityIndex } },
    {
      geometry: "unsupported-mermaid-er-entity-geometry",
      style: "unsupported-mermaid-er-entity-style",
      transform: "unsupported-mermaid-er-entity-transform",
    },
  ));
  for (const [rowIndex, row] of rows.entries()) {
    append(erRectPart(
      row,
      `${sourcePath}.rows[${rowIndex}]`,
      z + nodes.length,
      deck,
      options,
      {
        mermaid: {
          kind: "er-attribute-row",
          entity: entityIndex,
          row: rowIndex,
          parity: rowIndex % 2 === 0 ? "odd" : "even",
        },
      },
      {
        geometry: "unsupported-mermaid-er-row-geometry",
        style: "unsupported-mermaid-er-row-style",
        transform: "unsupported-mermaid-er-row-transform",
      },
    ));
  }
  append(erTextPart(
    names[0],
    `${sourcePath}.name`,
    z + nodes.length,
    deck,
    options,
    { mermaid: { kind: "er-entity-name", entity: entityIndex } },
  ));
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (const column of labelColumns) {
      append(erTextPart(
        attributes[column][rowIndex],
        `${sourcePath}.attributes[${rowIndex}].${column}`,
        z + nodes.length,
        deck,
        options,
        {
          mermaid: {
            kind: `er-attribute-${column}`,
            entity: entityIndex,
            row: rowIndex,
            column,
          },
        },
      ));
    }
  }
  for (const [dividerIndex, divider] of dividers.entries()) {
    append(erDividerPart(
      divider,
      `${sourcePath}.dividers[${dividerIndex}]`,
      z + nodes.length,
      deck,
      options,
      dividerIndex,
    ));
  }
  const recognized = new Set([
    outer[0],
    ...rows,
    names[0],
    ...Object.values(attributes).flat(),
    ...dividers,
  ]);
  let decorationIndex = 0;
  for (const child of children) {
    if (recognized.has(child) || !isVisibleVisualSubtree(child)) continue;
    const decorationPath = `${sourcePath}.decorations[${decorationIndex++}]`;
    options.sourceElements.set(decorationPath, child);
    nodes.push(fallbackNode(
      child,
      z + nodes.length,
      deck,
      "unsupported-mermaid-er-entity-decoration",
      decorationPath,
    ));
  }
  return nodes;
}

function erEntityParts(group, entityIndex, z, deck, options) {
  const attributed = erAttributedEntityParts(
    group,
    entityIndex,
    z,
    deck,
    options,
  );
  if (attributed) return attributed;
  const sourcePath = `entities[${entityIndex}]`;
  const children = directChildren(group);
  const shapes = children.filter((child) =>
    localName(child) === "rect" &&
    hasClass(child, "basic") &&
    hasClass(child, "label-container"));
  const labels = children.filter((child) =>
    localName(child) === "g" &&
    hasClass(child, "label"));
  if (shapes.length !== 1 ||
      labels.length !== 1 ||
      (group.getAttribute("data-look") &&
        group.getAttribute("data-look") !== "classic") ||
      !hasUniformAxisAlignedScale(group) ||
      unsupportedVisualEffect(group, false)) {
    options.sourceElements.set(sourcePath, group);
    return [fallbackNode(
      group,
      z,
      deck,
      shapes.length !== 1 || labels.length !== 1
        ? "unsupported-mermaid-er-entity-structure"
        : !hasUniformAxisAlignedScale(group)
          ? "unsupported-mermaid-er-entity-transform"
          : "unsupported-mermaid-er-entity-style",
      sourcePath,
    )];
  }
  const nodes = [];
  const boxPath = `${sourcePath}.box`;
  options.sourceElements.set(boxPath, shapes[0]);
  nodes.push(simpleDiagramShape(
    shapes[0],
    boxPath,
    z,
    deck,
    options,
    { mermaid: { kind: "er-entity-box", entity: entityIndex } },
    {
      geometry: "unsupported-mermaid-er-entity-geometry",
      style: "unsupported-mermaid-er-entity-style",
      transform: "unsupported-mermaid-er-entity-transform",
    },
  ));
  const name = erTextPart(
    labels[0],
    `${sourcePath}.name`,
    z + nodes.length,
    deck,
    options,
    { mermaid: { kind: "er-entity-name", entity: entityIndex } },
  );
  if (name) nodes.push(name);
  const recognized = new Set([shapes[0], labels[0]]);
  let decorationIndex = 0;
  for (const child of children) {
    if (recognized.has(child) || !isVisibleVisualSubtree(child)) continue;
    const decorationPath = `${sourcePath}.decorations[${decorationIndex++}]`;
    options.sourceElements.set(decorationPath, child);
    nodes.push(fallbackNode(
      child,
      z + nodes.length,
      deck,
      "unsupported-mermaid-er-entity-decoration",
      decorationPath,
    ));
  }
  return nodes;
}

function unsupportedErContainers(root, deck, nodes, options) {
  const consumed = new Set();
  const blocked = new Set();
  const containers = directChildren(root, "g").filter(isClassCollection);
  for (const [index, container] of containers.entries()) {
    const reason = unsupportedVisualEffect(container, false)
      ? "unsupported-mermaid-er-container-style"
      : !hasUniformAxisAlignedScale(container)
        ? "unsupported-mermaid-er-container-transform"
        : "";
    if (!reason) continue;
    const sourcePath = `er.containers[${index}]`;
    consumed.add(container);
    blocked.add(container);
    options.sourceElements.set(sourcePath, container);
    nodes.push(fallbackNode(container, nodes.length, deck, reason, sourcePath));
  }
  return { consumed, blocked };
}

function erScene(svg, root, deck, size, options) {
  const roots = [...svg.querySelectorAll("g.root")];
  const containers = Object.fromEntries(
    ["clusters", "edgePaths", "edgeLabels", "nodes"].map((name) => [
      name,
      directChildren(root, `g.${name}`),
    ]),
  );
  if (roots.length !== 1 ||
      Object.values(containers).some((entries) => entries.length !== 1) ||
      directChildren(containers.nodes[0], "g.node").length === 0) {
    return specialDiagramStructureFallback(
      svg,
      deck,
      size,
      options,
      "unsupported-mermaid-er-structure",
    );
  }
  const nodes = [];
  const { consumed, blocked } = unsupportedErContainers(
    root,
    deck,
    nodes,
    options,
  );
  const edgeLabels = readEdgeLabels(root, deck, options, consumed, { blocked });
  for (const [relationIndex, path] of directChildren(
    containers.edgePaths[0],
    "path.relationshipLine",
  ).entries()) {
    if (hasAncestorInSet(path, blocked)) continue;
    const sourcePath = `relations[${relationIndex}]`;
    consumed.add(path);
    options.sourceElements.set(sourcePath, path);
    nodes.push(erRelationPath(
      path,
      sourcePath,
      nodes.length,
      deck,
      options,
    ));
  }
  appendEdgeLabels(nodes, edgeLabels);
  for (const [entityIndex, group] of directChildren(
    containers.nodes[0],
    "g.node",
  ).entries()) {
    if (hasAncestorInSet(group, blocked)) continue;
    consumed.add(group);
    nodes.push(...erEntityParts(
      group,
      entityIndex,
      nodes.length,
      deck,
      options,
    ));
  }
  nodes.push(...collectUnexpectedVisuals(
    root,
    deck,
    nodes.length,
    "root",
    consumed,
    options,
    {
      depthLimit: MAX_GROUP_DEPTH,
      depthReason: "unsupported-mermaid-er-depth",
    },
  ));
  nodes.push(...collectUnexpectedVisuals(
    svg,
    deck,
    nodes.length,
    "svg",
    new Set([root]),
    options,
    {
      depthLimit: MAX_GROUP_DEPTH,
      depthReason: "unsupported-mermaid-er-depth",
    },
  ));
  return diagramScene(svg, size, options, nodes);
}

function sceneFromSvg(svg, options) {
  options.sourceElements?.set("svg", svg);
  const deck = options.deck || svg.closest(".deck") || svg.parentElement || svg;
  const size = svgSize(svg, deck);
  const root = svg.querySelector("g.root");
  const diagramType = svg.getAttribute("aria-roledescription");
  const route = classifyMermaidDiagramRoute(
    diagramType,
    svg.getAttribute("class") || "",
    Boolean(root),
  );
  const nodes = [];
  const elements = svg.querySelectorAll("*");
  if (elements.length > MAX_SCENE_NODES * 10) {
    const reason = "mermaid-scene-limit-exceeded: SVG element count";
    return { scene: fallbackSceneForReason(createScene({ ...size, source: { kind: "mermaid", path: options.path } }), reason,
      boundsOf(svg, deck)), diagnostics: [{ path: "svg", kind: "fallback", reason }] };
  }
  const outerElements = [svg];
  for (let element = root; element && element !== svg; element = element.parentElement) outerElements.push(element);
  if (outerElements.some((element) => !hasUniformAxisAlignedScale(element))) {
    const reason = "unsupported-mermaid-svg-transform";
    return { scene: fallbackSceneForReason(createScene({ ...size, source: { kind: "mermaid", path: options.path } }), reason,
      boundsOf(svg, deck)), diagnostics: [{ path: "svg", kind: "fallback", reason }] };
  }
  if (outerElements.some((element) => unsupportedVisualEffect(element, false))) {
    const reason = "unsupported-mermaid-svg-style";
    return { scene: fallbackSceneForReason(createScene({ ...size, source: { kind: "mermaid", path: options.path } }),
      reason, boundsOf(svg, deck)), diagnostics: [{ path: "svg", kind: "fallback", reason }] };
  }
  if (route === "sequence") return sequenceScene(svg, deck, size, options);
  if (route === "class") return classScene(svg, root, deck, size, options);
  if (route === "er") return erScene(svg, root, deck, size, options);
  if (route === "packet") return packetScene(svg, deck, size, options);
  if (route === "treeView") return treeViewScene(svg, deck, size, options);
  if (route === "state") return stateScene(svg, root, deck, size, options);
  if (route !== "flowchart") {
    return {
      scene: fallbackSceneForReason(
        createScene({ width: size.width, height: size.height, source: { kind: "mermaid", path: options.path }, nodes: [] }),
        "unsupported-mermaid-svg-structure",
        boundsOf(svg, deck),
      ),
      diagnostics: [{ path: "svg", kind: "fallback", reason: "unsupported-mermaid-svg-structure" }],
    };
  }

  const consumed = unsupportedContainers(root, deck, nodes, options);
  const edgeLabels = readEdgeLabels(root, deck, options, consumed);
  for (const [clusterIndex, cluster] of [...root.querySelectorAll(":scope > g.clusters > g.cluster")].entries()) {
    if (consumed.has(cluster.parentElement)) continue;
    consumed.add(cluster);
    options.sourceElements?.set(`clusters[${clusterIndex}]`, cluster);
    nodes.push(clusterGroup(cluster, clusterIndex, nodes.length, deck, options));
  }
  for (const [edgeIndex, path] of [...root.querySelectorAll(":scope > g.edgePaths > path.flowchart-link")].entries()) {
    if (consumed.has(path.parentElement)) continue;
    consumed.add(path);
    options.sourceElements?.set(`edges[${edgeIndex}]`, path);
    nodes.push(connectorPath(path, `edges[${edgeIndex}]`, nodes.length, deck, options));
  }
  appendEdgeLabels(nodes, edgeLabels);
  for (const [nodeIndex, node] of [...root.querySelectorAll(":scope > g.nodes > g.node")].entries()) {
    if (consumed.has(node.parentElement)) continue;
    consumed.add(node);
    options.sourceElements?.set(`nodes[${nodeIndex}]`, node);
    nodes.push(nodeShape(node, nodeIndex, nodes.length, deck, options));
  }
  nodes.push(...collectUnexpectedVisuals(root, deck, nodes.length, "root", consumed, options));
  nodes.push(...collectUnexpectedVisuals(svg, deck, nodes.length, "svg", new Set([root]), options));

  return {
    scene: createScene({
      width: size.width,
      height: size.height,
      source: { kind: "mermaid", path: options.path },
      accessibility: definedEntries({
        title: svg.getAttribute("aria-label") || svg.getAttribute("aria-roledescription") || undefined,
      }),
      nodes,
    }),
    diagnostics: [],
  };
}

// includeSourceElements exposes DOM references alongside, never inside, the serializable scene.
export function mermaidSvgToScene(svg, options = {}) {
  const normalizedOptions = normalizeOptions(options);
  const fallbackBounds = (() => {
    try {
      const deck = normalizedOptions.deck || svg?.closest?.(".deck") || svg?.parentElement || svg;
      const size = svg && deck ? svgSize(svg, deck) : { width: 0, height: 0 };
      return svg && deck ? boundsOf(svg, deck) : { x: 0, y: 0, width: size.width, height: size.height };
    } catch (_) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
  })();
  try {
    const result = sceneFromSvg(svg, normalizedOptions);
    preservePaintOrder(result.scene.nodes, normalizedOptions.sourceElements);
    const limited = enforceSceneLimits(result.scene, { bounds: fallbackBounds });
    const normalized = normalizeScene(limited.scene);
    const diagnostics = [...result.diagnostics, ...limited.diagnostics, ...normalized.diagnostics];
    for (const node of normalized.scene.nodes) {
      if (node.kind === "fallback" && !diagnostics.some((entry) => entry.path === node.sourcePath && entry.reason === node.reason)) {
        diagnostics.push({ path: node.sourcePath, kind: "fallback", reason: node.reason });
      }
    }
    validateScene(normalized.scene);
    return {
      scene: normalized.scene, diagnostics,
      ...(normalizedOptions.includeSourceElements ? { sourceElements: normalizedOptions.sourceElements } : {}),
    };
  } catch (error) {
    const reason = `mermaid-scene-adapter-failed: ${error?.message || "unknown error"}`;
    const scene = fallbackSceneForReason(
      createScene({
        width: fallbackBounds.width,
        height: fallbackBounds.height,
        source: { kind: "mermaid", path: normalizedOptions.path },
        nodes: [],
      }),
      reason,
      fallbackBounds,
    );
    const normalized = normalizeScene(scene);
    validateScene(normalized.scene);
    return {
      scene: normalized.scene,
      diagnostics: [{ path: "svg", kind: "fallback", reason }, ...normalized.diagnostics],
      ...(normalizedOptions.includeSourceElements ? { sourceElements: normalizedOptions.sourceElements } : {}),
    };
  }
}
