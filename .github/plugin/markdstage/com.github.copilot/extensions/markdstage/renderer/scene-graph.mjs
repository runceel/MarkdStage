import { ImageSourceError, inspectImageSource } from "./image-source.mjs";

export class SceneGraphError extends Error {
  constructor(message) {
    super(message);
    this.name = "SceneGraphError";
  }
}

// These ceilings keep accidental full-DOM captures bounded while staying well above authored diagrams.
export const MAX_SCENE_NODES = 4000;
export const MAX_GROUP_DEPTH = 16;
export const MAX_CONNECTOR_POINTS = 64;
export const MAX_TEXT_PARAGRAPHS = 200;
export const MAX_TEXT_RUNS = 1000;
export const MAX_STRING_LENGTH = 8192;

const SCENE_VERSION = 1;
const METRIC_PRECISION = 10;
const DRAWINGML_ANGLE_UNITS_PER_DEGREE = 60000;
const DRAWINGML_HALF_TURN = 180 * DRAWINGML_ANGLE_UNITS_PER_DEGREE;
const DRAWINGML_FULL_TURN = 360 * DRAWINGML_ANGLE_UNITS_PER_DEGREE;
const NODE_KINDS = new Set(["group", "shape", "text", "image", "connector", "fallback"]);
const SOURCE_KINDS = new Set(["architecture", "mermaid"]);
const SHAPE_PRESETS = new Set([
  "rect",
  "roundedRect",
  "topRoundedRect",
  "ellipse",
  "diamond",
  "triangle",
  "hexagon",
  "quarterHeightHexagon",
  "parallelogram",
  "reverseParallelogram",
  "trapezoid",
  "invertedTrapezoid",
  "sequenceTab",
]);
const DASH_STYLES = new Set(["", "solid", "dash", "dashDot", "dot"]);
const LINE_CAPS = new Set(["butt", "round", "square"]);
const IMAGE_FITS = new Set(["contain", "cover", "fill", "none"]);
const ARROWS = new Set([null, "none", "triangle", "arrow", "stealth", "diamond", "oval"]);
const ALIGNMENTS = new Set(["left", "center", "right", "justify"]);
const VERTICAL_ALIGNMENTS = new Set(["top", "middle", "bottom"]);
const TEXT_WRAPS = new Set(["none", "square"]);
const COMMON_NODE_KEYS = new Set([
  "kind",
  "id",
  "sourcePath",
  "z",
  "bounds",
  "capability",
  "accessibility",
  "meta",
]);
const NODE_KEYS = {
  group: new Set(["children", "style", "text", "textLayout"]),
  shape: new Set(["preset", "style", "text", "textLayout", "rotation"]),
  text: new Set(["text", "textLayout", "rotation"]),
  image: new Set(["src", "alt", "fit", "opacity"]),
  connector: new Set(["points", "style", "arrowStart", "arrowEnd", "label"]),
  fallback: new Set(["reason"]),
};

function fail(message) {
  throw new SceneGraphError(message);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function roundedMetric(value) {
  return Math.round(Math.max(0, Number(value) || 0) * METRIC_PRECISION) / METRIC_PRECISION;
}

function roundedCoordinate(value) {
  return Math.round((Number(value) || 0) * METRIC_PRECISION) / METRIC_PRECISION;
}

function roundedExtent(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? roundedMetric(number) : value;
}

export function normalizeRotationAngle(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  let units = Math.round((((value % 360) + 360) % 360) * DRAWINGML_ANGLE_UNITS_PER_DEGREE);
  if (units >= DRAWINGML_HALF_TURN) units -= DRAWINGML_FULL_TURN;
  return units === 0 ? 0 : units / DRAWINGML_ANGLE_UNITS_PER_DEGREE;
}

function finiteNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${path} must be a finite number`);
  }
  return value;
}

function nonNegativeNumber(value, path) {
  const number = finiteNumber(value, path);
  if (number < 0) fail(`${path} must be a finite non-negative number`);
  return number;
}

function optionalString(value, path) {
  if (value !== undefined && typeof value !== "string") {
    fail(`${path} must be a string`);
  }
  if (typeof value === "string" && value.length > MAX_STRING_LENGTH) {
    fail(`${path} exceeds ${MAX_STRING_LENGTH} characters`);
  }
}

function requiredString(value, path) {
  optionalString(value, path);
  if (typeof value !== "string" || value.length === 0) {
    fail(`${path} must be a non-empty string`);
  }
}

function stringValue(value, path) {
  optionalString(value, path);
  if (typeof value !== "string") fail(`${path} must be a string`);
}

function exactKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${path}.${key} is not supported`);
  }
}

