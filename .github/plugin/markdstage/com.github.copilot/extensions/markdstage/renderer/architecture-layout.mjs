export const ARCHITECTURE_LAYOUT_ELEMENT_LIMIT = 200;
export const ARCHITECTURE_LAYOUT_BLOCK_LIMIT = 20;

const metric = (value) => Math.round(value * 1000) / 1000;

function boundsFor(element, origin, scale) {
  const rect = element.getBoundingClientRect();
  return {
    x: metric((rect.x - origin.x) / scale),
    y: metric((rect.y - origin.y) / scale),
    width: metric(rect.width / scale),
    height: metric(rect.height / scale),
  };
}

function effectiveScale(element, scale) {
  const matrix = element.getScreenCTM?.();
  return matrix ? Math.hypot(matrix.c, matrix.d) / scale : 1;
}

function numberAttribute(element, name) {
  const value = element.getAttribute(`data-architecture-${name}`) ?? element.getAttribute(`data-${name}`);
  return value !== null && Number.isFinite(Number(value)) ? Number(value) : undefined;
}

function requestedDimension(element, name) {
  const value = element.getAttribute(`data-architecture-requested-${name}`) ??
    element.getAttribute(`data-requested-${name}`);
  return value === "auto" ? value : numberAttribute(element, `requested-${name}`);
}

export function collectArchitectureLayout(deck, scale = 1, limit = ARCHITECTURE_LAYOUT_ELEMENT_LIMIT) {
  const origin = deck.getBoundingClientRect();
  const elements = [];
  const architecture = [];
  const wrappers = [...deck.querySelectorAll(".architecture-diagram")];
  for (const [blockIndex, wrapper] of wrappers.slice(0, ARCHITECTURE_LAYOUT_BLOCK_LIMIT).entries()) {
    const svg = wrapper.querySelector("svg.architecture-svg");
    if (!svg) continue;
    const sources = [...svg.querySelectorAll("[data-architecture-type], [data-architecture-connector-label]")];
    const start = elements.length;
    for (const source of sources) {
      if (elements.length >= limit) break;
      const type = source.getAttribute("data-architecture-type") || "connector-label";
      const id = source.getAttribute("data-architecture-id") ||
        source.getAttribute("data-architecture-connector-label") ||
        source.getAttribute("data-architecture-connector") || "";
      const order = numberAttribute(source, "order");
      const text = source.querySelector("text");
      const renderedScale = effectiveScale(text || source, scale);
      const fontSize = text ? Number.parseFloat(getComputedStyle(text).fontSize) : undefined;
      const requestedFontSize = numberAttribute(text || source, "requested-font-size") ??
        numberAttribute(source, "requested-font-size") ?? fontSize;
      const requestedWidth = requestedDimension(source, "width");
      const requestedHeight = requestedDimension(source, "height");
      const width = numberAttribute(source, "effective-width");
      const height = numberAttribute(source, "effective-height");
      elements.push({
        kind: "architecture",
        path: `architecture[${blockIndex}].${type}[${order ?? id}]`.slice(0, 256),
        tag: source.tagName.toLowerCase(),
        blockIndex,
        id: id.slice(0, 96),
        type,
        bbox: boundsFor(source, origin, scale),
        effectiveScale: metric(renderedScale),
        ...(text ? {
          text: (text.textContent || "").replace(/\s+/g, " ").trim().slice(0, 96),
          fontSize: metric(fontSize * renderedScale),
          requestedFontSize,
          effectiveFontSize: fontSize,
        } : {}),
        ...(requestedWidth !== undefined && requestedHeight !== undefined
          ? { requestedSize: { width: requestedWidth, height: requestedHeight } } : {}),
        ...(width !== undefined && height !== undefined
          ? { effectiveSize: { width, height } } : {}),
        shrunk: source.getAttribute("data-architecture-shrunk") === "true" ||
          text?.getAttribute("data-architecture-shrunk") === "true" ||
          text?.getAttribute("data-shrunk") === "true",
        truncated: source.getAttribute("data-architecture-truncated") === "true" ||
          text?.getAttribute("data-architecture-truncated") === "true" ||
          text?.getAttribute("data-truncated") === "true",
      });
    }
    architecture.push({
      blockIndex,
      bbox: boundsFor(svg, origin, scale),
      effectiveScale: metric(effectiveScale(svg, scale)),
      elementCount: sources.length,
      reportedElementCount: elements.length - start,
    });
  }
  return {
    elements,
    ...(architecture.length ? {
      architecture,
      architectureBlockCount: wrappers.length,
    } : {}),
  };
}
