import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyMermaidDiagramRoute,
  chartPathPoints,
  ganttAxisPoints,
  isKnownGanttMilestone,
  isKnownIshikawaArrow,
  knownNarrativeCard,
  knownArchitectureCard,
  knownArchitectureArrow,
  boundedSystemDashSegments,
  classifyPolygonPreset,
  cssStyleToSceneStyle,
  decomposeSimpleSvgTransform,
  enforceSceneLimits,
  markerIdToArrow,
  knownErMarkerGeometry,
  knownMarkerGeometry,
  knownRequirementMarkerGeometry,
  markerEndpointTangents,
  polygonPointsSignature,
  isKnownSequenceTab,
  simplifyPolyline,
  textToSceneText,
  primaryFontFamily,
} from "../renderer/mermaid-scene.mjs";
import {
  MAX_CONNECTOR_POINTS,
  MAX_SCENE_NODES,
  createScene,
  normalizeScene,
  validateScene,
} from "../renderer/scene-graph.mjs";
import { sceneToPptxElements } from "../renderer/scene-pptx.mjs";
import { buildPptxPackage as buildPptxBytes } from "../runtime/pptx-package.mjs";

const buildPptxPackage = (model) => Buffer.from(buildPptxBytes(model));

test("classifies measured Mermaid polygon signatures", () => {
  assert.equal(
    classifyPolygonPreset("58.25,0 116.5,-58.25 58.25,-116.5 0,-58.25"),
    "diamond",
  );
  assert.equal(
    classifyPolygonPreset("-19.5,0 60.75,0 80.25,-39 0,-39"),
    "parallelogram",
  );
  assert.equal(
    classifyPolygonPreset("-19.5,0 112.25,0 92.75,-39 0,-39"),
    "trapezoid",
  );
  assert.equal(
    classifyPolygonPreset("0,0 111.203125,0 138.203125,-54 -27,-54"),
    "invertedTrapezoid",
  );
  assert.equal(
    classifyPolygonPreset("0,0 144.796875,0 125.296875,-39 -19.5,-39"),
    "reverseParallelogram",
  );
  assert.equal(classifyPolygonPreset("0,0 100,0 50,100"), "rect");
  assert.equal(
    polygonPointsSignature("58.2501,0 116.499,-58.25"),
    "58.25,0 116.5,-58.25",
  );
});

test("routes only bundled Mermaid SVG roles with their actual root signals", () => {
  assert.equal(classifyMermaidDiagramRoute("packet"), "packet");
  assert.equal(classifyMermaidDiagramRoute("treeView"), "treeView");
  assert.equal(classifyMermaidDiagramRoute("kanban"), "kanban");
  assert.equal(classifyMermaidDiagramRoute("block"), "block");
  assert.equal(classifyMermaidDiagramRoute("quadrantChart"), "quadrantChart");
  assert.equal(classifyMermaidDiagramRoute("xychart"), "xychart");
  assert.equal(classifyMermaidDiagramRoute("gantt"), "gantt");
  assert.equal(classifyMermaidDiagramRoute("treemap"), "treemap");
  assert.equal(classifyMermaidDiagramRoute("ishikawa"), "ishikawa");
  for (const name of ["mindmap", "timeline", "journey"]) {
    assert.equal(classifyMermaidDiagramRoute(name), name);
    assert.equal(classifyMermaidDiagramRoute(`${name}-beta`), null);
  }
  for (const name of ["c4", "architecture", "eventmodeling"]) {
    assert.equal(classifyMermaidDiagramRoute(name), name);
    assert.equal(classifyMermaidDiagramRoute(`${name}-beta`), null);
  }
  for (const sourceKeyword of ["C4Context", "C4Container", "C4Component", "C4Dynamic", "C4Deployment", "eventModeling"]) {
    assert.equal(classifyMermaidDiagramRoute(sourceKeyword), null);
  }
  assert.equal(classifyMermaidDiagramRoute("ishikawa-beta"), null);
  assert.equal(classifyMermaidDiagramRoute("treemap-beta"), null);
  assert.equal(classifyMermaidDiagramRoute("gantt-beta"), null);
  assert.equal(classifyMermaidDiagramRoute("xychart-beta"), null);
  assert.equal(classifyMermaidDiagramRoute("quadrantChart-beta"), null);
  assert.equal(classifyMermaidDiagramRoute("block-beta"), null);
  assert.equal(classifyMermaidDiagramRoute("kanban-beta"), null);
  assert.equal(classifyMermaidDiagramRoute("sequence"), "sequence");
  assert.equal(classifyMermaidDiagramRoute("class", "", true), "class");
  assert.equal(classifyMermaidDiagramRoute("er", "erDiagram", true), "er");
  assert.equal(
    classifyMermaidDiagramRoute(
      "requirement",
      "requirementDiagram",
      true,
    ),
    "requirement",
  );
  assert.equal(classifyMermaidDiagramRoute("stateDiagram", "statediagram", true), "state");
  assert.equal(classifyMermaidDiagramRoute("flowchart-v2", "flowchart", true), "flowchart");
  assert.equal(classifyMermaidDiagramRoute("packet-beta"), null);
  assert.equal(classifyMermaidDiagramRoute("treeView-beta"), null);
  assert.equal(classifyMermaidDiagramRoute("treeview"), null);
  assert.equal(classifyMermaidDiagramRoute("class", "", false), null);
  assert.equal(classifyMermaidDiagramRoute("er", "flowchart", true), null);
  assert.equal(classifyMermaidDiagramRoute("er", "erDiagram", false), null);
  assert.equal(
    classifyMermaidDiagramRoute("requirement", "flowchart", true),
    null,
  );
  assert.equal(
    classifyMermaidDiagramRoute(
      "requirement",
      "requirementDiagram",
      false,
    ),
    null,
  );
  assert.equal(
    classifyMermaidDiagramRoute("error", "requirementDiagram", true),
    null,
  );
  assert.equal(classifyMermaidDiagramRoute("class", "erDiagram", true), "class");
  assert.equal(classifyMermaidDiagramRoute("stateDiagram", "flowchart", true), null);
  assert.equal(classifyMermaidDiagramRoute("stateDiagram", "statediagram", false), null);
  assert.equal(classifyMermaidDiagramRoute("error", "statediagram", true), null);
  assert.equal(classifyMermaidDiagramRoute("packet", "flowchart", false), "packet");
});