function rejectInheritedKeys(value, allowed, path) {
  for (const key of allowed) {
    if (!Object.hasOwn(value, key) && key in value) {
      fail(`${path}.${key} must be an own property`);
    }
  }
}

function requiredObject(value, path) {
  if (!isPlainObject(value)) fail(`${path} must be an object`);
  return value;
}

function isPlainSerializableObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateMetaValue(value, path, seen) {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) fail(`${path} must be JSON-serializable`);
    return;
  }
  if (typeof value === "string") {
    optionalString(value, path);
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) fail(`${path} must be JSON-serializable`);
    seen.add(value);
    value.forEach((entry, index) => validateMetaValue(entry, `${path}[${index}]`, seen));
    seen.delete(value);
    return;
  }
  if (isPlainSerializableObject(value)) {
    if (seen.has(value)) fail(`${path} must be JSON-serializable`);
    seen.add(value);
    Object.entries(value).forEach(([key, entry]) => {
      optionalString(key, `${path} key`);
      validateMetaValue(entry, `${path}.${key}`, seen);
    });
    seen.delete(value);
    return;
  }
  fail(`${path} must be a JSON-serializable plain object`);
}

function validateMeta(value, path) {
  if (value === undefined) return;
  if (!isPlainSerializableObject(value)) fail(`${path} must be a plain object`);
  validateMetaValue(value, path, new Set());
}

function boundsOf(value, path) {
  requiredObject(value, path);
  exactKeys(value, new Set(["x", "y", "width", "height"]), path);
  finiteNumber(value.x, `${path}.x`);
  finiteNumber(value.y, `${path}.y`);
  nonNegativeNumber(value.width, `${path}.width`);
  nonNegativeNumber(value.height, `${path}.height`);
}

function normalizeBounds(value, offsetX, offsetY) {
  if (!isPlainObject(value)) return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return null;
  }
  return {
    x: roundedCoordinate(offsetX + x),
    y: roundedCoordinate(offsetY + y),
    width: roundedMetric(width),
    height: roundedMetric(height),
  };
}

function normalizePoint(value, offsetX, offsetY) {
  if (!isPlainObject(value)) return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: roundedCoordinate(offsetX + x),
    y: roundedCoordinate(offsetY + y),
  };
}

function boundsFromPoints(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    x: roundedCoordinate(left),
    y: roundedCoordinate(top),
    width: roundedMetric(Math.max(...xs) - left),
    height: roundedMetric(Math.max(...ys) - top),
  };
}

function validateColor(value, path) {
  if (value === null) return;
  if (typeof value !== "string") fail(`${path} must be a color string or null`);
  const text = value.trim();
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text)) return;
  const rgb = /^rgba?\((.*)\)$/i.exec(text);
  if (!rgb) fail(`${path} must be #RGB, #RRGGBB, #RRGGBBAA, rgb(), or rgba()`);
  const inner = rgb[1].trim();
  let channels;
  let alpha;
  if (inner.includes(",")) {
    const parts = inner.split(",").map((part) => part.trim());
    if (parts.length !== 3 && parts.length !== 4) fail(`${path} is not a valid rgb() or rgba() color`);
    channels = parts.slice(0, 3);
    alpha = parts[3];
  } else {
    const parts = inner.split("/").map((part) => part.trim());
    if (parts.length > 2) fail(`${path} is not a valid rgb() or rgba() color`);
    channels = parts[0].split(/\s+/).filter(Boolean);
    alpha = parts[1];
  }
  if (channels.length !== 3) fail(`${path} is not a valid rgb() or rgba() color`);
  for (const [index, channel] of channels.entries()) {
    const percent = /^(\d+(?:\.\d+)?)%$/.exec(channel);
    const number = percent ? Number(percent[1]) : Number(channel);
    const maximum = percent ? 100 : 255;
    if (!Number.isFinite(number) || number < 0 || number > maximum) {
      fail(`${path}.channel[${index}] must be between 0 and ${maximum}`);
    }
  }
  if (alpha === undefined) return;
  const percent = /^(\d+(?:\.\d+)?)%$/.exec(alpha);
  const number = percent ? Number(percent[1]) : Number(alpha);
  const maximum = percent ? 100 : 1;
  if (!Number.isFinite(number) || number < 0 || number > maximum) {
    fail(`${path}.alpha must be between 0 and ${maximum}`);
  }
}

