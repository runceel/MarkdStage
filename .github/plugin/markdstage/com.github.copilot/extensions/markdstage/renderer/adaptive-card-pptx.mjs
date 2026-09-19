import { createScene, MAX_SCENE_NODES } from "./scene-graph.mjs";
import { sceneToPptxElements } from "./scene-pptx.mjs";
import { approvedCardHyperlink } from "./adaptive-card-markdown.mjs";

const MAX_MEASURED_CHARACTERS = 16_384;
const EPSILON = 0.2;
const key = (value) => value[0].toLowerCase() + value.slice(1);
const whitespace = (value) => /^\s+$/u.test(value);
const round = (value) => Math.round(value * 1000) / 1000;

class CardConversionError extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
const unsupported = (reason) => { throw new CardConversionError(reason); };
const color = (value) => /^#[\da-f]{8}$/i.test(value || "")
  ? `#${value.slice(3)}${value.slice(1, 3)}` : value;
const visibleColor = (value) => value && !["#00000000", "transparent"].includes(value);
const firstFont = (value) => value.split(",")[0].trim().replace(/^["']|["']$/g, "");
const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x &&
  a.y < b.y + b.height && a.y + a.height > b.y;
const contains = (outer, inner, tolerance = EPSILON) => inner.x >= outer.x - tolerance &&
  inner.y >= outer.y - tolerance && inner.x + inner.width <= outer.x + outer.width + tolerance &&
  inner.y + inner.height <= outer.y + outer.height + tolerance;
const intersect = (a, b) => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
};

function effectiveRtl(object) {
  for (let current = object; current; current = current.parent) {
    if (typeof current.rtl === "boolean") return current.rtl;
  }
  return false;
}

function textStyle(object, SDK, overrides = {}) {
  const config = object.hostConfig;
  const font = config.getFontTypeDefinition(object.effectiveFontType);
  const size = key(SDK.TextSize[object.effectiveSize]);
  const role = key(SDK.TextColor[object.effectiveColor]);
  const colors = object.getEffectiveStyleDefinition().foregroundColors[role];
  const weight = font.fontWeights[key(SDK.TextWeight[object.effectiveWeight])];
  const style = {
    fontFamily: font.fontFamily, fontSize: font.fontSizes[size], fontWeight: weight,
    color: color(object.effectiveIsSubtle ? colors.subtle : colors.default),
    lineHeight: config.lineHeights[object instanceof SDK.TextBlock ? size : "default"],
    italic: object.italic === true, underline: object.underline === true,
    strikethrough: object.strikethrough === true,
    ...(object.highlight ? { highlight: color(object.effectiveIsSubtle
      ? colors.highlightColors.subtle : colors.highlightColors.default) } : {}),
  };
  return { ...style, ...overrides };
}

function factStyle(factSet, SDK, name) {
  const definition = factSet.hostConfig.factSet[name];
  const font = factSet.hostConfig.getFontTypeDefinition();
  const size = key(SDK.TextSize[definition.size]);
  const colors = factSet.getEffectiveStyleDefinition().foregroundColors[key(SDK.TextColor[definition.color])];
  return { fontFamily: font.fontFamily, fontSize: font.fontSizes[size],
    fontWeight: font.fontWeights[key(SDK.TextWeight[definition.weight])],
    color: color(definition.isSubtle ? colors.subtle : colors.default),
    lineHeight: factSet.hostConfig.lineHeights[size], italic: false, underline: false, strikethrough: false };
}

function nativeRun(style, text) {
  const face = firstFont(style.fontFamily);
  // Segoe UI exposes its semibold/light faces separately to Office. Request
  // those actual faces rather than turning CSS 600 into synthesized bold 700.
  const fontFace = face === "Segoe UI" && style.fontWeight === 600 ? "Segoe UI Semibold"
    : face === "Segoe UI" && style.fontWeight === 300 ? "Segoe UI Light" : face;
  return { text, fontFace, fontSize: style.fontSize, color: style.color,
    bold: style.fontWeight >= 600 && fontFace === face,
    italic: Boolean(style.italic), underline: Boolean(style.underline),
    strikethrough: Boolean(style.strikethrough) };
}

function semanticRuns(fragment, base, field) {
  return fragment.runs.map(({ text, bold, code, ...format }) => ({
    text, field, style: { ...base, ...format,
      ...(bold ? { fontWeight: 600 } : {}),
      ...(code ? { fontFamily: "Consolas, monospace" } : {}) },
  }));
}

function measureText(element, semantics, context) {
  const expected = [];
  // Spaces have their own semantic font; borrowing an inline-code font changes
  // their baseline and can remove the gap when fragments become table runs.
  const whitespaceRuns = new Map();
  for (const run of semantics) {
    for (const character of run.text) {
      if (whitespace(character)) whitespaceRuns.set(expected.length, run);
      else expected.push({ character, run });
    }
  }
  if (expected.length > MAX_MEASURED_CHARACTERS) unsupported("adaptive-card-text-measurement-limit");
  const walker = context.document.createTreeWalker(element, 4);
  const nodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
  const actual = nodes.flatMap((node) => [...node.data].filter((character) => !whitespace(character)));
  if (actual.length !== expected.length || actual.some((character, index) => character !== expected[index].character)) {
    unsupported("adaptive-card-text-correlation");
  }
  let cursor = 0, previous = semantics[0], measured = 0;
  const pieces = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const node of nodes) {
    for (const { segment, index } of segmenter.segment(node.data)) {
      if (++measured > MAX_MEASURED_CHARACTERS) unsupported("adaptive-card-text-measurement-limit");
      const nonwhite = [...segment].filter((character) => !whitespace(character)).length;
      const semantic = nonwhite ? expected[cursor]?.run : whitespaceRuns.get(cursor) || previous;
      cursor += nonwhite;
      if (nonwhite) previous = semantic;
      if (!semantic) continue;
      const range = context.document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + segment.length);
      const boxes = [...range.getClientRects()].filter((box) => box.width > 0 && box.height > 0);
      if (!boxes.length) {
        if (nonwhite) unsupported("adaptive-card-text-not-painted");
        continue;
      }
      if (boxes.length !== 1) unsupported("adaptive-card-text-fragmentation");
      const bounds = context.rect(boxes[0]);
      const style = semantic.style;
      context.canvas.font = `${style.italic ? "italic " : ""}${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
      const metrics = context.canvas.measureText(segment);
      if (!Number.isFinite(metrics.fontBoundingBoxAscent)) unsupported("adaptive-card-font-metrics-unavailable");
      const baseline = bounds.y + metrics.fontBoundingBoxAscent;
      const last = pieces.at(-1);
      const signature = JSON.stringify(style);
      if (last && last.signature === signature && last.field === semantic.field &&
          Math.abs(last.baseline - baseline) < EPSILON &&
          Math.abs(last.bounds.x + last.bounds.width - bounds.x) < 1) {
        last.text += segment;
        last.bounds.width = bounds.x + bounds.width - last.bounds.x;
        last.bounds.y = Math.min(last.bounds.y, bounds.y);
        last.bounds.height = Math.max(last.bounds.height, bounds.height);
      } else {
        pieces.push({ text: segment, style, signature, field: semantic.field, bounds, baseline });
      }
    }
  }
  return pieces;
}

function logicalLines(pieces) {
  const result = [];
  for (const piece of pieces) {
    let line = result.find((candidate) => Math.abs(candidate.baseline - piece.baseline) < EPSILON);
    if (!line) { line = { baseline: piece.baseline, pieces: [] }; result.push(line); }
    line.pieces.push(piece);
  }
  return result.sort((left, right) => left.baseline - right.baseline);
}

export function adaptiveCardToPptx({ host, deck, card, SDK, objects, markdown, provenance = new Map(), forceFallbackReason, visibleBounds }) {
  const document = host.ownerDocument;
  const origin = deck.getBoundingClientRect();
  const scaleX = origin.width / deck.offsetWidth, scaleY = origin.height / deck.offsetHeight;
  const rect = (box) => ({ x: round((box.x - origin.x) / scaleX), y: round((box.y - origin.y) / scaleY),
    width: round(box.width / scaleX), height: round(box.height / scaleY) });
  const measure = (element) => rect(element.getBoundingClientRect());
  const viewport = { x: 0, y: 0, width: deck.offsetWidth, height: deck.offsetHeight };
  const clip = intersect(visibleBounds ? rect(visibleBounds) : measure(host), viewport);
  const pathPrefix = `adaptive-card[${host.dataset.adaptiveCardBlock}]`;
  const entries = new Map(objects.map((entry) => [entry.object, entry]));
  const children = new Map();
  for (const entry of objects) {
    if (entry.parentProjectedPath !== null) children.set(entry.parentProjectedPath,
      [...children.get(entry.parentProjectedPath) || [], entry]);
  }
  const context = { document, rect, canvas: document.createElement("canvas").getContext("2d") };
  const nodes = [], direct = [], fallbacks = [], conversions = [], nativeElements = new Map();
  let order = 0;
  const fullPath = (entry) => `${pathPrefix}${entry.sourcePath}`;
  const metadata = (entry) => ({ adaptiveCard: { sourcePath: fullPath(entry),
    sourceType: provenance.get(entry.projectedPath)?.type || entry.object.getJsonTypeName?.() || "Fact",
    renderedType: entry.object.getJsonTypeName?.() || "Fact" } });
  const push = (entry, node, suffix = "") => {
    if (nodes.length + direct.length >= MAX_SCENE_NODES - 1) unsupported("adaptive-card-native-object-limit");
    nodes.push({ ...node, sourcePath: `${fullPath(entry)}${suffix}`, z: order++, meta: metadata(entry) });
  };
  const report = (entry, mode, reason, count) => {
    const projection = provenance.get(entry.projectedPath);
    if (mode === "native" && ["static-input", "static-action", "static-media"].includes(projection?.treatment)) {
      mode = "approximated";
      reason = `adaptive-card-${projection.treatment}`;
    }
    conversions.push({ sourcePath: fullPath(entry), sourceType: projection?.type || entry.object.getJsonTypeName?.() || "Fact",
      mode, reason, nativeObjects: count, impact: mode === "native" ? "none" : "content",
      ...(projection ? { treatment: projection.treatment } : {}) });
  };
  const fallback = (entry, reason, element = entry.object.renderedElement) => {
    if (!element?.isConnected) unsupported("adaptive-card-geometry-unavailable");
    const bounds = intersect(measure(element), clip);
    const outside = bounds.width <= 0 || bounds.height <= 0;
    fallbacks.push({ element, ...bounds, sourcePath: fullPath(entry), path: fullPath(entry),
      reason: outside ? "adaptive-card-outside-slide" : reason, z: order++, ...(outside ? { artwork: false } : {}) });
    report(entry, "rasterized", outside ? "adaptive-card-outside-slide" : reason, 0);
  };
  const shape = (entry, bounds, fill, suffix = ".background", stroke = null, strokeWidth = 0) => {
    const clipped = intersect(bounds, clip);
    if (clipped.width <= 0 || clipped.height <= 0) return;
    push(entry, { kind: "shape", preset: "rect", bounds: clipped, style: { fill, stroke, strokeWidth } }, suffix);
  };
  const separator = (entry) => {
    const { object } = entry;
    if (!object.separator || !object.hasVisibleSeparator || !object.separatorElement?.isConnected) return;
    const bounds = measure(object.separatorElement), config = object.hostConfig.separator;
    const vertical = object instanceof SDK.Column;
    const thickness = config.lineThickness;
    // The public separator box includes half of the SDK spacing before its
    // trailing border; it is not the painted one-pixel line itself.
    const painted = intersect({ x: bounds.x + (vertical ? bounds.width - thickness : 0),
      y: bounds.y + (vertical ? 0 : bounds.height - thickness), width: vertical ? thickness : bounds.width,
      height: vertical ? bounds.height : thickness }, clip);
    if (painted.width > 0 && painted.height > 0) {
      push(entry, { kind: "connector", points: vertical
        ? [{ x: painted.x + painted.width / 2, y: painted.y },
          { x: painted.x + painted.width / 2, y: painted.y + painted.height }]
        : [{ x: painted.x, y: painted.y + painted.height / 2 },
          { x: painted.x + painted.width, y: painted.y + painted.height / 2 }],
      arrowStart: "none", arrowEnd: "none",
      style: { stroke: color(config.lineColor), strokeWidth: vertical ? painted.width : painted.height, lineCap: "butt" } }, ".separator");
    }
    nativeElements.set(object.separatorElement, "connector");
  };
  const getMarkdown = (value) => {
    const fragment = markdown.get(value);
    if (!fragment) unsupported("adaptive-card-markdown-correlation");
    if (fragment.reason) unsupported(fragment.reason);
    return fragment;
  };
  const textPieces = (entry) => {
    const { object } = entry;
    let semantics;
    if (object instanceof SDK.TextBlock) {
      if (object.renderedElement.scrollWidth > object.renderedElement.clientWidth + 1 ||
          object.renderedElement.scrollHeight > object.renderedElement.clientHeight + 1) {
        unsupported("adaptive-card-clipped-text");
      }
      semantics = semanticRuns(getMarkdown(object.text), textStyle(object, SDK), entry.sourcePath);
    } else {
      const projection = provenance.get(entry.projectedPath);
      const href = approvedCardHyperlink(projection?.href || object.selectAction?.url, document);
      semantics = [{ text: object.text || "", field: entry.sourcePath,
        style: { ...textStyle(object, SDK), ...(href ? { href } : {}) } }];
    }
    if (semantics.some((run) => /[\u0590-\u08ff\u202a-\u202e\u2066-\u2069]/u.test(run.text))) {
      unsupported("adaptive-card-bidirectional-text");
    }
    const pieces = measureText(object.renderedElement, semantics, context);
    const bounds = measure(object.renderedElement);
    // Font boxes may extend above/below their line box. Painted ink must stay
    // inside the card/slide; truncated TextBlocks retain the SDK's ellipsis.
    for (const piece of pieces) {
      const allowed = { x: bounds.x - 0.2, y: bounds.y - 3,
        width: bounds.width + 0.4, height: bounds.height + 6 };
      if (!contains(allowed, piece.bounds) || !contains(clip, piece.bounds, 3)) {
        unsupported("adaptive-card-clipped-text");
      }
    }
    return pieces;
  };
  const emitText = (entry) => {
    const pieces = textPieces(entry);
    pieces.forEach((piece, index) => {
      if (piece.style.highlight) shape(entry, piece.bounds, piece.style.highlight, `.highlight[${index}]`);
      const run = nativeRun(piece.style, piece.text);
      push(entry, { kind: "text", bounds: { ...piece.bounds, width: piece.bounds.width + 1 },
        text: { paragraphs: [{ alignment: "left", runs: [run] }] },
        textLayout: { textWrap: "none", textInsets: { top: 0, bottom: 0, left: 0, right: 0 } } }, `.lines[${index}]`);
      if (piece.style.href) nodes.at(-1).meta.adaptiveCard.href = piece.style.href;
    });
    nativeElements.set(entry.object.renderedElement, "text");
  };
  const paragraphs = (pieces) => logicalLines(pieces).map((line, index, lines) => ({
    alignment: "left", runs: line.pieces.map((piece) => ({
      ...nativeRun(piece.style, piece.text),
      ...(piece.style.href ? { href: piece.style.href, preserveHyperlinkColor: true } : {}),
    })),
    lineSpacing: index + 1 < lines.length ? lines[index + 1].baseline - line.baseline
      : Math.max(...line.pieces.map((piece) => piece.style.lineHeight)),
    leftMargin: Math.max(0, Math.min(...line.pieces.map((piece) => piece.bounds.x)) -
      Math.min(...pieces.map((piece) => piece.bounds.x))),
    spaceBefore: 0, spaceAfter: 0,
  }));
  const tableCell = (pieces, bounds, fill = null, stroke = null, strokeWidth = 0) => {
    if (!pieces.length) unsupported("adaptive-card-empty-table-cell");
    if (pieces.some((piece) => piece.style.highlight)) unsupported("adaptive-card-table-highlight");
    const left = Math.min(...pieces.map((piece) => piece.bounds.x));
    const top = Math.min(...pieces.map((piece) => piece.bounds.y));
    if (left < bounds.x - EPSILON || top < bounds.y - 3) unsupported("adaptive-card-table-text-bounds");
    return { fill, stroke, strokeWidth, textWrap: "none", verticalAlignment: "top",
      textInsets: { left: Math.max(0, left - bounds.x), top: Math.max(0, top - bounds.y), right: 0, bottom: 0 },
      paragraphs: paragraphs(pieces) };
  };
  const emitFacts = (entry) => {
    const { object } = entry;
    if (effectiveRtl(object)) unsupported("adaptive-card-bidirectional-table");
    if (!object.facts.length) { nativeElements.set(object.renderedElement, "table"); return; }
    const bounds = measure(object.renderedElement);
    if (!contains(clip, bounds)) unsupported("adaptive-card-clipped-table");
    const semantics = [];
    object.facts.forEach((fact, index) => {
      semantics.push(...semanticRuns(getMarkdown(fact.name), factStyle(object, SDK, "title"), `${index}:title`),
        ...semanticRuns(getMarkdown(fact.value), factStyle(object, SDK, "value"), `${index}:value`));
    });
    if (semantics.some((run) => /[\u0590-\u08ff]/u.test(run.text))) unsupported("adaptive-card-bidirectional-text");
    const pieces = measureText(object.renderedElement, semantics, context);
    const fields = object.facts.map((_, index) => ["title", "value"].map((name) =>
      pieces.filter((piece) => piece.field === `${index}:${name}`)));
    if (fields.some((row) => row.some((field) => !field.length))) unsupported("adaptive-card-empty-table-cell");
    const starts = fields.map((row) => Math.min(...row.flat().map((piece) => piece.bounds.y)));
    const valueX = Math.min(...fields.flatMap((row) => row[1].map((piece) => piece.bounds.x)));
    if (valueX <= bounds.x || valueX >= bounds.x + bounds.width ||
        fields.some((row) => Math.abs(Math.min(...row[1].map((piece) => piece.bounds.x)) - valueX) > EPSILON)) {
      unsupported("adaptive-card-fact-columns");
    }
    const offset = starts[0] - bounds.y;
    const rows = fields.map((rowFields, index) => {
      const y = starts[index] - offset;
      const height = index + 1 < fields.length ? starts[index + 1] - starts[index] : bounds.y + bounds.height - y;
      return { height, cells: rowFields.map((field, column) => tableCell(field,
        { x: column ? valueX : bounds.x, y, width: column ? bounds.x + bounds.width - valueX : valueX - bounds.x, height })) };
    });
    if (rows.some((row) => !(row.height > 0))) unsupported("adaptive-card-fact-rows");
    direct.push({ type: "table", ...bounds, path: fullPath(entry), z: order++,
      columnWidths: [valueX - bounds.x, bounds.x + bounds.width - valueX], rows,
      measuredRows: true, firstRowAsHeaders: false, bandRows: false, ...metadata(entry) });
    nativeElements.set(object.renderedElement, "table");
  };
  const emitTable = (entry) => {
    const { object } = entry;
    if (effectiveRtl(object)) unsupported("adaptive-card-bidirectional-table");
    const tableBounds = measure(object.renderedElement);
    if (!contains(clip, tableBounds)) unsupported("adaptive-card-clipped-table");
    if (object.showGridLines === false) unsupported("adaptive-card-table-cell-spacing");
    const rowObjects = children.get(entry.projectedPath) || [];
    if (!rowObjects.length) unsupported("adaptive-card-empty-table");
    const rowBounds = rowObjects.map(({ object }) => measure(object.renderedElement));
    const cellRows = rowObjects.map((row) => children.get(row.projectedPath) || []);
    const cells = cellRows.map((row) => row.map((cell) => {
      if (effectiveRtl(cell.object)) unsupported("adaptive-card-bidirectional-table");
      const content = children.get(cell.projectedPath) || [];
      if (content.length !== 1 || !(content[0].object instanceof SDK.TextBlock)) {
        unsupported("adaptive-card-table-cell-content");
      }
      const pieces = textPieces(content[0]), bounds = measure(cell.object.renderedElement);
      const fill = color(cell.object.getEffectiveStyleDefinition().backgroundColor);
      const line = color(object.hostConfig.containerStyles.getStyleByName(object.gridStyle).borderColor);
      return { bounds, model: tableCell(pieces, bounds, visibleColor(fill) ? fill : null, line, 1) };
    }));
    const widths = cells[0].map((cell) => cell.bounds.width);
    if (cells.some((row) => row.length !== widths.length ||
        row.some((cell, index) => Math.abs(cell.bounds.width - widths[index]) > EPSILON)) ||
        rowBounds.some((row) => Math.abs(row.width - widths.reduce((sum, width) => sum + width, 0)) > EPSILON)) {
      unsupported("adaptive-card-table-column-geometry");
    }
    const bounds = { x: rowBounds[0].x, y: rowBounds[0].y,
      width: widths.reduce((sum, width) => sum + width, 0),
      height: rowBounds.reduce((sum, row) => sum + row.height, 0) };
    direct.push({ type: "table", ...bounds, path: fullPath(entry), z: order++, columnWidths: widths,
      rows: cells.map((row, index) => ({ height: rowBounds[index].height, cells: row.map((cell) => cell.model) })),
      measuredRows: true, firstRowAsHeaders: object.firstRowAsHeaders, bandRows: false, ...metadata(entry) });
    nativeElements.set(object.renderedElement, "table");
  };
  const visit = (entry) => {
    const { object } = entry;
    if (object instanceof SDK.Fact) return;
    const element = object.renderedElement;
    if (object.isVisible === false || !element?.isConnected) {
      if (object.isVisible === false) return;
      unsupported("adaptive-card-geometry-unavailable");
    }
    const bounds = measure(element);
    if (!bounds.width || !bounds.height) return;
    const before = { nodes: nodes.length, direct: direct.length, fallbacks: fallbacks.length,
      conversions: conversions.length, order };
    let ownCount;
    try {
      separator(entry);
      if (!intersects(bounds, clip)) {
        fallback(entry, "adaptive-card-outside-slide");
        return;
      }
      if (object instanceof SDK.TextBlock || object instanceof SDK.TextRun) emitText(entry);
      else if (object instanceof SDK.Image) {
        if (object.style !== SDK.ImageStyle.Default) unsupported("adaptive-card-image-style");
        const imageBounds = measure(object.renderedImageElement);
        if (!contains(clip, imageBounds)) unsupported("adaptive-card-clipped-image");
        if (visibleColor(object.backgroundColor)) shape(entry, imageBounds, color(object.backgroundColor));
        push(entry, { kind: "image", bounds: imageBounds, src: object.url, alt: object.altText || "",
          fit: "fill", opacity: 1 });
        nativeElements.set(element, "image");
      } else if (object instanceof SDK.FactSet) emitFacts(entry);
      else if (object instanceof SDK.Table) emitTable(entry);
      else if (object instanceof SDK.CardElementContainer || object instanceof SDK.RichTextBlock) {
        const ownStyle = object.style;
        if (object === card || ownStyle) {
          const fill = color(object.getEffectiveStyleDefinition().backgroundColor);
          if (visibleColor(fill)) shape(entry, bounds, fill);
        }
        ownCount = nodes.length + direct.length - before.nodes - before.direct;
        for (const child of children.get(entry.projectedPath) || []) visit(child);
        nativeElements.set(element, "group");
      } else unsupported("adaptive-card-unsupported-native-element");
      report(entry, "native", "adaptive-card-native", ownCount ?? nodes.length + direct.length - before.nodes - before.direct);
    } catch (error) {
      if (!(error instanceof CardConversionError)) throw error;
      nodes.length = before.nodes; direct.length = before.direct;
      fallbacks.length = before.fallbacks; conversions.length = before.conversions; order = before.order;
      for (const native of nativeElements.keys()) if (native === element || element.contains(native)) nativeElements.delete(native);
      separator(entry);
      fallback(entry, error.reason);
    }
  };
  try {
    if (forceFallbackReason) unsupported(forceFallbackReason);
    visit(entries.get(card));
  } catch (error) {
    if (!(error instanceof CardConversionError)) throw error;
    nodes.length = 0; direct.length = 0; fallbacks.length = 0; conversions.length = 0; nativeElements.clear(); order = 0;
    fallback(entries.get(card), error.reason, host);
  }
  const note = host.shadowRoot.querySelector(".card-diagnostics");
  if (note && !fallbacks.some((entry) => entry.element === host)) fallback({ object: { getJsonTypeName: () => "Diagnostic" }, sourcePath: "$.diagnostics" },
    "adaptive-card-diagnostic-note", note);
  const scene = createScene({ width: viewport.width, height: viewport.height,
    source: { kind: "adaptive-card", path: pathPrefix }, nodes });
  const base = Number(host.dataset.pptxZOrder) || 0;
  const step = 0.75 / Math.max(1, order + 1);
  const mapped = sceneToPptxElements(scene, { zOrderBase: base, zOrderStep: step, groupPreset: "rect" });
  for (const element of mapped.elements) {
    const href = element.adaptiveCard?.href;
    // Office can visually underline a linked run even when its public font
    // reports no underline. A link on this measured text fragment's shape
    // retains the SDK appearance without changing browser rendering.
    if (href) element.href = href;
  }
  return { scene, elements: [...mapped.elements, ...direct.map(({ z, ...element }) => ({ ...element, zOrder: base + z * step }))],
    fallbacks: fallbacks.map(({ z, ...entry }) => ({ ...entry, zOrder: base + z * step })),
    conversions, nativeElements };
}
