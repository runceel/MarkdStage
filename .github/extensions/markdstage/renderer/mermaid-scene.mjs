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
  const fallbackPreset = nonEmptyStringOr(options.fallbackPreset, "rect");
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
  const number = Number.parseFloat(String(value || ""));
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
  const paragraphs = (lines.length ? lines : [""]).slice(0, MAX_TEXT_PARAGRAPHS).map((line) => {
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
    strokeWidth: style.strokeWidth,
    strokeDasharray: style.strokeDasharray,
    opacity: style.opacity,
    rx: element.getAttribute("rx"),
  }, options);
}

function computedTextStyle(element, options) {
  const style = getComputedStyle(element);
  return {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    color: style.color,
    textAlign: style.textAlign,
    opacity: style.opacity,
    resolveColor: options.resolveColor,
  };
}

function labelInfo(root, selector, deck, options) {
  const label = root.querySelector(selector);
  const text = label?.textContent?.trim() || "";
  if (!text) return null;
  return {
    text: textToSceneText(text, computedTextStyle(label, options), options),
    bounds: boundsOf(label, deck),
  };
}

function fallbackNode(element, z, deck, reason, sourcePath) {
  return {
    kind: "fallback",
    id: element.getAttribute?.("id") || undefined,
    sourcePath,
    z,
    bounds: boundsOf(element, deck),
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
  if (localName(shape) === "polygon") return classifyPolygonPreset(shape.getAttribute("points"), { fallbackPreset: "rect" });
  return null;
}

function nodeShape(group, sourceIndex, z, deck, options) {
  const shape = directChildren(group).find((child) => SHAPE_TAGS.has(localName(child)) && hasClass(child, "label-container"));
  if (!shape) return fallbackNode(group, z, deck, "unsupported-mermaid-node-structure", `nodes[${sourceIndex}]`);
  const preset = shapePresetFor(shape);
  const label = labelInfo(group, "span.nodeLabel", deck, options);
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
  const raw = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const distance = total * (index / (sampleCount - 1));
    raw.push(screenPoint(svg, path.getPointAtLength(distance), deck));
  }
  return {
    raw,
    simplified: simplifyPolyline(raw, options.simplifyTolerance),
  };
}

function connectorPath(path, sourceIndex, z, svg, deck, options, edgeLabels) {
  try {
    const points = sampledPathPoints(path, svg, deck, options);
    const id = path.getAttribute("data-id") || path.getAttribute("id") || "";
    const label = edgeLabels.get(id);
    return definedEntries({
      kind: "connector",
      id: path.getAttribute("id") || undefined,
      sourcePath: `edges[${sourceIndex}]`,
      z,
      points: points.simplified,
      style: computedSvgStyle(path, options),
      arrowStart: markerIdToArrow(path.getAttribute("marker-start")),
      arrowEnd: markerIdToArrow(path.getAttribute("marker-end")),
      label,
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
    const label = labelInfo(group, "span.edgeLabel", deck, options);
    if (id && label && label.bounds.width > 0 && label.bounds.height > 0) labels.set(id, label);
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

function collectUnexpectedVisuals(container, deck, startZ, sourcePath, consumed = new Set()) {
  const fallbacks = [];
  const walk = (element) => {
    if (consumed.has(element)) return;
    if (isKnownLabelSubtree(element)) return;
    if (isVisibleUnknown(element)) {
      fallbacks.push(fallbackNode(element, startZ + fallbacks.length, deck, "unsupported-mermaid-svg-element", `${sourcePath}.unknown[${fallbacks.length}]`));
      return;
    }
    for (const child of directChildren(element)) walk(child);
  };
  for (const child of directChildren(container)) walk(child);
  return fallbacks;
}

function sceneFromSvg(svg, options) {
  const deck = options.deck || svg.closest(".deck") || svg.parentElement || svg;
  const size = svgSize(svg, deck);
  const root = svg.querySelector("g.root");
  const nodes = [];
  const consumed = new Set();
  if (!root || !hasClass(svg, "flowchart")) {
    return {
      scene: fallbackSceneForReason(
        createScene({ width: size.width, height: size.height, source: { kind: "mermaid", path: options.path }, nodes: [] }),
        "unsupported-mermaid-svg-structure",
        { x: 0, y: 0, width: size.width, height: size.height },
      ),
      diagnostics: [{ path: "svg", kind: "fallback", reason: "unsupported-mermaid-svg-structure" }],
    };
  }

  const edgeLabels = readEdgeLabels(root, deck, options);
  for (const [clusterIndex, cluster] of [...root.querySelectorAll(":scope > g.clusters > g.cluster")].entries()) {
    consumed.add(cluster);
    nodes.push(clusterGroup(cluster, clusterIndex, nodes.length, deck, options));
  }
  for (const [edgeIndex, path] of [...root.querySelectorAll(":scope > g.edgePaths > path.flowchart-link")].entries()) {
    consumed.add(path);
    nodes.push(connectorPath(path, edgeIndex, nodes.length, svg, deck, options, edgeLabels));
  }
  for (const [nodeIndex, node] of [...root.querySelectorAll(":scope > g.nodes > g.node")].entries()) {
    consumed.add(node);
    nodes.push(nodeShape(node, nodeIndex, nodes.length, deck, options));
  }
  nodes.push(...collectUnexpectedVisuals(root, deck, nodes.length, "root", consumed));

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

export function mermaidSvgToScene(svg, options = {}) {
  const normalizedOptions = normalizeOptions(options);
  const fallbackBounds = (() => {
    try {
      const deck = normalizedOptions.deck || svg?.closest?.(".deck") || svg?.parentElement || svg;
      const size = svg && deck ? svgSize(svg, deck) : { width: 0, height: 0 };
      return { x: 0, y: 0, width: size.width, height: size.height };
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
    return { scene: normalized.scene, diagnostics };
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
    };
  }
}