test("recognizes only the pinned Ishikawa filled start triangle", () => {
  assert.equal(isKnownIshikawaArrow("M 10 0 L 0 5 L 10 10 Z"), true);
  assert.equal(isKnownIshikawaArrow("M10,0L0,5L10,10Z"), true);
  for (const data of ["", "M10,0L0,5L10,10", "M0,0L10,5L0,10Z", "M10,0L0,5L10,11Z",
    "m10,0l0,5l10,10z", "M10,0L0,5L10,10L0,0Z", "M10,0Q0,5,10,10Z", "M10,,0L0,5L10,10Z"]) {
    assert.equal(isKnownIshikawaArrow(data), false, data);
  }
});

test("recognizes only the bounded timeline and default mindmap card profiles", () => {
  for (const [diagram, data, preset] of [
    ["timeline", "M0 45 v-40 q0,-5,5,-5 h180 q5,0,5,5 v45 H0 Z", "topRoundedRect"],
    ["timeline", "M 0 45 V 5 Q 0 0 5 0 H 185 Q 190 0 190 5 V 50 H 0 Z", "topRoundedRect"],
    ["mindmap", "M-36 12 v-24 q0,-5 5,-5 h62 q5,0 5,5 v24 q0,5 -5,5 h-62 q-5,0 -5,-5 Z", "roundedRect"],
    ["mindmap", "M -36 12 V -12 Q -36 -17 -31 -17 H 31 Q 36 -17 36 -12 V 12 Q 36 17 31 17 H -31 Q -36 17 -36 12 Z", "roundedRect"],
  ]) {
    assert.deepEqual(knownNarrativeCard(data, diagram), { preset, cornerRadius: 5 });
    for (const changed of [data.replace(/Z$/, ""), data + " M0 0", data.replace(/[qQ]/, "C"),
      data.replace(/-?\d+/, "999"), "M0 0L10 10Z", ""]) {
      assert.equal(knownNarrativeCard(changed, diagram), null, changed);
    }
    assert.equal(knownNarrativeCard(data, "journey"), null);
  }
});

test("recognizes only bundled architecture service cards and four arrow profiles", () => {
  assert.deepEqual(knownArchitectureCard("M0,80 V5 Q0,0 5,0 H75 Q80,0 80,5 V80 Z"),
    { preset: "topRoundedRect", cornerRadius: 5 });
  assert.deepEqual(knownArchitectureCard("M0,40 V5 Q0,0 5,0 H35 Q40,0 40,5 V40 Z"),
    { preset: "topRoundedRect", cornerRadius: 5 });
  for (const data of ["", "M0,80 V5 Q0,1 5,0 H75 Q80,0 80,5 V80 Z",
    "M0,80 V5 Q0,0 5,0 H75 Q80,0 80,5 V80", "M0,80 V5 Q0,0 5,0 H75 Q80,0 80,5 V80 Z M0,0"]) {
    assert.equal(knownArchitectureCard(data), null);
  }
  for (const [points, rotation] of [
    ["10,5 0,10 0,0", 90], ["0,5 10,0 10,10", -90],
    ["0,0 10,0 5,10", 180], ["0,10 10,10 5,0", 0],
  ]) assert.deepEqual(knownArchitectureArrow(points), { size: 10, rotation });
  for (const points of ["", "10,5 0,10 0,1", "10,5 0,10 0,0 0,5", "0,0 0,0 0,0",
    "10,5 0,10 Infinity,0", "20,5 0,10 0,0"]) assert.equal(knownArchitectureArrow(points), null);
});

