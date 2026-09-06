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
    rx: element.getAttribute("rx"),
  }, options);
}

function computedConnectorStyle(element, options) {
  const style = getComputedStyle(element);
  const lineCap = LINE_CAPS.has(style.strokeLinecap) ? style.strokeLinecap : undefined;
  return definedEntries({
    ...computedSvgStyle(element, options),
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

function unsupportedVisualEffect(element, descendants = true) {
  return [element, ...(descendants ? element.querySelectorAll("*") : [])].some((child) => {
    const style = getComputedStyle(child);
    return (style.filter && style.filter !== "none") ||
      (style.clipPath && style.clipPath !== "none") ||
      (style.maskImage && style.maskImage !== "none") ||
      (localName(child) === "g" && Number.parseFloat(style.opacity) < 1 &&
        child.querySelectorAll([...VISUAL_TAGS].join(",")).length > 1) ||
      Number.parseFloat(style.fillOpacity) < 1 || Number.parseFloat(style.strokeOpacity) < 1 ||
      /url\(/i.test(`${style.fill} ${style.stroke}`);
  });
}

function connectorArrow(value, element, placement) {
  const id = markerReferenceId(value);
  const relation = /(?:^|[-_])(composition|dependency)(Start|End)(?:-margin)?$/i.exec(id);
  const sequenceHead = /-filled-head$/.test(id);
  if (!relation && !sequenceHead) return markerIdToArrow(value);
  const marker = element.ownerSVGElement.querySelector(`#${CSS.escape(id)}`);
  const children = marker ? directChildren(marker) : [];
  if (localName(marker) !== "marker" || children.length !== 1 || localName(children[0]) !== "path" ||
      unsupportedVisualEffect(marker)) return "none";
  // Mermaid 11.15.0 emits this forward-facing marker only at the end. Its
  // concave filled geometry is a stealth head, not an open asynchronous head.
  if (sequenceHead && (placement !== "end" || marker.getAttribute("orient") !== "auto" ||
      (marker.getAttribute("markerUnits") || "strokeWidth") !== "strokeWidth" ||
      marker.hasAttribute("viewBox") ||
      [["refX", 15.5], ["refY", 7], ["markerWidth", 20], ["markerHeight", 28]]
        .some(([name, value]) => Number(marker.getAttribute(name)) !== value))) return "none";
  const path = children[0];
  // The pinned class renderer uses a filled diamond or a concave (stealth) head,
  // not the hollow diamond/triangle used for aggregation and inheritance.
  const d = path.getAttribute("d") || "";
  if (d.replace(/[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?|[\s,]/gi, "") !== "MLLLZ") return "none";
  const values = d.match(/[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/gi)?.map(Number) || [];
  const expected = sequenceHead ? [18, 7, 9, 13, 14, 7, 9, 1]
    : relation[1].toLowerCase() === "composition" ? [18, 7, 9, 13, 1, 7, 9, 1]
    : relation[2].toLowerCase() === "start" ? [5, 7, 9, 13, 1, 7, 9, 1] : [18, 7, 9, 13, 14, 7, 9, 1];
  if (values.length !== expected.length || values.some((value, index) => value !== expected[index])) return "none";
  const paint = getComputedStyle(path);
  const stroke = getComputedStyle(element).stroke;
  if (!normalizeColor(paint.fill) || paint.fill !== stroke ||
      (normalizeColor(paint.stroke) && Number.parseFloat(paint.strokeWidth) > 0 &&
        (paint.stroke !== stroke || dashToSceneDash(paint.strokeDasharray) !== "solid")) ||
      [marker, path].some((part) => {
        const style = getComputedStyle(part);
        return Number.parseFloat(style.opacity) !== 1 || style.transform !== "none" ||
          style.rotate !== "none" || style.scale !== "none" || style.translate !== "none";
      })) return "none";
  return markerIdToArrow(value);
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
      !/^rgb\(\d+, \d+, \d+\)$/.test(paint.stroke) || !(parseMetric(paint.strokeWidth) > 0) || effectiveOpacity(element) !== 1 ||
      !normalizeColor(lineStyle.stroke) || !(parseMetric(lineStyle.strokeWidth) > 0) ||
      roundedMetric(parseMetric(lineStyle.strokeWidth) * scale) <= 0 ||
      (localName(element) === "path" && normalizeColor(lineStyle.fill)) ||
      (geometry.kind !== "cross" && normalizeColor(paint.fill)) ||
      !solidMarkerDash(paint.strokeDasharray) || parseMetric(paint.strokeDashoffset) !== 0 ||
      paint.strokeLinecap !== "butt" || paint.strokeLinejoin !== "miter" || Number(paint.strokeMiterlimit) !== 4 ||
      [element, marker, outline].some((part) => {
        const style = getComputedStyle(part);
        return Number(style.opacity) !== 1 || (part !== element && (style.transform !== "none" ||
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
  return {
    kind: geometry.kind, placement, strokes,
    style: { fill: null, stroke: normalizeColor(paint.stroke, options.resolveColor),
      strokeWidth, dash: "solid", lineCap: "butt", opacity: 1 },
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
    ...(label ? { text: label.text } : {}),
    textLayout: { alignment: "center", verticalAlignment: "middle", textWrap: "none" },
  };
}

function paintedPathStyle(paths, options) {
  const fill = paths.find((path) => getComputedStyle(path).fill !== "none") || paths[0];
  const stroke = paths.find((path) => getComputedStyle(path).stroke !== "none") || fill;
  return { ...computedSvgStyle(stroke, options), fill: computedSvgStyle(fill, options).fill };
}

function compatiblePathPaint(paths, options) {
  const style = paintedPathStyle(paths, options);
  return style.dash === "solid" && paths.every((path) => {
    const paint = computedSvgStyle(path, options);
    return paint.opacity === style.opacity &&
      (!paint.fill || paint.fill === style.fill) &&
      (!paint.stroke || (paint.stroke === style.stroke && paint.strokeWidth === style.strokeWidth &&
        paint.dash === style.dash));
  });
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
  if (label) children.push({
    kind: "text", sourcePath: `${sourcePath}.label`, z: children.length,
    bounds: relativeBounds(label.bounds, bounds), text: label.text,
    textLayout: { alignment: "center", verticalAlignment: "middle", textWrap: "none" },
  });
  return compositeGroup(sourcePath, z, bounds, children, "stadium");
}

function opaqueCompositeStyle(style) {
  return style.fill && (style.opacity === undefined || style.opacity === 1) &&
    style.dash === "solid" && !/^rgba\(/i.test(style.fill);
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
    if (paths.length === 2 && directChildren(shape).length === 2 && isStadiumPath(paths[0]) &&
        matchingStadiumOutline(paths[1], paths[0])) {
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
  if (unsupportedVisualEffect(group) || group.querySelector("img, image, svg, .katex, use") ||
      directChildren(group).some((child) => child !== rect && !hasClass(child, "cluster-label"))) {
    return fallbackNode(group, z, deck, "unsupported-mermaid-cluster-content", `clusters[${sourceIndex}]`);
  }
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

function readEdgeLabels(root, deck, options, consumed) {
  const labels = new Map();
  const selector = ":scope > g.edgeLabels > g.edgeLabel, :scope > g.edgeLabels > g.edgeTerminals";
  for (const [index, group] of [...root.querySelectorAll(selector)].entries()) {
    if (consumed?.has(group.parentElement)) continue;
    consumed?.add(group);
    const terminal = hasClass(group, "edgeTerminals");
    const labelGroup = group.querySelector(":scope > g.label");
    const id = labelGroup?.getAttribute("data-id") || "";
    let key = id || `unidentified-${index}`;
    while (labels.has(key)) key += `-${index}`;
    const sourcePath = `${terminal ? "edgeTerminals" : "edgeLabels"}[${key}]`;
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
    const style = background && getComputedStyle(background);
    if (label && label.bounds.width > 0 && label.bounds.height > 0) {
      labels.set(key, { ...label, sourcePath, terminal, fill: normalizeColor(style?.backgroundColor === "rgba(0, 0, 0, 0)"
        ? (background?.localName === "rect" ? style.fill : null) : style?.backgroundColor, options.resolveColor) });
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

function collectUnexpectedVisuals(container, deck, startZ, sourcePath, consumed = new Set(), options = {}) {
  const fallbacks = [];
  const walk = (element) => {
    if (consumed.has(element)) return;
    if (IGNORED_TAGS.has(tagName(element)) || IGNORED_TAGS.has(localName(element))) return;
    if (getComputedStyle(element).display === "none") return;
    const containsConsumed = [...consumed].some((child) => element.contains(child));
    if (!containsConsumed && isVisibleUnknown(element)) {
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
      kind: "shape", sourcePath: label.sourcePath, z: nodes.length,
      bounds: label.bounds, preset: "rect", style: { fill: label.fill, stroke: null, strokeWidth: 0 },
      text: label.text,
      textLayout: { alignment: "center", verticalAlignment: "middle", textWrap: "none" },
      meta: { mermaid: { kind: label.terminal ? "edge-terminal" : "edge-label", edgeId: id } },
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

function unsupportedContainers(root, deck, nodes, options) {
  const consumed = new Set();
  for (const [index, container] of directChildren(root, "g").entries()) {
    if (!isKnownContainer(container) || !unsupportedVisualEffect(container, false)) continue;
    const sourcePath = `root.containers[${index}]`;
    consumed.add(container);
    options.sourceElements.set(sourcePath, container);
    nodes.push(fallbackNode(container, nodes.length, deck, "unsupported-mermaid-container-style", sourcePath));
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
  return definedEntries({
    kind: "text", sourcePath, z, bounds: boundsOf(element, deck),
    text: structuredLabelText(element, options),
    textLayout: { alignment: "center", verticalAlignment: "middle", textWrap: "none" },
    meta,
  });
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
  const matrix = element?.getScreenCTM?.();
  return Boolean(matrix) &&
    matrix.a > 0 &&
    matrix.d > 0 &&
    Math.abs(matrix.b) <= 0.001 &&
    Math.abs(matrix.c) <= 0.001 &&
    Math.abs(matrix.a - matrix.d) <= 0.001;
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
  if (!hasUniformAxisAlignedScale(group) || children.some((child) => !hasUniformAxisAlignedScale(child))) return null;
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
  if (!hasUniformAxisAlignedScale(group) || children.some((child) => !hasUniformAxisAlignedScale(child))) return null;
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
      children.length !== backgrounds.length + titles.length) return null;
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
      [element, marker, circle].some((part) => Number.parseFloat(getComputedStyle(part).opacity) !== 1 ||
        getComputedStyle(part).transform !== "none")) return fallback();
  const center = screenPoint(element, { x: coordinates[0], y: coordinates[1] }, deck);
  const radiusX = circleMetrics[2] * strokeWidth * matrix.a;
  const radiusY = circleMetrics[2] * strokeWidth * matrix.d;
  return {
    kind: "shape", sourcePath, z,
    bounds: {
      x: roundedMetric(center.x - radiusX),
      y: roundedMetric(center.y - radiusY),
      width: roundedMetric(radiusX * 2),
      height: roundedMetric(radiusY * 2),
    },
    preset: "ellipse",
    style: { fill, stroke: null, strokeWidth: 0, opacity: 1 },
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
      for (const child of directChildren(element)) walk(child, context);
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

function classParts(group, outline, paths, options) {
  if (paths.length !== 2 || directChildren(outline).length !== 2 || !isRectanglePath(paths[0]) ||
      !compatiblePathPaint(paths, options) || !matchingOutline(paths[1], paths[0], (point, box) =>
        Math.min(Math.abs(point.x - box.x), Math.abs(point.x - box.x - box.width),
          Math.abs(point.y - box.y), Math.abs(point.y - box.y - box.height)))) return null;
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
  return { labels, dividers };
}

function classScene(svg, root, deck, size, options) {
  const nodes = [];
  const consumed = unsupportedContainers(root, deck, nodes, options);
  for (const [index, path] of [...root.querySelectorAll(":scope > g.edgePaths > path.relation")].entries()) {
    if (consumed.has(path.parentElement)) continue;
    consumed.add(path);
    options.sourceElements?.set(`edges[${index}]`, path);
    nodes.push(connectorPath(path, `edges[${index}]`, nodes.length, deck, options));
  }
  appendEdgeLabels(nodes, readEdgeLabels(root, deck, options, consumed));
  for (const [index, group] of [...root.querySelectorAll(":scope > g.nodes > g.node")].entries()) {
    if (consumed.has(group.parentElement)) continue;
    consumed.add(group);
    const sourcePath = `classes[${index}]`;
    options.sourceElements?.set(sourcePath, group);
    const outline = group.querySelector(":scope > g.label-container");
    const paths = outline ? directChildren(outline, "path") : [];
    const children = directChildren(group);
    const parts = outline && classParts(group, outline, paths, options);
    if (unsupportedVisualEffect(group) || !parts ||
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
          style: computedSvgStyle(divider, options),
        });
      }
    }
  }
  nodes.push(...collectUnexpectedVisuals(root, deck, nodes.length, "root", consumed, options));
  nodes.push(...collectUnexpectedVisuals(svg, deck, nodes.length, "svg", new Set([root]), options));
  return diagramScene(svg, size, options, nodes);
}

function sceneFromSvg(svg, options) {
  options.sourceElements?.set("svg", svg);
  const deck = options.deck || svg.closest(".deck") || svg.parentElement || svg;
  const size = svgSize(svg, deck);
  const root = svg.querySelector("g.root");
  const nodes = [];
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
  const outerElements = [svg];
  for (let element = root; element && element !== svg; element = element.parentElement) outerElements.push(element);
  if (outerElements.some((element) => unsupportedVisualEffect(element, false))) {
    const reason = "unsupported-mermaid-svg-style";
    return { scene: fallbackSceneForReason(createScene({ ...size, source: { kind: "mermaid", path: options.path } }),
      reason, boundsOf(svg, deck)), diagnostics: [{ path: "svg", kind: "fallback", reason }] };
  }
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
