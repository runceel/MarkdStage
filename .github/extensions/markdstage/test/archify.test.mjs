import assert from "node:assert/strict";
import test from "node:test";

import {
  ARCHIFY_COMPONENT_KINDS,
  ARCHIFY_SIGIL_ICONS,
  ArchifyError,
  archifySvgToScene,
  derivePalette,
  MAX_ARCHIFY_SOURCE_LENGTH,
  parseArchifySource,
} from "../renderer/archify.mjs";
import { contrastRatio, parseRgb } from "../renderer/oklch.mjs";
import { ICONS } from "../renderer/architecture.mjs";
import { placePptxElement } from "../renderer/pptx-placement.mjs";
import { sceneToPptxElements } from "../renderer/scene-pptx.mjs";
import {
  buildPptxPackage,
  inspectPptxPackage,
} from "../runtime/pptx-package.mjs";

const THEMES = {
  dark: {
    accent: "#7dd3fc",
    accentStrong: "#38bdf8",
    surface: "#111827",
    fg: "#e5e7eb",
    muted: "#9ca3af",
    border: "#334155",
  },
  light: {
    accent: "#2563eb",
    accentStrong: "#1d4ed8",
    surface: "#ffffff",
    fg: "#0f172a",
    muted: "#64748b",
    border: "#cbd5e1",
  },
  // A deliberately achromatic accent: the hue wheel the palette rotates through
  // has nothing to rotate, which is the case most likely to collapse to grey.
  monochrome: {
    accent: "#4a4a4a",
    accentStrong: "#2e2e2e",
    surface: "#fafafa",
    fg: "#1a1a1a",
    muted: "#6a6a6a",
    border: "#d4d4d4",
  },
};

/**
 * The smallest element the converter can read.
 *
 * archifySvgToScene walks the tree itself rather than issuing CSS queries, so a
 * test fixture only needs attributes, element children and text - no selector
 * engine, and no dependency on a browser.
 */
class Node {
  constructor(localName, attributes = {}, children = []) {
    this.localName = localName;
    this.attributes = attributes;
    this.children = children;
    this.text = "";
  }

  getAttribute(name) {
    return Object.hasOwn(this.attributes, name) ? String(this.attributes[name]) : null;
  }

  get textContent() {
    return this.text + this.children.map((child) => child.textContent).join("");
  }
}

function element(localName, attributes, children) {
  return new Node(localName, attributes, children);
}

function text(localName, attributes, content) {
  const node = new Node(localName, attributes);
  node.text = content;
  return node;
}

function svg(children, attributes = {}) {
  return element("svg", { viewBox: "0 0 400 300", ...attributes }, children);
}

function convert(root, theme = "dark") {
  return archifySvgToScene(root, { palette: derivePalette(THEMES[theme]) });
}

function nodesOfKind(scene, kind) {
  return scene.nodes.filter((node) => node.kind === kind);
}

// --- fence source ----------------------------------------------------------

test("parseArchifySource accepts a single asset path", () => {
  assert.deepEqual(parseArchifySource("assets/diagram.svg"), { src: "assets/diagram.svg" });
  assert.deepEqual(parseArchifySource("\n  assets/a/b.svg  \n"), { src: "assets/a/b.svg" });
  assert.deepEqual(
    parseArchifySource("# exported from Archify\nassets/diagram.svg"),
    { src: "assets/diagram.svg" },
  );
});

test("parseArchifySource rejects anything that is not one contained SVG path", () => {
  const rejected = [
    "",
    "   \n # only a comment",
    "assets/one.svg\nassets/two.svg",
    "diagram.svg",
    "assets/diagram.png",
    "assets/../../etc/passwd.svg",
    "assets/./diagram.svg",
    "/etc/diagram.svg",
    "https://example.com/diagram.svg",
    "x".repeat(MAX_ARCHIFY_SOURCE_LENGTH + 1),
  ];
  for (const source of rejected) {
    assert.throws(() => parseArchifySource(source), ArchifyError, `accepted ${JSON.stringify(source)}`);
  }
});

// --- palette ---------------------------------------------------------------

