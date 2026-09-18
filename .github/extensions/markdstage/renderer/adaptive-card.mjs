import { checkImageBytes, decodePercentImageData, inspectImageSource } from "./image-source.mjs";
import {
  ADAPTIVE_CARDS_SDK_VERSION, ADAPTIVE_CARD_SCHEMA_VERSION, ADAPTIVE_CARD_HOST_CONFIG_VERSION,
  AdaptiveCardError, validateAdaptiveCardSource, resolveCardImageUrl,
  cardDiagnostic, cardErrorDiagnostic, addCardDiagnostic,
} from "./adaptive-card-validation.mjs";
export {
  ADAPTIVE_CARDS_SDK_VERSION, ADAPTIVE_CARD_SCHEMA_VERSION, ADAPTIVE_CARD_HOST_CONFIG_VERSION,
  AdaptiveCardError, MAX_CARD_JSON_BYTES, MAX_CARD_OBJECTS, MAX_CARD_DEPTH,
  parseAdaptiveCardSource, resolveCardImageUrl,
} from "./adaptive-card-validation.mjs";

const states = new WeakMap();
let sdkPromise;
const PLACEHOLDER_IMAGE = "data:image/svg+xml;base64," + btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80" viewBox="0 0 160 80">' +
  '<rect x="1" y="1" width="158" height="78" rx="4" fill="#eeeeee" stroke="#777777"/>' +
  '<path d="M69 14h22v22H69zM71 33l6-7 4 4 4-5 4 8" fill="none" stroke="#555555" stroke-width="2"/>' +
  '<text x="80" y="58" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#333333">Image unavailable</text></svg>',
);

function fail(code, path, message) {
  throw new AdaptiveCardError(code, path, message);
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
  if (svg.querySelector("parsererror") || svg.documentElement.localName !== "svg" ||
      svg.documentElement.namespaceURI !== "http://www.w3.org/2000/svg") {
    fail("invalid-image", label, "Invalid SVG image.");
  }
  for (const element of svg.querySelectorAll("*")) {
    if (element.namespaceURI !== "http://www.w3.org/2000/svg" ||
        ["script", "foreignObject", "style", "animate", "animateColor", "animateMotion", "animateTransform", "set", "discard"].includes(element.localName)) {
      fail("blocked-image", label, "SVG scripts, HTML, stylesheets, and animation are not allowed.");
    }
    for (const attribute of element.attributes) {
      if (/^on/i.test(attribute.name) ||
          (attribute.localName === "href" && !attribute.value.startsWith("#")) ||
          (attribute.localName === "style" && /animation|transition/i.test(attribute.value)) ||
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
  if (contentType === "image/png") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset);
      if (length > bytes.length - offset - 12) fail("invalid-image", label, "Invalid PNG chunk length.");
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (["acTL", "fcTL", "fdAT"].includes(type)) fail("blocked-image", label, "Animated PNG images are not allowed.");
      offset += length + 12;
    }
  }
  if (contentType === "image/gif") {
    let offset = 13, frames = 0;
    if (bytes[10] & 0x80) offset += 3 * (1 << ((bytes[10] & 7) + 1));
    const skipBlocks = () => {
      while (offset < bytes.length) {
        const size = bytes[offset++];
        if (!size) return;
        offset += size;
      }
      fail("invalid-image", label, "Invalid GIF block length.");
    };
    while (offset < bytes.length) {
      const marker = bytes[offset++];
      if (marker === 0x3b) break;
      if (marker === 0x21) { offset++; skipBlocks(); }
      else if (marker === 0x2c) {
        if (++frames > 1) fail("blocked-image", label, "Animated GIF images are not allowed.");
        const packed = bytes[offset + 8];
        offset += 9 + ((packed & 0x80) ? 3 * (1 << ((packed & 7) + 1)) : 0);
        offset++;
        skipBlocks();
      } else fail("invalid-image", label, "Invalid GIF block.");
    }
  }
}

export function createAdaptiveCardResourceContext() {
  return { images: new Map(), totalBytes: 0 };
}