function validateAccessibility(value, path) {
  if (value === undefined) return;
  requiredObject(value, path);
  exactKeys(value, new Set(["title", "description"]), path);
  optionalString(value.title, `${path}.title`);
  optionalString(value.description, `${path}.description`);
}

function validateCapability(value, path) {
  if (value === undefined) return;
  requiredObject(value, path);
  exactKeys(value, new Set(["pptx", "reason"]), path);
  if (value.pptx !== "native" && value.pptx !== "fallback") {
    fail(`${path}.pptx must be "native" or "fallback"`);
  }
  optionalString(value.reason, `${path}.reason`);
  if (value.reason !== undefined && value.reason.length === 0) {
    fail(`${path}.reason must be a non-empty string`);
  }
}

function validateStyle(value, path) {
  if (value === undefined) return;
  requiredObject(value, path);
  const keys = new Set([
    "fill",
    "stroke",
    "strokeWidth",
    "dash",
    "lineCap",
    "opacity",
    "fillOpacity",
    "strokeOpacity",
    "cornerRadius",
  ]);
  exactKeys(value, keys, path);
  rejectInheritedKeys(value, keys, path);
  if (value.fill !== undefined) validateColor(value.fill, `${path}.fill`);
  if (value.stroke !== undefined) validateColor(value.stroke, `${path}.stroke`);
  if (value.strokeWidth !== undefined) nonNegativeNumber(value.strokeWidth, `${path}.strokeWidth`);
  if (value.cornerRadius !== undefined) nonNegativeNumber(value.cornerRadius, `${path}.cornerRadius`);
  for (const key of ["opacity", "fillOpacity", "strokeOpacity"]) {
    if (value[key] === undefined) continue;
    const opacity = finiteNumber(value[key], `${path}.${key}`);
    if (opacity < 0 || opacity > 1) fail(`${path}.${key} must be between 0 and 1`);
  }
  if (value.dash !== undefined && !DASH_STYLES.has(value.dash)) {
    fail(`${path}.dash must be "", "solid", "dash", "dashDot", or "dot"`);
  }
  if (value.lineCap !== undefined && !LINE_CAPS.has(value.lineCap)) {
    fail(`${path}.lineCap must be "butt", "round", or "square"`);
  }
}

