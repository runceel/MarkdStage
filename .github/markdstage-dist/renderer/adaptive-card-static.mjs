import {
  AdaptiveCardError, MAX_CARD_DEPTH, MAX_CARD_OBJECTS, isAllowedCardHref,
} from "./adaptive-card-validation.mjs";

export const MAX_STATIC_CARD_OBJECTS = MAX_CARD_OBJECTS * 16;
export const MAX_STATIC_CARD_DEPTH = MAX_CARD_DEPTH + 8;

const COMMON_PROPERTIES = ["id", "isVisible", "separator", "spacing", "height", "horizontalAlignment", "lang"];
const OMITTED_PROPERTIES = new Set(["actions", "selectAction", "inlineAction", "fallback", "requires"]);

// Project semantics before rendering. In particular, reading Input.value would
// read a DOM control; defaultValue is the SDK's authored, pre-render value.
export function projectAdaptiveCardStatic(originalCard, SDK, sourcePaths = new Map()) {
  if (!(originalCard instanceof SDK.AdaptiveCard) || originalCard.hostConfig.supportsInteractivity !== false) {
    throw new AdaptiveCardError("invalid-static-card", "$", "Static projection requires a parsed, non-interactive SDK AdaptiveCard.");
  }
  const context = new SDK.SerializationContext(SDK.Versions.v1_5);
  const origins = new WeakMap();
  const propertyOrigins = new WeakMap();
  const treatments = new WeakMap();
  const visited = new Set();
  const authored = (path) => {
    for (let prefix = path; prefix; prefix = prefix.slice(0, Math.max(prefix.lastIndexOf("."), prefix.lastIndexOf("[")))) {
      if (sourcePaths.has(prefix)) return sourcePaths.get(prefix) + path.slice(prefix.length);
    }
    return path;
  };
  const mark = (value, path, provenance, properties) => {
    origins.set(value, path);
    if (provenance) treatments.set(value, provenance);
    if (properties) propertyOrigins.set(value, properties);
    return value;
  };
  const metadata = (object, path, treatment, extra = {}) => ({
    type: object.getJsonTypeName(), sourcePath: authored(path), treatment, ...extra,
  });
  const clone = (value, path) => {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return mark(value.map((child, index) => clone(child, `${path}[${index}]`)), authored(path));
    return mark(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child, `${path}.${key}`)])), authored(path));
  };
  const serialized = (object, path, omitted = new Set()) => {
    const result = {};
    for (const [key, value] of Object.entries(object.toJSON(context))) {
      if (!OMITTED_PROPERTIES.has(key) && !omitted.has(key)) result[key] = clone(value, `${path}.${key}`);
    }
    const shorthand = object instanceof SDK.TextRun && sourcePaths.has(path) &&
      !sourcePaths.has(`${path}.type`) && !sourcePaths.has(`${path}.text`);
    return mark(result, authored(path), undefined, shorthand ? { text: authored(path) } : undefined);
  };
  const common = (object) => {
    const json = object.toJSON(context);
    return Object.fromEntries(COMMON_PROPERTIES.filter((key) => json[key] !== undefined).map((key) => [key, json[key]]));
  };
  const text = (value, path, provenance, style = {}) => {
    const run = mark({ type: "TextRun", text: value, ...style }, path, provenance, { text: path });
    return mark({ type: "RichTextBlock", inlines: [run] }, path, undefined, { inlines: path });
  };
  const container = (object, path, items, provenance, emphasis = true) => mark({
    type: "Container", ...common(object), ...(emphasis ? { style: "emphasis" } : {}), items,
  }, authored(path), provenance);
  const link = (object) => object instanceof SDK.OpenUrlAction && object.isEnabled !== false && isAllowedCardHref(object.url)
    ? object.url : undefined;
  const claim = (object, path) => {
    if (visited.has(object) || visited.size >= MAX_CARD_OBJECTS) {
      throw new AdaptiveCardError("card-object-limit", authored(path), "The SDK tree must remain bounded and cannot contain shared or cyclic children.");
    }
    visited.add(object);
  };
  const projectAction = (object, path) => {
    claim(object, path);
    const type = object.getJsonTypeName();
    const labels = {
      "Action.OpenUrl": "Open link", "Action.Submit": "Submit", "Action.Execute": "Execute", "Action.ShowCard": "Show card",
    };
    if (!Object.hasOwn(labels, type)) {
      throw new AdaptiveCardError("unsupported-action", authored(path), "Static projection cannot silently omit an unsupported action.");
    }
    const href = link(object);
    const provenance = metadata(object, path, "static-action", {
      ...(object instanceof SDK.ShowCardAction ? { collapsed: true } : {}),
      enabled: object.isEnabled !== false,
    });
    const titlePath = authored(`${path}.title`);
    const titleMetadata = metadata(object, path, href ? "static-link" : "static-action", {
      sourcePath: titlePath, ...(href ? { href } : {}), actionSourcePath: authored(path),
    });
    const detail = object instanceof SDK.ShowCardAction ? "Show card (collapsed; non-interactive)"
      : object.isEnabled === false ? "Disabled action (non-interactive)"
        : object instanceof SDK.OpenUrlAction && !href ? "Link unavailable (non-interactive)" : "Action (non-interactive)";
    return mark({
      type: "Container", ...(object.id ? { id: object.id } : {}), style: "emphasis",
      items: [
        text(object.title || labels[type], titlePath, titleMetadata, { weight: "bolder" }),
        text(detail, authored(path), undefined, { isSubtle: true }),
      ],
    }, authored(path), provenance);
  };
  const projectInput = (object, path) => {
    const type = object.getJsonTypeName();
    const labels = {
      "Input.Text": "Text input", "Input.Number": "Number input", "Input.Date": "Date input",
      "Input.Time": "Time input", "Input.Toggle": "Toggle input", "Input.ChoiceSet": "Choice input",
    };
    if (!Object.hasOwn(labels, type)) {
      throw new AdaptiveCardError("unsupported-element", authored(path), "This input has no supported static treatment.");
    }
    const label = object.label || (object instanceof SDK.ToggleInput && object.title) || labels[type];
    const labelPath = authored(`${path}.${object.label ? "label" : object instanceof SDK.ToggleInput && object.title ? "title" : "type"}`);
    const provenance = metadata(object, path, "static-input");
    const items = [text(`${label} (non-interactive)`, labelPath, undefined, { weight: "bolder" })];
    if (object instanceof SDK.ToggleInput && object.title && object.title !== label) {
      const titlePath = authored(`${path}.title`);
      items.push(text(object.title, titlePath, { ...provenance, sourcePath: titlePath }));
    }
    let value = object.defaultValue;
    let valuePath = authored(`${path}.value`);
    if (object instanceof SDK.ToggleInput) {
      if (value === undefined || value === "") {
        value = object.valueOff;
        valuePath = authored(`${path}.valueOff`);
      }
      value = `${value === object.valueOn ? "On" : value === object.valueOff ? "Off" : "Value"}: ${value}`;
    } else if (value === undefined || value === "") {
      value = object.placeholder || (object instanceof SDK.ChoiceSetInput ? "No selection" : "No initial value");
      valuePath = authored(`${path}.${object.placeholder ? "placeholder" : "value"}`);
    } else if (object instanceof SDK.ChoiceSetInput) {
      const selected = [...new Set(object.isMultiSelect ? value.split(",") : [value])];
      const choices = new Map();
      object.choices.forEach((choice, index) => {
        if (!choices.has(choice.value)) choices.set(choice.value, { text: choice.title, path: authored(`${path}.choices[${index}].title`) });
      });
      const labels = [];
      for (const selectedValue of selected) {
        if (choices.has(selectedValue)) labels.push(choices.get(selectedValue));
        else if (labels.at(-1)?.unknown) labels.at(-1).unknown.push(selectedValue);
        else labels.push({ unknown: [selectedValue], path: valuePath });
      }
      const runs = [];
      labels.forEach((label, index) => {
        if (index) runs.push(mark({ type: "TextRun", text: ", " }, valuePath, undefined, { text: valuePath }));
        runs.push(mark({ type: "TextRun", text: label.unknown ? label.unknown.join(", ") : label.text },
          label.path, { ...provenance, sourcePath: label.path }, { text: label.path }));
      });
      items.push(mark({ type: "RichTextBlock", inlines: runs }, valuePath, { ...provenance, sourcePath: valuePath }));
      value = undefined;
    } else if (object instanceof SDK.TextInput && object.style === SDK.InputTextStyle.Password) {
      value = "•".repeat([...value].length);
    }
    if (value !== undefined) items.push(text(String(value), valuePath, { ...provenance, sourcePath: valuePath }));
    if (object instanceof SDK.TextInput && object.inlineAction) items.push(projectAction(object.inlineAction, `${path}.inlineAction`));
    return container(object, path, items, provenance);
  };
  const project = (object, path) => {
    claim(object, path);
    if (object instanceof SDK.Input) return projectInput(object, path);
    if (object instanceof SDK.ActionSet) {
      const items = [];
      for (let index = 0; index < object.getActionCount(); index++) items.push(projectAction(object.getActionAt(index), `${path}.actions[${index}]`));
      return container(object, path, items, metadata(object, path, "static-action"), false);
    }
    if (object instanceof SDK.Media) {
      const provenance = metadata(object, path, "static-media");
      const items = [];
      if (object.poster) {
        const posterPath = authored(`${path}.poster`);
        // This is an ordinary Image, so the existing resource gate must approve
        // its bytes (or replace it) before the projected card is ever rendered.
        items.push(mark({ type: "Image", url: object.poster, ...(object.altText ? { altText: object.altText } : {}) },
          posterPath, { ...provenance, sourcePath: posterPath }, { url: posterPath, altText: authored(`${path}.altText`) }));
      }
      items.push(text(object.altText ? `Media: ${object.altText} (non-interactive)` : "Media (non-interactive)",
        authored(`${path}.${object.altText ? "altText" : "type"}`), provenance));
      return container(object, path, items, provenance, false);
    }
    let result;
    if (object instanceof SDK.RichTextBlock) {
      result = serialized(object, path, new Set(["inlines"]));
      result.inlines = [];
      for (let index = 0; index < object.getInlineCount(); index++) result.inlines.push(project(object.getInlineAt(index), `${path}.inlines[${index}]`));
    } else if (object instanceof SDK.CardElementContainer) {
      const collection = object instanceof SDK.AdaptiveCard ? "body"
        : object instanceof SDK.ColumnSet ? "columns" : object instanceof SDK.ImageSet ? "images"
          : object instanceof SDK.Table ? "rows" : object instanceof SDK.TableRow ? "cells" : "items";
      result = serialized(object, path, new Set([collection]));
      result[collection] = [];
      for (let index = 0; index < object.getItemCount(); index++) result[collection].push(project(object.getItemAt(index), `${path}.${collection}[${index}]`));
      if (object instanceof SDK.AdaptiveCard) {
        for (let index = 0; index < object.getActionCount(); index++) result.body.push(projectAction(object.getActionAt(index), `${path}.actions[${index}]`));
      }
    } else {
      result = serialized(object, path);
    }
    if (object.selectAction) {
      const href = link(object.selectAction);
      treatments.set(result, metadata(object, path, href ? "static-link" : "static-action", {
        ...(href ? { href } : {}), actionType: object.selectAction.getJsonTypeName(),
        actionSourcePath: authored(`${path}.selectAction`), linkScope: "text-label",
      }));
    }
    return result;
  };
  const json = project(originalCard, "$");
  const finalSourcePaths = new Map();
  const provenance = new Map();
  const ids = new Set();
  let count = 0;
  const remember = (value, path, origin, depth) => {
    if (depth > MAX_STATIC_CARD_DEPTH) {
      throw new AdaptiveCardError("card-depth-limit", origin, "The static projection exceeded its bounded generated depth.");
    }
    if (value && typeof value === "object") {
      if (++count > MAX_STATIC_CARD_OBJECTS) {
        throw new AdaptiveCardError("card-object-limit", origin, "The static projection exceeded its bounded generated object count.");
      }
      origin = origins.get(value) || origin;
      if (treatments.has(value)) provenance.set(path, treatments.get(value));
      if (value.type && value.id) {
        if (ids.has(value.id)) throw new AdaptiveCardError("duplicate-id", `${origin}.id`, "Projected authored ids must remain unique.");
        ids.add(value.id);
      }
    }
    finalSourcePaths.set(path, origin);
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((child, index) => remember(child, `${path}[${index}]`, `${origin}[${index}]`, depth + 1));
    } else {
      for (const [key, child] of Object.entries(value)) {
        remember(child, `${path}.${key}`, propertyOrigins.get(value)?.[key] || `${origin}.${key}`, depth + 1);
      }
    }
  };
  remember(json, "$", authored("$"), 0);
  return { json, sourcePaths: finalSourcePaths, provenance };
}
