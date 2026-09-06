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

async function updateFixture(page, update) {
  await page.evaluate(update);
  return page.evaluate(async () => {
    const { mermaidSvgToScene } = await import("./renderer/mermaid-scene.mjs");
    const result = mermaidSvgToScene(document.querySelector("#fixture-deck > svg"), {
      deck: document.querySelector("#fixture-deck"),
      path: window.__mermaidSceneResult.scene.source.path,
      includeSourceElements: true,
    });
    return {
      scene: result.scene,
      diagnostics: result.diagnostics,
      sources: [...result.sourceElements].map(([path, element]) => ({ path, tag: element.localName, id: element.id })),
    };
  });
}

async function sampledConnectorErrors(page) {
  return page.evaluate(async () => {
    const { mermaidSvgToScene } = await import("./renderer/mermaid-scene.mjs");
    const deck = document.querySelector("#fixture-deck");
    const { scene, sourceElements } = mermaidSvgToScene(deck.querySelector("svg"), { deck, includeSourceElements: true });
    const rect = deck.getBoundingClientRect();
    return scene.nodes.flatMap((node) => {
      const source = sourceElements.get(node.sourcePath);
      if (node.kind !== "connector" || source.localName !== "path") return [];
      const count = Math.max(2, Math.round(source.getTotalLength() / 4) + 1);
      const raw = Array.from({ length: count }, (_, i) => {
        const point = source.getPointAtLength(source.getTotalLength() * i / (count - 1));
        const screen = new DOMPoint(point.x, point.y).matrixTransform(source.getScreenCTM());
        return { x: Math.round((screen.x - rect.left) * 10) / 10, y: Math.round((screen.y - rect.top) * 10) / 10 };
      });
      const errors = raw.map((point) => Math.min(...node.points.slice(1).map((end, i) => {
        const start = node.points[i];
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
      })));
      return [{ path: node.sourcePath, maxError: Math.max(...errors) }];
    });
  });
}

test("preserves fallback paint order and keeps container effects from duplicating native descendants", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Paint order"] });
  try {
    await page.goto(harness.url);
    const source = await readFixture("flowchart.svg");
    await sceneFromFixture(page, source, "paint-order.svg");
    const ordered = await updateFixture(page, () => {
      const svg = document.querySelector("#fixture-deck > svg");
      svg.insertAdjacentHTML("afterbegin", '<circle id="behind" r="30" cx="40" cy="40"/>');
      svg.insertAdjacentHTML("beforeend", '<circle id="above" r="10" cx="40" cy="40"/>');
      svg.querySelector("g.edgePaths").style.filter = "blur(1px)";
    });
    expect(ordered.scene.nodes[0]).toMatchObject({ kind: "fallback", id: "behind" });
    expect(ordered.scene.nodes.at(-1)).toMatchObject({ kind: "fallback", id: "above" });
    const container = ordered.scene.nodes.find((node) => node.reason === "unsupported-mermaid-container-style");
    expect(container.z).toBeGreaterThan(ordered.scene.nodes.find((node) => node.kind === "group").z);
    expect(container.z).toBeLessThan(ordered.scene.nodes.find((node) => node.meta?.mermaid?.kind === "edge-label").z);
    expect(ordered.scene.nodes.filter((node) => node.kind === "connector")).toEqual([]);
    expect(ordered.scene.nodes.filter((node) => node.kind === "shape")).toHaveLength(7);
    expect(ordered.diagnostics.filter((entry) => entry.kind === "fallback")).toHaveLength(3);

    await sceneFromFixture(page, source, "container-opacity.svg");
    const opacity = await updateFixture(page, () => { document.querySelector("g.nodes").style.opacity = "0.5"; });
    expect(opacity.scene.nodes.filter((node) => node.reason === "unsupported-mermaid-container-style")).toHaveLength(1);
    expect(opacity.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "node")).toEqual([]);
    expect(opacity.scene.nodes.filter((node) => node.kind === "connector")).toHaveLength(5);
  } finally {
    await harness.close();
  }
});

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
    ).toEqual([2, 4, 4, 4, 3]);
    for (const error of await sampledConnectorErrors(page)) {
      expect(error.maxError, error.path).toBeLessThanOrEqual(2);
    }
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