function validateText(value, path) {
  requiredObject(value, path);
  exactKeys(value, new Set(["paragraphs"]), path);
  if (!Array.isArray(value.paragraphs) || value.paragraphs.length === 0) {
    fail(`${path}.paragraphs must be a non-empty array`);
  }
  if (value.paragraphs.length > MAX_TEXT_PARAGRAPHS) {
    fail(`${path}.paragraphs exceeds ${MAX_TEXT_PARAGRAPHS} entries`);
  }
  let runCount = 0;
  value.paragraphs.forEach((paragraph, paragraphIndex) => {
    const paragraphPath = `${path}.paragraphs[${paragraphIndex}]`;
    requiredObject(paragraph, paragraphPath);
    exactKeys(paragraph, new Set(["alignment", "runs"]), paragraphPath);
    if (paragraph.alignment !== undefined && !ALIGNMENTS.has(paragraph.alignment)) {
      fail(`${paragraphPath}.alignment is invalid`);
    }
    if (!Array.isArray(paragraph.runs) || paragraph.runs.length === 0) {
      fail(`${paragraphPath}.runs must be a non-empty array`);
    }
    runCount += paragraph.runs.length;
    if (runCount > MAX_TEXT_RUNS) fail(`${path}.runs exceeds ${MAX_TEXT_RUNS} entries`);
    paragraph.runs.forEach((run, runIndex) => {
      const runPath = `${paragraphPath}.runs[${runIndex}]`;
      requiredObject(run, runPath);
      exactKeys(
        run,
        new Set(["text", "fontSize", "fontFace", "fontWeight", "bold", "italic", "color", "opacity"]),
        runPath,
      );
      stringValue(run.text, `${runPath}.text`);
      if (run.fontSize !== undefined) nonNegativeNumber(run.fontSize, `${runPath}.fontSize`);
      optionalString(run.fontFace, `${runPath}.fontFace`);
      if (run.fontFace !== undefined && run.fontFace.length === 0) {
        fail(`${runPath}.fontFace must be a non-empty string`);
      }
      if (run.fontWeight !== undefined) nonNegativeNumber(run.fontWeight, `${runPath}.fontWeight`);
      if (run.bold !== undefined && typeof run.bold !== "boolean") fail(`${runPath}.bold must be a boolean`);
      if (run.italic !== undefined && typeof run.italic !== "boolean") fail(`${runPath}.italic must be a boolean`);
      if (run.color !== undefined) validateColor(run.color, `${runPath}.color`);
      if (run.opacity !== undefined) {
        const opacity = finiteNumber(run.opacity, `${runPath}.opacity`);
        if (opacity < 0 || opacity > 1) fail(`${runPath}.opacity must be between 0 and 1`);
      }
    });
  });
}

function validateTextLayout(value, path) {
  if (value === undefined) return;
  requiredObject(value, path);
  exactKeys(value, new Set(["alignment", "verticalAlignment", "textWrap", "textInsets", "lineHeight"]), path);
  if (value.lineHeight !== undefined) {
    const lineHeight = finiteNumber(value.lineHeight, `${path}.lineHeight`);
    if (lineHeight < 0.5 || lineHeight > 4) fail(`${path}.lineHeight must be between 0.5 and 4`);
  }
  if (value.alignment !== undefined && !ALIGNMENTS.has(value.alignment)) fail(`${path}.alignment is invalid`);
  if (value.verticalAlignment !== undefined && !VERTICAL_ALIGNMENTS.has(value.verticalAlignment)) {
    fail(`${path}.verticalAlignment must be "top", "middle", or "bottom"`);
  }
  if (value.textWrap !== undefined && !TEXT_WRAPS.has(value.textWrap)) {
    fail(`${path}.textWrap must be "none" or "square"`);
  }
  if (value.textInsets !== undefined) {
    requiredObject(value.textInsets, `${path}.textInsets`);
    exactKeys(value.textInsets, new Set(["left", "top", "right", "bottom"]), `${path}.textInsets`);
    for (const side of ["left", "top", "right", "bottom"]) {
      if (value.textInsets[side] !== undefined) {
        nonNegativeNumber(value.textInsets[side], `${path}.textInsets.${side}`);
      }
    }
  }
}

function validatePoint(value, path) {
  requiredObject(value, path);
  exactKeys(value, new Set(["x", "y"]), path);
  finiteNumber(value.x, `${path}.x`);
  finiteNumber(value.y, `${path}.y`);
}

function validateLabel(value, path) {
  if (value === undefined) return;
  requiredObject(value, path);
  exactKeys(value, new Set(["text", "bounds"]), path);
  validateText(value.text, `${path}.text`);
  boundsOf(value.bounds, `${path}.bounds`);
}

