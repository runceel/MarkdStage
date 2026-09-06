import assert from "node:assert/strict";
import test from "node:test";

import {
  createScene,
  normalizeScene,
  validateScene,
} from "../renderer/scene-graph.mjs";
import { sceneToPptxElements } from "../renderer/scene-pptx.mjs";
import {
  buildPptxPackage,
  inspectPptxPackage,
} from "../runtime/pptx-package.mjs";

function richText(text = "Text") {
  return {
    paragraphs: [
      {
        alignment: "center",
        runs: [
          {
            text,
            fontSize: 20,
            fontFace: "Aptos",
            fontWeight: 600,
            bold: true,
            italic: false,
            color: "#123456",
            opacity: 0.9,
          },
        ],
      },
    ],
  };
}

function normalizedScene(overrides = {}) {
  const result = normalizeScene(createScene({
    width: 800,
    height: 450,
    source: { kind: "architecture", path: "slides.md#1" },
    nodes: [
      {
        kind: "group",
        id: "group",
        sourcePath: "groups[0]",
        z: 10,
        bounds: { x: 10, y: 20, width: 220, height: 120 },
        children: [],
        style: {
          fill: "#f8fafc",
          stroke: "#334155",
          strokeWidth: 2,
          dash: "solid",
          opacity: 0.8,
          cornerRadius: 12,
        },
        text: richText("Group"),
        textLayout: {
          verticalAlignment: "top",
          textWrap: "none",
          textInsets: { left: 10, top: 6, right: 10, bottom: 6 },
        },
      },
      {
        kind: "shape",
        id: "shape",
        sourcePath: "nodes[0]",
        z: 20,
        bounds: { x: 260, y: 20, width: 130, height: 80 },
        preset: "roundedRect",
        style: {
          fill: "rgba(255, 255, 255, 0.8)",
          stroke: "rgb(15 23 42)",
          strokeWidth: 3,
          dash: "dash",
          opacity: 0.7,
          cornerRadius: 8,
        },
        text: richText("Shape"),
        textLayout: {
          verticalAlignment: "middle",
          textWrap: "square",
          textInsets: { left: 8, top: 4, right: 8, bottom: 4 },
        },
      },
      {
        kind: "text",
        id: "text",
        sourcePath: "labels[0]",
        z: 30,
        bounds: { x: 410, y: 20, width: 150, height: 50 },
        text: richText("Standalone"),
        textLayout: {
          textWrap: "none",
          textInsets: { left: 2, top: 1, right: 2, bottom: 1 },
        },
      },
      {
        kind: "image",
        id: "image",
        sourcePath: "images[0]",
        z: 40,
        bounds: { x: 580, y: 20, width: 120, height: 80 },
        src: "./images/cloud.png",
        alt: "Cloud",
        fit: "contain",
        opacity: 0.75,
      },
      {
        kind: "connector",
        id: "connector",
        sourcePath: "connectors[0]",
        z: 50,
        points: [{ x: 320, y: 120 }, { x: 430, y: 170 }, { x: 540, y: 120 }],
        style: {
          stroke: "#2563eb",
          strokeWidth: 1.5,
          dash: "dot",
          opacity: 0.95,
        },
        arrowStart: "none",
        arrowEnd: "triangle",
        label: {
          text: richText("calls"),
          bounds: { x: 390, y: 130, width: 80, height: 24 },
        },
      },
      {
        kind: "fallback",
        id: "fallback",
        sourcePath: "filters[0]",
        z: 60,
        bounds: { x: 80, y: 250, width: 160, height: 90 },
        capability: { pptx: "fallback", reason: "unsupported-filter" },
        reason: "unsupported-filter",
      },
    ],
    ...overrides,
  }));
  validateScene(result.scene);
  return result.scene;
}

function readStoredZip(buffer) {
  const eocd = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(eocd), 0x06054b50);
  const count = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const files = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString("utf8");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    files.set(name, buffer.subarray(dataOffset, dataOffset + size).toString("utf8"));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