async function prepareCardImages(card, documentRef, state, resources) {
  const load = async (url, label) => {
    if (resources.images.has(url)) {
      const cached = resources.images.get(url);
      if (cached.error) throw new AdaptiveCardError(cached.error.code, label, cached.error.message);
      return cached.image;
    }
    let bytes, contentType;
    const data = inspectImageSource(url, label);
    if (data) {
      checkImageBytes(data.byteLength, label, resources.totalBytes);
      bytes = dataBytes(data);
      resources.totalBytes += bytes.length;
      contentType = data.contentType;
    } else {
      checkImageBytes(1, label, resources.totalBytes);
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
      const previousBytes = resources.totalBytes;
      let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          checkImageBytes(length, label, previousBytes);
          resources.totalBytes += value.length;
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
    const prepared = imageDataUrl(bytes, contentType);
    const probe = new documentRef.defaultView.Image();
    probe.src = prepared;
    try { await probe.decode(); }
    catch { fail("image-load-failed", label, "The approved image bytes could not be decoded."); }
    if (!probe.naturalWidth || !probe.naturalHeight) fail("invalid-image", label, "The image has no visible dimensions.");
    resources.images.set(url, { image: prepared });
    return prepared;
  };
  const images = [];
  const visit = (value, path) => {
    if (!value || typeof value !== "object") return;
    if (value.type === "Image") {
      const label = `${state.sourcePaths.get(path) || path}.url`;
      try { images.push({ image: value, label, url: resolveCardImageUrl(value.url, documentRef.baseURI, label) }); }
      catch (error) { images.push({ image: value, label, error }); }
    }
    for (const [key, child] of Object.entries(value)) {
      if (Array.isArray(child)) child.forEach((item, index) => visit(item, `${path}.${key}[${index}]`));
    }
  };
  visit(card, "$");
  const approved = new Set();
  // Approve all references before fetching. An individual failure never hides
  // the rest of the card or gives an authored fallback a second resource path.
  for (const { image, label, url, error: preflightError } of images) {
    try {
      if (preflightError) throw preflightError;
      image.url = await load(url, label);
    } catch (error) {
      const diagnostic = cardErrorDiagnostic(error, label, "warning");
      diagnostic.message = `${diagnostic.message} A static image placeholder is shown.`.slice(0, 512);
      addCardDiagnostic(state.diagnostics, diagnostic);
      if (url) resources.images.set(url, { error: diagnostic });
      image.url = PLACEHOLDER_IMAGE;
      image.altText = "Image unavailable";
    }
    approved.add(image.url);
  }
  return approved;
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

function typedObjects(card, SDK, sourcePaths = new Map()) {
  const objects = [];
  const visit = (object, path, parent) => {
    objects.push({ object, sourcePath: sourcePaths.get(path) || path,
      parentPath: parent === null ? null : sourcePaths.get(parent) || parent });
    if (object instanceof SDK.RichTextBlock) {
      for (let index = 0; index < object.getInlineCount(); index++) {
        visit(object.getInlineAt(index), `${path}.inlines[${index}]`, path);
      }
    } else if (object instanceof SDK.CardElementContainer) {
      const collection = object instanceof SDK.AdaptiveCard ? "body"
        : object instanceof SDK.ColumnSet ? "columns" : object instanceof SDK.ImageSet ? "images"
          : object instanceof SDK.Table ? "rows" : object instanceof SDK.TableRow ? "cells" : "items";
      for (let index = 0; index < object.getItemCount(); index++) {
        visit(object.getItemAt(index), `${path}.${collection}[${index}]`, path);
      }
    } else if (object instanceof SDK.FactSet) {
      object.facts.forEach((fact, index) => visit(fact, `${path}.facts[${index}]`, path));
    }
  };
  visit(card, "$", null);
  return objects;
}

function cardMarkdown(text, result, documentRef, diagnostics, paths) {
  const { marked, DOMPurify } = documentRef.defaultView;
  result.outputHtml = DOMPurify.sanitize(marked.parse(text), {
    ALLOWED_TAGS: ["p", "br", "strong", "b", "em", "i", "u", "s", "code", "ol", "ul", "li", "a"],
    ALLOWED_ATTR: [],
  });
  // DOMPurify records its synthetic BODY wrapper when a fragment allowlist
  // omits BODY. That is not a degradation of authored card Markdown.
  if (DOMPurify.removed.some(({ element, attribute }) => attribute || (element && element.tagName !== "BODY"))) {
    for (const path of paths.get(text) || ["$"]) addCardDiagnostic(diagnostics, cardDiagnostic(
      "markdown-sanitized", path, "Unsafe markup, resource tags, and link attributes were removed; card Markdown is non-interactive.",
    ));
  }
  result.didProcess = true;
}

function shadowContent(host) {
  const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
  const style = host.ownerDocument.createElement("style");
  style.textContent = "*{box-sizing:border-box}p{margin:0}strong,b{font-weight:600}code{font-family:Consolas,monospace;font-size:1em}a{color:inherit;text-decoration:underline;pointer-events:none}.card-diagnostics{font-size:14px;line-height:20px;margin-top:10px;padding:8px;border:1px solid currentColor;overflow-wrap:anywhere}";
  shadow.replaceChildren(style);
  return shadow;
}

function sanitizeCardSubtree(rendered, documentRef, state) {
  const purifier = documentRef.defaultView.DOMPurify;
  purifier.sanitize(rendered, {
    IN_PLACE: true,
    ALLOWED_TAGS: ["div", "span", "p", "br", "strong", "b", "em", "i", "u", "s", "strike", "code",
      "ol", "ul", "li", "a", "img", "table", "thead", "tbody", "tr", "th", "td"],
    ALLOWED_ATTR: ["class", "style", "role", "src", "alt", "title", "width", "height", "lang", "dir", "colspan", "rowspan", "scope"],
    ALLOW_ARIA_ATTR: true, ALLOW_DATA_ATTR: false,
  });
  // Identity stays on typed objects, not DOM ids. Removing ids and the SDK's
  // root tab stop is intentional isolation, not lost presentation content.
  let changed = purifier.removed.some(({ element, attribute }) =>
    element || !["tabindex", "id"].includes(attribute?.name));
  for (const element of [rendered, ...rendered.querySelectorAll("*")]) {
    if (element.hasAttribute("src") && (element.localName !== "img" || !state.approvedImages.has(element.getAttribute("src")))) {
      fail("blocked-image", "$", "The SDK subtree contains an unapproved resource.");
    }
    for (const name of [...element.style]) {
      if (/animation|transition/i.test(name) || /\\|url\s*\(|@import/i.test(element.style.getPropertyValue(name))) {
        element.style.removeProperty(name);
        changed = true;
      }
    }
  }
  if (changed) addCardDiagnostic(state.diagnostics, cardDiagnostic(
    "sdk-subtree-sanitized", "$", "Unsafe or interactive SDK markup was removed before the card was attached.",
  ));
}

function showCardDiagnostics(shadow, documentRef, diagnostics, fatal = false) {
  if (!diagnostics.length) return;
  const message = documentRef.createElement("div");
  message.className = "card-diagnostics";
  message.setAttribute("role", fatal ? "alert" : "note");
  const visible = fatal
    ? [...diagnostics.filter((entry) => entry.severity === "error"), ...diagnostics.filter((entry) => entry.severity !== "error")]
    : diagnostics;
  message.textContent = `Adaptive Card${fatal ? " error" : ""}: ${visible.slice(0, 3).map((entry) =>
    `${entry.code} (${entry.path}) - ${entry.message}`).join(" ")}${diagnostics.length > 3
    ? ` +${diagnostics.length - 3} more; inspect the card diagnostics.` : ""}`;
  shadow.appendChild(message);
}

export async function renderAdaptiveCard(host, source, palette, resources = createAdaptiveCardResourceContext()) {
  const documentRef = host.ownerDocument;
  const state = { status: "loading", diagnostics: [], card: null, SDK: null, approvedImages: new Set(), sourcePaths: new Map() };
  states.set(host, state);
  host.dataset.adaptiveCardState = "loading";
  try {
    if (host.__adaptiveCardFenceClosed === false) {
      fail("unclosed-adaptive-card-fence", "$", "The adaptive-card fence is not closed. Add the matching closing fence.");
    }
    const validated = validateAdaptiveCardSource(source, { baseURI: documentRef.baseURI });
    state.diagnostics = validated.diagnostics;
    state.sourcePaths = validated.sourcePaths;
    if (!validated.valid) {
      const error = state.diagnostics.find((entry) => entry.severity === "error");
      fail(error.code, error.path, error.message);
    }
    const json = validated.card;
    state.approvedImages = await prepareCardImages(json, documentRef, state, resources);
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
    for (const event of events) addCardDiagnostic(state.diagnostics, cardDiagnostic(
      "sdk-parse-warning", "$", String(event.message || "The SDK reported a schema warning."),
    ));
    if (events.length) fail("invalid-schema", "$", "The pinned SDK rejected a property after static validation; the card is not silently changed.");
    if (card.shouldFallback()) fail("unsupported-fallback", "$", "Unexpected SDK fallback is not allowed after static capability resolution.");
    const shadow = shadowContent(host);
    const objects = typedObjects(card, SDK, state.sourcePaths);
    const markdownPaths = new Map();
    for (const { object, sourcePath } of objects) {
      const texts = object instanceof SDK.TextBlock ? [[object.text, `${sourcePath}.text`]]
        : object instanceof SDK.Fact ? [[object.name, `${sourcePath}.title`], [object.value, `${sourcePath}.value`]] : [];
      for (const [text, path] of texts) markdownPaths.set(text, [...markdownPaths.get(text) || [], path]);
    }
    const previousMarkdown = SDK.AdaptiveCard.onProcessMarkdown;
    let rendered;
    try {
      SDK.AdaptiveCard.onProcessMarkdown = (text, result) => cardMarkdown(text, result, documentRef, state.diagnostics, markdownPaths);
      rendered = card.render();
    } finally {
      SDK.AdaptiveCard.onProcessMarkdown = previousMarkdown;
    }
    if (!rendered) fail("empty-card", "$", "The SDK did not produce card artwork.");
    const font = card.hostConfig.getFontTypeDefinition();
    rendered.style.fontFamily = font.fontFamily;
    rendered.style.fontSize = `${font.fontSizes.default}px`;
    rendered.style.lineHeight = `${card.hostConfig.lineHeights.default}px`;
    sanitizeCardSubtree(rendered, documentRef, state);
    shadow.appendChild(rendered);
    state.card = card;
    for (const { object, sourcePath } of objects) {
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
    showCardDiagnostics(shadow, documentRef, state.diagnostics);
    // Cards introduce fonts after the slide's first fonts.ready. Force layout
    // before waiting again, including monospace and diagnostic/placeholder text.
    host.getBoundingClientRect();
    if (documentRef.fonts?.ready) await documentRef.fonts.ready;
    state.status = "ready";
  } catch (error) {
    state.status = "error";
    state.card = null;
    addCardDiagnostic(state.diagnostics, cardErrorDiagnostic(error));
    const shadow = shadowContent(host);
    showCardDiagnostics(shadow, documentRef, state.diagnostics, true);
    host.getBoundingClientRect();
    if (documentRef.fonts?.ready) await documentRef.fonts.ready;
    console.error("Adaptive Card:", state.diagnostics.at(-1));
  }
  host.dataset.adaptiveCardState = state.status;
}

export function getAdaptiveCardModel(host) {
  return states.get(host)?.card ?? null;
}

export function getAdaptiveCardDiagnostics(host) {
  const state = states.get(host);
  if (!state) return null;
  const blockIndex = Number(host.dataset.adaptiveCardBlock);
  return {
    blockIndex, status: state.status, sdkVersion: ADAPTIVE_CARDS_SDK_VERSION,
    schemaVersion: ADAPTIVE_CARD_SCHEMA_VERSION, hostConfigVersion: ADAPTIVE_CARD_HOST_CONFIG_VERSION,
    diagnostics: state.diagnostics.map((entry) => ({
      ...entry, sourcePath: `adaptive-card[${blockIndex}]${entry.path}`,
    })),
  };
}

export function assertAdaptiveCardCaptureSafe(host) {
  const state = states.get(host);
  if (!state || !["ready", "error"].includes(state.status)) fail("card-not-ready", "$", "Card rendering has not completed.");
  if (!state.card) return;
  for (const { object, sourcePath } of typedObjects(state.card, state.SDK, state.sourcePaths)) {
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
  const objects = state.card ? typedObjects(state.card, state.SDK, state.sourcePaths).map(({ object, sourcePath, parentPath }) => {
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
