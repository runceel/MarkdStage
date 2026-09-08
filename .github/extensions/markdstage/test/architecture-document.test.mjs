import assert from "node:assert/strict";
import test from "node:test";

import { createArchitectureDocument } from "../renderer/architecture-document.mjs";
import { parseArchitecture } from "../renderer/architecture.mjs";

const FIXTURE = {
  version: 1,
  canvas: { width: 1600, height: 900 },
  title: "Editor fixture",
  elements: [
    {
      type: "node",
      id: "client",
      x: 80,
      y: 120,
      width: 240,
      height: 120,
      text: "Client",
    },
    {
      type: "group",
      id: "zone",
      x: 500,
      y: 100,
      width: 700,
      height: 500,
      layout: { type: "row", gap: 40, padding: 50 },
      children: [
        { type: "node", id: "api", text: "API" },
        { type: "node", id: "db", text: "Database" },
      ],
    },
    {
      type: "connector",
      from: "client",
      to: "api",
      routing: "orthogonal",
      arrow: true,
    },
  ],
};

const source = `${JSON.stringify(FIXTURE, null, 2)}\n`;

function raw(document) {
  return JSON.parse(document.source);
}

test("creates a canonical editable document from an empty block", () => {
  const document = createArchitectureDocument("\n");
  assert.deepEqual(raw(document), { version: 1, elements: [] });
  assert.deepEqual(document.model.elements, []);

  const added = document.addNode({ text: "First node" });
  assert.equal(added.ok, true);
  assert.equal(raw(document).elements[0].text, "First node");
  assert.doesNotThrow(() => parseArchitecture(document.source));
});

test("updates root and element properties and renames while preserving connector references", () => {
  const document = createArchitectureDocument(source);
  assert.equal(document.setRoot("title", "Updated").ok, true);
  assert.equal(document.setElement("client", "text", "Browser").ok, true);
  assert.equal(document.renameElement("client", "web-client").ok, true);

  const result = raw(document);
  assert.equal(result.title, "Updated");
  assert.equal(result.elements[0].id, "web-client");
  assert.equal(result.elements[0].text, "Browser");
  assert.equal(result.elements[2].from, "web-client");
  assert.doesNotThrow(() => parseArchitecture(document.source));
});

