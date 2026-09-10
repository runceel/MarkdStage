import assert from "node:assert/strict";
import test from "node:test";
import {
  architecturePowerPointSnapshot,
  architectureSemanticSnapshot,
  architectureTextLayout,
  parseArchitecture,
  renderArchitectureDiagram,
} from "../renderer/architecture.mjs";
import { architectureSnapshotToScene } from "../renderer/architecture-scene.mjs";
import { sceneToPptxElements } from "../renderer/scene-pptx.mjs";
import { sceneToSvg } from "../renderer/scene-svg.mjs";
import { buildPptxPackage } from "../runtime/pptx-package.mjs";

class Element {
  constructor(tagName, namespaceURI = "") {
    this.tagName = tagName;
    this.namespaceURI = namespaceURI;
    this.attributes = new Map();
    this.children = [];
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  appendChild(child) { this.children.push(child); return child; }
}
const documentRef = {
  createElement: (tag) => new Element(tag),
  createElementNS: (namespace, tag) => new Element(tag, namespace),
};
const descendants = (element) => [element, ...element.children.flatMap(descendants)];
const node = (overrides = {}) => ({
  type: "node", id: "node", x: 100, y: 100, width: 320, height: 180, text: "Alpha\nBeta",
  ...overrides,
});
const parse = (elements) => parseArchitecture(JSON.stringify({ version: 1, elements }));
const byId = (model, id = "node") => model.elements.find((element) => element.id === id);

test("text style defaults preserve centered semibold node labels and bold group titles", () => {
  const model = parse([node(), {
    type: "group", id: "group", x: 500, y: 100, width: 300, height: 200, title: "Group",
  }]);
  assert.equal(byId(model).style.textAlign, "center");
  assert.equal(byId(model).style.verticalAlign, "middle");
  assert.equal(byId(model).style.autoFit, "shrink");
  assert.equal(byId(model).style.padding, 16);
  assert.equal(byId(model).style.lineHeight, 1.2);
  assert.equal(byId(model).style.fontWeight, 600);
  assert.equal(byId(model, "group").style.fontWeight, 700);
});

test("legacy group titles remain unshrunk unless custom title layout opts into fitting", () => {
  const group = {
    type: "group", id: "group", x: 100, y: 100, width: 90, height: 120,
    title: "A long legacy group title",
  };
  const legacy = architectureTextLayout(byId(parse([group]), "group"));
  assert.equal(legacy.effectiveFontSize, 28);
  assert.equal(legacy.shrunk, false);
  const custom = architectureTextLayout(byId(parse([{ ...group, style: { autoFit: "shrink" } }]), "group"));
  assert.ok(custom.effectiveFontSize < 28);
  assert.equal(custom.shrunk, true);
});

test("all horizontal and vertical alignments use the padded box in SVG and snapshots", () => {
  for (const textAlign of ["left", "center", "right"]) {
    for (const verticalAlign of ["top", "middle", "bottom"]) {
      const model = parse([node({ style: {
        textAlign, verticalAlign, padding: 24, fontSize: 20, lineHeight: 1.5,
        fontWeight: 450, fontFamily: "Segoe UI",
      } })]);
      const svg = renderArchitectureDiagram(model, documentRef);
      const text = descendants(svg).find((element) => element.tagName === "text");
      assert.equal(text.attributes.get("text-anchor"), { left: "start", center: "middle", right: "end" }[textAlign]);
      assert.equal(text.attributes.get("font-family"), "Segoe UI");
      assert.equal(text.attributes.get("font-weight"), "450");
      const expectedX = { left: 124, center: 260, right: 396 }[textAlign];
      const expectedY = { top: 134, middle: 175, bottom: 216 }[verticalAlign];
      assert.equal(Number(text.children[0].attributes.get("x")), expectedX);
      assert.equal(Number(text.children[0].attributes.get("y")), expectedY);
      assert.equal(Number(text.children[1].attributes.get("y")), expectedY + 30);
      const shape = architecturePowerPointSnapshot(model).objects[0];
      assert.equal(shape.alignment, textAlign);
      assert.equal(shape.verticalAlignment, verticalAlign);
      assert.equal(shape.text.paragraphs[0].runs[0].fontFace, "Segoe UI");
      assert.equal(shape.lineHeight, 1.5);
      assert.deepEqual(shape.textInsets, { left: 24, right: 24, top: 24, bottom: 24 });
    }
  }
});

test("shrink retains legacy width-only fitting without adding ellipses or height truncation", () => {
  const model = parse([node({ width: 90, height: 60, text: "Extremely long label\nSecond line",
    style: { fontSize: 32 } })]);
  const layout = architectureTextLayout(byId(model));
  assert.equal(layout.requestedFontSize, 32);
  assert.equal(layout.effectiveFontSize, 8);
  assert.equal(layout.shrunk, true);
  assert.equal(layout.truncated, false);
  assert.deepEqual(layout.lines, ["Extremely long label", "Second line"]);
  const svg = renderArchitectureDiagram(model, documentRef);
  const text = descendants(svg).find((element) => element.tagName === "text");
  assert.equal(text.attributes.get("data-effective-font-size"), "8");
  assert.equal(text.attributes.get("data-shrunk"), "true");
  assert.equal(text.attributes.get("data-truncated"), "false");
  assert.deepEqual(architectureSemanticSnapshot(model).elements[0].textLayout, layout);
  assert.equal(architecturePowerPointSnapshot(model).objects[0].text.paragraphs[0].runs[0].text, layout.lines.join("\n"));
});

test("default narrow boxes retain legacy minimum text width while explicit padding controls it", () => {
  const thin = byId(parse([node({ height: 1, text: "Short" })]));
  assert.equal(architectureTextLayout(thin).effectiveFontSize, 32);
  const narrow = byId(parse([node({ width: 24, text: "API" })]));
  assert.equal(architectureTextLayout(narrow).fittingWidth, 32);
  assert.equal(architectureTextLayout(narrow).availableWidth, 0);
  const explicit = byId(parse([node({ width: 24, text: "API", style: { padding: 0 } })]));
  assert.equal(architectureTextLayout(explicit).availableWidth, 24);
  assert.ok(architectureTextLayout(explicit).effectiveFontSize < architectureTextLayout(narrow).effectiveFontSize);
  const model = parse([node({ width: 24, height: 1, text: "A" })]);
  const svg = renderArchitectureDiagram(model, documentRef);
  const text = descendants(svg).find((element) => element.tagName === "text");
  assert.equal(Number(text.children[0].attributes.get("x")), 112);
  assert.equal(Number(text.children[0].attributes.get("y")), 100.5);
});

test("autoFit none retains requested size and overflowing text within the eight-line limit", () => {
  const text = Array.from({ length: 10 }, (_, index) => `Long line ${index}`).join("\n");
  const model = parse([node({ width: 24, height: 24, text, style: { autoFit: "none", fontSize: 40 } })]);
  const layout = architectureTextLayout(byId(model));
  assert.equal(layout.effectiveFontSize, 40);
  assert.equal(layout.shrunk, false);
  assert.equal(layout.truncated, true);
  const displayed = text.split("\n").slice(0, 8).join("\n");
  assert.equal(layout.lines.join("\n"), displayed);
  assert.equal(architecturePowerPointSnapshot(model).objects[0].text.paragraphs[0].runs[0].text, displayed);
  assert.equal(architecturePowerPointSnapshot(model).objects[0].textWrap, "none");
});

test("auto node dimensions hug text and shape/icon insets before parent layout", () => {
  for (const shape of ["rect", "rounded-rect", "diamond", "triangle", "hexagon", "parallelogram", "ellipse"]) {
    const model = parse([node({ width: "auto", height: "auto", text: "API", shape, icon: "api" })]);
    const resolved = byId(model);
    const layout = architectureTextLayout(resolved);
    assert.ok(Number.isFinite(resolved.width));
    assert.ok(Number.isFinite(resolved.height));
    assert.equal(layout.shrunk, false, shape);
    assert.equal(layout.truncated, false, shape);
  }
  const model = parse([{
    type: "group", id: "group", x: 40, y: 50, width: 600, height: 250,
    layout: { type: "row", padding: 20 },
    children: [node({ text: "API", width: "auto", height: "auto" })],
  }]);
  const resolved = byId(model);
  assert.ok(resolved.width < 150);
  const svg = renderArchitectureDiagram(model, documentRef);
  const visual = descendants(svg).find((element) => element.attributes.get("data-architecture-id") === "node");
  assert.equal(visual.attributes.get("data-architecture-requested-width"), "auto");
  assert.equal(visual.attributes.get("data-architecture-requested-height"), "auto");
  assert.equal(Number(visual.attributes.get("data-architecture-effective-width")), resolved.width);
  assert.equal(Number(visual.attributes.get("data-architecture-effective-height")), resolved.height);
  assert.equal(resolved.x + resolved.width / 2, 340);
  assert.equal(resolved.y + resolved.height / 2, 175);
  const oneAxis = byId(parse([node({ width: 320, height: "auto", text: "API" })]));
  assert.equal(oneAxis.width, 320);
  assert.ok(oneAxis.height < 100);
  for (const layout of ["row", "grid"]) {
    for (const dimensions of [{ width: "auto" }, { height: "auto" }]) {
      const implicit = parse([{
        type: "group", id: "g", x: 0, y: 0, width: 600, height: 300, layout,
        children: [{ type: "node", id: "node", text: "API", icon: "api", ...dimensions }],
      }]);
      assert.ok(Number.isFinite(byId(implicit).width));
      assert.ok(Number.isFinite(byId(implicit).height));
      assert.equal(architectureTextLayout(byId(implicit)).shrunk, false);
    }
  }
  const short = byId(parse([node({ width: "auto", text: "A", style: { padding: 0 } })]));
  assert.equal(architectureTextLayout(short).shrunk, false);
  const eightLines = Array(8).fill("Short").join("\n");
  const visibleOnly = byId(parse([node({ width: "auto", text: eightLines })]));
  const hiddenLongLine = byId(parse([node({ width: "auto", text: `${eightLines}\n${"Long".repeat(80)}` })]));
  assert.equal(hiddenLongLine.width, visibleOnly.width);
  const iconOnly = byId(parse([node({ width: "auto", height: "auto", text: "", icon: "api" })]));
  assert.equal(iconOnly.width, 40);
  assert.equal(iconOnly.height, 40);
  const compactLines = byId(parse([node({ width: "auto", height: "auto",
    style: { lineHeight: 0.5 } })]));
  const compactMetrics = architectureTextLayout(compactLines);
  assert.ok(compactMetrics.effectiveTextHeight <= compactMetrics.availableHeight);
  for (const type of ["group", "image"]) {
    assert.throws(() => parse([{ ...node({ type, width: "auto" }), ...(type === "image" ? { src: "assets/test.png" } : {}) }]));
  }
});

test("weighted grid columns divide available width after padding and gaps", () => {
  const model = parse([{
    type: "group", id: "grid", x: 50, y: 50, width: 640, height: 240,
    layout: { type: "grid", columns: 3, columnWidths: [1, 2, 1], padding: 20, columnGap: 10 },
    children: ["a", "b", "c", "d"].map((id) => ({ type: "node", id, text: id })),
  }]);
  assert.equal(byId(model, "a").width, 145);
  assert.equal(byId(model, "b").width, 290);
  assert.equal(byId(model, "c").width, 145);
  assert.equal(byId(model, "a").x, 70);
  assert.equal(byId(model, "b").x, 225);
  assert.equal(byId(model, "c").x, 525);
  assert.equal(byId(model, "d").x, 70);
  const group = { type: "group", id: "g", x: 0, y: 0, width: 600, height: 200 };
  for (const columnWidths of [[1, 2], [1, 0, 1], [1, -1, 1], [1, "2", 1], [1, 4001, 1]]) {
    assert.throws(() => parse([{ ...group, layout: { type: "grid", columns: 3, columnWidths } }]), /columnWidths/);
  }
  assert.throws(() => parse([{ ...group, layout: { type: "grid", columnWidths: [1, 2] } }]), /columnWidths/);
  assert.doesNotThrow(() => parse([{ ...group,
    layout: { type: "grid", columns: 2.9, columnWidths: [1, 2] } }]));
  assert.throws(() => parse([{ ...group,
    layout: { type: "grid", columns: 2.9, columnWidths: [1, 2, 1] } }]), /columnWidths/);
});

test("point and mixed connectors keep exact endpoints across all routing and export paths", () => {
  for (const routing of ["straight", "orthogonal", "polyline"]) {
    for (const [from, to] of [
      [{ x: 30, y: 120 }, { x: 700, y: 300 }],
      ["a", { x: 700, y: 300 }],
      [{ x: 30, y: 120 }, "b"],
    ]) {
      const model = parse([
        node({ id: "a", x: 100, y: 250, width: 100, height: 80, text: "A" }),
        node({ id: "b", x: 600, y: 450, width: 100, height: 80, text: "B" }),
        { type: "connector", from, to, routing, label: "calls",
          ...(routing === "polyline" ? { points: [{ x: 450, y: 300 }] } : {}) },
      ]);
      const snapshot = architectureSemanticSnapshot(model);
      const connector = snapshot.elements.find((element) => element.type === "connector");
      assert.ok(connector.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
      if (typeof from === "object") assert.deepEqual(connector.points[0], from);
      if (typeof to === "object") assert.deepEqual(connector.points.at(-1), to);
      const svg = renderArchitectureDiagram(model, documentRef);
      assert.equal(descendants(svg).some((element) =>
        String(element.attributes.get("aria-label")).includes("[object Object]")), false);
      const { scene } = architectureSnapshotToScene(architecturePowerPointSnapshot(model), {
        resolveColor: () => "#111111",
      });
      assert.ok(sceneToPptxElements(scene).elements.some((element) => element.type === "connector"));
    }
  }
});

test("nested coordinate endpoints and waypoints resolve relative to their group", () => {
  const model = parse([{
    type: "group", id: "g", x: 100, y: 200, width: 500, height: 400,
    children: [{ type: "connector", from: { x: 10, y: 20 }, to: { x: 300, y: 200 },
      routing: "polyline", points: [{ x: 150, y: 100 }] }],
  }]);
  const connector = model.elements.find((element) => element.type === "connector");
  assert.deepEqual(connector.from, { x: 110, y: 220 });
  assert.deepEqual(connector.to, { x: 400, y: 400 });
  assert.deepEqual(connector.points, [{ x: 250, y: 300 }]);
});

test("equal-length coordinate routes support shared lanes and tied diagnostic source metadata", () => {
  const model = parse([
    node({ id: "blocker", x: 0, y: 0, width: 800, height: 600, text: "" }),
    ...[0, 1, -1].map((lane) => ({
      type: "connector", from: { x: 100, y: 100 }, to: { x: 700, y: 100 },
      routing: "orthogonal", lane, label: `Lane ${lane}`,
    })),
  ]);
  for (const element of model.elements) {
    if (element.type === "connector") element.sourcePath = "shared-source";
  }
  const snapshot = architectureSemanticSnapshot(model);
  assert.equal(snapshot.routing.degraded, true);
  assert.equal(snapshot.routing.diagnostics.length, 3);
  assert.equal(new Set(snapshot.elements.filter((element) => element.type === "connector")
    .map((element) => element.lane)).size, 3);
  assert.deepEqual(architectureSemanticSnapshot(model), snapshot);
  const messages = [];
  const originalWarn = console.warn;
  console.warn = (message) => messages.push(String(message));
  try {
    renderArchitectureDiagram(model, documentRef);
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(messages.length > 0);
  assert.equal(messages.some((message) => message.includes("[object Object]")), false);
  assert.ok(messages.some((message) => message.includes("(100, 100) -> (700, 100)")));
});

test("coincident point endpoints stay finite and do not break SVG or scene export", () => {
  for (const routing of ["straight", "orthogonal", "polyline"]) {
    const model = parse([{ type: "connector", from: { x: 100, y: 100 }, to: { x: 100, y: 100 }, routing }]);
    const points = architectureSemanticSnapshot(model).elements[0].points;
    assert.deepEqual(points, [{ x: 100, y: 100 }, { x: 100, y: 100 }]);
    assert.doesNotThrow(() => renderArchitectureDiagram(model, documentRef));
    const { scene } = architectureSnapshotToScene(architecturePowerPointSnapshot(model));
    assert.equal(scene.nodes[0].reason, "zero-length-connector");
    assert.doesNotThrow(() => sceneToPptxElements(scene));
  }
});

test("custom font survives scene theme defaults and editable PowerPoint mapping", () => {
  const model = parse([node({ style: { fontFamily: "Arial", fontWeight: 300, fontSize: 24,
    textAlign: "right", verticalAlign: "bottom", autoFit: "none", lineHeight: 1.5 } })]);
  const { scene } = architectureSnapshotToScene(architecturePowerPointSnapshot(model), {
    fontFace: "Theme font", resolveColor: () => "#111111",
  });
  const shape = scene.nodes[0];
  assert.equal(shape.text.paragraphs[0].runs[0].fontFace, "Arial");
  assert.equal(shape.text.paragraphs[0].runs[0].fontWeight, 300);
  assert.equal(shape.text.paragraphs[0].runs[0].bold, false);
  assert.equal(shape.textLayout.alignment, "right");
  assert.equal(shape.textLayout.verticalAlignment, "bottom");
  assert.equal(shape.textLayout.lineHeight, 1.5);
  const pptx = sceneToPptxElements(scene).elements[0];
  assert.equal(pptx.text.paragraphs[0].runs[0].fontFace, "Arial");
  assert.equal(pptx.verticalAlignment, "bottom");
  assert.equal(pptx.text.paragraphs[0].lineSpacing, 36);
  const packageXml = buildPptxPackage({ slides: [{ elements: [pptx] }] }).toString("utf8");
  assert.match(packageXml, /<a:latin typeface="Arial"\/>/);
  assert.match(packageXml, /<a:lnSpc><a:spcPts val="2700"\/><\/a:lnSpc>/);
  const genericSvg = sceneToSvg(scene, { document: documentRef });
  const texts = descendants(genericSvg).filter((element) => element.tagName === "text");
  assert.equal(Number(texts[1].attributes.get("y")) - Number(texts[0].attributes.get("y")), 36);
});

test("CSS family lists become one unquoted native typeface with theme fallback for generics", () => {
  for (const [fontFamily, expected] of [
    ['"Segoe UI", Arial, sans-serif', "Segoe UI"],
    ["'Arial', sans-serif", "Arial"],
    ["system-ui", "Theme Font"],
  ]) {
    const model = parse([node({ style: { fontFamily } })]);
    const { scene } = architectureSnapshotToScene(architecturePowerPointSnapshot(model), {
      fontFace: '"Theme Font", sans-serif', resolveColor: () => "#111111",
    });
    assert.equal(scene.nodes[0].text.paragraphs[0].runs[0].fontFace, expected);
    const { elements } = sceneToPptxElements(scene);
    const xml = buildPptxPackage({ slides: [{ elements }] }).toString("utf8");
    assert.ok(xml.includes(`<a:latin typeface="${expected}"/>`));
    assert.equal(xml.includes('typeface="&quot;'), false);
    assert.equal(xml.includes('typeface="system-ui"'), false);
  }
});