test("derivePalette keeps every colour legible on the deck surface", () => {
  for (const [name, tokens] of Object.entries(THEMES)) {
    const palette = derivePalette(tokens);
    const surface = parseRgb(palette.surface);
    for (const kind of ARCHIFY_COMPONENT_KINDS) {
      const fill = parseRgb(palette[`${kind}Fill`]);
      assert.ok(
        contrastRatio(parseRgb(palette[`${kind}Stroke`]), surface) >= 2.9,
        `${name}/${kind} outline is invisible on the surface`,
      );
      // Component labels sit on the component fill, so they must clear the
      // threshold there as well as against the slide behind it.
      assert.ok(
        contrastRatio(parseRgb(palette[`${kind}Text`]), fill) >= 4.4,
        `${name}/${kind} label is unreadable on its own fill`,
      );
      assert.ok(
        contrastRatio(parseRgb(palette[`${kind}Text`]), surface) >= 4.4,
        `${name}/${kind} label is unreadable on the surface`,
      );
    }
    assert.ok(contrastRatio(parseRgb(palette.text), surface) >= 4.4, `${name} body text`);
  }
});

test("derivePalette separates the component kinds instead of repainting them alike", () => {
  const palette = derivePalette(THEMES.dark);
  const strokes = new Set(ARCHIFY_COMPONENT_KINDS.map((kind) => palette[`${kind}Stroke`]));
  assert.ok(strokes.size >= ARCHIFY_COMPONENT_KINDS.length - 1, [...strokes].join(" "));
});

// --- conversion ------------------------------------------------------------

test("archifySvgToScene requires a usable root and a palette", () => {
  assert.throws(() => archifySvgToScene(null, { palette: derivePalette(THEMES.dark) }), ArchifyError);
  assert.throws(() => archifySvgToScene(svg([]), {}), ArchifyError);
  assert.throws(() => convert(element("svg", {}, [])), ArchifyError);
  assert.throws(() => convert(svg([], { viewBox: "0 0 0 0" })), ArchifyError);
});

test("a component body becomes a themed shape and its label a text node", () => {
  const { scene, diagnostics } = convert(
    svg([
      element("g", { "data-node-label": "Checkout API" }, [
        element("rect", { class: "c-backend", x: 20, y: 30, width: 160, height: 60, rx: 8 }),
        text("text", { class: "t-backend", x: 100, y: 65, "font-size": 13, "text-anchor": "middle" }, "Checkout API"),
      ]),
    ]),
  );
  assert.deepEqual(diagnostics, []);
  const [shape] = nodesOfKind(scene, "shape");
  const palette = derivePalette(THEMES.dark);
  assert.deepEqual(shape.bounds, { x: 20, y: 30, width: 160, height: 60 });
  assert.equal(shape.style.fill, palette.backendFill);
  assert.equal(shape.style.stroke, palette.backendStroke);
  assert.equal(shape.accessibility.title, "Checkout API");

  const [label] = nodesOfKind(scene, "text");
  const [run] = label.text.paragraphs[0].runs;
  assert.equal(run.text, "Checkout API");
  assert.equal(run.color, palette.backendText);
  assert.equal(label.text.paragraphs[0].alignment, "center");
  // The anchor is the centre of the run, and `y` is its baseline.
  assert.ok(Math.abs(label.bounds.x + label.bounds.width / 2 - 100) < 0.001);
  assert.ok(label.bounds.y < 65 && label.bounds.y + label.bounds.height > 65);
});

test("labels are emitted after artwork so nothing can cover them", () => {
  const { scene } = convert(
    svg([
      text("text", { class: "t-primary", x: 10, y: 20, "font-size": 12 }, "On top"),
      element("rect", { class: "c-frontend", x: 0, y: 0, width: 100, height: 40 }),
    ]),
  );
  const kinds = scene.nodes.map((node) => node.kind);
  assert.ok(kinds.indexOf("text") > kinds.indexOf("shape"), kinds.join(","));
});

test("the opaque plate under a component body is folded away", () => {
  const body = { x: 10, y: 10, width: 120, height: 40 };
  const { scene, diagnostics } = convert(
    svg([
      element("g", {}, [
        element("rect", { class: "c-mask", ...body }),
        element("rect", { class: "c-database", ...body }),
      ]),
    ]),
  );
  assert.deepEqual(diagnostics, []);
  // One shape, not two: the plate exists only to hide Archify's background grid,
  // and the repaint uses opaque fills and drops the grid entirely.
  const shapes = nodesOfKind(scene, "shape");
  assert.equal(shapes.length, 1);
  assert.equal(shapes[0].style.fill, derivePalette(THEMES.dark).databaseFill);
});