function validateNode(node, path, state, depth) {
  requiredObject(node, path);
  state.count += 1;
  if (state.count > MAX_SCENE_NODES) fail(`scene.nodes exceeds ${MAX_SCENE_NODES} entries`);
  if (depth > MAX_GROUP_DEPTH) fail(`${path} exceeds maximum group depth ${MAX_GROUP_DEPTH}`);
  if (!NODE_KINDS.has(node.kind)) fail(`${path}.kind is not supported`);
  exactKeys(node, new Set([...COMMON_NODE_KEYS, ...NODE_KEYS[node.kind]]), path);
  optionalString(node.id, `${path}.id`);
  optionalString(node.sourcePath, `${path}.sourcePath`);
  finiteNumber(node.z, `${path}.z`);
  if (node.kind !== "connector") boundsOf(node.bounds, `${path}.bounds`);
  else if (node.bounds !== undefined) boundsOf(node.bounds, `${path}.bounds`);
  validateCapability(node.capability, `${path}.capability`);
  validateAccessibility(node.accessibility, `${path}.accessibility`);
  validateMeta(node.meta, `${path}.meta`);
  if (node.kind === "shape" || node.kind === "text") {
    rejectInheritedKeys(node, new Set(["rotation"]), path);
    if (node.rotation !== undefined) {
      const rotation = finiteNumber(node.rotation, `${path}.rotation`);
      const normalized = normalizeRotationAngle(rotation);
      if (normalized !== rotation || Object.is(rotation, -0)) {
        fail(`${path}.rotation must be normalized to [-180, 180) degrees`);
      }
    }
  }
  if (node.kind === "group") {
    if (!Array.isArray(node.children)) fail(`${path}.children must be an array`);
    validateStyle(node.style, `${path}.style`);
    if (node.text !== undefined) validateText(node.text, `${path}.text`);
    validateTextLayout(node.textLayout, `${path}.textLayout`);
    node.children.forEach((child, index) => validateNode(child, `${path}.children[${index}]`, state, depth + 1));
  } else if (node.kind === "shape") {
    if (!SHAPE_PRESETS.has(node.preset)) fail(`${path}.preset is not supported`);
    validateStyle(node.style, `${path}.style`);
    if (node.text !== undefined) validateText(node.text, `${path}.text`);
    validateTextLayout(node.textLayout, `${path}.textLayout`);
  } else if (node.kind === "text") {
    validateText(node.text, `${path}.text`);
    validateTextLayout(node.textLayout, `${path}.textLayout`);
  } else if (node.kind === "image") {
    try {
      inspectImageSource(node.src,
        `${path}.src${node.sourcePath ? ` (${node.sourcePath.slice(0, 256)})` : ""}`);
    } catch (error) {
      if (!(error instanceof ImageSourceError)) throw error;
      fail(error.message);
    }
    stringValue(node.alt, `${path}.alt`);
    if (!IMAGE_FITS.has(node.fit)) fail(`${path}.fit is not supported`);
    if (node.opacity !== undefined) {
      const opacity = finiteNumber(node.opacity, `${path}.opacity`);
      if (opacity < 0 || opacity > 1) fail(`${path}.opacity must be between 0 and 1`);
    }
  } else if (node.kind === "connector") {
    if (!Array.isArray(node.points) || node.points.length < 2) {
      fail(`${path}.points must contain at least two points`);
    }
    if (node.points.length > MAX_CONNECTOR_POINTS) {
      fail(`${path}.points exceeds ${MAX_CONNECTOR_POINTS} entries`);
    }
    node.points.forEach((point, index) => validatePoint(point, `${path}.points[${index}]`));
    for (let index = 1; index < node.points.length; index += 1) {
      const previous = node.points[index - 1];
      const current = node.points[index];
      if (previous.x === current.x && previous.y === current.y) {
        fail(`${path}.points[${index - 1}] and ${path}.points[${index}] must differ`);
      }
    }
    validateStyle(node.style, `${path}.style`);
    if (!ARROWS.has(node.arrowStart)) fail(`${path}.arrowStart is not supported`);
    if (!ARROWS.has(node.arrowEnd)) fail(`${path}.arrowEnd is not supported`);
    validateLabel(node.label, `${path}.label`);
  } else if (node.kind === "fallback") {
    requiredString(node.reason, `${path}.reason`);
  }
}

function textFromString(value) {
  return {
    paragraphs: [
      {
        runs: [{ text: value }],
      },
    ],
  };
}

function clampOpacity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return Math.max(0, Math.min(1, number));
}

function normalizeStyle(value) {
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (key === "strokeWidth" || key === "cornerRadius") return [key, roundedMetric(entry)];
      if (key === "opacity" || key === "fillOpacity" || key === "strokeOpacity") {
        return [key, clampOpacity(entry)];
      }
      return [key, entry];
    }),
  );
}

