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

test("renders explicit marker caps while retaining the existing connector default", () => {
  for (const lineCap of [undefined, "butt", "round", "square"]) {
    const source = scene([{ kind: "connector", sourcePath: "cross", z: 0,
      points: [{ x: 1, y: 2 }, { x: 6, y: 7 }], style: { stroke: "#123456", ...(lineCap ? { lineCap } : {}) } }]);
    const path = all(sceneToSvg(source, { document })).find((node) => node.tagName === "path");
    assert.equal(path.attributes.get("stroke-linecap"), lineCap ?? "round");
    assert.equal(path.attributes.get("fill"), "none");
  }
});

test("renders element, fill, and stroke opacity independently for shapes and connector heads", () => {
  const svg = sceneToSvg(scene([
    {
      kind: "shape",
      preset: "rect",
      sourcePath: "shape",
      z: 0,
      bounds,
      style: {
        fill: "rgba(51, 102, 153, 0.5)",
        stroke: "#cc330080",
        strokeWidth: 2,
        opacity: 0.8,
        fillOpacity: 0.5,
        strokeOpacity: 0.25,
      },
    },
    {
      kind: "connector",
      sourcePath: "connector",
      z: 1,
      points: [{ x: 1, y: 2 }, { x: 6, y: 7 }],
      arrowEnd: "triangle",
      style: {
        stroke: "rgba(0, 136, 204, 0.5)",
        strokeWidth: 3,
        opacity: 0.5,
        strokeOpacity: 0.4,
      },
    },
  ]), { document });
  const rect = all(svg).find((node) => node.tagName === "rect");
  assert.equal(rect.attributes.get("opacity"), "0.8");
  assert.equal(rect.attributes.get("fill-opacity"), "0.5");
  assert.equal(rect.attributes.get("stroke-opacity"), "0.25");
  const path = all(svg).find((node) => node.tagName === "path" && node.attributes.get("marker-end"));
  assert.equal(path.attributes.get("opacity"), "0.5");
  assert.equal(path.attributes.get("stroke-opacity"), "0.4");
  const markerShape = all(svg).find((node) => node.tagName === "marker").children[0];
  assert.equal(markerShape.attributes.get("fill"), "rgba(0, 136, 204, 0.5)");
  assert.equal(markerShape.attributes.get("fill-opacity"), "0.4");
});

test("renders the fixed Mermaid sequence frame tab profile", () => {
  const svg = sceneToSvg(scene([{
    kind: "shape",
    preset: "sequenceTab",
    sourcePath: "sequence[0]",
    z: 0,
    bounds: { x: 10, y: 20, width: 50, height: 20 },
    style: { fill: "#ffffff", stroke: "#000000", strokeWidth: 1 },
  }]), { document });
  const path = all(svg).find((node) => node.tagName === "path");
  assert.equal(path.attributes.get("d"), "M 10 20 L 60 20 L 60 33 L 51.6 40 L 10 40 Z");
});

test("renders exact height-based Mermaid quadrilaterals without nearest-preset distortion", () => {
  const presets = ["trapezoid", "invertedTrapezoid", "reverseParallelogram"];
  const svg = sceneToSvg(scene(presets.map((preset, index) => ({
    kind: "shape",
    preset,
    sourcePath: `nodes[${index}]`,
    z: index,
    bounds: { x: 10 + index * 140, y: 20, width: 120, height: 40 },
    style: { fill: "#ffffff", stroke: "#000000", strokeWidth: 1 },
  }))), { document });
  const polygons = all(svg).filter((node) => node.tagName === "polygon");
  assert.deepEqual(polygons.map((node) => node.attributes.get("points")), [
    "10,60 130,60 110,20 30,20",
    "170,60 250,60 270,20 150,20",
    "310,60 410,60 390,20 290,20",
  ]);
});

