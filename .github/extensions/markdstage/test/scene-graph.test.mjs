import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_CONNECTOR_POINTS,
  MAX_GROUP_DEPTH,
  MAX_SCENE_NODES,
  SceneGraphError,
  createScene,
  normalizeScene,
  validateScene,
} from "../renderer/scene-graph.mjs";

function richText(text = "Text") {
  return {
    paragraphs: [
      {
        alignment: "center",
        runs: [
          {
            text,
            fontSize: 24,
            fontFace: "Aptos",
            fontWeight: 600,
            bold: true,
            italic: false,
            color: "#123456",
            opacity: 1,
          },
        ],
      },
    ],
  };
}

test("validates and normalizes explicit line caps without changing absent defaults", () => {
  for (const lineCap of [undefined, "butt", "round", "square"]) {
    const source = createScene({ width: 100, height: 100, source: { kind: "mermaid", path: "markers.svg" },
      nodes: [{ kind: "connector", sourcePath: "marker", z: 0, points: [{ x: 10, y: 10 }, { x: 20, y: 20 }],
        arrowStart: "none", arrowEnd: "none",
        style: { stroke: "#123456", ...(lineCap ? { lineCap } : {}) } }] });
    validateScene(source);
    const normalized = normalizeScene(source).scene;
    validateScene(normalized);
    assert.equal(normalized.nodes[0].style.lineCap, lineCap);
    source.nodes[0].style.lineCap = "unknown";
    assert.throws(() => validateScene(source), /lineCap/);
  }
});

function validScene(overrides = {}) {
  return createScene({
    width: 800,
    height: 450,
    source: { kind: "architecture", path: "slides.md#1" },
    accessibility: { title: "Diagram", description: "All node kinds" },
    nodes: [
      {
        kind: "group",
        id: "group",
        z: 0,
        bounds: { x: 10, y: 20, width: 220, height: 140 },
        capability: { pptx: "native" },
        accessibility: { title: "Group" },
        children: [],
        style: { fill: "#fff", stroke: "#000000", strokeWidth: 1, dash: "solid", opacity: 1, cornerRadius: 8 },
        text: richText("Group"),
        textLayout: {
          alignment: "left",
          verticalAlignment: "top",
          textWrap: "none",
          textInsets: { left: 8, top: 4, right: 8, bottom: 4 },
        },
      },
      {
        kind: "shape",
        id: "shape",
        sourcePath: "elements[0]",
        z: 1,
        bounds: { x: 260, y: 20, width: 120, height: 80 },
        capability: { pptx: "native" },
        preset: "roundedRect",
        style: { fill: "rgba(255, 255, 255, 0.8)", stroke: "rgb(0 0 0)", strokeWidth: 2, dash: "dash", opacity: 0.9 },
        text: richText("Shape"),
        textLayout: { verticalAlignment: "middle", textWrap: "square" },
      },
      {
        kind: "text",
        id: "text",
        z: 2,
        bounds: { x: 400, y: 20, width: 140, height: 50 },
        capability: { pptx: "native" },
        text: richText("Standalone"),
      },
      {
        kind: "image",
        id: "image",
        z: 3,
        bounds: { x: 560, y: 20, width: 120, height: 80 },
        capability: { pptx: "native" },
        src: "./images/cloud.png",
        alt: "Cloud",
        fit: "contain",
        opacity: 0.75,
      },
      {
        kind: "connector",
        id: "connector",
        z: 4,
        capability: { pptx: "native" },
        points: [{ x: 320, y: 100 }, { x: 420, y: 150 }, { x: 520, y: 100 }],
        style: { stroke: "#336699", strokeWidth: 1.5, dash: "dot", opacity: 1 },
        arrowStart: "none",
        arrowEnd: "triangle",
        label: {
          text: richText("calls"),
          bounds: { x: 400, y: 105, width: 80, height: 24 },
        },
      },
      {
        kind: "fallback",
        id: "fallback",
        z: 5,
        bounds: { x: 100, y: 240, width: 160, height: 90 },
        capability: { pptx: "fallback", reason: "unsupported-filter" },
        reason: "unsupported-filter",
      },
    ],
    ...overrides,
  });
}

test("valid scenes for every node kind are JSON-serializable without drift", () => {
  const { scene, diagnostics } = normalizeScene(validScene());
  assert.deepEqual(diagnostics, []);
  assert.equal(validateScene(scene), scene);
  assert.deepEqual(JSON.parse(JSON.stringify(scene)), scene);
  assert.deepEqual(scene.nodes.map((node) => node.kind), [
    "group",
    "shape",
    "text",
    "image",
    "connector",
    "fallback",
  ]);
});