test("maps every scene node kind to the PowerPoint model shape", () => {
  const { elements, fallbacks } = sceneToPptxElements(normalizedScene(), {
    pathPrefix: "architecture[1]",
    zOrderBase: 7,
    zOrderStep: 0.01,
  });

  assert.deepEqual(elements.map((element) => element.type), [
    "shape",
    "shape",
    "text",
    "image",
    "connector",
  ]);
  assert.deepEqual(elements.map((element) => element.path), [
    "architecture[1].groups[0]",
    "architecture[1].nodes[0]",
    "architecture[1].labels[0]",
    "architecture[1].images[0]",
    "architecture[1].connectors[0]",
  ]);
  assert.deepEqual(elements.map((element) => element.zOrder), [
    7,
    7.01,
    7.02,
    7.03,
    7.04,
  ]);

  assert.deepEqual(
    elements[0],
    {
      type: "shape",
      path: "architecture[1].groups[0]",
      shape: "roundedRect",
      x: 10,
      y: 20,
      width: 220,
      height: 120,
      zOrder: 7,
      fill: "#f8fafc",
      stroke: "#334155",
      strokeWidth: 2,
      opacity: 0.8,
      cornerRadius: 12,
      text: richText("Group"),
      verticalAlignment: "top",
      textWrap: "none",
      textInsets: { left: 10, top: 6, right: 10, bottom: 6 },
    },
  );
  assert.equal(elements[1].shape, "roundedRect");
  assert.equal(elements[1].dash, "dash");
  assert.deepEqual(elements[1].text, richText("Shape"));
  assert.equal(elements[1].verticalAlignment, "middle");
  assert.equal(elements[2].paragraphs[0].runs[0].text, "Standalone");
  assert.equal(elements[2].text, undefined);
  assert.deepEqual(
    {
      src: elements[3].src,
      alt: elements[3].alt,
      fit: elements[3].fit,
      opacity: elements[3].opacity,
      shape: elements[3].shape,
    },
    {
      src: "./images/cloud.png",
      alt: "Cloud",
      fit: "contain",
      opacity: 0.75,
      shape: "rect",
    },
  );
  assert.deepEqual(fallbacks, [
    {
      type: "architecture",
      path: "architecture[1].filters[0]",
      sourcePath: "filters[0]",
      reason: "unsupported-filter",
      x: 80,
      y: 250,
      width: 160,
      height: 90,
      zOrder: 7.05,
    },
  ]);
});

test("connectors keep points, arrow end, and editable label fields", () => {
  const { elements } = sceneToPptxElements(normalizedScene(), {
    pathPrefix: "mermaid[0]",
    zOrderBase: 4,
  });
  const connector = elements.find((element) => element.type === "connector");

  assert.deepEqual(connector.points, [
    { x: 320, y: 120 },
    { x: 430, y: 170 },
    { x: 540, y: 120 },
  ]);
  assert.equal(connector.arrowEnd, "triangle");
  assert.equal(connector.stroke, "#2563eb");
  assert.equal(connector.strokeWidth, 1.5);
  assert.equal(connector.dash, "dot");
  assert.equal(connector.opacity, 0.95);
  assert.deepEqual(connector.label, richText("calls"));
  assert.deepEqual(connector.labelBounds, { x: 390, y: 130, width: 80, height: 24 });
});

test("node meta is passed through to PowerPoint elements", () => {
  const scene = normalizedScene({
    nodes: [
      {
        kind: "connector",
        sourcePath: "connectors[0]",
        z: 0,
        points: [{ x: 10, y: 10 }, { x: 90, y: 90 }],
        arrowStart: "none",
        arrowEnd: "triangle",
        meta: {
          architecture: { kind: "connector", id: "edge", order: 2 },
          from: "api",
          to: "worker",
        },
      },
    ],
  });
  const { elements } = sceneToPptxElements(scene);

  assert.deepEqual(elements[0].architecture, { kind: "connector", id: "edge", order: 2 });
  assert.equal(elements[0].from, "api");
  assert.equal(elements[0].to, "worker");
});

test("node meta cannot override standard PowerPoint element fields", () => {
  const scene = normalizedScene({
    nodes: [
      {
        kind: "shape",
        sourcePath: "nodes[0]",
        z: 0,
        bounds: { x: 10, y: 20, width: 30, height: 40 },
        preset: "ellipse",
        style: { fill: "#ffffff" },
        meta: {
          type: "image",
          path: "corrupt",
          shape: "rect",
          x: 999,
          y: 999,
          width: 999,
          height: 999,
          zOrder: 999,
          fill: "#000000",
        },
      },
    ],
  });
  const { elements } = sceneToPptxElements(scene, {
    pathPrefix: "architecture[0]",
    zOrderBase: 3,
  });

  assert.deepEqual(
    {
      type: elements[0].type,
      path: elements[0].path,
      shape: elements[0].shape,
      x: elements[0].x,
      y: elements[0].y,
      width: elements[0].width,
      height: elements[0].height,
      zOrder: elements[0].zOrder,
      fill: elements[0].fill,
    },
    {
      type: "shape",
      path: "architecture[0].nodes[0]",
      shape: "ellipse",
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      zOrder: 3,
      fill: "#ffffff",
    },
  );
});