test("adding and duplicating nodes, groups, and connectors creates valid DSL with unique IDs", () => {
  const document = createArchitectureDocument(source);
  const node = document.addNode({ parentId: "zone", text: "Worker" });
  assert.equal(node.ok, true);
  assert.equal(document.addGroup().ok, true);
  assert.equal(
    document.addConnector({
      from: "client",
      to: node.id,
      label: "dispatches",
      labelLayer: "behind",
    }).ok,
    true,
  );
  const copy = document.duplicate("zone");
  assert.equal(copy.ok, true);
  assert.notEqual(copy.id, "zone");

  const model = parseArchitecture(document.source);
  const ids = model.elements.filter((element) => element.id).map((element) => element.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(model.elements.some((element) => element.id === node.id));
  assert.ok(model.elements.some((element) => element.id === copy.id));
  const addedConnector = model.elements.find(
    (element) =>
      element.type === "connector" &&
      element.from === "client" &&
      element.to === node.id,
  );
  assert.equal(addedConnector.label, "dispatches");
  assert.equal(addedConnector.labelLayer, "behind");
});

test("duplicating a connector returns an existing source path that can be duplicated again", () => {
  const document = createArchitectureDocument(source);
  const first = document.duplicate("elements[2]");
  assert.equal(first.ok, true);
  assert.equal(first.ref, "elements[3]");
  const second = document.duplicate(first.ref);
  assert.equal(second.ok, true);
  assert.equal(second.ref, "elements[4]");
  assert.equal(
    document.model.elements.filter((element) => element.type === "connector").length,
    3,
  );
});

test("node and group coordinates apply to fixed placement and are omitted under layout management", () => {
  const document = createArchitectureDocument(source);
  const rootNode = document.addNode({ x: 340, y: 260 });
  const layoutNode = document.addNode({ parentId: "zone", x: 30, y: 40 });
  assert.equal(rootNode.ok, true);
  assert.equal(layoutNode.ok, true);

  let result = raw(document);
  assert.deepEqual(
    result.elements.find((element) => element.id === rootNode.id),
    {
      type: "node",
      id: rootNode.id,
      shape: "rounded-rect",
      text: "Node",
      x: 340,
      y: 260,
      width: 260,
      height: 140,
    },
  );
  const zone = result.elements.find((element) => element.id === "zone");
  const managed = zone.children.find((element) => element.id === layoutNode.id);
  assert.equal(managed.x, undefined);
  assert.equal(managed.y, undefined);

  assert.equal(document.releaseLayout("zone").ok, true);
  const childGroup = document.addGroup({ parentId: "zone", x: -5000, y: 5000 });
  assert.equal(childGroup.ok, true);
  result = raw(document);
  const positioned = result.elements
    .find((element) => element.id === "zone")
    .children.find((element) => element.id === childGroup.id);
  assert.equal(positioned.x, -4000);
  assert.equal(positioned.y, 4000);
  assert.doesNotThrow(() => parseArchitecture(document.source));
});

test("images integrate with add, edit, placement, connectors, and undo/redo", () => {
  const document = createArchitectureDocument(source);
  const rootImage = document.addImage({
    src: "assets/hero.png",
    x: 320,
    y: 300,
    fit: "cover",
  });
  const layoutImage = document.addImage({
    parentId: "zone",
    src: "assets/logo.svg",
  });
  assert.equal(rootImage.ok, true);
  assert.equal(layoutImage.ok, true);

  let result = raw(document);
  const image = result.elements.find((element) => element.id === rootImage.id);
  assert.deepEqual(image, {
    type: "image",
    id: rootImage.id,
    src: "assets/hero.png",
    fit: "cover",
    ariaLabel: "hero.png",
    x: 320,
    y: 300,
    width: 340,
    height: 220,
  });
  const zone = result.elements.find((element) => element.id === "zone");
  const managedImage = zone.children.find((element) => element.id === layoutImage.id);
  assert.equal(managedImage.x, undefined);
  assert.equal(managedImage.width, undefined);

  assert.equal(document.addConnector({ from: rootImage.id, to: "client" }).ok, true);
  assert.equal(document.renameElement(rootImage.id, "hero-image").ok, true);
  assert.equal(document.setElement("hero-image", "fit", "stretch").ok, true);
  assert.equal(document.setElement("hero-image", "src", "assets/hero-wide.webp").ok, true);
  assert.equal(document.move("hero-image", 20, -10).ok, true);
  assert.equal(
    document.resize("hero-image", { x: 350, y: 310, width: 500, height: 260 }).ok,
    true,
  );
  const copy = document.duplicate("hero-image");
  assert.equal(copy.ok, true);
  assert.notEqual(copy.id, "hero-image");
  result = raw(document);
  assert.ok(
    result.elements.some(
      (element) =>
        element.type === "connector" &&
        element.from === "hero-image" &&
        element.to === "client",
    ),
  );
  assert.equal(
    result.elements.find((element) => element.id === "hero-image").fit,
    "stretch",
  );

  assert.equal(document.remove("hero-image").ok, true);
  assert.equal(
    raw(document).elements.some(
      (element) => element.type === "connector" && element.from === "hero-image",
    ),
    false,
  );
  assert.equal(document.undo().ok, true);
  assert.ok(document.model.elements.some((element) => element.id === "hero-image"));
  assert.equal(document.redo().ok, true);
  assert.equal(document.model.elements.some((element) => element.id === "hero-image"), false);
  assert.doesNotThrow(() => parseArchitecture(document.source));
});

test("deleting a group cascades to connectors referencing descendants", () => {
  const document = createArchitectureDocument(source);
  assert.equal(document.remove("zone").ok, true);
  const result = raw(document);
  assert.deepEqual(result.elements.map((element) => element.id).filter(Boolean), ["client"]);
  assert.equal(
    result.elements.some((element) => element.type === "connector"),
    false,
  );
  assert.doesNotThrow(() => parseArchitecture(document.source));
});

test("rejects layout-managed geometry instead of silently ignoring it and permits edits after release", () => {
  const document = createArchitectureDocument(source);
  const rejected = document.setElement("api", "x", 100);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, "layout-managed");
  assert.equal(document.source, source);

  assert.equal(document.releaseLayout("api").ok, true);
  assert.equal(document.setElement("api", "x", 100).ok, true);
  assert.equal(document.resize("api", { x: 700, y: 240, width: 320, height: 180 }).ok, true);
  assert.doesNotThrow(() => parseArchitecture(document.source));
});