test("exports pinned sequence self paths and asynchronous heads with exact ownership and scaled endpoints", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Sequence paths"] });
  try {
    await page.goto(harness.url);
    const { scene, diagnostics } = await sceneFromFixture(page, await readFixture("sequence-paths.svg"), "sequence-paths.svg");
    validateScene(scene);
    expect(diagnostics).toEqual([]);
    const messages = scene.nodes.filter((node) => node.kind === "connector").slice(2);
    expect(messages.map((node) => [node.arrowStart, node.arrowEnd, node.style.dash])).toEqual([
      ["none", "triangle", "solid"], ["none", "triangle", "dash"],
      ["none", "stealth", "solid"], ["none", "stealth", "dash"],
      ["none", "stealth", "solid"], ["triangle", "triangle", "solid"], ["triangle", "triangle", "dash"],
      ["none", "stealth", "dash"],
    ]);
    expect(messages.filter((node) => node.points.length > 2)).toHaveLength(5);
    for (const self of messages.filter((node) => node.meta?.mermaid)) {
      expect(self.meta.mermaid.rawPointCount).toBeGreaterThan(self.points.length);
      expect(self.points[0].x).toBe(self.points.at(-1).x);
      expect(self.points.at(-1).y).toBeGreaterThan(self.points[0].y);
      expect(self.bounds.width).toBeGreaterThan(40);
    }
    const { elements, fallbacks } = sceneToPptxElements(scene);
    expect(fallbacks).toEqual([]);
    for (const message of messages) {
      expect(elements.find((element) => element.path === message.sourcePath)).toMatchObject({
        type: "connector", points: message.points, arrowStart: message.arrowStart, arrowEnd: message.arrowEnd,
        stroke: message.style.stroke, strokeWidth: message.style.strokeWidth,
        ...(message.style.dash === "dash" ? { dash: "dash" } : {}),
      });
    }
    const buffer = buildPptxPackage({ slides: [{ elements }] });
    expect(inspectPptxPackage(buffer).valid).toBe(true);
    // The package stores XML uncompressed; assert the actual emitted arrow/segment semantics.
    const xml = buffer.toString("utf8");
    expect((xml.match(/<a:tailEnd type="stealth"\/>/g) || [])).toHaveLength(4);
    expect((xml.match(/<a:headEnd type="triangle"\/>/g) || [])).toHaveLength(2);
    expect((xml.match(/<a:tailEnd type="triangle"\/>/g) || [])).toHaveLength(4);
    const svgHeads = await page.evaluate(async () => {
      const { sceneToSvg } = await import("./renderer/scene-svg.mjs");
      return [...sceneToSvg(window.__mermaidSceneResult.scene).querySelectorAll("marker > path")]
        .map((path) => ({ d: path.getAttribute("d"), fill: path.getAttribute("fill") }));
    });
    expect(svgHeads.filter((head) => head.d === "M 0 0 L 10 5 L 0 10 L 3 5 Z"))
      .toEqual(Array(4).fill({ d: "M 0 0 L 10 5 L 0 10 L 3 5 Z", fill: "rgb(51, 51, 51)" }));

    await updateFixture(page, () => {
      document.querySelector("#fixture-deck").style.cssText = "margin:23px 0 0 31px";
      document.querySelector("svg").style.cssText = "width:400px;max-width:none;transform:translate(18px,12px) scale(1.25)";
      for (const message of document.querySelectorAll('[data-et="message"]')) {
        message.setAttribute("transform", "translate(11, 7) scale(0.8, 1.1)");
        for (const end of ["start", "end"]) {
          if (message.hasAttribute(`marker-${end}`)) {
            message.style.setProperty(`marker-${end}`, message.getAttribute(`marker-${end}`));
            message.removeAttribute(`marker-${end}`);
          }
        }
      }
    });
    const positioned = await page.evaluate(async () => {
      const { mermaidSvgToScene } = await import("./renderer/mermaid-scene.mjs");
      const deck = document.querySelector("#fixture-deck");
      const svg = deck.querySelector("svg");
      const result = mermaidSvgToScene(svg, { deck, includeSourceElements: true });
      const round = (value) => Math.round(value * 10) / 10;
      const rect = deck.getBoundingClientRect();
      return {
        diagnostics: result.diagnostics,
        ownership: result.scene.nodes.map((node) => result.sourceElements.has(node.sourcePath)),
        z: result.scene.nodes.map((node) => node.z),
        messages: result.scene.nodes.flatMap((node) => {
          const source = result.sourceElements.get(node.sourcePath);
          if (source.getAttribute("data-et") !== "message") return [];
          const matrix = source.getScreenCTM();
          const points = source.localName === "path"
            ? [source.getPointAtLength(0), source.getPointAtLength(source.getTotalLength())]
            : [1, 2].map((i) => ({ x: +source.getAttribute(`x${i}`), y: +source.getAttribute(`y${i}`) }));
          return [{
            id: source.getAttribute("data-id"), node,
            endpoints: points.map((point) => {
              const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
              return { x: round(screen.x - rect.left), y: round(screen.y - rect.top) };
            }),
            strokeWidth: parseFloat(getComputedStyle(source).strokeWidth) * Math.hypot(matrix.a, matrix.b),
          }];
        }),
      };
    });
    expect(positioned.diagnostics).toEqual([]);
    expect(positioned.ownership.every(Boolean)).toBe(true);
    expect(positioned.z).toEqual(positioned.z.map((_, i) => i));
    expect(positioned.messages.map((message) => message.id)).toEqual(["i0", "i1", "i2", "i3", "i4", "i5", "i6", "i7"]);
    for (const { node, endpoints, strokeWidth } of positioned.messages) {
      expect([node.points[0], node.points.at(-1)]).toEqual(endpoints);
      expect(node.style.strokeWidth).toBe(Math.round(strokeWidth * 10) / 10);
      expect(node.sourcePath).toMatch(/^sequence\[\d+\]$/);
    }
    for (const error of await sampledConnectorErrors(page)) {
      expect(error.maxError, error.path).toBeLessThanOrEqual(2);
    }
  } finally {
    await harness.close();
  }
});

