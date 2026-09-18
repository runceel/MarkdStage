import { ImageSourceError, checkImageBytes, decodePercentImageData, inspectImageSource } from "./image-source.mjs";

export const ADAPTIVE_CARDS_SDK_VERSION = "3.0.6";
export const ADAPTIVE_CARD_SCHEMA_VERSION = "1.5";
export const ADAPTIVE_CARD_HOST_CONFIG_VERSION = 1;
export const MAX_CARD_JSON_BYTES = 256 * 1024;
export const MAX_CARD_OBJECTS = 256;
export const MAX_CARD_DEPTH = 16;

const STATIC_TYPES = new Set([
  "AdaptiveCard", "TextBlock", "RichTextBlock", "TextRun", "Container", "ColumnSet", "Column",
  "Image", "ImageSet", "FactSet", "Table", "TableRow", "TableCell",
]);
const INTERACTIVE_PROPERTIES = new Set(["actions", "selectAction", "inlineAction", "refresh", "authentication"]);
const COLLECTIONS = new Set(["body", "items", "columns", "images", "inlines", "facts", "rows", "cells"]);
const states = new WeakMap();
let sdkPromise;

export class AdaptiveCardError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = "AdaptiveCardError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, message) {
  throw new AdaptiveCardError(code, path, message);
}

// Deliberately narrower than the SDK: Phase 0 never lets its fallback, actions,
// templating, media, or background-resource mechanisms run.
export function parseAdaptiveCardSource(source) {
  if (typeof source !== "string" || new TextEncoder().encode(source).length > MAX_CARD_JSON_BYTES) {
    fail("card-size-limit", "$", `Card JSON must be at most ${MAX_CARD_JSON_BYTES} UTF-8 bytes.`);
  }
  let card;
  try { card = JSON.parse(source); }
  catch { fail("invalid-json", "$", "Expected fully resolved Adaptive Card JSON."); }
  if (!card || card.type !== "AdaptiveCard" || !Array.isArray(card.body)) {
    fail("invalid-card", "$", "Expected an AdaptiveCard with a body array.");
  }
  if (card.version !== ADAPTIVE_CARD_SCHEMA_VERSION) {
    fail("unsupported-version", "$.version", `The Phase 0 spike accepts schema ${ADAPTIVE_CARD_SCHEMA_VERSION} only.`);
  }
  let objects = 0;
  const visit = (value, path, depth) => {
    if (depth > MAX_CARD_DEPTH) fail("card-depth-limit", path, `Card depth exceeds ${MAX_CARD_DEPTH}.`);
    if (typeof value === "string") {
      if (/\$\{/.test(value)) fail("unresolved-template", path, "Template expressions are not supported.");
      return;
    }
    if (!value || typeof value !== "object") return;
    if (++objects > MAX_CARD_OBJECTS) fail("card-object-limit", path, `Card object count exceeds ${MAX_CARD_OBJECTS}.`);
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }
    if ("type" in value && (!STATIC_TYPES.has(value.type) || (value.type === "AdaptiveCard" && path !== "$"))) {
      fail("unsupported-element", path, "Only the documented static Phase 0 element types are supported.");
    }
    for (const [key, child] of Object.entries(value)) {
      const location = `${path}.${key}`;
      if (INTERACTIVE_PROPERTIES.has(key)) fail("unsupported-interactivity", location, "Cards are non-interactive.");
      if (key === "fallback" || key === "fallbackText") fail("unsupported-fallback", location, "SDK fallback is deferred; the card is not silently degraded.");
      if (key === "requires") fail("unsupported-requires", location, "Host capability negotiation is deferred.");
      if (key.startsWith("$") && key !== "$schema") fail("unresolved-template", location, "Only fully resolved card JSON is accepted.");
      if (key === "backgroundImage") fail("unsupported-resource", location, "Background images are outside the Phase 0 subset.");
      if (COLLECTIONS.has(key) && !Array.isArray(child)) fail("invalid-collection", location, "Expected an array.");
      if (COLLECTIONS.has(key)) {
        child.forEach((item, index) => {
          const itemPath = `${location}[${index}]`;
          if (key === "inlines" && typeof item === "string") return;
          if (!item || typeof item !== "object" || Array.isArray(item)) fail("invalid-element", itemPath, "Expected a typed card object.");
          if (key === "facts") {
            if (typeof item.title !== "string" || typeof item.value !== "string") fail("invalid-fact", itemPath, "Facts require string title and value fields.");
            return;
          }
          if (key === "columns" && value.type === "Table") return;
          const expected = { images: "Image", inlines: "TextRun", rows: "TableRow", cells: "TableCell", columns: "Column" }[key];
          if (!STATIC_TYPES.has(item.type) || (expected && item.type !== expected)) {
            fail("unsupported-element", itemPath, "An explicit supported type is required; implicit SDK elements are not accepted.");
          }
        });
      }
      visit(child, location, depth + 1);
    }
  };
  visit(card, "$", 0);
  return card;
}

