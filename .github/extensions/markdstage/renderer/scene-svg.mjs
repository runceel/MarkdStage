import { MAX_STRING_LENGTH, normalizeScene, validateScene } from "./scene-graph.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const MATH_NS = "http://www.w3.org/1998/Math/MathML";
const SVG_TAGS = new Set("svg g defs symbol switch title desc path rect circle ellipse polygon polyline line text tspan textPath image use marker clipPath mask pattern linearGradient radialGradient stop filter feDropShadow feGaussianBlur feOffset feBlend feColorMatrix feComposite feFlood feMerge feMergeNode feComponentTransfer feFuncR feFuncG feFuncB feFuncA feConvolveMatrix feDisplacementMap feTurbulence feMorphology feImage feDiffuseLighting feSpecularLighting feDistantLight fePointLight feSpotLight feTile foreignObject".split(" "));
const HTML_TAGS = new Set("div span p br b strong i em s u small sub sup ul ol li code pre img table thead tbody tr th td".split(" "));
const MATH_TAGS = new Set("math mrow mi mn mo mtext mspace ms mfrac msqrt mroot mstyle merror mpadded mphantom mfenced menclose msub msup msubsup munder mover munderover mmultiscripts mprescripts none mtable mtr mtd semantics annotation".split(" "));
const ATTRIBUTES = new Set("id class x y x1 y1 x2 y2 dx dy width height cx cy r rx ry d points viewBox preserveAspectRatio transform fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit opacity color font-family font-size font-weight font-style text-anchor dominant-baseline alignment-baseline textLength lengthAdjust letter-spacing word-spacing text-decoration visibility display overflow pointer-events role tabindex focusable marker-start marker-mid marker-end markerWidth markerHeight markerUnits refX refY orient clip-path clipPathUnits mask maskUnits maskContentUnits filter filterUnits primitiveUnits in in2 result stdDeviation mode type values operator k1 k2 k3 k4 flood-color flood-opacity offset stop-color stop-opacity gradientUnits gradientTransform spreadMethod patternUnits patternContentUnits patternTransform".split(" "));
const CSS_PROPERTIES = new Set("fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit opacity color font-family font-size font-weight font-style font-variant line-height text-align text-anchor dominant-baseline alignment-baseline text-decoration letter-spacing word-spacing white-space overflow-wrap word-break display visibility overflow box-sizing width height min-width min-height max-width max-height padding padding-top padding-right padding-bottom padding-left margin margin-top margin-right margin-bottom margin-left border border-radius background-color vertical-align marker-start marker-mid marker-end clip-path filter".split(" "));
for (const attribute of "alt colspan rowspan systemLanguage startOffset method spacing baseFrequency numOctaves seed stitchTiles scale xChannelSelector yChannelSelector radius order kernelMatrix divisor bias targetX targetY edgeMode preserveAlpha tableValues slope intercept amplitude exponent surfaceScale diffuseConstant specularConstant specularExponent azimuth elevation limitingConeAngle pointsAtX pointsAtY pointsAtZ z mathvariant mathsize mathcolor mathbackground columnalign rowalign columnspacing rowspacing stretchy fence separator accent accentunder largeop movablelimits lspace rspace encoding".split(" ")) ATTRIBUTES.add(attribute);
for (const property of "position top right bottom left z-index transform transform-origin border-top border-right border-bottom border-left border-top-width border-right-width border-bottom-width border-left-width border-top-style border-right-style border-bottom-style border-left-style border-top-color border-right-color border-bottom-color border-left-color object-fit object-position flex flex-direction flex-wrap align-items align-content justify-content gap float clear".split(" ")) CSS_PROPERTIES.add(property);
let renderSequence = 0;

function portableString(value) {
  const text = String(value);
  if (text.length <= MAX_STRING_LENGTH) return text;
  // Rough.js and icon paths can exceed the scene's per-string ceiling. Chunks
  // preserve exact geometry without weakening the shared scene validation limit.
  const chunks = [];
  for (let index = 0; index < text.length; index += MAX_STRING_LENGTH) chunks.push(text.slice(index, index + MAX_STRING_LENGTH));
  return chunks;
}

