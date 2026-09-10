import {
  ARCHITECTURE_LAYOUT_BLOCK_LIMIT,
  ARCHITECTURE_LAYOUT_ELEMENT_LIMIT,
} from "../renderer/architecture-layout.mjs";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const text = (value, max) => typeof value === "string" ? value.slice(0, max) : "";
const nonnegative = (value) => finite(value) ? Math.min(1e9, Math.max(0, value)) : 0;

function box(value, position = false) {
  if (!object(value)) return undefined;
  return {
    ...(position ? {
      x: finite(value.x) ? Math.max(-1e9, Math.min(1e9, value.x)) : 0,
      y: finite(value.y) ? Math.max(-1e9, Math.min(1e9, value.y)) : 0,
    } : {}),
    width: nonnegative(value.width),
    height: nonnegative(value.height),
  };
}

function hint(value) {
  if (!object(value)) return null;
  const result = {
    kind: text(value.kind, 40),
    path: text(value.path, 256),
    tag: text(value.tag, 32),
    ...(typeof value.text === "string" ? { text: text(value.text, 96) } : {}),
  };
  if (value.kind === "architecture") {
    Object.assign(result, {
      blockIndex: nonnegative(value.blockIndex),
      id: text(value.id, 96),
      type: text(value.type, 32),
      bbox: box(value.bbox, true),
      effectiveScale: nonnegative(value.effectiveScale),
      shrunk: value.shrunk === true,
      truncated: value.truncated === true,
    });
    for (const key of ["fontSize", "requestedFontSize", "effectiveFontSize"]) {
      if (finite(value[key])) result[key] = nonnegative(value[key]);
    }
    for (const key of ["requestedSize", "effectiveSize"]) {
      if (object(value[key])) {
        result[key] = box(value[key]);
        if (key === "requestedSize") {
          for (const dimension of ["width", "height"]) {
            if (value[key][dimension] === "auto") result[key][dimension] = "auto";
          }
        }
      }
    }
  } else {
    result.classes = Array.isArray(value.classes) ? value.classes.slice(0, 4).map((item) => text(item, 64)) : [];
    result.verticalOverflowPx = nonnegative(value.verticalOverflowPx);
    result.horizontalOverflowPx = nonnegative(value.horizontalOverflowPx);
  }
  return result;
}

// Renderer output is untrusted HTTP input. Keep only bounded diagnostic fields;
// never forward DOM snapshots, image data, arbitrary metadata, or source content.
export function sanitizeLayoutReport(layout) {
  if (!object(layout) || !Array.isArray(layout.slides)) return null;
  let remaining = ARCHITECTURE_LAYOUT_ELEMENT_LIMIT;
  const slides = layout.slides.slice(0, 1000).filter(object).map((slide) => {
    const result = {
      index: nonnegative(slide.index),
      page: nonnegative(slide.page),
      title: text(slide.title, 160),
      status: slide.pdfClipped === true ? "pdf-clipped" : "fits",
      pdfClipped: slide.pdfClipped === true,
      screenScrollable: slide.screenScrollable === true,
    };
    for (const key of ["verticalOverflowPx", "horizontalOverflowPx", "availableWidthPx",
      "availableHeightPx", "contentWidthPx", "contentHeightPx"]) {
      result[key] = nonnegative(slide[key]);
    }
    let hints = 0;
    result.elements = [];
    for (const value of (Array.isArray(slide.elements) ? slide.elements : []).slice(0, ARCHITECTURE_LAYOUT_ELEMENT_LIMIT + 5)) {
      if (!object(value)) continue;
      if (value.kind === "architecture") {
        if (remaining <= 0) continue;
        remaining--;
      } else if (hints++ >= 5) continue;
      result.elements.push(hint(value));
    }
    result.scrollContainers = (Array.isArray(slide.scrollContainers) ? slide.scrollContainers : [])
      .slice(0, 5).map(hint).filter(Boolean);
    if (Array.isArray(slide.architecture)) {
      result.architecture = slide.architecture.slice(0, ARCHITECTURE_LAYOUT_BLOCK_LIMIT)
        .filter(object).map((diagram) => ({
          blockIndex: nonnegative(diagram.blockIndex),
          bbox: box(diagram.bbox, true),
          effectiveScale: nonnegative(diagram.effectiveScale),
          elementCount: nonnegative(diagram.elementCount),
          reportedElementCount: result.elements.filter((entry) =>
            entry.kind === "architecture" && entry.blockIndex === diagram.blockIndex).length,
        }));
      result.architectureBlockCount = nonnegative(slide.architectureBlockCount);
    }
    return result;
  });
  return {
    width: nonnegative(layout.width),
    height: nonnegative(layout.height),
    total: nonnegative(layout.total),
    issueCount: slides.filter((slide) => slide.pdfClipped).length,
    slides,
  };
}