export function resolveCardImageUrl(source, baseURI, label = "$.url") {
  if (inspectImageSource(source, label)) return source;
  if (/[\u0000-\u0020\u007f\\?#]/.test(source)) {
    fail("blocked-image", label, "Image references cannot contain controls, queries, fragments, or backslashes.");
  }
  let decoded;
  try { decoded = decodeURIComponent(source); }
  catch { fail("blocked-image", label, "Invalid image URL encoding."); }
  if (/[\\\u0000-\u001f\u007f]/.test(decoded) ||
      /%[0-9a-f]{2}/i.test(decoded) ||
      decoded.split("/").some((part) => part === "." || part === "..") ||
      /%(?:2f|5c)/i.test(source)) {
    fail("blocked-image", label, "Image paths must stay inside the approved assets folder.");
  }
  const base = new URL(".", baseURI);
  const assets = new URL("assets/", base);
  const url = new URL(source.startsWith("/assets/") ? source.slice(1) : source, base);
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== base.origin ||
      url.username || url.password || !url.pathname.startsWith(assets.pathname) ||
      !/\.(png|jpe?g|gif|svg)$/i.test(url.pathname)) {
    fail("blocked-image", label, "Images must be supported data images or same-origin workspace assets; remote images are blocked.");
  }
  return url.href;
}

function dataBytes(image) {
  return image.base64
    ? Uint8Array.from(atob(image.payload), (character) => character.charCodeAt(0))
    : decodePercentImageData(image);
}

function imageDataUrl(bytes, contentType) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}