test("reenabling group layout atomically returns child coordinates to layout management", () => {
  const document = createArchitectureDocument(source);
  assert.equal(document.releaseLayout("zone").ok, true);
  const released = raw(document).elements.find((element) => element.id === "zone");
  assert.equal(typeof released.children[0].x, "number");
  assert.equal(typeof released.children[0].y, "number");

  assert.equal(
    document.setGroupLayout("zone", {
      type: "grid",
      gap: 28,
      rowGap: 20,
      columnGap: 32,
      padding: 44,
      columns: 2,
    }).ok,
    true,
  );
  const managed = raw(document).elements.find((element) => element.id === "zone");
  assert.deepEqual(managed.layout, {
    type: "grid",
    gap: 28,
    rowGap: 20,
    columnGap: 32,
    padding: 44,
    columns: 2,
  });
  assert.equal(managed.children[0].x, undefined);
  assert.equal(managed.children[0].y, undefined);
  assert.equal(managed.children[0].width, undefined);
  assert.equal(managed.children[0].height, undefined);
  assert.doesNotThrow(() => parseArchitecture(document.source));

  assert.equal(document.undo().ok, true);
  assert.equal(raw(document).elements.find((element) => element.id === "zone").layout, undefined);
  assert.equal(document.setGroupLayout("client", { type: "row" }).reason, "not-group");
});

test("reparenting preserves visual absolute position and rejects cycles", () => {
  const document = createArchitectureDocument(source);
  const before = document.model.elements.find((element) => element.id === "client");
  assert.equal(document.releaseLayout("zone").ok, true);
  assert.equal(document.reparent("client", "zone").ok, true);
  const after = document.model.elements.find((element) => element.id === "client");
  assert.deepEqual(
    { x: after.x, y: after.y, width: after.width, height: after.height },
    { x: before.x, y: before.y, width: before.width, height: before.height },
  );
  assert.equal(document.reparent("zone", "zone").reason, "cyclic-parent");
});

test("undo and redo traverse additions, deletions, and property changes only within the draft", () => {
  const document = createArchitectureDocument(source);
  document.addNode();
  document.setRoot("description", "Draft");
  document.remove("client");
  assert.equal(document.canUndo, true);

  document.undo();
  assert.ok(document.model.elements.some((element) => element.id === "client"));
  document.undo();
  assert.equal(raw(document).description, undefined);
  document.redo();
  assert.equal(raw(document).description, "Draft");
});

function node(id, x = 100, y = 100) {
  return { type: "node", id, x, y, width: 100, height: 80, text: id };
}

function group(id, children, x = 300, y = 300) {
  return { type: "group", id, x, y, width: 500, height: 400, children };
}

function batchDocument(elements) {
  return createArchitectureDocument(JSON.stringify({ version: 1, elements }));
}

function assertRejectedUnchanged(document, operation, reason) {
  const before = document.source;
  const depth = document.depth;
  const canRedo = document.canRedo;
  const result = operation();
  assert.equal(result.ok, false);
  if (reason) assert.equal(result.reason, reason);
  assert.ok(Array.isArray(result.refs));
  assert.equal(Object.hasOwn(result, "ref"), false);
  assert.equal(document.source, before);
  assert.equal(document.depth, depth);
  assert.equal(document.canRedo, canRedo);
  return result;
}