test("emitPath and emitZOrder can be disabled for elements only", () => {
  const { elements, fallbacks } = sceneToPptxElements(normalizedScene(), {
    pathPrefix: "architecture[0]",
    emitPath: false,
    emitZOrder: false,
  });

  assert.ok(elements.every((element) => !("path" in element)));
  assert.ok(elements.every((element) => !("zOrder" in element)));
  assert.ok(fallbacks.every((fallback) => fallback.path?.startsWith("architecture[0].")));
  assert.ok(fallbacks.every((fallback) => typeof fallback.zOrder === "number"));
});

test("fallback nodes never become elements and zero-area bounds disable artwork", () => {
  const scene = normalizedScene({
    nodes: [
      {
        kind: "fallback",
        sourcePath: "unsupported[0]",
        z: 2,
        bounds: { x: 40, y: 50, width: 0, height: 100 },
        reason: "zero-width",
      },
    ],
  });
  const { elements, fallbacks } = sceneToPptxElements(scene, {
    pathPrefix: "mermaid[3]",
    zOrderBase: 2,
    fallbackType: "mermaid",
  });

  assert.deepEqual(elements, []);
  assert.deepEqual(fallbacks, [
    {
      type: "mermaid",
      path: "mermaid[3].unsupported[0]",
      sourcePath: "unsupported[0]",
      reason: "zero-width",
      x: 40,
      y: 50,
      width: 0,
      height: 100,
      zOrder: 2,
      artwork: false,
    },
  ]);
});

test("group frame geometry follows the producer's groupPreset option", () => {
  const scene = normalizedScene();
  const rounded = sceneToPptxElements(scene, { pathPrefix: "architecture[0]" });
  const square = sceneToPptxElements(scene, { pathPrefix: "mermaid[0]", groupPreset: "rect" });

  assert.equal(rounded.elements[0].shape, "roundedRect");
  assert.equal(square.elements[0].shape, "rect");
});

test("output is JSON-serializable and deterministic across runs", () => {
  const scene = normalizedScene();
  const first = sceneToPptxElements(scene, { pathPrefix: "architecture[0]" });
  const second = sceneToPptxElements(scene, { pathPrefix: "architecture[0]" });

  assert.deepEqual(first, second);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.ok(
    first.elements.every((element, index, array) =>
      index === 0 || array[index - 1].zOrder < element.zOrder,
    ),
  );
  assert.ok(first.fallbacks.every((fallback) => !("captureId" in fallback)));
});

test("produced editable elements are accepted by the real PowerPoint writer", () => {
  const scene = normalizedScene({
    nodes: [
      {
        kind: "shape",
        sourcePath: "nodes[0]",
        z: 0,
        bounds: { x: 40, y: 60, width: 220, height: 100 },
        preset: "roundedRect",
        style: { fill: "#dbeafe", stroke: "#1d4ed8", strokeWidth: 2, dash: "dash" },
        text: richText("Editable shape"),
        textLayout: { verticalAlignment: "middle", textWrap: "none" },
      },
      {
        kind: "text",
        sourcePath: "labels[0]",
        z: 1,
        bounds: { x: 300, y: 60, width: 180, height: 50 },
        text: richText("Editable text"),
      },
      {
        kind: "connector",
        sourcePath: "connectors[0]",
        z: 2,
        points: [{ x: 220, y: 160 }, { x: 420, y: 200 }],
        style: { stroke: "#ef4444", strokeWidth: 3, dash: "dashDot" },
        arrowStart: "none",
        arrowEnd: "triangle",
        label: {
          text: richText("Flow"),
          bounds: { x: 280, y: 150, width: 90, height: 28 },
        },
      },
    ],
  });
  const { elements, fallbacks } = sceneToPptxElements(scene, {
    pathPrefix: "architecture[0]",
    zOrderBase: 5,
  });

  assert.deepEqual(fallbacks, []);
  const buffer = buildPptxPackage({
    title: "Scene graph",
    slides: [{ elements }],
  });
  const summary = inspectPptxPackage(buffer);
  assert.equal(summary.valid, true);
  const files = readStoredZip(buffer);
  const slideXml = files.get("ppt/slides/slide1.xml");
  assert.match(slideXml, /<p:sp>/);
  assert.match(slideXml, /<a:prstGeom prst="roundRect">/);
  assert.match(slideXml, /<p:txBody>/);
  assert.match(slideXml, /<a:ln w="28575">/);
  assert.match(slideXml, /<a:tailEnd type="triangle"\/>/);
  assert.match(slideXml, /Connector label/);
});