test("renders rotated text around the center of its unrotated bounds", () => {
  const svg = sceneToSvg(scene([{
    kind: "text",
    sourcePath: "rotated-label",
    z: 0,
    bounds: { x: 20, y: 30, width: 80, height: 20 },
    text: { paragraphs: [{ alignment: "center", runs: [{ text: "Rotated", fontSize: 16 }] }] },
    textLayout: { verticalAlignment: "middle", textWrap: "none" },
    rotation: -90,
  }]), { document });
  const rotation = all(svg).find((node) => node.tagName === "g" &&
    node.attributes.get("transform") === "rotate(-90 60 40)");
  assert.ok(rotation);
  assert.equal(rotation.children.filter((node) => node.tagName === "text").length, 1);
});

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

test("empty Architecture scenes retain root sizing and accessibility after serialization", () => {
  const original = renderArchitectureDiagram(parseArchitecture(""), document).children[0];
  const source = JSON.parse(JSON.stringify(original.__presentationScene));
  assert.equal(source.nodes.length, 0);
  const restored = sceneToSvg(source, { document });
  for (const attribute of ["class", "viewBox", "role", "tabindex", "aria-labelledby"]) {
    assert.equal(restored.attributes.get(attribute), original.attributes.get(attribute));
  }
  assert.deepEqual(restored.children.map((child) => [child.tagName, child.textContent]),
    original.children.map((child) => [child.tagName, child.textContent]));
});

test("SVG capture preserves precise inline sizing and computed transforms", () => {
  const source = {
    nodeType: 1, localName: "svg", namespaceURI: "http://www.w3.org/2000/svg",
    attributes: [{ name: "transform", value: "translate(123.123456789 0)" }],
    childNodes: [],
    getAttribute: (name) => name === "style" ? "max-width: 408.578125px;" : null,
    style: { getPropertyValue: (name) => name === "max-width" ? "408.578px" : "" },
    computedStyleMap: () => new Map([["transform", {
      toString: () => "translate(123.123px, 0px)",
      toMatrix: () => ({ toString: () => "matrix(1, 0, 0, 1, 123.123456789, 0)" }),
    }]]),
  };
  const primitive = captureSvgTree(source, {
    computedStyle: () => ({
      getPropertyValue: (name) => ({
        transform: "matrix(1, 0, 0, 1, 123.123, 0)",
        "transform-box": "fill-box",
      }[name] || ""),
    }),
  });
  assert.equal(primitive.style["max-width"], "408.578125px");
  assert.equal(primitive.attributes.transform, "translate(123.123456789 0)");
  assert.equal(primitive.style.transform, "matrix(1, 0, 0, 1, 123.123456789, 0)");
  assert.equal(primitive.style["transform-box"], "fill-box");
});

test("SVG capture preserves computed text transforms for local fallbacks", () => {
  const source = {
    nodeType: 1,
    localName: "span",
    namespaceURI: "http://www.w3.org/1999/xhtml",
    attributes: [],
    childNodes: [{ nodeType: 3, textContent: "root_req" }],
    getAttribute: () => null,
    style: { getPropertyValue: () => "" },
  };
  const primitive = captureSvgTree(source, {
    computedStyle: () => ({
      getPropertyValue: (name) =>
        name === "text-transform" ? "uppercase" : "",
    }),
  });
  assert.equal(primitive.style["text-transform"], "uppercase");
  const restored = sceneToSvg(scene([{
    kind: "fallback",
    sourcePath: "label",
    z: 0,
    bounds,
    reason: "unsupported",
    meta: { svg: primitive },
  }]), { document });
  const span = all(restored).find((node) => node.tagName === "span");
  assert.equal(span.attributes.get("style:text-transform"), "uppercase");
});