test("keeps unsupported sequence message paths local without joining strokes or losing labels", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Sequence path boundaries"] });
  try {
    await page.goto(harness.url);
    const fixture = await readFixture("sequence-paths.svg");
    for (const mutate of [
      () => { document.querySelector("path.messageLine0").setAttribute("d", "M76 117 L100 117 M100 137 L76 137"); },
      () => { document.querySelector("path.messageLine0").setAttribute("d", "M76 117 L100 117 L76 137 Z"); },
      () => { document.querySelector("path.messageLine0").setAttribute("d", "M76 117 L100 117 L76 117"); },
      () => { document.querySelector("path.messageLine0").setAttribute("d", "M76 117"); },
      () => { document.querySelector("path.messageLine0").setAttribute("d", ""); },
      () => { document.querySelector("path.messageLine0").setAttribute("d", "M76 117 L100000 117"); },
      () => { document.querySelector("path.messageLine0").style.fill = "red"; },
      () => { document.querySelector("path.messageLine0").style.filter = "blur(1px)"; },
      () => { document.querySelector("path.messageLine0").style.strokeOpacity = "0.5"; },
      () => { document.querySelector("path.messageLine0").style.clipPath = "inset(1px)"; },
      () => { document.querySelector("path.messageLine0").style.markerMid = "url(#fixture-sequence-paths-arrowhead)"; },
      () => { document.querySelector("path.messageLine0").style.markerEnd = "url(#fixture-sequence-paths-crosshead)"; },
      () => { document.querySelector("path.messageLine0").style.markerEnd = "url(#unknown-head)"; },
      () => { document.querySelector("path.messageLine0").setAttribute("class", "messageLine2"); },
    ]) {
      await sceneFromFixture(page, fixture, "sequence-path-fallback.svg");
      const result = await updateFixture(page, mutate);
      const fallbacks = result.scene.nodes.filter((node) => node.kind === "fallback");
      expect(fallbacks).toHaveLength(1);
      expect(fallbacks[0].sourcePath).toBe("sequence[11]");
      expect(fallbacks[0].reason).toMatch(/^unsupported-mermaid-/);
      expect(result.sources).toContainEqual({ path: fallbacks[0].sourcePath, tag: "path", id: "" });
      expect(result.diagnostics).toEqual([{ path: fallbacks[0].sourcePath, kind: "fallback", reason: fallbacks[0].reason }]);
      expect(result.scene.nodes.filter((node) => node.kind === "connector")).toHaveLength(9);
      expect(result.scene.nodes.filter((node) => node.kind === "text")).toHaveLength(12);
      expect(sceneToPptxElements(result.scene).fallbacks.map((fallback) => fallback.sourcePath)).toEqual(["sequence[11]"]);
    }
  } finally {
    await harness.close();
  }
});

