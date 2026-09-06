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
      document.querySelector("#fixture-deck > svg"),
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
      "shape",
      "shape",
    ]);
    expect(result.scene.nodes.map((node) => node.z)).toEqual(Array.from({ length: 13 }, (_, index) => index));
    expect(result.scene.nodes.filter((node) => node.kind === "group")).toHaveLength(1);
    expect(result.scene.nodes.filter((node) => node.kind === "connector")).toHaveLength(5);
    expect(result.scene.nodes.filter((node) => node.kind === "shape")).toHaveLength(7);
    expect(result.scene.nodes.filter((node) => node.kind === "fallback")).toHaveLength(0);
    const labels = result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "edge-label");
    expect(labels).toHaveLength(2);
    expect(labels.every((node) => node.style.fill && node.z > 5)).toBe(true);
    expect(labels.map((node) => node.text.paragraphs[0].runs[0].text)).toEqual(["yes", "no"]);
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
        .filter((node) => node.kind === "shape" && node.meta?.mermaid?.kind === "node")
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

test("preserves classDef styling, stadium, cylinder, hexagon and double-circle shapes", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Shapes"] });
  try {
    await page.goto(harness.url);
    const { scene } = await sceneFromFixture(page, await readFixture("shapes-styled.svg"), "shapes-styled.svg");
    validateScene(scene);
    expect(scene.nodes.filter((node) => node.kind === "fallback")).toEqual([]);
    const stadium = scene.nodes.find((node) => node.meta?.mermaid?.shape === "stadium");
    expect(stadium).toMatchObject({ kind: "group", style: { fill: null, stroke: null } });
    const stadiumParts = scene.nodes.filter((node) => node.sourcePath.startsWith(`${stadium.sourcePath}.`));
    expect(stadiumParts.map((node) => node.kind)).toEqual(["shape", "shape", "shape", "connector", "connector", "text"]);
    expect(stadiumParts[0]).toMatchObject({
      preset: "ellipse", style: { fill: "rgb(18, 52, 86)", stroke: "rgb(171, 205, 239)", strokeWidth: 3 },
    });
    expect(stadiumParts[5].text.paragraphs[0].runs[0]).toMatchObject({
      text: "Start", fontSize: 20, color: "rgb(255, 204, 0)", bold: true,
    });
    const cylinder = scene.nodes.find((node) => node.meta?.mermaid?.shape === "cylinder");
    expect(cylinder.kind).toBe("group");
    const cylinderParts = scene.nodes.filter((node) => node.sourcePath.startsWith(`${cylinder.sourcePath}.`));
    expect(cylinderParts.map((node) => node.kind)).toEqual(["shape", "shape", "connector", "connector", "shape", "text"]);
    expect(cylinderParts[0].style.fill).toBe("rgb(18, 52, 86)");
    expect(scene.nodes.some((node) => node.preset === "hexagon")).toBe(true);
    const circles = scene.nodes.filter((node) => node.sourcePath.includes(".circles["));
    expect(circles).toHaveLength(2);
    expect(circles[1].text.paragraphs[0].runs[0].text).toBe("Done");
    const { elements, fallbacks } = sceneToPptxElements(scene);
    expect(fallbacks).toEqual([]);
    expect(inspectPptxPackage(buildPptxPackage({ slides: [{ elements }] })).valid).toBe(true);
  } finally {
    await harness.close();
  }
});

test("extracts editable sequence participants, lifelines, messages, activation and notes", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Sequence"] });
  try {
    await page.goto(harness.url);
    const { scene } = await sceneFromFixture(page, await readFixture("sequence.svg"), "sequence.svg");
    validateScene(scene);
    expect(scene.nodes.filter((node) => node.kind === "fallback")).toEqual([]);
    expect(scene.nodes.filter((node) => node.kind === "shape")).toHaveLength(6);
    expect(scene.nodes.filter((node) => node.kind === "connector")).toHaveLength(4);
    const messages = scene.nodes.filter((node) => node.kind === "connector" && node.arrowEnd === "triangle");
    expect(messages).toHaveLength(2);
    expect(messages.map((node) => node.style.dash)).toEqual(["solid", "dash"]);
    expect(scene.nodes.filter((node) => node.kind === "text").map((node) => node.text.paragraphs[0].runs[0].text))
      .toEqual(["Service", "Client", "Service", "Client", "Validate", "Request", "Response"]);
    const { elements, fallbacks } = sceneToPptxElements(scene);
    expect(fallbacks).toEqual([]);
    expect(inspectPptxPackage(buildPptxPackage({ slides: [{ elements }] })).valid).toBe(true);
  } finally {
    await harness.close();
  }
});