test("SVG capture preserves computed outline paint for marker fallbacks", () => {
  const source = {
    nodeType: 1,
    localName: "rect",
    namespaceURI: "http://www.w3.org/2000/svg",
    attributes: [],
    childNodes: [],
    getAttribute: () => null,
    style: { getPropertyValue: () => "" },
    closest: () => null,
  };
  const primitive = captureSvgTree(source, {
    computedStyle: () => ({
      getPropertyValue: (name) => ({
        "outline-width": "4px",
        "outline-style": "solid",
        "outline-color": "rgb(255, 0, 0)",
        "outline-offset": "-4px",
      }[name] || ""),
    }),
  });
  assert.equal(primitive.style["outline-width"], "4px");
  assert.equal(primitive.style["outline-style"], "solid");
  assert.equal(primitive.style["outline-color"], "rgb(255, 0, 0)");
  assert.equal(primitive.style["outline-offset"], "-4px");
  const restored = sceneToSvg(scene([{
    kind: "fallback",
    sourcePath: "marker",
    z: 0,
    bounds,
    reason: "unsupported",
    meta: { svg: primitive },
  }]), { document });
  const rectangle = all(restored).find((node) => node.tagName === "rect");
  assert.equal(rectangle.attributes.get("style:outline-width"), "4px");
  assert.equal(rectangle.attributes.get("style:outline-style"), "solid");
  assert.equal(
    rectangle.attributes.get("style:outline-color"),
    "rgb(255, 0, 0)",
  );
  assert.equal(rectangle.attributes.get("style:outline-offset"), "-4px");
});

test("text preserves explicit transparent paint and zero font sizes", () => {
  const svg = sceneToSvg(scene([{
    kind: "text", sourcePath: "label", z: 0, bounds,
    text: { paragraphs: [{ runs: [{ text: "Hidden", color: null, fontSize: 0 }] }] },
  }]), { document });
  const span = all(svg).find((node) => node.tagName === "tspan");
  assert.equal(span.attributes.get("fill"), "none");
  assert.equal(span.attributes.get("font-size"), "0");
});

test("SVG capture retains class terminal CSS sizing instead of using foreignObject attributes", () => {
  const source = {
    nodeType: 1, localName: "foreignObject", namespaceURI: "http://www.w3.org/2000/svg",
    attributes: [{ name: "width", value: "26.359375" }, { name: "height", value: "16.5" }],
    childNodes: [],
    getAttribute: (name) => name === "style" ? "width: 36.123456px; height: 12px;" : null,
  };
  const primitive = captureSvgTree(source, {
    computedStyle: () => ({ getPropertyValue: (name) => ({ width: "36.1235px", height: "12px" }[name] || "") }),
  });
  assert.equal(primitive.attributes.width, "26.359375");
  assert.equal(primitive.attributes.height, "16.5");
  assert.equal(primitive.style.width, "36.123456px");
  assert.equal(primitive.style.height, "12px");
  const restored = all(sceneToSvg(scene([{
    kind: "fallback", sourcePath: "terminal", z: 0, bounds, reason: "unsupported", meta: { svg: primitive },
  }]), { document })).find((element) => element.tagName === "foreignObject");
  assert.equal(restored.attributes.get("style:width"), "36.123456px");
  assert.equal(restored.attributes.get("style:height"), "12px");
});

