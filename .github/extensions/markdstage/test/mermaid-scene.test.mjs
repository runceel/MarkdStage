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
