import {
  MAX_CONNECTOR_POINTS,
  MAX_GROUP_DEPTH,
  MAX_SCENE_NODES,
  MAX_TEXT_PARAGRAPHS,
  MAX_TEXT_RUNS,
  createScene,
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

function finiteNumberOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nonEmptyStringOr(value, fallback) {
  return typeof value === "string" && value ? value : fallback;
}

function roundedMetric(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
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

export function classifyPolygonPreset(points, options = {}) {
  const fallbackPreset = options.fallbackPreset === null ? null : nonEmptyStringOr(options.fallbackPreset, "rect");
  const tolerance = finiteNumberOr(options.tolerance, 0.04);
  const normalized = normalizePolygon(points);
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

export function markerIdToArrow(value) {
  const text = String(value || "").trim();
  const marker = /^url\(["']?#([^"')]+)["']?\)$/i.exec(text)?.[1] || text.replace(/^#/, "");
  if (!marker) return "none";
  if (/point(?:Start|End)(?:-margin)?$/i.test(marker)) return "triangle";
  if (/circle(?:Start|End)(?:-margin)?$/i.test(marker)) return "oval";
  if (/diamond(?:Start|End)(?:-margin)?$/i.test(marker)) return "diamond";
  if (/arrow(?:Start|End)(?:-margin)?$/i.test(marker)) return "arrow";
  if (/-arrowhead$/.test(marker)) return "triangle";
  if (/-openarrowhead$/.test(marker)) return "arrow";
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
  let simplified = parsed.filter((point, index) => index === 0 || pointKey(point) !== pointKey(parsed[index - 1]));
  const threshold = Math.max(0, finiteNumberOr(tolerance, DEFAULT_MERMAID_SCENE_OPTIONS.simplifyTolerance));
  let changed = true;
  while (changed && simplified.length > 2) {
    changed = false;
    const next = [simplified[0]];
    for (let index = 1; index < simplified.length - 1; index += 1) {
      const previous = next[next.length - 1];
      const current = simplified[index];
      const following = simplified[index + 1];
      if (distanceToSegment(current, previous, following) <= threshold) {
        changed = true;
      } else {
        next.push(current);
      }
    }
    next.push(simplified[simplified.length - 1]);
    simplified = next;
  }
  return simplified;
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

function dashToSceneDash(value) {
  const text = String(value || "").trim();
  if (!text || text === "none" || text === "0" || text === "0px") return "solid";
  const values = text
    .split(/[,\s]+/)
    .map((part) => Number.parseFloat(part))
    .filter(Number.isFinite);
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
  const opacity = Number.parseFloat(style.opacity);
  const cornerRadius = parseMetric(style.cornerRadius ?? style.rx);
  return definedEntries({
    fill: style.fill !== undefined ? normalizeColor(style.fill, resolveColor) : undefined,
    stroke: style.stroke !== undefined ? normalizeColor(style.stroke, resolveColor) : undefined,
    strokeWidth,
    dash: style.dash !== undefined || style.strokeDasharray !== undefined
      ? dashToSceneDash(style.dash ?? style.strokeDasharray)
      : undefined,
    opacity: Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : undefined,
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
    sourceElements: options.includeSourceElements === true ? new Map() : null,
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
    rx: element.getAttribute("rx"),
  }, options);
}

function computedTextStyle(element, options) {
  const style = getComputedStyle(element);
  return {
    fontFamily: style.fontFamily,
    fontSize: roundedMetric(Number.parseFloat(style.fontSize) * elementScale(element)),
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    color: element.namespaceURI === SVG_NS ? style.fill : style.color,
    textAlign: style.textAlign,
    opacity: effectiveOpacity(element),
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
    const computed = Number.parseFloat(getComputedStyle(current).opacity);
    opacity *= Number.isFinite(computed) ? computed : 1;
    if (localName(current) === "svg") break;
  }
  return opacity;
}

function labelInfo(root, selector, deck, options) {
  const label = root.querySelector(selector);
  const text = label?.innerText?.trim() || label?.textContent?.trim() || "";
  if (!text) return null;
  return {
    text: structuredLabelText(label, options),
    bounds: boundsOf(label, deck),
  };
}

function structuredLabelText(element, options) {
  const paragraphs = [];
  let runs = [];
  const flush = () => {
    if (!runs.length) return;
    runs[0].text = runs[0].text.trimStart();
    runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd();
    if (runs.some((run) => run.text)) paragraphs.push({ alignment: "center", runs });
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
    const block = tag === "p" || tag === "div" || tag === "tspan";
    if (block) flush();
    for (const child of node.childNodes || []) walk(child);
    if (block) flush();
  };
  walk(element);
  flush();
  return { paragraphs: paragraphs.length ? paragraphs : textToSceneText("", computedTextStyle(element, options), options).paragraphs };
}

function fallbackNode(element, z, deck, reason, sourcePath) {
  let bounds = boundsOf(element, deck);
  if (["path", "line", "polyline"].includes(localName(element))) {
    const marked = element.hasAttribute("marker-start") || element.hasAttribute("marker-end");
    const padding = Math.max(1, Number.parseFloat(getComputedStyle(element).strokeWidth) || 0,
      marked ? 20 : 0) * elementScale(element);
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

function unsupportedVisualEffect(element) {
  return [element, ...element.querySelectorAll("*")].some((child) => {
    const style = getComputedStyle(child);
    return (style.filter && style.filter !== "none") ||
      (style.clipPath && style.clipPath !== "none") ||
      (style.maskImage && style.maskImage !== "none") ||
      Number.parseFloat(style.fillOpacity) < 1 || Number.parseFloat(style.strokeOpacity) < 1 ||
      /url\(/i.test(`${style.fill} ${style.stroke}`);
  });
}

function nodeText(group, deck, options) {
  const label = labelInfo(group, "span.nodeLabel, text", deck, options);
  return {
    ...(label ? { text: label.text } : {}),
    textLayout: { alignment: "center", verticalAlignment: "middle", textWrap: "none" },
  };
}

function paintedPathStyle(paths, options) {
  const fill = paths.find((path) => getComputedStyle(path).fill !== "none") || paths[0];
  const stroke = paths.find((path) => getComputedStyle(path).stroke !== "none") || fill;
  return { ...computedSvgStyle(stroke, options), fill: computedSvgStyle(fill, options).fill };
}

function compositeGroup(sourcePath, z, bounds, children, shape) {
  return {
    kind: "group", sourcePath, z, bounds,
    children: children.map((child, index) => ({ ...child, z: z + (index + 1) / (children.length + 1) })),
    style: { fill: null, stroke: null, strokeWidth: 0 },
    meta: { mermaid: { kind: "node", shape } },
  };
}

function stadiumParts(shape, group, sourcePath, z, deck, options) {
  const bounds = boundsOf(shape, deck);
  const style = paintedPathStyle(directChildren(shape, "path"), options);
  if (!opaqueCompositeStyle(style)) return fallbackNode(group, z, deck, "unsupported-mermaid-composite-paint", sourcePath);
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
  if (label) children.push({
    kind: "text", sourcePath: `${sourcePath}.label`, z: children.length,
    bounds: relativeBounds(label.bounds, bounds), text: label.text,
    textLayout: { alignment: "center", verticalAlignment: "middle", textWrap: "none" },
  });
  return compositeGroup(sourcePath, z, bounds, children, "stadium");
}

function opaqueCompositeStyle(style) {
  return style.fill && (style.opacity === undefined || style.opacity === 1) &&
    !/^rgba\(/i.test(style.fill);
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
  if (!opaqueCompositeStyle(style)) return null;
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
  if (label) children.push({
    kind: "text", sourcePath: `${sourcePath}.label`, z: children.length,
    bounds: relativeBounds(label.bounds, bounds), text: label.text,
    textLayout: { alignment: "center", verticalAlignment: "middle", textWrap: "none" },
  });
  return compositeGroup(sourcePath, z, bounds, children, "cylinder");
}

function nodeShape(group, sourceIndex, z, deck, options) {
  const sourcePath = `nodes[${sourceIndex}]`;
  if (unsupportedVisualEffect(group) || group.querySelector("img, image, svg, .katex, use")) {
    return fallbackNode(group, z, deck, "unsupported-mermaid-node-content", sourcePath);
  }
  const shape = directChildren(group).find((child) => hasClass(child, "label-container"));
  if (!shape) return fallbackNode(group, z, deck, "unsupported-mermaid-node-structure", `nodes[${sourceIndex}]`);
  if (directChildren(group).some((child) => child !== shape && !hasClass(child, "label"))) {
    return fallbackNode(group, z, deck, "unsupported-mermaid-node-shape", sourcePath);
  }
  if (localName(shape) === "path") {
    const cylinder = cylinderParts(shape, group, sourcePath, z, deck, options);
    if (cylinder) return cylinder;
  }
  if (localName(shape) === "g") {
    const circles = directChildren(shape, "circle");
    if (circles.length === 2 && directChildren(shape).length === 2 &&
        hasClass(circles[0], "outer-circle") && hasClass(circles[1], "inner-circle")) {
      const bounds = boundsOf(shape, deck);
      return compositeGroup(sourcePath, z, bounds, circles.map((circle, index) => ({
        kind: "shape", sourcePath: `${sourcePath}.circles[${index}]`, z: index,
        bounds: relativeBounds(boundsOf(circle, deck), bounds), preset: "ellipse",
        style: computedSvgStyle(circle, options),
        ...(index === 1 ? nodeText(group, deck, options) : {}),
      })), "double-circle");
    }
    const paths = directChildren(shape, "path");
    if (paths.length === 2 && directChildren(shape).length === 2 && isStadiumPath(paths[0])) {
      return stadiumParts(shape, group, sourcePath, z, deck, options);
    }
  }
  const preset = shapePresetFor(shape);
  if (!preset || directChildren(group).some((child) => child !== shape && !hasClass(child, "label"))) {
    return fallbackNode(group, z, deck, "unsupported-mermaid-node-shape", sourcePath);
  }
  const label = labelInfo(group, "span.nodeLabel, text", deck, options);
  return definedEntries({
    kind: "shape",
    id: group.getAttribute("id") || undefined,
    sourcePath: `nodes[${sourceIndex}]`,
    z,
    bounds: boundsOf(shape, deck),
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
        kind: "node",
        tag: localName(shape),
        polygonSignature: localName(shape) === "polygon" ? polygonPointsSignature(shape.getAttribute("points")) : undefined,
      }),
    },
  });
}

function clusterGroup(group, sourceIndex, z, deck, options) {
  const rect = directChildren(group, "rect")[0];
  if (!rect) return fallbackNode(group, z, deck, "unsupported-mermaid-cluster-structure", `clusters[${sourceIndex}]`);
  const label = labelInfo(group, "span.nodeLabel", deck, options);
  return definedEntries({
    kind: "group",
    id: group.getAttribute("id") || undefined,
    sourcePath: `clusters[${sourceIndex}]`,
    z,
    bounds: boundsOf(rect, deck),
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

function sampledPathPoints(path, svg, deck, options) {
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

function connectorPath(path, sourceIndex, z, svg, deck, options, edgeLabels) {
  try {
    if (unsupportedVisualEffect(path) || ["marker-start", "marker-end"].some((name) =>
      path.getAttribute(name) && markerIdToArrow(path.getAttribute(name)) === "none")) {
      return fallbackNode(path, z, deck, "unsupported-mermaid-edge-style", `edges[${sourceIndex}]`);
    }
    const points = sampledPathPoints(path, svg, deck, options);
    const id = path.getAttribute("data-id") || path.getAttribute("id") || "";
    return definedEntries({
      kind: "connector",
      id: path.getAttribute("id") || undefined,
      sourcePath: `edges[${sourceIndex}]`,
      z,
      points: points.simplified,
      style: computedSvgStyle(path, options),
      arrowStart: markerIdToArrow(path.getAttribute("marker-start")),
      arrowEnd: markerIdToArrow(path.getAttribute("marker-end")),
      meta: {
        mermaid: {
          kind: "edge",
          id,
          rawPointCount: points.raw.length,
          simplifiedPointCount: points.simplified.length,
        },
      },
    });
  } catch (error) {
    return fallbackNode(path, z, deck, `unsupported-mermaid-edge-path: ${error?.message || "path sampling failed"}`, `edges[${sourceIndex}]`);
  }
}

function readEdgeLabels(root, deck, options) {
  const labels = new Map();
  for (const group of root.querySelectorAll(":scope > g.edgeLabels > g.edgeLabel")) {
    const labelGroup = group.querySelector(":scope > g.label");
    const id = labelGroup?.getAttribute("data-id") || "";
    if (id) options.sourceElements?.set(`edgeLabels[${id}]`, group);
    if (id && (group.querySelector("img, image, svg, .katex, use") || unsupportedVisualEffect(group))) {
      labels.set(id, { fallback: fallbackNode(group, 0, deck,
        "unsupported-mermaid-edge-label", `edgeLabels[${id}]`) });
      continue;
    }
    const label = labelInfo(group, "span.edgeLabel, text", deck, options);
    const background = group.querySelector(".edgeLabel p, span.edgeLabel, rect");
    const style = background && getComputedStyle(background);
    if (id && label && label.bounds.width > 0 && label.bounds.height > 0) {
      labels.set(id, { ...label, fill: normalizeColor(style?.backgroundColor === "rgba(0, 0, 0, 0)"
        ? (background?.localName === "rect" ? style.fill : null) : style?.backgroundColor, options.resolveColor) });
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

function isKnownLabelSubtree(element) {
  return hasClass(element, "edgeLabel") || hasClass(element, "label") || hasClass(element, "cluster-label");
}

function isVisibleUnknown(element) {
  if (IGNORED_TAGS.has(tagName(element)) || IGNORED_TAGS.has(localName(element))) return false;
  if (isKnownContainer(element)) return false;
  if (!VISUAL_TAGS.has(localName(element)) && localName(element) !== "g") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function collectUnexpectedVisuals(container, deck, startZ, sourcePath, consumed = new Set(), options = {}) {
  const fallbacks = [];
  const walk = (element) => {
    if (consumed.has(element)) return;
    if (IGNORED_TAGS.has(tagName(element)) || IGNORED_TAGS.has(localName(element))) return;
    if (isKnownLabelSubtree(element)) return;
    if (isVisibleUnknown(element)) {
      const path = `${sourcePath}.unknown[${fallbacks.length}]`;
      options.sourceElements?.set(path, element);
      fallbacks.push(fallbackNode(element, startZ + fallbacks.length, deck, "unsupported-mermaid-svg-element", path));
      return;
    }
    for (const child of directChildren(element)) walk(child);
  };
  for (const child of directChildren(container)) walk(child);
  return fallbacks;
}

function appendEdgeLabels(nodes, labels) {
  for (const [id, label] of labels) {
    if (label.fallback) nodes.push({ ...label.fallback, z: nodes.length });
    else nodes.push({
      kind: "shape", sourcePath: `edgeLabels[${id}]`, z: nodes.length,
      bounds: label.bounds, preset: "rect", style: { fill: label.fill, stroke: null, strokeWidth: 0 },
      text: label.text,
      textLayout: { alignment: "center", verticalAlignment: "middle", textWrap: "none" },
      meta: { mermaid: { kind: "edge-label", edgeId: id } },
    });
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

function measuredText(element, sourcePath, z, deck, options) {
  return {
    kind: "text", sourcePath, z, bounds: boundsOf(element, deck),
    text: structuredLabelText(element, options),
    textLayout: { alignment: "center", verticalAlignment: "middle", textWrap: "none" },
  };
}

function sequenceScene(svg, deck, size, options) {
  const nodes = [];
  const walk = (element) => {
    const tag = localName(element);
    if (IGNORED_TAGS.has(tag)) return;
    const sourcePath = `sequence[${nodes.length}]`;
    options.sourceElements?.set(sourcePath, element);
    if (unsupportedVisualEffect(element)) {
      nodes.push(fallbackNode(element, nodes.length, deck, "unsupported-mermaid-sequence-style", sourcePath));
      return;
    }
    if (tag === "g") {
      for (const child of directChildren(element)) walk(child);
      return;
    }
    if (tag === "rect" && /^(?:actor|activation\d+|note)(?:\s|$)/.test(element.getAttribute("class") || "")) {
      nodes.push({ kind: "shape", sourcePath, z: nodes.length, bounds: boundsOf(element, deck),
        preset: rectPreset(element), style: computedSvgStyle(element, options) });
      return;
    }
    if (tag === "text" && /^(?:actor|messageText|noteText)(?:\s|$)/.test(element.getAttribute("class") || "") &&
        !element.querySelector(":not(tspan)")) {
      nodes.push(measuredText(element, sourcePath, nodes.length, deck, options));
      return;
    }
    if (tag === "line" && /^(?:actor-line|messageLine\d+)(?:\s|$)/.test(element.getAttribute("class") || "") &&
        !["marker-start", "marker-end"].some((name) => element.getAttribute(name) &&
          markerIdToArrow(element.getAttribute(name)) === "none")) {
      nodes.push({
        kind: "connector", sourcePath, z: nodes.length,
        points: [1, 2].map((index) => screenPoint(element, {
          x: Number(element.getAttribute(`x${index}`)), y: Number(element.getAttribute(`y${index}`)),
        }, deck)),
        style: computedSvgStyle(element, options),
        arrowStart: markerIdToArrow(element.getAttribute("marker-start")),
        arrowEnd: markerIdToArrow(element.getAttribute("marker-end")),
      });
      return;
    }
    if (VISUAL_TAGS.has(tag)) nodes.push(fallbackNode(element, nodes.length, deck,
      "unsupported-mermaid-sequence-element", sourcePath));
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

function classScene(svg, root, deck, size, options) {
  const nodes = [];
  const consumed = new Set();
  for (const [index, path] of [...root.querySelectorAll(":scope > g.edgePaths > path.relation")].entries()) {
    consumed.add(path);
    options.sourceElements?.set(`edges[${index}]`, path);
    nodes.push(connectorPath(path, index, nodes.length, svg, deck, options, new Map()));
  }
  appendEdgeLabels(nodes, readEdgeLabels(root, deck, options));
  for (const [index, group] of [...root.querySelectorAll(":scope > g.nodes > g.node")].entries()) {
    consumed.add(group);
    const sourcePath = `classes[${index}]`;
    options.sourceElements?.set(sourcePath, group);
    const outline = group.querySelector(":scope > g.label-container");
    const paths = outline ? directChildren(outline, "path") : [];
    const children = directChildren(group);
    if (unsupportedVisualEffect(group) || paths.length !== 2 || !isRectanglePath(paths[0]) ||
        group.querySelector("img, image, svg, .katex, use") ||
        children.some((child) => child !== outline &&
          !["annotation-group", "label-group", "members-group", "methods-group", "divider"].some((name) => hasClass(child, name)))) {
      nodes.push(fallbackNode(group, nodes.length, deck, "unsupported-mermaid-class-node", sourcePath));
      continue;
    }
    nodes.push({
      kind: "shape", sourcePath, z: nodes.length, bounds: boundsOf(outline, deck),
      preset: "rect", style: paintedPathStyle(paths, options),
    });
    for (const [labelIndex, label] of [...group.querySelectorAll("span.nodeLabel")].entries()) {
      options.sourceElements?.set(`${sourcePath}.labels[${labelIndex}]`, label);
      nodes.push(measuredText(label, `${sourcePath}.labels[${labelIndex}]`, nodes.length, deck, options));
    }
    for (const [dividerIndex, divider] of [...group.querySelectorAll(":scope > g.divider > path")].entries()) {
      options.sourceElements?.set(`${sourcePath}.dividers[${dividerIndex}]`, divider);
      const box = divider.getBBox();
      if (box.height > 0.1) {
        nodes.push(fallbackNode(divider, nodes.length, deck, "unsupported-mermaid-class-divider",
          `${sourcePath}.dividers[${dividerIndex}]`));
      } else {
        nodes.push({
          kind: "connector", sourcePath: `${sourcePath}.dividers[${dividerIndex}]`, z: nodes.length,
          points: [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y }].map((point) => screenPoint(divider, point, deck)),
          style: computedSvgStyle(divider, options),
        });
      }
    }
  }
  nodes.push(...collectUnexpectedVisuals(root, deck, nodes.length, "root", consumed, options));
  return diagramScene(svg, size, options, nodes);
}

function sceneFromSvg(svg, options) {
  options.sourceElements?.set("svg", svg);
  const deck = options.deck || svg.closest(".deck") || svg.parentElement || svg;
  const size = svgSize(svg, deck);
  const root = svg.querySelector("g.root");
  const nodes = [];
  const consumed = new Set();
  const elements = svg.querySelectorAll("*");
  if (elements.length > MAX_SCENE_NODES * 10 || [...elements].some((element) => {
    if (!VISUAL_TAGS.has(localName(element)) || element.closest("defs, marker")) return false;
    const matrix = element.getScreenCTM?.();
    return matrix && (Math.abs(matrix.b) > 0.001 || Math.abs(matrix.c) > 0.001 || matrix.a <= 0 || matrix.d <= 0);
  })) {
    const reason = elements.length > MAX_SCENE_NODES * 10
      ? "mermaid-scene-limit-exceeded: SVG element count" : "unsupported-mermaid-svg-transform";
    return { scene: fallbackSceneForReason(createScene({ ...size, source: { kind: "mermaid", path: options.path } }), reason,
      boundsOf(svg, deck)), diagnostics: [{ path: "svg", kind: "fallback", reason }] };
  }
  const diagramType = svg.getAttribute("aria-roledescription");
  if (diagramType === "sequence") return sequenceScene(svg, deck, size, options);
  if (root && diagramType === "class") return classScene(svg, root, deck, size, options);
  if (!root || !hasClass(svg, "flowchart")) {
    return {
      scene: fallbackSceneForReason(
        createScene({ width: size.width, height: size.height, source: { kind: "mermaid", path: options.path }, nodes: [] }),
        "unsupported-mermaid-svg-structure",
        boundsOf(svg, deck),
      ),
      diagnostics: [{ path: "svg", kind: "fallback", reason: "unsupported-mermaid-svg-structure" }],
    };
  }

  const edgeLabels = readEdgeLabels(root, deck, options);
  for (const [clusterIndex, cluster] of [...root.querySelectorAll(":scope > g.clusters > g.cluster")].entries()) {
    consumed.add(cluster);
    options.sourceElements?.set(`clusters[${clusterIndex}]`, cluster);
    nodes.push(clusterGroup(cluster, clusterIndex, nodes.length, deck, options));
  }
  for (const [edgeIndex, path] of [...root.querySelectorAll(":scope > g.edgePaths > path.flowchart-link")].entries()) {
    consumed.add(path);
    options.sourceElements?.set(`edges[${edgeIndex}]`, path);
    nodes.push(connectorPath(path, edgeIndex, nodes.length, svg, deck, options, edgeLabels));
  }
  appendEdgeLabels(nodes, edgeLabels);
  for (const [nodeIndex, node] of [...root.querySelectorAll(":scope > g.nodes > g.node")].entries()) {
    consumed.add(node);
    options.sourceElements?.set(`nodes[${nodeIndex}]`, node);
    nodes.push(nodeShape(node, nodeIndex, nodes.length, deck, options));
  }
  nodes.push(...collectUnexpectedVisuals(root, deck, nodes.length, "root", consumed, options));

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
    const limited = enforceSceneLimits(result.scene, { bounds: fallbackBounds });
    const normalized = normalizeScene(limited.scene);
    const diagnostics = [...result.diagnostics, ...limited.diagnostics, ...normalized.diagnostics];
    validateScene(normalized.scene);
    return {
      scene: normalized.scene, diagnostics,
      ...(normalizedOptions.sourceElements ? { sourceElements: normalizedOptions.sourceElements } : {}),
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
      ...(normalizedOptions.sourceElements ? { sourceElements: normalizedOptions.sourceElements } : {}),
    };
  }
}
