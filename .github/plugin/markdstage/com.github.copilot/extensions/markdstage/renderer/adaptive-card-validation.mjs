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
const nonempty = (value) => string(value) && value.length > 0;
const boolean = (value) => typeof value === "boolean";
const number = (value) => typeof value === "number" && Number.isFinite(value);
const positive = (value) => Number.isFinite(value) && value > 0;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const pixels = (value) => typeof value === "string" && /^(?:0|[1-9]\d*)px$/.test(value) && parseInt(value, 10) <= 100_000;
const enumeration = (...values) => (value) => string(value) && values.includes(value.toLowerCase());
const date = (value) => string(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const time = (value) => string(value) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const horizontal = enumeration("left", "center", "right");
const vertical = enumeration("top", "center", "bottom");
const containerStyle = enumeration("default", "emphasis", "success", "info", "warning", "danger");
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
const input = { ...common, id: nonempty, label: string, isRequired: boolean, errorMessage: string };
const action = {
  type: string, id: string, title: string, iconUrl: string,
  style: enumeration("default", "positive", "destructive"), mode: enumeration("primary", "secondary"),
  tooltip: string, isEnabled: boolean,
};
const submit = { ...action, data: (value) => string(value) || record(value), associatedInputs: enumeration("auto", "none") };
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
  "Input.Text": { ...input, value: string, placeholder: string, isMultiline: boolean, maxLength: integer,
    style: enumeration("text", "tel", "url", "email", "password"), regex: string },
  "Input.Number": { ...input, value: number, placeholder: string, min: number, max: number },
  "Input.Date": { ...input, value: (value) => value === "" || date(value), placeholder: string, min: date, max: date },
  "Input.Time": { ...input, value: (value) => value === "" || time(value), placeholder: string, min: time, max: time },
  "Input.Toggle": { ...input, value: string, title: string, valueOn: string, valueOff: string, wrap: boolean },
  "Input.ChoiceSet": { ...input, value: string, placeholder: string,
    style: enumeration("compact", "expanded", "filtered"), isMultiSelect: boolean, wrap: boolean },
  Media: { ...common, poster: string, altText: string },
  ActionSet: { ...common, orientation: enumeration("horizontal", "vertical") },
  "Action.OpenUrl": { ...action, url: nonempty },
  "Action.Submit": submit,
  "Action.Execute": { ...submit, verb: string },
  "Action.ShowCard": action,
};
const INPUT_TYPES = ["Input.Text", "Input.Number", "Input.Date", "Input.Time", "Input.Toggle", "Input.ChoiceSet"];
const ACTION_TYPES = ["Action.OpenUrl", "Action.Submit", "Action.Execute", "Action.ShowCard"];
const SELECT_ACTION_TYPES = ACTION_TYPES.filter((type) => type !== "Action.ShowCard");
const BODY_TYPES = ["TextBlock", "RichTextBlock", "Container", "ColumnSet", "Image", "ImageSet", "FactSet", "Table",
  ...INPUT_TYPES, "Media", "ActionSet"];
const COLLECTIONS = {
  AdaptiveCard: { body: BODY_TYPES, actions: ACTION_TYPES },
  Container: { items: BODY_TYPES },
  ColumnSet: { columns: ["Column"] },
  Column: { items: BODY_TYPES },
  ImageSet: { images: ["Image"] },
  RichTextBlock: { inlines: ["TextRun"] },
  Table: { rows: ["TableRow"] },
  TableRow: { cells: ["TableCell"] },
  TableCell: { items: BODY_TYPES },
  ActionSet: { actions: ACTION_TYPES },
};
const CHILDREN = {
  AdaptiveCard: { selectAction: SELECT_ACTION_TYPES },
  Container: { selectAction: SELECT_ACTION_TYPES },
  Column: { selectAction: SELECT_ACTION_TYPES },
  ColumnSet: { selectAction: SELECT_ACTION_TYPES },
  TableCell: { selectAction: SELECT_ACTION_TYPES },
  Image: { selectAction: SELECT_ACTION_TYPES },
  TextRun: { selectAction: SELECT_ACTION_TYPES },
  "Input.Text": { inlineAction: SELECT_ACTION_TYPES },
  "Action.ShowCard": { card: ["AdaptiveCard"] },
};
const REQUIRED = {
  AdaptiveCard: ["body"], TextBlock: ["text"], TextRun: ["text"], Image: ["url"],
  RichTextBlock: ["inlines"], FactSet: ["facts"], Table: ["columns", "rows"],
  TableRow: ["cells"], TableCell: ["items"], Container: ["items"], ColumnSet: ["columns"],
  Column: ["items"], ImageSet: ["images"],
  ...Object.fromEntries(INPUT_TYPES.map((type) => [type, ["id"]])),
  "Input.Toggle": ["id", "title"], "Input.ChoiceSet": ["id", "choices"],
  Media: ["sources"], ActionSet: ["actions"],
  "Action.OpenUrl": ["url"], "Action.ShowCard": ["card"],
};
const INTERACTIVE = new Set(["refresh", "authentication", "choices.data"]);
const FACT_SCHEMA = { title: string, value: string };
const CHOICE_SCHEMA = { title: string, value: string };
const MEDIA_SOURCE_SCHEMA = { mimeType: nonempty, url: nonempty };
const TABLE_COLUMN_SCHEMA = {
  width: (width) => positive(width) || pixels(width),
  horizontalCellContentAlignment: horizontal, verticalCellContentAlignment: vertical,
};