test("recognizes sequence filled-head by geometry and paint and rejects unsupported placements", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Sequence marker boundaries"] });
  try {
    await page.goto(harness.url);
    const fixture = await readFixture("sequence-paths.svg");
    for (const mutate of [
      () => { document.querySelector('[id$="-filled-head"] path').setAttribute("d", "M0 0 L10 5 L0 10 Z"); },
      () => { document.querySelector('[id$="-filled-head"] path').style.fill = "none"; },
      () => { document.querySelector('[id$="-filled-head"] path').style.fill = "red"; },
      () => { document.querySelector('[id$="-filled-head"] path').style.stroke = "red"; },
      () => { document.querySelector('[id$="-filled-head"] path').style.opacity = "0.5"; },
      () => { document.querySelector('[id$="-filled-head"] path').style.transform = "rotate(20deg)"; },
      () => { document.querySelector('[id$="-filled-head"]').style.filter = "blur(1px)"; },
      () => { document.querySelector('[id$="-filled-head"]').insertAdjacentHTML("beforeend", '<circle r="5"/>'); },
      () => { document.querySelector('[id$="-filled-head"]').setAttribute("orient", "90"); },
      () => { document.querySelector('[id$="-filled-head"]').setAttribute("markerUnits", "userSpaceOnUse"); },
      () => { document.querySelector('[id$="-filled-head"]').setAttribute("refX", "0"); },
      () => { document.querySelector('[id$="-filled-head"]').setAttribute("viewBox", "0 0 10 10"); },
      () => { document.querySelector('[id$="-filled-head"]').remove(); },
    ]) {
      await sceneFromFixture(page, fixture, "sequence-head-fallback.svg");
      const result = await updateFixture(page, mutate);
      const fallbacks = result.scene.nodes.filter((node) => node.kind === "fallback");
      expect(fallbacks.map((node) => node.sourcePath)).toEqual(["sequence[15]", "sequence[17]", "sequence[19]", "sequence[25]"]);
      expect(result.scene.nodes.filter((node) => node.kind === "connector")).toHaveLength(6);
      expect(result.scene.nodes.filter((node) => node.kind === "text")).toHaveLength(12);
      for (const fallback of fallbacks) {
        expect(fallback.bounds.width).toBeGreaterThan(0);
        expect(fallback.bounds.height).toBeGreaterThan(0);
        expect(result.sources.some((source) => source.path === fallback.sourcePath)).toBe(true);
        expect(result.diagnostics).toContainEqual({ path: fallback.sourcePath, kind: "fallback", reason: fallback.reason });
      }
    }
    await sceneFromFixture(page, fixture, "sequence-start-head.svg");
    const start = await updateFixture(page, () => {
      const message = document.querySelector('[data-id="i2"]');
      message.setAttribute("marker-start", message.getAttribute("marker-end"));
      message.removeAttribute("marker-end");
    });
    expect(start.scene.nodes.filter((node) => node.kind === "fallback")).toMatchObject([
      { sourcePath: "sequence[15]", reason: "unsupported-mermaid-sequence-element" },
    ]);
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

test("exports filled class relationship heads and multiplicities from the pinned SVG", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Class relationships"] });
  try {
    await page.goto(harness.url);
    const { scene, diagnostics } = await sceneFromFixture(page, await readFixture("class-relations.svg"), "class-relations.svg");
    validateScene(scene);
    expect(diagnostics).toEqual([]);
    expect(scene.nodes.filter((node) => node.kind === "fallback")).toEqual([]);
    const edges = scene.nodes.filter((node) => node.meta?.mermaid?.kind === "edge");
    expect(edges.map((edge) => [edge.arrowStart, edge.arrowEnd, edge.style.dash])).toEqual([
      ["diamond", "none", "solid"], ["none", "stealth", "solid"],
      ["none", "stealth", "dash"], ["none", "none", "solid"],
    ]);
    const terminals = scene.nodes.filter((node) => node.meta?.mermaid?.kind === "edge-terminal");
    expect(terminals.map((node) => node.text.paragraphs[0].runs[0].text)).toEqual(["1", "many"]);
    expect(terminals.every((node) => node.z > edges.at(-1).z && node.style.fill === null)).toBe(true);
    const { elements, fallbacks } = sceneToPptxElements(scene);
    expect(fallbacks).toEqual([]);
    expect(elements.filter((element) => element.type === "connector" && element.mermaid?.kind === "edge")
      .map((element) => [element.arrowStart, element.arrowEnd])).toEqual(edges.map((edge) => [edge.arrowStart, edge.arrowEnd]));
    expect(elements.filter((element) => element.path.startsWith("edgeTerminals["))).toHaveLength(2);
    expect(inspectPptxPackage(buildPptxPackage({ slides: [{ elements }] })).valid).toBe(true);
    const markers = await page.evaluate(async () => {
      const { sceneToSvg } = await import("./renderer/scene-svg.mjs");
      const svg = sceneToSvg(window.__mermaidSceneResult.scene);
      return [...svg.querySelectorAll("marker > path")].map((path) => ({ d: path.getAttribute("d"), fill: path.getAttribute("fill") }));
    });
    expect(markers).toEqual([
      { d: "M 0 5 L 5 0 L 10 5 L 5 10 Z", fill: "rgb(51, 51, 51)" },
      { d: "M 0 0 L 10 5 L 0 10 L 3 5 Z", fill: "rgb(51, 51, 51)" },
      { d: "M 0 0 L 10 5 L 0 10 L 3 5 Z", fill: "rgb(51, 51, 51)" },
    ]);

    for (const suffix of ["", "-margin"]) {
      await page.evaluate((suffix) => {
        for (const edge of document.querySelectorAll("path.relation")) {
          edge.style.markerStart = `url("#fixture-class-relations_class-dependencyStart${suffix}")`;
          edge.style.markerEnd = `url("#fixture-class-relations_class-compositionEnd${suffix}")`;
          edge.removeAttribute("marker-start");
          edge.removeAttribute("marker-end");
        }
      }, suffix);
      const reversed = await updateFixture(page, () => {});
      expect(reversed.scene.nodes.filter((node) => node.kind === "fallback")).toEqual([]);
      expect(reversed.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "edge")
        .map((edge) => [edge.arrowStart, edge.arrowEnd])).toEqual(Array(4).fill(["stealth", "diamond"]));
    }

    const positioned = await updateFixture(page, () => {
      document.querySelector("#fixture-deck").style.marginLeft = "31px";
      document.querySelector("svg").style.cssText = "width:400px;max-width:none;transform:translate(18px,12px) scale(1.5)";
    });
    const measured = await page.evaluate(() => {
      const deck = document.querySelector("#fixture-deck").getBoundingClientRect();
      return [...document.querySelectorAll("g.edgeTerminals span.edgeLabel")].map((label) => {
        const bounds = label.getBoundingClientRect();
        return Object.fromEntries(Object.entries({
          x: bounds.left - deck.left, y: bounds.top - deck.top, width: bounds.width, height: bounds.height,
        }).map(([key, value]) => [key, Math.round(value * 10) / 10]));
      });
    });
    const positionedTerminals = positioned.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "edge-terminal");
    expect(positionedTerminals.map((node) => node.bounds)).toEqual(measured);
    for (const terminal of positionedTerminals) {
      expect(positioned.sources).toContainEqual({ path: terminal.sourcePath, tag: "g", id: "" });
    }
  } finally {
    await harness.close();
  }
});