test("batch move deduplicates aliases and parent descendants while retaining the selection", () => {
  const document = createArchitectureDocument(source);
  const beforeApi = document.model.elements.find((element) => element.id === "api");
  const moved = document.moveMany(["api", "zone", "zone", "elements[1]", "elements[2]"], 25, -10);
  assert.equal(moved.ok, true);
  assert.deepEqual(moved.refs, ["api", "zone", "elements[2]"]);
  assert.equal(Object.hasOwn(moved, "ref"), false);
  assert.deepEqual({ dx: moved.dx, dy: moved.dy }, { dx: 25, dy: -10 });
  const result = raw(document);
  assert.equal(result.elements[1].x, 525);
  assert.equal(result.elements[1].y, 90);
  assert.deepEqual(result.elements[1].children, FIXTURE.elements[1].children);
  assert.deepEqual(result.elements[2], FIXTURE.elements[2]);
  const afterApi = document.model.elements.find((element) => element.id === "api");
  assert.equal(afterApi.x - beforeApi.x, 25);
  assert.equal(afterApi.y - beforeApi.y, -10);
  assert.equal(document.depth, 2);
});

test("batch move uses parent-relative boundaries and one shared delta across different parents", () => {
  const document = batchDocument([
    group("left", [node("a", 3990, -3995)], 1000, 500),
    group("right", [node("b", -3000, 50)], -1000, -500),
  ]);
  const before = document.model.elements.filter((element) => ["a", "b"].includes(element.id));
  const result = document.moveMany(["a", "b"], 100, -100);
  assert.equal(result.ok, true);
  assert.deepEqual({ dx: result.dx, dy: result.dy }, { dx: 10, dy: -5 });
  const after = document.model.elements.filter((element) => ["a", "b"].includes(element.id));
  after.forEach((element, index) => {
    assert.equal(element.x - before[index].x, 10);
    assert.equal(element.y - before[index].y, -5);
  });
  assert.equal(raw(document).elements[0].children[0].x, 4000);
  assert.equal(raw(document).elements[0].children[0].y, -4000);
  assert.equal(raw(document).elements[1].children[0].x, -2990);
  assertRejectedUnchanged(document, () => document.moveMany(["a", "b"], 100, -100), "unchanged");
});

test("batch move rejects layout-managed roots atomically but can move a containing selected group", () => {
  const document = createArchitectureDocument(source);
  const rejected = assertRejectedUnchanged(
    document, () => document.moveMany(["client", "api"], 20, 30), "layout-managed",
  );
  assert.equal(rejected.layoutOwner, "zone");
  assertRejectedUnchanged(document, () => document.moveMany(["client", "api"], 0, 0), "layout-managed");
  assert.equal(document.moveMany(["client", "api", "zone"], 20, 30).ok, true);
  assert.equal(raw(document).elements[0].x, 100);
  assert.equal(raw(document).elements[1].x, 520);
});

test("batch selection validation resolves all refs before any edit, including ignored connectors", () => {
  const document = createArchitectureDocument(source);
  for (const refs of [["client", "missing"], ["zone", "elements[1].children[99]"], ["client", null]]) {
    for (const operation of [
      () => document.moveMany(refs, 10, 10),
      () => document.setElements(refs, "style.opacity", 0.5),
      () => document.removeMany(refs),
      () => document.duplicateMany(refs),
    ]) assertRejectedUnchanged(document, operation, "unknown");
  }
  for (const refs of [[], null, "client", new Set(["client"])]) {
    for (const operation of [
      () => document.moveMany(refs, 10, 10),
      () => document.setElements(refs, "text", "Changed"),
      () => document.removeMany(refs),
      () => document.duplicateMany(refs),
    ]) assertRejectedUnchanged(document, operation, Array.isArray(refs) ? "empty-selection" : "invalid-selection");
  }
  assertRejectedUnchanged(document, () => document.moveMany(["elements[2]"], 10, 0), "connector-only");
  assertRejectedUnchanged(document, () => document.moveMany(["elements[2]", "missing"], 10, 0), "unknown");
  for (const value of [NaN, Infinity, -Infinity, "10", undefined, null]) {
    assertRejectedUnchanged(document, () => document.moveMany(["client"], value, 0), "invalid-displacement");
    assertRejectedUnchanged(document, () => document.moveMany(["client"], 0, value), "invalid-displacement");
  }
});