test("nested group children flatten into absolute coordinates", () => {
  const { scene } = normalizeScene(validScene({
    nodes: [
      {
        kind: "group",
        id: "outer",
        z: 0,
        bounds: { x: 10.04, y: 20.05, width: 200, height: 100 },
        children: [
          {
            kind: "group",
            id: "inner",
            z: 1,
            bounds: { x: 5.05, y: 6.04, width: 100, height: 80 },
            children: [
              {
                kind: "shape",
                id: "leaf",
                z: 2,
                bounds: { x: 2.04, y: 3.05, width: 40, height: 30 },
                preset: "rect",
              },
            ],
          },
        ],
      },
    ],
  }));

  assert.deepEqual(scene.nodes.map((node) => [node.id, node.bounds]), [
    ["outer", { x: 10, y: 20.1, width: 200, height: 100 }],
    ["inner", { x: 15.1, y: 26.1, width: 100, height: 80 }],
    ["leaf", { x: 17.1, y: 29.2, width: 40, height: 30 }],
  ]);
  assert.deepEqual(scene.nodes.filter((node) => node.kind === "group").map((node) => node.children), [[], []]);
  validateScene(scene);
});

test("z-order is deterministic and stable for equal z values", () => {
  const input = validScene({
    nodes: [
      { kind: "shape", id: "a", z: 2, bounds: { x: 0, y: 0, width: 10, height: 10 }, preset: "rect" },
      { kind: "shape", id: "b", z: 2, bounds: { x: 0, y: 0, width: 10, height: 10 }, preset: "rect" },
      { kind: "shape", id: "c", z: 1, bounds: { x: 0, y: 0, width: 10, height: 10 }, preset: "rect" },
      { kind: "shape", id: "d", bounds: { x: 0, y: 0, width: 10, height: 10 }, preset: "rect" },
    ],
  });

  assert.deepEqual(normalizeScene(input).scene.nodes.map((node) => [node.id, node.z]), [
    ["c", 0],
    ["a", 1],
    ["b", 2],
    ["d", 3],
  ]);
  assert.deepEqual(normalizeScene(input).scene, normalizeScene(input).scene);
});

test("node meta survives normalize and validate unchanged", () => {
  const meta = {
    architecture: { kind: "node", id: "api", order: 1 },
    flags: [true, null, 3, "editable"],
  };
  const { scene, diagnostics } = normalizeScene(validScene({
    nodes: [
      {
        kind: "shape",
        id: "api",
        z: 0,
        bounds: { x: 10, y: 10, width: 120, height: 70 },
        preset: "roundedRect",
        meta,
      },
    ],
  }));

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(scene.nodes[0].meta, meta);
  assert.equal(validateScene(scene), scene);
  assert.deepEqual(JSON.parse(JSON.stringify(scene)).nodes[0].meta, meta);
});