test("architecture arrows consume every numeric coordinate and reject extra vertices or malformed lists", () => {
  for (const points of ["10 5 0 10 0 0", "10,5,0,10,0,0", "1e1,5 .0,+10 0,0"]) {
    assert.deepEqual(knownArchitectureArrow(points), { size: 10, rotation: 90 });
  }
  for (const points of ["10,5,100,100 0,10 0,0", "10,5 0,10 0,0,20", "10,,5 0,10 0,0",
    "10,5 0,10 0,0,", "10,5 0,10 0,0 junk", "10,5 0,10 0,0 1e400,0"]) {
    assert.equal(knownArchitectureArrow(points), null, points);
  }
});

test("bounded system dashes retain physical intervals and package coordinates independently of stroke width", () => {
  const segments = boundedSystemDashSegments(30, [2.8, 2.8], (distance) => ({ x: distance, y: 10 }));
  assert.equal(segments.length, 6);
  assert.deepEqual(segments[0], { start: 0, end: 2.8, points: [{ x: 0, y: 10 }, { x: 2.8, y: 10 }] });
  assert.equal(segments.at(-1).end, 30);
  for (const strokeWidth of [.4, 1.4, 2]) {
    const scene = normalizeScene(createScene({ width: 100, height: 100, source: { kind: "mermaid", path: "systems.svg" },
      nodes: segments.map((segment, index) => ({ kind: "connector", sourcePath: `dash[${index}]`, z: index,
        points: segment.points, style: { stroke: "#444444", strokeWidth, dash: "solid", lineCap: "butt" } })) })).scene;
    const { elements } = sceneToPptxElements(scene);
    const xml = buildPptxPackage({ slides: [{ elements }] }).toString("utf8");
    assert.match(xml, /<a:ext cx="26670" cy="0"\/>/);
    assert.match(xml, /cap="flat"/);
    assert.doesNotMatch(xml, /<a:(?:custDash|prstDash)/);
    assert.equal((xml.match(/<p:sp>/g) || []).length, segments.length);
  }
});

test("bounded system dash sampling preserves rectangle turns and enforces density, geometry and point budgets", () => {
  const rectangle = (s) => s <= 100 ? { x: s, y: 0 } : s <= 150 ? { x: 100, y: s - 100 }
    : s <= 250 ? { x: 250 - s, y: 50 } : { x: 0, y: 300 - s };
  const segments = boundedSystemDashSegments(300, [14, 10], rectangle);
  assert.ok(segments && segments.some((segment) => segment.points.length > 2));
  assert.deepEqual(boundedSystemDashSegments(300, [50000, 50000], rectangle, [0, 100, 150, 250])[0].points,
    [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }, { x: 0, y: 0 }]);
  for (const segment of segments) {
    assert.deepEqual(segment.points[0], rectangle(segment.start));
    assert.deepEqual(segment.points.at(-1), rectangle(segment.end));
    assert.ok(segment.points.length <= MAX_CONNECTOR_POINTS);
    const length = segment.points.slice(1).reduce((sum, point, index) =>
      sum + Math.hypot(point.x - segment.points[index].x, point.y - segment.points[index].y), 0);
    assert.ok(Math.abs(length - (segment.end - segment.start)) < .1);
  }
  for (const pattern of [[.0001, .0001], [0, 1], [-1, 1], [1, Infinity], [1, 2, 3]]) {
    assert.equal(boundedSystemDashSegments(300, pattern, rectangle), null);
  }
  assert.equal(boundedSystemDashSegments(Infinity, [7, 7], rectangle), null);
  assert.equal(boundedSystemDashSegments(30, [7, 7], () => ({ x: NaN, y: 0 })), null);
  assert.equal(boundedSystemDashSegments(300, [300, 1], (s) => ({ x: s, y: Math.sin(s * 1000) * 10 })), null);
  assert.equal(boundedSystemDashSegments(300, [7, 7], rectangle, [0, 100, 150, 250, 300]), null);
  assert.equal(boundedSystemDashSegments(300, [7, 7], rectangle, [301]), null);
});

