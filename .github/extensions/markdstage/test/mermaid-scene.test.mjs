import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyPolygonPreset,
  cssStyleToSceneStyle,
  enforceSceneLimits,
  markerIdToArrow,
  polygonPointsSignature,
  simplifyPolyline,
  textToSceneText,
  primaryFontFamily,
} from "../renderer/mermaid-scene.mjs";
import {
  MAX_CONNECTOR_POINTS,
  MAX_SCENE_NODES,
  createScene,
  validateScene,
} from "../renderer/scene-graph.mjs";

test("classifies measured Mermaid polygon signatures", () => {
  assert.equal(
    classifyPolygonPreset("58.25,0 116.5,-58.25 58.25,-116.5 0,-58.25"),
    "diamond",
  );
  assert.equal(
    classifyPolygonPreset("-19.5,0 60.75,0 80.25,-39 0,-39"),
    "parallelogram",
  );
  assert.equal(classifyPolygonPreset("0,0 100,0 50,100"), "rect");
  assert.equal(
    polygonPointsSignature("58.2501,0 116.499,-58.25"),
    "58.25,0 116.5,-58.25",
  );
});

test("maps Mermaid marker IDs and URL references to scene arrows", () => {
  assert.equal(markerIdToArrow("url(#mermaid-1_flowchart-v2-pointEnd)"), "triangle");
  assert.equal(markerIdToArrow("mermaid-1_flowchart-v2-pointStart-margin"), "triangle");
  assert.equal(markerIdToArrow("url(#mermaid-1_flowchart-v2-circleEnd)"), "oval");
  assert.equal(markerIdToArrow("url(#mermaid-1_flowchart-v2-crossEnd)"), "none");
  assert.equal(markerIdToArrow(""), "none");
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
    }),
    {
      fill: "rgba(24, 32, 52, 0.8)",
      stroke: "rgb(43, 53, 80)",
      strokeWidth: 1,
      dash: "dash",
      opacity: 0.7,
    },
  );
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
  assert.equal(classifyPolygonPreset("0,0 10,0 20,0 30,0 40,0 50,0", { fallbackPreset: null }), null);
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
