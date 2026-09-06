import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { validateScene } from "../../.github/extensions/markdstage/renderer/scene-graph.mjs";
import { sceneToPptxElements } from "../../.github/extensions/markdstage/renderer/scene-pptx.mjs";
import {
  buildPptxPackage,
  inspectPptxPackage,
} from "../../.github/extensions/markdstage/runtime/pptx-package.mjs";
import { startHarness } from "../harness/server.mjs";

const FIXTURE_DIR = join(process.cwd(), "test", "fixtures", "mermaid");

async function readFixture(name) {
  return readFile(join(FIXTURE_DIR, name), "utf8");
}

async function sceneFromFixture(page, svg, path) {
  await page.evaluate(async ({ source, sourcePath }) => {
    document.body.innerHTML = [
      "<style>body{margin:0}#fixture-deck{position:relative;width:651.40625px;height:237.125px}</style>",
      `<div id="fixture-deck">${source}</div>`,
    ].join("");
    const module = await import("./renderer/mermaid-scene.mjs");
    window.__mermaidSceneResult = module.mermaidSvgToScene(
      document.querySelector("svg.flowchart"),
      {
        path: sourcePath,
        deck: document.querySelector("#fixture-deck"),
      },
    );
  }, { source: svg, sourcePath: path });
  return page.evaluate(() => window.__mermaidSceneResult);
}

test("converts fixed Mermaid SVG fixtures into validated scene and PPTX elements", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Mermaid scene fixture"] });
  try {
    await page.goto(harness.url, { waitUntil: "load" });
    const result = await sceneFromFixture(page, await readFixture("flowchart.svg"), "fixtures/mermaid/flowchart.svg");

    validateScene(result.scene);
    expect(result.scene.source).toEqual({ kind: "mermaid", path: "fixtures/mermaid/flowchart.svg" });
    expect(result.scene.nodes.map((node) => node.kind)).toEqual([
      "group",
      "connector",
      "connector",
      "connector",
      "connector",
      "connector",
      "shape",
      "shape",
      "shape",
      "shape",
      "shape",
    ]);
    expect(result.scene.nodes.map((node) => node.z)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.scene.nodes.filter((node) => node.kind === "group")).toHaveLength(1);
    expect(result.scene.nodes.filter((node) => node.kind === "connector")).toHaveLength(5);
    expect(result.scene.nodes.filter((node) => node.kind === "shape")).toHaveLength(5);
    expect(result.scene.nodes.filter((node) => node.kind === "fallback")).toHaveLength(0);
    expect(result.scene.nodes.filter((node) => node.kind === "connector" && node.label)).toHaveLength(2);
    expect(
      result.scene.nodes
        .filter((node) => node.kind === "connector")
        .map((node) => node.points.length),
    ).toEqual([2, 2, 2, 2, 2]);
    expect(
      result.scene.nodes
        .filter((node) => node.kind === "connector")
        .map((node) => node.meta.mermaid.rawPointCount),
    ).toEqual([13, 36, 34, 20, 17]);
    expect(
      result.scene.nodes
        .filter((node) => node.kind === "shape")
        .map((node) => node.preset),
    ).toEqual(["rect", "diamond", "ellipse", "parallelogram", "rect"]);

    const { elements, fallbacks } = sceneToPptxElements(result.scene, {
      pathPrefix: "mermaid[0]",
      groupPreset: "rect",
    });
    expect(fallbacks).toEqual([]);
    expect(elements[0]).toMatchObject({
      type: "shape",
      shape: "rect",
      path: "mermaid[0].clusters[0]",
    });
    const buffer = buildPptxPackage({
      title: "Mermaid scene",
      slides: [{ elements }],
    });
    expect(inspectPptxPackage(buffer).valid).toBe(true);
  } finally {
    await harness.close();
  }
});

test("turns unknown Mermaid SVG visuals into explicit fallback nodes", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Mermaid fallback fixture"] });
  try {
    await page.goto(harness.url, { waitUntil: "load" });
    const result = await sceneFromFixture(
      page,
      await readFixture("unknown-element.svg"),
      "fixtures/mermaid/unknown-element.svg",
    );

    validateScene(result.scene);
    const fallback = result.scene.nodes.find((node) => node.kind === "fallback");
    expect(fallback).toMatchObject({
      reason: "unsupported-mermaid-svg-element",
      capability: {
        pptx: "fallback",
        reason: "unsupported-mermaid-svg-element",
      },
    });
    expect(fallback.bounds.width).toBeGreaterThan(0);
    expect(fallback.bounds.height).toBeGreaterThan(0);
  } finally {
    await harness.close();
  }
});