function normalizeText(value) {
  if (typeof value === "string") return textFromString(value);
  if (!isPlainObject(value) || !Array.isArray(value.paragraphs)) return value;
  return {
    paragraphs: value.paragraphs.map((paragraph) => {
      if (!isPlainObject(paragraph) || !Array.isArray(paragraph.runs)) return paragraph;
      return {
        ...paragraph,
        runs: paragraph.runs.map((run) =>
          isPlainObject(run) && Number.isFinite(Number(run.opacity))
            ? { ...run, opacity: clampOpacity(run.opacity) }
            : run,
        ),
      };
    }),
  };
}

function normalizeTextLayout(value) {
  if (!isPlainObject(value)) return value;
  const normalized = { ...value };
  if (isPlainObject(value.textInsets)) {
    normalized.textInsets = Object.fromEntries(
      Object.entries(value.textInsets).map(([key, entry]) => [key, roundedMetric(entry)]),
    );
  }
  return normalized;
}

function normalizeCapability(value, fallbackReason) {
  if (fallbackReason) return { pptx: "fallback", reason: fallbackReason };
  if (!isPlainObject(value)) return { pptx: "native" };
  return {
    pptx: value.pptx === "fallback" ? "fallback" : "native",
    ...(typeof value.reason === "string" && value.reason ? { reason: value.reason } : {}),
  };
}

function fallbackNode(node, path, reason, bounds) {
  return {
    kind: "fallback",
    ...(typeof node?.id === "string" ? { id: node.id } : {}),
    ...(typeof node?.sourcePath === "string" ? { sourcePath: node.sourcePath } : {}),
    z: Number.isFinite(Number(node?.z)) ? Number(node.z) : 0,
    bounds: bounds || { x: 0, y: 0, width: 0, height: 0 },
    capability: { pptx: "fallback", reason },
    reason,
    ...(isPlainObject(node?.accessibility) ? { accessibility: node.accessibility } : {}),
    ...(node?.meta !== undefined ? { meta: node.meta } : {}),
    __order: 0,
    __path: path,
  };
}

function unsupported(path, kind, reason, diagnostics) {
  diagnostics.push({ path, kind, reason });
}