test("extracts class compartments and preserves unsupported inheritance arrows as fallback", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Classes"] });
  try {
    await page.goto(harness.url);
    const { scene } = await sceneFromFixture(page, await readFixture("class.svg"), "class.svg");
    validateScene(scene);
    expect(scene.nodes.filter((node) => node.kind === "shape")).toHaveLength(2);
    expect(scene.nodes.filter((node) => node.kind === "connector")).toHaveLength(4);
    expect(scene.nodes.filter((node) => node.kind === "text").map((node) => node.text.paragraphs[0].runs[0].text))
      .toEqual(["Animal", "+String name", "+speak() : void", "Dog"]);
    expect(scene.nodes.filter((node) => node.kind === "fallback")).toHaveLength(1);
    expect(scene.nodes[0].reason).toBe("unsupported-mermaid-edge-style");
    expect(scene.nodes[0].bounds.width).toBeGreaterThan(0);
    const association = (await readFixture("class.svg")).replace(/ marker-start="[^"]*"/g, "");
    const native = await sceneFromFixture(page, association, "class-association.svg");
    expect(native.scene.nodes.filter((node) => node.kind === "fallback")).toEqual([]);
    expect(native.scene.nodes.filter((node) => node.kind === "connector")).toHaveLength(5);
    const { elements } = sceneToPptxElements(native.scene);
    expect(inspectPptxPackage(buildPptxPackage({ slides: [{ elements }] })).valid).toBe(true);
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

test("reads computed class overrides and SVG text fill rather than CSS color", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Computed styles"] });
  try {
    await page.goto(harness.url);
    const source = (await readFixture("flowchart.svg")).replace("</svg>", `<style>
      .node.default rect.label-container {fill:rgb(12, 34, 56)!important;stroke-width:4px!important}
      .node.default span.nodeLabel p {color:rgb(65, 43, 21)!important;font-weight:700!important;font-style:italic!important}
    </style></svg>`);
    const { scene } = await sceneFromFixture(page, source, "computed.svg");
    const node = scene.nodes.find((entry) => entry.preset === "rect" && entry.meta?.mermaid?.kind === "node");
    expect(node.style).toMatchObject({ fill: "rgb(12, 34, 56)", strokeWidth: 4 });
    expect(node.text.paragraphs[0].runs[0]).toMatchObject({ color: "rgb(65, 43, 21)", bold: true, italic: true });
    const richSource = (await readFixture("flowchart.svg")).replace("<p>Browser</p>", "<p>Web <b>client</b><br/>Ready</p>");
    const rich = await sceneFromFixture(page, richSource, "rich.svg");
    const richText = rich.scene.nodes.find((entry) => entry.sourcePath === "nodes[0]").text;
    expect(richText.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join("")))
      .toEqual(["Web client", "Ready"]);
    expect(richText.paragraphs[0].runs[1].bold).toBe(true);
    const sequenceSource = (await readFixture("sequence.svg")).replace("</svg>",
      "<style>text.messageText{fill:rgb(11, 22, 33)!important;color:rgb(255, 0, 0)!important}</style></svg>");
    const sequence = await sceneFromFixture(page, sequenceSource, "computed-sequence.svg");
    const request = sequence.scene.nodes.find((entry) => entry.text?.paragraphs[0].runs[0].text === "Request");
    expect(request.text.paragraphs[0].runs[0].color).toBe("rgb(11, 22, 33)");
  } finally {
    await harness.close();
  }
});

