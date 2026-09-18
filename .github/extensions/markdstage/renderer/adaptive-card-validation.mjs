import { ImageSourceError, inspectImageSource } from "./image-source.mjs";

export const ADAPTIVE_CARDS_SDK_VERSION = "3.0.6";
export const ADAPTIVE_CARD_SCHEMA_VERSION = "1.5";
export const ADAPTIVE_CARD_HOST_CONFIG_VERSION = 1;
export const MAX_CARD_JSON_BYTES = 256 * 1024;
export const MAX_CARD_OBJECTS = 256;
export const MAX_CARD_DEPTH = 16;
export const MAX_CARD_DIAGNOSTICS = 100;

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

export function cardDiagnostic(code, path, message, severity = "warning") {
  const bounded = (value) => value.replace(/[\u0000-\u001f\u007f]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`).slice(0, 512);
  return { category: "adaptive-card", code, severity, path: bounded(path),
    message: bounded(message), impact: "content" };
}

export function addCardDiagnostic(diagnostics, diagnostic) {
  if (diagnostics.some((entry) => entry.code === diagnostic.code && entry.path === diagnostic.path)) return;
  if (diagnostics.length < MAX_CARD_DIAGNOSTICS - 1) diagnostics.push(diagnostic);
  else if (diagnostics.length < MAX_CARD_DIAGNOSTICS) diagnostics.push(cardDiagnostic(
    "diagnostics-truncated", "$", "Card diagnostics reached the reporting limit; simplify the card before treating validation as complete.", "error",
  ));
}

export function cardErrorDiagnostic(error, path = "$", severity = "error") {
  return cardDiagnostic(
    error instanceof AdaptiveCardError ? error.code : error instanceof ImageSourceError ? "blocked-image" : "card-render-failed",
    typeof error?.path === "string" ? error.path : path,
    typeof error?.message === "string" ? error.message : "The card could not be rendered.", severity,
  );
}

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value) => typeof value === "string";
const boolean = (value) => typeof value === "boolean";
const positive = (value) => Number.isFinite(value) && value > 0;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const pixels = (value) => typeof value === "string" && /^(?:0|[1-9]\d*)px$/.test(value) && parseInt(value, 10) <= 100_000;
const enumeration = (...values) => (value) => string(value) && values.includes(value.toLowerCase());
const horizontal = enumeration("left", "center", "right");
const vertical = enumeration("top", "center", "bottom");
const containerStyle = enumeration("default", "emphasis");
const textProperties = {
  text: string, size: enumeration("small", "default", "medium", "large", "extralarge"),
  weight: enumeration("lighter", "default", "bolder"),
  color: enumeration("default", "dark", "light", "accent", "good", "warning", "attention"),
  isSubtle: boolean, fontType: enumeration("default", "monospace"),
};
const common = {
  type: string, id: string, isVisible: boolean, separator: boolean,
  spacing: enumeration("none", "small", "default", "medium", "large", "extralarge", "padding"),
  height: enumeration("auto", "stretch"),
};
const container = {
  style: containerStyle, verticalContentAlignment: vertical, bleed: boolean, minHeight: pixels, rtl: boolean,
};
const SCHEMA = {
  AdaptiveCard: { ...common, ...container, version: (value) => value === ADAPTIVE_CARD_SCHEMA_VERSION,
    $schema: string, lang: (value) => string(value) && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(value) },
  TextBlock: { ...common, ...textProperties, wrap: boolean, maxLines: integer,
    horizontalAlignment: horizontal, style: enumeration("default", "heading") },
  RichTextBlock: { ...common, horizontalAlignment: horizontal },
  TextRun: { type: string, id: string, ...textProperties, italic: boolean, strikethrough: boolean,
    underline: boolean, highlight: boolean },
  Container: { ...common, ...container },
  ColumnSet: { ...common, style: containerStyle, bleed: boolean, horizontalAlignment: horizontal, minHeight: pixels },
  Column: { ...common, ...container, width: (value) => positive(value) || pixels(value) || enumeration("auto", "stretch")(value) },
  Image: { ...common, url: (value) => string(value) && value.length > 0, altText: string,
    width: pixels, height: (value) => pixels(value) || enumeration("auto", "stretch")(value),
    size: enumeration("auto", "stretch", "small", "medium", "large"), style: enumeration("default", "person"),
    horizontalAlignment: horizontal, backgroundColor: (value) => string(value) && /^#(?:[\da-f]{6}|[\da-f]{8})$/i.test(value) },
  ImageSet: { ...common, imageSize: enumeration("small", "medium", "large") },
  FactSet: { ...common },
  Table: { ...common, firstRowAsHeaders: boolean, showGridLines: boolean, gridStyle: containerStyle,
    horizontalCellContentAlignment: horizontal, verticalCellContentAlignment: vertical },
  TableRow: { type: string, id: string, style: containerStyle,
    horizontalCellContentAlignment: horizontal, verticalCellContentAlignment: vertical },
  TableCell: { ...common, ...container },
};
const BODY_TYPES = ["TextBlock", "RichTextBlock", "Container", "ColumnSet", "Image", "ImageSet", "FactSet", "Table"];
const COLLECTIONS = {
  AdaptiveCard: { body: BODY_TYPES },
  Container: { items: BODY_TYPES },
  ColumnSet: { columns: ["Column"] },
  Column: { items: BODY_TYPES },
  ImageSet: { images: ["Image"] },
  RichTextBlock: { inlines: ["TextRun"] },
  Table: { rows: ["TableRow"] },
  TableRow: { cells: ["TableCell"] },
  TableCell: { items: BODY_TYPES },
};
const REQUIRED = {
  AdaptiveCard: ["body"], TextBlock: ["text"], TextRun: ["text"], Image: ["url"],
  RichTextBlock: ["inlines"], FactSet: ["facts"], Table: ["columns", "rows"],
  TableRow: ["cells"], TableCell: ["items"], Container: ["items"], ColumnSet: ["columns"],
  Column: ["items"], ImageSet: ["images"],
};
const INTERACTIVE = new Set(["actions", "selectAction", "inlineAction", "refresh", "authentication"]);
const FACT_SCHEMA = { title: string, value: string };
const TABLE_COLUMN_SCHEMA = {
  width: (width) => positive(width) || pixels(width),
  horizontalCellContentAlignment: horizontal, verticalCellContentAlignment: vertical,
};

function validateFields(value, path, schema) {
  for (const [key, child] of Object.entries(value)) {
    if (Object.hasOwn(schema, key) && !schema[key](child)) {
      fail("invalid-property", `${path}.${key}`, "Invalid value for the supported schema 1.5 property.");
    }
  }
}

// Validate the complete typed structure before choosing any fallback. Otherwise
// an earlier unmet capability could hide a later malformed or prohibited field.
function validateCardStructure(value, path, allowed) {
  if (!record(value)) fail("invalid-element", path, "Expected a typed card object.");
  if (!string(value.type) || !value.type) fail("unsupported-element", path, "An explicit element type is required.");
  if (Object.hasOwn(SCHEMA, value.type) && !allowed.includes(value.type)) {
    fail("unsupported-element", path, "This element type is not valid in this collection.");
  }
  if (path === "$" && Object.hasOwn(value, "fallback")) {
    fail("unsupported-fallback", "$.fallback", "Root fallback is not supported; use static element fallbacks.");
  }
  for (const key of Object.keys(value)) {
    if (INTERACTIVE.has(key)) fail("unsupported-interactivity", `${path}.${key}`, "Actions, inputs, refresh and authentication are not supported; cards are non-interactive.");
    if (key === "backgroundImage") fail("unsupported-resource", `${path}.${key}`, "Background images are not supported; use an approved Image element.");
    if (key === "fallbackText") fail("unsupported-fallback", `${path}.${key}`, "Root fallbackText is not supported; use static element fallbacks.");
  }
  if (Object.hasOwn(value, "requires")) {
    if (!record(value.requires)) fail("invalid-property", `${path}.requires`, "requires must map capability names to versions.");
    for (const [capability, version] of Object.entries(value.requires)) {
      if (!string(version) || !/^(?:\*|\d{1,3}\.\d{1,3})$/.test(version)) {
        fail("invalid-property", `${path}.requires.${capability}`, "Capability versions must be major.minor or '*'.");
      }
    }
  }
  if (Object.hasOwn(SCHEMA, value.type)) {
    validateFields(value, path, SCHEMA[value.type]);
    for (const key of REQUIRED[value.type] || []) {
      if (!Object.hasOwn(value, key)) fail("missing-property", `${path}.${key}`, `The ${value.type} requires ${key}.`);
    }
    for (const [key, types] of Object.entries(COLLECTIONS[value.type] || {})) {
      if (value[key] === undefined) continue;
      if (!Array.isArray(value[key])) fail("invalid-collection", `${path}.${key}`, "Expected an array.");
      value[key].forEach((child, index) => {
        if (key === "inlines" && string(child)) return;
        validateCardStructure(child, `${path}.${key}[${index}]`, types);
      });
    }
    if (value.type === "FactSet") {
      if (!Array.isArray(value.facts)) fail("invalid-collection", `${path}.facts`, "Expected an array.");
      value.facts.forEach((fact, index) => {
        const location = `${path}.facts[${index}]`;
        if (!record(fact) || !string(fact.title) || !string(fact.value)) fail("invalid-fact", location, "Facts require string title and value fields.");
        validateFields(fact, location, FACT_SCHEMA);
      });
    }
    if (value.type === "Table") {
      if (!Array.isArray(value.columns) || !value.columns.length) fail("invalid-collection", `${path}.columns`, "Tables require at least one column.");
      value.columns.forEach((column, index) => {
        const location = `${path}.columns[${index}]`;
        if (!record(column)) fail("invalid-property", location, "Expected a TableColumnDefinition.");
        validateFields(column, location, TABLE_COLUMN_SCHEMA);
      });
      if (value.rows.some((row) => row.type === "TableRow" && row.cells.length !== value.columns.length)) {
        fail("invalid-table", `${path}.rows`, "Every table row must have exactly one cell per column.");
      }
    }
  }
  if (Object.hasOwn(value, "fallback") && value.fallback !== "drop") {
    if (!record(value.fallback)) fail("invalid-property", `${path}.fallback`, "Fallback must be a typed static object or 'drop'.");
    validateCardStructure(value.fallback, `${path}.fallback`, allowed);
  }
}

function readBoundedJson(source) {
  if (typeof source !== "string" || source.length > MAX_CARD_JSON_BYTES ||
      new TextEncoder().encode(source).length > MAX_CARD_JSON_BYTES) {
    fail("card-size-limit", "$", `Card JSON must be at most ${MAX_CARD_JSON_BYTES} UTF-8 bytes.`);
  }
  let card;
  try { card = JSON.parse(source); }
  catch { fail("invalid-json", "$", "Expected fully resolved Adaptive Card JSON."); }
  let objects = 0;
  const visit = (value, path, depth) => {
    if (depth > MAX_CARD_DEPTH) fail("card-depth-limit", path, `Card depth exceeds ${MAX_CARD_DEPTH}.`);
    if (typeof value === "string") {
      if (/\$\{|\{\{(?:DATE|TIME)\(/i.test(value)) fail("unresolved-template", path, "Template expressions and date/time macros must be resolved before authoring.");
      return;
    }
    if (!value || typeof value !== "object") return;
    if (++objects > MAX_CARD_OBJECTS) fail("card-object-limit", path, `Card object count exceeds ${MAX_CARD_OBJECTS}.`);
    for (const [key, child] of Object.entries(value)) {
      const location = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`;
      if (key.startsWith("$") && key !== "$schema") fail("unresolved-template", location, "Only fully resolved card JSON is accepted.");
      visit(child, location, depth + 1);
    }
  };
  visit(card, "$", 0);
  if (!record(card) || card.type !== "AdaptiveCard" || !Array.isArray(card.body)) {
    fail("invalid-card", "$", "Expected an AdaptiveCard with a body array.");
  }
  if (card.version !== ADAPTIVE_CARD_SCHEMA_VERSION) {
    fail("unsupported-version", "$.version", `MarkdStage supports schema ${ADAPTIVE_CARD_SCHEMA_VERSION} only.`);
  }
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
  if (/[\\\u0000-\u001f\u007f]/.test(decoded) || /%[0-9a-f]{2}/i.test(decoded) ||
      decoded.split("/").some((part) => part === "." || part === "..") || /%(?:2f|5c)/i.test(source)) {
    fail("blocked-image", label, "Image paths must stay inside the approved assets folder.");
  }
  const base = new URL(".", baseURI);
  const assets = new URL("assets/", base);
  const url = new URL(source.startsWith("/assets/") ? source.slice(1) : source, base);
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== base.origin ||
      url.username || url.password || !url.pathname.startsWith(assets.pathname) ||
      !/\.(png|jpe?g|gif|svg)$/i.test(url.pathname)) {
    fail("blocked-image", label, "Images must be supported data images or scoped same-origin workspace assets; remote images are blocked.");
  }
  return url.href;
}

