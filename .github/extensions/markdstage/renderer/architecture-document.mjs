import {
  ID_PATTERN,
  normalizeArchitectureSource,
  parseArchitecture,
} from "./architecture.mjs";
import {
  createArchitectureEditSession,
  describePlacement,
  resolveRawElement,
  serializeArchitecture,
} from "./architecture-edit.mjs";
import { architectureContract } from "./architecture-contract.mjs";

const HISTORY_LIMIT = 200;
const COORDINATE_MIN = -4000;
const COORDINATE_MAX = 4000;
const EXTENT_MIN = 1;
const EXTENT_MAX = 4000;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  const result = Number(Number(value).toFixed(4));
  return Object.is(result, -0) ? 0 : result;
}

function snapshot(source) {
  const normalized = normalizeArchitectureSource(source);
  return {
    source: normalized,
    raw: JSON.parse(normalized),
    model: parseArchitecture(normalized),
  };
}

function rawEntries(raw) {
  const entries = [];
  const walk = (items, prefix, parent) => {
    if (!Array.isArray(items)) return;
    items.forEach((element, index) => {
      if (!element || typeof element !== "object" || Array.isArray(element)) return;
      const sourcePath = `${prefix}[${index}]`;
      entries.push({
        element,
        parent,
        items,
        index,
        sourcePath,
        ref: element.id || sourcePath,
      });
      if (element.type === "group") {
        walk(element.children, `${sourcePath}.children`, element);
      }
    });
  };
  walk(raw.elements, "elements", null);
  return entries;
}

function rawEntry(raw, ref) {
  return (
    rawEntries(raw).find(
      (entry) => entry.sourcePath === ref || (entry.element.id && entry.element.id === ref),
    ) ?? null
  );
}

function modelElement(model, ref) {
  return (
    model.elements.find(
      (element) => element.sourcePath === ref || (element.id && element.id === ref),
    ) ?? null
  );
}

function collectIds(element, ids) {
  if (!element || typeof element !== "object") return;
  if (typeof element.id === "string") ids.add(element.id);
  if (Array.isArray(element.children)) {
    for (const child of element.children) collectIds(child, ids);
  }
}

function removeReferencingConnectors(items, ids) {
  if (!Array.isArray(items)) return;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const element = items[index];
    if (element?.type === "connector" && (ids.has(element.from) || ids.has(element.to))) {
      items.splice(index, 1);
      continue;
    }
    if (element?.type === "group") removeReferencingConnectors(element.children, ids);
  }
}