test("the backplate behind a connector label survives", () => {
  const { scene, diagnostics } = convert(
    svg([
      element("rect", { class: "c-mask", x: 40, y: 90, width: 60, height: 16 }),
      text("text", { class: "t-muted", x: 70, y: 102, "font-size": 11, "text-anchor": "middle" }, "async"),
    ]),
  );
  assert.deepEqual(diagnostics, []);
  const shapes = nodesOfKind(scene, "shape");
  // Without it the label would sit directly on the line it annotates.
  assert.equal(shapes.length, 1);
  assert.equal(shapes[0].style.fill, derivePalette(THEMES.dark).surface);
  assert.equal(shapes[0].style.stroke, null);
});

test("an edge uses the authored point list and the identity from its group", () => {
  const { scene, diagnostics } = convert(
    svg([
      element("g", { "data-edge-id": "e1", "data-edge-key": "web->api", "data-edge-label": "REST" }, [
        element("path", {
          class: "a-emphasis",
          "data-composition-points": "10,10;10,50;90,50",
          "marker-end": "url(#arrow)",
          d: "M 10 10 L 10 50 L 90 50",
        }),
      ]),
    ]),
  );
  assert.deepEqual(diagnostics, []);
  const [connector] = nodesOfKind(scene, "connector");
  assert.deepEqual(connector.points, [
    { x: 10, y: 10 },
    { x: 10, y: 50 },
    { x: 90, y: 50 },
  ]);
  assert.equal(connector.arrowEnd, "triangle");
  assert.equal(connector.arrowStart, "none");
  assert.equal(connector.sourcePath, "edges[web->api]");
  assert.equal(connector.accessibility.title, "REST");
});

test("Archify connector coordinates are placed into the editable PowerPoint output", () => {
  const { scene } = convert(
    svg([
      element("rect", { class: "c-frontend", x: 20, y: 30, width: 80, height: 40 }),
      element("g", { "data-edge-id": "e1", "data-edge-key": "web->api" }, [
        element("path", {
          class: "a-emphasis",
          "data-composition-points": "10,10;10,50;90,50",
          "marker-end": "url(#arrow)",
          d: "M 10 10 L 10 50 L 90 50",
        }),
      ]),
    ]),
  );
  const mapped = sceneToPptxElements(scene, { pathPrefix: "archify[0]" });
  const elements = mapped.elements.map((entry) =>
    placePptxElement(entry, { originX: 100, originY: 50, scale: 2 }));
  const connector = elements.find((entry) => entry.type === "connector");

  assert.deepEqual(mapped.fallbacks, []);
  assert.deepEqual(connector.points, [
    { x: 120, y: 70 },
    { x: 120, y: 150 },
    { x: 280, y: 150 },
  ]);
  assert.deepEqual(
    { x: connector.x, y: connector.y, width: connector.width, height: connector.height },
    { x: 120, y: 70, width: 160, height: 80 },
  );

  const pptx = buildPptxPackage({
    title: "Archify connector placement",
    slides: [{ elements }],
  });
  assert.equal(inspectPptxPackage(pptx).valid, true);
  const packageXml = Buffer.from(pptx).toString("utf8");
  assert.match(
    packageXml,
    /<a:off x="1143000" y="666750"\/><a:ext cx="0" cy="762000"\/>/,
  );
  assert.match(
    packageXml,
    /<a:off x="1143000" y="1428750"\/><a:ext cx="1524000" cy="0"\/>/,
  );
});

test("a plain rule without edge identity still imports", () => {
  const { scene, diagnostics } = convert(
    svg([
      element("path", { class: "a-dashed", d: "M 118.5 142 L 118.5 495", "stroke-dasharray": "4 4" }),
      element("line", { class: "a-default", x1: 0, y1: 5, x2: 40, y2: 5 }),
    ]),
  );
  assert.deepEqual(diagnostics, []);
  const connectors = nodesOfKind(scene, "connector");
  assert.equal(connectors.length, 2);
  assert.deepEqual(connectors[0].points, [{ x: 118.5, y: 142 }, { x: 118.5, y: 495 }]);
  assert.equal(connectors[0].style.dash, "dot");
  assert.deepEqual(connectors[1].points, [{ x: 0, y: 5 }, { x: 40, y: 5 }]);
});

