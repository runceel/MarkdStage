import { SceneGraphError, validateScene } from "./scene-graph.mjs";

const DEFAULT_Z_ORDER_BASE = 0;
const DEFAULT_Z_ORDER_STEP = 1 / 1000;
// Scene groups carry no preset, so the producer picks the frame geometry:
// Architecture group frames are rounded, Mermaid subgraph clusters are square.
const DEFAULT_GROUP_PRESET = "roundedRect";
const DEFAULT_TEXT_WRAP = undefined;
const DEFAULT_EMIT_PATH = true;
const DEFAULT_EMIT_Z_ORDER = true;

function finiteNumberOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveNumberOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonEmptyStringOr(value, fallback) {
  return typeof value === "string" && value ? value : fallback;
}

function prefixedPath(prefix, path) {
  if (!prefix) return path;
  return path ? `${prefix}.${path}` : prefix;
}

function nodePath(node, index, prefix) {
  return prefixedPath(prefix, nonEmptyStringOr(node.sourcePath, `nodes[${index}]`));
}

function hasVisiblePaint(value) {
  if (value === undefined || value === null) return false;
  const text = String(value).trim().toLowerCase();
  return text !== "" && text !== "transparent" && text !== "rgba(0, 0, 0, 0)";
}

function hasVisibleStroke(style = {}) {
  if (!hasVisiblePaint(style.stroke)) return false;
  return style.strokeWidth === undefined || style.strokeWidth > 0;
}

function hasVisibleStyle(style = {}) {
  return hasVisiblePaint(style.fill) || hasVisibleStroke(style);
}

function copyDefined(target, source, keys) {
  for (const key of keys) {
    if (source[key] !== undefined) target[key] = source[key];
  }
  return target;
}

function copyTextLayout(target, textLayout = {}, keys) {
  copyDefined(target, textLayout, keys);
  if (target.textWrap === undefined) target.textWrap = DEFAULT_TEXT_WRAP;
  if (target.textWrap === undefined) delete target.textWrap;
  return target;
}

function styleFields(style = {}) {
  const mapped = {};
  copyDefined(mapped, style, [
    "fill",
    "stroke",
    "lineCap",
    "opacity",
    "fillOpacity",
    "strokeOpacity",
    "cornerRadius",
  ]);
  if (style.strokeWidth !== undefined && style.strokeWidth > 0) {
    mapped.strokeWidth = style.strokeWidth;
  } else if (style.strokeWidth === 0) {
    mapped.stroke = null;
  }
  if (style.dash !== undefined && style.dash !== "" && style.dash !== "solid") {
    mapped.dash = style.dash;
  }
  return mapped;
}

function geometryFields(node) {
  return {
    x: node.bounds.x,
    y: node.bounds.y,
    width: node.bounds.width,
    height: node.bounds.height,
  };
}