test("falls back conservatively for unsupported node geometry, styling and diagram types", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Conservative fallback"] });
  try {
    await page.goto(harness.url);
    const flowchart = await readFixture("flowchart.svg");
    const polygon = flowchart.replace('points="58.25,0 116.5,-58.25 58.25,-116.5 0,-58.25"', 'points="0,0 100,0 90,-100 0,-100"');
    expect((await sceneFromFixture(page, polygon, "polygon.svg")).scene.nodes
      .filter((node) => node.reason === "unsupported-mermaid-node-shape")).toHaveLength(1);
    const filter = flowchart.replace('class="node default"', 'class="node default" style="filter:blur(2px)"');
    expect((await sceneFromFixture(page, filter, "filter.svg")).scene.nodes
      .filter((node) => node.reason === "unsupported-mermaid-node-content")).toHaveLength(1);
    const unknown = flowchart.replace('class="flowchart"', 'class="pie"');
    expect((await sceneFromFixture(page, unknown, "pie.svg")).scene.nodes).toMatchObject([
      { kind: "fallback", reason: "unsupported-mermaid-svg-structure" },
    ]);
    const rotated = flowchart.replace('class="node default"', 'class="node default" style="rotate:15deg"');
    expect((await sceneFromFixture(page, rotated, "rotated.svg")).scene.nodes).toMatchObject([
      { kind: "fallback", reason: "unsupported-mermaid-svg-transform" },
    ]);
    const sequence = (await readFixture("sequence.svg")).replace("</svg>", '<path d="M0 0 L50 50 L0 50 Z" fill="red"/></svg>');
    const { scene } = await sceneFromFixture(page, sequence, "unsupported-sequence.svg");
    expect(scene.nodes.filter((node) => node.kind === "fallback")).toMatchObject([
      { reason: "unsupported-mermaid-sequence-element" },
    ]);
    expect(scene.nodes.some((node) => node.kind === "connector")).toBe(true);
  } finally {
    await harness.close();
  }
});

test("samples edges with their own SVG transforms and keeps label knockouts above every edge", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Edge geometry"] });
  try {
    await page.goto(harness.url);
    const original = await readFixture("flowchart.svg");
    const before = await sceneFromFixture(page, original, "original.svg");
    const transformed = original.replace('<g class="edgePaths">', '<g class="edgePaths" transform="translate(10, 5)">');
    const after = await sceneFromFixture(page, transformed, "transformed.svg");
    const edgesBefore = before.scene.nodes.filter((node) => node.kind === "connector");
    const edgesAfter = after.scene.nodes.filter((node) => node.kind === "connector");
    expect(edgesAfter[0].points[0].x).toBeCloseTo(edgesBefore[0].points[0].x + 10);
    expect(edgesAfter[0].points[0].y).toBeCloseTo(edgesBefore[0].points[0].y + 5);
    const labels = after.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "edge-label");
    expect(labels.every((node) => node.z > Math.max(...edgesAfter.map((edge) => edge.z)))).toBe(true);
    const { elements } = sceneToPptxElements(after.scene);
    const lastEdge = elements.findLastIndex((element) => element.type === "connector");
    const labelIndex = elements.findIndex((element) => element.path?.includes("edgeLabels"));
    expect(labelIndex).toBeGreaterThan(lastEdge);
  } finally {
    await harness.close();
  }
});