test("recognizes only the bundled Gantt milestone transform and square geometry", () => {
  const c = Math.SQRT1_2 * 0.8;
  const known = { width: 20, height: 20, rx: 3, ry: 3, origin: { x: 10, y: 10 },
    transform: { a: c, b: c, c: -c, d: c, e: 0, f: 0 } };
  assert.equal(isKnownGanttMilestone(known), true);
  assert.equal(isKnownGanttMilestone({ ...known, rx: 0, ry: 0 }), true);
  for (const change of [
    { width: 30 }, { rx: 2 }, { rx: 11, ry: 11 }, { width: 0, height: 0 },
    { origin: { x: 0, y: 0 } }, { transform: null },
    { transform: { ...known.transform, e: 5 } },
    { transform: { ...known.transform, a: c * 2 } },
    { transform: { a: 0.8, b: 0, c: 0, d: 0.8, e: 0, f: 0 } },
    { transform: { a: -c, b: c, c, d: c, e: 0, f: 0 } },
  ]) assert.equal(isKnownGanttMilestone({ ...known, ...change }), false, JSON.stringify(change));
  assert.equal(isKnownGanttMilestone(), false);
});

test("Gantt axis paths retain exact D3 corners without accepting general SVG paths", () => {
  const expected = [{ x: 0.5, y: -87 }, { x: 0.5, y: 0.5 },
    { x: 100.5, y: 0.5 }, { x: 100.5, y: -87 }];
  assert.deepEqual(ganttAxisPoints("M0.5,-87V0.5H100.5V-87"), expected);
  assert.deepEqual(ganttAxisPoints("M 0.5 -87 V 0.5 H 100.5 V -87"), expected);
  for (const data of ["M0,0L1,1", "M0,0V1H2V3", "M0,0V1H2V0Z",
    "m0,0v1h2v0", "M0,0V1H2V0M1,1", "M0,0V1H2VNaN", "M0,0V1H1e999V0",
    "M0,,0V1H2V0", "M0,0V1H-2V0"]) assert.equal(ganttAxisPoints(data), null, data);
});

test("chart paths retain explicit rendered vertices and reject unsupported or oversized geometry", () => {
  assert.deepEqual(chartPathPoints("M 1,2 L 3.5,-4L5e1,6.25"), [
    { x: 1, y: 2 }, { x: 3.5, y: -4 }, { x: 50, y: 6.25 },
  ]);
  for (const data of ["", "M0,0", "M0,0L1,1Z", "M0,0M1,1", "M0,0C1,1,2,2,3,3",
    "m0,0l1,1", "M0,0LNaN,1", "M0,0L1e999,1", "M0,0L1,1 trailing", "M0,0L1,1,2,2", "M0,,0L1,1"]) {
    assert.equal(chartPathPoints(data), null, data);
  }
  const points = Array.from({ length: MAX_CONNECTOR_POINTS }, (_, i) => `${i ? "L" : "M"}${i},${i % 2}`).join("");
  assert.equal(chartPathPoints(points).length, MAX_CONNECTOR_POINTS);
  assert.equal(chartPathPoints(`${points}L0,0`), null);
});

test("maps Mermaid marker IDs and URL references to scene arrows", () => {
  assert.equal(markerIdToArrow("url(#fixture_stateDiagram-barbEnd)"), "stealth");
  assert.equal(markerIdToArrow("fixture_stateDiagram-barbStart"), "none");
  assert.equal(markerIdToArrow("url(#mermaid-1_flowchart-v2-pointEnd)"), "triangle");
  assert.equal(markerIdToArrow("mermaid-1_flowchart-v2-pointStart-margin"), "triangle");
  assert.equal(markerIdToArrow("url(#mermaid-1_flowchart-v2-circleEnd)"), "oval");
  assert.equal(markerIdToArrow("url(#mermaid-1_flowchart-v2-crossEnd)"), "none");
  assert.equal(markerIdToArrow("url(#fixture_er-zeroOrMoreEnd)"), "none");
  assert.equal(markerIdToArrow(""), "none");
});