test("template content and the background wash are never imported", () => {
  const { scene, diagnostics } = convert(
    svg([
      element("defs", {}, [
        element("pattern", { id: "grid" }, [element("path", { class: "c-grid", d: "M 0 0 L 8 0" })]),
        element("marker", { id: "arrow" }, [element("path", { d: "M 0 0 L 6 3 L 0 6 Z" })]),
      ]),
      // Percentage dimensions carry no scene geometry and no diagram meaning.
      element("rect", { width: "100%", height: "100%", fill: "url(#grid)" }),
    ]),
  );
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(scene.nodes, []);
});

test("a structural frame becomes an unfilled outline behind its contents", () => {
  const { scene, diagnostics } = convert(
    svg([
      element("rect", {
        class: "c-security-group",
        "data-graph-role": "structural-frame",
        "data-composition-frame-id": "trust",
        "data-composition-frame-label": "Trust boundary",
        x: 5,
        y: 5,
        width: 300,
        height: 200,
        rx: 12,
      }),
      element("rect", { class: "c-cloud", x: 20, y: 20, width: 80, height: 40 }),
    ]),
  );
  assert.deepEqual(diagnostics, []);
  const [frame, body] = nodesOfKind(scene, "shape");
  assert.equal(frame.sourcePath, "frames[trust]");
  assert.equal(frame.style.fill, null);
  assert.equal(frame.accessibility.title, "Trust boundary");
  assert.ok(frame.z < body.z, "the frame must sit behind what it contains");
});

test("every Archify role sigil maps to a built-in icon", () => {
  for (const iconName of Object.values(ARCHIFY_SIGIL_ICONS)) {
    assert.ok(ICONS.has(iconName), `${iconName} is not a built-in icon`);
  }
});

test("a sigil is replaced by MarkdStage's own icon at the transformed size", () => {
  const { scene, diagnostics } = convert(
    svg([
      element("g", {
        "data-semantic-sigil": "database",
        class: "semantic-sigil s-database",
        transform: "translate(24 36) scale(1.5)",
      }, [
        // Archify's own line art is discarded rather than imported: it has no
        // stable geometry contract and could not be re-themed.
        element("path", { d: "M 2 4 C 2 2 14 2 14 4" }),
      ]),
    ]),
  );
  assert.deepEqual(diagnostics, []);
  const [image] = nodesOfKind(scene, "image");
  assert.deepEqual(image.bounds, { x: 24, y: 36, width: 24, height: 24 });
  assert.ok(image.src.startsWith("data:image/svg+xml;charset=utf-8,"));
  assert.equal(nodesOfKind(scene, "connector").length, 0);
  assert.equal(nodesOfKind(scene, "shape").length, 0);
});

test("unknown contract values are reported rather than silently dropped", () => {
  const { scene, diagnostics } = convert(
    svg([
      element("rect", { class: "c-quantum", x: 0, y: 0, width: 10, height: 10 }),
      element("g", { "data-semantic-sigil": "telepathy", transform: "translate(0 0) scale(1)" }),
      text("text", { class: "t-quantum", x: 0, y: 0 }, "hi"),
    ]),
  );
  assert.deepEqual(scene.nodes, []);
  assert.deepEqual(
    diagnostics.map((entry) => entry.reason).sort(),
    ["unsupported-shape-class", "unsupported-sigil-kind", "unsupported-text-class"],
  );
});

test("the scene declares itself as an imported diagram", () => {
  const { scene } = archifySvgToScene(
    svg([
      text("title", {}, "Checkout flow"),
      text("desc", {}, "How a checkout request is served"),
      element("rect", { class: "c-frontend", x: 0, y: 0, width: 10, height: 10 }),
    ]),
    { palette: derivePalette(THEMES.light), path: "assets/checkout.svg" },
  );
  assert.equal(scene.width, 400);
  assert.equal(scene.height, 300);
  assert.deepEqual(scene.source, { kind: "architecture", path: "assets/checkout.svg" });
  assert.equal(scene.accessibility.title, "Checkout flow");
  assert.equal(scene.accessibility.description, "How a checkout request is served");
});