test("each successful batch is exactly one undo/redo step", () => {
  const operations = [
    (document) => document.moveMany(["client", "zone"], 12, -7),
    (document) => document.setElements(["client", "zone", "elements[2]"], "style.opacity", 0.6),
    (document) => document.removeMany(["client", "zone"]),
    (document) => document.duplicateMany(["client", "zone", "elements[2]"]),
  ];
  for (const operation of operations) {
    const document = createArchitectureDocument(source);
    const before = document.source;
    const result = operation(document);
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.refs));
    assert.equal(Object.hasOwn(result, "ref"), false);
    const after = document.source;
    assert.notEqual(after, before);
    assert.equal(document.depth, 2);
    assert.equal(document.undo().ok, true);
    assert.equal(document.source, before);
    assert.equal(document.canUndo, false);
    assert.equal(document.redo().ok, true);
    assert.equal(document.source, after);
    assert.equal(document.canRedo, false);
  }
});

test("batch common properties update every selected element, including selected descendants", () => {
  const document = createArchitectureDocument(source);
  const updated = document.setElements(["zone", "api", "elements[1]", "client", "elements[2]"], "style.opacity", 0.4);
  assert.equal(updated.ok, true);
  assert.deepEqual(updated.refs, ["zone", "api", "client", "elements[2]"]);
  const result = raw(document);
  assert.equal(result.elements[0].style.opacity, 0.4);
  assert.equal(result.elements[1].style.opacity, 0.4);
  assert.equal(result.elements[1].children[0].style.opacity, 0.4);
  assert.equal(result.elements[1].children[1].style, undefined);
  assert.equal(result.elements[2].style.opacity, 0.4);
  assert.equal(document.setElements(["client", "api"], "shape", "ellipse").ok, true);
});

test("batch property edits reject unsupported structure and inapplicable fields even when clearing them", () => {
  const document = createArchitectureDocument(source);
  for (const path of [
    "id", "id.value", "type", "children", "children.0.x", "parent", "parentId",
    "layout", "layout.type", "unknown", "style.unknown", "style.opacity.extra",
    "__proto__.polluted", "style.__proto__", "style.constructor", "style..opacity", "",
  ]) {
    assertRejectedUnchanged(
      document, () => document.setElements(["zone", "client"], path, undefined), "unsupported-property",
    );
  }
  assertRejectedUnchanged(document, () => document.setElements(["client", "zone"], "text", "New"), "unsupported-property");
  assertRejectedUnchanged(document, () => document.setElements(["client", "zone"], "text", null), "unsupported-property");
  assertRejectedUnchanged(document, () => document.setElements(["client", "elements[2]"], "x", 100), "unsupported-property");
  for (const [path, value] of [
    ["shape", "not-a-shape"], ["style.opacity", 2], ["width", -1],
    ["x", NaN], ["style.opacity", Infinity], ["style", { opacity: NaN }],
  ]) {
    assertRejectedUnchanged(document, () => document.setElements(["client"], path, value));
  }
  assertRejectedUnchanged(document, () => document.setElements(["client", "api"], "width", 100), "layout-managed");
  assertRejectedUnchanged(document, () => document.setElements(["zone", "api"], "x", 100), "layout-managed");
});

