// Place a scene-unit PowerPoint element into deck coordinates.
//
// A scene authored in its own units (an Archify export is measured in its SVG
// viewBox) is mapped onto the 1280x720 deck by one uniform similarity transform.
// Every length in the element travels through that transform, not just the
// bounding boxes: a shape scaled to 60% whose font size, stroke width, corner
// radius and text insets stayed at their authored value would come out of
// PowerPoint with oversized text spilling past its box and pill-shaped corners.
// Producers that already emit deck coordinates (architecture, Mermaid) never
// reach this module.
const MIN_POSITIVE_METRIC = 0.1;

/**
 * Lengths measured in scene units, split by what the PowerPoint writer accepts.
 *
 * A stroke width or a line height must stay above zero there, so those floor at
 * the smallest metric rather than rounding away; a corner radius or an inset is
 * legitimately zero and must survive as zero.
 */
const SCALED_ELEMENT_METRICS = { positive: ["strokeWidth"], nonNegative: ["cornerRadius"] };
/** Per-paragraph lengths; the font-size keys are handled per run. */
const SCALED_PARAGRAPH_METRICS = {
  positive: ["lineSpacing"],
  nonNegative: ["spaceBefore", "spaceAfter", "leftMargin", "bulletOffsetPx"],
};
const SCALED_RUN_METRICS = { positive: ["fontSize", "fontSizePx", "fontSizePt"], nonNegative: [] };
const TEXT_INSET_METRICS = { positive: [], nonNegative: ["left", "top", "right", "bottom"] };

function finiteNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
}

function roundedMetric(value) {
  return Math.round(Math.max(0, value) * 10) / 10;
}

/**
 * Scale a length the PowerPoint writer requires to stay above zero.
 *
 * Rounding a hairline stroke or a tiny label to 0 would turn a legible element
 * into a rejected model, so those collapse to the smallest metric instead.
 */
function roundedPositiveMetric(value) {
  return Math.max(MIN_POSITIVE_METRIC, roundedMetric(value));
}

function scaleMetrics(target, source, metrics, placement) {
  for (const [group, round] of [
    [metrics.positive, roundedPositiveMetric],
    [metrics.nonNegative, roundedMetric],
  ]) {
    for (const key of group) {
      if (typeof source[key] !== "number" || !Number.isFinite(source[key])) continue;
      target[key] = round(source[key] * placement.scale);
    }
  }
  return target;
}

function scaleRun(run, placement) {
  if (!run || typeof run !== "object") return run;
  return scaleMetrics({ ...run }, run, SCALED_RUN_METRICS, placement);
}

function scaleParagraph(paragraph, placement) {
  if (!paragraph || typeof paragraph !== "object") return paragraph;
  const scaled = scaleMetrics(
    { ...paragraph },
    paragraph,
    SCALED_PARAGRAPH_METRICS,
    placement,
  );
  if (Array.isArray(paragraph.runs)) {
    scaled.runs = paragraph.runs.map((run) => scaleRun(run, placement));
  }
  return scaled;
}

function scaleParagraphs(paragraphs, placement) {
  return Array.isArray(paragraphs)
    ? paragraphs.map((paragraph) => scaleParagraph(paragraph, placement))
    : paragraphs;
}

/** Rich text is either a plain string, which carries no lengths, or paragraphs. */
function scaleText(text, placement) {
  if (!text || typeof text !== "object" || Array.isArray(text)) return text;
  if (!Array.isArray(text.paragraphs)) return text;
  return { ...text, paragraphs: scaleParagraphs(text.paragraphs, placement) };
}

function scaleTextInsets(insets, placement) {
  if (!insets || typeof insets !== "object" || Array.isArray(insets)) return insets;
  return scaleMetrics({ ...insets }, insets, TEXT_INSET_METRICS, placement);
}

function placePoint(point, placement) {
  return {
    x: roundedMetric(placement.originX + finiteNumber(point?.x, "point.x") * placement.scale),
    y: roundedMetric(placement.originY + finiteNumber(point?.y, "point.y") * placement.scale),
  };
}

function placeBounds(bounds, placement) {
  return {
    x: roundedMetric(placement.originX + finiteNumber(bounds?.x, "bounds.x") * placement.scale),
    y: roundedMetric(placement.originY + finiteNumber(bounds?.y, "bounds.y") * placement.scale),
    width: roundedMetric(finiteNumber(bounds?.width, "bounds.width") * placement.scale),
    height: roundedMetric(finiteNumber(bounds?.height, "bounds.height") * placement.scale),
  };
}

export function placePptxElement(element, options) {
  const placement = {
    originX: finiteNumber(options?.originX, "originX"),
    originY: finiteNumber(options?.originY, "originY"),
    scale: finiteNumber(options?.scale, "scale"),
  };
  if (!(placement.scale > 0)) throw new RangeError("scale must be greater than zero");

  return {
    ...element,
    ...placeBounds(element, placement),
    ...scaleMetrics({}, element, SCALED_ELEMENT_METRICS, placement),
    ...(Array.isArray(element.points)
      ? { points: element.points.map((point) => placePoint(point, placement)) }
      : {}),
    ...(element.labelBounds
      ? { labelBounds: placeBounds(element.labelBounds, placement) }
      : {}),
    ...(element.textInsets !== undefined
      ? { textInsets: scaleTextInsets(element.textInsets, placement) }
      : {}),
    ...(element.text !== undefined
      ? { text: scaleText(element.text, placement) }
      : {}),
    ...(element.label !== undefined
      ? { label: scaleText(element.label, placement) }
      : {}),
    ...(Array.isArray(element.paragraphs)
      ? { paragraphs: scaleParagraphs(element.paragraphs, placement) }
      : {}),
  };
}