// This closed, static schema envelope runs without a DOM or the SDK on both
// native and Node hosts. SDK parsing remains a second check, never a substitute.
export function validateAdaptiveCardSource(source, { baseURI = "https://markdstage.invalid/" } = {}) {
  const diagnostics = [];
  const sourcePaths = new Map();
  const origins = new WeakMap();
  const warn = (code, path, message) => addCardDiagnostic(diagnostics, cardDiagnostic(code, path, message));
  let card = null;
  try {
    const input = readBoundedJson(source);
    validateCardStructure(input, "$", ["AdaptiveCard"]);
    const fallback = (value, path, allowed, reason) => {
      if (!Object.hasOwn(value, "fallback")) throw reason;
      warn(reason.code, reason.path, `${reason.message} An authored fallback is required.`);
      if (value.fallback === "drop") {
        warn("fallback-dropped", `${path}.fallback`, "The authored fallback drops this element; its content is omitted.");
        return null;
      }
      warn("fallback-substituted", `${path}.fallback`, "The authored static fallback replaces the unsupported element.");
      return element(value.fallback, `${path}.fallback`, allowed);
    };
    const fields = (value, path, schema) => {
      validateFields(value, path, schema);
      const result = {};
      for (const [key, child] of Object.entries(value)) {
        if (!Object.hasOwn(schema, key)) {
          warn("unknown-property", `${path}.${key}`, "This property is outside the supported static schema and is ignored.");
        } else {
          result[key] = child;
        }
      }
      return result;
    };
    const element = (value, path, allowed) => {
      if (value.requires !== undefined) {
        for (const [capability, version] of Object.entries(value.requires)) {
          const [major, minor] = version.split(".").map(Number);
          if (capability !== "adaptiveCards" || (version !== "*" && (major > 1 || (major === 1 && minor > 5)))) {
            return fallback(value, path, allowed, new AdaptiveCardError("requires-not-met",
              `${path}.requires.${capability}`, "The required capability is not supported by this host."));
          }
        }
      }
      if (!Object.hasOwn(SCHEMA, value.type) || !allowed.includes(value.type)) {
        return fallback(value, path, allowed, new AdaptiveCardError("unsupported-element", path,
          "An explicit supported static element type is required in this collection."));
      }
      const collections = COLLECTIONS[value.type] || {};
      const own = Object.fromEntries(Object.entries(value).filter(([key]) =>
        !Object.hasOwn(collections, key) && !["requires", "fallback"].includes(key) &&
        !(value.type === "FactSet" && key === "facts") &&
        !(value.type === "Table" && key === "columns")));
      const result = fields(own, path, SCHEMA[value.type]);
      origins.set(result, path);
      for (const key of REQUIRED[value.type] || []) {
        if (!Object.hasOwn(value, key)) fail("missing-property", `${path}.${key}`, `The ${value.type} requires ${key}.`);
      }
      for (const [key, types] of Object.entries(collections)) {
        if (value[key] === undefined) continue;
        if (!Array.isArray(value[key])) fail("invalid-collection", `${path}.${key}`, "Expected an array.");
        result[key] = [];
        for (const [index, child] of value[key].entries()) {
          if (key === "inlines" && string(child)) { result[key].push(child); continue; }
          try {
            const resolved = element(child, `${path}.${key}[${index}]`, types);
            if (resolved) result[key].push(resolved);
          } catch (error) {
            if (error instanceof AdaptiveCardError && ["requires-not-met", "unsupported-element"].includes(error.code)) {
              return fallback(value, path, allowed, error);
            }
            throw error;
          }
        }
      }
      if (value.type === "FactSet") {
        if (!Array.isArray(value.facts)) fail("invalid-collection", `${path}.facts`, "Expected an array.");
        result.facts = value.facts.map((fact, index) => {
          const location = `${path}.facts[${index}]`;
          if (!record(fact) || !string(fact.title) || !string(fact.value)) fail("invalid-fact", location, "Facts require string title and value fields.");
          const resolved = fields(fact, location, FACT_SCHEMA);
          origins.set(resolved, location);
          return resolved;
        });
      }
      if (value.type === "Table") {
        if (!Array.isArray(value.columns) || !value.columns.length) fail("invalid-collection", `${path}.columns`, "Tables require at least one column.");
        result.columns = value.columns.map((column, index) => {
          const location = `${path}.columns[${index}]`;
          if (!record(column)) fail("invalid-property", location, "Expected a TableColumnDefinition.");
          return fields(column, location, TABLE_COLUMN_SCHEMA);
        });
        if (result.rows.some((row) => row.cells.length !== result.columns.length)) {
          fail("invalid-table", `${path}.rows`, "Every table row must have exactly one cell per column.");
        }
      }
      if (value.type === "Image") {
        try { resolveCardImageUrl(value.url, baseURI, `${path}.url`); }
        catch (error) { addCardDiagnostic(diagnostics, cardErrorDiagnostic(error, `${path}.url`, "warning")); }
      }
      return result;
    };
    card = element(input, "$", ["AdaptiveCard"]);
    if (!card) fail("unsupported-fallback", "$", "A root card cannot be dropped.");
    const ids = new Set();
    const remember = (value, path) => {
      if (!value || typeof value !== "object") return;
      if (origins.has(value)) sourcePaths.set(path, origins.get(value));
      if (value.id) {
        if (ids.has(value.id)) fail("duplicate-id", `${origins.get(value) || path}.id`, "Card element ids must be unique.");
        ids.add(value.id);
      }
      for (const [key, child] of Object.entries(value)) {
        if (Array.isArray(child)) child.forEach((item, index) => remember(item, `${path}.${key}[${index}]`));
      }
    };
    remember(card, "$");
  } catch (error) {
    card = null;
    addCardDiagnostic(diagnostics, cardErrorDiagnostic(error));
  }
  const truncated = diagnostics.some((entry) => entry.code === "diagnostics-truncated");
  return { valid: Boolean(card) && !truncated, complete: !truncated, truncated, card, diagnostics, sourcePaths };
}

export function parseAdaptiveCardSource(source) {
  const result = validateAdaptiveCardSource(source);
  if (!result.valid) {
    const error = result.diagnostics.find((entry) => entry.severity === "error");
    fail(error.code, error.path, error.message);
  }
  return result.card;
}