// Documentation/upgrade tooling reads this closed envelope, not a second schema
// whitelist. Validators and collection-role checks above remain authoritative.
export function adaptiveCardSchemaEnvelope() {
  const roles = (value) => Object.fromEntries(Object.entries(value || {}).map(([name, types]) => [name, [...types]]));
  const records = {
    Fact: FACT_SCHEMA, Choice: CHOICE_SCHEMA, MediaSource: MEDIA_SOURCE_SCHEMA,
    TableColumnDefinition: TABLE_COLUMN_SCHEMA,
  };
  return Object.fromEntries(Object.entries({ ...SCHEMA, ...records }).map(([type, properties]) => [type, {
    properties: Object.keys(properties),
    required: [...REQUIRED[type] || []],
    collections: roles(COLLECTIONS[type]),
    children: roles(CHILDREN[type]),
    records: type === "FactSet" ? { facts: "Fact" } : type === "Input.ChoiceSet" ? { choices: "Choice" }
      : type === "Media" ? { sources: "MediaSource" } : type === "Table" ? { columns: "TableColumnDefinition" } : {},
    capabilityProperties: Object.hasOwn(SCHEMA, type) ? ["requires", ...(type === "AdaptiveCard" ? [] : ["fallback"])] : [],
  }]));
}

// A strict, syntactic subset of pinned DOMPurify's rendered-link URI policy.
// The browser rechecks hrefs with DOMPurify before native export. Resource
// approval is deliberately separate: a hyperlink is never an asset.
const RENDERED_LINK_URI = /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;
const URI_WHITESPACE = /[\u0000-\u0020\u007f\u00a0\u1680\u180e\u2000-\u2029\u205f\u3000]/;
export function isAllowedCardHref(value) {
  if (!nonempty(value) || URI_WHITESPACE.test(value) || /[<>"\\]/.test(value) || !RENDERED_LINK_URI.test(value)) return false;
  let url;
  try { url = new URL(value); }
  catch { return false; }
  if (url.username || url.password) return false;
  if (url.protocol === "http:" || url.protocol === "https:") return /^https?:\/\/[^/]/i.test(value) && Boolean(url.hostname);
  return (url.protocol === "mailto:" || url.protocol === "tel:") && Boolean(url.pathname);
}

function validateHostProtocol(value, path) {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value.replace(new RegExp(URI_WHITESPACE, "g"), ""))?.[1].toLowerCase();
  if (scheme && !["http", "https", "ftp", "ftps", "mailto", "tel", "callto", "sms", "cid", "xmpp",
    "javascript", "vbscript", "data", "file", "blob", "about"].includes(scheme)) {
    fail("unsupported-protocol", path, "Custom host protocols are not supported, including inside unused fallbacks or collapsed cards.");
  }
}

function validateFields(value, path, schema) {
  for (const [key, child] of Object.entries(value)) {
    if (Object.hasOwn(schema, key) && !schema[key](child)) {
      fail("invalid-property", `${path}.${key}`, "Invalid value for the supported schema 1.5 property.");
    }
  }
}

// Validate the complete typed structure before choosing any fallback. Otherwise
// an earlier unmet capability could hide a later malformed or prohibited field.
function validateCardStructure(value, path, allowed, ids = new Map(), branch = new Map()) {
  if (!record(value)) fail("invalid-element", path, "Expected a typed card object.");
  if (!string(value.type) || !value.type) fail("unsupported-element", path, "An explicit element type is required.");
  if (Object.hasOwn(SCHEMA, value.type) && !allowed.includes(value.type)) {
    fail(value.type.startsWith("Action.") ? "unsupported-action" : "unsupported-element", path,
      "This type is not valid in this collection or action property.");
  }
  if (value.type === "AdaptiveCard" && Object.hasOwn(value, "fallback")) {
    fail("unsupported-fallback", `${path}.fallback`, "Card-root fallback is not supported; use element fallbacks.");
  }
  if (value.type === "AdaptiveCard" && Object.hasOwn(value, "version") && value.version !== ADAPTIVE_CARD_SCHEMA_VERSION) {
    fail("unsupported-version", `${path}.version`, `MarkdStage supports authored schema ${ADAPTIVE_CARD_SCHEMA_VERSION} only, including collapsed cards.`);
  }
  for (const key of Object.keys(value)) {
    if (INTERACTIVE.has(key)) fail("unsupported-interactivity", `${path}.${key}`, "Refresh, authentication and dynamic host queries are not supported.");
    if (["actions", "selectAction", "inlineAction"].includes(key) &&
        !Object.hasOwn(COLLECTIONS[value.type] || {}, key) && !Object.hasOwn(CHILDREN[value.type] || {}, key)) {
      fail("unsupported-interactivity", `${path}.${key}`, "This action property is not supported on this schema 1.5 type.");
    }
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
  const schema = Object.hasOwn(SCHEMA, value.type) ? SCHEMA[value.type]
    : value.type.startsWith("Action.") || allowed.some((type) => type.startsWith("Action.")) ? action : common;
  validateFields(value, path, schema);
  const primary = Object.hasOwn(value, "fallback") ? new Map([...branch, [path, "primary"]]) : branch;
  if (value.id) {
    const previous = ids.get(value.id) || [];
    if (previous.some((other) => ![...primary].some(([location, choice]) => other.has(location) && other.get(location) !== choice))) {
      fail("duplicate-id", `${path}.id`, "Card object ids must be unique in every authored branch.");
    }
    ids.set(value.id, [...previous, primary]);
  }
  if (Object.hasOwn(SCHEMA, value.type)) {
    for (const key of REQUIRED[value.type] || []) {
      if (value.type === "AdaptiveCard" && path !== "$" && key === "body") continue;
      if (!Object.hasOwn(value, key)) fail("missing-property", `${path}.${key}`, `The ${value.type} requires ${key}.`);
    }
    for (const [key, types] of Object.entries(COLLECTIONS[value.type] || {})) {
      if (value[key] === undefined) continue;
      if (!Array.isArray(value[key])) fail("invalid-collection", `${path}.${key}`, "Expected an array.");
      value[key].forEach((child, index) => {
        if (key === "inlines" && string(child)) return;
        validateCardStructure(child, `${path}.${key}[${index}]`, types, ids, primary);
      });
    }
    for (const [key, types] of Object.entries(CHILDREN[value.type] || {})) {
      if (Object.hasOwn(value, key)) validateCardStructure(value[key], `${path}.${key}`, types, ids, primary);
    }
    if (value.type === "Action.OpenUrl") validateHostProtocol(value.url, `${path}.url`);
    if (value.type === "Input.ChoiceSet" || value.type === "Media") {
      const key = value.type === "Media" ? "sources" : "choices";
      const schema = value.type === "Media" ? MEDIA_SOURCE_SCHEMA : CHOICE_SCHEMA;
      if (!Array.isArray(value[key])) fail("invalid-collection", `${path}.${key}`, "Expected an array.");
      value[key].forEach((child, index) => {
        const location = `${path}.${key}[${index}]`;
        if (!record(child)) fail("invalid-property", location, `Expected a ${key === "sources" ? "MediaSource" : "Choice"} object.`);
        validateFields(child, location, schema);
        for (const field of Object.keys(schema)) {
          if (!Object.hasOwn(child, field)) fail("missing-property", `${location}.${field}`, `The ${key} entry requires ${field}.`);
        }
        if (key === "sources") validateHostProtocol(child.url, `${location}.url`);
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
    if (!record(value.fallback)) fail("invalid-property", `${path}.fallback`, "Fallback must be a typed supported object or 'drop'.");
    validateCardStructure(value.fallback, `${path}.fallback`, allowed, ids, new Map([...branch, [path, "fallback"]]));
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
  const memberOrigins = new WeakMap();
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
      warn("fallback-substituted", `${path}.fallback`, "The authored fallback replaces the unsupported object.");
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
        return fallback(value, path, allowed, new AdaptiveCardError(
          allowed.some((type) => type.startsWith("Action.")) ? "unsupported-action" : "unsupported-element", path,
          "An explicit supported type or authored fallback is required in this collection."));
      }
      const collections = COLLECTIONS[value.type] || {};
      const children = CHILDREN[value.type] || {};
      const records = value.type === "Input.ChoiceSet" ? { choices: CHOICE_SCHEMA }
        : value.type === "Media" ? { sources: MEDIA_SOURCE_SCHEMA }
          : value.type === "FactSet" ? { facts: FACT_SCHEMA }
            : value.type === "Table" ? { columns: TABLE_COLUMN_SCHEMA } : {};
      const own = Object.fromEntries(Object.entries(value).filter(([key]) =>
        !Object.hasOwn(collections, key) && !Object.hasOwn(children, key) &&
        !Object.hasOwn(records, key) && !["requires", "fallback"].includes(key)));
      const result = fields(own, path, SCHEMA[value.type]);
      origins.set(result, path);
      try {
        for (const [key, types] of Object.entries(collections)) {
          if (value[key] === undefined) continue;
          result[key] = [];
          const paths = [];
          memberOrigins.set(result[key], paths);
          for (const [index, child] of value[key].entries()) {
            const location = `${path}.${key}[${index}]`;
            const resolved = key === "inlines" && string(child) ? child : element(child, location, types);
            if (resolved !== null) {
              result[key].push(resolved);
              paths.push(location);
            }
          }
        }
        for (const [key, types] of Object.entries(children)) {
          if (!Object.hasOwn(value, key)) continue;
          const resolved = element(value[key], `${path}.${key}`, types);
          if (resolved) result[key] = resolved;
        }
      } catch (error) {
        if (error instanceof AdaptiveCardError && ["requires-not-met", "unsupported-element", "unsupported-action"].includes(error.code)) {
          return fallback(value, path, allowed, error);
        }
        throw error;
      }
      for (const [key, schema] of Object.entries(records)) {
        result[key] = value[key].map((child, index) => {
          const location = `${path}.${key}[${index}]`;
          const resolved = fields(child, location, schema);
          origins.set(resolved, location);
          return resolved;
        });
      }
      if (value.type === "Table") {
        if (result.rows.some((row) => row.cells.length !== result.columns.length)) {
          fail("invalid-table", `${path}.rows`, "Every table row must have exactly one cell per column.");
        }
      }
      const imageField = value.type === "Image" ? "url" : value.type === "Media" && value.poster ? "poster"
        : ACTION_TYPES.includes(value.type) && value.iconUrl ? "iconUrl" : null;
      if (imageField) {
        const location = `${path}.${imageField}`;
        try { resolveCardImageUrl(value[imageField], baseURI, location); }
        catch (error) { addCardDiagnostic(diagnostics, cardErrorDiagnostic(error, location, "warning")); }
      }
      if (INPUT_TYPES.includes(value.type)) {
        warn("static-input", path, "Only the initial value or placeholder is shown with a non-interactive label; input editing and validation are unavailable.");
      } else if (value.type === "ActionSet" && Object.hasOwn(value, "orientation")) {
        warn("static-property-ignored", `${path}.orientation`, "Static action labels use the owned vertical projection; authored action orientation is not applied.");
      } else if (value.type === "Media") {
        warn("static-media", path, "Only an approved poster and static media label are shown. Media sources are never fetched or played.");
      } else if (ACTION_TYPES.includes(value.type)) {
        if (value.type === "Action.OpenUrl") {
          if (isAllowedCardHref(value.url)) {
            warn("static-link", path, "The safe URL is retained only for a PowerPoint text-label hyperlink; browser content remains non-interactive.");
          } else {
            warn("blocked-link", `${path}.url`, "This URL is not allowed for rendered links; only a non-interactive text label is retained.");
          }
        } else {
          warn("static-action", path, value.type === "Action.ShowCard"
            ? "ShowCard remains collapsed; only its non-interactive action label is shown, never its embedded contents."
            : "This action cannot submit, execute, or receive input; only non-interactive labels are retained where a label is displayed.");
        }
        if (value.iconUrl) warn("static-action-icon", `${path}.iconUrl`, "Static actions retain text labels, not action icons; this icon is not fetched.");
      }
      return result;
    };
    card = element(input, "$", ["AdaptiveCard"]);
    if (!card) fail("unsupported-fallback", "$", "A root card cannot be dropped.");
    const ids = new Set();
    const remember = (value, path, authored) => {
      const location = value && typeof value === "object" ? origins.get(value) || authored : authored;
      sourcePaths.set(path, location);
      if (!value || typeof value !== "object") return;
      if (origins.has(value) && value.type && value.id) {
        if (ids.has(value.id)) fail("duplicate-id", `${origins.get(value) || path}.id`, "Card element ids must be unique.");
        ids.add(value.id);
      }
      if (Array.isArray(value)) {
        value.forEach((child, index) => remember(child, `${path}[${index}]`,
          memberOrigins.get(value)?.[index] || `${location}[${index}]`));
      } else {
        for (const [key, child] of Object.entries(value)) remember(child, `${path}.${key}`, `${location}.${key}`);
      }
    };
    remember(card, "$", "$");
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