test("keeps unsupported class markers and decorated multiplicities local and lossless", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Class relationship fallbacks"] });
  try {
    await page.goto(harness.url);
    const fixture = await readFixture("class-relations.svg");
    for (const mutate of [
      () => { document.querySelector('[id$="-compositionStart"] path').style.setProperty("fill", "transparent", "important"); },
      () => { document.querySelector('[id$="-compositionStart"] path').style.setProperty("fill", "red", "important"); },
      () => { document.querySelector('[id$="-compositionStart"] path').setAttribute("d", "M0,0 L10,0 L0,10 Z"); },
      () => { document.querySelector('[id$="-compositionStart"]').style.filter = "blur(1px)"; },
      () => { document.querySelector('[id$="-compositionStart"] path').style.opacity = "0.5"; },
      () => { document.querySelector('[id$="-compositionStart"] path').style.transform = "rotate(20deg)"; },
      () => { document.querySelector('[id$="-compositionStart"]').remove(); },
      () => { document.querySelector("path.relation").setAttribute("marker-start", "url(#fixture-class-relations_class-aggregationStart)"); },
      () => { document.querySelector("path.relation").setAttribute("marker-start", "url(#fixture-class-relations_class-extensionStart)"); },
    ]) {
      await sceneFromFixture(page, fixture, "class-marker-fallback.svg");
      const result = await updateFixture(page, mutate);
      expect(result.scene.nodes.filter((node) => node.kind === "fallback")).toMatchObject([
        { sourcePath: "edges[0]", reason: "unsupported-mermaid-edge-style" },
      ]);
      expect(result.diagnostics).toEqual([{ path: "edges[0]", kind: "fallback", reason: "unsupported-mermaid-edge-style" }]);
      expect(result.sources.find((source) => source.path === "edges[0]").tag).toBe("path");
      expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "edge-terminal")).toHaveLength(2);
      expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "edge")).toHaveLength(3);
    }
    for (const mutate of [
      () => { document.querySelector("g.edgeTerminals").style.filter = "blur(1px)"; },
      () => { document.querySelector("g.edgeTerminals").insertAdjacentHTML("beforeend", '<circle r="5" fill="red"/>'); },
      () => { document.querySelector("g.edgeTerminals").insertAdjacentHTML("beforeend", '<text>Extra multiplicity</text>'); },
      () => { document.querySelector("g.edgeTerminals div").append("Extra multiplicity"); },
    ]) {
      await sceneFromFixture(page, fixture, "class-terminal-fallback.svg");
      const result = await updateFixture(page, mutate);
      const fallback = result.scene.nodes.find((node) => node.kind === "fallback");
      expect(result.scene.nodes.filter((node) => node.kind === "fallback")).toHaveLength(1);
      expect(fallback).toMatchObject({ reason: "unsupported-mermaid-edge-label" });
      expect(fallback.sourcePath).toMatch(/^edgeTerminals\[/);
      expect(result.diagnostics).toEqual([{ path: fallback.sourcePath, kind: "fallback", reason: fallback.reason }]);
      expect(result.sources).toContainEqual({ path: fallback.sourcePath, tag: "g", id: "" });
      expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "edge-terminal")).toHaveLength(1);
      expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "edge")).toHaveLength(4);
    }
    await sceneFromFixture(page, fixture, "class-label-container.svg");
    const container = await updateFixture(page, () => { document.querySelector("g.edgeLabels").style.opacity = "0.5"; });
    expect(container.scene.nodes.filter((node) => node.kind === "fallback")).toMatchObject([
      { reason: "unsupported-mermaid-container-style" },
    ]);
    expect(container.scene.nodes.filter((node) => ["edge-terminal", "edge-label"].includes(node.meta?.mermaid?.kind))).toEqual([]);
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
    for (const name of ["sequence", "sequence-paths", "class", "class-relations", "shapes-styled"]) {
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

test.describe("additional SVG compatibility", () => {
  test("preserves CSS connector markers and solid zero dash arrays in PPTX", async ({ page }) => {
    const harness = await startHarness({ slides: ["# Connector styles"] });
    try {
      await page.goto(harness.url);
      const classes = await sceneFromFixture(page, await readFixture("class.svg"), "class.svg");
      expect(classes.scene.nodes.filter((node) => node.kind === "shape" || node.kind === "connector")
        .every((node) => node.style.dash === "solid")).toBe(true);
      expect(sceneToPptxElements(classes.scene).elements.filter((element) => element.type === "shape" || element.type === "connector")
        .every((element) => !element.dash)).toBe(true);

      await sceneFromFixture(page, await readFixture("sequence.svg"), "css-markers.svg");
      const styled = await updateFixture(page, () => {
        const line = document.querySelector("line.messageLine0");
        line.style.markerEnd = line.getAttribute("marker-end");
        line.removeAttribute("marker-end");
        line.style.stroke = "rgb(12, 34, 56)";
        line.style.opacity = "0.4";
        line.style.strokeWidth = "4px";
        line.style.strokeDasharray = "0 0";
      });
      const message = styled.scene.nodes.find((node) => node.style?.stroke === "rgb(12, 34, 56)");
      expect(message).toMatchObject({
        kind: "connector", arrowEnd: "triangle",
        style: { strokeWidth: 4, opacity: 0.4, dash: "solid" },
      });
      expect(sceneToPptxElements(styled.scene).elements.find((element) => element.path === message.sourcePath))
        .toMatchObject({ type: "connector", arrowEnd: "triangle", stroke: "rgb(12, 34, 56)", opacity: 0.4 });
      const unsupported = await updateFixture(page, () => {
        document.querySelector("line.messageLine0").style.markerEnd = "url(#fixture-sequence-crosshead)";
      });
      expect(unsupported.scene.nodes.filter((node) => node.kind === "fallback")).toHaveLength(1);
      expect(unsupported.scene.nodes.filter((node) => node.kind === "connector")).toHaveLength(3);
      const fallback = unsupported.scene.nodes.find((node) => node.kind === "fallback");
      expect(fallback.bounds.height).toBeGreaterThanOrEqual(40);
      expect(unsupported.diagnostics).toContainEqual({ path: fallback.sourcePath, kind: "fallback", reason: fallback.reason });
    } finally {
      await harness.close();
    }
  });

  test("retains class relation labels and flowchart labels without unique data IDs", async ({ page }) => {
    const harness = await startHarness({ slides: ["# Relation labels"] });
    try {
      await page.goto(harness.url);
      await sceneFromFixture(page, await readFixture("class.svg"), "class-label.svg");
      const classes = await updateFixture(page, () => {
        const group = document.querySelector("g.edgeLabel");
        group.querySelector("g.label").removeAttribute("data-id");
        const foreign = group.querySelector("foreignObject");
        foreign.setAttribute("width", "100");
        foreign.setAttribute("height", "24");
        group.querySelector("span.edgeLabel").textContent = "inherits";
      });
      const label = classes.scene.nodes.find((node) => node.meta?.mermaid?.kind === "edge-label");
      expect(label.text.paragraphs[0].runs[0].text).toBe("inherits");
      expect(classes.sources).toContainEqual({ path: label.sourcePath, tag: "g", id: "" });

      const flowchart = await readFixture("flowchart.svg");
      for (const duplicate of [false, true]) {
        await sceneFromFixture(page, flowchart, "labels.svg");
        await page.evaluate((duplicate) => {
          document.querySelectorAll("g.edgeLabel > g.label").forEach((element) => {
            if (duplicate) element.setAttribute("data-id", "shared");
            else element.removeAttribute("data-id");
          });
        }, duplicate);
        const result = await updateFixture(page, () => {});
        const labels = result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "edge-label");
        expect(labels.map((node) => node.text.paragraphs[0].runs[0].text)).toEqual(["yes", "no"]);
        expect(new Set(labels.map((node) => node.sourcePath)).size).toBe(2);
        expect(result.scene.nodes.filter((node) => node.kind === "fallback")).toEqual([]);
      }
    } finally {
      await harness.close();
    }
  });

  test("keeps unsupported class geometry and split paint local without omitting compartments", async ({ page }) => {
    const harness = await startHarness({ slides: ["# Class fallback coverage"] });
    try {
      await page.goto(harness.url);
      const source = await readFixture("class.svg");
      const mutations = [
        () => { document.querySelector("g.node g.label-container path:last-child").setAttribute("d", "M-78 -72 L78 72"); },
        () => { document.querySelector("g.node g.label-container path:first-child").style.opacity = "0.5"; },
        () => {
          const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          circle.setAttribute("r", "8");
          document.querySelector("g.node g.members-group").append(circle);
        },
        () => {
          document.querySelector("g.node g.members-group foreignObject div").append("Extra visible member");
        },
      ];
      for (const mutate of mutations) {
        await sceneFromFixture(page, source, "class-unsupported.svg");
        const result = await updateFixture(page, mutate);
        expect(result.scene.nodes.filter((node) => node.reason === "unsupported-mermaid-class-node")).toHaveLength(1);
        expect(result.scene.nodes.filter((node) => node.sourcePath.startsWith("classes[0]."))).toEqual([]);
        expect(result.scene.nodes.filter((node) => node.kind === "shape")).toHaveLength(1);
        expect(result.scene.nodes.find((node) => node.sourcePath === "classes[1].labels[0]").text.paragraphs[0].runs[0].text).toBe("Dog");
      }
      await sceneFromFixture(page, source, "class-svg-text.svg");
      const result = await updateFixture(page, () => {
        const label = document.querySelector("g.node g.members-group g.label");
        label.innerHTML = '<text fill="#123456" text-anchor="start">+String <tspan font-weight="700">name</tspan></text>';
      });
      const member = result.scene.nodes.find((node) => node.sourcePath === "classes[0].labels[1]");
      expect(member.text.paragraphs).toHaveLength(1);
      expect(member.text.paragraphs[0].runs.map((run) => run.text).join("")).toBe("+String name");
      expect(member.text.paragraphs[0].runs[1].bold).toBe(true);
      expect(member.text.paragraphs[0].alignment).toBe("left");
    } finally {
      await harness.close();
    }
  });

  test("does not drop unknown SVG siblings, flat lines, cluster effects or disconnected edge strokes", async ({ page }) => {
    const harness = await startHarness({ slides: ["# Complete visual coverage"] });
    try {
      await page.goto(harness.url);
      const source = await readFixture("flowchart.svg");
      await sceneFromFixture(page, source, "unknown-siblings.svg");
      const unknown = await updateFixture(page, () => {
        const svg = document.querySelector("#fixture-deck > svg");
        svg.insertAdjacentHTML("beforeend", '<line id="extra-line" x1="10" x2="100" y1="20" y2="20" stroke="red"/>');
        svg.querySelector("g.root").insertAdjacentHTML("beforeend", '<g class="label"><circle id="extra-circle" r="10" cx="40" cy="40"/></g>');
      });
      expect(unknown.scene.nodes.filter((node) => node.kind === "fallback").map((node) => node.id).sort())
        .toEqual(["extra-circle", "extra-line"]);
      expect(unknown.scene.nodes.filter((node) => node.kind === "shape")).toHaveLength(7);
      expect(unknown.diagnostics.filter((entry) => entry.kind === "fallback")).toHaveLength(2);
      const decoratedLabel = await updateFixture(page, () => {
        document.querySelector("g.edgeLabel:has(p)").insertAdjacentHTML("afterbegin", '<circle r="10" fill="red"/>');
      });
      expect(decoratedLabel.scene.nodes.filter((node) => node.reason === "unsupported-mermaid-edge-label")).toHaveLength(1);
      expect(decoratedLabel.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "edge-label")).toHaveLength(1);

      await sceneFromFixture(page, source, "cluster-effect.svg");
      const cluster = await updateFixture(page, () => {
        document.querySelector("g.cluster").style.filter = "blur(1px)";
        document.querySelector("path.flowchart-link").setAttribute("d", "M10 10 L30 10 M50 10 L80 10");
      });
      expect(cluster.scene.nodes.filter((node) => node.reason === "unsupported-mermaid-cluster-content")).toHaveLength(1);
      expect(cluster.scene.nodes.filter((node) => node.reason === "unsupported-mermaid-edge-path")).toHaveLength(1);
      expect(cluster.scene.nodes.filter((node) => node.kind === "connector")).toHaveLength(4);
      expect(cluster.scene.nodes.filter((node) => node.kind === "group")).toEqual([]);
      const root = await updateFixture(page, () => { document.querySelector("g.root").style.filter = "blur(1px)"; });
      expect(root.scene.nodes).toMatchObject([{ kind: "fallback", sourcePath: "svg", reason: "unsupported-mermaid-svg-style" }]);
    } finally {
      await harness.close();
    }
  });

  test("keeps sequence leaf effects local and inline SVG text on its original line", async ({ page }) => {
    const harness = await startHarness({ slides: ["# Sequence text and local fallback"] });
    try {
      await page.goto(harness.url);
      await sceneFromFixture(page, await readFixture("sequence.svg"), "sequence-local.svg");
      const result = await updateFixture(page, () => {
        document.querySelector("rect.note").style.filter = "blur(1px)";
        document.querySelector("text.messageText").innerHTML = 'Send <tspan font-weight="700">Request</tspan>';
        const hidden = document.querySelector("rect.actor").cloneNode(true);
        hidden.style.display = "none";
        document.querySelector("#fixture-deck > svg").append(hidden);
      });
      expect(result.scene.nodes.filter((node) => node.kind === "shape")).toHaveLength(5);
      expect(result.scene.nodes.filter((node) => node.kind === "connector")).toHaveLength(4);
      const fallbacks = result.scene.nodes.filter((node) => node.kind === "fallback");
      expect(fallbacks).toHaveLength(1);
      expect(result.sources.find((source) => source.path === fallbacks[0].sourcePath).tag).toBe("rect");
      expect(result.scene.nodes.some((node) => node.text?.paragraphs[0].runs[0].text === "Validate")).toBe(true);
      const request = result.scene.nodes.find((node) => node.text?.paragraphs[0].runs[0].text === "Send ");
      expect(request.text.paragraphs).toHaveLength(1);
      expect(request.text.paragraphs[0].runs[1]).toMatchObject({ text: "Request", bold: true });
    } finally {
      await harness.close();
    }
  });
});