test("SVG capture retains computed circle and path geometry overrides", () => {
  const circleAttributes = { cx: "9", cy: "9", r: "6" };
  const circle = captureSvgTree({
    nodeType: 1,
    localName: "circle",
    namespaceURI: "http://www.w3.org/2000/svg",
    attributes: [
      { name: "cx", value: "9" },
      { name: "cy", value: "9" },
      { name: "r", value: "6" },
    ],
    childNodes: [],
    getAttribute: (name) => circleAttributes[name] ?? null,
    closest: (selector) => selector === "marker" ? {} : null,
  }, {
    computedStyle: () => ({
      getPropertyValue: (name) => ({
        cx: "15px",
        cy: "18px",
        r: "12px",
      }[name] || ""),
    }),
  });
  assert.deepEqual(circle.style, {
    cx: "15px",
    cy: "18px",
    r: "12px",
  });

  const pathAttribute = "M9,0 L9,18";
  const path = captureSvgTree({
    nodeType: 1,
    localName: "path",
    namespaceURI: "http://www.w3.org/2000/svg",
    attributes: [{ name: "d", value: pathAttribute }],
    childNodes: [],
    getAttribute: (name) => name === "d" ? pathAttribute : null,
    closest: () => null,
  }, {
    computedStyle: () => ({
      getPropertyValue: (name) =>
        name === "d" ? 'path("M 0 0 L 18 18")' : "",
    }),
  });
  assert.equal(path.style.d, 'path("M 0 0 L 18 18")');

  const unchangedCircle = captureSvgTree({
    nodeType: 1,
    localName: "circle",
    namespaceURI: "http://www.w3.org/2000/svg",
    attributes: Object.entries(circleAttributes).map(([name, value]) => ({
      name,
      value,
    })),
    childNodes: [],
    getAttribute: (name) => circleAttributes[name] ?? null,
    closest: (selector) => selector === "marker" ? {} : null,
  }, {
    computedStyle: () => ({
      getPropertyValue: (name) => ({
        cx: "9px",
        cy: "9px",
        r: "6px",
      }[name] || ""),
    }),
  });
  assert.deepEqual(unchangedCircle.style, {});

  const unchangedPath = captureSvgTree({
    nodeType: 1,
    localName: "path",
    namespaceURI: "http://www.w3.org/2000/svg",
    attributes: [{ name: "d", value: pathAttribute }],
    childNodes: [],
    getAttribute: (name) => name === "d" ? pathAttribute : null,
    closest: () => null,
  }, {
    computedStyle: () => ({
      getPropertyValue: (name) =>
        name === "d" ? 'path("M 9 0 L 9 18")' : "",
    }),
  });
  assert.deepEqual(unchangedPath.style, {});

  const precisePathAttribute =
    "M-71.8203125 -72 C-30.511663936534845 -72 10.79698462693031 -72 71.8203125 -72";
  const roundedComputedPath = captureSvgTree({
    nodeType: 1,
    localName: "path",
    namespaceURI: "http://www.w3.org/2000/svg",
    attributes: [{ name: "d", value: precisePathAttribute }],
    childNodes: [],
    getAttribute: (name) => name === "d" ? precisePathAttribute : null,
    closest: () => null,
  }, {
    computedStyle: () => ({
      getPropertyValue: (name) => name === "d"
        ? 'path("M -71.8203 -72 C -30.5117 -72 10.797 -72 71.8203 -72")'
        : "",
    }),
  });
  assert.deepEqual(roundedComputedPath.style, {});

  const longComputedD = `path("M 0 0 ${"L 10 20 ".repeat(2000)}")`;
  const longPath = captureSvgTree({
    nodeType: 1,
    localName: "path",
    namespaceURI: "http://www.w3.org/2000/svg",
    attributes: [{ name: "d", value: "M 0 0 L 1 1" }],
    childNodes: [],
    getAttribute: (name) => name === "d" ? "M 0 0 L 1 1" : null,
    closest: () => null,
  }, {
    computedStyle: () => ({
      getPropertyValue: (name) => name === "d" ? longComputedD : "",
    }),
  });
  assert.ok(Array.isArray(longPath.style.d));
  assert.ok(longPath.style.d.every((chunk) => chunk.length <= 8192));

  const source = scene([
    {
      kind: "fallback",
      sourcePath: "circle",
      z: 0,
      bounds,
      reason: "unsupported",
      meta: { svg: circle },
    },
    {
      kind: "fallback",
      sourcePath: "path",
      z: 1,
      bounds,
      reason: "unsupported",
      meta: { svg: path },
    },
    {
      kind: "fallback",
      sourcePath: "long-path",
      z: 2,
      bounds,
      reason: "unsupported",
      meta: { svg: longPath },
    },
  ]);
  const restored = all(sceneToSvg(source, { document }));
  const restoredCircle = restored.find((element) => element.tagName === "circle");
  const restoredPaths = restored.filter((element) => element.tagName === "path");
  const restoredPath = restoredPaths[0];
  assert.equal(restoredCircle.attributes.get("r"), "6");
  assert.equal(restoredCircle.attributes.get("style:cx"), "15px");
  assert.equal(restoredCircle.attributes.get("style:cy"), "18px");
  assert.equal(restoredCircle.attributes.get("style:r"), "12px");
  assert.equal(restoredPath.attributes.get("d"), "M9,0 L9,18");
  assert.equal(restoredPath.attributes.get("style:d"), 'path("M 0 0 L 18 18")');
  assert.equal(restoredPaths[1].attributes.get("style:d"), longComputedD);
});