test("recognizes only bundled Mermaid ER cardinality marker geometry", () => {
  const cases = [
    ["onlyOneStart", [{ tag: "path", d: "M9,0 L9,18 M15,0 L15,18" }], "only-one", "start"],
    ["onlyOneEnd", [{ tag: "path", d: "M3,0 L3,18 M9,0 L9,18" }], "only-one", "end"],
    ["zeroOrOneStart", [
      { tag: "circle", cx: 21, cy: 9, r: 6 },
      { tag: "path", d: "M9,0 L9,18" },
    ], "zero-or-one", "start"],
    ["zeroOrOneEnd", [
      { tag: "circle", cx: 9, cy: 9, r: 6 },
      { tag: "path", d: "M21,0 L21,18" },
    ], "zero-or-one", "end"],
    ["oneOrMoreStart", [{
      tag: "path",
      d: "M0,18 Q 18,0 36,18 Q 18,36 0,18 M42,9 L42,27",
    }], "one-or-more", "start"],
    ["oneOrMoreEnd", [{
      tag: "path",
      d: "M3,9 L3,27 M9,18 Q27,0 45,18 Q27,36 9,18",
    }], "one-or-more", "end"],
    ["zeroOrMoreStart", [
      { tag: "circle", cx: 48, cy: 18, r: 6 },
      { tag: "path", d: "M0,18 Q18,0 36,18 Q18,36 0,18" },
    ], "zero-or-more", "start"],
    ["zeroOrMoreEnd", [
      { tag: "circle", cx: 9, cy: 18, r: 6 },
      { tag: "path", d: "M21,18 Q39,0 57,18 Q39,36 21,18" },
    ], "zero-or-more", "end"],
  ];
  for (const [name, primitives, cardinality, placement] of cases) {
    const geometry = knownErMarkerGeometry(`url(#fixture_er-${name})`, primitives);
    assert.equal(geometry.cardinality, cardinality);
    assert.equal(geometry.placement, placement);
    assert.equal(geometry.parts.length, 2);
    assert.equal(markerIdToArrow(`fixture_er-${name}`), "none");
    assert.equal(
      knownErMarkerGeometry(`fixture_er-${name}`, [
        ...primitives.slice(0, -1),
        { ...primitives.at(-1), d: `${primitives.at(-1).d || ""} 0` },
      ]),
      null,
    );
  }
  assert.equal(knownErMarkerGeometry("fixture_er-unknownEnd", []), null);
});

test("recognizes only bundled Mermaid requirement terminal geometry", () => {
  const contains = knownRequirementMarkerGeometry(
    "url(#fixture_requirement-requirement_containsStart)",
    [{
      tag: "g",
      children: [
        { tag: "circle", cx: 10, cy: 10, r: 9 },
        { tag: "line", x1: 1, y1: 10, x2: 19, y2: 10 },
        { tag: "line", x1: 10, y1: 1, x2: 10, y2: 19 },
      ],
    }],
  );
  assert.equal(contains.markerClass, "contains");
  assert.equal(contains.placement, "start");
  assert.deepEqual(
    contains.parts.map((part) => part.component),
    ["circle", "horizontal", "vertical"],
  );

  const arrow = knownRequirementMarkerGeometry(
    "url(#fixture_requirement-requirement_arrowEnd)",
    [{
      tag: "path",
      d: "M0,0 L20,10 M20,10 L0,20",
    }],
  );
  assert.equal(arrow.markerClass, "arrow");
  assert.equal(arrow.placement, "end");
  assert.deepEqual(
    arrow.parts.map((part) => part.points),
    [
      [{ x: 0, y: 0 }, { x: 20, y: 10 }],
      [{ x: 20, y: 10 }, { x: 0, y: 20 }],
    ],
  );

  assert.equal(
    knownRequirementMarkerGeometry(
      "fixture_requirement-requirement_containsStart",
      [{
        tag: "g",
        children: [
          { tag: "circle", cx: 10, cy: 10, r: 8 },
          { tag: "line", x1: 1, y1: 10, x2: 19, y2: 10 },
          { tag: "line", x1: 10, y1: 1, x2: 10, y2: 19 },
        ],
      }],
    ),
    null,
  );
  assert.equal(
    knownRequirementMarkerGeometry(
      "fixture_requirement-requirement_arrowEnd",
      [{ tag: "path", d: "M0,0 L20,10 L0,20" }],
    ),
    null,
  );
  assert.equal(
    knownRequirementMarkerGeometry("fixture_requirement-unknownEnd", []),
    null,
  );
});

