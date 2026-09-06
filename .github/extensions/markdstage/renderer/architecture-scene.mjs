import {
  createScene,
  normalizeScene,
  validateScene,
} from "./scene-graph.mjs";

const DEFAULT_SOURCE_PATH = "architecture";

function roundedMetric(value) {
  return Math.round(Math.max(0, Number(value) || 0) * 10) / 10;
}

function finiteNumberOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nonEmptyStringOr(value, fallback) {
  return typeof value === "string" && value ? value : fallback;
}

function transformBounds(bounds, options) {
  return {
    x: roundedMetric(options.originX + finiteNumberOr(bounds?.x, 0) * options.scale),
    y: roundedMetric(options.originY + finiteNumberOr(bounds?.y, 0) * options.scale),
    width: roundedMetric(finiteNumberOr(bounds?.width, 0) * options.scale),
    height: roundedMetric(finiteNumberOr(bounds?.height, 0) * options.scale),
  };
}

function transformPoint(point, options) {
  return {
    x: roundedMetric(options.originX + finiteNumberOr(point?.x, 0) * options.scale),
    y: roundedMetric(options.originY + finiteNumberOr(point?.y, 0) * options.scale),
  };
}

function scaledMetric(value, options) {
  return value === undefined ? undefined : roundedMetric(finiteNumberOr(value, 0) * options.scale);
}

function isSceneColor(value) {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text)) return true;
  return /^rgba?\((.*)\)$/i.test(text);
}

function normalizeColor(value, path, options, diagnostics) {
  if (value === undefined) return undefined;
  const resolved = options.resolveColor(value, path);
  if (resolved === undefined) return undefined;
  if (resolved === null || resolved === "" || resolved === "none" || resolved === "transparent") return null;
  if (isSceneColor(resolved)) return resolved;
  diagnostics.push({
    path,
    kind: "color",
    reason: `color is not resolved for scene graph: ${String(value)}`,
  });
  return null;
}