function checkSvgResources(bytes, documentRef, label) {
  const text = new TextDecoder().decode(bytes);
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(text)) fail("blocked-image", label, "SVG external declarations are not allowed.");
  const svg = new documentRef.defaultView.DOMParser().parseFromString(text, "image/svg+xml");
  if (svg.querySelector("parsererror") || svg.documentElement.localName !== "svg") {
    fail("invalid-image", label, "Invalid SVG image.");
  }
  for (const element of svg.querySelectorAll("*")) {
    if (["script", "foreignObject", "style", "animate", "animateTransform", "set"].includes(element.localName)) {
      fail("blocked-image", label, "SVG scripts, HTML, stylesheets, and animation are not allowed.");
    }
    for (const attribute of element.attributes) {
      if (/^on/i.test(attribute.name) ||
          (attribute.localName === "href" && !attribute.value.startsWith("#")) ||
          /\\|@import|url\s*\(/i.test(attribute.value.replace(/url\s*\(\s*['"]?#[-\w]+\s*['"]?\s*\)/gi, ""))) {
        fail("blocked-image", label, "SVG images cannot reference external resources.");
      }
    }
  }
}

function checkImageContent(bytes, contentType, documentRef, label) {
  if (contentType === "image/svg+xml") return checkSvgResources(bytes, documentRef, label);
  const signatures = {
    "image/png": [[137, 80, 78, 71, 13, 10, 26, 10]],
    "image/jpeg": [[255, 216, 255]],
    "image/gif": [[71, 73, 70, 56, 55, 97], [71, 73, 70, 56, 57, 97]],
  };
  if (!signatures[contentType]?.some((signature) => signature.every((byte, index) => bytes[index] === byte))) {
    fail("invalid-image", label, "Image bytes do not match their approved content type.");
  }
}

async function prepareCardImages(card, documentRef) {
  const sources = new Map();
  let total = 0;
  const load = async (source, label) => {
    const url = resolveCardImageUrl(source, documentRef.baseURI, label);
    if (sources.has(url)) return sources.get(url);
    let bytes, contentType;
    const data = inspectImageSource(url, label);
    if (data) {
      checkImageBytes(data.byteLength, label, total);
      bytes = dataBytes(data);
      contentType = data.contentType;
    } else {
      let response;
      try {
        response = await fetch(url, { redirect: "error", credentials: "same-origin", signal: AbortSignal.timeout(10_000) });
      } catch {
        fail("image-load-failed", label, "Workspace image request failed; redirects and remote images are not allowed.");
      }
      if (!response.ok) fail("image-load-failed", label, `Workspace image returned HTTP ${response.status}.`);
      contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
      if (!["image/png", "image/jpeg", "image/gif", "image/svg+xml"].includes(contentType)) {
        fail("invalid-image", label, "Workspace image has an unsupported content type.");
      }
      const reader = response.body.getReader(), chunks = [];
      let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          checkImageBytes(length, label, total);
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    }
    checkImageContent(bytes, contentType, documentRef, label);
    checkImageBytes(bytes.length, label, total);
    total += bytes.length;
    const prepared = imageDataUrl(bytes, contentType);
    sources.set(url, prepared);
    return prepared;
  };
  // Validate every URL before even the first approved resource is fetched.
  const images = [];
  const visit = (value, path) => {
    if (!value || typeof value !== "object") return;
    if (value.type === "Image") {
      resolveCardImageUrl(value.url, documentRef.baseURI, `${path}.url`);
      images.push([value, `${path}.url`]);
    }
    for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`);
  };
  visit(card, "$");
  for (const [image, label] of images) image.url = await load(image.url, label);
  return new Set(sources.values());
}

function loadSdk(documentRef) {
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const script = documentRef.createElement("script");
      script.src = new URL("../vendor/adaptivecards.min.js", import.meta.url).href;
      script.onload = () => {
        const sdk = documentRef.defaultView.AdaptiveCards;
        if (!sdk?.AdaptiveCard || !sdk.Table) reject(new Error("The pinned Adaptive Cards SDK is unavailable."));
        else resolve(sdk);
      };
      script.onerror = () => reject(new Error("The pinned Adaptive Cards SDK could not be loaded."));
      documentRef.head.appendChild(script);
    });
  }
  return sdkPromise;
}

export function createAdaptiveCardHostConfig(SDK, palette) {
  const colors = Object.fromEntries(["default", "dark", "light", "accent", "good", "warning", "attention"]
    .map((name) => [name, {
      default: name === "accent" ? palette.accent : palette.fg, subtle: palette.muted,
      highlightColors: { default: palette.border, subtle: palette.border },
    }]));
  const font = {
    fontFamily: palette.fontFamily,
    fontSizes: { small: 16, default: 20, medium: 24, large: 28, extraLarge: 32 },
    fontWeights: { lighter: 300, default: 400, bolder: 600 },
  };
  return new SDK.HostConfig({
    supportsInteractivity: false,
    fontTypes: { default: font, monospace: { ...font, fontFamily: "Consolas, monospace" } },
    lineHeights: { small: 20, default: 26, medium: 31, large: 36, extraLarge: 42 },
    spacing: { small: 4, default: 10, medium: 16, large: 22, extraLarge: 28, padding: 16 },
    separator: { lineThickness: 1, lineColor: palette.border },
    containerStyles: {
      default: { backgroundColor: "#00000000", foregroundColors: colors, borderColor: palette.border },
      emphasis: { backgroundColor: palette.surface, foregroundColors: colors, borderColor: palette.border },
    },
    adaptiveCard: { allowCustomStyle: true },
    imageSizes: { small: 48, medium: 96, large: 144 },
    imageSet: { imageSize: SDK.Size.Small, maxImageHeight: 96 },
    factSet: {
      title: { size: "Default", weight: "Bolder", wrap: true, maxWidth: 180 },
      value: { size: "Default", wrap: true }, spacing: 12,
    },
    table: { cellSpacing: 10 },
    actions: { maxActions: 0 },
    media: { allowInlinePlayback: false },
  });
}

function typedObjects(card, SDK) {
  const objects = [];
  const visit = (object, sourcePath, parentPath) => {
    objects.push({ object, sourcePath, parentPath });
    if (object instanceof SDK.RichTextBlock) {
      for (let index = 0; index < object.getInlineCount(); index++) {
        visit(object.getInlineAt(index), `${sourcePath}.inlines[${index}]`, sourcePath);
      }
    } else if (object instanceof SDK.CardElementContainer) {
      const collection = object instanceof SDK.AdaptiveCard ? "body"
        : object instanceof SDK.ColumnSet ? "columns" : object instanceof SDK.ImageSet ? "images"
          : object instanceof SDK.Table ? "rows" : object instanceof SDK.TableRow ? "cells" : "items";
      for (let index = 0; index < object.getItemCount(); index++) {
        visit(object.getItemAt(index), `${sourcePath}.${collection}[${index}]`, sourcePath);
      }
    } else if (object instanceof SDK.FactSet) {
      object.facts.forEach((fact, index) => visit(fact, `${sourcePath}.facts[${index}]`, sourcePath));
    }
  };
  visit(card, "$", null);
  return objects;
}

function cardMarkdown(text, result, documentRef, diagnostics) {
  const { marked, DOMPurify } = documentRef.defaultView;
  result.outputHtml = DOMPurify.sanitize(marked.parse(text), {
    ALLOWED_TAGS: ["p", "br", "strong", "b", "em", "i", "u", "s", "code", "ol", "ul", "li", "a"],
    ALLOWED_ATTR: [],
  });
  // DOMPurify records its synthetic BODY wrapper when a fragment allowlist
  // omits BODY. That is not a degradation of authored card Markdown.
  if (DOMPurify.removed.some(({ element, attribute }) => attribute || (element && element.tagName !== "BODY"))) {
    diagnostics.push({ code: "markdown-sanitized", path: "$", message: "Unsafe markup, resource tags, and link attributes were removed; card Markdown is non-interactive." });
  }
  result.didProcess = true;
}

function shadowContent(host) {
  const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
  const style = host.ownerDocument.createElement("style");
  style.textContent = "*{box-sizing:border-box}p{margin:0}strong,b{font-weight:600}code{font-family:Consolas,monospace;font-size:1em}a{color:inherit;text-decoration:underline;pointer-events:none}";
  shadow.replaceChildren(style);
  return shadow;
}

export async function renderAdaptiveCard(host, source, palette) {
  const documentRef = host.ownerDocument;
  const state = { status: "loading", diagnostics: [], card: null, SDK: null, approvedImages: new Set() };
  states.set(host, state);
  try {
    const json = parseAdaptiveCardSource(source);
    state.approvedImages = await prepareCardImages(json, documentRef);
    const SDK = await loadSdk(documentRef);
    state.SDK = SDK;
    const card = new SDK.AdaptiveCard();
    card.hostConfig = createAdaptiveCardHostConfig(SDK, palette);
    const context = new SDK.SerializationContext(SDK.Versions.v1_5);
    card.parse(json, context);
    const events = [
      ...Array.from({ length: context.eventCount }, (_, index) => context.getEventAt(index)),
      ...card.validateProperties().validationEvents,
    ];
    if (events.length) fail("invalid-schema", "$", events.map((event) => event.message).join("; ").slice(0, 500));
    if (card.shouldFallback()) fail("unsupported-fallback", "$", "The SDK requested fallback.");
    const shadow = shadowContent(host);
    const previousMarkdown = SDK.AdaptiveCard.onProcessMarkdown;
    let rendered;
    try {
      SDK.AdaptiveCard.onProcessMarkdown = (text, result) => cardMarkdown(text, result, documentRef, state.diagnostics);
      rendered = card.render();
    } finally {
      SDK.AdaptiveCard.onProcessMarkdown = previousMarkdown;
    }
    if (!rendered) fail("empty-card", "$", "The SDK did not produce card artwork.");
    const font = card.hostConfig.getFontTypeDefinition();
    rendered.style.fontFamily = font.fontFamily;
    rendered.style.fontSize = `${font.fontSizes.default}px`;
    rendered.style.lineHeight = `${card.hostConfig.lineHeights.default}px`;
    shadow.appendChild(rendered);
    state.card = card;
    for (const { object, sourcePath } of typedObjects(card, SDK)) {
      if (object instanceof SDK.Image) {
        if (!state.approvedImages.has(object.url)) fail("blocked-image", sourcePath, "The SDK introduced an unapproved image.");
        const image = object.renderedImageElement;
        if (!image || typeof image.decode !== "function") fail("image-load-failed", sourcePath, "The SDK image has no measurable image element.");
        await image.decode();
      }
      if (object instanceof SDK.CardElement && object.isVisible && !object.renderedElement) {
        fail("geometry-unavailable", sourcePath, "A visible SDK object has no renderedElement.");
      }
    }
    state.status = "ready";
  } catch (error) {
    state.status = "error";
    state.card = null;
    state.diagnostics.push({
      code: error instanceof AdaptiveCardError ? error.code : error instanceof ImageSourceError ? "blocked-image" : "card-render-failed",
      path: error.path || "$",
      message: error.message || "The card could not be rendered.",
    });
    const shadow = shadowContent(host);
    const message = documentRef.createElement("div");
    message.setAttribute("role", "alert");
    message.textContent = `Adaptive Card spike: ${state.diagnostics.at(-1).code} - ${state.diagnostics.at(-1).message}`;
    shadow.appendChild(message);
    console.error("Adaptive Card:", state.diagnostics.at(-1));
  }
  host.dataset.adaptiveCardState = state.status;
}

export function getAdaptiveCardModel(host) {
  return states.get(host)?.card ?? null;
}

export function assertAdaptiveCardCaptureSafe(host) {
  const state = states.get(host);
  if (!state || !["ready", "error"].includes(state.status)) fail("card-not-ready", "$", "Card rendering has not completed.");
  if (!state.card) return;
  for (const { object, sourcePath } of typedObjects(state.card, state.SDK)) {
    if (object instanceof state.SDK.Image &&
        (!state.approvedImages.has(object.url) ||
         object.renderedImageElement?.getAttribute("src") !== object.url)) {
      fail("blocked-image", sourcePath, "Card image changed after approval; capture is blocked.");
    }
  }
}

function styleFacts(object, SDK) {
  if (!(object instanceof SDK.CardElement)) return {};
  const config = object.hostConfig;
  const style = {
    container: object.getEffectiveStyle(),
    background: object.getEffectiveStyleDefinition().backgroundColor,
    spacing: config.getEffectiveSpacing(object.spacing),
    padding: config.paddingDefinitionToSpacingDefinition(object.getEffectivePadding()),
    horizontalAlignment: SDK.HorizontalAlignment[object.getEffectiveHorizontalAlignment()],
    ...(object.separator ? { separator: { ...config.separator } } : {}),
  };
  if (object instanceof SDK.BaseTextBlock) {
    const key = (name) => name[0].toLowerCase() + name.slice(1);
    const font = config.getFontTypeDefinition(object.effectiveFontType);
    const size = key(SDK.TextSize[object.effectiveSize]);
    const color = object.getEffectiveStyleDefinition().foregroundColors[key(SDK.TextColor[object.effectiveColor])];
    Object.assign(style, {
      fontFamily: font.fontFamily, fontSize: font.fontSizes[size],
      fontWeight: font.fontWeights[key(SDK.TextWeight[object.effectiveWeight])],
      color: object.effectiveIsSubtle ? color.subtle : color.default,
      lineHeight: config.lineHeights[object instanceof SDK.TextBlock ? size : "default"],
      ...(object instanceof SDK.TextBlock ? { wrap: object.wrap, maxLines: object.maxLines } : {
        italic: object.italic, strikethrough: object.strikethrough,
        underline: object.underline, highlight: object.highlight,
        ...(object.highlight ? { highlightColor: object.effectiveIsSubtle ? color.highlightColors.subtle : color.highlightColors.default } : {}),
      }),
    });
  }
  if (object instanceof SDK.Column) style.width = typeof object.width === "object"
    ? { value: object.width.physicalSize, unit: SDK.SizeUnit[object.width.unit] } : object.width;
  if (object instanceof SDK.Image) Object.assign(style, {
    imageSize: SDK.Size[object.size], imageStyle: SDK.ImageStyle[object.style],
    pixelWidth: object.pixelWidth, pixelHeight: object.pixelHeight,
  });
  if (object instanceof SDK.Table) Object.assign(style, {
    gridStyle: object.gridStyle, showGridLines: object.showGridLines, firstRowAsHeaders: object.firstRowAsHeaders,
    columns: Array.from({ length: object.getColumnCount() }, (_, index) => {
      const column = object.getColumnAt(index);
      return { width: column.width.physicalSize, unit: SDK.SizeUnit[column.width.unit] };
    }),
  });
  if (object instanceof SDK.FactSet) style.facts = config.factSet;
  // Export values, not SDK prototypes or undefined properties: CDP and the
  // native JSON bridge must observe the same diagnostic snapshot.
  return JSON.parse(JSON.stringify(style));
}

export function collectAdaptiveCardGeometry(host, deck) {
  const state = states.get(host);
  if (!state) fail("card-not-ready", "$", "No card is associated with this host.");
  const origin = deck.getBoundingClientRect();
  const scaleX = origin.width / deck.offsetWidth, scaleY = origin.height / deck.offsetHeight;
  const round = (value) => Math.round(value * 1000) / 1000;
  const rect = (box) => ({
    x: round((box.x - origin.x) / scaleX), y: round((box.y - origin.y) / scaleY),
    width: round(box.width / scaleX), height: round(box.height / scaleY),
  });
  const objects = state.card ? typedObjects(state.card, state.SDK).map(({ object, sourcePath, parentPath }) => {
    const fact = object instanceof state.SDK.Fact;
    const element = object.renderedElement;
    const textRects = [];
    if (element && (object instanceof state.SDK.BaseTextBlock || object instanceof state.SDK.RichTextBlock)) {
      // DOM text nodes and Range rectangles measure line layout, never semantic identity or style.
      const walker = host.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        const range = host.ownerDocument.createRange();
        range.selectNodeContents(text);
        for (const box of range.getClientRects()) if (box.width && box.height) textRects.push(rect(box));
      }
    }
    return {
      type: fact ? "Fact" : object.getJsonTypeName(), id: object.id ?? null, sourcePath, parentPath,
      geometry: fact ? "aggregate-only" : object.isVisible ? "renderedElement" : "hidden",
      bounds: element ? rect(element.getBoundingClientRect()) : null,
      ...(object.separator && object.hasVisibleSeparator && object.separatorElement?.isConnected
        ? { separatorBounds: rect(object.separatorElement.getBoundingClientRect()) } : {}),
      ...(fact ? { title: object.name, value: object.value } : {}),
      ...(object instanceof state.SDK.BaseTextBlock ? { text: object.text } : {}),
      textRects, style: styleFacts(object, state.SDK),
    };
  }) : [];
  return {
    version: 1, sdkVersion: ADAPTIVE_CARDS_SDK_VERSION, schemaVersion: ADAPTIVE_CARD_SCHEMA_VERSION,
    hostConfigVersion: ADAPTIVE_CARD_HOST_CONFIG_VERSION, status: state.status,
    diagnostics: state.diagnostics, bounds: rect(host.getBoundingClientRect()), objects,
  };
}