function normalizeKnownNode(node, path, bounds, offsetX, offsetY, diagnostics, depth) {
  const base = {
    kind: node.kind,
    ...(typeof node.id === "string" ? { id: node.id } : {}),
    ...(typeof node.sourcePath === "string" ? { sourcePath: node.sourcePath } : {}),
    z: Number.isFinite(Number(node.z)) ? Number(node.z) : 0,
    ...(node.kind !== "connector" ? { bounds } : {}),
    capability: normalizeCapability(node.capability),
    ...(isPlainObject(node.accessibility) ? { accessibility: node.accessibility } : {}),
    ...(node.meta !== undefined ? { meta: node.meta } : {}),
  };
  if (node.kind === "group") {
    return {
      ...base,
      children: [],
      ...(node.style !== undefined ? { style: normalizeStyle(node.style) } : {}),
      ...(node.text !== undefined ? { text: normalizeText(node.text) } : {}),
      ...(node.textLayout !== undefined ? { textLayout: normalizeTextLayout(node.textLayout) } : {}),
    };
  }
  if (node.kind === "shape") {
    const rotation = node.rotation === undefined ? 0 : normalizeRotationAngle(node.rotation);
    if (!SHAPE_PRESETS.has(node.preset)) {
      const reason = `unsupported shape preset: ${String(node.preset)}`;
      unsupported(path, "fallback", reason, diagnostics);
      return fallbackNode(node, path, reason, bounds);
    }
    return {
      ...base,
      preset: node.preset,
      ...(rotation ? { rotation } : {}),
      ...(node.style !== undefined ? { style: normalizeStyle(node.style) } : {}),
      ...(node.text !== undefined ? { text: normalizeText(node.text) } : {}),
      ...(node.textLayout !== undefined ? { textLayout: normalizeTextLayout(node.textLayout) } : {}),
    };
  }
  if (node.kind === "text") {
    const rotation = node.rotation === undefined ? 0 : normalizeRotationAngle(node.rotation);
    return {
      ...base,
      text: normalizeText(node.text),
      ...(node.textLayout !== undefined ? { textLayout: normalizeTextLayout(node.textLayout) } : {}),
      ...(rotation ? { rotation } : {}),
    };
  }
  if (node.kind === "image") {
    if (!IMAGE_FITS.has(node.fit)) {
      const reason = `unsupported image fit: ${String(node.fit)}`;
      unsupported(path, "fallback", reason, diagnostics);
      return fallbackNode(node, path, reason, bounds);
    }
    return {
      ...base,
      src: node.src,
      alt: node.alt,
      fit: node.fit,
      ...(node.opacity !== undefined ? { opacity: clampOpacity(node.opacity) } : {}),
    };
  }
  if (node.kind === "connector") {
    if (!Array.isArray(node.points) || node.points.length < 2 || node.points.length > MAX_CONNECTOR_POINTS) {
      const reason = "connector points are not representable";
      unsupported(path, "fallback", reason, diagnostics);
      return fallbackNode(node, path, reason, bounds);
    }
    const points = node.points.map((point) => normalizePoint(point, offsetX, offsetY));
    if (points.some((point) => !point)) {
      const reason = "connector points are not finite";
      unsupported(path, "fallback", reason, diagnostics);
      return fallbackNode(node, path, reason, bounds);
    }
    const connectorBounds = boundsFromPoints(points);
    return {
      ...base,
      bounds: connectorBounds,
      points,
      ...(node.style !== undefined ? { style: normalizeStyle(node.style) } : {}),
      arrowStart: ARROWS.has(node.arrowStart) ? node.arrowStart : "none",
      arrowEnd: ARROWS.has(node.arrowEnd) ? node.arrowEnd : "none",
      ...(node.label !== undefined && isPlainObject(node.label)
        ? {
            label: {
              text: normalizeText(node.label.text),
              bounds: normalizeBounds(node.label.bounds, offsetX, offsetY) || connectorBounds,
            },
          }
        : {}),
    };
  }
  return {
    ...base,
    capability: normalizeCapability(node.capability, node.reason),
    reason: node.reason,
  };
}

function normalizeNode(node, path, offsetX, offsetY, depth, output, diagnostics) {
  if (!isPlainObject(node)) {
    const reason = "node is not an object";
    unsupported(path, "fallback", reason, diagnostics);
    const normalized = fallbackNode(node, path, reason);
    normalized.__sortZ = output.length;
    output.push(normalized);
    return;
  }
  if (depth > MAX_GROUP_DEPTH) {
    const bounds = normalizeBounds(node.bounds, offsetX, offsetY);
    const reason = `group depth exceeds ${MAX_GROUP_DEPTH}`;
    unsupported(path, "fallback", reason, diagnostics);
    const normalized = fallbackNode(node, path, reason, bounds);
    normalized.__sortZ = Number.isFinite(Number(node.z)) ? Number(node.z) : output.length;
    output.push(normalized);
    return;
  }
  if (!NODE_KINDS.has(node.kind)) {
    const bounds = normalizeBounds(node.bounds, offsetX, offsetY);
    const reason = `unsupported node kind: ${String(node.kind)}`;
    unsupported(path, "fallback", reason, diagnostics);
    const normalized = fallbackNode(node, path, reason, bounds);
    normalized.__sortZ = Number.isFinite(Number(node.z)) ? Number(node.z) : output.length;
    output.push(normalized);
    return;
  }
  const bounds = normalizeBounds(node.bounds, offsetX, offsetY);
  if (node.kind !== "connector" && !bounds) {
    const reason = "node bounds are not finite";
    unsupported(path, "fallback", reason, diagnostics);
    const normalized = fallbackNode(node, path, reason);
    normalized.__sortZ = Number.isFinite(Number(node.z)) ? Number(node.z) : output.length;
    output.push(normalized);
    return;
  }
  if (["text", "shape"].includes(node.kind) && "rotation" in node &&
      (!Object.hasOwn(node, "rotation") || normalizeRotationAngle(node.rotation) === null)) {
    const reason = `${node.kind} rotation is not a finite number`;
    unsupported(path, "fallback", reason, diagnostics);
    const normalized = fallbackNode(node, path, reason, bounds);
    normalized.__sortZ = Number.isFinite(Number(node.z)) ? Number(node.z) : output.length;
    output.push(normalized);
    return;
  }
  const normalized = normalizeKnownNode(node, path, bounds, offsetX, offsetY, diagnostics, depth);
  normalized.__sortZ = Number.isFinite(Number(node.z)) ? Number(node.z) : output.length;
  output.push(normalized);
  if (node.kind !== "group") return;
  if (!Array.isArray(node.children)) {
    const reason = "group children are not an array";
    unsupported(`${path}.children`, "fallback", reason, diagnostics);
    return;
  }
  node.children.forEach((child, index) => {
    normalizeNode(
      child,
      `${path}.children[${index}]`,
      bounds.x,
      bounds.y,
      depth + 1,
      output,
      diagnostics,
    );
  });
}