test("decomposes only finite orientation-preserving uniform SVG rotations", () => {
  const matrix = (rotation, scale = 1, e = 0, f = 0) => {
    const radians = rotation * Math.PI / 180;
    return {
      a: Math.cos(radians) * scale,
      b: Math.sin(radians) * scale,
      c: -Math.sin(radians) * scale,
      d: Math.cos(radians) * scale,
      e,
      f,
    };
  };
  assert.deepEqual(decomposeSimpleSvgTransform(matrix(30, 1.25, 17, -9)), {
    rotation: 30,
    scale: 1.25,
  });
  assert.deepEqual(decomposeSimpleSvgTransform(matrix(270, 0.75)), {
    rotation: -90,
    scale: 0.75,
  });
  assert.deepEqual(decomposeSimpleSvgTransform(matrix(810, 2)), {
    rotation: 90,
    scale: 2,
  });
  for (const unsupported of [
    { a: 1, b: 0, c: 0.25, d: 1, e: 0, f: 0 },
    { a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    { a: 1.2, b: 0, c: 0, d: 0.8, e: 0, f: 0 },
    { a: Number.NaN, b: 0, c: 0, d: 1, e: 0, f: 0 },
  ]) {
    assert.equal(decomposeSimpleSvgTransform(unsupported), null);
  }
});

test("recognizes only the bundled hollow and cross geometry, never a filled arrow substitute", () => {
  for (const [name, tag, data, kind, sizes] of [
    ["extensionStart", "path", "M 1,7 L18,13 V 1 Z", "hollow-triangle", [4]],
    ["extensionEnd", "path", "M 1,1 V 13 L18,7 Z", "hollow-triangle", [4]],
    ["extensionStart-margin", "polygon", "10,7 18,13 18,1", "hollow-triangle", [4]],
    ["extensionEnd-margin", "polygon", "10,1 10,13 18,7", "hollow-triangle", [4]],
    ["aggregationStart", "path", "M 18,7 L9,13 L1,7 L9,1 Z", "hollow-diamond", [5]],
    ["aggregationEnd-margin", "path", "M 18,7 L9,13 L1,7 L9,1 Z", "hollow-diamond", [5]],
    ["crossStart", "path", "M 1,1 l 9,9 M 10,1 l -9,9", "cross", [2, 2]],
    ["crossEnd-margin", "path", "M 1,1 L 14,14 M 1,14 L 14,1", "cross", [2, 2]],
    ["crosshead", "path", "M 1,2 L 6,7 M 6,2 L 1,7", "cross", [2, 2]],
  ]) {
    const id = `url("https://example.test/#fixture-${name}")`;
    const geometry = knownMarkerGeometry(id, tag, data);
    assert.equal(geometry.kind, kind);
    assert.deepEqual(geometry.strokes.map((stroke) => stroke.length), sizes);
    assert.equal(markerIdToArrow(id), "none");
    assert.equal(knownMarkerGeometry(id, tag, `${data} 0`), null);
    assert.equal(knownMarkerGeometry(`${id}-unknown`, tag, data), null);
    if (kind !== "cross") assert.deepEqual(geometry.strokes[0][0], geometry.strokes[0].at(-1));
  }
});

test("takes marker endpoint tangents from original line and Bezier control points", () => {
  for (const [d, start, end] of [
    ["M1 2 L1 2 L1 20 H30 V10", [0, 18], [0, -10]],
    ["M1 2 C1 2 3 9 10 2", [2, 7], [7, -7]],
    ["M1 2 c0 0 2 7 9 0 s3 -7 9 0", [2, 7], [6, 7]],
    ["M1 2 Q1 9 10 2 T20 2", [0, 7], [1, 7]],
    ["M10 10 c30 0 30 20 0 20 l0 0", [30, 0], [-30, 0]],
    ["M1 2 5 6 3 4", [4, 4], [-2, -2]],
  ]) {
    const endpoints = markerEndpointTangents(d);
    assert.deepEqual(endpoints.start.direction, { x: start[0], y: start[1] }, d);
    assert.deepEqual(endpoints.end.direction, { x: end[0], y: end[1] }, d);
  }
  for (const d of ["", "M0 0", "L1 2", "M0 0 M1 2", "M0 0L0 0", "M0 0L2", "M0 0Qx 1 2 3", "M0 0 A2 2 0 0 0 2 2", "M0 0L2 2Z"]) {
    assert.equal(markerEndpointTangents(d), null, d);
  }
});

test("simplifies collinear runs while preserving genuine corners", () => {
  assert.deepEqual(
    simplifyPolyline([
      { x: 0, y: 0 },
      { x: 10, y: 0.2 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ], 1),
    [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
    ],
  );
  assert.deepEqual(
    simplifyPolyline([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 10 },
    ], 1),
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 10 },
    ],
  );
});