function stringValue(value) {
  return Array.isArray(value) ? value.join("") : String(value);
}

function safeUrl(value, image = false) {
  const text = String(value).trim();
  if (!text || /[\u0000-\u0020\u007f]/.test(text)) return false;
  if (text.startsWith("#")) return true;
  if (!image) return false;
  if (/^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml)[;,]/i.test(text)) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(text) || /^https?:/i.test(text);
}

function safeCss(value) {
  const text = String(value);
  if (/[\\<>]|\/\*|@|expression\s*\(|javascript\s*:|data\s*:/i.test(text)) return false;
  return !/url\s*\(/i.test(text) || /^url\(["']?#[\w:.-]+["']?\)$/i.test(text.trim());
}

function localPaint(value, source) {
  const match = /^url\(["']?([^"')]+)["']?\)$/i.exec(value);
  if (!match || match[1].startsWith("#")) return value;
  try {
    const base = new URL(source.baseURI);
    const url = new URL(match[1], base);
    if (url.hash && url.origin === base.origin && url.pathname === base.pathname && url.search === base.search) return `url(${url.hash})`;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
  return value;
}

function inlineGeometry(source, property) {
  // CSSOM serializes lengths with fewer digits than Mermaid's raw declaration.
  // Rounding a max-width down can change the used width by a whole layout unit.
  const declarations = source.getAttribute?.("style") || "";
  const pattern = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "gi");
  const matches = [...declarations.matchAll(pattern)];
  return matches.at(-1)?.[1].replace(/\s*!important\s*$/i, "").trim()
    || source.style?.getPropertyValue(property);
}

/** A JSON-serializable primitive builder; it never creates or parses DOM. */
export function svgPrimitive(tag, attributes = {}) {
  const primitive = { tag, attributes: {}, children: [] };
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== "") primitive.attributes[name] = String(value);
  }
  Object.defineProperty(primitive, "appendChild", {
    value(child) { this.children.push(child); return child; },
  });
  return primitive;
}

/**
 * Preserve source geometry, labels and unsupported SVG subtrees as inert primitives.
 * Computed styles replace stylesheet text; no HTML parsing, scripts or event handlers
 * cross this boundary. Slots keep the visible tree tied to the scene's source nodes.
 */
export function captureSvgTree(element, { slots = new Map(), computedStyle = globalThis.getComputedStyle } = {}) {
  let count = 0;
  function capture(source, depth, root = false) {
    if (++count > 50000 || depth > 128) throw new Error("SVG primitive limit exceeded");
    if (source.nodeType === 3) return { text: portableString(source.textContent || "") };
    if (source.nodeType !== 1) return null;
    if (!root && slots.has(source)) return { sceneNode: slots.get(source) };
    let tag = source.localName || source.tagName;
    const html = source.namespaceURI === HTML_NS;
    const math = source.namespaceURI === MATH_NS;
    if (["script", "style", "iframe", "object", "embed", "animate", "animateTransform", "set"].includes(tag)) return null;
    if (!(math ? MATH_TAGS : html ? HTML_TAGS : SVG_TAGS).has(tag)) tag = math ? "mrow" : html ? "span" : "g";
    const primitive = { tag, ...(math ? { namespace: "math" } : html ? { namespace: "html" } : {}), attributes: {}, children: [] };
    for (const attribute of source.attributes || []) {
      if (attribute.name !== "style") primitive.attributes[attribute.name] = portableString(attribute.value);
    }
    if (computedStyle) {
      const style = computedStyle(source);
      primitive.style = {};
      for (const property of CSS_PROPERTIES) {
        // SVG geometry and the root's responsive CSS must not become screen pixels.
        if (!html && !math && /^(?:min-|max-)?(?:width|height)$/.test(property)) continue;
        let value = localPaint(style.getPropertyValue(property), source);
        if (property === "transform") {
          // Typed OM retains matrix precision and includes stylesheet overrides.
          const transform = source.computedStyleMap?.().get("transform");
          if (transform?.toMatrix && !transform.toString().includes("%")) value = transform.toMatrix().toString();
        }
        if (value && safeCss(value)) primitive.style[property] = value;
      }
      if (root) {
        for (const property of ["width", "height", "max-width", "max-height"]) {
          const value = inlineGeometry(source, property);
          if (value && safeCss(value)) primitive.style[property] = value;
        }
      }
      if (tag === "foreignObject") {
        // Class multiplicities override their measured SVG attributes with CSS sizing.
        for (const property of ["width", "height"]) {
          const value = inlineGeometry(source, property);
          if (value && safeCss(value)) primitive.style[property] = value;
        }
      }
    }
    for (const child of source.childNodes || []) {
      const captured = capture(child, depth + 1);
      if (captured) primitive.children.push(captured);
    }
    return primitive;
  }
  return capture(element, 0, true);
}

function setAttributes(element, attributes = {}) {
  for (const [name, rawValue] of Object.entries(attributes)) {
    const value = Array.isArray(rawValue) ? stringValue(rawValue) : rawValue;
    if (value === undefined || value === null) continue;
    if (name === "href" || name === "xlink:href" || name === "src") {
      const tag = element.localName || element.tagName;
      if (safeUrl(value, tag === "image" || tag === "img" || tag === "feImage")) {
        element.setAttribute(name === "src" ? "src" : "href", String(value));
      }
    } else if (
      (ATTRIBUTES.has(name) || /^(?:aria|data)-[\w-]+$/.test(name)) &&
      (!CSS_PROPERTIES.has(name) || safeCss(value))
    ) {
      element.setAttribute(name, String(value));
    }
  }
}

/** Render a validated shared scene. All SVG is constructed with DOM APIs. */
export function sceneToSvg(scene, {
  document: documentRef = globalThis.document,
  template,
  attributes = {},
  resolveFallback,
} = {}) {
  validateScene(scene);
  template ||= scene.meta?.svgRoot;
  if (!template && scene.nodes.some((node) => node.kind === "group" && node.children.length)) {
    scene = normalizeScene(scene).scene;
  }
  if (!documentRef?.createElementNS) throw new Error("sceneToSvg requires a DOM document");
  const renderId = ++renderSequence;
  const rendered = new Set();
  let primitiveCount = 0;
  function dom(tag, attrs = {}, namespace = SVG_NS) {
    const element = documentRef.createElementNS(namespace, tag);
    setAttributes(element, attrs);
    return element;
  }
  function primitive(value, depth = 0) {
    if (!value || ++primitiveCount > 50000 || depth > 128) throw new Error("Invalid SVG primitive tree");
    if (Number.isInteger(value.sceneNode)) return renderNode(scene.nodes[value.sceneNode], value.sceneNode);
    if (value.text !== undefined && !value.tag) return documentRef.createTextNode(stringValue(value.text));
    const html = value.namespace === "html";
    const math = value.namespace === "math";
    if (!(math ? MATH_TAGS : html ? HTML_TAGS : SVG_TAGS).has(value.tag)) throw new Error(`Unsupported SVG primitive: ${value.tag}`);
    const element = dom(value.tag, value.attributes, math ? MATH_NS : html ? HTML_NS : SVG_NS);
    for (const [property, content] of Object.entries(value.style || {})) {
      if (CSS_PROPERTIES.has(property) && safeCss(content)) element.style?.setProperty(property, String(content));
    }
    if (value.textContent !== undefined) element.textContent = String(value.textContent);
    for (const child of value.children || []) {
      const renderedChild = primitive(child, depth + 1);
      if (renderedChild) element.appendChild(renderedChild);
    }
    return element;
  }
  function paint(style = {}) {
    return {
      fill: style.fill ?? "none", stroke: style.stroke ?? "none",
      "stroke-width": style.strokeWidth ?? 0, opacity: style.opacity ?? 1,
      "stroke-linecap": style.lineCap,
      "stroke-dasharray": { dash: "8 5", dashDot: "8 4 2 4", dot: "2 4" }[style.dash],
    };
  }
  function shape(node) {
    const { x, y, width: w, height: h } = node.bounds;
    const attrs = paint(node.style);
    if (node.preset === "ellipse") return dom("ellipse", { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, ...attrs });
    const presets = {
      diamond: [[.5, 0], [1, .5], [.5, 1], [0, .5]],
      triangle: [[.5, 0], [1, 1], [0, 1]],
      hexagon: [[.25, 0], [.75, 0], [1, .5], [.75, 1], [.25, 1], [0, .5]],
      parallelogram: [[.2, 0], [1, 0], [.8, 1], [0, 1]],
    };
    if (presets[node.preset]) return dom("polygon", {
      points: presets[node.preset].map(([px, py]) => `${x + px * w},${y + py * h}`).join(" "), ...attrs,
    });
    if (node.preset === "cylinder") {
      const r = Math.min(h / 4, w / 8);
      return dom("path", { d: `M ${x} ${y + r} A ${w / 2} ${r} 0 0 1 ${x + w} ${y + r} L ${x + w} ${y + h - r} A ${w / 2} ${r} 0 0 1 ${x} ${y + h - r} Z M ${x} ${y + r} A ${w / 2} ${r} 0 0 0 ${x + w} ${y + r}`, ...attrs });
    }
    if (node.preset && !["rect", "roundedRect"].includes(node.preset)) throw new Error(`Unsupported scene SVG preset: ${node.preset}`);
    return dom("rect", { x, y, width: w, height: h, rx: node.preset === "roundedRect" ? node.style?.cornerRadius ?? 8 : 0, ...attrs });
  }
  function text(parent, content, bounds, layout = {}) {
    if (!content?.paragraphs?.length) return;
    const lines = content.paragraphs.flatMap((paragraph) => {
      const output = [{ ...paragraph, runs: [] }];
      for (const run of paragraph.runs) {
        run.text.split("\n").forEach((part, index) => {
          if (index) output.push({ ...paragraph, runs: [] });
          output.at(-1).runs.push({ ...run, text: part });
        });
      }
      return output;
    });
    const heights = lines.map((line) => Math.max(1, ...line.runs.map((run) => run.fontSize ?? 16)) * 1.2);
    const insets = layout.textInsets || {};
    const availableHeight = bounds.height - (insets.top || 0) - (insets.bottom || 0);
    const total = heights.reduce((a, b) => a + b, 0);
    let y = bounds.y + (insets.top || 0) + (layout.verticalAlignment === "bottom" ? availableHeight - total : layout.verticalAlignment === "middle" ? (availableHeight - total) / 2 : 0);
    lines.forEach((line, index) => {
      const alignment = line.alignment || layout.alignment || "left";
      const left = bounds.x + (insets.left || 0);
      const right = bounds.x + bounds.width - (insets.right || 0);
      const x = alignment === "center" ? (left + right) / 2 : alignment === "right" ? right : left;
      const label = dom("text", { x, y: y + heights[index] / 2, "dominant-baseline": "middle", "text-anchor": alignment === "center" ? "middle" : alignment === "right" ? "end" : "start" });
      for (const run of line.runs) {
        const span = dom("tspan", {
          fill: run.color === null ? "none" : run.color ?? "#000000", "font-size": run.fontSize ?? 16,
          "font-family": run.fontFace, "font-weight": run.fontWeight || (run.bold ? 700 : 400),
          "font-style": run.italic ? "italic" : "normal", opacity: run.opacity,
        });
        span.textContent = run.text;
        label.appendChild(span);
      }
      parent.appendChild(label);
      y += heights[index];
    });
  }
  function renderNode(node, index) {
    if (!node) throw new Error("Unknown SVG scene slot");
    if (rendered.has(index)) throw new Error("Duplicate SVG scene slot");
    rendered.add(index);
    if (node.meta?.svgOwner !== undefined) return null;
    let element;
    if (node.meta?.svg) element = primitive(node.meta.svg);
    else if (node.kind === "fallback") {
      const fallback = resolveFallback?.(node);
      if (!fallback) throw new Error(`SVG fallback unavailable: ${node.sourcePath}: ${node.reason}`);
      element = primitive(fallback);
    } else {
      element = dom("g");
      if (node.kind === "shape" || node.kind === "group") element.appendChild(shape(node));
      if (node.kind === "image") element.appendChild(dom("image", {
        ...node.bounds, href: node.src, opacity: node.opacity,
        preserveAspectRatio: node.fit === "fill" ? "none" : node.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet",
        role: "img", "aria-label": node.alt,
      }));
      if (node.kind === "connector") {
        const attrs = { ...paint(node.style), fill: "none", "stroke-linejoin": "round", "stroke-linecap": node.style?.lineCap ?? "round" };
        const defs = dom("defs");
        for (const [end, arrow] of [["start", node.arrowStart], ["end", node.arrowEnd]]) {
          if (!arrow || arrow === "none") continue;
          const id = `scene-arrow-${renderId}-${index}-${end}`;
          const marker = dom("marker", { id, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse", markerUnits: "strokeWidth" });
          marker.appendChild(arrow === "oval"
            ? dom("circle", { cx: 5, cy: 5, r: 4, fill: node.style?.stroke })
            : dom("path", { d: arrow === "diamond" ? "M 0 5 L 5 0 L 10 5 L 5 10 Z" : arrow === "stealth" ? "M 0 0 L 10 5 L 0 10 L 3 5 Z" : "M 0 0 L 10 5 L 0 10 Z", fill: node.style?.stroke }));
          defs.appendChild(marker);
          attrs[`marker-${end}`] = `url(#${id})`;
        }
        element.appendChild(defs);
        element.appendChild(dom("path", { d: node.points.map((point, i) => `${i ? "L" : "M"} ${point.x} ${point.y}`).join(" "), ...attrs }));
        if (node.label) text(element, node.label.text, node.label.bounds);
      }
      if (node.text) text(element, node.text, node.bounds, node.textLayout);
      if (node.accessibility?.label) setAttributes(element, { role: node.accessibility.role || "img", "aria-label": node.accessibility.label });
    }
    setAttributes(element, { "data-scene-node": node.kind, "data-scene-source-path": node.sourcePath, "data-scene-id": node.id });
    return element;
  }
  let svg;
  if (template) {
    svg = primitive(template);
    for (const [index, node] of scene.nodes.entries()) {
      if (!rendered.has(index) && node.meta?.svgOwner === undefined) throw new Error(`Missing SVG scene slot: ${node.sourcePath}`);
    }
  } else {
    svg = dom("svg", { viewBox: `0 0 ${scene.width} ${scene.height}`, preserveAspectRatio: "xMidYMid meet", role: "img" });
    if (scene.accessibility?.title) {
      const title = dom("title", { id: `scene-title-${renderId}` });
      title.textContent = scene.accessibility.title;
      svg.appendChild(title);
      svg.setAttribute("aria-labelledby", `scene-title-${renderId}`);
    }
    if (scene.accessibility?.description) {
      const description = dom("desc", { id: `scene-description-${renderId}` });
      description.textContent = scene.accessibility.description;
      svg.appendChild(description);
      svg.setAttribute("aria-describedby", `scene-description-${renderId}`);
    }
    [...scene.nodes.entries()].sort((a, b) => a[1].z - b[1].z || a[0] - b[0]).forEach(([index, node]) => {
      const element = renderNode(node, index);
      if (element) svg.appendChild(element);
    });
  }
  if ((svg.localName || svg.tagName) !== "svg" || svg.namespaceURI !== SVG_NS) throw new Error("Scene SVG root must be an SVG element");
  setAttributes(svg, { ...attributes, "data-scene-backend": "svg", "data-scene-source": scene.source.kind });
  Object.defineProperty(svg, "__presentationScene", { value: scene });
  return svg;
}