function stripInternal(node) {
  const { __order, __path, __sortZ, ...stripped } = node;
  return stripped;
}

export function createScene({ width, height, source, nodes, accessibility, meta } = {}) {
  return {
    version: SCENE_VERSION,
    source,
    width,
    height,
    ...(accessibility !== undefined ? { accessibility } : {}),
    ...(meta !== undefined ? { meta } : {}),
    nodes: Array.isArray(nodes) ? nodes : [],
  };
}

export function validateScene(scene) {
  requiredObject(scene, "scene");
  exactKeys(scene, new Set(["version", "source", "width", "height", "accessibility", "meta", "nodes"]), "scene");
  if (scene.version !== SCENE_VERSION) fail("scene.version must be 1");
  nonNegativeNumber(scene.width, "scene.width");
  nonNegativeNumber(scene.height, "scene.height");
  requiredObject(scene.source, "scene.source");
  exactKeys(scene.source, new Set(["kind", "path"]), "scene.source");
  if (!SOURCE_KINDS.has(scene.source.kind)) fail("scene.source.kind is not supported");
  requiredString(scene.source.path, "scene.source.path");
  validateAccessibility(scene.accessibility, "scene.accessibility");
  validateMeta(scene.meta, "scene.meta");
  if (!Array.isArray(scene.nodes)) fail("scene.nodes must be an array");
  const state = { count: 0 };
  scene.nodes.forEach((node, index) => validateNode(node, `scene.nodes[${index}]`, state, 1));
  return scene;
}

/**
 * Intended pipeline: producers create a loose graph, normalize unsupported values
 * into explicit fallback nodes, then validate the normalized JSON contract.
 */
export function normalizeScene(scene) {
  const diagnostics = [];
  const nodes = [];
  const inputNodes = Array.isArray(scene?.nodes) ? scene.nodes : [];
  inputNodes.forEach((node, index) => normalizeNode(node, `scene.nodes[${index}]`, 0, 0, 1, nodes, diagnostics));
  nodes.forEach((node, index) => {
    node.__order = index;
  });
  const normalizedNodes = nodes
    .toSorted((left, right) => {
      const leftZ = Number.isFinite(Number(left.z)) ? Number(left.z) : left.__order;
      const rightZ = Number.isFinite(Number(right.z)) ? Number(right.z) : right.__order;
      const normalizedLeftZ = Number.isFinite(Number(left.__sortZ)) ? Number(left.__sortZ) : leftZ;
      const normalizedRightZ = Number.isFinite(Number(right.__sortZ)) ? Number(right.__sortZ) : rightZ;
      if (normalizedLeftZ !== normalizedRightZ) return normalizedLeftZ - normalizedRightZ;
      return left.__order - right.__order;
    })
    .map((node, index) => stripInternal({ ...node, z: index }));
  return {
    scene: {
      version: SCENE_VERSION,
      source: isPlainObject(scene?.source) ? { ...scene.source } : scene?.source,
      width: roundedExtent(scene?.width),
      height: roundedExtent(scene?.height),
      ...(scene?.accessibility !== undefined ? { accessibility: scene.accessibility } : {}),
      ...(scene?.meta !== undefined ? { meta: scene.meta } : {}),
      nodes: normalizedNodes,
    },
    diagnostics,
  };
}