test("batch geometry remains parent-relative across parents and validates the entire operation", () => {
  const document = batchDocument([
    group("left", [node("a", 10, 20)], 500, 600),
    group("right", [node("b", 50, 60)], 1000, 1200),
  ]);
  assert.equal(document.setElements(["a", "b"], "x", 75).ok, true);
  assert.equal(raw(document).elements[0].children[0].x, 75);
  assert.equal(raw(document).elements[1].children[0].x, 75);
  assert.equal(document.model.elements.find((element) => element.id === "a").x, 575);
  assert.equal(document.model.elements.find((element) => element.id === "b").x, 1075);
  assertRejectedUnchanged(document, () => document.setElements(["a", "b"], "x", 4001));
});

test("batch connector routing updates clean points and reject invalid points atomically", () => {
  const document = batchDocument([
    node("a"), node("b", 500, 300),
    { type: "connector", from: "a", to: "b", routing: "polyline", points: [{ x: 250, y: 50 }] },
    { type: "connector", from: "b", to: "a", routing: "polyline", points: [{ x: 300, y: 400 }] },
  ]);
  assert.equal(document.setElements(["elements[2]", "elements[3]"], "routing", "orthogonal").ok, true);
  for (const connector of raw(document).elements.slice(2)) {
    assert.equal(connector.routing, "orthogonal");
    assert.equal(connector.points, undefined);
  }
  assertRejectedUnchanged(document, () => document.setElements(["elements[2]", "elements[3]"], "points", [{ x: 5000, y: 0 }]));
  assert.equal(document.undo().ok, true);
  assert.equal(raw(document).elements[2].routing, "polyline");
  assert.equal(raw(document).elements[3].points.length, 1);
});

test("batch no-ops keep source, history, and the redo branch intact", () => {
  const document = createArchitectureDocument(source);
  document.moveMany(["client", "zone"], 10, 10);
  document.undo();
  assertRejectedUnchanged(document, () => document.moveMany(["client", "zone"], 0, 0), "unchanged");
  assertRejectedUnchanged(document, () => document.setElements(["client"], "text", "Client"), "unchanged");
  assertRejectedUnchanged(document, () => document.setElements(["client", "zone"], "style.opacity", undefined), "unchanged");
  assertRejectedUnchanged(document, () => document.setElements(["client"], "width", 0));
  assert.equal(document.redo().ok, true);
  assert.equal(raw(document).elements[0].x, 90);
});

test("batch removal resolves connector paths before splices and cleans dependent nested connectors", () => {
  const document = batchDocument([
    node("a"), node("b", 500),
    { type: "connector", from: "a", to: "b", label: "first" },
    { type: "connector", from: "b", to: "a", label: "second" },
    group("zone", [
      node("child"),
      { type: "connector", from: "child", to: "b", label: "nested" },
    ]),
    { type: "connector", from: "child", to: "a", label: "dependent" },
    { type: "connector", from: "a", to: "b", label: "keep" },
  ]);
  const removed = document.removeMany(["elements[2]", "elements[3]", "child", "zone", "elements[2]"]);
  assert.equal(removed.ok, true);
  assert.deepEqual(removed.refs, []);
  assert.deepEqual(new Set(removed.removedIds), new Set(["zone", "child"]));
  assert.deepEqual(raw(document).elements.map((element) => element.id || element.label), ["a", "b", "keep"]);
  assert.equal(document.undo().ok, true);
  assert.equal(raw(document).elements.length, 7);
});

test("batch duplication shares a global ID map and only copies selected external connectors", () => {
  const document = batchDocument([
    node("a"), node("b", 500), node("external", 800),
    node("a-copy", 1000),
    { type: "connector", from: "a", to: "b", label: "selected" },
    { type: "connector", from: "a", to: "external", label: "external" },
    { type: "connector", from: "b", to: "external", label: "not selected" },
  ]);
  const duplicated = document.duplicateMany(["elements[4]", "b", "elements[5]", "a"]);
  assert.equal(duplicated.ok, true);
  assert.deepEqual(duplicated.refs, ["elements[7]", "b-copy", "elements[9]", "a-copy-2"]);
  const result = raw(document);
  const connectors = result.elements.filter((element) => element.type === "connector");
  assert.equal(connectors.length, 5);
  assert.equal(connectors.filter((element) => element.label === "not selected").length, 1);
  assert.deepEqual(result.elements[7], { type: "connector", from: "a-copy-2", to: "b-copy", label: "selected" });
  assert.deepEqual(result.elements[9], { type: "connector", from: "a-copy-2", to: "external", label: "external" });
  assert.equal(result.elements.find((element) => element.id === "a-copy-2").x, 124);
  assert.equal(result.elements.find((element) => element.id === "b-copy").x, 524);
  assert.equal(document.duplicateMany(duplicated.refs).ok, true);
});