function nextId(raw, base) {
  const normalized = String(base || "element")
    .replace(/^[^A-Za-z]+/, "")
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .slice(0, 54) || "element";
  const ids = new Set(rawEntries(raw).map((entry) => entry.element.id).filter(Boolean));
  if (!ids.has(normalized) && ID_PATTERN.test(normalized)) return normalized;
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${normalized}-${index}`.slice(0, 64);
    if (!ids.has(candidate) && ID_PATTERN.test(candidate)) return candidate;
  }
  throw new Error("Could not generate a unique element id.");
}

function setNested(target, path, value) {
  const parts = String(path).split(".").filter(Boolean);
  if (!parts.length) return;
  let owner = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (!owner[key] || typeof owner[key] !== "object" || Array.isArray(owner[key])) {
      owner[key] = {};
    }
    owner = owner[key];
  }
  const key = parts.at(-1);
  if (value === undefined || value === null || value === "") delete owner[key];
  else owner[key] = value;

  for (let index = parts.length - 1; index > 0; index -= 1) {
    let candidate = target;
    for (let offset = 0; offset < index; offset += 1) candidate = candidate[parts[offset]];
    if (
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      Object.keys(candidate).length === 0
    ) {
      let parent = target;
      for (let offset = 0; offset < index - 1; offset += 1) parent = parent[parts[offset]];
      delete parent[parts[index - 1]];
    }
  }
}

function operationRoots(entries) {
  return entries.filter((entry) => !entries.some(
    (ancestor) => ancestor.element.type === "group" &&
      entry.sourcePath.startsWith(`${ancestor.sourcePath}.children[`),
  ));
}

function updateProperty(element, path, value) {
  setNested(element, path, value);
  if (element.type === "connector" && path === "routing" && value !== "polyline") {
    delete element.points;
  }
}

function supportsBatchProperty(element, path) {
  if (typeof path !== "string") return false;
  const [field, nested, ...rest] = path.split(".");
  if (["id", "type", "children", "parent", "layout"].includes(field)) return false;
  const properties = architectureContract.elements[element.type]?.properties;
  if (!properties || !Object.hasOwn(properties, field)) return false;
  if (nested === undefined) return true;
  return field === "style" && rest.length === 0 &&
    Object.hasOwn(architectureContract.definitions.style.properties, nested);
}

function finiteValues(value) {
  if (typeof value === "number") return Number.isFinite(value);
  if (value && typeof value === "object") return Object.values(value).every(finiteValues);
  return true;
}

function sharedDisplacement(boxes, dx, dy) {
  return {
    dx: round(clamp(dx,
      Math.max(...boxes.map((box) => COORDINATE_MIN - box.x)),
      Math.min(...boxes.map((box) => COORDINATE_MAX - box.x)))),
    dy: round(clamp(dy,
      Math.max(...boxes.map((box) => COORDINATE_MIN - box.y)),
      Math.min(...boxes.map((box) => COORDINATE_MAX - box.y)))),
  };
}

function remapCloneIds(raw, elements) {
  const copies = clone(elements);
  const mapping = new Map();
  const reserved = new Set(rawEntries(raw).map((entry) => entry.element.id).filter(Boolean));
  const reserveId = (base) => {
    const normalized = String(base || "element")
      .replace(/^[^A-Za-z]+/, "")
      .replace(/[^A-Za-z0-9_.-]+/g, "-")
      .slice(0, 54) || "element";
    for (let index = 1; index < 10_000; index += 1) {
      const candidate = `${normalized}${index === 1 ? "" : `-${index}`}`.slice(0, 64);
      if (!reserved.has(candidate) && ID_PATTERN.test(candidate)) {
        reserved.add(candidate);
        return candidate;
      }
    }
    throw new Error("Could not generate a unique element id.");
  };
  const reserve = (item) => {
    if (!item || typeof item !== "object") return;
    if (typeof item.id === "string") {
      const replacement = reserveId(`${item.id}-copy`);
      mapping.set(item.id, replacement);
      item.id = replacement;
    }
    if (Array.isArray(item.children)) item.children.forEach(reserve);
  };
  copies.forEach(reserve);
  const updateConnectors = (item) => {
    if (!item || typeof item !== "object") return;
    if (item.type === "connector") {
      if (mapping.has(item.from)) item.from = mapping.get(item.from);
      if (mapping.has(item.to)) item.to = mapping.get(item.to);
    }
    if (Array.isArray(item.children)) item.children.forEach(updateConnectors);
  };
  copies.forEach(updateConnectors);
  return copies;
}

export function createArchitectureDocument(source, options = {}) {
  const historyLimit = Math.max(1, Math.trunc(options.historyLimit ?? HISTORY_LIMIT));
  const history = [snapshot(source)];
  let cursor = 0;

  function current() {
    return history[cursor];
  }

  function result(reason, details = {}) {
    return {
      ok: true,
      reason,
      ...details,
      source: current().source,
      model: current().model,
    };
  }

  function reject(reason, details = {}) {
    return { ok: false, reason, ...details };
  }

  function commit(raw, reason, details = {}) {
    if (JSON.stringify(raw) === JSON.stringify(current().raw)) {
      return reject("unchanged", details);
    }
    const sourceText = serializeArchitecture(raw);
    let next;
    try {
      next = snapshot(sourceText);
    } catch (error) {
      return reject("rejected", { message: error?.message || "Invalid Architecture DSL." });
    }
    history.splice(cursor + 1);
    history.push(next);
    while (history.length > historyLimit) history.shift();
    cursor = history.length - 1;
    return result(reason, details);
  }

  function mutate(reason, mutator) {
    const raw = clone(current().raw);
    let details;
    try {
      details = mutator(raw) ?? {};
    } catch (error) {
      return reject("rejected", { message: error?.message || "The edit could not be applied." });
    }
    if (details?.ok === false) return details;
    return commit(raw, reason, details);
  }

  function selection(raw, refs) {
    if (!Array.isArray(refs)) return reject("invalid-selection", { refs: [] });
    if (!refs.length) return reject("empty-selection", { refs: [] });
    const entries = [];
    const seen = new Set();
    for (const ref of refs) {
      const entry = typeof ref === "string" ? rawEntry(raw, ref) : null;
      if (!entry) return reject("unknown", { refs, invalidRef: ref });
      if (seen.has(entry.element)) continue;
      seen.add(entry.element);
      entries.push(entry);
    }
    return { entries, refs: entries.map((entry) => entry.ref) };
  }

  function mutateMany(reason, refs, mutator) {
    const edited = mutate(reason, (raw) => {
      const selected = selection(raw, refs);
      if (selected.ok === false) return selected;
      return mutator(raw, selected);
    });
    return { refs: Array.isArray(refs) ? refs : [], ...edited };
  }

  function describe(ref) {
    const element = modelElement(current().model, ref);
    if (!element) return { found: false, movable: false, reason: "unknown", ref };
    if (element.type === "connector") {
      return { found: true, movable: false, reason: "connector", ref: element.sourcePath };
    }
    return describePlacement(current().model, element.id);
  }

  function setRoot(path, value) {
    const allowed = new Set(["title", "description", "canvas.width", "canvas.height"]);
    if (!allowed.has(path)) return reject("unsupported-property", { path });
    return mutate("root-updated", (raw) => {
      setNested(raw, path, value);
      return { path, value };
    });
  }

  function setElement(ref, path, value) {
    if (path === "type" || path === "children" || path.startsWith("children.")) {
      return reject("unsupported-property", { path });
    }
    if (path === "id") return renameElement(ref, value);
    if (["x", "y", "width", "height"].includes(path)) {
      const element = modelElement(current().model, ref);
      if (element && element.type !== "connector") {
        const placement = describePlacement(current().model, element.id);
        if (!placement.movable) return { ...placement, ok: false };
      }
    }
    return mutate("element-updated", (raw) => {
      const entry = rawEntry(raw, ref);
      if (!entry) return reject("unknown", { ref });
      updateProperty(entry.element, path, value);
      return { ref: entry.element.id || entry.sourcePath, path, value };
    });
  }

  function setElements(refs, path, value) {
    return mutateMany("elements-updated", refs, (_raw, selected) => {
      if (!finiteValues(value)) return reject("invalid-value", { refs: selected.refs, path });
      for (const entry of selected.entries) {
        if (!supportsBatchProperty(entry.element, path)) {
          return reject("unsupported-property", { refs: selected.refs, path });
        }
        if (["x", "y", "width", "height"].includes(path)) {
          const placement = describePlacement(current().model, entry.element.id);
          if (!placement.movable) return { ...placement, ok: false, refs: selected.refs };
        }
      }
      for (const entry of selected.entries) updateProperty(entry.element, path, value);
      return { refs: selected.refs, path, value };
    });
  }

  function renameElement(ref, id) {
    const next = String(id || "").trim();
    if (!ID_PATTERN.test(next)) return reject("invalid-id", { id: next });
    return mutate("element-renamed", (raw) => {
      const entry = rawEntry(raw, ref);
      if (!entry || entry.element.type === "connector") return reject("unknown", { ref });
      if (
        rawEntries(raw).some(
          (candidate) => candidate !== entry && candidate.element.id === next,
        )
      ) {
        return reject("duplicate-id", { id: next });
      }
      const previous = entry.element.id;
      entry.element.id = next;
      for (const candidate of rawEntries(raw)) {
        if (candidate.element.type !== "connector") continue;
        if (candidate.element.from === previous) candidate.element.from = next;
        if (candidate.element.to === previous) candidate.element.to = next;
      }
      return { ref: next, previous, id: next };
    });
  }

  function move(ref, dx, dy) {
    const element = modelElement(current().model, ref);
    if (!element || element.type === "connector") return reject("unknown", { ref });
    const legacy = createArchitectureEditSession(current().source);
    const moved = legacy.move(element.id, Number(dx), Number(dy));
    if (!moved.ok) return moved;
    return commit(JSON.parse(legacy.source), "moved", {
      ref: element.id,
      x: moved.x,
      y: moved.y,
    });
  }

  function moveMany(refs, dx, dy) {
    return mutateMany("moved", refs, (_raw, selected) => {
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
        return reject("invalid-displacement", { refs: selected.refs });
      }
      const roots = operationRoots(selected.entries)
        .filter((entry) => entry.element.type !== "connector");
      if (!roots.length) return reject("connector-only", { refs: selected.refs });
      const boxes = [];
      for (const entry of roots) {
        const placement = describePlacement(current().model, entry.element.id);
        if (!placement.movable) return { ...placement, ok: false, refs: selected.refs };
        const element = modelElement(current().model, entry.ref);
        boxes.push({
          x: round(element.x - placement.origin.x),
          y: round(element.y - placement.origin.y),
        });
      }
      const delta = sharedDisplacement(boxes, dx, dy);
      if (!delta.dx && !delta.dy) return reject("unchanged", { refs: selected.refs, ...delta });
      roots.forEach((entry, index) => {
        entry.element.x = round(boxes[index].x + delta.dx);
        entry.element.y = round(boxes[index].y + delta.dy);
      });
      return { refs: selected.refs, ...delta };
    });
  }

  function resize(ref, box) {
    const element = modelElement(current().model, ref);
    if (!element || element.type === "connector") return reject("unknown", { ref });
    const placement = describePlacement(current().model, element.id);
    if (!placement.movable) return { ...placement, ok: false };
    return mutate("resized", (raw) => {
      const located = resolveRawElement(raw, element.sourcePath);
      if (!located) return reject("unknown", { ref });
      const x = clamp(round(Number(box.x) - placement.origin.x), COORDINATE_MIN, COORDINATE_MAX);
      const y = clamp(round(Number(box.y) - placement.origin.y), COORDINATE_MIN, COORDINATE_MAX);
      const width = clamp(round(Number(box.width)), EXTENT_MIN, EXTENT_MAX);
      const height = clamp(round(Number(box.height)), EXTENT_MIN, EXTENT_MAX);
      located.element.x = x;
      located.element.y = y;
      located.element.width = width;
      located.element.height = height;
      return { ref: element.id, x, y, width, height };
    });
  }

  function targetItems(raw, parentId) {
    if (!parentId) return raw.elements;
    const parent = rawEntry(raw, parentId);
    if (!parent || parent.element.type !== "group") return null;
    if (!Array.isArray(parent.element.children)) parent.element.children = [];
    return parent.element.children;
  }

  function defaultBox(items) {
    const count = items.filter(
      (item) => item?.type === "node" || item?.type === "group" || item?.type === "image",
    ).length;
    return { x: 80 + count * 30, y: 80 + count * 30, width: 260, height: 140 };
  }

  function requestedBox(items, options, width, height) {
    const box = { ...defaultBox(items), width, height };
    if (Number.isFinite(Number(options.x))) {
      box.x = clamp(round(Number(options.x)), COORDINATE_MIN, COORDINATE_MAX);
    }
    if (Number.isFinite(Number(options.y))) {
      box.y = clamp(round(Number(options.y)), COORDINATE_MIN, COORDINATE_MAX);
    }
    return box;
  }

  function addNode(options = {}) {
    return mutate("node-added", (raw) => {
      const items = targetItems(raw, options.parentId);
      if (!items) return reject("invalid-parent", { parentId: options.parentId });
      const parent = options.parentId ? rawEntry(raw, options.parentId)?.element : null;
      const id = nextId(raw, options.id || "node");
      const node = {
        type: "node",
        id,
        shape: options.shape || "rounded-rect",
        text: options.text || "Node",
      };
      if (!parent?.layout) Object.assign(node, requestedBox(items, options, 260, 140));
      items.push(node);
      return { ref: id, id };
    });
  }

  function addGroup(options = {}) {
    return mutate("group-added", (raw) => {
      const items = targetItems(raw, options.parentId);
      if (!items) return reject("invalid-parent", { parentId: options.parentId });
      const parent = options.parentId ? rawEntry(raw, options.parentId)?.element : null;
      const id = nextId(raw, options.id || "group");
      const group = {
        type: "group",
        id,
        title: options.title || "Group",
        children: [],
      };
      if (!parent?.layout) Object.assign(group, requestedBox(items, options, 520, 320));
      items.push(group);
      return { ref: id, id };
    });
  }

  function addImage(options = {}) {
    return mutate("image-added", (raw) => {
      const items = targetItems(raw, options.parentId);
      if (!items) return reject("invalid-parent", { parentId: options.parentId });
      const parent = options.parentId ? rawEntry(raw, options.parentId)?.element : null;
      const src = String(options.src || "").trim();
      const filename = src.split("/").at(-1) || "Image";
      const id = nextId(raw, options.id || filename.replace(/\.[^.]+$/, "") || "image");
      const image = {
        type: "image",
        id,
        src,
        fit: options.fit || "contain",
        ariaLabel: options.ariaLabel || filename,
      };
      if (!parent?.layout) Object.assign(image, requestedBox(items, options, 340, 220));
      items.push(image);
      return { ref: id, id };
    });
  }

  function addConnector(options = {}) {
    return mutate("connector-added", (raw) => {
      const endpointIds = new Set(
        rawEntries(raw)
          .filter((entry) => entry.element.type !== "connector")
          .map((entry) => entry.element.id),
      );
      if (!endpointIds.has(options.from) || !endpointIds.has(options.to)) {
        return reject("invalid-endpoint", { from: options.from, to: options.to });
      }
      const items = targetItems(raw, options.parentId);
      if (!items) return reject("invalid-parent", { parentId: options.parentId });
      const connector = {
        type: "connector",
        from: options.from,
        to: options.to,
        routing: options.routing || "orthogonal",
        arrow: options.arrow !== false,
      };
      if (options.label) connector.label = options.label;
      if (options.labelLayer) connector.labelLayer = options.labelLayer;
      items.push(connector);
      return { from: connector.from, to: connector.to };
    });
  }

  function remove(ref) {
    return mutate("element-deleted", (raw) => {
      const entry = rawEntry(raw, ref);
      if (!entry) return reject("unknown", { ref });
      const ids = new Set();
      collectIds(entry.element, ids);
      entry.items.splice(entry.index, 1);
      if (ids.size) removeReferencingConnectors(raw.elements, ids);
      return { ref, removedIds: [...ids] };
    });
  }

  function removeMany(refs) {
    return mutateMany("elements-deleted", refs, (raw, selected) => {
      const roots = operationRoots(selected.entries);
      const ids = new Set();
      roots.forEach((entry) => collectIds(entry.element, ids));
      for (const entry of roots) {
        entry.items.splice(entry.items.indexOf(entry.element), 1);
      }
      if (ids.size) removeReferencingConnectors(raw.elements, ids);
      return { refs: [], removedIds: [...ids] };
    });
  }

  function duplicate(ref) {
    return mutate("element-duplicated", (raw) => {
      const entry = rawEntry(raw, ref);
      if (!entry) return reject("unknown", { ref });
      const copy =
        entry.element.type === "connector"
          ? clone(entry.element)
          : remapCloneIds(raw, [entry.element])[0];
      if (typeof copy.x === "number") copy.x = clamp(copy.x + 24, COORDINATE_MIN, COORDINATE_MAX);
      if (typeof copy.y === "number") copy.y = clamp(copy.y + 24, COORDINATE_MIN, COORDINATE_MAX);
      entry.items.splice(entry.index + 1, 0, copy);
      const copyPath = entry.sourcePath.replace(/\[\d+\]$/, `[${entry.index + 1}]`);
      return { ref: copy.id || copyPath, id: copy.id };
    });
  }

  function duplicateMany(refs) {
    return mutateMany("elements-duplicated", refs, (raw, selected) => {
      const roots = operationRoots(selected.entries);
      const copies = remapCloneIds(raw, roots.map((entry) => entry.element));
      const boxes = roots.map((entry) => {
        if (entry.element.type === "connector") return null;
        const placement = describePlacement(current().model, entry.element.id);
        if (!placement.movable) return null;
        const element = modelElement(current().model, entry.ref);
        return {
          x: round(element.x - placement.origin.x),
          y: round(element.y - placement.origin.y),
        };
      });
      const movableBoxes = boxes.filter(Boolean);
      const delta = movableBoxes.length ? sharedDisplacement(movableBoxes, 24, 24) : { dx: 0, dy: 0 };
      roots.forEach((entry, index) => {
        const copy = copies[index];
        if (boxes[index]) {
          copy.x = round(boxes[index].x + delta.dx);
          copy.y = round(boxes[index].y + delta.dy);
        }
        entry.items.splice(entry.items.indexOf(entry.element) + 1, 0, copy);
      });
      // Source paths belong to the final arrays, not the insertion-time indexes.
      const inserted = new Map(rawEntries(raw).map((entry) => [entry.element, entry.ref]));
      return { refs: copies.map((copy) => inserted.get(copy)), ...delta };
    });
  }

  function reorder(ref, delta) {
    return mutate("element-reordered", (raw) => {
      const entry = rawEntry(raw, ref);
      if (!entry) return reject("unknown", { ref });
      const target = clamp(entry.index + Math.trunc(delta), 0, entry.items.length - 1);
      if (target === entry.index) return reject("unchanged", { ref });
      const [element] = entry.items.splice(entry.index, 1);
      entry.items.splice(target, 0, element);
      return { ref, index: target };
    });
  }

  function reparent(ref, parentId) {
    const element = modelElement(current().model, ref);
    if (!element || element.type === "connector") return reject("unknown", { ref });
    return mutate("element-reparented", (raw) => {
      const entry = rawEntry(raw, ref);
      const target = parentId ? rawEntry(raw, parentId) : null;
      if (!entry) return reject("unknown", { ref });
      if (parentId && (!target || target.element.type !== "group")) {
        return reject("invalid-parent", { parentId });
      }
      const descendants = new Set();
      collectIds(entry.element, descendants);
      if (parentId && descendants.has(parentId)) return reject("cyclic-parent", { parentId });
      const targetList = targetItems(raw, parentId);
      const placement = describePlacement(current().model, element.id);
      entry.items.splice(entry.index, 1);
      if (!target?.element.layout) {
        const parentModel = target ? modelElement(current().model, parentId) : null;
        entry.element.x = round(element.x - (parentModel?.x || 0));
        entry.element.y = round(element.y - (parentModel?.y || 0));
        entry.element.width = round(element.width);
        entry.element.height = round(element.height);
      } else if (placement.movable) {
        delete entry.element.x;
        delete entry.element.y;
      }
      targetList.push(entry.element);
      return { ref: entry.element.id, parentId: parentId || null };
    });
  }

  function releaseLayout(ref) {
    const element = modelElement(current().model, ref);
    const groupId =
      element?.type === "group" && element.layout
        ? element.id
        : element?.id
          ? describePlacement(current().model, element.id).layoutOwner
          : null;
    if (!groupId) return reject("not-layout-managed", { ref });
    const legacy = createArchitectureEditSession(current().source);
    const released = legacy.releaseLayout(groupId);
    if (!released.ok) return released;
    return commit(JSON.parse(legacy.source), "layout-released", released);
  }

  function setGroupLayout(ref, layout) {
    return mutate("group-layout-updated", (raw) => {
      const entry = rawEntry(raw, ref);
      if (!entry || entry.element.type !== "group") {
        return reject("not-group", { ref });
      }
      const enabling = !entry.element.layout;
      entry.element.layout = clone(layout);
      for (const child of entry.element.children || []) {
        if (child.type === "connector") continue;
        delete child.x;
        delete child.y;
        if (enabling) {
          delete child.width;
          delete child.height;
        }
      }
      return { ref: entry.element.id, layout: clone(layout) };
    });
  }

  return {
    get source() {
      return current().source;
    },
    get model() {
      return current().model;
    },
    get raw() {
      return clone(current().raw);
    },
    get canUndo() {
      return cursor > 0;
    },
    get canRedo() {
      return cursor < history.length - 1;
    },
    get depth() {
      return history.length;
    },
    describe,
    setRoot,
    setElement,
    setElements,
    renameElement,
    move,
    moveMany,
    resize,
    addNode,
    addGroup,
    addImage,
    addConnector,
    remove,
    removeMany,
    duplicate,
    duplicateMany,
    reorder,
    reparent,
    releaseLayout,
    setGroupLayout,
    undo() {
      if (cursor === 0) return reject("no-history");
      cursor -= 1;
      return result("undone");
    },
    redo() {
      if (cursor >= history.length - 1) return reject("no-history");
      cursor += 1;
      return result("redone");
    },
  };
}
