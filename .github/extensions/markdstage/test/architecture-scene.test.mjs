import assert from "node:assert/strict";
import test from "node:test";

import {
  architecturePowerPointSnapshot,
  parseArchitecture,
} from "../renderer/architecture.mjs";
import { architectureSnapshotToScene } from "../renderer/architecture-scene.mjs";
import { sceneToPptxElements } from "../renderer/scene-pptx.mjs";
import { buildPptxPackage, inspectPptxPackage } from "../runtime/pptx-package.mjs";

const COLORS = new Map([
  ["var(--surface)", "#F8FAFC"],
  ["var(--border)", "#CBD5E1"],
  ["var(--node)", "#DBEAFE"],
  ["var(--node-border)", "#2563EB"],
  ["var(--node-text)", "#0F172A"],
  ["var(--group)", "rgba(248, 250, 252, 0.72)"],
  ["var(--group-border)", "#94A3B8"],
  ["var(--connector)", "#475569"],
]);

function resolveColor(value) {
  return COLORS.get(value) || (String(value).startsWith("var(") ? "#111111" : value);
}

function snapshotFrom(source) {
  return architecturePowerPointSnapshot(parseArchitecture(JSON.stringify(source)));
}

test("maps a representative Architecture snapshot to scene nodes", () => {
  const snapshot = snapshotFrom({
    version: 1,
    canvas: { width: 800, height: 360 },
    elements: [
      {
        type: "group",
        id: "services",
        x: 20,
        y: 20,
        width: 500,
        height: 320,
        title: "Services",
        children: [
          { type: "node", id: "api", x: 50, y: 100, width: 170, height: 100, text: "API", icon: "api" },
          { type: "node", id: "worker", x: 280, y: 100, width: 170, height: 100, text: "Worker" },
        ],
      },
      { type: "connector", from: "api", to: "worker", label: "calls" },
    ],
  });
  const { scene, diagnostics } = architectureSnapshotToScene(snapshot, {
    resolveColor,
    resolveImage: (entry, kind) => `data:image/png;base64,${kind}-${entry.id}`,
  });

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(scene.nodes.map((node) => node.kind), snapshot.objects.flatMap((object) => {
    const kinds = [object.type === "connector" ? "connector" : object.type === "image" ? "image" : "shape"];
    if (object.icon) kinds.push("image");
    return kinds;
  }));
  assert.deepEqual(scene.nodes.map((node) => node.z), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(scene.nodes[0].bounds, { x: 20, y: 20, width: 500, height: 320 });
  assert.equal(scene.nodes.find((node) => node.id === "api").text.paragraphs[0].runs[0].text, "API");
  assert.equal(scene.nodes.find((node) => node.kind === "image").src, "data:image/png;base64,icon-picture-api");
  assert.deepEqual(scene.nodes.find((node) => node.id === "api").meta, {
    architecture: { kind: "node", id: "api", sourcePath: "elements[0].children[0]", order: 1, z: 0 },
    icon: "api",
  });
  assert.equal(scene.nodes.find((node) => node.kind === "image").meta.architecture.kind, "icon-picture");
  assert.equal(scene.nodes.find((node) => node.kind === "connector").points.length, 2);
  assert.equal(
    scene.nodes.find((node) => node.kind === "shape" && node.text?.paragraphs[0]?.runs[0]?.text === "calls")
      .text.paragraphs[0].runs[0].text,
    "calls",
  );
});

test("nested group geometry is preserved as absolute scene coordinates", () => {
  const snapshot = snapshotFrom({
    version: 1,
    canvas: { width: 900, height: 420 },
    elements: [
      {
        type: "group",
        id: "outer",
        x: 40,
        y: 30,
        width: 760,
        height: 340,
        title: "Outer",
        children: [
          {
            type: "group",
            id: "inner",
            x: 80,
            y: 90,
            width: 360,
            height: 200,
            title: "Inner",
            children: [
              { type: "node", id: "nested", x: 120, y: 150, width: 160, height: 90, text: "Nested" },
            ],
          },
        ],
      },
    ],
  });
  const { scene } = architectureSnapshotToScene(snapshot, { resolveColor });
  const nested = scene.nodes.find((node) => node.id === "nested");

  assert.deepEqual(nested.bounds, { x: 240, y: 270, width: 160, height: 90 });
});

test("applies injected color resolution before scene validation", () => {
  const snapshot = snapshotFrom({
    version: 1,
    canvas: { width: 320, height: 180 },
    elements: [{ type: "node", id: "api", x: 20, y: 20, width: 120, height: 70, text: "API" }],
  });
  const { scene } = architectureSnapshotToScene(snapshot, {
    resolveColor: (value) => String(value).startsWith("var(") ? "#ABCDEF" : value,
  });

  assert.equal(scene.nodes[0].style.fill, "#ABCDEF");
  assert.equal(JSON.stringify(scene).includes("var(--"), false);
});

test("snapshot fallbacks become scene fallbacks with reasons preserved", () => {
  const snapshot = {
    version: 1,
    canvas: { width: 400, height: 200 },
    objects: [],
    icons: [],
    fallbacks: [
      {
        type: "architecture-filter",
        path: "filters[0]",
        reason: "unsupported-filter",
        x: 10,
        y: 20,
        width: 30,
        height: 40,
      },
    ],
  };
  const { scene } = architectureSnapshotToScene(snapshot);

  assert.deepEqual(scene.nodes, [
    {
      kind: "fallback",
      sourcePath: "filters[0]",
      z: 0,
      bounds: { x: 10, y: 20, width: 30, height: 40 },
      capability: { pptx: "fallback", reason: "unsupported-filter" },
      reason: "unsupported-filter",
    },
  ]);
});

test("connectors keep points, arrows, dash, and label shapes", () => {
  const snapshot = snapshotFrom({
    version: 1,
    canvas: { width: 600, height: 260 },
    elements: [
      { type: "node", id: "a", x: 40, y: 80, width: 120, height: 70, text: "A" },
      { type: "node", id: "b", x: 400, y: 80, width: 120, height: 70, text: "B" },
      { type: "connector", from: "a", to: "b", routing: "polyline", points: [{ x: 220, y: 80 }], arrow: true, style: { dash: "4 4" }, label: "calls" },
    ],
  });
  const { scene } = architectureSnapshotToScene(snapshot, { resolveColor });
  const connector = scene.nodes.find((node) => node.kind === "connector");
  const label = scene.nodes.find(
    (node) => node.kind === "shape" && node.text?.paragraphs[0]?.runs[0]?.text === "calls",
  );

  assert.deepEqual(
    connector.points,
    snapshot.objects.find((object) => object.type === "connector").points,
  );
  assert.deepEqual(connector.meta, {
    architecture: { kind: "connector", id: "", sourcePath: "elements[2]", order: 2, z: -10 },
    from: "a",
    to: "b",
  });
  assert.equal(connector.arrowEnd, "triangle");
  assert.equal(connector.style.dash, "dash");
  assert.equal(label.text.paragraphs[0].runs[0].text, "calls");
});

test("icons and images route through the injected image resolver", () => {
  const snapshot = {
    version: 1,
    title: "Images",
    canvas: { width: 400, height: 240 },
    objects: [
      {
        type: "shape",
        shape: "roundedRect",
        x: 20,
        y: 20,
        width: 120,
        height: 80,
        fill: "#FFFFFF",
        stroke: "#000000",
        strokeWidth: 1,
        icon: "api",
        architecture: { kind: "node", id: "api", sourcePath: "elements[0]", order: 0, z: 0 },
      },
      {
        type: "image",
        x: 180,
        y: 20,
        width: 120,
        height: 80,
        src: "/asset.png",
        fit: "contain",
        architecture: { kind: "image", id: "asset", sourcePath: "elements[1]", order: 1, z: 0 },
      },
    ],
    icons: [{ id: "api", icon: "api", sourcePath: "elements[0]", x: 36, y: 36, width: 32, height: 32 }],
    fallbacks: [],
  };
  const calls = [];
  const { scene } = architectureSnapshotToScene(snapshot, {
    resolveImage: (entry, kind) => {
      calls.push({ kind, id: entry.id || entry.architecture?.id });
      return {
        src: `data:image/png;base64,${kind}`,
        bounds: { x: 1, y: calls.length, width: 3, height: 4 },
      };
    },
  });

  assert.deepEqual(calls, [
    { kind: "icon-picture", id: "api" },
    { kind: "image-picture", id: "asset" },
  ]);
  assert.deepEqual(
    scene.nodes.filter((node) => node.kind === "image").map((node) => node.src),
    ["data:image/png;base64,icon-picture", "data:image/png;base64,image-picture"],
  );
  assert.deepEqual(
    scene.nodes.filter((node) => node.kind === "image").map((node) => node.meta.architecture.kind),
    ["icon-picture", "image-picture"],
  );
});

test("scene PowerPoint elements are accepted by the package writer", () => {
  const snapshot = snapshotFrom({
    version: 1,
    canvas: { width: 600, height: 260 },
    elements: [
      { type: "node", id: "a", x: 40, y: 80, width: 120, height: 70, text: "A" },
      { type: "node", id: "b", x: 400, y: 80, width: 120, height: 70, text: "B" },
      { type: "connector", from: "a", to: "b", arrow: true, label: "calls" },
    ],
  });
  const { scene } = architectureSnapshotToScene(snapshot, {
    resolveColor,
  });
  const { elements, fallbacks } = sceneToPptxElements(scene, { pathPrefix: "architecture[0]" });

  assert.deepEqual(fallbacks, []);
  const buffer = buildPptxPackage({ title: "Architecture scene", slides: [{ elements }] });
  assert.equal(inspectPptxPackage(buffer).valid, true);
});