test("batch group duplication deduplicates descendants and remaps links across selected groups", () => {
  const document = batchDocument([
    group("left", [
      node("a"),
      { type: "connector", from: "a", to: "b", label: "cross-group" },
    ], 100, 100),
    group("right", [node("b")], 1000, 100),
    node("external", 1500),
    { type: "connector", from: "a", to: "external", label: "external" },
  ]);
  const result = document.duplicateMany(["a", "left", "elements[0].children[1]", "right"]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.refs, ["left-copy", "right-copy"]);
  const copies = raw(document).elements.filter((element) => result.refs.includes(element.id));
  assert.equal(copies[0].children.length, 2);
  assert.equal(copies[0].children[0].id, "a-copy");
  assert.equal(copies[0].children[1].from, "a-copy");
  assert.equal(copies[0].children[1].to, "b-copy");
  assert.equal(copies[0].children[0].x, 100);
  assert.equal(copies[0].x, 124);
  assert.equal(copies[1].x, 1024);
  assert.equal(raw(document).elements.filter((element) => element.type === "connector").length, 1);
  const ids = document.model.elements.map((element) => element.id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length);
});

test("batch clone connector refs survive insertions in several parent arrays and ancestor arrays", () => {
  const document = batchDocument([
    node("a"), node("b", 700),
    group("zone", [
      { type: "connector", from: "a", to: "b", label: "one" },
      { type: "connector", from: "b", to: "a", label: "two" },
    ]),
    { type: "connector", from: "a", to: "b", label: "three" },
  ]);
  const result = document.duplicateMany([
    "elements[2].children[1]", "elements[3]", "elements[2].children[0]", "a",
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.refs, [
    "elements[3].children[3]", "elements[5]", "elements[3].children[1]", "a-copy",
  ]);
  assert.deepEqual(result.refs.slice(0, 3).map((ref) =>
    document.model.elements.find((element) => element.sourcePath === ref).label),
  ["two", "three", "one"]);
  assert.equal(document.setElements(result.refs.slice(0, 3), "label", "copied").ok, true);
  assert.equal(document.model.elements.filter((element) => element.label === "copied").length, 3);
  assert.equal(document.model.elements.filter((element) => ["one", "two", "three"].includes(element.label)).length, 3);
});

test("batch duplication shares its boundary offset and leaves layout-managed clones in the layout", () => {
  const document = batchDocument([node("a", 3995, -4000), node("b", -100, 3990)]);
  const result = document.duplicateMany(["a", "b"]);
  assert.equal(result.ok, true);
  assert.deepEqual({ dx: result.dx, dy: result.dy }, { dx: 5, dy: 10 });
  assert.deepEqual(raw(document).elements.filter((element) => result.refs.includes(element.id))
    .map((element) => [element.x, element.y]), [[4000, -3990], [-95, 4000]]);

  const managed = createArchitectureDocument(source);
  const copies = managed.duplicateMany(["api", "db"]);
  assert.equal(copies.ok, true);
  assert.deepEqual(copies.refs, ["api-copy", "db-copy"]);
  for (const child of raw(managed).elements[1].children) {
    assert.equal(child.x, undefined);
    assert.equal(child.y, undefined);
  }
});

test("batch duplication rejects document limits without committing any clones", () => {
  const document = batchDocument(Array.from({ length: 199 }, (_, index) => node(`n${index}`)));
  assertRejectedUnchanged(document, () => document.duplicateMany(["n0", "n1"]));
  assert.equal(document.model.elements.length, 199);
});