test("maps CSS paint, opacity, stroke dash, and font strings into scene fields", () => {
  assert.deepEqual(
    cssStyleToSceneStyle({
      fill: "rgba(24, 32, 52, 0.8)",
      stroke: "rgb(43, 53, 80)",
      strokeWidth: "1px",
      strokeDasharray: "9px 5px",
      opacity: "0.7",
      fillOpacity: "0.4",
      strokeOpacity: "0.25",
    }),
    {
      fill: "rgba(24, 32, 52, 0.8)",
      stroke: "rgb(43, 53, 80)",
      strokeWidth: 1,
      dash: "dash",
      opacity: 0.7,
      fillOpacity: 0.4,
      strokeOpacity: 0.25,
    },
  );
  assert.deepEqual(cssStyleToSceneStyle({
    opacity: "2",
    fillOpacity: "-1",
    strokeOpacity: "1",
  }), {
    opacity: 1,
    fillOpacity: 0,
  });
  assert.deepEqual(cssStyleToSceneStyle({ strokeDasharray: "2px" }), { dash: "dot" });
  assert.deepEqual(cssStyleToSceneStyle({ strokeDasharray: "0 0" }), { dash: "solid" });
  assert.deepEqual(cssStyleToSceneStyle({ strokeDasharray: "0px, 0px" }), { dash: "solid" });

  const text = textToSceneText("yes\nno", {
    fontFamily: "\"trebuchet ms\", verdana, arial, sans-serif",
    fontSize: "16px",
    fontWeight: "700",
    fontStyle: "italic",
    color: "rgb(232, 236, 247)",
    textAlign: "center",
  });
  assert.deepEqual(text.paragraphs.map((paragraph) => paragraph.runs[0].text), ["yes", "no"]);
  assert.equal(text.paragraphs[0].runs[0].fontSize, 16);
  assert.equal(text.paragraphs[0].runs[0].bold, true);
  assert.equal(text.paragraphs[0].runs[0].italic, true);
  assert.equal(text.paragraphs[0].runs[0].color, "rgb(232, 236, 247)");
});

test("limit overflow degrades the whole diagram to one fallback scene", () => {
  const scene = createScene({
    width: 640,
    height: 360,
    source: { kind: "mermaid", path: "overflow.svg" },
    nodes: Array.from({ length: MAX_SCENE_NODES + 1 }, (_, index) => ({
      kind: "shape",
      sourcePath: `nodes[${index}]`,
      z: index,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      preset: "rect",
    })),
  });
  const result = enforceSceneLimits(scene, { bounds: { x: 0, y: 0, width: 640, height: 360 } });

  assert.equal(result.scene.nodes.length, 1);
  assert.equal(result.scene.nodes[0].kind, "fallback");
  assert.match(result.scene.nodes[0].reason, /limit-exceeded/);
  validateScene(result.scene);
});

test("collapses a CSS font stack to the single typeface PowerPoint can resolve", () => {
  assert.equal(
    primaryFontFamily('"Segoe UI Variable Text", "Segoe UI", "Yu Gothic UI", system-ui, sans-serif'),
    "Segoe UI Variable Text",
  );
  assert.equal(primaryFontFamily("  'Yu Gothic' , sans-serif "), "Yu Gothic");
  assert.equal(primaryFontFamily(""), undefined);
  assert.equal(primaryFontFamily(undefined), undefined);

  const text = textToSceneText("Japanese", { fontFamily: '"Segoe UI", "Yu Gothic UI", sans-serif' });
  assert.equal(text.paragraphs[0].runs[0].fontFace, "Segoe UI");
});

test("recognizes safe additional polygons without replacing unknown geometry with rectangles", () => {
  assert.equal(classifyPolygonPreset("10,0 90,0 100,-20 90,-40 10,-40 0,-20"), "hexagon");
  assert.equal(classifyPolygonPreset("50,0 100,100 0,100"), "triangle");
  assert.equal(classifyPolygonPreset("0,0 100,0 50,100", { fallbackPreset: null }), null);
  assert.equal(classifyPolygonPreset("0,0 100,0 90,100 0,100", { fallbackPreset: null }), null);
  assert.equal(classifyPolygonPreset("0,0 100,0 79,-40 -20,-40", { fallbackPreset: null }), null);
  assert.equal(classifyPolygonPreset("0,0 10,0 20,0 30,0 40,0 50,0", { fallbackPreset: null }), null);
});

test("recognizes only the bundled sequence frame tab profile", () => {
  assert.equal(isKnownSequenceTab("269,297 319,297 319,310 310.6,317 269,317"), true);
  assert.equal(isKnownSequenceTab("0,0 100,0 100,26 83.2,40 0,40"), true);
  assert.equal(isKnownSequenceTab("0,0 100,0 100,25 80,40 0,40"), false);
  assert.equal(isKnownSequenceTab("0,0 100,0 100,40 0,40"), false);
  assert.equal(isKnownSequenceTab("0,40 83.2,40 100,26 100,0 0,0"), false);
});

