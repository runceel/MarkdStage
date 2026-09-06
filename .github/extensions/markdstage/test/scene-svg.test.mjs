import assert from "node:assert/strict";
import test from "node:test";
import { createScene, normalizeScene } from "../renderer/scene-graph.mjs";
import { captureSvgTree, sceneToSvg, svgPrimitive } from "../renderer/scene-svg.mjs";
import { parseArchitecture, renderArchitectureDiagram } from "../renderer/architecture.mjs";

class Element {
  constructor(tag, namespaceURI) {
    this.tagName = tag;
    this.localName = tag;
    this.namespaceURI = namespaceURI;
    this.attributes = new Map();
    this.children = [];
    this.style = { setProperty: (key, value) => this.attributes.set(`style:${key}`, value) };
  }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  appendChild(child) { this.children.push(child); return child; }
}
const document = {
  createElementNS: (namespace, tag) => new Element(tag, namespace),
  createElement: (tag) => new Element(tag),
  createTextNode: (text) => ({ textContent: text, children: [] }),
};
const all = (root) => [root, ...root.children.flatMap(all)];
const bounds = { x: 10, y: 20, width: 100, height: 60 };
const richText = { paragraphs: [{ runs: [{ text: "Safe <script> & text\nSecond line", fontSize: 18, fontFace: "Arial", color: "#123456", bold: true }] }] };
function scene(nodes) {
  return normalizeScene(createScene({
    width: 400, height: 300, source: { kind: "architecture", path: "slides.md" },
    accessibility: { title: "A diagram", description: "Description" }, nodes,
  })).scene;
}

test("renders scene primitives, rich text, markers, images and stable stacking with DOM APIs", () => {
  const source = scene([
    { kind: "shape", preset: "diamond", sourcePath: "node", z: 2, bounds, style: { fill: "#ffffff", stroke: "#000000", strokeWidth: 2, dash: "dot" }, text: richText },
    { kind: "connector", sourcePath: "edge", z: 1, points: [{ x: 0, y: 0 }, { x: 20, y: 20 }], arrowEnd: "triangle", style: { stroke: "#123456", strokeWidth: 2 } },
    { kind: "image", sourcePath: "image", z: 3, bounds, src: "assets/icon.png", alt: "Icon", fit: "contain" },
  ]);
  const svg = sceneToSvg(source, { document });
  assert.equal(svg.attributes.get("viewBox"), "0 0 400 300");
  assert.equal(svg.attributes.get("data-scene-backend"), "svg");
  assert.deepEqual(svg.children.filter((node) => node.attributes?.has("data-scene-node")).map((node) => node.attributes.get("data-scene-node")), ["connector", "shape", "image"]);
  const descendants = all(svg);
  assert.equal(descendants.find((node) => node.tagName === "polygon").attributes.get("points"), "60,20 110,50 60,80 10,50");
  assert.equal(descendants.filter((node) => node.tagName === "marker").length, 1);
  assert.equal(descendants.find((node) => node.tagName === "image").attributes.get("preserveAspectRatio"), "xMidYMid meet");
  assert.deepEqual(descendants.filter((node) => node.tagName === "tspan").map((node) => node.textContent), ["Safe <script> & text", "Second line"]);
  assert.equal(descendants.filter((node) => node.tagName === "script").length, 0);
});

test("does not silently discard fallback content and permits safe primitive recovery", () => {
  const source = scene([{ kind: "fallback", sourcePath: "unknown", z: 0, bounds, reason: "unsupported" }]);
  assert.throws(() => sceneToSvg(source, { document }), /SVG fallback unavailable: unknown/);
  const svg = sceneToSvg(source, { document, resolveFallback: () => ({
    tag: "path", attributes: { d: "M 10 20 Q 30 60 110 80", stroke: "#ff0000" }, children: [],
  }) });
  assert.equal(all(svg).find((node) => node.tagName === "path").attributes.get("d"), "M 10 20 Q 30 60 110 80");
});

test("primitive trees reject executable tags and strip active attributes and URLs", () => {
  const source = scene([{ kind: "shape", preset: "rect", sourcePath: "node", z: 0, bounds }]);
  source.nodes[0].meta = { svg: {
    tag: "image",
    attributes: { href: "javascript:alert(1)", onload: "alert(1)", style: "background:url(https://invalid/)", "aria-label": "<unsafe> & literal", filter: "url(https://invalid/filter)" },
    style: { fill: "url(https://invalid/)", color: "#123456", behavior: "url(https://invalid/)" }, children: [],
  } };
  const image = all(sceneToSvg(source, { document })).find((node) => node.tagName === "image");
  for (const attribute of ["href", "onload", "style", "filter", "style:behavior", "style:fill"]) assert.equal(image.attributes.has(attribute), false);
  assert.equal(image.attributes.get("aria-label"), "<unsafe> & literal");
  assert.equal(image.attributes.get("style:color"), "#123456");
  source.nodes[0].meta.svg.tag = "script";
  assert.throws(() => sceneToSvg(source, { document }), /Unsupported SVG primitive: script/);
});

test("primitive scene templates preserve source slots exactly once", () => {
  const source = scene([{ kind: "shape", preset: "rect", sourcePath: "node", z: 0, bounds }]);
  const template = svgPrimitive("svg", { viewBox: "0 0 400 300" });
  template.appendChild({ sceneNode: 0 });
  assert.equal(all(sceneToSvg(source, { document, template })).filter((node) => node.attributes?.has("data-scene-node")).length, 1);
  template.appendChild({ sceneNode: 0 });
  assert.throws(() => sceneToSvg(source, { document, template }), /Duplicate SVG scene slot/);
  template.children = [];
  assert.throws(() => sceneToSvg(source, { document, template }), /Missing SVG scene slot/);
});

test("preserves long generated SVG geometry within portable scene string limits", () => {
  const path = `M 0 0 ${"L 10 20 ".repeat(2000)}`;
  const primitive = captureSvgTree({
    nodeType: 1, localName: "path", namespaceURI: "http://www.w3.org/2000/svg",
    attributes: [{ name: "d", value: path }], childNodes: [],
  }, { computedStyle: null });
  assert.ok(Array.isArray(primitive.attributes.d));
  const source = scene([{ kind: "fallback", sourcePath: "path", z: 0, bounds, reason: "complex-path", meta: { svg: primitive } }]);
  const svg = sceneToSvg(JSON.parse(JSON.stringify(source)), { document });
  assert.equal(all(svg).find((node) => node.tagName === "path").attributes.get("d"), path);
});

test("Architecture displayed SVG is produced from a portable shared scene with icons and editor metadata", () => {
  const model = parseArchitecture(JSON.stringify({
    title: "Portable",
    elements: [{ type: "node", id: "api", x: 10, y: 20, width: 300, height: 120, text: "API", icon: "server" }],
  }));
  const wrapper = renderArchitectureDiagram(model, document);
  const original = wrapper.children[0];
  const source = JSON.parse(JSON.stringify(original.__presentationScene));
  assert.equal(source.source.kind, "architecture");
  assert.ok(source.nodes.some((node) => node.meta?.svg));
  const restored = sceneToSvg(source, { document });
  for (const svg of [original, restored]) {
    assert.equal(svg.attributes.get("data-scene-backend"), "svg");
    assert.equal(all(svg).filter((node) => node.attributes?.get("data-architecture-id") === "api").length, 1);
    assert.equal(all(svg).filter((node) => node.attributes?.get("data-architecture-icon") === "server").length, 1);
    assert.equal(all(svg).find((node) => node.attributes?.get("data-architecture-id") === "api").attributes.get("data-scene-source-path"), "elements[0]");
  }
});