test("node meta rejects non-plain objects", () => {
  assert.throws(
    () => validateScene(validScene({
      nodes: [
        {
          kind: "shape",
          z: 0,
          bounds: { x: 10, y: 10, width: 120, height: 70 },
          preset: "rect",
          meta: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
    })),
    (error) => error instanceof SceneGraphError && /scene\.nodes\[0\]\.meta/.test(error.message),
  );
});

test("scene metadata survives normalization without requiring a node", () => {
  const meta = { svgRoot: { tag: "svg", attributes: { viewBox: "0 0 800 450" }, children: [] } };
  const { scene, diagnostics } = normalizeScene(validScene({ nodes: [], meta }));
  assert.deepEqual(diagnostics, []);
  assert.equal(validateScene(scene), scene);
  assert.deepEqual(JSON.parse(JSON.stringify(scene)).meta, meta);
  assert.throws(() => validateScene({ ...scene, meta: new Date() }), /scene\.meta/);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => validateScene({ ...scene, meta: cyclic }), /JSON-serializable/);
});

test("node meta does not affect ordering", () => {
  const { scene } = normalizeScene(validScene({
    nodes: [
      {
        kind: "shape",
        id: "late",
        z: 2,
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        preset: "rect",
        meta: { z: -100, order: 0 },
      },
      {
        kind: "shape",
        id: "early",
        z: 1,
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        preset: "rect",
        meta: { z: 100, order: 99 },
      },
    ],
  }));

  assert.deepEqual(scene.nodes.map((node) => node.id), ["early", "late"]);
});

test("validation failures throw SceneGraphError with the offending path", () => {
  const cases = [
    ["finite", (scene) => { scene.nodes[0].bounds.x = Number.NaN; }, /scene\.nodes\[0\]\.bounds\.x/],
    ["negative size", (scene) => { scene.nodes[0].bounds.width = -1; }, /scene\.nodes\[0\]\.bounds\.width/],
    ["color", (scene) => { scene.nodes[1].style.fill = "red"; }, /scene\.nodes\[1\]\.style\.fill/],
    ["opacity", (scene) => { scene.nodes[1].style.opacity = 2; }, /scene\.nodes\[1\]\.style\.opacity/],
    ["kind", (scene) => { scene.nodes[0].kind = "layer"; }, /scene\.nodes\[0\]\.kind/],
    ["preset", (scene) => { scene.nodes[1].preset = "cloud"; }, /scene\.nodes\[1\]\.preset/],
    ["dash", (scene) => { scene.nodes[1].style.dash = "dotted"; }, /scene\.nodes\[1\]\.style\.dash/],
    ["fit", (scene) => { scene.nodes[3].fit = "stretch"; }, /scene\.nodes\[3\]\.fit/],
    ["arrow", (scene) => { scene.nodes[4].arrowEnd = true; }, /scene\.nodes\[4\]\.arrowEnd/],
    ["few points", (scene) => { scene.nodes[4].points = [{ x: 1, y: 1 }]; }, /scene\.nodes\[4\]\.points/],
    ["duplicate points", (scene) => { scene.nodes[4].points = [{ x: 1, y: 1 }, { x: 1, y: 1 }]; }, /scene\.nodes\[4\]\.points\[0\].*scene\.nodes\[4\]\.points\[1\]/],
    ["unknown property", (scene) => { scene.nodes[1].shadow = true; }, /scene\.nodes\[1\]\.shadow/],
  ];

  for (const [name, mutate, pattern] of cases) {
    const scene = validScene();
    mutate(scene);
    assert.throws(
      () => validateScene(scene),
      (error) => error instanceof SceneGraphError && pattern.test(error.message),
      name,
    );
  }
});

test("scene limits are enforced", () => {
  assert.throws(
    () => validateScene(validScene({
      nodes: Array.from({ length: MAX_SCENE_NODES + 1 }, (_, index) => ({
        kind: "shape",
        z: index,
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        preset: "rect",
      })),
    })),
    SceneGraphError,
  );

  let child = { kind: "shape", z: MAX_GROUP_DEPTH + 1, bounds: { x: 0, y: 0, width: 1, height: 1 }, preset: "rect" };
  for (let index = 0; index < MAX_GROUP_DEPTH; index += 1) {
    child = { kind: "group", z: index, bounds: { x: 0, y: 0, width: 1, height: 1 }, children: [child] };
  }
  assert.throws(() => validateScene(validScene({ nodes: [child] })), SceneGraphError);

  assert.throws(
    () => validateScene(validScene({
      nodes: [
        {
          kind: "connector",
          z: 0,
          points: Array.from({ length: MAX_CONNECTOR_POINTS + 1 }, (_, index) => ({ x: index, y: index + 1 })),
          arrowStart: "none",
          arrowEnd: "none",
        },
      ],
    })),
    SceneGraphError,
  );
});

test("unsupported native input becomes a fallback node with a diagnostic", () => {
  const { scene, diagnostics } = normalizeScene(validScene({
    nodes: [
      {
        kind: "shape",
        id: "unsupported",
        z: 7,
        bounds: { x: 20, y: 30, width: 40, height: 50 },
        preset: "cloud",
      },
    ],
  }));

  assert.deepEqual(diagnostics, [
    {
      path: "scene.nodes[0]",
      kind: "fallback",
      reason: "unsupported shape preset: cloud",
    },
  ]);
  assert.deepEqual(scene.nodes, [
    {
      kind: "fallback",
      id: "unsupported",
      z: 0,
      bounds: { x: 20, y: 30, width: 40, height: 50 },
      capability: { pptx: "fallback", reason: "unsupported shape preset: cloud" },
      reason: "unsupported shape preset: cloud",
    },
  ]);
  validateScene(scene);
});

test("normalizeScene is idempotent", () => {
  const first = normalizeScene(validScene({
    width: 800.04,
    height: 449.96,
    nodes: [
      {
        kind: "group",
        id: "group",
        z: 0,
        bounds: { x: 10.04, y: 20.05, width: 100.04, height: 80.05 },
        children: [
          {
            kind: "shape",
            id: "shape",
            z: 1,
            bounds: { x: 5.04, y: 6.05, width: 40.04, height: 30.05 },
            preset: "ellipse",
            style: { opacity: 1.5, strokeWidth: 1.04 },
          },
        ],
      },
    ],
  }));
  validateScene(first.scene);
  const second = normalizeScene(first.scene);
  assert.deepEqual(second.diagnostics, []);
  assert.deepEqual(second.scene, first.scene);
});

test("color syntax accepts serializable CSS colors and rejects unresolved CSS variables", () => {
  for (const color of ["#abc", "#AABBCC", "#aabbccdd", "rgb(1, 2, 3)", "rgb(10% 20% 30%)", "rgba(1 2 3 / 40%)"]) {
    validateScene(validScene({
      nodes: [
        {
          kind: "shape",
          z: 0,
          bounds: { x: 0, y: 0, width: 10, height: 10 },
          preset: "rect",
          style: { fill: color, stroke: null },
        },
      ],
    }));
  }

  for (const color of ["#abcd", "var(--surface)", "red", "rgb(999, 0, 0)", "rgba(1, 2, 3, 2)"]) {
    assert.throws(
      () => validateScene(validScene({
        nodes: [
          {
            kind: "shape",
            z: 0,
            bounds: { x: 0, y: 0, width: 10, height: 10 },
            preset: "rect",
            style: { fill: color },
          },
        ],
      })),
      (error) => error instanceof SceneGraphError && /scene\.nodes\[0\]\.style\.fill/.test(error.message),
      color,
    );
  }
});
