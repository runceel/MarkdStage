function finiteNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
}

function roundedMetric(value) {
  return Math.round(Math.max(0, value) * 10) / 10;
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
    ...(Array.isArray(element.points)
      ? { points: element.points.map((point) => placePoint(point, placement)) }
      : {}),
    ...(element.labelBounds
      ? { labelBounds: placeBounds(element.labelBounds, placement) }
      : {}),
  };
}