function definedEntries(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function mapStyle(object, path, options, diagnostics) {
  const dash = object.dash === undefined ? undefined : options.resolveDash(object.dash, path);
  const sceneDash = (() => {
    if (dash === undefined) return undefined;
    if (dash === "" || dash === "solid" || dash === "dash" || dash === "dashDot" || dash === "dot") return dash;
    if (dash === "dotted") return "dot";
    const values = String(dash)
      .trim()
      .split(/[ ,]+/)
      .map(Number)
      .filter(Number.isFinite);
    if (values.length >= 2 && values[0] <= 2 && values[1] >= values[0] * 2) return "dot";
    if (values.length >= 2) return "dash";
    return "solid";
  })();
  return definedEntries({
    fill: normalizeColor(object.fill, `${path}.fill`, options, diagnostics),
    stroke: normalizeColor(object.stroke, `${path}.stroke`, options, diagnostics),
    strokeWidth: scaledMetric(object.strokeWidth, options),
    dash: sceneDash,
    opacity: object.opacity,
    cornerRadius: scaledMetric(object.cornerRadius, options),
  });
}

function mapText(text, path, options, diagnostics) {
  if (!text?.paragraphs) return text;
  return {
    paragraphs: text.paragraphs.map((paragraph, paragraphIndex) => ({
      ...paragraph,
      runs: paragraph.runs.map((run, runIndex) => {
        const runPath = `${path}.paragraphs[${paragraphIndex}].runs[${runIndex}]`;
        return definedEntries({
          ...run,
          fontFace: options.fontFace || run.fontFace,
          fontSize: scaledMetric(run.fontSize, options),
          bold: Number(run.fontWeight) >= 600,
          color: normalizeColor(run.color, `${runPath}.color`, options, diagnostics),
        });
      }),
    })),
  };
}

function mapTextLayout(object, options) {
  return definedEntries({
    alignment: object.alignment,
    verticalAlignment: object.verticalAlignment,
    textWrap: object.textWrap,
    textInsets: object.textInsets
      ? Object.fromEntries(
          Object.entries(object.textInsets).map(([key, value]) => [key, scaledMetric(value, options)]),
        )
      : undefined,
  });
}

function applyShapeOpacityToText(text, opacity) {
  if (!text?.paragraphs || !Number.isFinite(opacity)) return text;
  return {
    ...text,
    paragraphs: text.paragraphs.map((paragraph) => ({
      ...paragraph,
      runs: paragraph.runs.map((run) => ({
        ...run,
        opacity: (Number.isFinite(run.opacity) ? run.opacity : 1) * opacity,
      })),
    })),
  };
}

function sourcePathFor(object, fallback) {
  return nonEmptyStringOr(object.architecture?.sourcePath, nonEmptyStringOr(object.sourcePath, fallback));
}

function sourceIdFor(object) {
  return nonEmptyStringOr(object.architecture?.id, nonEmptyStringOr(object.id, ""));
}

function shapePreset(object) {
  return nonEmptyStringOr(object.shape, "rect");
}

function arrowEndFor(value) {
  if (value === true) return "triangle";
  if (value === false || value === undefined || value === null) return "none";
  return value;
}

function imageResult(entry, kind, options) {
  const resolved = options.resolveImage(entry, kind);
  if (typeof resolved === "string") return { src: resolved };
  if (resolved && typeof resolved === "object") return resolved;
  return { src: "" };
}

function imageNode(entry, kind, index, options) {
  const image = imageResult(entry, kind, options);
  const bounds = image.bounds || transformBounds(entry, options);
  const architecture = definedEntries({
    ...(entry.architecture || {}),
    kind,
    id: entry.architecture?.id || entry.id || "",
    sourcePath: entry.architecture?.sourcePath || entry.sourcePath,
    order: entry.architecture?.order ?? entry.order,
    z: entry.architecture?.z ?? entry.z,
  });
  if (!image.src) {
    return {
      kind: "fallback",
      ...(sourceIdFor({ ...entry, architecture }) ? { id: sourceIdFor({ ...entry, architecture }) } : {}),
      sourcePath: sourcePathFor({ ...entry, architecture }, `${kind}s[${index}]`),
      z: finiteNumberOr(image.z, index),
      bounds,
      reason: `${kind}-image-unavailable`,
      meta: { architecture },
    };
  }
  return {
    kind: "image",
    ...(sourceIdFor({ ...entry, architecture }) ? { id: sourceIdFor({ ...entry, architecture }) } : {}),
    sourcePath: sourcePathFor({ ...entry, architecture }, `${kind}s[${index}]`),
    z: finiteNumberOr(image.z, index),
    bounds,
    src: image.src,
    alt: nonEmptyStringOr(image.alt, kind === "icon-picture" ? `${entry.icon} icon` : `${architecture.id} image`),
    fit: image.fit || "fill",
    opacity: image.opacity ?? 1,
    meta: { architecture },
  };
}

function objectNode(object, index, options, diagnostics) {
  const path = `objects[${index}]`;
  if (object.type === "connector") {
    return {
      kind: "connector",
      ...(sourceIdFor(object) ? { id: sourceIdFor(object) } : {}),
      sourcePath: sourcePathFor(object, path),
      z: index,
      points: (object.points || []).map((point) => transformPoint(point, options)),
      style: mapStyle(object, path, options, diagnostics),
      arrowStart: "none",
      arrowEnd: arrowEndFor(object.arrowEnd),
      meta: definedEntries({
        architecture: object.architecture,
        from: object.from,
        to: object.to,
      }),
    };
  }
  if (object.type === "image") {
    return imageNode(object, "image-picture", index, options);
  }
  if (object.type === "shape") {
    const text = object.text === undefined
      ? undefined
      : applyShapeOpacityToText(mapText(object.text, `${path}.text`, options, diagnostics), object.opacity);
    return {
      kind: "shape",
      ...(sourceIdFor(object) ? { id: sourceIdFor(object) } : {}),
      sourcePath: sourcePathFor(object, path),
      z: index,
      bounds: transformBounds(object, options),
      preset: shapePreset(object),
      style: mapStyle(object, path, options, diagnostics),
      ...(text !== undefined ? { text } : {}),
      textLayout: mapTextLayout(object, options),
      meta: definedEntries({
        architecture: object.architecture,
        icon: object.icon,
      }),
    };
  }
  return {
    kind: "fallback",
    sourcePath: sourcePathFor(object, path),
    z: index,
    bounds: transformBounds(object, options),
    reason: `unsupported architecture object type: ${String(object.type)}`,
    meta: definedEntries({ architecture: object.architecture }),
  };
}

function fallbackNode(fallback, index, objectCount, options) {
  return {
    kind: "fallback",
    sourcePath: nonEmptyStringOr(fallback.sourcePath, nonEmptyStringOr(fallback.path, `fallbacks[${index}]`)),
    z: objectCount + index,
    bounds: transformBounds(fallback, options),
    reason: nonEmptyStringOr(fallback.reason, "architecture-rendered-as-artwork"),
  };
}

function normalizeOptions(options = {}) {
  return {
    path: nonEmptyStringOr(options.path, DEFAULT_SOURCE_PATH),
    resolveColor: typeof options.resolveColor === "function" ? options.resolveColor : (value) => value,
    resolveImage: typeof options.resolveImage === "function" ? options.resolveImage : (entry) => entry?.src || "",
    resolveDash: typeof options.resolveDash === "function" ? options.resolveDash : (value) => value,
    scale: finiteNumberOr(options.scale, 1),
    originX: finiteNumberOr(options.originX, 0),
    originY: finiteNumberOr(options.originY, 0),
    fontFace: typeof options.fontFace === "string" && options.fontFace ? options.fontFace : undefined,
  };
}

export function architectureSnapshotToScene(snapshot, options = {}) {
  const normalizedOptions = normalizeOptions(options);
  const diagnostics = [];
  const objects = Array.isArray(snapshot?.objects) ? snapshot.objects : [];
  const icons = Array.isArray(snapshot?.icons) ? snapshot.icons : [];
  const fallbacks = Array.isArray(snapshot?.fallbacks) ? snapshot.fallbacks : [];
  const nodes = objects.flatMap((object, index) => {
    const mapped = [objectNode(object, index, normalizedOptions, diagnostics)];
    if (object.type === "shape" && object.icon) {
      const icon = icons.find((candidate) => candidate.id === object.architecture?.id);
      if (icon) mapped.push(imageNode(icon, "icon-picture", index + 1 / 2, normalizedOptions));
    }
    return mapped;
  });
  const iconObjectIds = new Set(
    objects
      .filter((object) => object.type === "shape" && object.icon)
      .map((object) => object.architecture?.id),
  );
  icons
    .filter((icon) => !iconObjectIds.has(icon.id))
    .forEach((icon, index) => nodes.push(imageNode(icon, "icon-picture", objects.length + index, normalizedOptions)));
  fallbacks.forEach((fallback, index) => nodes.push(fallbackNode(fallback, index, nodes.length, normalizedOptions)));

  const accessibility = definedEntries({
    title: snapshot?.title,
    description: snapshot?.description,
  });
  const result = normalizeScene(createScene({
    width: finiteNumberOr(snapshot?.canvas?.width, 0) * normalizedOptions.scale,
    height: finiteNumberOr(snapshot?.canvas?.height, 0) * normalizedOptions.scale,
    source: { kind: "architecture", path: normalizedOptions.path },
    ...(Object.keys(accessibility).length ? { accessibility } : {}),
    nodes,
  }));
  result.diagnostics.unshift(...diagnostics);
  validateScene(result.scene);
  return result;
}
