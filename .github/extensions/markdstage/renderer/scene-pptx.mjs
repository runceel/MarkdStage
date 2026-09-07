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

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameMetric(left, right) {
  return Math.abs(left - right) <= 0.1;
}

function samePoints(actual, expected) {
  return Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((point, index) =>
      sameMetric(point.x, expected[index].x) &&
      sameMetric(point.y, expected[index].y));
}

function stadiumMapping(scene, group, index, options) {
  if (
    group.kind !== "group" ||
    group.meta?.mermaid?.shape !== "stadium" ||
    typeof group.sourcePath !== "string"
  ) {
    return null;
  }
  const prefix = `${group.sourcePath}.`;
  const descendants = scene.nodes.filter((node) =>
    node.sourcePath?.startsWith(prefix));
  const part = (partIndex) => descendants.find((node) =>
    node.sourcePath === `${group.sourcePath}.parts[${partIndex}]`);
  const left = part(0);
  const right = part(1);
  const center = part(2);
  const top = part(3);
  const bottom = part(4);
  const label = descendants.find((node) =>
    node.sourcePath === `${group.sourcePath}.label`);
  if (
    !left ||
    !right ||
    !center ||
    !top ||
    !bottom ||
    descendants.length !== (label ? 6 : 5)
  ) {
    return null;
  }
  const unsupported = [group, ...descendants].find((node) =>
    node.kind === "fallback" ||
    node.capability?.pptx === "fallback");
  if (unsupported) {
    return {
      prefix,
      fallback: fallbackFor(
        group,
        index,
        options,
        fallbackReason(unsupported, "stadium-rendered-as-artwork"),
      ),
    };
  }
  if (
    left.kind !== "shape" ||
    left.preset !== "ellipse" ||
    right.kind !== "shape" ||
    right.preset !== "ellipse" ||
    center.kind !== "shape" ||
    center.preset !== "rect" ||
    top.kind !== "connector" ||
    bottom.kind !== "connector" ||
    (label && (label.kind !== "text" || label.rotation !== undefined))
  ) {
    return null;
  }
  const { x, y, width, height } = group.bounds;
  const radius = height / 2;
  const expectedCenterStyle = { ...left.style, stroke: null, strokeWidth: 0 };
  const expectedOutlineStyle = { ...left.style, fill: null };
  const expectedGeometry = (
    sameMetric(left.bounds.x, x) &&
    sameMetric(left.bounds.y, y) &&
    sameMetric(left.bounds.width, height) &&
    sameMetric(left.bounds.height, height) &&
    sameMetric(right.bounds.x, x + width - height) &&
    sameMetric(right.bounds.y, y) &&
    sameMetric(right.bounds.width, height) &&
    sameMetric(right.bounds.height, height) &&
    sameMetric(center.bounds.x, x + radius) &&
    sameMetric(center.bounds.y, y) &&
    sameMetric(center.bounds.width, width - height) &&
    sameMetric(center.bounds.height, height) &&
    samePoints(top.points, [
      { x: x + radius, y },
      { x: x + width - radius, y },
    ]) &&
    samePoints(bottom.points, [
      { x: x + radius, y: y + height },
      { x: x + width - radius, y: y + height },
    ])
  );
  if (
    !expectedGeometry ||
    !sameValue(left.style, right.style) ||
    !sameValue(center.style, expectedCenterStyle) ||
    !sameValue(top.style, expectedOutlineStyle) ||
    !sameValue(bottom.style, expectedOutlineStyle) ||
    top.arrowStart !== "none" ||
    top.arrowEnd !== "none" ||
    bottom.arrowStart !== "none" ||
    bottom.arrowEnd !== "none"
  ) {
    return null;
  }
  return {
    prefix,
    element: shapeElement({
      ...group,
      kind: "shape",
      style: left.style,
      ...(label
        ? {
            text: label.text,
            textLayout: label.textLayout,
          }
        : {}),
    }, index, options, "stadium"),
  };
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
  const collapsedPrefixes = [];
  scene.nodes.forEach((node, index) => {
    if (collapsedPrefixes.some((prefix) =>
      node.sourcePath?.startsWith(prefix))) {
      return;
    }
    const stadium = stadiumMapping(scene, node, index, normalizedOptions);
    if (stadium) {
      if (stadium.fallback) fallbacks.push(stadium.fallback);
      else elements.push(stadium.element);
      collapsedPrefixes.push(stadium.prefix);
      return;
    }
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