test("optionally maps scene paths back to exact source elements without putting DOM into scenes", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Scene source mapping"] });
  try {
    await page.goto(harness.url);
    for (const name of ["sequence", "class", "shapes-styled"]) {
      await sceneFromFixture(page, await readFixture(`${name}.svg`), `${name}.svg`);
      const result = await page.evaluate(async () => {
        const { mermaidSvgToScene } = await import("./renderer/mermaid-scene.mjs");
        const svg = document.querySelector("#fixture-deck > svg");
        const options = { deck: document.querySelector("#fixture-deck"), path: "mapping.svg" };
        const plain = mermaidSvgToScene(svg, options);
        const mapped = mermaidSvgToScene(svg, { ...options, includeSourceElements: true });
        return {
          defaultHasMap: Object.hasOwn(plain, "sourceElements"),
          unchangedScene: JSON.stringify(plain.scene) === JSON.stringify(mapped.scene),
          sourceIsSvg: mapped.sourceElements.get("svg") === svg,
          unmapped: mapped.scene.nodes.filter((node) => !mapped.sourceElements.has(node.sourcePath) &&
            !mapped.scene.nodes.some((owner) => node.sourcePath.startsWith(`${owner.sourcePath}.`) &&
              mapped.sourceElements.has(owner.sourcePath))).map((node) => node.sourcePath),
          labels: [...mapped.sourceElements].filter(([path]) => path.startsWith("edgeLabels["))
            .map(([, element]) => element.classList.contains("edgeLabel")),
        };
      });
      expect(result).toMatchObject({ defaultHasMap: false, unchangedScene: true, sourceIsSvg: true, unmapped: [] });
      expect(result.labels.every(Boolean)).toBe(true);
    }
  } finally {
    await harness.close();
  }
});

test("real renderer exports new Mermaid diagrams with exact native masks and partial fallback captures", async ({ page }) => {
  const diagrams = [
    "sequenceDiagram\nparticipant A as Client\nparticipant B as Service\nA->>B: Request\nB-->>A: Response",
    "classDiagram\nclass Animal {\n+String name\n+speak() void\n}\nclass Dog\nAnimal <|-- Dog",
    "flowchart LR\nA([Start]) -->|approved| B[(Database)]",
  ];
  const harness = await startHarness({
    slides: diagrams.map((diagram, index) => `# Diagram ${index}\n\n\`\`\`mermaid\n${diagram}\n\`\`\``),
  });
  try {
    await page.goto(`${harness.url}/?pptx=1&token=${encodeURIComponent(harness.printToken)}`);
    await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready") ||
      document.documentElement.hasAttribute("data-pptx-error"), undefined, { timeout: 120_000 });
    await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
    await expect(page.locator("pre.mermaid > svg[data-scene-backend=svg]")).toHaveCount(3);
    const model = await page.evaluate(() => window.__presentationPptxModel);
    const sequence = model.slides[0];
    expect(sequence.fallbacks.filter((fallback) => fallback.type === "mermaid")).toEqual([]);
    expect(sequence.elements.filter((element) => element.type === "connector" &&
      element.path?.startsWith("mermaid[0].sequence["))).toHaveLength(4);
    const sequenceSvg = page.locator("pre.mermaid > svg").nth(0);
    await expect(sequenceSvg.locator("line.actor-line[data-pptx-native=connector]")).toHaveCount(2);
    await expect(sequenceSvg.locator("line[data-et=message][data-pptx-native=connector]")).toHaveCount(2);

    const classes = model.slides[1];
    expect(classes.fallbacks.filter((fallback) => fallback.reason === "unsupported-mermaid-edge-style")).toHaveLength(1);
    const classSvg = page.locator("pre.mermaid > svg").nth(1);
    await expect(classSvg.locator("path.relation[data-pptx-fallback-ids]")).toHaveCount(1);
    await expect(classSvg.locator("g.node > g.label-container[data-pptx-native=shape]")).toHaveCount(2);
    await expect(classSvg.locator("span.nodeLabel[data-pptx-native=text]")).toHaveCount(4);
    expect(await classSvg.getAttribute("data-pptx-fallback-ids")).toBeNull();

    const shapes = model.slides[2];
    expect(shapes.fallbacks.filter((fallback) => fallback.type === "mermaid")).toEqual([]);
    const shapesSvg = page.locator("pre.mermaid > svg").nth(2);
    await expect(shapesSvg.locator("g.node[data-pptx-native]")).toHaveCount(2);
    await expect(shapesSvg.locator("g.edgeLabel[data-pptx-native]")).toHaveCount(1);
    expect(shapes.elements.some((element) => element.path?.includes("edgeLabels[") && element.type === "shape")).toBe(true);
  } finally {
    await harness.close();
  }
});