function connectorBounds(node) {
  if (node.bounds) return node.bounds;
  const xs = node.points.map((point) => point.x);
  const ys = node.points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

function cloneText(text) {
  if (typeof text === "string") return text;
  return {
    paragraphs: text.paragraphs.map((paragraph) => ({
      ...paragraph,
      runs: paragraph.runs.map((run) => {
        const next = { ...run };
        if (next.fontSize !== undefined && next.fontSize <= 0) delete next.fontSize;
        return next;
      }),
    })),
  };
}

function zOrderFor(node, options) {
  return options.zOrderBase + node.z * options.zOrderStep;
}

function elementBase(node, index, options) {
  return {
    ...(node.meta || {}),
    ...(options.emitPath ? { path: nodePath(node, index, options.pathPrefix) } : {}),
    ...(options.emitZOrder ? { zOrder: zOrderFor(node, options) } : {}),
  };
}

function fallbackReason(node, fallback) {
  return nonEmptyStringOr(
    node.reason,
    nonEmptyStringOr(node.capability?.reason, fallback),
  );
}

function fallbackFor(node, index, options, reason) {
  const bounds = node.bounds || { x: 0, y: 0, width: 0, height: 0 };
  const fallback = {
    type: options.fallbackType,
    path: nodePath(node, index, options.pathPrefix),
    sourcePath: nonEmptyStringOr(node.sourcePath, `nodes[${index}]`),
    reason,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    zOrder: zOrderFor(node, options),
  };
  if (bounds.width === 0 || bounds.height === 0) fallback.artwork = false;
  return fallback;
}

function shapeElement(node, index, options, shape) {
  const element = {
    ...elementBase(node, index, options),
    type: "shape",
    shape,
    ...geometryFields(node),
    ...styleFields(node.style),
  };
  if (node.text !== undefined) element.text = cloneText(node.text);
  copyTextLayout(element, node.textLayout, ["verticalAlignment", "textWrap", "textInsets"]);
  return element;
}

function groupElement(node, index, options) {
  if (!hasVisibleStyle(node.style) && node.text === undefined) return null;
  return shapeElement(node, index, options, options.groupPreset);
}

function textElement(node, index, options) {
  const text = cloneText(node.text);
  const element = {
    ...elementBase(node, index, options),
    type: "text",
    ...geometryFields(node),
    paragraphs: text.paragraphs,
  };
  copyDefined(element, node.textLayout || {}, ["textInsets", "textWrap"]);
  if (node.rotation !== undefined) {
    element.rotation = node.rotation;
    copyDefined(element, node.textLayout || {}, ["verticalAlignment"]);
  }
  return element;
}

function imageElement(node, index, options) {
  const element = {
    ...elementBase(node, index, options),
    type: "image",
    ...geometryFields(node),
    src: node.src,
    alt: node.alt,
    fit: node.fit,
    shape: "rect",
  };
  copyDefined(element, node, ["opacity"]);
  return element;
}

function connectorElement(node, index, options) {
  if (node.style?.stroke === null || node.style?.strokeWidth === 0) {
    return fallbackFor(node, index, options, "connector-stroke-not-representable");
  }
  const element = {
    ...elementBase(node, index, options),
    type: "connector",
    points: node.points.map((point) => ({ ...point })),
    ...connectorBounds(node),
    arrowStart: node.arrowStart,
    arrowEnd: node.arrowEnd,
    ...styleFields(node.style),
  };
  if (node.label !== undefined) {
    element.label = cloneText(node.label.text);
    element.labelBounds = { ...node.label.bounds };
  }
  return element;
}

function normalizeOptions(scene, options = {}) {
  const sourceKind = scene?.source?.kind;
  return {
    pathPrefix: typeof options.pathPrefix === "string" ? options.pathPrefix : "",
    zOrderBase: finiteNumberOr(options.zOrderBase, DEFAULT_Z_ORDER_BASE),
    zOrderStep: positiveNumberOr(options.zOrderStep, DEFAULT_Z_ORDER_STEP),
    fallbackType: nonEmptyStringOr(options.fallbackType, nonEmptyStringOr(sourceKind, "scene")),
    groupPreset: nonEmptyStringOr(options.groupPreset, DEFAULT_GROUP_PRESET),
    emitPath: options.emitPath === undefined ? DEFAULT_EMIT_PATH : options.emitPath !== false,
    emitZOrder: options.emitZOrder === undefined ? DEFAULT_EMIT_Z_ORDER : options.emitZOrder !== false,
  };
}

function mappedNode(node, index, options) {
  if (node.capability?.pptx === "fallback") {
    return fallbackFor(node, index, options, fallbackReason(node, "node-rendered-as-artwork"));
  }
  if (node.kind === "fallback") {
    return fallbackFor(node, index, options, fallbackReason(node, "node-rendered-as-artwork"));
  }
  if (node.kind === "group") return groupElement(node, index, options);
  if (node.kind === "shape") return shapeElement(node, index, options, node.preset);
  if (node.kind === "text") return textElement(node, index, options);
  if (node.kind === "image") return imageElement(node, index, options);
  if (node.kind === "connector") return connectorElement(node, index, options);
  return fallbackFor(node, index, options, `unsupported-node-kind: ${String(node.kind)}`);
}

export function sceneToPptxElements(scene, options = {}) {
  try {
    validateScene(scene);
  } catch (error) {
    if (error instanceof SceneGraphError) throw error;
    throw new SceneGraphError(error?.message || "scene is malformed");
  }

  const normalizedOptions = normalizeOptions(scene, options);
  const elements = [];
  const fallbacks = [];
  scene.nodes.forEach((node, index) => {
    const mapped = mappedNode(node, index, normalizedOptions);
    if (!mapped) return;
    if (mapped.reason !== undefined && !["shape", "text", "image", "connector"].includes(mapped.type)) {
      fallbacks.push(mapped);
    } else {
      elements.push(mapped);
    }
  });
  const byZOrder = (left, right) => (left.zOrder ?? 0) - (right.zOrder ?? 0);
  elements.sort(byZOrder);
  fallbacks.sort(byZOrder);
  return { elements, fallbacks };
}