test("real renderer exports new Mermaid diagrams with exact native masks and partial fallback captures", async ({ page }) => {
  const diagrams = [
    "sequenceDiagram\nparticipant A as Client\nparticipant B as Service\nA->>B: Request\nB-->>A: Response",
    "classDiagram\nclass Animal {\n+String name\n+speak() void\n}\nclass Dog\nAnimal <|-- Dog : inherits",
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
    await expect(classSvg.locator("g.edgeLabel[data-pptx-native=shape]")).toHaveCount(1);
    expect(classes.elements.some((element) => element.path?.includes("edgeLabels[") &&
      element.text?.paragraphs?.some((paragraph) => paragraph.runs.some((run) => run.text === "inherits")))).toBe(true);
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

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  test(`real renderer exports sequence self and asynchronous messages with local fallback masks (${theme})`, async ({ page }) => {
    const diagram = (await readFixture("sequence-paths.mmd"))
      .replace("Check", "\u78ba\u8a8d<br/>\u51e6\u7406")
      .replace("Dispatch", "\u975e\u540c\u671f<br/>\u9001\u4fe1") +
      "\nA-xA: Cancel self\nA-xB: Cancel remote\nloop Retry loop\nA->>A: Again\nend";
    const harness = await startHarness({
      slides: [`# Sequence paths\n\n\`\`\`mermaid\n${diagram}\n\`\`\``],
      theme,
      customThemeCss: theme === "custom" ? "--bg:#102030;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;" : "",
    });
    try {
      await page.goto(`${harness.url}/?pptx=1&token=${encodeURIComponent(harness.printToken)}`);
      await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready") ||
        document.documentElement.hasAttribute("data-pptx-error"), undefined, { timeout: 120_000 });
      await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
      const slide = await page.evaluate(() => window.__presentationPptxModel.slides[0]);
      const connectors = slide.elements.filter((element) => element.type === "connector" &&
        element.path?.startsWith("mermaid[0].sequence["));
      expect(connectors).toHaveLength(11);
      expect(connectors.filter((element) => element.arrowEnd === "stealth")).toHaveLength(4);
      expect(connectors.filter((element) => element.arrowStart === "triangle")).toHaveLength(2);
      expect(connectors.filter((element) => element.points.length > 2)).toHaveLength(6);
      const labels = slide.elements.filter((element) => element.type === "text" &&
        element.path?.startsWith("mermaid[0].sequence["))
        .map((element) => element.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join("")).join("\n"));
      // The sequence renderer emits each line of a multiline message as a separate text element.
      expect(labels).toEqual([
        "Service", "Client", "Service", "Client", "\u78ba\u8a8d", "\u51e6\u7406", "Retry",
        "\u975e\u540c\u671f", "\u9001\u4fe1", "Notify", "Schedule", "Exchange", "Recheck", "Reschedule",
        "Cancel self", "Cancel remote", "Again",
      ]);
      const fallbacks = slide.fallbacks.filter((fallback) => fallback.type === "mermaid");
      expect(fallbacks.length).toBeGreaterThan(2); // Cross heads and unsupported loop decorations stay local.
      expect(fallbacks.every((fallback) => fallback.path.startsWith("mermaid[0].sequence[") && fallback.reason)).toBe(true);
      const svg = page.locator("pre.mermaid > svg");
      expect(await svg.getAttribute("data-pptx-fallback-ids")).toBeNull();
      await expect(svg.locator("path[data-et=message][data-pptx-native=connector]")).toHaveCount(6);
      await expect(svg.locator("line[data-et=message][data-pptx-native=connector]")).toHaveCount(3);
      await expect(svg.locator("[data-et=message][data-pptx-fallback-ids]")).toHaveCount(2);
      const masks = await svg.evaluate((svg) => ({
        messages: [...svg.querySelectorAll("[data-et=message][data-pptx-native]")].map((message) => {
          const style = getComputedStyle(message);
          return { path: message.getAttribute("data-scene-source-path"), stroke: style.stroke,
            start: style.markerStart, end: style.markerEnd };
        }),
        fallback: [...svg.querySelectorAll("[data-et=message][data-pptx-fallback-ids]")].map((message) => {
          const style = getComputedStyle(message);
          return { path: message.getAttribute("data-scene-source-path"), stroke: style.stroke, marker: style.markerEnd };
        }),
        labels: [...svg.querySelectorAll("text.messageText")].map((label) => ({
          native: label.getAttribute("data-pptx-native"), fill: getComputedStyle(label).fill,
        })),
      }));
      expect(masks.messages).toHaveLength(9);
      for (const message of masks.messages) {
        expect(message).toMatchObject({ stroke: "rgba(0, 0, 0, 0)", start: "none", end: "none" });
        expect(connectors.some((connector) => connector.path === `mermaid[0].${message.path}`)).toBe(true);
      }
      for (const fallback of masks.fallback) {
        expect(fallback.stroke).not.toBe("rgba(0, 0, 0, 0)");
        expect(fallback.marker).toContain("crosshead");
        expect(fallbacks.some((entry) => entry.path === `mermaid[0].${fallback.path}`)).toBe(true);
        expect(connectors.some((connector) => connector.path === `mermaid[0].${fallback.path}`)).toBe(false);
      }
      expect(masks.labels).toEqual(Array(13).fill({ native: "text", fill: "rgba(0, 0, 0, 0)" }));
    } finally {
      await harness.close();
    }
  });

  test(`real renderer masks native class heads and multiplicities while preserving hollow heads (${theme})`, async ({ page }) => {
    const diagram = (await readFixture("class-relations.mmd"))
      .replace("contains", "\u5408\u6210<br/>\u95a2\u4fc2")
      .replace('"many"', '"0..*<br/>\u8907\u6570"') + "\nA <|-- B : inherits\nA o-- B : aggregates";
    const harness = await startHarness({
      slides: [`# Class relationships\n\n\`\`\`mermaid\n${diagram}\n\`\`\``],
      theme,
      customThemeCss: theme === "custom" ? "--bg:#102030;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;" : "",
    });
    try {
      await page.goto(`${harness.url}/?pptx=1&token=${encodeURIComponent(harness.printToken)}`);
      await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready") ||
        document.documentElement.hasAttribute("data-pptx-error"), undefined, { timeout: 120_000 });
      await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
      const slide = await page.evaluate(() => window.__presentationPptxModel.slides[0]);
      const edges = slide.elements.filter((element) => element.path?.startsWith("mermaid[0].edges["));
      expect(edges.map((edge) => [edge.arrowStart, edge.arrowEnd])).toEqual([
        ["diamond", "none"], ["none", "stealth"], ["none", "stealth"], ["none", "none"],
      ]);
      const terminals = slide.elements.filter((element) => element.mermaid?.kind === "edge-terminal");
      expect(terminals.map((terminal) => terminal.text.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(""))))
        .toEqual([["1"], ["0..*", "\u8907\u6570"]]);
      expect(slide.elements.some((element) => element.text?.paragraphs?.map((paragraph) =>
        paragraph.runs.map((run) => run.text).join("")).join("\n") === "\u5408\u6210\n\u95a2\u4fc2")).toBe(true);
      expect(slide.fallbacks.filter((fallback) => fallback.type === "mermaid")).toMatchObject([
        { path: "mermaid[0].edges[4]", reason: "unsupported-mermaid-edge-style" },
        { path: "mermaid[0].edges[5]", reason: "unsupported-mermaid-edge-style" },
      ]);
      const svg = page.locator("pre.mermaid > svg");
      await expect(svg.locator("path.relation[data-pptx-native=connector]")).toHaveCount(4);
      await expect(svg.locator("g.edgeTerminals[data-pptx-native=shape]")).toHaveCount(2);
      await expect(svg.locator("path.relation[data-pptx-fallback-ids]")).toHaveCount(2);
      expect(await svg.getAttribute("data-pptx-fallback-ids")).toBeNull();
      const masks = await svg.evaluate((svg) => ({
        edges: [...svg.querySelectorAll("path.relation[data-pptx-native]")].map((edge) => {
          const style = getComputedStyle(edge);
          return [style.stroke, style.markerStart, style.markerEnd];
        }),
        labels: [...svg.querySelectorAll("g.edgeTerminals span.edgeLabel")].map((label) => getComputedStyle(label).color),
        fallbackMarkers: [...svg.querySelectorAll("path.relation[data-pptx-fallback-ids]")].map((edge) => getComputedStyle(edge).markerStart),
      }));
      expect(masks.edges).toEqual(Array(4).fill(["rgba(0, 0, 0, 0)", "none", "none"]));
      expect(masks.labels).toEqual(Array(2).fill("rgba(0, 0, 0, 0)"));
      expect(masks.fallbackMarkers.every((marker) => marker !== "none")).toBe(true);
    } finally {
      await harness.close();
    }
  });
}