test("recognizes sequence arrows while leaving unsupported markers conservative", () => {
  assert.equal(markerIdToArrow("url(#fixture-sequence-arrowhead)"), "triangle");
  assert.equal(markerIdToArrow("url(#fixture-sequence-openarrowhead)"), "arrow");
  assert.equal(markerIdToArrow("url(#fixture-sequence-filled-head)"), "stealth");
  assert.equal(markerIdToArrow('url("https://example.test/deck#fixture-sequence-filled-head")'), "stealth");
  assert.equal(markerIdToArrow("url(#fixture-sequence-filled-head-control)"), "none");
  assert.equal(markerIdToArrow("url(#fixture-sequence-crosshead)"), "none");
  assert.equal(markerIdToArrow("url(#class-extensionStart)"), "none");
  assert.equal(markerIdToArrow('url("https://example.test/deck#fixture-sequence-arrowhead")'), "triangle");
  assert.equal(markerIdToArrow("none"), "none");
});

test("simplifies a self-message without collapsing its return or reversing the endpoints", () => {
  const points = [
    { x: 76, y: 117 }, { x: 96, y: 117 }, { x: 116, y: 117 },
    { x: 116, y: 127 }, { x: 116, y: 137 }, { x: 96, y: 137 }, { x: 76, y: 137 },
  ];
  assert.deepEqual(simplifyPolyline(points), [points[0], points[2], points[4], points[6]]);
  assert.deepEqual(simplifyPolyline(points.flatMap((point) => [point, point])), simplifyPolyline(points));
  assert.deepEqual(simplifyPolyline([]), []);
  assert.deepEqual(simplifyPolyline([points[0], points[0]]), [points[0]]);
  const scaledCurve = Array.from({ length: 26 }, (_, index) => {
    const t = index / 25;
    return {
      x: 60 * t * (1 - t),
      y: (-30 * t * (1 - t) ** 2 + 90 * t ** 2 * (1 - t) + 20 * t ** 3) / 3,
    };
  });
  const simplified = simplifyPolyline(scaledCurve);
  assert.ok(simplified.length > 2);
  assert.deepEqual(simplified[0], scaledCurve[0]);
  assert.deepEqual(simplified.at(-1), scaledCurve.at(-1));
  assert.ok(Math.max(...simplified.map((point) => point.x)) > 14);
  for (const point of scaledCurve) {
    const error = Math.min(...simplified.slice(1).map((end, index) => {
      const start = simplified[index];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
    }));
    assert.ok(error <= 2, `simplification error ${error} exceeds the deck-pixel tolerance`);
  }
});

test("retains genuine path detail so connector point limits still apply", () => {
  const points = Array.from({ length: MAX_CONNECTOR_POINTS + 1 }, (_, index) => ({
    x: index * 5, y: index % 2 * 10,
  }));
  const simplified = simplifyPolyline(points, 0);
  assert.deepEqual(simplified, points);
  const scene = createScene({
    width: 400, height: 100, source: { kind: "mermaid", path: "detailed-path.svg" },
    nodes: [{ kind: "connector", sourcePath: "sequence[0]", z: 0, points: simplified }],
  });
  const limited = enforceSceneLimits(scene);
  assert.equal(limited.scene.nodes.length, 1);
  assert.match(limited.scene.nodes[0].reason, /connector points exceed 64/);
  validateScene(limited.scene);
});

test("maps filled class relationship markers without confusing them with hollow UML markers", () => {
  for (const end of ["Start", "End"]) {
    for (const suffix of ["", "-margin"]) {
      for (const [kind, arrow] of [
        ["composition", "diamond"], ["dependency", "stealth"],
        ["aggregation", "none"], ["extension", "none"], ["lollipop", "none"],
      ]) {
        const id = `fixture-class_class-${kind}${end}${suffix}`;
        assert.equal(markerIdToArrow(id), arrow);
        assert.equal(markerIdToArrow(`url(#${id})`), arrow);
        assert.equal(markerIdToArrow(`url("https://example.test/deck#${id}")`), arrow);
      }
    }
  }
  assert.equal(markerIdToArrow("url(#fixture-class_class-unknownEnd)"), "none");
});

test("preserves zero-width strokes and does not silently truncate text over limits", () => {
  assert.equal(cssStyleToSceneStyle({ strokeWidth: 0 }).strokeWidth, 0);
  const text = textToSceneText(Array.from({ length: 201 }, () => "line").join("\n"));
  assert.equal(text.paragraphs.length, 201);
  const scene = createScene({
    width: 100, height: 100, source: { kind: "mermaid", path: "text.svg" },
    nodes: [{ kind: "text", sourcePath: "label", z: 0, bounds: { x: 0, y: 0, width: 100, height: 100 }, text }],
  });
  assert.match(enforceSceneLimits(scene).scene.nodes[0].reason, /text paragraphs exceed/);
});
