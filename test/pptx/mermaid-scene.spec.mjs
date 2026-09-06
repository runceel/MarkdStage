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

async function sceneFromMermaidSource(page, source, path) {
  return page.evaluate(async ({ diagram, sourcePath }) => {
    window.mermaid.initialize({
      startOnLoad: false,
      theme: "default",
      securityLevel: "strict",
    });
    const id = `fixture-${sourcePath.replace(/[^a-z0-9]+/gi, "-")}`;
    const rendered = await window.mermaid.render(id, diagram);
    document.body.innerHTML = [
      "<style>body{margin:0}#fixture-deck{position:relative;width:900px;height:600px}</style>",
      `<div id="fixture-deck">${rendered.svg}</div>`,
    ].join("");
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const { mermaidSvgToScene } = await import("./renderer/mermaid-scene.mjs");
    const result = mermaidSvgToScene(document.querySelector("#fixture-deck > svg"), {
      path: sourcePath,
      deck: document.querySelector("#fixture-deck"),
      includeSourceElements: true,
    });
    return {
      scene: result.scene,
      diagnostics: result.diagnostics,
      sources: [...result.sourceElements].map(([entryPath, element]) => ({
        path: entryPath,
        tag: element.localName,
        id: element.id,
        class: element.getAttribute("class") || "",
      })),
    };
  }, { diagram: source, sourcePath: path });
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

test("extracts pinned packet rows, bit ranges, labels and title at rendered bounds", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Packet fixture"] });
  try {
    await page.goto(harness.url);
    const result = await sceneFromFixture(page, await readFixture("packet.svg"), "packet.svg");
    validateScene(result.scene);
    expect(result.diagnostics).toEqual([]);
    expect(result.scene.nodes.map((node) => node.z))
      .toEqual(Array.from({ length: 37 }, (_, index) => index));
    expect(result.scene.nodes.filter((node) => node.kind === "shape")).toHaveLength(9);
    expect(result.scene.nodes.filter((node) => node.kind === "text")).toHaveLength(28);
    expect(result.scene.nodes.filter((node) => node.kind === "fallback")).toEqual([]);
    expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "packet-field")
      .map((node) => node.meta.mermaid.row)).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 2]);
    expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "packet-field-label")
      .map((node) => node.text.paragraphs[0].runs.map((run) => run.text).join(""))).toEqual([
      "Version",
      "Header length",
      "Next header",
      "Flags",
      "識別子 Identifier",
      "識別子 Identifier",
      "TTL",
      "Payload length",
      "末尾 Tail",
    ]);
    expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "packet-bit-label")
      .map((node) => node.text.paragraphs[0].runs[0].text)).toEqual([
      "0", "3", "4", "7", "8", "15", "16", "19", "20", "31",
      "32", "39", "40", "47", "48", "63", "64", "71",
    ]);
    expect(result.scene.nodes.find((node) => node.sourcePath === "packet.title")
      .text.paragraphs[0].runs.map((run) => run.text).join(""))
      .toBe("IPv6 Extension Header / 拡張ヘッダー");

    const mapped = sceneToPptxElements(result.scene);
    expect(mapped.fallbacks).toEqual([]);
    expect(mapped.elements.filter((element) => element.type === "shape")).toHaveLength(9);
    expect(mapped.elements.filter((element) => element.type === "text")).toHaveLength(28);
    const buffer = buildPptxPackage({ slides: [{ elements: mapped.elements }] });
    expect(inspectPptxPackage(buffer).valid).toBe(true);
    const xml = buffer.toString("utf8");
    expect((xml.match(/<p:sp>/g) || [])).toHaveLength(37);
    expect((xml.match(/<p:txBody>/g) || [])).toHaveLength(28);
    expect((xml.match(/<a:prstGeom prst="rect">/g) || [])).toHaveLength(37);
    expect(xml).toContain("識別子 Identifier");
    expect(xml).toContain("拡張ヘッダー");

    const geometry = await page.evaluate(async () => {
      document.querySelector("#fixture-deck").style.cssText =
        "position:relative;width:1180px;height:520px;margin:17px 0 0 29px";
      document.querySelector("svg").style.cssText =
        "width:820px;max-width:none;transform-origin:0 0;transform:translate(37px,23px) scale(1.1)";
      const { mermaidSvgToScene } = await import("./renderer/mermaid-scene.mjs");
      const deck = document.querySelector("#fixture-deck");
      const svg = deck.querySelector("svg");
      const result = mermaidSvgToScene(svg, { deck, includeSourceElements: true });
      const deckRect = deck.getBoundingClientRect();
      const round = (value) => Math.round(value * 10) / 10;
      const expectedOrder = [...svg.querySelectorAll(
        "rect.packetBlock, text.packetLabel, text.packetByte, text.packetTitle",
      )].filter((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0 || bounds.height > 0 || element.textContent.trim();
      });
      return {
        diagnostics: result.diagnostics,
        order: result.scene.nodes.map((node) =>
          expectedOrder.indexOf(result.sourceElements.get(node.sourcePath))),
        uniqueSources: new Set(result.scene.nodes.map((node) =>
          result.sourceElements.get(node.sourcePath))).size,
        entries: result.scene.nodes.map((node) => {
          const source = result.sourceElements.get(node.sourcePath);
          const bounds = source.getBoundingClientRect();
          return {
            sourcePath: node.sourcePath,
            bounds: node.bounds,
            expected: {
              x: round(bounds.left - deckRect.left),
              y: round(bounds.top - deckRect.top),
              width: round(bounds.width),
              height: round(bounds.height),
            },
          };
        }),
      };
    });
    expect(geometry.diagnostics).toEqual([]);
    expect(geometry.order).toEqual(Array.from({ length: 37 }, (_, index) => index));
    expect(geometry.uniqueSources).toBe(37);
    for (const entry of geometry.entries) {
      expect(entry.bounds, entry.sourcePath).toEqual(entry.expected);
    }
  } finally {
    await harness.close();
  }
});

test("accepts the bundled one-bit and showBits false packet structures", async ({ page }) => {
  const packet = [
    "packet",
    "title Compact header",
    '0: "Flag"',
    '1-7: "Kind"',
    '8-15: "Length"',
  ].join("\n");
  const harness = await startHarness({
    slides: [
      `# Packet bits\n\n\`\`\`mermaid\n${packet}\n\`\`\``,
      `# Packet without bits\n\n\`\`\`mermaid\n%%{init:{"packet":{"showBits":false}}}%%\n${packet}\n\`\`\``,
    ],
  });
  try {
    await page.goto(`${harness.url}/?pptx=1&token=${encodeURIComponent(harness.printToken)}`);
    await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready") ||
      document.documentElement.hasAttribute("data-pptx-error"), undefined, { timeout: 120_000 });
    await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
    const model = await page.evaluate(() => window.__presentationPptxModel);
    const withBits = model.slides[0].elements.filter((element) =>
      element.path?.startsWith("mermaid[0].packet."));
    const withoutBits = model.slides[1].elements.filter((element) =>
      element.path?.startsWith("mermaid[0].packet."));
    expect(withBits.filter((element) => element.type === "shape")).toHaveLength(3);
    expect(withBits.filter((element) => element.type === "text")).toHaveLength(9);
    expect(withoutBits.filter((element) => element.type === "shape")).toHaveLength(3);
    expect(withoutBits.filter((element) => element.type === "text")).toHaveLength(4);
    expect(model.slides.flatMap((slide) =>
      slide.fallbacks.filter((fallback) => fallback.type === "mermaid"))).toEqual([]);

    const withBitsSvg = page.locator("pre.mermaid > svg").nth(0);
    const withoutBitsSvg = page.locator("pre.mermaid > svg").nth(1);
    await expect(withBitsSvg.locator("text.packetByte.start[data-pptx-native=text]")).toHaveCount(3);
    await expect(withBitsSvg.locator("text.packetByte.end[data-pptx-native=text]")).toHaveCount(2);
    const oneBit = await withBitsSvg.evaluate((svg) => {
      const field = svg.querySelector("rect.packetBlock");
      const start = svg.querySelector("text.packetByte.start");
      return {
        fieldCenter: Number(field.getAttribute("x")) + Number(field.getAttribute("width")) / 2,
        startX: Number(start.getAttribute("x")),
        anchor: start.getAttribute("text-anchor"),
      };
    });
    expect(oneBit.startX).toBe(oneBit.fieldCenter);
    expect(oneBit.anchor).toBe("middle");
    await expect(withoutBitsSvg.locator("text.packetByte")).toHaveCount(0);
    await expect(withoutBitsSvg.locator("rect.packetBlock[data-pptx-native=shape]")).toHaveCount(3);
    await expect(withoutBitsSvg.locator(
      "text.packetLabel[data-pptx-native=text], text.packetTitle[data-pptx-native=text]",
    )).toHaveCount(4);
    await expect(withoutBitsSvg.locator("[data-pptx-fallback-ids]")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

test("extracts pinned treeView hierarchy lines and labels at rendered CTMs", async ({ page }) => {
  const harness = await startHarness({ slides: ["# treeView fixture"] });
  try {
    await page.goto(harness.url);
    const result = await sceneFromFixture(page, await readFixture("tree-view.svg"), "tree-view.svg");
    validateScene(result.scene);
    expect(result.diagnostics).toEqual([]);
    expect(result.scene.nodes.map((node) => node.z))
      .toEqual(Array.from({ length: 25 }, (_, index) => index));
    expect(result.scene.nodes.filter((node) => node.kind === "connector")).toHaveLength(15);
    expect(result.scene.nodes.filter((node) => node.kind === "text")).toHaveLength(10);
    expect(result.scene.nodes.filter((node) => node.kind === "fallback")).toEqual([]);
    expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "tree-view-label")
      .map((node) => node.text.paragraphs[0].runs.map((run) => run.text).join(""))).toEqual([
      "/",
      "サービス Service",
      "API",
      "認証 Auth",
      "データ",
      "Worker",
      "Queue",
      "Leaf A",
      "葉 B",
      "監視",
    ]);
    expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "tree-view-branch")
      .every((node) => node.points.length === 2)).toBe(true);

    const mapped = sceneToPptxElements(result.scene);
    expect(mapped.fallbacks).toEqual([]);
    expect(mapped.elements.filter((element) => element.type === "connector")).toHaveLength(15);
    expect(mapped.elements.filter((element) => element.type === "text")).toHaveLength(10);
    const buffer = buildPptxPackage({ slides: [{ elements: mapped.elements }] });
    expect(inspectPptxPackage(buffer).valid).toBe(true);
    const xml = buffer.toString("utf8");
    expect((xml.match(/<p:sp>/g) || [])).toHaveLength(25);
    expect((xml.match(/<a:prstGeom prst="line">/g) || [])).toHaveLength(15);
    expect((xml.match(/<p:txBody>/g) || [])).toHaveLength(10);
    expect(xml).toContain("サービス Service");
    expect(xml).toContain("葉 B");

    const geometry = await page.evaluate(async () => {
      document.querySelector("#fixture-deck").style.cssText =
        "position:relative;width:960px;height:540px;margin:19px 0 0 31px";
      document.querySelector("svg").style.cssText =
        "width:520px;max-width:none;transform-origin:0 0;transform:translate(43px,29px) scale(1.15)";
      document.querySelector("g.tree-view").setAttribute("transform", "translate(40 20) rotate(12)");
      const { mermaidSvgToScene } = await import("./renderer/mermaid-scene.mjs");
      const deck = document.querySelector("#fixture-deck");
      const svg = deck.querySelector("svg");
      const result = mermaidSvgToScene(svg, { deck, includeSourceElements: true });
      const deckRect = deck.getBoundingClientRect();
      const round = (value) => Math.round(value * 10) / 10;
      const expectedOrder = [...svg.querySelectorAll(
        "text.treeView-node-label, line.treeView-node-line",
      )];
      return {
        diagnostics: result.diagnostics,
        order: result.scene.nodes.map((node) =>
          expectedOrder.indexOf(result.sourceElements.get(node.sourcePath))),
        uniqueSources: new Set(result.scene.nodes.map((node) =>
          result.sourceElements.get(node.sourcePath))).size,
        entries: result.scene.nodes.map((node) => {
          const source = result.sourceElements.get(node.sourcePath);
          if (node.kind === "connector") {
            const matrix = source.getScreenCTM();
            return {
              sourcePath: node.sourcePath,
              points: node.points,
              expectedPoints: [1, 2].map((index) => {
                const point = new DOMPoint(
                  Number(source.getAttribute(`x${index}`)),
                  Number(source.getAttribute(`y${index}`)),
                ).matrixTransform(matrix);
                return {
                  x: round(point.x - deckRect.left),
                  y: round(point.y - deckRect.top),
                };
              }),
            };
          }
          const bounds = source.getBBox();
          const matrix = source.getScreenCTM();
          const center = new DOMPoint(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2,
          ).matrixTransform(matrix);
          const scale = Math.hypot(matrix.a, matrix.b);
          return {
            sourcePath: node.sourcePath,
            rotation: node.rotation,
            bounds: node.bounds,
            expectedBounds: {
              x: round(center.x - deckRect.left - bounds.width * scale / 2),
              y: round(center.y - deckRect.top - bounds.height * scale / 2),
              width: round(bounds.width * scale),
              height: round(bounds.height * scale),
            },
          };
        }),
      };
    });
    expect(geometry.diagnostics).toEqual([]);
    expect(geometry.order).toEqual(Array.from({ length: 25 }, (_, index) => index));
    expect(geometry.uniqueSources).toBe(25);
    for (const entry of geometry.entries) {
      if (entry.points) {
        expect(entry.points, entry.sourcePath).toEqual(entry.expectedPoints);
      } else {
        expect(entry.rotation, entry.sourcePath).toBe(12);
        expect(entry.bounds, entry.sourcePath).toEqual(entry.expectedBounds);
      }
    }
  } finally {
    await harness.close();
  }
});

test("accepts only the bundled state diagram aliases and routes their actual SVG root", async ({ page }) => {
  const harness = await startHarness({ slides: ["# State aliases"] });
  try {
    await page.goto(harness.url);
    const aliases = await page.evaluate(async () => {
      window.mermaid.initialize({
        startOnLoad: false,
        theme: "default",
        securityLevel: "strict",
      });
      const results = {};
      for (const alias of [
        "stateDiagram-v2",
        "stateDiagram",
        "stateDiagram-beta",
        "stateDiagram-v2-beta",
        "statediagram-v2",
      ]) {
        const source = `${alias}\n[*] --> Ready\nReady --> [*]`;
        try {
          await window.mermaid.parse(source);
          const { svg } = await window.mermaid.render(
            `state-alias-${alias.replace(/[^a-z0-9]+/gi, "-")}`,
            source,
          );
          const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
          results[alias] = {
            accepted: true,
            role: root.getAttribute("aria-roledescription"),
            class: root.getAttribute("class"),
            root: root.querySelector("g.root")?.getAttribute("class") || "",
            nodeClasses: [...root.querySelectorAll("g.nodes > g.node")]
              .map((node) => node.getAttribute("class")),
            marker: root.querySelector('marker[id$="stateDiagram-barbEnd"] > path')
              ?.getAttribute("d"),
          };
        } catch (_) {
          results[alias] = { accepted: false };
        }
      }
      return results;
    });
    const accepted = {
      accepted: true,
      role: "stateDiagram",
      class: "statediagram",
      root: "root",
      nodeClasses: ["node default", "node  statediagram-state", "node default"],
      marker: "M 19,7 L9,13 L14,7 L9,1 Z",
    };
    expect(aliases["stateDiagram-v2"]).toEqual(accepted);
    expect(aliases.stateDiagram).toEqual(accepted);
    expect(aliases["stateDiagram-beta"]).toEqual({ accepted: false });
    expect(aliases["stateDiagram-v2-beta"]).toEqual({ accepted: false });
    expect(aliases["statediagram-v2"]).toEqual({ accepted: false });
  } finally {
    await harness.close();
  }
});

test("accepts only the bundled ER diagram aliases and routes their actual SVG root", async ({ page }) => {
  const harness = await startHarness({ slides: ["# ER aliases"] });
  try {
    await page.goto(harness.url);
    const aliases = await page.evaluate(async () => {
      window.mermaid.initialize({
        startOnLoad: false,
        theme: "default",
        securityLevel: "strict",
      });
      const results = {};
      for (const alias of [
        "erDiagram",
        "erDiagram-beta",
        "ERDIAGRAM",
        "erdiagram",
        "er",
      ]) {
        const source = `${alias}\nA ||--o{ B : owns\nA {\n  string id PK\n}`;
        try {
          await window.mermaid.parse(source);
          const { svg } = await window.mermaid.render(
            `er-alias-${alias.replace(/[^a-z0-9]+/gi, "-")}`,
            source,
          );
          const root = new DOMParser()
            .parseFromString(svg, "image/svg+xml")
            .documentElement;
          results[alias] = {
            accepted: true,
            role: root.getAttribute("aria-roledescription"),
            class: root.getAttribute("class"),
            root: root.querySelector("g.root")?.getAttribute("class") || "",
            markers: [...root.querySelectorAll("marker.marker.er")]
              .map((marker) => marker.id.split("_er-").at(-1)),
            entities: [...root.querySelectorAll("g.nodes > g.node")]
              .map((entity) => entity.textContent.replace(/\s+/g, "")),
          };
        } catch (_) {
          results[alias] = { accepted: false };
        }
      }
      return results;
    });
    const accepted = {
      accepted: true,
      role: "er",
      class: "erDiagram",
      root: "root",
      markers: [
        "onlyOneStart",
        "onlyOneEnd",
        "zeroOrOneStart",
        "zeroOrOneEnd",
        "oneOrMoreStart",
        "oneOrMoreEnd",
        "zeroOrMoreStart",
        "zeroOrMoreEnd",
      ],
      entities: ["AstringidPK", "B"],
    };
    expect(aliases.erDiagram).toEqual(accepted);
    expect(aliases["erDiagram-beta"]).toEqual({
      ...accepted,
      entities: ["-beta", "AstringidPK", "B"],
    });
    expect(aliases.ERDIAGRAM).toEqual({ accepted: false });
    expect(aliases.erdiagram).toEqual({ accepted: false });
    expect(aliases.er).toEqual({ accepted: false });
  } finally {
    await harness.close();
  }
});

test("extracts pinned ER entities, rows, attributes, relations, labels and all cardinalities", async ({ page }) => {
  const harness = await startHarness({ slides: ["# ER fixture"] });
  try {
    await page.goto(harness.url);
    const result = await sceneFromFixture(
      page,
      await readFixture("er-basic.svg"),
      "er-basic.svg",
    );
    validateScene(result.scene);
    expect(result.diagnostics).toEqual([]);
    expect(result.scene.nodes.map((node) => node.z))
      .toEqual(Array.from({ length: 96 }, (_, index) => index));
    expect(result.scene.nodes.filter((node) => node.kind === "group")).toHaveLength(4);
    expect(result.scene.nodes.filter((node) => node.kind === "shape")).toHaveLength(21);
    expect(result.scene.nodes.filter((node) => node.kind === "connector")).toHaveLength(36);
    expect(result.scene.nodes.filter((node) => node.kind === "text")).toHaveLength(35);
    expect(result.scene.nodes.filter((node) => node.kind === "fallback")).toEqual([]);

    const relationGroups = result.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "er-marked-relation");
    const relations = result.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "er-relation");
    const terminals = result.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "er-terminal");
    expect(relationGroups).toHaveLength(4);
    expect(relations.map((node) => [
      node.meta.mermaid.identification,
      node.style.dash,
      node.style.lineCap,
      node.points.length,
      node.meta.mermaid.rawPointCount,
    ])).toEqual([
      ["identifying", "solid", "butt", 3, 29],
      ["non-identifying", "dash", "butt", 2, 33],
      ["identifying", "solid", "butt", 3, 35],
      ["non-identifying", "dash", "butt", 6, 239],
    ]);
    expect(terminals.map((node) => [
      node.sourcePath,
      node.kind,
      node.meta.mermaid.cardinality,
      node.meta.mermaid.placement,
      node.meta.mermaid.component,
      node.points?.length,
    ])).toEqual([
      ["relations[0].terminals.start[0]", "connector", "only-one", "start", "bar", 2],
      ["relations[0].terminals.start[1]", "connector", "only-one", "start", "bar", 2],
      ["relations[0].terminals.end[0]", "shape", "zero-or-one", "end", "circle", undefined],
      ["relations[0].terminals.end[1]", "connector", "zero-or-one", "end", "bar", 2],
      ["relations[1].terminals.start[0]", "shape", "zero-or-one", "start", "circle", undefined],
      ["relations[1].terminals.start[1]", "connector", "zero-or-one", "start", "bar", 2],
      ["relations[1].terminals.end[0]", "connector", "one-or-more", "end", "bar", 2],
      ["relations[1].terminals.end[1]", "connector", "one-or-more", "end", "crow-foot", 33],
      ["relations[2].terminals.start[0]", "connector", "one-or-more", "start", "crow-foot", 33],
      ["relations[2].terminals.start[1]", "connector", "one-or-more", "start", "bar", 2],
      ["relations[2].terminals.end[0]", "shape", "zero-or-more", "end", "circle", undefined],
      ["relations[2].terminals.end[1]", "connector", "zero-or-more", "end", "crow-foot", 33],
      ["relations[3].terminals.start[0]", "shape", "zero-or-more", "start", "circle", undefined],
      ["relations[3].terminals.start[1]", "connector", "zero-or-more", "start", "crow-foot", 33],
      ["relations[3].terminals.end[0]", "connector", "only-one", "end", "bar", 2],
      ["relations[3].terminals.end[1]", "connector", "only-one", "end", "bar", 2],
    ]);
    expect(terminals.filter((node) => node.kind === "shape").map((node) => [
      node.preset,
      node.style.fill,
      node.style.stroke,
      node.style.strokeWidth,
    ])).toEqual(Array(4).fill([
      "ellipse",
      "rgb(255, 255, 255)",
      "rgb(51, 51, 51)",
      0.4,
    ]));
    expect(terminals.filter((node) =>
      node.meta.mermaid.component === "crow-foot").every((node) =>
      node.style.lineCap === "butt" &&
      node.points[0].x === node.points.at(-1).x &&
      node.points[0].y === node.points.at(-1).y)).toBe(true);
    expect(terminals.map((node) => node.bounds)).toEqual([
      { x: 137.7, y: 44.6, width: 2.9, height: 7.2 },
      { x: 140.1, y: 43.7, width: 2.9, height: 7.2 },
      { x: 170.5, y: 37.8, width: 5.2, height: 5.2 },
      { x: 178.3, y: 36.5, width: 0, height: 7.7 },
      { x: 312.4, y: 37.8, width: 5.2, height: 5.2 },
      { x: 309.9, y: 36.5, width: 0, height: 7.7 },
      { x: 350.6, y: 36.5, width: 0, height: 7.7 },
      { x: 353.2, y: 36.5, width: 15.5, height: 7.7 },
      { x: 478.3, y: 36.5, width: 15.6, height: 7.7 },
      { x: 496.5, y: 36.5, width: 0, height: 7.7 },
      { x: 528.8, y: 45.1, width: 5.2, height: 5.2 },
      { x: 536.1, y: 48.7, width: 14.2, height: 8.5 },
      { x: 528.8, y: 101.8, width: 5.2, height: 5.2 },
      { x: 536.1, y: 95, width: 14.2, height: 8.4 },
      { x: 140.1, y: 101.3, width: 2.9, height: 7.2 },
      { x: 137.7, y: 100.3, width: 2.9, height: 7.2 },
    ]);
    expect(relations[3].points[0].x).toBeGreaterThan(relations[3].points.at(-1).x);

    const boxes = result.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "er-entity-box");
    const rows = result.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "er-attribute-row");
    const dividers = result.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "er-divider");
    expect(boxes.map((node) => node.bounds)).toEqual([
      { x: 3.5, y: 38, width: 132.1, height: 76.1 },
      { x: 182.2, y: 21.9, width: 123.8, height: 36.9 },
      { x: 361, y: 3.5, width: 125.1, height: 73.8 },
      { x: 543.2, y: 39.2, width: 104.7, height: 73.8 },
    ]);
    expect(rows.map((node) => [
      node.meta.mermaid.entity,
      node.meta.mermaid.row,
      node.meta.mermaid.parity,
      node.bounds.height,
    ])).toEqual([
      [0, 0, "odd", 28.8],
      [0, 1, "even", 18.5],
      [1, 0, "odd", 18.5],
      [2, 0, "odd", 18.5],
      [2, 1, "even", 18.5],
      [2, 2, "odd", 18.5],
      [3, 0, "odd", 18.5],
      [3, 1, "even", 18.5],
      [3, 2, "odd", 18.5],
    ]);
    expect(dividers).toHaveLength(20);
    expect(dividers.filter((node) =>
      node.meta.mermaid.orientation === "horizontal")).toHaveLength(8);
    expect(dividers.filter((node) =>
      node.meta.mermaid.orientation === "vertical")).toHaveLength(12);

    const textOf = (node) => node.text.paragraphs
      .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
      .join("\n");
    expect(result.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "er-entity-name").map(textOf)).toEqual([
      "顧客\nAccount",
      "PROFILE",
      "ORDER",
      "LINE_ITEM",
    ]);
    expect(result.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "er-attribute-keys").map(textOf)).toEqual([
      "PK",
      "UK",
      "PK,FK",
      "PK",
      "FK",
      "UK",
      "PK",
      "FK",
    ]);
    expect(result.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "er-attribute-comment").map(textOf)).toEqual([
      "顧客 ID\nprimary",
      "表示名",
      "owner",
      "external",
      "明細",
    ]);
    expect(result.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "edge-label").map(textOf)).toEqual([
      "has\n所有",
      "opens\n注文",
      "contains",
      "belongs",
    ]);

    const geometry = await page.evaluate(async () => {
      const { mermaidSvgToScene } = await import("./renderer/mermaid-scene.mjs");
      const deck = document.querySelector("#fixture-deck");
      const result = mermaidSvgToScene(deck.querySelector("svg"), {
        deck,
        includeSourceElements: true,
      });
      const deckRect = deck.getBoundingClientRect();
      const round = (value) => Math.round(value * 10) / 10;
      const relationErrors = result.scene.nodes
        .filter((node) => node.meta?.mermaid?.kind === "er-relation")
        .map((node) => {
          const source = result.sourceElements.get(node.sourcePath);
          const count = Math.max(2, Math.round(source.getTotalLength() / 4) + 1);
          const samples = Array.from({ length: count }, (_, index) => {
            const point = source.getPointAtLength(
              source.getTotalLength() * index / (count - 1),
            );
            const screen = new DOMPoint(point.x, point.y)
              .matrixTransform(source.getScreenCTM());
            return {
              x: round(screen.x - deckRect.left),
              y: round(screen.y - deckRect.top),
            };
          });
          const error = (point) => Math.min(...node.points.slice(1).map((end, index) => {
            const start = node.points[index];
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const denominator = dx * dx + dy * dy;
            const t = denominator === 0 ? 0 : Math.max(0, Math.min(
              1,
              ((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator,
            ));
            return Math.hypot(
              point.x - start.x - t * dx,
              point.y - start.y - t * dy,
            );
          }));
          return {
            sourcePath: node.sourcePath,
            maxError: Math.max(...samples.map(error)),
          };
        });
      const selectedBounds = result.scene.nodes
        .filter((node) => [
          "entities[0].box",
          "entities[0].rows[0]",
          "entities[0].name",
          "entities[0].attributes[0].comment",
        ].includes(node.sourcePath))
        .map((node) => {
          const source = result.sourceElements.get(node.sourcePath);
          const rect = source.getBoundingClientRect();
          return {
            sourcePath: node.sourcePath,
            bounds: node.bounds,
            expected: {
              x: round(rect.left - deckRect.left),
              y: round(rect.top - deckRect.top),
              width: round(rect.width),
              height: round(rect.height),
            },
            ctm: Object.fromEntries(["a", "b", "c", "d"].map((key) => [
              key,
              round(source.getScreenCTM()[key]),
            ])),
          };
        });
      return {
        relationErrors,
        selectedBounds,
        markers: [...deck.querySelectorAll("marker.marker.er")].map((marker) => ({
          name: marker.id.split("_er-").at(-1),
          class: marker.getAttribute("class"),
          markerUnits: marker.getAttribute("markerUnits"),
          viewBox: marker.getAttribute("viewBox"),
          preserveAspectRatio: marker.getAttribute("preserveAspectRatio"),
          markerWidth: Number(marker.getAttribute("markerWidth")),
          markerHeight: Number(marker.getAttribute("markerHeight")),
          refX: Number(marker.getAttribute("refX")),
          refY: Number(marker.getAttribute("refY")),
          orient: marker.getAttribute("orient"),
          overflow: getComputedStyle(marker).overflow,
          children: [...marker.children].map((child) => {
            const style = getComputedStyle(child);
            return {
              tag: child.localName,
              d: child.getAttribute("d"),
              circle: ["cx", "cy", "r"].map((name) =>
                child.hasAttribute(name) ? Number(child.getAttribute(name)) : null),
              fill: style.fill,
              stroke: style.stroke,
              strokeWidth: style.strokeWidth,
              lineCap: style.strokeLinecap,
              lineJoin: style.strokeLinejoin,
            };
          }),
        })),
        terminalOwnership: result.scene.nodes
          .filter((node) => node.meta?.mermaid?.kind === "er-terminal")
          .map((node) => {
            const relationPath = node.sourcePath.split(".terminals.")[0];
            return result.sourceElements.get(node.sourcePath) ===
              result.sourceElements.get(relationPath);
          }),
        uniqueSourcePaths: new Set(result.scene.nodes.map((node) =>
          node.sourcePath)).size,
        mappedSources: result.scene.nodes.map((node) => ({
          sourcePath: node.sourcePath,
          tag: result.sourceElements.get(node.sourcePath)?.localName,
        })),
      };
    });
    for (const error of geometry.relationErrors) {
      expect(error.maxError, error.sourcePath).toBeLessThanOrEqual(2);
    }
    for (const entry of geometry.selectedBounds) {
      expect(entry.bounds, entry.sourcePath).toEqual(entry.expected);
      expect(entry.ctm).toEqual({ a: 0.4, b: 0, c: 0, d: 0.4 });
    }
    expect(geometry.terminalOwnership).toEqual(Array(16).fill(true));
    expect(geometry.uniqueSourcePaths).toBe(result.scene.nodes.length);
    expect(geometry.markers.map((marker) => [
      marker.name,
      marker.markerUnits,
      marker.viewBox,
      marker.preserveAspectRatio,
      marker.markerWidth,
      marker.markerHeight,
      marker.refX,
      marker.refY,
      marker.orient,
      marker.overflow,
    ])).toEqual([
      ["onlyOneStart", null, null, null, 18, 18, 0, 9, "auto", "hidden"],
      ["onlyOneEnd", null, null, null, 18, 18, 18, 9, "auto", "hidden"],
      ["zeroOrOneStart", null, null, null, 30, 18, 0, 9, "auto", "hidden"],
      ["zeroOrOneEnd", null, null, null, 30, 18, 30, 9, "auto", "hidden"],
      ["oneOrMoreStart", null, null, null, 45, 36, 18, 18, "auto", "hidden"],
      ["oneOrMoreEnd", null, null, null, 45, 36, 27, 18, "auto", "hidden"],
      ["zeroOrMoreStart", null, null, null, 57, 36, 18, 18, "auto", "hidden"],
      ["zeroOrMoreEnd", null, null, null, 57, 36, 39, 18, "auto", "hidden"],
    ]);
    expect(geometry.markers.flatMap((marker) => marker.children).every((child) =>
      child.stroke === "rgb(51, 51, 51)" &&
      child.strokeWidth === "1px" &&
      child.lineCap === "butt" &&
      child.lineJoin === "miter")).toBe(true);
    expect(geometry.markers.flatMap((marker) => marker.children)
      .filter((child) => child.tag === "circle")
      .map((child) => [child.circle, child.fill])).toEqual([
        [[21, 9, 6], "rgb(255, 255, 255)"],
        [[9, 9, 6], "rgb(255, 255, 255)"],
        [[48, 18, 6], "rgb(255, 255, 255)"],
        [[9, 18, 6], "rgb(255, 255, 255)"],
      ]);
    expect(geometry.mappedSources.every((entry) => entry.tag)).toBe(true);
    expect(geometry.mappedSources.filter((entry) =>
      entry.sourcePath.includes(".terminals.")).every((entry) =>
      entry.tag === "path")).toBe(true);

    const mapped = sceneToPptxElements(result.scene);
    expect(mapped.fallbacks).toEqual([]);
    expect(mapped.elements.filter((element) => element.type === "shape")).toHaveLength(21);
    expect(mapped.elements.filter((element) => element.type === "connector")).toHaveLength(36);
    expect(mapped.elements.filter((element) => element.type === "text")).toHaveLength(35);
    const buffer = buildPptxPackage({ slides: [{ elements: mapped.elements }] });
    expect(inspectPptxPackage(buffer).valid).toBe(true);
    const xml = buffer.toString("utf8");
    const lineCount = mapped.elements
      .filter((element) => element.type === "connector")
      .reduce((sum, element) => sum + element.points.length - 1, 0);
    expect((xml.match(/<a:prstGeom prst="line">/g) || [])).toHaveLength(lineCount);
    expect((xml.match(/<a:ln w="\d+" cap="flat">/g) || [])).toHaveLength(lineCount);
    expect((xml.match(/<a:prstGeom prst="ellipse">/g) || [])).toHaveLength(4);
    expect(xml).not.toMatch(/<a:(?:headEnd|tailEnd)\b/);
    expect(xml).toContain("顧客");
    expect(xml).toContain("明細");
  } finally {
    await harness.close();
  }
});

test("keeps ER relation, terminal and circle paint independent in native DrawingML", async ({ page }) => {
  const harness = await startHarness({ slides: ["# ER paint"] });
  try {
    await page.goto(harness.url);
    await sceneFromFixture(page, await readFixture("er-basic.svg"), "er-paint.svg");
    const result = await updateFixture(page, () => {
      const relation = document.querySelector("path.relationshipLine");
      relation.style.stroke = "rgba(12, 34, 56, 0.5)";
      relation.style.strokeOpacity = "0.4";
      const start = document.querySelector('[id$="_er-onlyOneStart"] > path');
      start.style.setProperty("stroke", "rgba(90, 80, 70, 0.5)", "important");
      start.style.strokeOpacity = "0.8";
      const end = document.querySelector('[id$="_er-zeroOrOneEnd"]');
      const circle = end.querySelector("circle");
      circle.style.setProperty("fill", "rgba(20, 40, 60, 0.5)", "important");
      circle.style.setProperty("stroke", "rgba(80, 100, 120, 0.5)", "important");
      circle.style.fillOpacity = "0.6";
      circle.style.strokeOpacity = "0.8";
      circle.style.opacity = "0.7";
      const bar = end.querySelector("path");
      bar.style.setProperty("stroke", "rgb(130, 140, 150)", "important");
    });
    expect(result.diagnostics).toEqual([]);
    const relation = result.scene.nodes.find((node) =>
      node.sourcePath === "relations[0].line");
    expect(relation.style).toMatchObject({
      stroke: "rgba(12, 34, 56, 0.5)",
      strokeOpacity: 0.4,
      lineCap: "butt",
    });
    const startBars = result.scene.nodes.filter((node) =>
      node.sourcePath.startsWith("relations[0].terminals.start"));
    expect(startBars).toHaveLength(2);
    expect(startBars.every((node) =>
      node.style.stroke === "rgba(90, 80, 70, 0.5)" &&
      node.style.strokeOpacity === 0.8)).toBe(true);
    const circle = result.scene.nodes.find((node) =>
      node.sourcePath === "relations[0].terminals.end[0]");
    expect(circle).toMatchObject({
      kind: "shape",
      preset: "ellipse",
      style: {
        fill: "rgba(20, 40, 60, 0.5)",
        stroke: "rgba(80, 100, 120, 0.5)",
        opacity: 0.7,
        fillOpacity: 0.6,
        strokeOpacity: 0.8,
      },
    });
    const endBar = result.scene.nodes.find((node) =>
      node.sourcePath === "relations[0].terminals.end[1]");
    expect(endBar.style.stroke).toBe("rgb(130, 140, 150)");
    expect(relation.z).toBeLessThan(startBars[0].z);
    expect(startBars[1].z).toBeLessThan(circle.z);
    expect(circle.z).toBeLessThan(endBar.z);

    const mapped = sceneToPptxElements(result.scene);
    expect(mapped.fallbacks).toEqual([]);
    const xml = buildPptxPackage({
      slides: [{ elements: mapped.elements }],
    }).toString("utf8");
    expect(xml).toContain('<a:srgbClr val="0C2238"><a:alpha val="20000"/></a:srgbClr>');
    expect(xml).toContain('<a:srgbClr val="5A5046"><a:alpha val="40000"/></a:srgbClr>');
    expect(xml).toContain('<a:srgbClr val="14283C"><a:alpha val="21000"/></a:srgbClr>');
    expect(xml).toContain('<a:srgbClr val="506478"><a:alpha val="28000"/></a:srgbClr>');
    expect(xml).toContain('prst="ellipse"');
  } finally {
    await harness.close();
  }
});

test("rejects CSS-computed ER circle and path marker geometry without consuming siblings", async ({ page }) => {
  const harness = await startHarness({ slides: ["# ER CSS marker geometry"] });
  try {
    await page.goto(harness.url);
    const fixture = await readFixture("er-basic.svg");
    const cases = [
      {
        name: "circle radius",
        mutate: () => {
          document.querySelector('[id$="_er-zeroOrOneEnd"] circle')
            .style.r = "12px";
        },
        geometry: () => {
          const circle = document.querySelector(
            '[id$="_er-zeroOrOneEnd"] circle',
          );
          return {
            attribute: circle.getAttribute("r"),
            computed: getComputedStyle(circle).r,
          };
        },
        expected: { attribute: "6", computed: "12px" },
      },
      {
        name: "circle center x",
        mutate: () => {
          document.querySelector('[id$="_er-zeroOrOneEnd"] circle')
            .style.cx = "15px";
        },
        geometry: () => {
          const circle = document.querySelector(
            '[id$="_er-zeroOrOneEnd"] circle',
          );
          return {
            attribute: circle.getAttribute("cx"),
            computed: getComputedStyle(circle).cx,
          };
        },
        expected: { attribute: "9", computed: "15px" },
      },
      {
        name: "circle center y",
        mutate: () => {
          document.querySelector('[id$="_er-zeroOrOneEnd"] circle')
            .style.cy = "15px";
        },
        geometry: () => {
          const circle = document.querySelector(
            '[id$="_er-zeroOrOneEnd"] circle',
          );
          return {
            attribute: circle.getAttribute("cy"),
            computed: getComputedStyle(circle).cy,
          };
        },
        expected: { attribute: "9", computed: "15px" },
      },
      {
        name: "path data",
        mutate: () => {
          document.querySelector('[id$="_er-onlyOneStart"] path')
            .style.d = 'path("M0,0 L18,18")';
        },
        geometry: () => {
          const path = document.querySelector(
            '[id$="_er-onlyOneStart"] path',
          );
          return {
            attribute: path.getAttribute("d"),
            computed: getComputedStyle(path).d,
          };
        },
        expected: {
          attribute: "M9,0 L9,18 M15,0 L15,18",
          computed: 'path("M 0 0 L 18 18")',
        },
      },
    ];
    for (const entry of cases) {
      await sceneFromFixture(page, fixture, `er-css-${entry.name}.svg`);
      const result = await updateFixture(page, entry.mutate);
      expect(await page.evaluate(entry.geometry), entry.name)
        .toEqual(entry.expected);
      expect(result.diagnostics, entry.name).toEqual([{
        path: "relations[0]",
        kind: "fallback",
        reason: "unsupported-mermaid-er-terminal-geometry",
      }]);
      expect(result.scene.nodes.filter((node) => node.kind === "fallback"),
        entry.name).toMatchObject([{
        sourcePath: "relations[0]",
        reason: "unsupported-mermaid-er-terminal-geometry",
      }]);
      expect(result.scene.nodes.some((node) =>
        node.kind === "fallback" && node.sourcePath === "svg"),
      entry.name).toBe(false);
      expect(result.scene.nodes.filter((node) =>
        node.meta?.mermaid?.kind === "er-relation"),
      entry.name).toHaveLength(3);
      const terminals = result.scene.nodes.filter((node) =>
        node.meta?.mermaid?.kind === "er-terminal");
      expect(terminals, entry.name).toHaveLength(12);
      expect(terminals.some((node) =>
        node.sourcePath.startsWith("relations[0].terminals.")),
      entry.name).toBe(false);
      expect(new Set(terminals.map((node) => node.sourcePath)).size,
        entry.name).toBe(12);
      expect(result.scene.nodes.filter((node) =>
        node.meta?.mermaid?.kind === "edge-label"),
      entry.name).toHaveLength(4);
      expect(result.scene.nodes.some((node) =>
        node.meta?.mermaid?.kind === "edge-label" &&
        node.meta.mermaid.edgeId ===
          "id_entity-ACCOUNT-0_entity-PROFILE-1_0"),
      entry.name).toBe(true);
      expect(result.scene.nodes.filter((node) =>
        node.meta?.mermaid?.kind === "er-entity-box"),
      entry.name).toHaveLength(4);
      expect(result.sources.find((source) =>
        source.path === "relations[0]"),
      entry.name).toMatchObject({ tag: "path" });
      expect(sceneToPptxElements(result.scene).fallbacks.map((fallback) => ({
        sourcePath: fallback.sourcePath,
        reason: fallback.reason,
      })), entry.name).toEqual([{
        sourcePath: "relations[0]",
        reason: "unsupported-mermaid-er-terminal-geometry",
      }]);
    }
  } finally {
    await harness.close();
  }
});

test("keeps malformed ER entities, rows, text, relations and terminals at local fallback boundaries", async ({ page }) => {
  const harness = await startHarness({ slides: ["# ER fallback boundaries"] });
  try {
    await page.goto(harness.url);
    const fixture = await readFixture("er-basic.svg");
    const cases = [
      {
        name: "malformed entity",
        mutate: () => {
          document.querySelector("g.node .attribute-name").remove();
        },
        fallback: {
          sourcePath: "entities[0]",
          reason: "unsupported-mermaid-er-entity-structure",
        },
        relationCount: 4,
        terminalCount: 16,
        rowCount: 7,
        textCount: 26,
        sourceTag: "g",
      },
      {
        name: "row effect",
        mutate: () => {
          document.querySelector("g.row-rect-odd").style.filter = "blur(1px)";
        },
        fallback: {
          sourcePath: "entities[0].rows[0]",
          reason: "unsupported-mermaid-er-row-style",
        },
        relationCount: 4,
        terminalCount: 16,
        rowCount: 8,
        textCount: 35,
        sourceTag: "g",
      },
      {
        name: "row transform",
        mutate: () => {
          document.querySelector("g.row-rect-even")
            .setAttribute("transform", "skewX(8)");
        },
        fallback: {
          sourcePath: "entities[0].rows[1]",
          reason: "unsupported-mermaid-er-row-transform",
        },
        relationCount: 4,
        terminalCount: 16,
        rowCount: 8,
        textCount: 35,
        sourceTag: "g",
      },
      {
        name: "row clip",
        mutate: () => {
          document.querySelector("g.row-rect-odd")
            .style.clipPath = "circle(50%)";
        },
        fallback: {
          sourcePath: "entities[0].rows[0]",
          reason: "unsupported-mermaid-er-row-style",
        },
        relationCount: 4,
        terminalCount: 16,
        rowCount: 8,
        textCount: 35,
        sourceTag: "g",
      },
      {
        name: "entity decoration",
        mutate: () => {
          document.querySelector("g.nodes > g.node").insertAdjacentHTML(
            "beforeend",
            '<circle cx="0" cy="0" r="5" fill="red"/>',
          );
        },
        fallback: {
          sourcePath: "entities[0].decorations[0]",
          reason: "unsupported-mermaid-er-entity-decoration",
        },
        relationCount: 4,
        terminalCount: 16,
        rowCount: 9,
        textCount: 35,
        sourceTag: "circle",
      },
      {
        name: "entity box geometry",
        mutate: () => {
          document.querySelector("g.outer-path > path")
            .setAttribute("d", "M0 0 L10 10");
        },
        fallback: {
          sourcePath: "entities[0].box",
          reason: "unsupported-mermaid-er-entity-geometry",
        },
        relationCount: 4,
        terminalCount: 16,
        rowCount: 9,
        textCount: 35,
        sourceTag: "g",
      },
      {
        name: "divider geometry",
        mutate: () => {
          document.querySelector("g.divider > path")
            .setAttribute("d", "M0 0 L10 10");
        },
        fallback: {
          sourcePath: "entities[0].dividers[0]",
          reason: "unsupported-mermaid-er-divider-geometry",
        },
        relationCount: 4,
        terminalCount: 16,
        rowCount: 9,
        textCount: 35,
        sourceTag: "g",
      },
      {
        name: "decorated comment",
        mutate: () => {
          document.querySelector("g.attribute-comment div")
            .style.backgroundColor = "red";
        },
        fallback: {
          sourcePath: "entities[0].attributes[0].comment",
          reason: "unsupported-mermaid-er-text",
        },
        relationCount: 4,
        terminalCount: 16,
        rowCount: 9,
        textCount: 34,
        sourceTag: "g",
      },
      {
        name: "multiple relation subpaths",
        mutate: () => {
          const relation = document.querySelectorAll("path.relationshipLine")[1];
          relation.setAttribute("d", `${relation.getAttribute("d")} M0 0 L1 1`);
        },
        fallback: {
          sourcePath: "relations[1]",
          reason: "unsupported-mermaid-er-relation-path",
        },
        relationCount: 3,
        terminalCount: 12,
        rowCount: 9,
        textCount: 35,
        sourceTag: "path",
      },
      {
        name: "relation transform",
        mutate: () => {
          document.querySelectorAll("path.relationshipLine")[1]
            .setAttribute("transform", "skewX(8)");
        },
        fallback: {
          sourcePath: "relations[1]",
          reason: "unsupported-mermaid-er-relation-transform",
        },
        relationCount: 3,
        terminalCount: 12,
        rowCount: 9,
        textCount: 35,
        sourceTag: "path",
      },
      {
        name: "relation style",
        mutate: () => {
          document.querySelectorAll("path.relationshipLine")[1]
            .style.strokeLinejoin = "round";
        },
        fallback: {
          sourcePath: "relations[1]",
          reason: "unsupported-mermaid-er-relation-style",
        },
        relationCount: 3,
        terminalCount: 12,
        rowCount: 9,
        textCount: 35,
        sourceTag: "path",
      },
      {
        name: "unknown terminal geometry",
        mutate: () => {
          document.querySelector('[id$="_er-onlyOneStart"] > path')
            .setAttribute("d", "M0 0 L5 5");
        },
        fallback: {
          sourcePath: "relations[0]",
          reason: "unsupported-mermaid-er-terminal-geometry",
        },
        relationCount: 3,
        terminalCount: 12,
        rowCount: 9,
        textCount: 35,
        sourceTag: "path",
      },
      {
        name: "terminal effect",
        mutate: () => {
          document.querySelector('[id$="_er-zeroOrOneEnd"]')
            .style.filter = "blur(1px)";
        },
        fallback: {
          sourcePath: "relations[0]",
          reason: "unsupported-mermaid-er-terminal-style",
        },
        relationCount: 3,
        terminalCount: 12,
        rowCount: 9,
        textCount: 35,
        sourceTag: "path",
      },
      {
        name: "terminal paint",
        mutate: () => {
          document.querySelector('[id$="_er-onlyOneStart"] > path')
            .style.setProperty("fill", "red", "important");
        },
        fallback: {
          sourcePath: "relations[0]",
          reason: "unsupported-mermaid-er-terminal-style",
        },
        relationCount: 3,
        terminalCount: 12,
        rowCount: 9,
        textCount: 35,
        sourceTag: "path",
      },
      {
        name: "terminal transform",
        mutate: () => {
          document.querySelector('[id$="_er-onlyOneStart"] > path')
            .style.transform = "rotate(10deg)";
        },
        fallback: {
          sourcePath: "relations[0]",
          reason: "unsupported-mermaid-er-terminal-style",
        },
        relationCount: 3,
        terminalCount: 12,
        rowCount: 9,
        textCount: 35,
        sourceTag: "path",
      },
      {
        name: "terminal units",
        mutate: () => {
          document.querySelector('[id$="_er-zeroOrOneEnd"]')
            .setAttribute("markerUnits", "userSpaceOnUse");
        },
        fallback: {
          sourcePath: "relations[0]",
          reason: "unsupported-mermaid-er-terminal-geometry",
        },
        relationCount: 3,
        terminalCount: 12,
        rowCount: 9,
        textCount: 35,
        sourceTag: "path",
      },
      {
        name: "crow foot alpha",
        mutate: () => {
          document.querySelector('[id$="_er-oneOrMoreEnd"] > path')
            .style.opacity = "0.5";
        },
        fallback: {
          sourcePath: "relations[1]",
          reason: "unsupported-mermaid-er-terminal-compositing",
        },
        relationCount: 3,
        terminalCount: 12,
        rowCount: 9,
        textCount: 35,
        sourceTag: "path",
      },
      {
        name: "relation opacity",
        mutate: () => {
          document.querySelectorAll("path.relationshipLine")[1]
            .style.opacity = "0.5";
        },
        fallback: {
          sourcePath: "relations[1]",
          reason: "unsupported-mermaid-er-terminal-compositing",
        },
        relationCount: 3,
        terminalCount: 12,
        rowCount: 9,
        textCount: 35,
        sourceTag: "path",
      },
    ];
    for (const entry of cases) {
      await sceneFromFixture(page, fixture, `er-${entry.name}.svg`);
      const result = await updateFixture(page, entry.mutate);
      expect(result.scene.nodes.filter((node) => node.kind === "fallback"),
        entry.name).toMatchObject([entry.fallback]);
      expect(result.scene.nodes.filter((node) =>
        node.meta?.mermaid?.kind === "er-relation"),
      entry.name).toHaveLength(entry.relationCount);
      expect(result.scene.nodes.filter((node) =>
        node.meta?.mermaid?.kind === "er-terminal"),
      entry.name).toHaveLength(entry.terminalCount);
      expect(result.scene.nodes.filter((node) =>
        node.meta?.mermaid?.kind === "er-attribute-row"),
      entry.name).toHaveLength(entry.rowCount);
      expect(result.scene.nodes.filter((node) => node.kind === "text"),
        entry.name).toHaveLength(entry.textCount);
      expect(result.scene.nodes.filter((node) =>
        node.meta?.mermaid?.kind === "edge-label"),
      entry.name).toHaveLength(4);
      expect(result.sources.find((source) =>
        source.path === entry.fallback.sourcePath),
      entry.name).toMatchObject({ tag: entry.sourceTag });
      expect(sceneToPptxElements(result.scene).fallbacks.map((fallback) => ({
        sourcePath: fallback.sourcePath,
        reason: fallback.reason,
      })), entry.name).toEqual([entry.fallback]);
    }
  } finally {
    await harness.close();
  }
});

test("rejects malformed and excessive ER structures explicitly", async ({ page }) => {
  test.setTimeout(180_000);
  const harness = await startHarness({ slides: ["# ER limits"] });
  try {
    await page.goto(harness.url);
    const fixture = await readFixture("er-basic.svg");

    await sceneFromFixture(page, fixture, "er-malformed-root.svg");
    const malformed = await updateFixture(page, () => {
      const root = document.querySelector("g.root");
      root.append(root.querySelector(":scope > g.edgePaths").cloneNode(true));
    });
    expect(malformed.scene.nodes).toMatchObject([{
      kind: "fallback",
      sourcePath: "svg",
      reason: "unsupported-mermaid-er-structure",
    }]);

    await sceneFromFixture(page, fixture, "er-depth.svg");
    const depth = await updateFixture(page, () => {
      let root = document.createElementNS("http://www.w3.org/2000/svg", "g");
      root.setAttribute("class", "label");
      document.querySelector("g.root").append(root);
      for (let index = 0; index < 17; index += 1) {
        const child = document.createElementNS("http://www.w3.org/2000/svg", "g");
        child.setAttribute("class", "label");
        root.append(child);
        root = child;
      }
      root.insertAdjacentHTML(
        "beforeend",
        '<circle cx="20" cy="20" r="5" fill="red"/>',
      );
    });
    expect(depth.scene.nodes.filter((node) =>
      node.reason === "unsupported-mermaid-er-depth")).toHaveLength(1);
    expect(depth.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "er-relation")).toHaveLength(4);
    expect(depth.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "er-entity-box")).toHaveLength(4);

    await sceneFromFixture(page, fixture, "er-text-limit.svg");
    const textLimit = await updateFixture(page, () => {
      document.querySelector("g.label.name p").innerHTML =
        Array.from({ length: 201 }, (_, index) => `line-${index}`).join("<br>");
    });
    expect(textLimit.scene.nodes).toMatchObject([{
      kind: "fallback",
      sourcePath: "svg",
      reason: expect.stringContaining("mermaid-scene-limit-exceeded"),
    }]);

    await sceneFromFixture(page, fixture, "er-node-limit.svg");
    const nodeLimit = await updateFixture(page, () => {
      const svg = document.querySelector("svg");
      const fragment = document.createDocumentFragment();
      for (let index = 0; index < 4100; index += 1) {
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", String(index % 100));
        text.setAttribute("y", String(20 + index % 50));
        text.textContent = `x${index}`;
        fragment.append(text);
      }
      svg.append(fragment);
    });
    expect(nodeLimit.scene.nodes).toMatchObject([{
      kind: "fallback",
      sourcePath: "svg",
      reason: expect.stringContaining("mermaid-scene-limit-exceeded"),
    }]);

    await sceneFromFixture(page, fixture, "er-element-limit.svg");
    const elementLimit = await updateFixture(page, () => {
      document.querySelector("svg").insertAdjacentHTML(
        "beforeend",
        "<desc></desc>".repeat(40001),
      );
    });
    expect(elementLimit.scene.nodes).toMatchObject([{
      kind: "fallback",
      sourcePath: "svg",
      reason: "mermaid-scene-limit-exceeded: SVG element count",
    }]);
  } finally {
    await harness.close();
  }
});

test("accepts only bundled requirement aliases, fields and relations", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Requirement grammar"] });
  try {
    await page.goto(harness.url);
    const result = await page.evaluate(async () => {
      window.mermaid.initialize({
        startOnLoad: false,
        theme: "default",
        securityLevel: "strict",
      });
      const render = async (id, source) => {
        try {
          await window.mermaid.parse(source);
          const { svg } = await window.mermaid.render(id, source);
          const root = new DOMParser()
            .parseFromString(svg, "image/svg+xml")
            .documentElement;
          return {
            accepted: true,
            role: root.getAttribute("aria-roledescription"),
            class: root.getAttribute("class"),
            root: root.querySelector("g.root")?.getAttribute("class") || "",
            markers: [...root.querySelectorAll("marker")].map((marker) =>
              marker.id.split("_requirement-").at(-1)),
            labels: [...root.querySelectorAll("g.edgeLabel span.edgeLabel")]
              .map((label) => label.textContent),
          };
        } catch (_) {
          return { accepted: false };
        }
      };
      const aliases = {};
      for (const alias of [
        "requirementDiagram",
        "requirementdiagram",
        "RequirementDiagram",
        "REQUIREMENTDIAGRAM",
        "requirementDiagram-beta",
        "requirementdiagram-beta",
        "requirement-diagram",
        "requirement",
      ]) {
        aliases[alias] = await render(
          `requirement-alias-${alias.replace(/[^a-z0-9]+/gi, "-")}`,
          [
            alias,
            "requirement req {",
            '  id: "REQ-1"',
            '  text: "Text"',
            "}",
            "element impl {",
            '  type: "Service"',
            '  docRef: "docs/ref"',
            "}",
            "impl - satisfies -> req",
          ].join("\n"),
        );
      }
      const requirementFields = {};
      for (const [field, value] of [
        ["id", '"REQ-1"'],
        ["ID", '"REQ-1"'],
        ["text", '"Text"'],
        ["TEXT", '"Text"'],
        ["risk", "high"],
        ["RISK", "high"],
        ["verifyMethod", "test"],
        ["verifymethod", "test"],
        ["VERIFYMETHOD", "test"],
        ["verificationMethod", "test"],
        ["verificationmethod", "test"],
      ]) {
        requirementFields[field] = (await render(
          `requirement-field-${field}`,
          [
            "requirementDiagram",
            "requirement req {",
            `  ${field}: ${value}`,
            "}",
          ].join("\n"),
        )).accepted;
      }
      const elementFields = {};
      for (const field of [
        "type",
        "TYPE",
        "docRef",
        "docref",
        "DOCREF",
        "documentRef",
        "documentReference",
      ]) {
        elementFields[field] = (await render(
          `requirement-element-field-${field}`,
          [
            "requirementDiagram",
            "element impl {",
            `  ${field}: "Value"`,
            "}",
          ].join("\n"),
        )).accepted;
      }
      const riskValues = {};
      for (const value of [
        "low",
        "MEDIUM",
        "High",
        "critical",
        '"high"',
      ]) {
        riskValues[value] = (await render(
          `requirement-risk-${value.replace(/[^a-z0-9]+/gi, "-")}`,
          [
            "requirementDiagram",
            "requirement req {",
            `  risk: ${value}`,
            "}",
          ].join("\n"),
        )).accepted;
      }
      const verificationValues = {};
      for (const value of [
        "analysis",
        "INSPECTION",
        "Test",
        "demonstration",
        "review",
        '"test"',
      ]) {
        verificationValues[value] = (await render(
          `requirement-verification-${value.replace(/[^a-z0-9]+/gi, "-")}`,
          [
            "requirementDiagram",
            "requirement req {",
            `  verifymethod: ${value}`,
            "}",
          ].join("\n"),
        )).accepted;
      }
      const emptyValues = {};
      for (const [kind, field] of [
        ["requirement", "id"],
        ["requirement", "text"],
        ["element", "type"],
        ["element", "docRef"],
      ]) {
        emptyValues[`${kind}.${field}`] = (await render(
          `requirement-empty-${kind}-${field}`,
          [
            "requirementDiagram",
            `${kind} item {`,
            `  ${field}:`,
            "}",
          ].join("\n"),
        )).accepted;
      }
      const relations = {};
      for (const relation of [
        "contains",
        "copies",
        "derives",
        "satisfies",
        "verifies",
        "refines",
        "traces",
        "Contains",
        "COPIES",
        "fulfills",
      ]) {
        relations[relation] = await render(
          `requirement-relation-${relation}`,
          [
            "requirementDiagram",
            "requirement left {",
            '  text: "Left"',
            "}",
            "requirement right {",
            '  text: "Right"',
            "}",
            `left - ${relation} -> right`,
          ].join("\n"),
        );
      }
      const relationSyntax = {};
      for (const form of [
        "left - copies -> right",
        "right <- copies - left",
        "left <- copies -> right",
        "left - copies - right",
      ]) {
        relationSyntax[form] = await render(
          `requirement-relation-form-${
            Object.keys(relationSyntax).length
          }`,
          [
            "requirementDiagram",
            "requirement left {",
            '  text: "Left"',
            "}",
            "requirement right {",
            '  text: "Right"',
            "}",
            form,
          ].join("\n"),
        );
      }
      const directions = {};
      for (const direction of ["LR", "RL", "TB", "BT"]) {
        directions[direction] = (await render(
          `requirement-direction-${direction}`,
          [
            "requirementDiagram",
            `direction ${direction}`,
            "requirement req {",
            '  text: "Text"',
            "}",
          ].join("\n"),
        )).accepted;
      }
      return {
        aliases,
        requirementFields,
        elementFields,
        riskValues,
        verificationValues,
        emptyValues,
        relations,
        relationSyntax,
        directions,
      };
    });

    const accepted = {
      accepted: true,
      role: "requirement",
      class: "requirementDiagram",
      root: "root",
      markers: [
        "requirement_containsStart",
        "requirement_arrowEnd",
      ],
      labels: ["<<satisfies>>"],
    };
    expect(result.aliases.requirementDiagram).toEqual(accepted);
    expect(result.aliases.requirementdiagram).toEqual(accepted);
    for (const alias of [
      "RequirementDiagram",
      "REQUIREMENTDIAGRAM",
      "requirementDiagram-beta",
      "requirementdiagram-beta",
      "requirement-diagram",
      "requirement",
    ]) {
      expect(result.aliases[alias], alias).toEqual({ accepted: false });
    }
    expect(result.requirementFields).toEqual({
      id: true,
      ID: true,
      text: true,
      TEXT: true,
      risk: true,
      RISK: true,
      verifyMethod: true,
      verifymethod: true,
      VERIFYMETHOD: true,
      verificationMethod: false,
      verificationmethod: false,
    });
    expect(result.elementFields).toEqual({
      type: true,
      TYPE: true,
      docRef: true,
      docref: true,
      DOCREF: true,
      documentRef: false,
      documentReference: false,
    });
    expect(result.riskValues).toEqual({
      low: true,
      MEDIUM: true,
      High: true,
      critical: false,
      '"high"': false,
    });
    expect(result.verificationValues).toEqual({
      analysis: true,
      INSPECTION: true,
      Test: true,
      demonstration: true,
      review: false,
      '"test"': false,
    });
    expect(result.emptyValues).toEqual({
      "requirement.id": false,
      "requirement.text": false,
      "element.type": false,
      "element.docRef": false,
    });
    for (const relation of [
      "contains",
      "copies",
      "derives",
      "satisfies",
      "verifies",
      "refines",
      "traces",
    ]) {
      expect(result.relations[relation].accepted, relation).toBe(true);
      expect(result.relations[relation].labels).toEqual([`<<${relation}>>`]);
    }
    for (const [relation, normalized] of [
      ["Contains", "contains"],
      ["COPIES", "copies"],
    ]) {
      expect(result.relations[relation].accepted, relation).toBe(true);
      expect(result.relations[relation].labels).toEqual([
        `<<${normalized}>>`,
      ]);
    }
    expect(result.relations.fulfills).toEqual({ accepted: false });
    expect(result.relationSyntax["left - copies -> right"])
      .toMatchObject({
        accepted: true,
        labels: ["<<copies>>"],
      });
    expect(result.relationSyntax["right <- copies - left"])
      .toMatchObject({
        accepted: true,
        labels: ["<<copies>>"],
      });
    expect(result.relationSyntax["left <- copies -> right"])
      .toEqual({ accepted: false });
    expect(result.relationSyntax["left - copies - right"])
      .toEqual({ accepted: false });
    expect(result.directions).toEqual({
      LR: true,
      RL: true,
      TB: true,
      BT: true,
    });
  } finally {
    await harness.close();
  }
});

test("extracts pinned requirement compartments, fields, relations and terminals", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Requirement fixture"] });
  try {
    await page.goto(harness.url);
    const result = await sceneFromFixture(
      page,
      await readFixture("requirement-basic.svg"),
      "requirement-basic.svg",
    );
    validateScene(result.scene);
    expect(result.diagnostics).toEqual([]);
    expect(JSON.parse(JSON.stringify(result.scene))).toEqual(result.scene);
    expect(result.scene.nodes.map((node) => node.z))
      .toEqual(Array.from({ length: 110 }, (_, index) => index));
    expect(result.scene.nodes.filter((node) => node.kind === "group")).toHaveLength(15);
    expect(result.scene.nodes.filter((node) => node.kind === "shape")).toHaveLength(18);
    expect(result.scene.nodes.filter((node) => node.kind === "connector")).toHaveLength(37);
    expect(result.scene.nodes.filter((node) => node.kind === "text")).toHaveLength(40);
    expect(result.scene.nodes.filter((node) => node.kind === "fallback")).toEqual([]);

    const relations = result.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "requirement-relation");
    expect(relations.map((node) => [
      node.sourcePath,
      node.meta.mermaid.marker,
      node.style.dash,
      node.style.lineCap,
      node.points.length,
      node.meta.mermaid.rawPointCount,
    ])).toEqual([
      ["relations[0].line", "contains", "solid", "butt", 4, 40],
      ["relations[1].line", "arrow", "dash", "butt", 4, 43],
      ["relations[2].line", "arrow", "dash", "butt", 2, 38],
      ["relations[3].line", "arrow", "dash", "butt", 6, 80],
      ["relations[4].line", "arrow", "dash", "butt", 5, 47],
      ["relations[5].line", "arrow", "dash", "butt", 5, 49],
      ["relations[6].line", "arrow", "dash", "butt", 6, 83],
    ]);
    const terminals = result.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "requirement-terminal");
    expect(terminals.map((node) => [
      node.sourcePath,
      node.kind,
      node.meta.mermaid.marker,
      node.meta.mermaid.placement,
      node.meta.mermaid.component,
      node.points?.length,
    ])).toEqual([
      ["relations[0].terminals.start[0]", "shape", "contains", "start", "circle", undefined],
      ["relations[0].terminals.start[1]", "connector", "contains", "start", "horizontal", 2],
      ["relations[0].terminals.start[2]", "connector", "contains", "start", "vertical", 2],
      ...Array.from({ length: 6 }, (_, relation) => [
        [`relations[${relation + 1}].terminals.end[0]`, "connector", "arrow", "end", "upper", 2],
        [`relations[${relation + 1}].terminals.end[1]`, "connector", "arrow", "end", "lower", 2],
      ]).flat(),
    ]);
    expect(terminals[0]).toMatchObject({
      preset: "ellipse",
      style: {
        fill: null,
        stroke: "rgb(51, 51, 51)",
        strokeWidth: 0.6,
        dash: "solid",
      },
    });
    expect(terminals.slice(1).every((node) =>
      node.style.fill === null &&
      node.style.stroke === "rgb(51, 51, 51)" &&
      node.style.lineCap === "butt" &&
      node.arrowStart === "none" &&
      node.arrowEnd === "none")).toBe(true);
    for (const [relationIndex, relation] of relations.entries()) {
      const owned = terminals.filter((terminal) =>
        terminal.sourcePath.startsWith(`relations[${relationIndex}].`));
      expect(owned.every((terminal) => terminal.z > relation.z)).toBe(true);
    }

    const boxes = result.scene.nodes.filter((node) =>
      ["requirement-box", "element-box"].includes(node.meta?.mermaid?.kind));
    expect(boxes).toHaveLength(10);
    expect(boxes.map((node) => node.meta.mermaid.kind)).toEqual([
      ...Array(7).fill("requirement-box"),
      ...Array(3).fill("element-box"),
    ]);
    expect(boxes[0].style).toMatchObject({
      fill: "rgb(219, 234, 254)",
      stroke: "rgb(37, 99, 235)",
      strokeWidth: 1.2,
    });
    const dividerParts = result.scene.nodes.filter((node) =>
      node.kind === "connector" &&
      node.meta?.mermaid?.kind === "requirement-divider");
    expect(dividerParts).toHaveLength(16);
    expect(new Set(dividerParts.map((node) =>
      node.sourcePath.replace(/\.paths\[\d+\]$/, ""))).size).toBe(8);

    const textOf = (node) => node.text.paragraphs
      .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
      .join("\n");
    const requirementLabels = result.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "requirement-label");
    const elementLabels = result.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "element-label");
    expect(requirementLabels.map(textOf)).toEqual([
      "<<Requirement>>", "root_req", "ID: REQ-001",
      "Text: 顧客\nRoot\\nliteral",
      "Risk: High", "Verification: Test",
      "<<Requirement>>", "child_req", "ID: REQ-002", "Text: Child",
      "Risk: Low", "Verification: Analysis",
      "<<Requirement>>", "copy_req", "ID: REQ-003", "Text: Copy",
      "<<Requirement>>", "derive_req", "ID: REQ-004", "Text: Derive",
      "<<Requirement>>", "refine_req", "ID: REQ-005", "Text: Refine",
      "<<Requirement>>", "trace_req", "ID: REQ-006", "Text: Trace",
      "<<Requirement>>", "empty_req",
    ]);
    expect(requirementLabels.slice(0, 6).map((node) =>
      node.meta.mermaid.role)).toEqual([
      "type",
      "name",
      "id",
      "text",
      "risk",
      "verification",
    ]);
    expect(requirementLabels.slice(0, 6).every((node) =>
      node.text.paragraphs.every((paragraph) =>
        paragraph.runs.every((run) =>
          run.color === "rgb(16, 32, 48)")))).toBe(true);
    expect(elementLabels.map(textOf)).toEqual([
      "<<Element>>", "implementation", "Type: サービス\nService",
      "Doc Ref: docs/要件\\nref",
      "<<Element>>", "verifier", "Type: Test", "Doc Ref: tests/spec",
      "<<Element>>", "empty_element",
    ]);
    expect(elementLabels.slice(0, 4).map((node) =>
      node.meta.mermaid.role)).toEqual([
      "type",
      "name",
      "element-type",
      "document-reference",
    ]);
    expect(result.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "edge-label").map(textOf)).toEqual([
      "<<contains>>",
      "<<copies>>",
      "<<derives>>",
      "<<satisfies>>",
      "<<verifies>>",
      "<<refines>>",
      "<<traces>>",
    ]);
    expect(result.scene.nodes.some((node) =>
      node.sourcePath.startsWith("requirements[6].dividers["))).toBe(false);
    expect(result.scene.nodes.some((node) =>
      node.sourcePath.startsWith("elements[2].dividers["))).toBe(false);

    const geometry = await page.evaluate(async () => {
      const { mermaidSvgToScene } = await import("./renderer/mermaid-scene.mjs");
      const deck = document.querySelector("#fixture-deck");
      const output = mermaidSvgToScene(deck.querySelector("svg"), {
        deck,
        includeSourceElements: true,
      });
      const deckRect = deck.getBoundingClientRect();
      const round = (value) => Math.round(value * 10) / 10;
      const relationErrors = output.scene.nodes
        .filter((node) =>
          node.meta?.mermaid?.kind === "requirement-relation")
        .map((node) => {
          const source = output.sourceElements.get(node.sourcePath);
          const count = Math.max(
            2,
            Math.round(source.getTotalLength() / 4) + 1,
          );
          const samples = Array.from({ length: count }, (_, index) => {
            const point = source.getPointAtLength(
              source.getTotalLength() * index / (count - 1),
            );
            const screen = new DOMPoint(point.x, point.y)
              .matrixTransform(source.getScreenCTM());
            return {
              x: round(screen.x - deckRect.left),
              y: round(screen.y - deckRect.top),
            };
          });
          const error = (point) => Math.min(
            ...node.points.slice(1).map((end, index) => {
              const start = node.points[index];
              const dx = end.x - start.x;
              const dy = end.y - start.y;
              const denominator = dx * dx + dy * dy;
              const t = denominator === 0 ? 0 : Math.max(0, Math.min(
                1,
                ((point.x - start.x) * dx +
                  (point.y - start.y) * dy) / denominator,
              ));
              return Math.hypot(
                point.x - start.x - t * dx,
                point.y - start.y - t * dy,
              );
            }),
          );
          return {
            sourcePath: node.sourcePath,
            maxError: Math.max(...samples.map(error)),
          };
        });
      const selected = [
        "requirements[0].box",
        "requirements[0].labels[3]",
        "elements[0].box",
        "elements[0].labels[3]",
      ].map((sourcePath) => {
        const node = output.scene.nodes.find((entry) =>
          entry.sourcePath === sourcePath);
        const source = output.sourceElements.get(sourcePath);
        const rect = source.getBoundingClientRect();
        return {
          sourcePath,
          bounds: node.bounds,
          expected: {
            x: round(rect.left - deckRect.left),
            y: round(rect.top - deckRect.top),
            width: round(rect.width),
            height: round(rect.height),
          },
          ctm: Object.fromEntries(["a", "b", "c", "d"].map((key) => [
            key,
            round(source.getScreenCTM()[key]),
          ])),
        };
      });
      return {
        relationErrors,
        selected,
        ownership: output.scene.nodes
          .filter((node) =>
            node.meta?.mermaid?.kind === "requirement-terminal")
          .map((node) => {
            const relationPath = node.sourcePath.split(".terminals.")[0];
            return output.sourceElements.get(node.sourcePath) ===
              output.sourceElements.get(relationPath);
          }),
        markers: [...deck.querySelectorAll("marker")].map((marker) => ({
          id: marker.id.split("_requirement-").at(-1),
          class: marker.getAttribute("class"),
          markerUnits: marker.getAttribute("markerUnits"),
          viewBox: marker.getAttribute("viewBox"),
          preserveAspectRatio: marker.getAttribute("preserveAspectRatio"),
          markerWidth: Number(marker.getAttribute("markerWidth")),
          markerHeight: Number(marker.getAttribute("markerHeight")),
          refX: Number(marker.getAttribute("refX")),
          refY: Number(marker.getAttribute("refY")),
          orient: marker.getAttribute("orient"),
          overflow: getComputedStyle(marker).overflow,
          children: [...marker.querySelectorAll("circle, line, path")]
            .map((child) => ({
              tag: child.localName,
              geometry: Object.fromEntries(
                ["cx", "cy", "r", "x1", "x2", "y1", "y2", "d"]
                  .filter((name) => child.hasAttribute(name))
                  .map((name) => [name, child.getAttribute(name)]),
              ),
              stroke: getComputedStyle(child).stroke,
              strokeWidth: getComputedStyle(child).strokeWidth,
              lineCap: getComputedStyle(child).strokeLinecap,
              lineJoin: getComputedStyle(child).strokeLinejoin,
            })),
        })),
        uniqueSourcePaths: new Set(output.scene.nodes.map((node) =>
          node.sourcePath)).size,
      };
    });
    for (const entry of geometry.relationErrors) {
      expect(entry.maxError, entry.sourcePath).toBeLessThanOrEqual(2);
    }
    for (const entry of geometry.selected) {
      expect(entry.bounds, entry.sourcePath).toEqual(entry.expected);
      expect(entry.ctm).toEqual({
        a: 0.6,
        b: 0,
        c: 0,
        d: 0.6,
      });
    }
    expect(geometry.ownership).toEqual(Array(15).fill(true));
    expect(geometry.uniqueSourcePaths).toBe(result.scene.nodes.length);
    expect(geometry.markers.map((marker) => [
      marker.id,
      marker.class,
      marker.markerUnits,
      marker.viewBox,
      marker.preserveAspectRatio,
      marker.markerWidth,
      marker.markerHeight,
      marker.refX,
      marker.refY,
      marker.orient,
      marker.overflow,
    ])).toEqual([
      ["requirement_containsStart", null, null, null, null, 20, 20, 0, 10, "auto", "hidden"],
      ["requirement_arrowEnd", null, null, null, null, 20, 20, 20, 10, "auto", "hidden"],
    ]);
    expect(geometry.markers[0].children.map((child) => [
      child.tag,
      child.geometry,
    ])).toEqual([
      ["circle", { cx: "10", cy: "10", r: "9" }],
      ["line", { x1: "1", x2: "19", y1: "10", y2: "10" }],
      ["line", { x1: "10", x2: "10", y1: "1", y2: "19" }],
    ]);
    expect(geometry.markers[1].children.map((child) => [
      child.tag,
      child.geometry,
    ])).toEqual([[
      "path",
      { d: "M0,0\n      L20,10\n      M20,10\n      L0,20" },
    ]]);
    expect(geometry.markers.flatMap((marker) => marker.children)
      .every((child) =>
        child.stroke === "rgb(51, 51, 51)" &&
        child.strokeWidth === "1px" &&
        child.lineCap === "butt" &&
        child.lineJoin === "miter")).toBe(true);

    const mapped = sceneToPptxElements(result.scene);
    expect(mapped.fallbacks).toEqual([]);
    expect(mapped.elements.filter((element) => element.type === "shape"))
      .toHaveLength(18);
    expect(mapped.elements.filter((element) => element.type === "connector"))
      .toHaveLength(37);
    expect(mapped.elements.filter((element) => element.type === "text"))
      .toHaveLength(40);
    const buffer = buildPptxPackage({ slides: [{ elements: mapped.elements }] });
    expect(inspectPptxPackage(buffer).valid).toBe(true);
    const xml = buffer.toString("utf8");
    const lineCount = mapped.elements
      .filter((element) => element.type === "connector")
      .reduce((sum, element) => sum + element.points.length - 1, 0);
    expect((xml.match(/<a:prstGeom prst="line">/g) || []))
      .toHaveLength(lineCount);
    expect((xml.match(/<a:prstGeom prst="ellipse">/g) || []))
      .toHaveLength(1);
    expect(xml).not.toMatch(/<a:(?:headEnd|tailEnd)\b/);
    expect(xml).toContain("顧客");
    expect(xml).toContain("サービス");
    expect(xml).toContain("&lt;&lt;contains&gt;&gt;");
  } finally {
    await harness.close();
  }
});

test("preserves independent requirement paint alpha in native DrawingML", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Requirement paint"] });
  try {
    await page.goto(harness.url);
    await sceneFromFixture(
      page,
      await readFixture("requirement-basic.svg"),
      "requirement-paint.svg",
    );
    const result = await updateFixture(page, () => {
      const root = document.querySelector(
        'g.node[id$="-root_req"]',
      );
      const [fill, stroke] = root.querySelectorAll(
        ":scope > g.outer-path > path",
      );
      fill.style.setProperty("fill", "rgba(10, 20, 30, 0.5)", "important");
      fill.style.fillOpacity = "0.6";
      fill.style.opacity = "0.8";
      stroke.style.setProperty(
        "stroke",
        "rgba(40, 50, 60, 0.5)",
        "important",
      );
      stroke.style.strokeOpacity = "0.7";
      stroke.style.opacity = "0.8";
      const label = root.querySelectorAll(":scope > g.label")[3];
      for (const part of [label, ...label.querySelectorAll("*")]) {
        part.style.setProperty(
          "color",
          "rgba(70, 80, 90, 0.5)",
          "important",
        );
      }
      label.style.opacity = "0.75";

      const relation = document.querySelectorAll(
        "path.relationshipLine",
      )[2];
      relation.style.stroke = "rgba(12, 34, 56, 0.5)";
      relation.style.strokeOpacity = "0.4";
      const originalArrow = document.querySelector(
        'marker[id$="_requirement-requirement_arrowEnd"]',
      );
      const arrow = originalArrow.cloneNode(true);
      arrow.id = "fixture-paint_requirement-requirement_arrowEnd";
      const arrowPath = arrow.querySelector("path");
      arrowPath.style.setProperty(
        "stroke",
        "rgb(90, 80, 70)",
        "important",
      );
      originalArrow.parentElement.append(arrow);
      relation.setAttribute("marker-end", `url(#${arrow.id})`);

      const circle = document.querySelector(
        'marker[id$="_requirement-requirement_containsStart"] circle',
      );
      circle.style.setProperty(
        "fill",
        "rgba(20, 40, 60, 0.5)",
        "important",
      );
      circle.style.setProperty(
        "stroke",
        "rgba(80, 100, 120, 0.5)",
        "important",
      );
      circle.style.fillOpacity = "0.6";
      circle.style.strokeOpacity = "0.8";
      circle.style.opacity = "0.7";
    });
    expect(result.diagnostics).toEqual([]);
    const fill = result.scene.nodes.find((node) =>
      node.sourcePath === "requirements[0].box.paths[0]");
    const stroke = result.scene.nodes.find((node) =>
      node.sourcePath === "requirements[0].box.paths[1]");
    expect(fill).toMatchObject({
      kind: "shape",
      style: {
        fill: "rgba(10, 20, 30, 0.5)",
        stroke: null,
        opacity: 0.8,
        fillOpacity: 0.6,
      },
    });
    expect(stroke).toMatchObject({
      kind: "shape",
      style: {
        fill: null,
        stroke: "rgba(40, 50, 60, 0.5)",
        opacity: 0.8,
        strokeOpacity: 0.7,
      },
    });
    const text = result.scene.nodes.find((node) =>
      node.sourcePath === "requirements[0].labels[3]");
    expect(text.text.paragraphs.flatMap((paragraph) =>
      paragraph.runs).every((run) =>
      run.color === "rgba(70, 80, 90, 0.5)" &&
      run.opacity === 0.75)).toBe(true);

    const relation = result.scene.nodes.find((node) =>
      node.sourcePath === "relations[2].line");
    expect(relation.style).toMatchObject({
      stroke: "rgba(12, 34, 56, 0.5)",
      strokeOpacity: 0.4,
      dash: "dash",
    });
    const arrow = result.scene.nodes.filter((node) =>
      node.sourcePath.startsWith("relations[2].terminals.end["));
    expect(arrow).toHaveLength(2);
    expect(arrow.every((node) =>
      node.style.stroke === "rgb(90, 80, 70)")).toBe(true);
    const circle = result.scene.nodes.find((node) =>
      node.sourcePath === "relations[0].terminals.start[0]");
    expect(circle.style).toMatchObject({
      fill: "rgba(20, 40, 60, 0.5)",
      stroke: "rgba(80, 100, 120, 0.5)",
      opacity: 0.7,
      fillOpacity: 0.6,
      strokeOpacity: 0.8,
    });

    const mapped = sceneToPptxElements(result.scene);
    expect(mapped.fallbacks).toEqual([]);
    const packageBytes = buildPptxPackage({
      slides: [{ elements: mapped.elements }],
    });
    expect(inspectPptxPackage(packageBytes).valid).toBe(true);
    const xml = packageBytes.toString("utf8");
    for (const alpha of [20000, 21000, 24000, 28000]) {
      expect(xml).toContain(`<a:alpha val="${alpha}"/>`);
    }
    expect(xml).toContain("顧客");
  } finally {
    await harness.close();
  }
});

test("keeps unsupported requirement details at the smallest safe fallback boundary", async ({ page }) => {
  test.setTimeout(180_000);
  const harness = await startHarness({ slides: ["# Requirement fallbacks"] });
  try {
    await page.goto(harness.url);
    const fixture = await readFixture("requirement-basic.svg");
    const cases = [
      {
        name: "computed box geometry",
        mutate: () => {
          document.querySelector(
            'g.node[id$="-root_req"] > g.outer-path > path',
          ).style.setProperty(
            "d",
            'path("M 0 0 L 20 0 L 10 10 Z")',
            "important",
          );
        },
        fallback: {
          sourcePath: "requirements[0].box",
          reason: "unsupported-mermaid-requirement-node-geometry",
        },
        boxCount: 9,
        sourceTag: "g",
      },
      {
        name: "decorated field label",
        mutate: () => {
          document.querySelectorAll(
            'g.node[id$="-root_req"] > g.label',
          )[3].insertAdjacentHTML(
            "beforeend",
            '<circle cx="4" cy="4" r="3" fill="red"/>',
          );
        },
        fallback: {
          sourcePath: "requirements[0].labels[3]",
          reason: "unsupported-mermaid-requirement-text",
        },
        textCount: 39,
        sourceTag: "g",
      },
      {
        name: "divider geometry",
        mutate: () => {
          document.querySelector(
            'g.node[id$="-root_req"] > g.divider > path',
          ).setAttribute("d", "M0 0 L10 10");
        },
        fallback: {
          sourcePath: "requirements[0].dividers[0]",
          reason: "unsupported-mermaid-requirement-divider-geometry",
        },
        dividerCount: 14,
        sourceTag: "path",
      },
      {
        name: "divider nonuniform transform",
        mutate: () => {
          document.querySelector(
            'g.node[id$="-root_req"] > g.divider > path',
          ).setAttribute("transform", "scale(2,1)");
        },
        fallback: {
          sourcePath: "requirements[0].dividers[0]",
          reason: "unsupported-mermaid-requirement-divider-transform",
        },
        dividerCount: 14,
        sourceTag: "path",
      },
      {
        name: "node decoration",
        mutate: () => {
          document.querySelector(
            'g.node[id$="-root_req"]',
          ).insertAdjacentHTML(
            "beforeend",
            '<circle cx="0" cy="0" r="5" fill="red"/>',
          );
        },
        fallback: {
          sourcePath: "requirements[0].decorations[0]",
          reason: "unsupported-mermaid-requirement-node-decoration",
        },
        sourceTag: "circle",
      },
      {
        name: "node compositing",
        mutate: () => {
          document.querySelector(
            'g.node[id$="-root_req"]',
          ).style.opacity = "0.5";
        },
        fallback: {
          sourcePath: "requirements[0]",
          reason: "unsupported-mermaid-requirement-node-compositing",
        },
        relationCount: 7,
        terminalCount: 15,
        boxCount: 9,
        dividerCount: 14,
        textCount: 34,
        sourceTag: "g",
      },
      {
        name: "multiple relation subpaths",
        mutate: () => {
          const relation = document.querySelectorAll(
            "path.relationshipLine",
          )[1];
          relation.setAttribute(
            "d",
            `${relation.getAttribute("d")} M0 0 L1 1`,
          );
        },
        fallback: {
          sourcePath: "relations[1]",
          reason: "unsupported-mermaid-requirement-relation-path",
        },
        relationCount: 6,
        terminalCount: 13,
        sourceTag: "path",
      },
      {
        name: "relation transform",
        mutate: () => {
          document.querySelectorAll("path.relationshipLine")[1]
            .setAttribute("transform", "skewX(8)");
        },
        fallback: {
          sourcePath: "relations[1]",
          reason: "unsupported-mermaid-requirement-relation-transform",
        },
        relationCount: 6,
        terminalCount: 13,
        sourceTag: "path",
      },
      {
        name: "relation effect",
        mutate: () => {
          document.querySelectorAll("path.relationshipLine")[1]
            .style.filter = "blur(1px)";
        },
        fallback: {
          sourcePath: "relations[1]",
          reason: "unsupported-mermaid-requirement-relation-style",
        },
        relationCount: 6,
        terminalCount: 13,
        sourceTag: "path",
      },
      {
        name: "relation stroke compositing",
        mutate: () => {
          document.querySelectorAll("path.relationshipLine")[1]
            .style.stroke = "rgba(12, 34, 56, 0.5)";
        },
        fallback: {
          sourcePath: "relations[1]",
          reason: "unsupported-mermaid-requirement-relation-compositing",
        },
        relationCount: 6,
        terminalCount: 13,
        sourceTag: "path",
      },
      {
        name: "terminal geometry",
        mutate: () => {
          const relation = document.querySelectorAll(
            "path.relationshipLine",
          )[1];
          const original = document.querySelector(
            'marker[id$="_requirement-requirement_arrowEnd"]',
          );
          const marker = original.cloneNode(true);
          marker.id =
            "fixture-local_requirement-requirement_arrowEnd";
          marker.querySelector("path").setAttribute("d", "M0 0 L10 10");
          original.parentElement.append(marker);
          relation.setAttribute("marker-end", `url(#${marker.id})`);
        },
        fallback: {
          sourcePath: "relations[1]",
          reason: "unsupported-mermaid-requirement-terminal-geometry",
        },
        relationCount: 6,
        terminalCount: 13,
        sourceTag: "path",
      },
      {
        name: "terminal effect",
        mutate: () => {
          const relation = document.querySelectorAll(
            "path.relationshipLine",
          )[1];
          const original = document.querySelector(
            'marker[id$="_requirement-requirement_arrowEnd"]',
          );
          const marker = original.cloneNode(true);
          marker.id =
            "fixture-effect_requirement-requirement_arrowEnd";
          marker.style.filter = "blur(1px)";
          original.parentElement.append(marker);
          relation.setAttribute("marker-end", `url(#${marker.id})`);
        },
        fallback: {
          sourcePath: "relations[1]",
          reason: "unsupported-mermaid-requirement-terminal-style",
        },
        relationCount: 6,
        terminalCount: 13,
        sourceTag: "path",
      },
      {
        name: "terminal compositing",
        mutate: () => {
          const relation = document.querySelectorAll(
            "path.relationshipLine",
          )[1];
          const original = document.querySelector(
            'marker[id$="_requirement-requirement_arrowEnd"]',
          );
          const marker = original.cloneNode(true);
          marker.id =
            "fixture-opacity_requirement-requirement_arrowEnd";
          marker.style.opacity = "0.5";
          original.parentElement.append(marker);
          relation.setAttribute("marker-end", `url(#${marker.id})`);
        },
        fallback: {
          sourcePath: "relations[1]",
          reason: "unsupported-mermaid-requirement-terminal-compositing",
        },
        relationCount: 6,
        terminalCount: 13,
        sourceTag: "path",
      },
      {
        name: "arrow stroke compositing",
        mutate: () => {
          const relation = document.querySelectorAll(
            "path.relationshipLine",
          )[1];
          const original = document.querySelector(
            'marker[id$="_requirement-requirement_arrowEnd"]',
          );
          const marker = original.cloneNode(true);
          marker.id =
            "fixture-stroke-alpha_requirement-requirement_arrowEnd";
          marker.querySelector("path").style.setProperty(
            "stroke",
            "rgba(90, 80, 70, 0.5)",
            "important",
          );
          original.parentElement.append(marker);
          relation.setAttribute("marker-end", `url(#${marker.id})`);
        },
        fallback: {
          sourcePath: "relations[1]",
          reason: "unsupported-mermaid-requirement-terminal-compositing",
        },
        relationCount: 6,
        terminalCount: 13,
        sourceTag: "path",
      },
      {
        name: "relation compositing",
        mutate: () => {
          document.querySelectorAll("path.relationshipLine")[1]
            .style.opacity = "0.5";
        },
        fallback: {
          sourcePath: "relations[1]",
          reason: "unsupported-mermaid-requirement-terminal-compositing",
        },
        relationCount: 6,
        terminalCount: 13,
        sourceTag: "path",
      },
      {
        name: "decorated relation label",
        mutate: () => {
          document.querySelectorAll("g.edgeLabel")[1]
            .insertAdjacentHTML(
              "beforeend",
              '<circle cx="4" cy="4" r="3" fill="red"/>',
            );
        },
        fallback: {
          sourcePath: "edgeLabels[root_req-copy_req-0]",
          reason: "unsupported-mermaid-requirement-relation-label",
        },
        edgeLabelCount: 6,
        sourceTag: "g",
      },
      {
        name: "relation label compositing",
        mutate: () => {
          document.querySelectorAll("g.edgeLabel")[1]
            .style.opacity = "0.5";
        },
        fallback: {
          sourcePath: "edgeLabels[root_req-copy_req-0]",
          reason: "unsupported-mermaid-requirement-relation-label",
        },
        edgeLabelCount: 6,
        sourceTag: "g",
      },
    ];
    for (const entry of cases) {
      await sceneFromFixture(
        page,
        fixture,
        `requirement-${entry.name}.svg`,
      );
      const result = await updateFixture(page, entry.mutate);
      expect(result.scene.nodes.filter((node) => node.kind === "fallback"),
        entry.name).toMatchObject([entry.fallback]);
      expect(result.scene.nodes.filter((node) =>
        node.meta?.mermaid?.kind === "requirement-relation"),
      entry.name).toHaveLength(entry.relationCount ?? 7);
      expect(result.scene.nodes.filter((node) =>
        node.meta?.mermaid?.kind === "requirement-terminal"),
      entry.name).toHaveLength(entry.terminalCount ?? 15);
      expect(result.scene.nodes.filter((node) =>
        ["requirement-box", "element-box"].includes(
          node.meta?.mermaid?.kind,
        )),
      entry.name).toHaveLength(entry.boxCount ?? 10);
      expect(result.scene.nodes.filter((node) =>
        node.kind === "connector" &&
        node.meta?.mermaid?.kind === "requirement-divider"),
      entry.name).toHaveLength(entry.dividerCount ?? 16);
      expect(result.scene.nodes.filter((node) => node.kind === "text"),
        entry.name).toHaveLength(entry.textCount ?? 40);
      expect(result.scene.nodes.filter((node) =>
        node.meta?.mermaid?.kind === "edge-label"),
      entry.name).toHaveLength(entry.edgeLabelCount ?? 7);
      if (entry.fallback.sourcePath.startsWith("relations[")) {
        const fallback = result.scene.nodes.find((node) =>
          node.kind === "fallback");
        const labels = result.scene.nodes.filter((node) =>
          node.meta?.mermaid?.kind === "edge-label");
        expect(labels.every((label) => label.z > fallback.z), entry.name)
          .toBe(true);
      }
      expect(result.sources.find((source) =>
        source.path === entry.fallback.sourcePath),
      entry.name).toMatchObject({ tag: entry.sourceTag });
      expect(sceneToPptxElements(result.scene).fallbacks.map((fallback) => ({
        sourcePath: fallback.sourcePath,
        reason: fallback.reason,
      })), entry.name).toEqual([entry.fallback]);
    }
  } finally {
    await harness.close();
  }
});

test("rejects malformed and excessive requirement structures explicitly", async ({ page }) => {
  test.setTimeout(180_000);
  const harness = await startHarness({ slides: ["# Requirement limits"] });
  try {
    await page.goto(harness.url);
    const fixture = await readFixture("requirement-basic.svg");

    for (const mutate of [
      () => {
        document.querySelector("svg").setAttribute(
          "aria-roledescription",
          "error",
        );
      },
      () => {
        document.querySelector("svg").setAttribute("class", "flowchart");
      },
      () => {
        const svg = document.querySelector("svg");
        svg.setAttribute("aria-roledescription", "requirement");
        svg.setAttribute("class", "erDiagram");
      },
    ]) {
      await sceneFromFixture(page, fixture, "requirement-wrong-route.svg");
      const routed = await updateFixture(page, mutate);
      expect(routed.scene.nodes).toMatchObject([{
        kind: "fallback",
        sourcePath: "svg",
        reason: "unsupported-mermaid-svg-structure",
      }]);
      expect(routed.scene.nodes.some((node) =>
        node.meta?.mermaid?.kind?.startsWith("requirement"))).toBe(false);
    }

    await sceneFromFixture(page, fixture, "requirement-malformed-root.svg");
    const malformed = await updateFixture(page, () => {
      const root = document.querySelector("g.root");
      root.append(root.querySelector(":scope > g.edgePaths").cloneNode(true));
    });
    expect(malformed.scene.nodes).toMatchObject([{
      kind: "fallback",
      sourcePath: "svg",
      reason: "unsupported-mermaid-requirement-structure",
    }]);

    await sceneFromFixture(page, fixture, "requirement-depth.svg");
    const depth = await updateFixture(page, () => {
      let root = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "g",
      );
      root.setAttribute("class", "label");
      document.querySelector("g.root").append(root);
      for (let index = 0; index < 17; index += 1) {
        const child = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "g",
        );
        child.setAttribute("class", "label");
        root.append(child);
        root = child;
      }
      root.insertAdjacentHTML(
        "beforeend",
        '<circle cx="20" cy="20" r="5" fill="red"/>',
      );
    });
    expect(depth.scene.nodes.filter((node) =>
      node.reason === "unsupported-mermaid-requirement-depth"))
      .toHaveLength(1);
    expect(depth.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "requirement-relation"))
      .toHaveLength(7);
    expect(depth.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "requirement-box"))
      .toHaveLength(7);

    await sceneFromFixture(page, fixture, "requirement-text-limit.svg");
    const textLimit = await updateFixture(page, () => {
      document.querySelectorAll(
        'g.node[id$="-root_req"] > g.label p',
      )[3].innerHTML = Array.from(
        { length: 201 },
        (_, index) => `line-${index}`,
      ).join("<br>");
    });
    expect(textLimit.scene.nodes).toMatchObject([{
      kind: "fallback",
      sourcePath: "svg",
      reason: expect.stringContaining("mermaid-scene-limit-exceeded"),
    }]);

    await sceneFromFixture(page, fixture, "requirement-element-limit.svg");
    const elementLimit = await updateFixture(page, () => {
      document.querySelector("svg").insertAdjacentHTML(
        "beforeend",
        "<desc></desc>".repeat(40001),
      );
    });
    expect(elementLimit.scene.nodes).toMatchObject([{
      kind: "fallback",
      sourcePath: "svg",
      reason: "mermaid-scene-limit-exceeded: SVG element count",
    }]);
  } finally {
    await harness.close();
  }
});

test("extracts pinned basic state geometry, labels, routes, alpha and exact pseudo-states", async ({ page }) => {
  const harness = await startHarness({ slides: ["# State fixture"] });
  try {
    await page.goto(harness.url);
    const result = await sceneFromFixture(
      page,
      await readFixture("state-basic.svg"),
      "state-basic.svg",
    );
    validateScene(result.scene);
    expect(result.diagnostics).toEqual([]);
    expect(result.scene.nodes.map((node) => node.z))
      .toEqual(Array.from({ length: 14 }, (_, index) => index));
    expect(result.scene.nodes.filter((node) => node.kind === "connector")).toHaveLength(4);
    expect(result.scene.nodes.filter((node) => node.kind === "shape")).toHaveLength(9);
    expect(result.scene.nodes.filter((node) => node.kind === "group")).toHaveLength(1);
    expect(result.scene.nodes.filter((node) => node.kind === "fallback")).toEqual([]);

    const transitions = result.scene.nodes.filter((node) =>
      node.sourcePath.startsWith("state.transitions["));
    expect(transitions.map((node) => [
      node.arrowStart,
      node.arrowEnd,
      node.style.dash,
      node.style.opacity,
      node.points.length,
      node.meta.mermaid.rawPointCount,
    ])).toEqual([
      ["none", "stealth", "solid", 1, 2, 14],
      ["none", "stealth", "dash", 0.75, 5, 23],
      ["none", "stealth", "solid", 1, 5, 23],
      ["none", "stealth", "solid", 1, 2, 14],
    ]);
    expect(transitions[2].points[0].x).toBeGreaterThan(transitions[2].points.at(-1).x);
    for (const error of await sampledConnectorErrors(page)) {
      expect(error.maxError, error.path).toBeLessThanOrEqual(2);
    }

    const textOf = (node) => node.text.paragraphs
      .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
      .join("\n");
    const labels = result.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "edge-label");
    expect(labels.map(textOf)).toEqual(["開始\nStart", "停止\nStop"]);
    const states = result.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "state");
    expect(states.map((node) => [node.preset, textOf(node)])).toEqual([
      ["roundedRect", "待機\nIdle"],
      ["roundedRect", "Running"],
    ]);
    expect(states[1].style).toMatchObject({
      fill: "rgba(51, 102, 153, 0.5)",
      stroke: "rgba(204, 51, 0, 0.5)",
      strokeWidth: 3,
      fillOpacity: 0.5,
      strokeOpacity: 0.25,
      cornerRadius: 5,
    });
    expect(result.scene.nodes.find((node) =>
      node.meta?.mermaid?.kind === "state-start")).toMatchObject({
      kind: "shape",
      preset: "ellipse",
      bounds: { width: 14, height: 14 },
    });
    const endParts = result.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "state-end-part");
    expect(endParts.map((node) => [
      node.preset,
      node.meta.mermaid.ring,
      node.meta.mermaid.paint,
      node.bounds.width,
      node.bounds.height,
    ])).toEqual([
      ["ellipse", "outer", "fill", 14, 14],
      ["ellipse", "outer", "stroke", 14, 14],
      ["ellipse", "inner", "fill", 5, 5],
      ["ellipse", "inner", "stroke", 5, 5],
    ]);
    expect(endParts[0].bounds).toEqual(endParts[1].bounds);
    expect(endParts[2].bounds).toEqual(endParts[3].bounds);
    expect(result.scene.nodes.find((node) =>
      node.meta?.mermaid?.kind === "state-end")).toMatchObject({
      kind: "group",
      bounds: endParts[0].bounds,
    });

    const geometry = await page.evaluate(async () => {
      const { mermaidSvgToScene } = await import("./renderer/mermaid-scene.mjs");
      const deck = document.querySelector("#fixture-deck");
      const result = mermaidSvgToScene(deck.querySelector("svg"), {
        deck,
        includeSourceElements: true,
      });
      const deckRect = deck.getBoundingClientRect();
      const round = (value) => Math.round(value * 10) / 10;
      const entries = result.scene.nodes
        .filter((node) => node.kind !== "connector")
        .map((node) => {
          const source = result.sourceElements.get(node.sourcePath);
          const rect = source.getBoundingClientRect();
          return {
            sourcePath: node.sourcePath,
            bounds: node.bounds,
            expected: {
              x: round(rect.left - deckRect.left),
              y: round(rect.top - deckRect.top),
              width: round(rect.width),
              height: round(rect.height),
            },
          };
        });
      return {
        entries,
        uniqueSources: new Set(entries.map((entry) =>
          result.sourceElements.get(entry.sourcePath))).size,
      };
    });
    expect(geometry.uniqueSources).toBe(10);
    for (const entry of geometry.entries) {
      expect(entry.bounds, entry.sourcePath).toEqual(entry.expected);
    }

    const mapped = sceneToPptxElements(result.scene);
    expect(mapped.fallbacks).toEqual([]);
    expect(mapped.elements.filter((element) => element.type === "connector")).toHaveLength(4);
    expect(mapped.elements.filter((element) => element.type === "shape")).toHaveLength(9);
    const buffer = buildPptxPackage({ slides: [{ elements: mapped.elements }] });
    expect(inspectPptxPackage(buffer).valid).toBe(true);
    const xml = buffer.toString("utf8");
    expect((xml.match(/<a:tailEnd type="stealth"\/>/g) || [])).toHaveLength(4);
    expect((xml.match(/<a:prstGeom prst="ellipse">/g) || [])).toHaveLength(5);
    expect((xml.match(/<a:prstDash val="dash"\/>/g) || [])).toHaveLength(4);
    expect(xml).toContain("待機");
    expect(xml).toContain("停止");
  } finally {
    await harness.close();
  }
});

test("keeps unsupported state nodes, transitions and pseudo-state details local", async ({ page }) => {
  const harness = await startHarness({ slides: ["# State fallback boundaries"] });
  try {
    await page.goto(harness.url);
    const fixture = await readFixture("state-basic.svg");
    const cases = [
      {
        name: "unknown marker",
        mutate: () => {
          const svg = document.querySelector("svg");
          svg.querySelector("defs").insertAdjacentHTML(
            "beforeend",
            '<marker id="unsupported-state-marker"><path d="M0 0 L3 3"/></marker>',
          );
          svg.querySelectorAll("path.transition")[1].style.markerEnd =
            "url(#unsupported-state-marker)";
        },
        fallback: {
          sourcePath: "state.transitions[1]",
          reason: "unsupported-mermaid-edge-style",
        },
        connectors: 3,
        shapes: 9,
        groups: 1,
        sourceTag: "path",
      },
      {
        name: "marker paint",
        mutate: () => {
          document.querySelectorAll("path.transition")[1].style.stroke = "rgb(200, 0, 0)";
        },
        fallback: {
          sourcePath: "state.transitions[1]",
          reason: "unsupported-mermaid-edge-style",
        },
        connectors: 3,
        shapes: 9,
        groups: 1,
        sourceTag: "path",
      },
      {
        name: "multiple subpaths",
        mutate: () => {
          const edge = document.querySelectorAll("path.transition")[1];
          edge.setAttribute("d", `${edge.getAttribute("d")} M0 0 L1 1`);
        },
        fallback: {
          sourcePath: "state.transitions[1]",
          reason: "unsupported-mermaid-edge-path",
        },
        connectors: 3,
        shapes: 9,
        groups: 1,
        sourceTag: "path",
      },
      {
        name: "transition transform",
        mutate: () => {
          document.querySelectorAll("path.transition")[1]
            .setAttribute("transform", "skewX(8)");
        },
        fallback: {
          sourcePath: "state.transitions[1]",
          reason: "unsupported-mermaid-edge-transform",
        },
        connectors: 3,
        shapes: 9,
        groups: 1,
        sourceTag: "path",
      },
      {
        name: "transition effect",
        mutate: () => {
          document.querySelectorAll("path.transition")[1].style.filter = "blur(1px)";
        },
        fallback: {
          sourcePath: "state.transitions[1]",
          reason: "unsupported-mermaid-edge-style",
        },
        connectors: 3,
        shapes: 9,
        groups: 1,
        sourceTag: "path",
      },
      {
        name: "decorated state label",
        mutate: () => {
          document.querySelector("g.node.statediagram-state .label div")
            .style.backgroundColor = "red";
        },
        fallback: {
          sourcePath: "state.nodes[1]",
          reason: "unsupported-mermaid-state-label",
        },
        connectors: 4,
        shapes: 8,
        groups: 1,
        sourceTag: "g",
      },
      {
        name: "unknown state child",
        mutate: () => {
          document.querySelector("g.node.statediagram-state").insertAdjacentHTML(
            "beforeend",
            '<circle cx="0" cy="0" r="4" fill="red"/>',
          );
        },
        fallback: {
          sourcePath: "state.nodes[1]",
          reason: "unsupported-mermaid-state-node-content",
        },
        connectors: 4,
        shapes: 8,
        groups: 1,
        sourceTag: "g",
      },
      {
        name: "state effect",
        mutate: () => {
          document.querySelector("g.node.statediagram-state").style.filter = "blur(1px)";
        },
        fallback: {
          sourcePath: "state.nodes[1]",
          reason: "unsupported-mermaid-node-content",
        },
        connectors: 4,
        shapes: 8,
        groups: 1,
        sourceTag: "g",
      },
      {
        name: "state transform",
        mutate: () => {
          document.querySelector("g.node.statediagram-state")
            .setAttribute("transform", "skewX(8)");
        },
        fallback: {
          sourcePath: "state.nodes[1]",
          reason: "unsupported-mermaid-node-transform",
        },
        connectors: 4,
        shapes: 8,
        groups: 1,
        sourceTag: "g",
      },
      {
        name: "end geometry",
        mutate: () => {
          document.querySelector("g.node:has(g.outer-path) g.outer-path > path")
            .setAttribute("d", "M-7 -7 L7 7");
        },
        fallback: {
          sourcePath: "state.nodes[3]",
          reason: "unsupported-mermaid-state-end-geometry",
        },
        connectors: 4,
        shapes: 5,
        groups: 0,
        sourceTag: "g",
      },
      {
        name: "end transform",
        mutate: () => {
          document.querySelector("g.node:has(g.outer-path) g.outer-path")
            .setAttribute("transform", "skewX(8)");
        },
        fallback: {
          sourcePath: "state.nodes[3]",
          reason: "unsupported-mermaid-state-end-transform",
        },
        connectors: 4,
        shapes: 5,
        groups: 0,
        sourceTag: "g",
      },
    ];
    for (const entry of cases) {
      await sceneFromFixture(page, fixture, `state-${entry.name}.svg`);
      const result = await updateFixture(page, entry.mutate);
      expect(result.scene.nodes.filter((node) => node.kind === "fallback"), entry.name)
        .toMatchObject([entry.fallback]);
      expect(result.scene.nodes.filter((node) => node.kind === "connector"), entry.name)
        .toHaveLength(entry.connectors);
      expect(result.scene.nodes.filter((node) => node.kind === "shape"), entry.name)
        .toHaveLength(entry.shapes);
      expect(result.scene.nodes.filter((node) => node.kind === "group"), entry.name)
        .toHaveLength(entry.groups);
      expect(result.scene.nodes.filter((node) =>
        node.meta?.mermaid?.kind === "edge-label"), entry.name).toHaveLength(2);
      expect(result.scene.nodes.some((node) => node.text?.paragraphs.some((paragraph) =>
        paragraph.runs.some((run) => run.text === "Running"))), entry.name).toBe(true);
      expect(result.scene.nodes.some((node) => node.sourcePath === "svg"), entry.name).toBe(false);
      expect(result.sources.find((source) => source.path === entry.fallback.sourcePath), entry.name)
        .toMatchObject({ tag: entry.sourceTag });
      expect(sceneToPptxElements(result.scene).fallbacks.map((fallback) =>
        fallback.sourcePath), entry.name).toEqual([entry.fallback.sourcePath]);
    }

    await sceneFromFixture(page, fixture, "state-unknown-root.svg");
    const unknown = await updateFixture(page, () => {
      document.querySelector("g.nodes").insertAdjacentHTML(
        "beforeend",
        '<circle id="state-decoration" cx="370" cy="66" r="5" fill="red"/>',
      );
    });
    expect(unknown.scene.nodes.filter((node) => node.kind === "fallback")).toMatchObject([{
      sourcePath: "root.unknown[0]",
      reason: "unsupported-mermaid-svg-element",
    }]);
    expect(unknown.scene.nodes.filter((node) => node.kind === "connector")).toHaveLength(4);
    expect(unknown.scene.nodes.filter((node) => node.kind === "shape")).toHaveLength(9);
  } finally {
    await harness.close();
  }
});

test("keeps compound, parallel, special, described and noted states at conservative local boundaries", async ({ page }) => {
  const harness = await startHarness({ slides: ["# State special structures"] });
  try {
    await page.goto(harness.url);
    const cases = [
      {
        name: "compound",
        source: [
          "stateDiagram-v2",
          "[*] --> Parent",
          "state Parent {",
          "  [*] --> Child",
          "  Child --> [*]",
          "}",
          "Parent --> Outside",
          "Outside --> [*]",
        ].join("\n"),
        reasons: ["unsupported-mermaid-state-compound"],
        connectors: 5,
        nativeText: ["Child", "Outside"],
      },
      {
        name: "parallel",
        source: [
          "stateDiagram-v2",
          "[*] --> Active",
          "state Active {",
          "  [*] --> NumLockOff",
          "  NumLockOff --> NumLockOn",
          "  --",
          "  [*] --> CapsLockOff",
          "  CapsLockOff --> CapsLockOn",
          "}",
          "Active --> [*]",
        ].join("\n"),
        reasons: [
          "unsupported-mermaid-state-compound",
          "unsupported-mermaid-state-parallel",
          "unsupported-mermaid-state-parallel",
        ],
        connectors: 6,
        nativeText: ["NumLockOff", "NumLockOn", "CapsLockOff", "CapsLockOn"],
      },
      {
        name: "fork and join",
        source: [
          "stateDiagram-v2",
          "state fork_state <<fork>>",
          "[*] --> fork_state",
          "fork_state --> State2",
          "fork_state --> State3",
          "state join_state <<join>>",
          "State2 --> join_state",
          "State3 --> join_state",
          "join_state --> [*]",
        ].join("\n"),
        reasons: [
          "unsupported-mermaid-state-special-node",
          "unsupported-mermaid-state-special-node",
        ],
        connectors: 6,
        nativeText: ["State2", "State3"],
      },
      {
        name: "choice",
        source: [
          "stateDiagram-v2",
          "state choice_state <<choice>>",
          "[*] --> choice_state",
          "choice_state --> A: yes",
          "choice_state --> B: no",
          "A --> [*]",
          "B --> [*]",
        ].join("\n"),
        reasons: ["unsupported-mermaid-state-special-node"],
        connectors: 5,
        nativeText: ["A", "B", "yes", "no"],
      },
      {
        name: "multiple descriptions",
        source: [
          "stateDiagram-v2",
          "[*] --> A",
          "A: First",
          "A: Second",
          "A --> [*]",
        ].join("\n"),
        reasons: ["unsupported-mermaid-state-description"],
        connectors: 2,
        nativeText: [],
      },
      {
        name: "note",
        source: [
          "stateDiagram-v2",
          "state \"Ready\" as Ready",
          "[*] --> Ready",
          "note right of Ready",
          "  Important 日本語",
          "end note",
          "Ready --> [*]",
        ].join("\n"),
        reasons: [
          "unsupported-mermaid-state-note",
          "unsupported-mermaid-state-note",
        ],
        connectors: 2,
        nativeText: ["Ready"],
      },
    ];
    for (const entry of cases) {
      const result = await sceneFromMermaidSource(
        page,
        entry.source,
        `state-${entry.name}.svg`,
      );
      validateScene(result.scene);
      const fallbacks = result.scene.nodes.filter((node) => node.kind === "fallback");
      expect(fallbacks.map((node) => node.reason), entry.name).toEqual(entry.reasons);
      expect(result.diagnostics, entry.name).toEqual(fallbacks.map((node) => ({
        path: node.sourcePath,
        kind: "fallback",
        reason: node.reason,
      })));
      expect(result.scene.nodes.filter((node) => node.kind === "connector"), entry.name)
        .toHaveLength(entry.connectors);
      expect(result.scene.nodes.filter((node) =>
        node.sourcePath.startsWith("state.transitions[") &&
        node.kind === "connector").every((node) =>
        node.arrowStart === "none" && node.arrowEnd === "stealth"), entry.name).toBe(true);
      const text = result.scene.nodes.flatMap((node) =>
        node.text?.paragraphs.flatMap((paragraph) =>
          paragraph.runs.map((run) => run.text)) || []);
      for (const expected of entry.nativeText) {
        expect(text, `${entry.name}: ${expected}`).toContain(expected);
      }
      expect(result.scene.nodes.some((node) => node.sourcePath === "svg"), entry.name)
        .toBe(false);
      expect(new Set(result.scene.nodes.map((node) => node.sourcePath)).size, entry.name)
        .toBe(result.scene.nodes.length);
      for (const fallback of fallbacks) {
        expect(result.sources.find((source) => source.path === fallback.sourcePath), entry.name)
          .toBeDefined();
      }
      const mapped = sceneToPptxElements(result.scene);
      expect(mapped.fallbacks.map((fallback) => fallback.sourcePath), entry.name)
        .toEqual(fallbacks.map((fallback) => fallback.sourcePath));
      expect(inspectPptxPackage(buildPptxPackage({
        slides: [{ elements: mapped.elements }],
      })).valid, entry.name).toBe(true);
    }
  } finally {
    await harness.close();
  }
});

test("rejects malformed state roots and bounds nested state depth explicitly", async ({ page }) => {
  const harness = await startHarness({ slides: ["# State structure limits"] });
  try {
    await page.goto(harness.url);
    await sceneFromFixture(page, await readFixture("state-basic.svg"), "state-malformed.svg");
    const malformed = await updateFixture(page, () => {
      document.querySelector("g.root > g.edgeLabels").remove();
    });
    expect(malformed.scene.nodes).toMatchObject([{
      kind: "fallback",
      sourcePath: "svg",
      reason: "unsupported-mermaid-state-structure",
    }]);

    const depth = 18;
    const nested = [
      "stateDiagram-v2",
      "[*] --> S0",
      ...Array.from({ length: depth }, (_, index) => `${"  ".repeat(index)}state S${index} {`),
      `${"  ".repeat(depth)}[*] --> Leaf`,
      `${"  ".repeat(depth)}Leaf --> [*]`,
      ...Array.from({ length: depth }, (_, offset) =>
        `${"  ".repeat(depth - offset - 1)}}`),
      "S0 --> [*]",
    ].join("\n");
    const limited = await sceneFromMermaidSource(page, nested, "state-depth.svg");
    validateScene(limited.scene);
    expect(limited.scene.nodes.some((node) =>
      node.reason === "unsupported-mermaid-state-depth")).toBe(true);
    expect(limited.scene.nodes.some((node) =>
      node.reason?.startsWith("mermaid-scene-adapter-failed"))).toBe(false);
    expect(limited.scene.nodes.some((node) => node.sourcePath === "svg")).toBe(false);
  } finally {
    await harness.close();
  }
});

test("keeps unsupported packet fields and labels local while preserving sibling rows", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Packet fallback boundaries"] });
  try {
    await page.goto(harness.url);
    const fixture = await readFixture("packet.svg");
    const cases = [
      {
        name: "label effect",
        mutate: () => {
          document.querySelector("text.packetLabel").style.filter = "blur(1px)";
        },
        fallback: {
          sourcePath: "packet.rows[0].labels[0]",
          reason: "unsupported-mermaid-packet-text-style",
        },
        shapes: 9,
        texts: 27,
        sourceTag: "text",
      },
      {
        name: "label positioning",
        mutate: () => {
          document.querySelector("text.packetLabel").setAttribute("textLength", "90");
        },
        fallback: {
          sourcePath: "packet.rows[0].labels[0]",
          reason: "unsupported-mermaid-text-transform",
        },
        shapes: 9,
        texts: 27,
        sourceTag: "text",
      },
      {
        name: "field geometry",
        mutate: () => {
          const rect = document.querySelector("rect.packetBlock");
          const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
          polygon.setAttribute("class", "packetBlock");
          const x = Number(rect.getAttribute("x"));
          const y = Number(rect.getAttribute("y"));
          const width = Number(rect.getAttribute("width"));
          const height = Number(rect.getAttribute("height"));
          polygon.setAttribute(
            "points",
            `${x},${y} ${x + width},${y} ${x + width / 2},${y + height}`,
          );
          rect.replaceWith(polygon);
        },
        fallback: {
          sourcePath: "packet.rows[0].fields[0]",
          reason: "unsupported-mermaid-packet-field-geometry",
        },
        shapes: 8,
        texts: 28,
        sourceTag: "polygon",
      },
      {
        name: "field transform",
        mutate: () => {
          document.querySelector("rect.packetBlock").setAttribute("transform", "skewX(8)");
        },
        fallback: {
          sourcePath: "packet.rows[0].fields[0]",
          reason: "unsupported-mermaid-packet-field-transform",
        },
        shapes: 8,
        texts: 28,
        sourceTag: "rect",
      },
    ];
    for (const entry of cases) {
      await sceneFromFixture(page, fixture, `packet-${entry.name}.svg`);
      const result = await updateFixture(page, entry.mutate);
      expect(result.scene.nodes.filter((node) => node.kind === "fallback"), entry.name)
        .toMatchObject([entry.fallback]);
      expect(result.scene.nodes.filter((node) => node.kind === "shape"), entry.name)
        .toHaveLength(entry.shapes);
      expect(result.scene.nodes.filter((node) => node.kind === "text"), entry.name)
        .toHaveLength(entry.texts);
      expect(result.scene.nodes.some((node) => node.sourcePath === "svg"), entry.name).toBe(false);
      expect(result.scene.nodes.some((node) => node.text?.paragraphs.some((paragraph) =>
        paragraph.runs.some((run) => run.text === "末尾 Tail"))), entry.name).toBe(true);
      expect(result.sources.find((source) => source.path === entry.fallback.sourcePath), entry.name)
        .toMatchObject({ tag: entry.sourceTag });
      expect(sceneToPptxElements(result.scene).fallbacks.map((fallback) => fallback.sourcePath), entry.name)
        .toEqual([entry.fallback.sourcePath]);
    }

    await sceneFromFixture(page, fixture, "packet-row-opacity.svg");
    const row = await updateFixture(page, () => {
      document.querySelectorAll("svg > g")[1].style.opacity = "0.5";
    });
    expect(row.scene.nodes.filter((node) => node.kind === "fallback")).toMatchObject([{
      sourcePath: "packet.rows[0]",
      reason: "unsupported-mermaid-packet-row-style",
    }]);
    expect(row.scene.nodes.filter((node) => node.kind === "shape")).toHaveLength(4);
    expect(row.scene.nodes.filter((node) => node.kind === "text")).toHaveLength(13);
    expect(row.scene.nodes.some((node) => node.text?.paragraphs.some((paragraph) =>
      paragraph.runs.some((run) => run.text === "Payload length")))).toBe(true);
    expect(row.sources.find((source) => source.path === "packet.rows[0]"))
      .toMatchObject({ tag: "g" });

    for (const bitIndex of [0, 5, 9]) {
      await sceneFromFixture(page, fixture, `packet-missing-bit-${bitIndex}.svg`);
      await page.evaluate((index) => {
        const row = [...document.querySelectorAll("svg > g")]
          .find((group) => group.querySelector(":scope > rect.packetBlock"));
        row.querySelectorAll("text.packetByte")[index].remove();
      }, bitIndex);
      const missing = await updateFixture(page, () => {});
      expect(missing.scene.nodes.filter((node) => node.kind === "fallback"), `bit ${bitIndex}`)
        .toMatchObject([{
          sourcePath: "packet.rows[0]",
          reason: "unsupported-mermaid-packet-row-structure",
        }]);
      expect(missing.diagnostics, `bit ${bitIndex}`).toEqual([{
        path: "packet.rows[0]",
        kind: "fallback",
        reason: "unsupported-mermaid-packet-row-structure",
      }]);
      expect(missing.scene.nodes.filter((node) => node.kind === "shape"), `bit ${bitIndex}`)
        .toHaveLength(4);
      expect(missing.scene.nodes.filter((node) => node.kind === "text"), `bit ${bitIndex}`)
        .toHaveLength(13);
      expect(missing.scene.nodes.find((node) => node.sourcePath === "packet.title"), `bit ${bitIndex}`)
        .toMatchObject({ kind: "text" });
      expect(missing.scene.nodes.some((node) => node.text?.paragraphs.some((paragraph) =>
        paragraph.runs.some((run) => run.text === "Payload length"))), `bit ${bitIndex}`).toBe(true);
      expect(sceneToPptxElements(missing.scene).fallbacks.map((fallback) => fallback.sourcePath),
        `bit ${bitIndex}`).toEqual(["packet.rows[0]"]);
    }
  } finally {
    await harness.close();
  }
});

test("keeps unsupported treeView labels and branches local unless the tree group must composite", async ({ page }) => {
  const harness = await startHarness({ slides: ["# treeView fallback boundaries"] });
  try {
    await page.goto(harness.url);
    const fixture = await readFixture("tree-view.svg");
    const cases = [
      {
        name: "label positioning",
        mutate: () => {
          document.querySelector("text.treeView-node-label").setAttribute("textLength", "40");
        },
        fallback: {
          sourcePath: "treeView.labels[0]",
          reason: "unsupported-mermaid-text-transform",
        },
        connectors: 15,
        texts: 9,
        sourceTag: "text",
      },
      {
        name: "line effect",
        mutate: () => {
          document.querySelector("line.treeView-node-line").style.filter = "blur(1px)";
        },
        fallback: {
          sourcePath: "treeView.lines[0]",
          reason: "unsupported-mermaid-tree-view-line-style",
        },
        connectors: 14,
        texts: 10,
        sourceTag: "line",
      },
      {
        name: "line transform",
        mutate: () => {
          document.querySelector("line.treeView-node-line").setAttribute("transform", "skewX(8)");
        },
        fallback: {
          sourcePath: "treeView.lines[0]",
          reason: "unsupported-mermaid-tree-view-line-transform",
        },
        connectors: 14,
        texts: 10,
        sourceTag: "line",
      },
      {
        name: "line geometry",
        mutate: () => {
          const line = document.querySelector("line.treeView-node-line");
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("class", "treeView-node-line");
          path.setAttribute("d", "M0 0 Q5 10 10 0");
          line.replaceWith(path);
        },
        fallback: {
          sourcePath: "treeView.lines[0]",
          reason: "unsupported-mermaid-tree-view-line-geometry",
        },
        connectors: 14,
        texts: 10,
        sourceTag: "path",
      },
    ];
    for (const entry of cases) {
      await sceneFromFixture(page, fixture, `tree-view-${entry.name}.svg`);
      const result = await updateFixture(page, entry.mutate);
      expect(result.scene.nodes.filter((node) => node.kind === "fallback"), entry.name)
        .toMatchObject([entry.fallback]);
      expect(result.scene.nodes.filter((node) => node.kind === "connector"), entry.name)
        .toHaveLength(entry.connectors);
      expect(result.scene.nodes.filter((node) => node.kind === "text"), entry.name)
        .toHaveLength(entry.texts);
      expect(result.scene.nodes.some((node) => node.sourcePath === "svg"), entry.name).toBe(false);
      expect(result.scene.nodes.some((node) => node.text?.paragraphs.some((paragraph) =>
        paragraph.runs.some((run) => run.text === "葉 B"))), entry.name).toBe(true);
      expect(result.sources.find((source) => source.path === entry.fallback.sourcePath), entry.name)
        .toMatchObject({ tag: entry.sourceTag });
      expect(sceneToPptxElements(result.scene).fallbacks.map((fallback) => fallback.sourcePath), entry.name)
        .toEqual([entry.fallback.sourcePath]);
    }

    await sceneFromFixture(page, fixture, "tree-view-decoration.svg");
    const decoration = await updateFixture(page, () => {
      document.querySelector("g.tree-view").insertAdjacentHTML(
        "beforeend",
        '<circle id="tree-decoration" cx="120" cy="30" r="5" fill="red"/>',
      );
    });
    expect(decoration.scene.nodes.filter((node) => node.kind === "fallback")).toMatchObject([{
      sourcePath: "treeView.unknown[0]",
      reason: "unsupported-mermaid-svg-element",
    }]);
    expect(decoration.scene.nodes.filter((node) => node.kind === "connector")).toHaveLength(15);
    expect(decoration.scene.nodes.filter((node) => node.kind === "text")).toHaveLength(10);

    await sceneFromFixture(page, fixture, "tree-view-opacity.svg");
    const composite = await updateFixture(page, () => {
      document.querySelector("g.tree-view").style.opacity = "0.5";
    });
    expect(composite.scene.nodes).toMatchObject([{
      kind: "fallback",
      sourcePath: "treeView",
      reason: "unsupported-mermaid-tree-view-style",
    }]);
    expect(composite.sources.find((source) => source.path === "treeView"))
      .toMatchObject({ tag: "g" });
  } finally {
    await harness.close();
  }
});

test("rejects malformed and excessive packet or treeView structures explicitly", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Special diagram limits"] });
  try {
    await page.goto(harness.url);

    await sceneFromFixture(page, await readFixture("packet.svg"), "packet-malformed.svg");
    const packetMalformed = await updateFixture(page, () => {
      document.querySelector("text.packetTitle").remove();
    });
    expect(packetMalformed.scene.nodes).toMatchObject([{
      kind: "fallback",
      sourcePath: "svg",
      reason: "unsupported-mermaid-packet-structure",
    }]);

    await sceneFromFixture(page, await readFixture("tree-view.svg"), "tree-view-malformed.svg");
    const treeMalformed = await updateFixture(page, () => {
      document.querySelector("g.tree-view").classList.remove("tree-view");
    });
    expect(treeMalformed.scene.nodes).toMatchObject([{
      kind: "fallback",
      sourcePath: "svg",
      reason: "unsupported-mermaid-tree-view-structure",
    }]);

    await sceneFromFixture(page, await readFixture("packet.svg"), "packet-depth.svg");
    const depth = await updateFixture(page, () => {
      let root = document.createElementNS("http://www.w3.org/2000/svg", "g");
      root.setAttribute("class", "label");
      document.querySelector("svg").append(root);
      for (let index = 0; index < 17; index += 1) {
        const child = document.createElementNS("http://www.w3.org/2000/svg", "g");
        child.setAttribute("class", "label");
        root.append(child);
        root = child;
      }
      root.insertAdjacentHTML("beforeend", '<circle cx="20" cy="20" r="5" fill="red"/>');
    });
    expect(depth.scene.nodes.filter((node) =>
      node.reason === "unsupported-mermaid-packet-depth")).toHaveLength(1);
    expect(depth.scene.nodes.filter((node) => node.kind === "shape")).toHaveLength(9);
    expect(depth.scene.nodes.filter((node) => node.kind === "text")).toHaveLength(28);

    await sceneFromFixture(page, await readFixture("packet.svg"), "packet-limit.svg");
    const limited = await updateFixture(page, () => {
      const svg = document.querySelector("svg");
      for (let index = 0; index < 1100; index += 1) {
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", String(index % 100));
        text.setAttribute("y", String(20 + index % 50));
        text.textContent = `x${index}`;
        svg.append(text);
      }
    });
    expect(limited.scene.nodes).toMatchObject([{
      kind: "fallback",
      sourcePath: "svg",
      reason: expect.stringContaining("mermaid-scene-limit-exceeded"),
    }]);
    expect(limited.diagnostics.some((entry) =>
      entry.reason.includes("mermaid-scene-limit-exceeded"))).toBe(true);
  } finally {
    await harness.close();
  }
});

test("derives rotated text bounds and centers from actual Mermaid CTMs", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Rotated text geometry"] });
  try {
    await page.goto(harness.url);
    const fixture = await readFixture("rotated-text.svg");
    const cases = await page.evaluate(async (source) => {
      const parsed = new DOMParser().parseFromString(source, "image/svg+xml").documentElement;
      const style = parsed.querySelector("style").outerHTML;
      const axis = [...parsed.querySelectorAll("text")].find((element) => element.textContent === "Revenue");
      const transforms = [
        "translate(5, 255) rotate(390 12 7)",
        "translate(5, 255) rotate(-405 -4 6)",
        "translate(5, 255) rotate(630)",
      ];
      const anchors = ["middle", "end", "start"];
      const output = [];
      for (const [caseIndex, transform] of transforms.entries()) {
        document.body.innerHTML = [
          "<style>body{margin:0}#fixture-deck{position:relative;width:900px;height:650px;margin:19px 0 0 31px}</style>",
          `<div id="fixture-deck"><svg class="flowchart" aria-roledescription="flowchart-v2" viewBox="0 0 700 500"`,
          ` style="width:560px;max-width:none;transform-origin:0 0;transform:translate(23px,17px) scale(1.15)">`,
          style,
          '<g class="root"><g class="clusters"></g><g class="edgePaths"></g><g class="edgeLabels"></g><g class="nodes"></g>',
          `<g class="label" transform="translate(17 11) scale(1.2)">${axis.outerHTML}</g></g></svg></div>`,
        ].join("");
        const text = [...document.querySelectorAll("text")].find((element) => element.textContent === "Revenue");
        text.setAttribute("transform", transform);
        text.setAttribute("text-anchor", anchors[caseIndex]);
        const deck = document.querySelector("#fixture-deck");
        const { mermaidSvgToScene } = await import("./renderer/mermaid-scene.mjs");
        const { sceneToSvg } = await import("./renderer/scene-svg.mjs");
        const result = mermaidSvgToScene(deck.querySelector("svg"), {
          deck,
          includeSourceElements: true,
        });
        const node = result.scene.nodes.find((entry) =>
          entry.text?.paragraphs.some((paragraph) =>
            paragraph.runs.some((run) => run.text === "Revenue")));
        const box = text.getBBox();
        const matrix = text.getScreenCTM();
        const computed = getComputedStyle(text);
        const deckRect = deck.getBoundingClientRect();
        const scale = Math.hypot(matrix.a, matrix.b);
        const center = new DOMPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        ).matrixTransform(matrix);
        const expected = {
          x: center.x - deckRect.left - box.width * scale / 2,
          y: center.y - deckRect.top - box.height * scale / 2,
          width: box.width * scale,
          height: box.height * scale,
        };
        const rendered = sceneToSvg(result.scene);
        const renderedOwner = [...rendered.querySelectorAll("[data-scene-source-path]")]
          .find((element) => element.getAttribute("data-scene-source-path") === node.sourcePath);
        output.push({
          transform,
          diagnostics: result.diagnostics,
          node,
          expected,
          expectedRun: {
            fontFace: computed.fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, ""),
            color: computed.fill,
            opacity: Number(computed.opacity) * Number(computed.fillOpacity),
          },
          sourceOwned: result.sourceElements.get(node.sourcePath) === text,
          renderedTransform: renderedOwner.querySelector("g[transform]")?.getAttribute("transform"),
        });
      }
      return output;
    }, fixture);

    expect(cases.map((entry) => entry.node.rotation)).toEqual([30, -45, -90]);
    expect(cases.map((entry) => entry.node.text.paragraphs[0].alignment))
      .toEqual(["center", "right", "left"]);
    for (const entry of cases) {
      expect(entry.diagnostics, entry.transform).toEqual([]);
      expect(entry.sourceOwned, entry.transform).toBe(true);
      expect(entry.node.kind, entry.transform).toBe("text");
      expect(entry.node.z, entry.transform).toBe(0);
      expect(entry.node.text.paragraphs[0].runs[0], entry.transform).toMatchObject({
        text: "Revenue",
        ...entry.expectedRun,
      });
      expect(entry.node.text.paragraphs[0].runs[0].fontSize, entry.transform).toBeGreaterThan(0);
      expect(entry.renderedTransform, entry.transform).toBe(
        `rotate(${entry.node.rotation} ${entry.node.bounds.x + entry.node.bounds.width / 2} ${entry.node.bounds.y + entry.node.bounds.height / 2})`,
      );
      for (const key of ["x", "y", "width", "height"]) {
        expect(Math.abs(entry.node.bounds[key] - entry.expected[key]), `${entry.transform}: ${key}`)
          .toBeLessThanOrEqual(0.11);
      }
    }
    const mapped = sceneToPptxElements({
      version: 1,
      source: { kind: "mermaid", path: "rotated-text.svg" },
      width: 900,
      height: 650,
      nodes: cases.map((entry, index) => ({ ...entry.node, z: index })),
    });
    expect(mapped.fallbacks).toEqual([]);
    expect(mapped.elements.map((element) => element.rotation)).toEqual([30, -45, -90]);
    const xml = buildPptxPackage({ slides: [{ elements: mapped.elements }] }).toString("utf8");
    expect(xml).toContain('<a:xfrm rot="1800000">');
    expect(xml).toContain('<a:xfrm rot="-2700000">');
    expect(xml).toContain('<a:xfrm rot="-5400000">');
  } finally {
    await harness.close();
  }
});

test("keeps skew, reflection, nonuniform scale, and per-glyph transforms local to text", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Unsupported text transforms"] });
  try {
    await page.goto(harness.url);
    const fixture = await readFixture("sequence.svg");
    for (const entry of [
      {
        name: "skew",
        mutate: () => {
          document.querySelector("text.messageText").setAttribute("transform", "skewX(12)");
        },
      },
      {
        name: "reflection",
        mutate: () => {
          document.querySelector("text.messageText").setAttribute("transform", "scale(-1 1)");
        },
      },
      {
        name: "nonuniform",
        mutate: () => {
          document.querySelector("text.messageText").setAttribute("transform", "scale(1.2 .8)");
        },
      },
      {
        name: "descendant-transform",
        mutate: () => {
          const text = document.querySelector("text.messageText");
          text.innerHTML = '<tspan transform="rotate(15)">Request</tspan>';
        },
      },
      {
        name: "source-rotate",
        mutate: () => {
          document.querySelector("text.messageText").setAttribute("rotate", "15");
        },
      },
      {
        name: "glyph-rotate-list",
        mutate: () => {
          const text = document.querySelector("text.messageText");
          text.innerHTML = '<tspan rotate="10 20 30 40 50 60 70">Request</tspan>';
        },
      },
      {
        name: "text-length",
        mutate: () => {
          const text = document.querySelector("text.messageText");
          text.setAttribute("textLength", "140");
          text.setAttribute("lengthAdjust", "spacingAndGlyphs");
        },
      },
      {
        name: "glyph-dx",
        mutate: () => {
          const text = document.querySelector("text.messageText");
          text.innerHTML = '<tspan dx="20">Request</tspan>';
        },
      },
      {
        name: "glyph-x-list",
        mutate: () => {
          const text = document.querySelector("text.messageText");
          text.innerHTML = '<tspan x="10 20">Request</tspan>';
        },
      },
    ]) {
      await sceneFromFixture(page, fixture, `${entry.name}.svg`);
      const result = await updateFixture(page, entry.mutate);
      const fallbacks = result.scene.nodes.filter((node) => node.kind === "fallback");
      expect(fallbacks, entry.name).toHaveLength(1);
      expect(fallbacks, entry.name).toMatchObject([{
        reason: "unsupported-mermaid-text-transform",
      }]);
      expect(fallbacks[0].sourcePath, entry.name).toMatch(/^sequence\[\d+\]$/);
      expect(result.sources.find((source) => source.path === fallbacks[0].sourcePath), entry.name)
        .toMatchObject({ tag: "text" });
      expect(result.scene.nodes.some((node) => node.sourcePath === "svg"), entry.name).toBe(false);
      expect(result.scene.nodes.filter((node) => node.kind === "connector"), entry.name).toHaveLength(4);
      expect(result.scene.nodes.filter((node) => node.kind === "text"), entry.name).toHaveLength(6);
      expect(result.scene.nodes.some((node) => node.text?.paragraphs.some((paragraph) =>
        paragraph.runs.some((run) => run.text === "Response"))), entry.name).toBe(true);
    }

    await sceneFromFixture(page, fixture, "supported-multiline-tspan.svg");
    const supported = await updateFixture(page, () => {
      const text = document.querySelector("text.messageText");
      const x = text.getAttribute("x");
      text.innerHTML = `<tspan x="${x}" dy="-8">Upper</tspan><tspan x="${x}" dy="8">Lower</tspan>`;
    });
    expect(supported.scene.nodes.filter((node) => node.kind === "fallback")).toEqual([]);
    const multiline = supported.scene.nodes.find((node) =>
      node.text?.paragraphs.some((paragraph) =>
        paragraph.runs.some((run) => run.text === "Upper")));
    expect(multiline).toMatchObject({ kind: "text" });
    expect(multiline.text.paragraphs.map((paragraph) =>
      paragraph.runs.map((run) => run.text).join(""))).toEqual(["Upper", "Lower"]);
    expect(supported.sources.find((source) => source.path === multiline.sourcePath))
      .toMatchObject({ tag: "text" });
    expect(supported.scene.nodes.filter((node) => node.kind === "connector")).toHaveLength(4);
    expect(supported.scene.nodes.filter((node) => node.kind === "text")).toHaveLength(7);
  } finally {
    await harness.close();
  }
});

test("keeps simple rotated flowchart, class, and sequence labels editable", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Rotated adapter labels"] });
  try {
    await page.goto(harness.url);
    const cases = [
      {
        fixture: "flowchart.svg",
        text: "Web",
        lines: ["Web", "Client"],
        rotation: 25,
        source: (svg) => svg.replace("<p>Browser</p>", "<p>Web<br/>Client</p>"),
        mutate: () => {
          const label = document.querySelector("g.node > g.label");
          label.setAttribute("transform", `${label.getAttribute("transform")} rotate(25)`);
        },
      },
      {
        fixture: "class.svg",
        text: "Animal",
        lines: ["Animal"],
        rotation: -35,
        mutate: () => {
          const label = [...document.querySelectorAll("span.nodeLabel")]
            .find((element) => element.textContent.trim() === "Animal");
          const owner = label.closest("g");
          owner.setAttribute("transform", `${owner.getAttribute("transform") || ""} rotate(-35)`);
        },
      },
      {
        fixture: "sequence.svg",
        text: "Request",
        lines: ["Request"],
        rotation: 60,
        mutate: () => {
          const label = document.querySelector("text.messageText");
          const box = label.getBBox();
          label.setAttribute(
            "transform",
            `rotate(60 ${box.x + box.width / 2} ${box.y + box.height / 2})`,
          );
        },
      },
    ];
    for (const entry of cases) {
      const fixture = await readFixture(entry.fixture);
      await sceneFromFixture(
        page,
        entry.source ? entry.source(fixture) : fixture,
        `rotated-${entry.fixture}`,
      );
      const result = await updateFixture(page, entry.mutate);
      const node = result.scene.nodes.find((candidate) =>
        candidate.kind === "text" &&
        candidate.text.paragraphs.some((paragraph) =>
          paragraph.runs.some((run) => run.text === entry.text)));
      expect(node, entry.fixture).toMatchObject({ rotation: entry.rotation });
      expect(node.text.paragraphs.map((paragraph) =>
        paragraph.runs.map((run) => run.text).join("")), entry.fixture).toEqual(entry.lines);
      expect(result.scene.nodes.filter((candidate) => candidate.kind === "fallback"), entry.fixture)
        .toEqual([]);
      expect(result.sources.some((source) => source.path === node.sourcePath), entry.fixture).toBe(true);
      const mapped = sceneToPptxElements(result.scene);
      expect(mapped.elements.find((element) => element.path === node.sourcePath), entry.fixture)
        .toMatchObject({ type: "text", rotation: entry.rotation });
    }
  } finally {
    await harness.close();
  }
});

test("extracts pinned color, element, fill, and stroke alpha independently into SVG and DrawingML", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Paint alpha"] });
  try {
    await page.goto(harness.url);
    const result = await sceneFromFixture(
      page,
      await readFixture("paint-alpha.svg"),
      "paint-alpha.svg",
    );
    validateScene(result.scene);
    expect(result.diagnostics).toEqual([]);
    expect(result.scene.nodes.map((node) => node.z)).toEqual([0, 1, 2, 3]);
    expect(result.scene.nodes.map((node) => node.sourcePath)).toEqual([
      "edges[0]",
      "edgeLabels[L_A_B_0]",
      "nodes[0]",
      "nodes[1]",
    ]);

    const edge = result.scene.nodes.find((node) => node.sourcePath === "edges[0]");
    const rect = result.scene.nodes.find((node) => node.sourcePath === "nodes[0]");
    const circle = result.scene.nodes.find((node) => node.sourcePath === "nodes[1]");
    expect(edge.style).toMatchObject({
      stroke: "rgba(0, 136, 204, 0.5)",
      opacity: 0.5,
      strokeOpacity: 0.4,
    });
    expect(rect.style).toMatchObject({
      fill: "rgba(51, 102, 153, 0.5)",
      stroke: "rgba(204, 51, 0, 0.5)",
      opacity: 0.8,
      fillOpacity: 0.5,
      strokeOpacity: 0.25,
    });
    expect(circle.style).toMatchObject({
      fill: "rgba(34, 170, 68, 0.5)",
      stroke: "rgba(136, 68, 204, 0.5)",
      opacity: 0.6,
      fillOpacity: 0.7,
      strokeOpacity: 0.3,
    });
    expect(result.scene.nodes.flatMap((node) => node.text?.paragraphs || [])
      .flatMap((paragraph) => paragraph.runs.map((run) => run.text)))
      .toEqual(expect.arrayContaining(["経路", "塗り", "線"]));

    const mapped = sceneToPptxElements(result.scene);
    expect(mapped.fallbacks).toEqual([]);
    expect(mapped.elements.find((element) => element.path === "nodes[0]")).toMatchObject({
      opacity: 0.8,
      fillOpacity: 0.5,
      strokeOpacity: 0.25,
    });
    expect(mapped.elements.find((element) => element.path === "edges[0]")).toMatchObject({
      opacity: 0.5,
      strokeOpacity: 0.4,
    });
    const xml = buildPptxPackage({ slides: [{ elements: mapped.elements }] }).toString("utf8");
    expect(xml).toContain('<a:srgbClr val="336699"><a:alpha val="20000"/></a:srgbClr>');
    expect(xml).toContain('<a:srgbClr val="CC3300"><a:alpha val="10000"/></a:srgbClr>');
    expect(xml).toContain('<a:srgbClr val="22AA44"><a:alpha val="21000"/></a:srgbClr>');
    expect(xml).toContain('<a:srgbClr val="8844CC"><a:alpha val="9000"/></a:srgbClr>');
    expect(xml).toContain('<a:srgbClr val="0088CC"><a:alpha val="10000"/></a:srgbClr>');

    const owned = await updateFixture(page, () => {});
    expect(owned.sources).toEqual(expect.arrayContaining([
      { path: "edges[0]", tag: "path", id: "fixture-paint-alpha-L_A_B_0" },
      { path: "nodes[0]", tag: "g", id: "fixture-paint-alpha-flowchart-A-0" },
      { path: "nodes[1]", tag: "g", id: "fixture-paint-alpha-flowchart-B-1" },
    ]));
    const rendered = await page.evaluate(async () => {
      const { sceneToSvg } = await import("./renderer/scene-svg.mjs");
      const svg = sceneToSvg(window.__mermaidSceneResult.scene);
      const primitive = (path) => {
        const owner = [...svg.querySelectorAll("[data-scene-source-path]")]
          .find((node) => node.getAttribute("data-scene-source-path") === path);
        return owner?.querySelector("rect, circle, ellipse, path, polygon");
      };
      return Object.fromEntries(["edges[0]", "nodes[0]", "nodes[1]"].map((path) => {
        const element = primitive(path);
        return [path, {
          fill: element?.getAttribute("fill"),
          stroke: element?.getAttribute("stroke"),
          opacity: element?.getAttribute("opacity"),
          fillOpacity: element?.getAttribute("fill-opacity"),
          strokeOpacity: element?.getAttribute("stroke-opacity"),
        }];
      }));
    });
    expect(rendered).toEqual({
      "edges[0]": {
        fill: "none",
        stroke: "rgba(0, 136, 204, 0.5)",
        opacity: "0.5",
        fillOpacity: "1",
        strokeOpacity: "0.4",
      },
      "nodes[0]": {
        fill: "rgba(51, 102, 153, 0.5)",
        stroke: "rgba(204, 51, 0, 0.5)",
        opacity: "0.8",
        fillOpacity: "0.5",
        strokeOpacity: "0.25",
      },
      "nodes[1]": {
        fill: "rgba(34, 170, 68, 0.5)",
        stroke: "rgba(136, 68, 204, 0.5)",
        opacity: "0.6",
        fillOpacity: "0.7",
        strokeOpacity: "0.3",
      },
    });
  } finally {
    await harness.close();
  }
});

test("keeps class and sequence paint alpha native while localizing unsafe composite overlap", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Paint alpha surfaces"] });
  try {
    await page.goto(harness.url);

    await sceneFromFixture(page, await readFixture("class-containers.svg"), "class-alpha.svg");
    const classes = await updateFixture(page, () => {
      const set = (element, styles) => Object.assign(element.style, styles);
      set(document.querySelector("g.cluster > rect"), {
        fill: "rgba(10, 20, 30, 0.5)",
        fillOpacity: "0.4",
        stroke: "rgba(40, 50, 60, 0.5)",
        strokeOpacity: "0.3",
        opacity: "0.8",
      });
      const note = document.querySelector("g.node:has(.noteLabel) g.label-container");
      for (const path of note.querySelectorAll("path")) {
        set(path, {
          fill: "rgba(70, 80, 90, 0.5)",
          fillOpacity: "0.6",
          stroke: "rgba(100, 110, 120, 0.5)",
          strokeOpacity: "0.2",
          opacity: "0.8",
        });
      }
      const classNode = [...document.querySelectorAll("g.node")]
        .find((group) => !group.querySelector(".noteLabel"));
      for (const path of classNode.querySelectorAll(":scope > g.label-container > path")) {
        set(path, {
          fill: "rgba(130, 140, 150, 0.5)",
          fillOpacity: "0.7",
          stroke: "rgba(160, 170, 180, 0.5)",
          strokeOpacity: "0.25",
          opacity: "0.9",
        });
      }
      set(classNode.querySelector("g.divider path"), {
        stroke: "rgba(190, 200, 210, 0.5)",
        strokeOpacity: "0.4",
        opacity: "0.8",
      });
    });
    expect(classes.diagnostics).toEqual([]);
    expect(classes.scene.nodes.filter((node) => node.kind === "fallback")).toEqual([]);
    const namespace = classes.scene.nodes.find((node) => node.meta?.mermaid?.kind === "class-namespace");
    expect(namespace.style).toMatchObject({
      opacity: 0.8,
      fillOpacity: 0.4,
      strokeOpacity: 0.3,
    });
    const classPaths = classes.scene.nodes.filter((node) => /^classes\[0\]\.paths\[\d+\]$/.test(node.sourcePath));
    expect(classPaths).toHaveLength(2);
    expect(classPaths.every((node) => node.style.opacity === 0.9 &&
      node.style.fillOpacity === 0.7 && node.style.strokeOpacity === 0.25)).toBe(true);
    const notePaths = classes.scene.nodes.filter((node) => /^notes\[0\]\.paths\[\d+\]$/.test(node.sourcePath));
    expect(notePaths).toHaveLength(2);
    expect(notePaths.every((node) => node.meta?.mermaid?.kind === "class-note")).toBe(true);
    const divider = classes.scene.nodes.find((node) => node.sourcePath === "classes[0].dividers[0]");
    expect(divider).toMatchObject({
      kind: "connector",
      style: {
        fill: null,
        stroke: "rgba(190, 200, 210, 0.5)",
        opacity: 0.8,
        strokeOpacity: 0.4,
      },
    });
    expect(classes.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "namespaces[0]", tag: "rect" }),
      expect.objectContaining({ path: "classes[0]", tag: "g" }),
      expect.objectContaining({ path: "notes[0]", tag: "g" }),
      expect.objectContaining({ path: "classes[0].dividers[0]", tag: "path" }),
    ]));
    const classMapped = sceneToPptxElements(classes.scene);
    expect(classMapped.fallbacks).toEqual([]);
    const classXml = buildPptxPackage({ slides: [{ elements: classMapped.elements }] }).toString("utf8");
    expect(classXml).toContain('<a:srgbClr val="0A141E"><a:alpha val="16000"/></a:srgbClr>');
    expect(classXml).toContain('<a:srgbClr val="28323C"><a:alpha val="12000"/></a:srgbClr>');
    expect(classXml).toContain('<a:srgbClr val="828C96"><a:alpha val="31500"/></a:srgbClr>');
    expect(classXml).toContain('<a:srgbClr val="A0AAB4"><a:alpha val="11250"/></a:srgbClr>');
    expect(classXml).toContain('<a:srgbClr val="BEC8D2"><a:alpha val="16000"/></a:srgbClr>');

    await sceneFromFixture(page, await readFixture("sequence-decorations.svg"), "sequence-alpha.svg");
    const sequence = await updateFixture(page, () => {
      const set = (element, styles) => Object.assign(element.style, styles);
      set(document.querySelector("g.actor-man circle"), {
        fill: "rgba(10, 20, 30, 0.5)",
        fillOpacity: "0.4",
        stroke: "rgba(40, 50, 60, 0.5)",
        strokeOpacity: "0.3",
        opacity: "0.8",
      });
      set(document.querySelector("g.actor-man line"), {
        stroke: "rgba(70, 80, 90, 0.5)",
        strokeOpacity: "0.4",
        opacity: "0.8",
      });
      set(document.querySelector("polygon.labelBox"), {
        fill: "rgba(100, 110, 120, 0.5)",
        fillOpacity: "0.6",
        stroke: "rgba(130, 140, 150, 0.5)",
        strokeOpacity: "0.2",
        opacity: "0.7",
      });
      set(document.querySelector("line.loopLine"), {
        stroke: "rgba(160, 170, 180, 0.5)",
        strokeOpacity: "0.3",
        opacity: "0.8",
      });
      set(document.querySelector("svg > rect.rect"), {
        fill: "rgba(20, 40, 60, 0.5)",
        fillOpacity: "0.4",
        stroke: "rgba(80, 100, 120, 0.5)",
        strokeOpacity: "0.2",
        opacity: "0.8",
      });
      set(document.querySelector("rect.actor"), {
        fill: "rgba(20, 80, 40, 0.5)",
        fillOpacity: "0.6",
        stroke: "rgba(120, 40, 20, 0.5)",
        strokeOpacity: "0.25",
        opacity: "0.8",
      });
      const message = document.querySelector("[data-et=message]");
      set(message, {
        stroke: "rgba(0, 120, 200, 0.5)",
        strokeOpacity: "0.4",
        opacity: "0.8",
      });
      const markerId = /#([^")]+)[")]*$/.exec(getComputedStyle(message).markerEnd)?.[1];
      const originalMarker = document.getElementById(markerId);
      const marker = originalMarker.cloneNode(true);
      marker.id = "alpha-sequence-arrowhead";
      originalMarker.parentElement.append(marker);
      message.style.markerEnd = `url(#${marker.id})`;
      const markerPath = marker.firstElementChild;
      markerPath.style.setProperty("fill", "rgba(0, 120, 200, 0.5)", "important");
      markerPath.style.fillOpacity = "0.4";
      markerPath.style.setProperty("stroke", "rgba(0, 120, 200, 0.5)", "important");
      markerPath.style.strokeOpacity = "0.4";
      const numberMarker = document.querySelector('[id$="-sequencenumber"]');
      numberMarker.style.opacity = "0.8";
      set(numberMarker.firstElementChild, {
        fill: "rgba(200, 100, 0, 0.5)",
        fillOpacity: "0.4",
      });
    });
    expect(sequence.diagnostics).toEqual([{
      path: "sequence[0]",
      kind: "fallback",
      reason: "unsupported-mermaid-sequence-style",
    }]);
    const actorHead = sequence.scene.nodes.find((node) =>
      node.meta?.mermaid?.kind === "sequence-actor-part" &&
      node.meta.mermaid.part === "head" &&
      node.style.fillOpacity === 0.4);
    expect(actorHead.style).toMatchObject({
      opacity: 0.8,
      fillOpacity: 0.4,
      strokeOpacity: 0.3,
    });
    const actorLine = sequence.scene.nodes.find((node) =>
      node.meta?.mermaid?.kind === "sequence-actor-part" &&
      node.style.stroke === "rgba(70, 80, 90, 0.5)");
    expect(actorLine.style).toMatchObject({ opacity: 0.8, strokeOpacity: 0.4 });
    const frameLine = sequence.scene.nodes.find((node) =>
      node.meta?.mermaid?.kind === "sequence-frame-line" &&
      node.style.stroke === "rgba(160, 170, 180, 0.5)");
    expect(frameLine.style).toMatchObject({ opacity: 0.8, strokeOpacity: 0.3 });
    const tab = sequence.scene.nodes.find((node) =>
      node.meta?.mermaid?.kind === "sequence-frame-tab" &&
      node.style.fill === "rgba(100, 110, 120, 0.5)");
    expect(tab.style).toMatchObject({ opacity: 0.7, fillOpacity: 0.6, strokeOpacity: 0.2 });
    const background = sequence.scene.nodes.find((node) =>
      node.meta?.mermaid?.kind === "sequence-background");
    expect(background.style).toMatchObject({ opacity: 0.8, fillOpacity: 0.4, strokeOpacity: 0.2 });
    const message = sequence.scene.nodes.find((node) =>
      node.style?.stroke === "rgba(0, 120, 200, 0.5)");
    expect(message).toMatchObject({
      kind: "connector",
      style: { opacity: 0.8, strokeOpacity: 0.4 },
    });
    const numbers = sequence.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "sequence-number-background");
    expect(numbers).toHaveLength(7);
    expect(numbers.every((node) => node.style.opacity === 0.8 &&
      node.style.fillOpacity === 0.4 && node.meta.mermaid.nativeMask === "connector")).toBe(true);
    const sequenceMapped = sceneToPptxElements(sequence.scene);
    expect(sequenceMapped.fallbacks.map((fallback) => fallback.sourcePath)).toEqual(["sequence[0]"]);
    const sequenceXml = buildPptxPackage({ slides: [{ elements: sequenceMapped.elements }] }).toString("utf8");
    expect(sequenceXml).toContain('<a:srgbClr val="0A141E"><a:alpha val="16000"/></a:srgbClr>');
    expect(sequenceXml).toContain('<a:srgbClr val="A0AAB4"><a:alpha val="12000"/></a:srgbClr>');
    expect(sequenceXml).toContain('<a:srgbClr val="0078C8"><a:alpha val="16000"/></a:srgbClr>');
    expect(sequenceXml).toContain('<a:srgbClr val="C86400"><a:alpha val="16000"/></a:srgbClr>');

    await sceneFromFixture(page, await readFixture("shapes-styled.svg"), "composite-alpha.svg");
    const composites = await updateFixture(page, () => {
      for (const path of document.querySelectorAll("g.node:nth-child(1) g.label-container path")) {
        path.style.fillOpacity = "0.5";
      }
      document.querySelector("g.node:nth-child(2) path.label-container").style.strokeOpacity = "0.5";
      const circle = document.querySelector("g.node:nth-child(4) .outer-circle");
      circle.style.fill = "rgba(10, 20, 30, 0.5)";
      circle.style.fillOpacity = "0.4";
      circle.style.stroke = "rgba(40, 50, 60, 0.5)";
      circle.style.strokeOpacity = "0.3";
      circle.style.opacity = "0.8";
    });
    expect(composites.scene.nodes.filter((node) => node.kind === "fallback")).toMatchObject([
      { sourcePath: "nodes[0]", reason: "unsupported-mermaid-composite-paint" },
      { sourcePath: "nodes[1]", reason: "unsupported-mermaid-composite-paint" },
    ]);
    const doubleCircle = composites.scene.nodes.find((node) =>
      node.sourcePath === "nodes[3].circles[0]");
    expect(doubleCircle).toMatchObject({
      kind: "shape",
      style: {
        fill: "rgba(10, 20, 30, 0.5)",
        stroke: "rgba(40, 50, 60, 0.5)",
        opacity: 0.8,
        fillOpacity: 0.4,
        strokeOpacity: 0.3,
      },
    });
    expect(sceneToPptxElements(composites.scene).fallbacks.map((fallback) => fallback.sourcePath))
      .toEqual(["nodes[0]", "nodes[1]"]);
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

test("extracts exact subroutine components and bundled height-based flowchart outlines", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Additional flowchart shapes"] });
  try {
    await page.goto(harness.url);
    const result = await sceneFromFixture(
      page,
      await readFixture("flowchart-additional-shapes.svg"),
      "flowchart-additional-shapes.svg",
    );
    validateScene(result.scene);
    expect(result.diagnostics).toEqual([]);
    expect(result.scene.nodes.map((node) => node.z))
      .toEqual(Array.from({ length: result.scene.nodes.length }, (_, index) => index));
    expect(result.scene.nodes.filter((node) => node.kind === "fallback")).toEqual([]);

    const subroutines = result.scene.nodes.filter((node) => node.meta?.mermaid?.shape === "subroutine");
    expect(subroutines).toHaveLength(2);
    for (const subroutine of subroutines) {
      const parts = result.scene.nodes.filter((node) => node.sourcePath.startsWith(`${subroutine.sourcePath}.`));
      expect(parts.map((node) => node.kind)).toEqual(["shape", "connector", "connector", "text"]);
      expect(parts[0]).toMatchObject({ preset: "rect", bounds: subroutine.bounds });
      expect(parts.slice(1, 3).map((node) => node.style.lineCap)).toEqual(["butt", "butt"]);
      for (const side of parts.slice(1, 3)) {
        expect(side.points[0].x).toBe(side.points[1].x);
        expect(side.points.map((point) => point.y)).toEqual([
          subroutine.bounds.y,
          subroutine.bounds.y + subroutine.bounds.height,
        ]);
      }
    }
    expect(result.scene.nodes.filter((node) => node.kind === "shape" && node.meta?.mermaid?.kind === "node")
      .map((node) => node.preset)).toEqual([
      "trapezoid",
      "invertedTrapezoid",
      "reverseParallelogram",
      "trapezoid",
      "invertedTrapezoid",
      "reverseParallelogram",
    ]);

    const mapped = await updateFixture(page, () => {});
    for (const node of mapped.scene.nodes) {
      expect(mapped.sources.some((source) => source.path === node.sourcePath) ||
        mapped.sources.some((source) => node.sourcePath.startsWith(`${source.path}.`)), node.sourcePath).toBe(true);
    }
    const { elements, fallbacks } = sceneToPptxElements(result.scene, { groupPreset: "rect" });
    expect(fallbacks).toEqual([]);
    expect(elements.filter((element) => ["trapezoid", "invertedTrapezoid", "reverseParallelogram"]
      .includes(element.shape)).map((element) => element.shape)).toEqual([
      "trapezoid",
      "invertedTrapezoid",
      "reverseParallelogram",
      "trapezoid",
      "invertedTrapezoid",
      "reverseParallelogram",
    ]);
    const buffer = buildPptxPackage({ slides: [{ elements }] });
    expect(inspectPptxPackage(buffer).valid).toBe(true);
    expect((buffer.toString("utf8").match(/<a:gd name="dx" fmla="\*\/ h 1 2"\/>/g) || [])).toHaveLength(6);

    const positioned = await page.evaluate(async () => {
      document.querySelector("#fixture-deck").style.cssText = "margin:17px 0 0 29px";
      document.querySelector("svg").style.cssText =
        "width:520px;max-width:none;transform-origin:0 0;transform:translate(33px,21px) scale(1.2)";
      const { mermaidSvgToScene } = await import("./renderer/mermaid-scene.mjs");
      const { sceneToSvg } = await import("./renderer/scene-svg.mjs");
      const deck = document.querySelector("#fixture-deck");
      const result = mermaidSvgToScene(deck.querySelector("svg"), { deck, includeSourceElements: true });
      const deckBounds = deck.getBoundingClientRect();
      const round = (value) => Math.round(value * 10) / 10;
      const rendered = sceneToSvg(result.scene);
      return {
        diagnostics: result.diagnostics,
        shapes: result.scene.nodes
        .filter((node) => ["trapezoid", "invertedTrapezoid", "reverseParallelogram"].includes(node.preset))
        .map((node) => {
          const source = result.sourceElements.get(node.sourcePath).querySelector(".label-container");
          const matrix = source.getScreenCTM();
          const expected = source.getAttribute("points").trim().split(/\s+/).map((pair) => {
            const [x, y] = pair.split(",").map(Number);
            const point = new DOMPoint(x, y).matrixTransform(matrix);
            return { x: round(point.x - deckBounds.left), y: round(point.y - deckBounds.top) };
          });
          const generated = [...rendered.querySelectorAll("[data-scene-source-path]")]
            .find((element) => element.getAttribute("data-scene-source-path") === node.sourcePath)
            .querySelector("polygon")
            .getAttribute("points")
            .trim()
            .split(/\s+/)
            .map((pair) => {
              const [x, y] = pair.split(",").map(Number);
              return { x: round(x), y: round(y) };
            });
          return {
            sourcePath: node.sourcePath,
            expected,
            generated,
          };
        }),
      };
    });
    expect(positioned.diagnostics).toEqual([]);
    expect(positioned.shapes).toHaveLength(6);
    for (const entry of positioned.shapes) {
      expect(entry.generated).toHaveLength(entry.expected.length);
      for (const [index, point] of entry.generated.entries()) {
        const expected = entry.expected[index];
        expect(Math.abs(point.x - expected.x), `${entry.sourcePath} vertex ${index} x`).toBeLessThanOrEqual(0.11);
        expect(Math.abs(point.y - expected.y), `${entry.sourcePath} vertex ${index} y`).toBeLessThanOrEqual(0.11);
      }
    }
  } finally {
    await harness.close();
  }
});

test("keeps unsupported subroutine paint, quadrilateral geometry, and nonuniform transforms local", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Flowchart shape boundaries"] });
  try {
    await page.goto(harness.url);
    const fixture = await readFixture("flowchart-additional-shapes.svg");
    for (const entry of [
      {
        mutate: () => {
          document.querySelector("g.node polygon.label-container").style.strokeDasharray = "4 2";
        },
        reason: "unsupported-mermaid-composite-paint",
        path: "nodes[0]",
      },
      {
        mutate: () => {
          document.querySelector("g.node polygon.label-container").style.fillOpacity = "0.5";
        },
        reason: "unsupported-mermaid-composite-paint",
        path: "nodes[0]",
      },
      {
        mutate: () => {
          const polygon = [...document.querySelectorAll("g.node polygon.label-container")]
            .find((element) => element.getAttribute("points").trim().split(/\s+/).length === 4);
          polygon.setAttribute("points", "0,0 120,0 91,-63 -31.5,-63");
        },
        reason: "unsupported-mermaid-node-shape",
        path: "nodes[2]",
      },
      {
        mutate: () => {
          const polygon = [...document.querySelectorAll("g.node polygon.label-container")]
            .find((element) => element.getAttribute("points").trim().split(/\s+/).length === 4);
          polygon.setAttribute("transform", `${polygon.getAttribute("transform")} scale(1.2,0.85)`);
        },
        reason: "unsupported-mermaid-height-based-shape-transform",
        path: "nodes[2]",
      },
    ]) {
      await sceneFromFixture(page, fixture, "flowchart-shape-fallback.svg");
      const result = await updateFixture(page, entry.mutate);
      expect(result.scene.nodes.filter((node) => node.kind === "fallback")).toMatchObject([{
        sourcePath: entry.path,
        reason: entry.reason,
      }]);
      expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.shape === "subroutine").length)
        .toBe(entry.path === "nodes[0]" ? 1 : 2);
      expect(result.scene.nodes.filter((node) => ["trapezoid", "invertedTrapezoid", "reverseParallelogram"]
        .includes(node.preset))).toHaveLength(entry.path === "nodes[2]" ? 5 : 6);
    }
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

test("extracts pinned sequence actors, backgrounds, autonumber and control frames", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Sequence decorations"] });
  try {
    await page.goto(harness.url);
    const fixture = await readFixture("sequence-decorations.svg");
    const result = await sceneFromFixture(page, fixture, "sequence-decorations.svg");
    validateScene(result.scene);
    expect(result.diagnostics).toEqual([{
      path: "sequence[0]",
      kind: "fallback",
      reason: "unsupported-mermaid-sequence-style",
    }]);
    expect(result.scene.nodes.map((node) => node.z))
      .toEqual(Array.from({ length: result.scene.nodes.length }, (_, index) => index));
    expect(result.scene.nodes.filter((node) => node.kind === "fallback")).toMatchObject([{
      sourcePath: "sequence[0]",
      reason: "unsupported-mermaid-sequence-style",
    }]);
    expect(result.scene.nodes.filter((node) => node.kind === "shape")).toHaveLength(18);
    expect(result.scene.nodes.filter((node) => node.kind === "connector")).toHaveLength(36);
    expect(result.scene.nodes.filter((node) => node.kind === "text")).toHaveLength(34);

    const actors = result.scene.nodes.filter((node) =>
      ["sequence-actor-part", "sequence-actor-label"].includes(node.meta?.mermaid?.kind));
    expect(actors.filter((node) => node.meta.mermaid.placement === "top")).toHaveLength(7);
    expect(actors.filter((node) => node.meta.mermaid.placement === "bottom")).toHaveLength(7);
    expect(actors.filter((node) => node.kind === "connector")).toHaveLength(8);
    expect(actors.filter((node) => node.preset === "ellipse")).toHaveLength(2);
    expect(actors.filter((node) => node.kind === "text")
      .map((node) => node.text.paragraphs[0].runs[0].text))
      .toEqual(["利用者", "User", "利用者", "User"]);

    const frameLines = result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "sequence-frame-line");
    const frameTabs = result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "sequence-frame-tab");
    const frameLabels = result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "sequence-frame-label");
    expect(frameLines).toHaveLength(18);
    expect(frameTabs.map((node) => [node.preset, node.meta.mermaid.frame]))
      .toEqual([["sequenceTab", "alt"], ["sequenceTab", "loop"], ["sequenceTab", "opt"], ["sequenceTab", "par"]]);
    expect(frameLabels.map((node) => node.text.paragraphs[0].runs[0].text))
      .toEqual(["alt", "[成功]", "[失敗]", "loop", "[最大3回]", "opt", "[キャッシュ]", "par", "[監査]", "[通知]"]);

    const numberBackgrounds = result.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "sequence-number-background");
    const numbers = result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "sequence-number");
    expect(numberBackgrounds).toHaveLength(7);
    expect(numberBackgrounds.every((node) =>
      node.preset === "ellipse" && node.meta.mermaid.nativeMask === "connector")).toBe(true);
    expect(numbers.map((node) => node.text.paragraphs[0].runs[0].text))
      .toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "sequence-background"))
      .toMatchObject([{ kind: "shape", preset: "rect" }]);
    expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "sequence-box-title")
      .map((node) => node.text.paragraphs[0].runs[0].text)).toEqual(["サービス層"]);

    const mapped = await updateFixture(page, () => {});
    expect(mapped.sources).toHaveLength(result.scene.nodes.length + 1);
    for (const node of result.scene.nodes) {
      expect(mapped.sources.some((source) => source.path === node.sourcePath), node.sourcePath).toBe(true);
    }
    expect(mapped.sources.find((source) => source.path === "sequence[0]").tag).toBe("rect");
    expect(mapped.sources.find((source) => source.path === frameTabs[0].sourcePath).tag).toBe("polygon");
    expect(mapped.sources.find((source) => source.path === numberBackgrounds[0].sourcePath).tag).toBe("line");
    expect(mapped.sources.find((source) => source.path === actors.find((node) => node.preset === "ellipse").sourcePath).tag)
      .toBe("circle");

    const { elements, fallbacks } = sceneToPptxElements(result.scene);
    expect(fallbacks).toMatchObject([{
      sourcePath: "sequence[0]",
      reason: "unsupported-mermaid-sequence-style",
    }]);
    expect(elements.filter((element) => element.shape === "sequenceTab")).toHaveLength(4);
    expect(elements.filter((element) => element.mermaid?.kind === "sequence-number-background" &&
      element.shape === "ellipse")).toHaveLength(7);
    const buffer = buildPptxPackage({ slides: [{ elements }] });
    expect(inspectPptxPackage(buffer).valid).toBe(true);
    expect((buffer.toString("utf8").match(/<a:custGeom>/g) || [])).toHaveLength(4);

    const positioned = await page.evaluate(async () => {
      document.querySelector("#fixture-deck").style.cssText = "margin:23px 0 0 31px";
      document.querySelector("svg").style.cssText =
        "width:400px;max-width:none;transform-origin:0 0;transform:translate(80px,50px) scale(1.25)";
      const { mermaidSvgToScene } = await import("./renderer/mermaid-scene.mjs");
      const deck = document.querySelector("#fixture-deck");
      const result = mermaidSvgToScene(deck.querySelector("svg"), { deck, includeSourceElements: true });
      const deckRect = deck.getBoundingClientRect();
      const round = (value) => Math.round(value * 10) / 10;
      const domBounds = (element) => {
        const bounds = element.getBoundingClientRect();
        return {
          x: round(bounds.left - deckRect.left),
          y: round(bounds.top - deckRect.top),
          width: round(bounds.width),
          height: round(bounds.height),
        };
      };
      const point = (element, x, y) => {
        const screen = new DOMPoint(x, y).matrixTransform(element.getScreenCTM());
        return { x: round(screen.x - deckRect.left), y: round(screen.y - deckRect.top) };
      };
      return {
        diagnostics: result.diagnostics,
        ownership: result.scene.nodes.map((node) => result.sourceElements.has(node.sourcePath)),
        shapes: result.scene.nodes
          .filter((node) => ["sequence-background", "sequence-frame-tab"].includes(node.meta?.mermaid?.kind) ||
            node.meta?.mermaid?.kind === "sequence-actor-part" && node.preset === "ellipse")
          .map((node) => ({ bounds: node.bounds, expected: domBounds(result.sourceElements.get(node.sourcePath)) })),
        connectors: result.scene.nodes
          .filter((node) => ["sequence-frame-line", "sequence-actor-part"].includes(node.meta?.mermaid?.kind) &&
            node.kind === "connector")
          .map((node) => {
            const source = result.sourceElements.get(node.sourcePath);
            return {
              points: node.points,
              expected: [
                point(source, +source.getAttribute("x1"), +source.getAttribute("y1")),
                point(source, +source.getAttribute("x2"), +source.getAttribute("y2")),
              ],
            };
          }),
        numbers: result.scene.nodes
          .filter((node) => node.meta?.mermaid?.kind === "sequence-number-background")
          .map((node) => {
            const source = result.sourceElements.get(node.sourcePath);
            const matrix = source.getScreenCTM();
            const center = point(source, +source.getAttribute("x1"), +source.getAttribute("y1"));
            const strokeWidth = parseFloat(getComputedStyle(source).strokeWidth);
            const radius = 6 * strokeWidth;
            return {
              bounds: node.bounds,
              expected: {
                x: round(center.x - radius * matrix.a),
                y: round(center.y - radius * matrix.d),
                width: round(radius * matrix.a * 2),
                height: round(radius * matrix.d * 2),
              },
            };
          }),
      };
    });
    expect(positioned.diagnostics).toEqual(result.diagnostics);
    expect(positioned.ownership.every(Boolean)).toBe(true);
    for (const entry of [...positioned.shapes, ...positioned.numbers]) {
      expect(entry.bounds).toEqual(entry.expected);
    }
    for (const entry of positioned.connectors) {
      expect(entry.points).toEqual(entry.expected);
    }
  } finally {
    await harness.close();
  }
});

test("keeps unsupported sequence decoration details inside the smallest safe fallback", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Sequence decoration boundaries"] });
  try {
    await page.goto(harness.url);
    const fixture = await readFixture("sequence-decorations.svg");
    const cases = [
      {
        mutate: () => { document.querySelector("g.actor-man.actor-top circle").setAttribute("r", "14"); },
        reason: "unsupported-mermaid-sequence-actor",
        count: 1,
      },
      {
        mutate: () => { document.querySelector("g.actor-man.actor-top").setAttribute("transform", "scale(1.2,0.8)"); },
        reason: "unsupported-mermaid-sequence-actor",
        count: 1,
      },
      {
        mutate: () => {
          document.querySelector("g.actor-man.actor-top")
            .insertAdjacentHTML("beforeend", '<use href="#fixture-sequence-decorations-computer"/>');
        },
        reason: "unsupported-mermaid-sequence-actor",
        count: 1,
      },
      {
        mutate: () => {
          document.querySelector('g[data-et="control-structure"] polygon.labelBox')
            .setAttribute("points", "269,297 319,297 319,310 307,317 269,317");
        },
        reason: "unsupported-mermaid-sequence-frame-tab",
        count: 1,
      },
      {
        mutate: () => {
          document.querySelector('g[data-et="control-structure"]')
            .insertAdjacentHTML("beforeend", '<circle cx="300" cy="320" r="4"/>');
        },
        reason: "unsupported-mermaid-sequence-frame",
        count: 1,
      },
      {
        mutate: () => { document.querySelector("svg > rect.rect").style.filter = "blur(1px)"; },
        reason: "unsupported-mermaid-sequence-style",
        count: 2,
      },
      {
        mutate: () => { document.querySelector('[id$="-sequencenumber"] circle').setAttribute("r", "7"); },
        reason: "unsupported-mermaid-sequence-number-background",
        count: 7,
      },
    ];
    for (const entry of cases) {
      await sceneFromFixture(page, fixture, "sequence-decoration-fallback.svg");
      const result = await updateFixture(page, entry.mutate);
      const fallbacks = result.scene.nodes.filter((node) => node.kind === "fallback");
      expect(fallbacks.filter((node) => node.reason === entry.reason)).toHaveLength(entry.count);
      expect(fallbacks.every((node) => result.sources.some((source) => source.path === node.sourcePath))).toBe(true);
      expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "sequence-number")).toHaveLength(7);
      expect(result.scene.nodes.filter((node) => node.text?.paragraphs.some((paragraph) =>
        paragraph.runs.some((run) => run.text === "Notify")))).toHaveLength(1);
      expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "sequence-box-title")).toHaveLength(1);
      expect(sceneToPptxElements(result.scene).fallbacks.map((fallback) => fallback.sourcePath))
        .toEqual(fallbacks.map((fallback) => fallback.sourcePath));
    }
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
      () => { document.querySelector("path.messageLine0").style.clipPath = "inset(1px)"; },
      () => { document.querySelector("path.messageLine0").style.markerMid = "url(#fixture-sequence-paths-arrowhead)"; },
      () => { document.querySelector("path.messageLine0").style.markerEnd = "url(#fixture-sequence-paths-crosshead)"; document.querySelector('[id$="-crosshead"] path').style.filter = "blur(1px)"; },
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

test("extracts class compartments and editable hollow inheritance outlines", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Classes"] });
  try {
    await page.goto(harness.url);
    const { scene } = await sceneFromFixture(page, await readFixture("class.svg"), "class.svg");
    validateScene(scene);
    expect(scene.nodes.filter((node) => node.kind === "shape")).toHaveLength(2);
    expect(scene.nodes.filter((node) => node.kind === "connector")).toHaveLength(6);
    expect(scene.nodes.filter((node) => node.kind === "text").map((node) => node.text.paragraphs[0].runs[0].text))
      .toEqual(["Animal", "+String name", "+speak() : void", "Dog"]);
    expect(scene.nodes.filter((node) => node.kind === "fallback")).toHaveLength(0);
    expect(scene.nodes[0].meta.mermaid.kind).toBe("marked-edge");
    expect(scene.nodes[0].bounds.width).toBeGreaterThan(0);
    expect(scene.nodes.find((node) => node.meta?.mermaid?.kind === "marker")).toMatchObject({
      kind: "connector", style: { fill: null, dash: "solid" }, arrowStart: "none", arrowEnd: "none",
      meta: { mermaid: { shape: "hollow-triangle", placement: "start" } },
    });
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
      () => { document.querySelector("path.relation").setAttribute("marker-start", "url(#fixture-class-relations_class-aggregationStart)"); document.querySelector('[id$="-aggregationStart"] path').style.fill = "white"; },
      () => { document.querySelector("path.relation").setAttribute("marker-start", "url(#fixture-class-relations_class-extensionStart)"); document.querySelector('[id$="-extensionStart"] path').style.fill = "white"; },
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

test("extracts class notes and recursive namespaces without consuming relations", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Class containers"] });
  try {
    await page.goto(harness.url);
    const fixture = await readFixture("class-containers.svg");
    const result = await sceneFromFixture(page, fixture, "class-containers.svg");
    validateScene(result.scene);
    expect(result.diagnostics).toEqual([]);
    expect(result.scene.nodes.filter((node) => node.kind === "fallback")).toEqual([]);
    expect(result.scene.nodes.map((node) => node.z))
      .toEqual(Array.from({ length: result.scene.nodes.length }, (_, index) => index));

    const namespaces = result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "class-namespace");
    expect(namespaces.map((node) => [node.sourcePath, node.meta.mermaid.depth]))
      .toEqual([["namespaces[0]", 1], ["namespaces[1]", 1], ["namespaces[2]", 2]]);
    expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "class-namespace-label")
      .map((node) => node.text.paragraphs[0].runs[0].text)).toEqual(["Core", "External", "Internal"]);

    const notes = result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "class-note");
    const noteLabels = result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "class-note-label");
    expect(notes).toHaveLength(2);
    expect(noteLabels.map((node) => node.text.paragraphs.map((paragraph) =>
      paragraph.runs.map((run) => run.text).join("")))).toEqual([
      ["口座ノート", "Account note"],
      ["全体ノート", "General note"],
    ]);

    const edges = result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "edge");
    expect(edges.map((node) => node.meta.mermaid.id)).toEqual([
      "edgeNote0",
      "id_Account_Ledger_1",
      "id_Ledger_Gateway_2",
      "id_Gateway_Account_3",
      "id_Account_Gateway_4",
    ]);
    expect(new Set(edges.map((node) => node.meta.mermaid.id)).size).toBe(edges.length);
    expect(edges.map((node) => [node.arrowStart, node.arrowEnd, node.style.dash])).toEqual([
      ["none", "none", "dot"],
      ["diamond", "none", "solid"],
      ["none", "stealth", "dash"],
      ["none", "none", "solid"],
      ["none", "none", "solid"],
    ]);
    expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "marker")
      .map((node) => node.meta.mermaid.shape)).toEqual(["hollow-triangle", "hollow-diamond"]);
    expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "edge-terminal")
      .map((node) => node.text.paragraphs[0].runs[0].text)).toEqual(["1", "0..*"]);
    expect(result.scene.nodes.filter((node) => node.sourcePath.startsWith("classes[") && node.kind === "shape"))
      .toHaveLength(3);

    const mapped = await updateFixture(page, () => {});
    for (const node of mapped.scene.nodes) {
      expect(mapped.sources.some((source) => source.path === node.sourcePath) ||
        mapped.sources.some((source) => node.sourcePath.startsWith(`${source.path}.`)), node.sourcePath).toBe(true);
    }
    const { elements, fallbacks } = sceneToPptxElements(result.scene, { groupPreset: "rect" });
    expect(fallbacks).toEqual([]);
    expect(elements.filter((element) => element.mermaid?.kind === "class-namespace" && element.shape === "rect"))
      .toHaveLength(3);
    expect(elements.filter((element) => element.mermaid?.kind === "class-note" && element.shape === "rect"))
      .toHaveLength(2);
    expect(inspectPptxPackage(buildPptxPackage({ slides: [{ elements }] })).valid).toBe(true);

    await sceneFromFixture(page, fixture, "class-containers-recursive.svg");
    const recursive = await updateFixture(page, () => {
      const root = document.querySelector("g.root");
      const namespace = root.querySelector("g.cluster");
      for (const name of ["edgePaths", "edgeLabels"]) {
        namespace.append(root.querySelector(`:scope > g.${name}`));
      }
      const nodes = root.querySelector(":scope > g.nodes");
      for (const node of [...nodes.children]) namespace.append(node);
      nodes.remove();
    });
    const recursiveEdges = recursive.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "edge");
    expect(recursiveEdges.map((node) => node.meta.mermaid.id)).toEqual(edges.map((node) => node.meta.mermaid.id));
    expect(new Set(recursiveEdges.map((node) => node.meta.mermaid.id)).size).toBe(edges.length);
    expect(recursive.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "class-note")).toHaveLength(2);
    expect(recursive.scene.nodes.filter((node) => node.sourcePath.startsWith("classes[") && node.kind === "shape"))
      .toHaveLength(3);
    expect(recursive.scene.nodes.filter((node) => node.kind === "fallback")).toEqual([]);
  } finally {
    await harness.close();
  }
});

test("retains unknown visuals inside supported nested class collections", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Nested class collection fallback"] });
  try {
    await page.goto(harness.url);
    await sceneFromFixture(page, await readFixture("class-containers.svg"), "class-containers-nested-unknown.svg");
    const result = await updateFixture(page, () => {
      const root = document.querySelector("g.root");
      const namespace = root.querySelector("g.cluster");
      for (const name of ["edgePaths", "edgeLabels", "nodes"]) {
        namespace.append(root.querySelector(`:scope > g.${name}`));
      }
      const unknown = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      unknown.setAttribute("id", "nested-unknown");
      unknown.setAttribute("cx", "20");
      unknown.setAttribute("cy", "20");
      unknown.setAttribute("r", "4");
      unknown.setAttribute("fill", "red");
      namespace.querySelector(":scope > g.nodes").append(unknown);
    });

    const fallbacks = result.scene.nodes.filter((node) => node.kind === "fallback");
    expect(fallbacks).toMatchObject([{
      id: "nested-unknown",
      reason: "unsupported-mermaid-svg-element",
    }]);
    expect(result.diagnostics).toEqual([{
      path: fallbacks[0].sourcePath,
      kind: "fallback",
      reason: "unsupported-mermaid-svg-element",
    }]);
    expect(result.sources).toContainEqual({
      path: fallbacks[0].sourcePath,
      tag: "circle",
      id: "nested-unknown",
    });
    const edges = result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "edge");
    expect(edges.map((node) => node.meta.mermaid.id)).toEqual([
      "edgeNote0",
      "id_Account_Ledger_1",
      "id_Ledger_Gateway_2",
      "id_Gateway_Account_3",
      "id_Account_Gateway_4",
    ]);
    expect(new Set(edges.map((node) => node.meta.mermaid.id)).size).toBe(5);
    expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "class-namespace")).toHaveLength(3);
    expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "class-namespace-label")).toHaveLength(3);
    expect(result.scene.nodes.filter((node) => node.sourcePath.startsWith("classes[") && node.kind === "shape"))
      .toHaveLength(3);
    expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "class-note")).toHaveLength(2);
    expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "class-note-label")).toHaveLength(2);
    expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "edge-label")).toHaveLength(4);
    expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "edge-terminal")).toHaveLength(2);
  } finally {
    await harness.close();
  }
});

test("keeps unsupported class note and namespace details at local fallback boundaries", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Class container boundaries"] });
  try {
    await page.goto(harness.url);
    const fixture = await readFixture("class-containers.svg");
    const edgeIds = [
      "edgeNote0",
      "id_Account_Ledger_1",
      "id_Ledger_Gateway_2",
      "id_Gateway_Account_3",
      "id_Account_Gateway_4",
    ];
    for (const entry of [
      {
        mutate: () => {
          document.querySelector("g.node:has(.noteLabel) .noteLabel")
            .insertAdjacentHTML("beforeend", '<circle cx="4" cy="4" r="3" fill="red"/>');
        },
        reason: "unsupported-mermaid-class-note",
        path: "notes[0]",
      },
      {
        mutate: () => {
          document.querySelector("g.node:has(.noteLabel) .noteLabel div").style.backgroundColor = "red";
        },
        reason: "unsupported-mermaid-class-note",
        path: "notes[0]",
      },
      {
        mutate: () => {
          const note = document.querySelector("g.node:has(.noteLabel)");
          note.setAttribute("transform", `${note.getAttribute("transform")} rotate(5)`);
        },
        reason: "unsupported-mermaid-class-note-transform",
        path: "notes[0]",
      },
      {
        mutate: () => {
          document.querySelector("g.cluster .cluster-label")
            .insertAdjacentHTML("beforeend", '<circle cx="4" cy="4" r="3" fill="red"/>');
        },
        reason: "unsupported-mermaid-class-namespace-label",
        path: "namespaces[0].labels[0]",
      },
      {
        mutate: () => {
          document.querySelector("g.cluster > rect").style.filter = "blur(1px)";
        },
        reason: "unsupported-mermaid-class-namespace-frame",
        path: "namespaces[0]",
      },
      {
        mutate: () => {
          document.querySelector("g.cluster")
            .insertAdjacentHTML("beforeend",
              '<g class="label"><circle id="namespace-decoration" cx="20" cy="20" r="4" fill="red"/></g>');
        },
        reason: "unsupported-mermaid-class-namespace-decoration",
        path: "namespaces[0].unknown",
      },
      {
        mutate: () => {
          document.querySelector("g.cluster").style.filter = "blur(1px)";
        },
        reason: "unsupported-mermaid-class-namespace-style",
        path: "namespaces[0]",
      },
      {
        mutate: () => {
          document.querySelector("g.cluster").setAttribute("transform", "rotate(5)");
        },
        reason: "unsupported-mermaid-class-namespace-transform",
        path: "namespaces[0]",
      },
    ]) {
      await sceneFromFixture(page, fixture, "class-container-fallback.svg");
      const result = await updateFixture(page, entry.mutate);
      const fallbacks = result.scene.nodes.filter((node) => node.kind === "fallback");
      expect(fallbacks).toHaveLength(1);
      expect(fallbacks[0].reason).toBe(entry.reason);
      expect(fallbacks[0].sourcePath.startsWith(entry.path)).toBe(true);
      expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "edge")
        .map((node) => node.meta.mermaid.id)).toEqual(edgeIds);
      expect(result.scene.nodes.filter((node) => node.sourcePath.startsWith("classes[") && node.kind === "shape"))
        .toHaveLength(3);
      expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "class-note").length)
        .toBe(entry.path === "notes[0]" ? 1 : 2);
    }

    await sceneFromFixture(page, fixture, "class-namespace-depth.svg");
    const depth = await updateFixture(page, () => {
      const clusters = document.querySelector("g.clusters");
      clusters.replaceChildren();
      for (let index = 0; index < 18; index += 1) {
        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        group.setAttribute("class", "cluster undefined");
        group.setAttribute("id", `depth-${index}`);
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", String(8 + index * 2));
        rect.setAttribute("y", String(8 + index * 2));
        rect.setAttribute("width", String(500 - index * 4));
        rect.setAttribute("height", String(400 - index * 4));
        group.append(rect);
        clusters.append(group);
      }
    });
    expect(depth.scene.nodes.filter((node) =>
      node.reason?.startsWith("unsupported-mermaid-class-namespace-depth"))).toHaveLength(2);
    expect(depth.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "edge")
      .map((node) => node.meta.mermaid.id)).toEqual(edgeIds);
    expect(depth.scene.nodes.filter((node) => node.sourcePath.startsWith("classes[") && node.kind === "shape"))
      .toHaveLength(3);
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

test("localizes unsupported transformed nodes, connectors, and unknown siblings", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Local transform fallback"] });
  try {
    await page.goto(harness.url);
    await sceneFromFixture(page, await readFixture("flowchart.svg"), "local-transform.svg");
    const result = await updateFixture(page, () => {
      document.querySelector("g.node").style.rotate = "15deg";
      document.querySelectorAll("path.flowchart-link")[1].setAttribute("transform", "skewX(12)");
      document.querySelector("g.root").insertAdjacentHTML(
        "beforeend",
        '<circle id="reflected-unknown" cx="620" cy="220" r="9" fill="red" transform="scale(-1 1)"/>',
      );
    });
    const fallbacks = result.scene.nodes.filter((node) => node.kind === "fallback");
    expect(fallbacks.map((node) => [node.sourcePath, node.reason])).toEqual([
      ["edges[1]", "unsupported-mermaid-edge-transform"],
      ["nodes[0]", "unsupported-mermaid-node-transform"],
      ["root.unknown[0]", "unsupported-mermaid-svg-element-transform"],
    ]);
    expect(result.scene.nodes.some((node) => node.sourcePath === "svg")).toBe(false);
    expect(result.scene.nodes.filter((node) => node.kind === "connector")).toHaveLength(4);
    expect(result.scene.nodes.filter((node) =>
      node.kind === "shape" && node.meta?.mermaid?.kind === "node")).toHaveLength(4);
    expect(result.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "edge-label")).toHaveLength(2);
    expect(result.scene.nodes.some((node) => node.text?.paragraphs.some((paragraph) =>
      paragraph.runs.some((run) => run.text === "yes")))).toBe(true);
    const mapped = sceneToPptxElements(result.scene, {
      pathPrefix: "mermaid[0]",
      fallbackType: "mermaid",
    });
    expect(mapped.fallbacks.map((fallback) => fallback.sourcePath))
      .toEqual(fallbacks.map((fallback) => fallback.sourcePath));
    expect(mapped.elements.filter((element) => element.type === "connector")).toHaveLength(4);
    expect(new Set(mapped.elements.map((element) => element.path)).size).toBe(mapped.elements.length);
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
    const rotatedResult = await sceneFromFixture(page, rotated, "rotated.svg");
    expect(rotatedResult.scene.nodes.filter((node) => node.kind === "fallback")).toMatchObject([
      { sourcePath: "nodes[0]", reason: "unsupported-mermaid-node-transform" },
    ]);
    expect(rotatedResult.scene.nodes.some((node) => node.sourcePath === "svg")).toBe(false);
    expect(rotatedResult.scene.nodes.filter((node) => node.kind === "connector")).toHaveLength(5);
    const rootRotated = flowchart.replace('class="flowchart"', 'class="flowchart" style="rotate:15deg"');
    expect((await sceneFromFixture(page, rootRotated, "root-rotated.svg")).scene.nodes).toMatchObject([
      { kind: "fallback", sourcePath: "svg", reason: "unsupported-mermaid-svg-transform" },
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
        const markerId = /#([^")]+)[")]*$/.exec(line.getAttribute("marker-end"))?.[1];
        const originalMarker = document.getElementById(markerId);
        const marker = originalMarker.cloneNode(true);
        marker.id = "css-matched-arrowhead";
        marker.firstElementChild.style.fill = "rgb(12, 34, 56)";
        marker.firstElementChild.style.stroke = "rgb(12, 34, 56)";
        originalMarker.parentElement.append(marker);
        line.style.markerEnd = `url(#${marker.id})`;
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
    expect(classes.fallbacks.filter((fallback) => fallback.reason === "unsupported-mermaid-edge-style")).toHaveLength(0);
    const classSvg = page.locator("pre.mermaid > svg").nth(1);
    await expect(classSvg.locator("path.relation[data-pptx-fallback-ids]")).toHaveCount(0);
    await expect(classSvg.locator("path.relation[data-pptx-native=connector]")).toHaveCount(1);
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
  test(`real renderer exports packet aliases and treeView with exact native masks (${theme})`, async ({ page }) => {
    const [packet, treeView] = await Promise.all([
      readFixture("packet.mmd"),
      readFixture("tree-view.mmd"),
    ]);
    const harness = await startHarness({
      slides: [
        `# Packet\n\n\`\`\`mermaid\n${packet}\n\`\`\``,
        `# Packet beta\n\n\`\`\`mermaid\n${packet.replace(/^packet$/m, "packet-beta")}\n\`\`\``,
        `# treeView\n\n\`\`\`mermaid\n${treeView}\n\`\`\``,
      ],
      theme,
      customThemeCss: theme === "custom"
        ? "--bg:#102030;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;"
        : "",
    });
    try {
      await page.goto(`${harness.url}/?pptx=1&token=${encodeURIComponent(harness.printToken)}`);
      await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready") ||
        document.documentElement.hasAttribute("data-pptx-error"), undefined, { timeout: 120_000 });
      await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
      await expect(page.locator("pre.mermaid > svg[data-scene-backend=svg]")).toHaveCount(3);
      const model = await page.evaluate(() => window.__presentationPptxModel);
      const packetElements = model.slides[0].elements.filter((element) =>
        element.path?.startsWith("mermaid[0].packet."));
      const packetBetaElements = model.slides[1].elements.filter((element) =>
        element.path?.startsWith("mermaid[0].packet."));
      const treeElements = model.slides[2].elements.filter((element) =>
        element.path?.startsWith("mermaid[0].treeView."));
      expect(packetElements.filter((element) => element.type === "shape")).toHaveLength(9);
      expect(packetElements.filter((element) => element.type === "text")).toHaveLength(28);
      expect(packetBetaElements).toEqual(packetElements);
      expect(treeElements.filter((element) => element.type === "connector")).toHaveLength(15);
      expect(treeElements.filter((element) => element.type === "text")).toHaveLength(10);
      expect(model.slides.flatMap((slide) =>
        slide.fallbacks.filter((fallback) => fallback.type === "mermaid"))).toEqual([]);
      const textOf = (element) => element.paragraphs
        .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
        .join("\n");
      expect(packetElements.filter((element) => element.type === "text").map(textOf))
        .toEqual(expect.arrayContaining([
          "識別子 Identifier",
          "末尾 Tail",
          "IPv6 Extension Header / 拡張ヘッダー",
        ]));
      expect(treeElements.filter((element) => element.type === "text").map(textOf)).toEqual([
        "/",
        "サービス Service",
        "API",
        "認証 Auth",
        "データ",
        "Worker",
        "Queue",
        "Leaf A",
        "葉 B",
        "監視",
      ]);

      const packetSvg = page.locator("pre.mermaid > svg").nth(0);
      const packetBetaSvg = page.locator("pre.mermaid > svg").nth(1);
      const treeSvg = page.locator("pre.mermaid > svg").nth(2);
      await expect(packetSvg).toHaveAttribute("aria-roledescription", "packet");
      await expect(packetBetaSvg).toHaveAttribute("aria-roledescription", "packet");
      await expect(treeSvg).toHaveAttribute("aria-roledescription", "treeView");
      for (const svg of [packetSvg, packetBetaSvg]) {
        await expect(svg.locator("rect.packetBlock[data-pptx-native=shape]")).toHaveCount(9);
        await expect(svg.locator(
          "text.packetLabel[data-pptx-native=text], text.packetByte[data-pptx-native=text], text.packetTitle[data-pptx-native=text]",
        )).toHaveCount(28);
        await expect(svg.locator("[data-pptx-fallback-ids]")).toHaveCount(0);
      }
      await expect(treeSvg.locator("line.treeView-node-line[data-pptx-native=connector]")).toHaveCount(15);
      await expect(treeSvg.locator("text.treeView-node-label[data-pptx-native=text]")).toHaveCount(10);
      await expect(treeSvg.locator("[data-pptx-fallback-ids]")).toHaveCount(0);
      const masks = await page.locator("pre.mermaid > svg").evaluateAll((svgs) =>
        svgs.map((svg) => ({
          shapes: [...svg.querySelectorAll("rect.packetBlock[data-pptx-native]")].map((element) => {
            const style = getComputedStyle(element);
            return [style.fill, style.stroke];
          }),
          lines: [...svg.querySelectorAll("line.treeView-node-line[data-pptx-native]")]
            .map((element) => getComputedStyle(element).stroke),
          text: [...svg.querySelectorAll("text[data-pptx-native]")]
            .map((element) => getComputedStyle(element).fill),
        })),
      );
      expect(masks[0].shapes).toEqual(Array(9).fill(["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"]));
      expect(masks[1].shapes).toEqual(masks[0].shapes);
      expect(masks[0].text).toEqual(Array(28).fill("rgba(0, 0, 0, 0)"));
      expect(masks[1].text).toEqual(masks[0].text);
      expect(masks[2].lines).toEqual(Array(15).fill("rgba(0, 0, 0, 0)"));
      expect(masks[2].text).toEqual(Array(10).fill("rgba(0, 0, 0, 0)"));

      const packetPackage = buildPptxPackage({ slides: [{ elements: packetElements }] });
      const treePackage = buildPptxPackage({ slides: [{ elements: treeElements }] });
      expect(inspectPptxPackage(packetPackage).valid).toBe(true);
      expect(inspectPptxPackage(treePackage).valid).toBe(true);
      expect((packetPackage.toString("utf8").match(/<p:sp>/g) || [])).toHaveLength(37);
      expect((treePackage.toString("utf8").match(/<a:prstGeom prst="line">/g) || []))
        .toHaveLength(15);
    } finally {
      await harness.close();
    }
  });
}

test("actual ER CSS marker geometry overrides remain exact relation-local fallback artwork", async ({ page }) => {
  const diagram = await readFixture("er-basic.mmd");
  const withThemeCss = (themeCSS) => diagram.replace(
    '{"handDrawnSeed": 42}',
    JSON.stringify({ handDrawnSeed: 42, themeCSS }),
  );
  const cases = [
    {
      title: "Circle geometry",
      source: withThemeCss(
        'marker[id$="zeroOrOneEnd"] circle{r:12px}',
      ),
      expectedGeometry: {
        tag: "circle",
        attribute: "6",
        computed: "12px",
      },
    },
    {
      title: "Path geometry",
      source: withThemeCss(
        'marker[id$="onlyOneStart"] path{d:path("M0,0 L18,18")}',
      ),
      expectedGeometry: {
        tag: "path",
        attribute: "M9,0 L9,18 M15,0 L15,18",
        computed: 'path("M 0 0 L 18 18")',
      },
    },
    {
      title: "Relation fallback geometry",
      source: withThemeCss(
        'marker[id$="zeroOrOneEnd"] circle{r:12px} ' +
        'path.relationshipLine[data-id="id_entity-ACCOUNT-0_entity-PROFILE-1_0"]' +
        '{d:path("M0,0 L100,0")}',
      ),
      expectedGeometry: {
        tag: "circle",
        attribute: "6",
        computed: "12px",
      },
      expectedRelation: 'path("M 0 0 L 100 0")',
    },
  ];
  const harness = await startHarness({
    slides: cases.map(({ title, source }) =>
      `# ${title}\n\n\`\`\`mermaid\n${source}\n\`\`\``),
  });
  try {
    await page.goto(
      `${harness.url}/?pptx=1&token=${encodeURIComponent(harness.printToken)}`,
    );
    await page.waitForFunction(() =>
      document.documentElement.hasAttribute("data-pptx-ready") ||
      document.documentElement.hasAttribute("data-pptx-error"),
    undefined, { timeout: 120_000 });
    await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
    const result = await page.evaluate(() => ({
      slides: window.__presentationPptxModel.slides,
      diagrams: [...document.querySelectorAll("pre.mermaid > svg")].map((svg) => {
        const circle = svg.querySelector('[id$="zeroOrOneEnd"] circle');
        const path = svg.querySelector('[id$="onlyOneStart"] path');
        const overridden = getComputedStyle(circle).r === "12px" ? circle : path;
        const geometryProperty = overridden.localName === "circle" ? "r" : "d";
        const terminals = svg.__presentationScene.nodes.filter((node) =>
          node.meta?.mermaid?.kind === "er-terminal");
        const fallbackRelation = svg.querySelector(
          'path.relationshipLine[data-id="id_entity-ACCOUNT-0_entity-PROFILE-1_0"]',
        );
        return {
          sceneFallbacks: svg.__presentationScene.nodes
            .filter((node) => node.kind === "fallback")
            .map((node) => ({
              sourcePath: node.sourcePath,
              reason: node.reason,
            })),
          terminalPaths: terminals.map((node) => node.sourcePath),
          uniqueTerminalPaths: new Set(terminals.map((node) =>
            node.sourcePath)).size,
          geometry: {
            tag: overridden.localName,
            attribute: overridden.getAttribute(geometryProperty),
            computed: getComputedStyle(overridden)
              .getPropertyValue(geometryProperty),
          },
          relationGeometry: {
            attribute: fallbackRelation.getAttribute("d"),
            inline: fallbackRelation.style.d,
            computed: getComputedStyle(fallbackRelation).d,
          },
          relations: [...svg.querySelectorAll("path.relationshipLine")]
            .map((relation) => ({
              native: relation.getAttribute("data-pptx-native"),
              fallback: relation.getAttribute("data-pptx-fallback-ids"),
              stroke: getComputedStyle(relation).stroke,
              markerStart: getComputedStyle(relation).markerStart,
              markerEnd: getComputedStyle(relation).markerEnd,
            })),
          nativeLabels: svg.querySelectorAll(
            "g.edgeLabel[data-pptx-native=shape]",
          ).length,
          wholeSvgFallback: svg.getAttribute("data-pptx-fallback-ids"),
        };
      }),
    }));
    for (const [index, entry] of cases.entries()) {
      const slide = result.slides[index];
      const diagramResult = result.diagrams[index];
      expect(diagramResult.geometry).toEqual(entry.expectedGeometry);
      if (entry.expectedRelation) {
        expect(diagramResult.relationGeometry.attribute)
          .not.toContain("M0,0 L100,0");
        expect(diagramResult.relationGeometry.inline)
          .toBe(entry.expectedRelation);
        expect(diagramResult.relationGeometry.computed)
          .toBe(entry.expectedRelation);
      }
      expect(diagramResult.sceneFallbacks).toEqual([{
        sourcePath: "relations[0]",
        reason: "unsupported-mermaid-er-terminal-geometry",
      }]);
      expect(diagramResult.terminalPaths).toHaveLength(12);
      expect(diagramResult.uniqueTerminalPaths).toBe(12);
      expect(diagramResult.terminalPaths.some((path) =>
        path.startsWith("relations[0].terminals."))).toBe(false);
      expect(diagramResult.nativeLabels).toBe(4);
      expect(diagramResult.wholeSvgFallback).toBeNull();
      expect(slide.fallbacks.filter((fallback) =>
        fallback.type === "mermaid")).toMatchObject([{
        path: "mermaid[0].relations[0]",
        sourcePath: "relations[0]",
        reason: "unsupported-mermaid-er-terminal-geometry",
        captureId: expect.any(String),
      }]);
      expect(slide.elements.filter((element) =>
        element.mermaid?.kind === "er-relation")).toHaveLength(3);
      expect(slide.elements.filter((element) =>
        element.mermaid?.kind === "er-terminal")).toHaveLength(12);
      expect(slide.elements.filter((element) =>
        element.mermaid?.kind === "edge-label")).toHaveLength(4);
      expect(slide.elements.filter((element) =>
        element.mermaid?.kind === "er-entity-box")).toHaveLength(4);
      expect(slide.elements.some((element) =>
        element.path?.startsWith("mermaid[0].relations[0]."))).toBe(false);
      expect(diagramResult.relations[0].native).toBeNull();
      expect(diagramResult.relations[0].fallback).toBeTruthy();
      expect(diagramResult.relations[0].stroke)
        .not.toBe("rgba(0, 0, 0, 0)");
      expect([
        diagramResult.relations[0].markerStart,
        diagramResult.relations[0].markerEnd,
      ].some((marker) => marker !== "none")).toBe(true);
      expect(diagramResult.relations.slice(1).every((relation) =>
        relation.native === "connector" &&
        relation.fallback === null &&
        relation.stroke === "rgba(0, 0, 0, 0)" &&
        relation.markerStart === "none" &&
        relation.markerEnd === "none")).toBe(true);
    }
  } finally {
    await harness.close();
  }
});

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  test(`real renderer exports ER aliases, crow feet and exact local fallback captures (${theme})`, async ({ page }) => {
    const diagram = await readFixture("er-basic.mmd");
    const fallbackDiagram = diagram.replace(
      '{"handDrawnSeed": 42}',
      '{"handDrawnSeed": 42, "themeCSS": ".row-rect-even{filter:blur(1px)} .edge-pattern-dashed{opacity:.5}"}',
    );
    const harness = await startHarness({
      slides: [
        `# ER\n\n\`\`\`mermaid\n${diagram}\n\`\`\``,
        `# ER beta\n\n\`\`\`mermaid\n${diagram.replace(/^erDiagram$/m, "erDiagram-beta")}\n\`\`\``,
        `# ER local fallback\n\n\`\`\`mermaid\n${fallbackDiagram}\n\`\`\``,
      ],
      theme,
      customThemeCss: theme === "custom"
        ? "--bg:#102030;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;"
        : "",
    });
    try {
      await page.goto(`${harness.url}/?pptx=1&token=${encodeURIComponent(harness.printToken)}`);
      await page.waitForFunction(() =>
        document.documentElement.hasAttribute("data-pptx-ready") ||
        document.documentElement.hasAttribute("data-pptx-error"),
      undefined, { timeout: 120_000 });
      await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
      await expect(page.locator("pre.mermaid > svg[data-scene-backend=svg]")).toHaveCount(3);
      const model = await page.evaluate(() => window.__presentationPptxModel);
      const native = model.slides[0].elements.filter((element) =>
        element.path?.startsWith("mermaid[0]."));
      const beta = model.slides[1].elements.filter((element) =>
        element.path?.startsWith("mermaid[0]."));
      const fallback = model.slides[2];
      const textOf = (element) =>
        (element.text?.paragraphs || element.paragraphs || [])
          .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
          .join("\n");
      for (const [elements, entityBoxes] of [[native, 4], [beta, 5]]) {
        expect(elements.filter((element) =>
          element.mermaid?.kind === "er-entity-box")).toHaveLength(entityBoxes);
        expect(elements.filter((element) =>
          element.mermaid?.kind === "er-attribute-row")).toHaveLength(9);
        expect(elements.filter((element) =>
          element.mermaid?.kind === "er-divider")).toHaveLength(20);
        expect(elements.filter((element) =>
          element.mermaid?.kind === "er-relation")).toHaveLength(4);
        expect(elements.filter((element) =>
          element.mermaid?.kind === "er-terminal")).toHaveLength(16);
        expect(elements.filter((element) =>
          element.mermaid?.kind === "edge-label")).toHaveLength(4);
      }
      expect(beta.filter((element) =>
        element.mermaid?.kind === "er-entity-name").map(textOf))
        .toEqual(["-beta", "顧客\nAccount", "PROFILE", "ORDER", "LINE_ITEM"]);
      expect(model.slides.slice(0, 2).flatMap((slide) =>
        slide.fallbacks.filter((entry) => entry.type === "mermaid"))).toEqual([]);
      expect(native.map(textOf)).toEqual(expect.arrayContaining([
        "顧客\nAccount",
        "顧客 ID\nprimary",
        "PK,FK",
        "has\n所有",
        "opens\n注文",
        "明細",
      ]));

      const fallbackEntries = fallback.fallbacks
        .filter((entry) => entry.type === "mermaid")
        .map((entry) => ({
          sourcePath: entry.sourcePath,
          reason: entry.reason,
          artwork: entry.artwork,
        }));
      expect(fallbackEntries).toEqual([
        {
          sourcePath: "relations[1]",
          reason: "unsupported-mermaid-er-terminal-compositing",
          artwork: undefined,
        },
        {
          sourcePath: "relations[3]",
          reason: "unsupported-mermaid-er-terminal-compositing",
          artwork: undefined,
        },
        {
          sourcePath: "entities[0].rows[1]",
          reason: "unsupported-mermaid-er-row-style",
          artwork: undefined,
        },
        {
          sourcePath: "entities[2].rows[1]",
          reason: "unsupported-mermaid-er-row-style",
          artwork: undefined,
        },
        {
          sourcePath: "entities[3].rows[1]",
          reason: "unsupported-mermaid-er-row-style",
          artwork: undefined,
        },
      ]);
      expect(fallback.elements.filter((element) =>
        element.mermaid?.kind === "er-relation")).toHaveLength(2);
      expect(fallback.elements.filter((element) =>
        element.mermaid?.kind === "er-terminal")).toHaveLength(8);
      expect(fallback.elements.filter((element) =>
        element.mermaid?.kind === "er-attribute-row")).toHaveLength(6);
      expect(fallback.elements.filter((element) =>
        element.mermaid?.kind === "edge-label")).toHaveLength(4);
      expect(fallback.elements.filter((element) =>
        element.mermaid?.kind?.startsWith("er-attribute-") &&
        element.type === "text")).toHaveLength(31);

      const basicSvg = page.locator("pre.mermaid > svg").nth(0);
      const betaSvg = page.locator("pre.mermaid > svg").nth(1);
      const fallbackSvg = page.locator("pre.mermaid > svg").nth(2);
      for (const svg of [basicSvg, betaSvg, fallbackSvg]) {
        await expect(svg).toHaveAttribute("aria-roledescription", "er");
        await expect(svg).toHaveClass(/erDiagram/);
      }
      for (const [svg, labelCount] of [[basicSvg, 35], [betaSvg, 36]]) {
        await expect(svg.locator(
          "g.nodes > g.node > g.outer-path[data-pptx-native=shape]",
        )).toHaveCount(4);
        await expect(svg.locator(
          "g.nodes > g.node > g.row-rect-odd[data-pptx-native=shape], " +
          "g.nodes > g.node > g.row-rect-even[data-pptx-native=shape]",
        )).toHaveCount(9);
        await expect(svg.locator(
          "g.nodes > g.node > g.label[data-pptx-native=text]",
        )).toHaveCount(labelCount);
        await expect(svg.locator(
          "g.nodes > g.node > g.divider[data-pptx-native=connector]",
        )).toHaveCount(20);
        await expect(svg.locator(
          "path.relationshipLine[data-pptx-native=connector]",
        )).toHaveCount(4);
        await expect(svg.locator(
          "g.edgeLabel[data-pptx-native=shape]",
        )).toHaveCount(4);
        await expect(svg.locator("[data-pptx-fallback-ids]")).toHaveCount(0);
      }
      await expect(betaSvg.locator(
        "g.nodes > g.node > rect.basic[data-pptx-native=shape]",
      )).toHaveCount(1);
      await expect(betaSvg.locator(
        "g.nodes > g.node:has(> rect.basic) > g.label[data-pptx-native=text]",
      )).toContainText("-beta");
      const masks = await basicSvg.evaluate((svg) => ({
        entityPaths: [...svg.querySelectorAll(
          "g.outer-path[data-pptx-native] > path, " +
          "g.row-rect-odd[data-pptx-native] > path, " +
          "g.row-rect-even[data-pptx-native] > path",
        )].map((path) => {
          const style = getComputedStyle(path);
          return [style.fill, style.stroke];
        }),
        labels: [...svg.querySelectorAll(
          "g.node > g.label[data-pptx-native] span.nodeLabel",
        )].map((label) => getComputedStyle(label).color),
        dividers: [...svg.querySelectorAll(
          "g.divider[data-pptx-native] > path",
        )].map((path) => getComputedStyle(path).stroke),
        relations: [...svg.querySelectorAll(
          "path.relationshipLine[data-pptx-native]",
        )].map((path) => {
          const style = getComputedStyle(path);
          return [style.stroke, style.markerStart, style.markerEnd];
        }),
        relationLabels: [...svg.querySelectorAll(
          "g.edgeLabel[data-pptx-native] span.edgeLabel",
        )].map((label) => getComputedStyle(label).color),
      }));
      expect(masks.entityPaths.every(([fill, stroke]) =>
        fill === "rgba(0, 0, 0, 0)" &&
        stroke === "rgba(0, 0, 0, 0)")).toBe(true);
      expect(masks.labels).toEqual(Array(35).fill("rgba(0, 0, 0, 0)"));
      expect(masks.dividers).toEqual(Array(40).fill("rgba(0, 0, 0, 0)"));
      expect(masks.relations).toEqual(Array(4).fill([
        "rgba(0, 0, 0, 0)",
        "none",
        "none",
      ]));
      expect(masks.relationLabels).toEqual(Array(4).fill("rgba(0, 0, 0, 0)"));

      await expect(fallbackSvg.locator(
        "g.nodes > g.node > g.row-rect-even[data-pptx-fallback-ids]",
      )).toHaveCount(3);
      await expect(fallbackSvg.locator(
        "g.nodes > g.node > g.row-rect-even[data-pptx-native]",
      )).toHaveCount(0);
      await expect(fallbackSvg.locator(
        "path.relationshipLine.edge-pattern-dashed[data-pptx-fallback-ids]",
      )).toHaveCount(2);
      await expect(fallbackSvg.locator(
        "path.relationshipLine.edge-pattern-dashed[data-pptx-native]",
      )).toHaveCount(0);
      await expect(fallbackSvg.locator(
        "path.relationshipLine[data-pptx-native=connector]",
      )).toHaveCount(2);
      await expect(fallbackSvg.locator(
        "g.edgeLabel[data-pptx-native=shape]",
      )).toHaveCount(4);
      expect(await fallbackSvg.getAttribute("data-pptx-fallback-ids")).toBeNull();

      const packageBytes = buildPptxPackage({
        slides: [{ elements: native }],
      });
      expect(inspectPptxPackage(packageBytes).valid).toBe(true);
      const packageXml = packageBytes.toString("utf8");
      expect((packageXml.match(/<a:prstGeom prst="ellipse">/g) || []))
        .toHaveLength(4);
      expect(packageXml).not.toMatch(/<a:(?:headEnd|tailEnd)\b/);
      expect(packageXml).toContain('cap="flat"');
    } finally {
      await harness.close();
    }
  });
}

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  test(`real renderer exports requirement aliases, masks and local fallbacks (${theme})`, async ({ page }) => {
    const diagram = await readFixture("requirement-basic.mmd");
    const fallbackDiagram = diagram.replace(
      '{"handDrawnSeed": 42}',
      JSON.stringify({
        handDrawnSeed: 42,
        themeCSS:
          ".highlighted .divider{" +
          "filter:drop-shadow(30px 20px 10px red)} " +
          ".edgePaths path:nth-child(2){opacity:.5}",
      }),
    );
    const harness = await startHarness({
      slides: [
        `# Requirement\n\n\`\`\`mermaid\n${diagram}\n\`\`\``,
        `# Requirement lowercase\n\n\`\`\`mermaid\n${diagram.replace(
          /^requirementDiagram$/m,
          "requirementdiagram",
        )}\n\`\`\``,
        `# Requirement local fallback\n\n\`\`\`mermaid\n${fallbackDiagram}\n\`\`\``,
      ],
      theme,
      customThemeCss: theme === "custom"
        ? "--bg:#102030;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;"
        : "",
    });
    try {
      await page.goto(
        `${harness.url}/?pptx=1&token=${encodeURIComponent(
          harness.printToken,
        )}`,
      );
      await page.waitForFunction(() =>
        document.documentElement.hasAttribute("data-pptx-ready") ||
        document.documentElement.hasAttribute("data-pptx-error"),
      undefined, { timeout: 120_000 });
      await expect(page.locator("html"))
        .toHaveAttribute("data-pptx-ready", "true");
      await expect(page.locator(
        "pre.mermaid > svg[data-scene-backend=svg]",
      )).toHaveCount(3);
      const model = await page.evaluate(() => window.__presentationPptxModel);
      const native = model.slides[0].elements.filter((element) =>
        element.path?.startsWith("mermaid[0]."));
      const lowercase = model.slides[1].elements.filter((element) =>
        element.path?.startsWith("mermaid[0]."));
      expect(lowercase).toEqual(native);
      for (const elements of [native, lowercase]) {
        expect(elements.filter((element) => element.type === "shape"))
          .toHaveLength(18);
        expect(elements.filter((element) => element.type === "connector"))
          .toHaveLength(37);
        expect(elements.filter((element) => element.type === "text"))
          .toHaveLength(40);
        expect(elements.filter((element) =>
          element.mermaid?.kind === "requirement-relation"))
          .toHaveLength(7);
        expect(elements.filter((element) =>
          element.mermaid?.kind === "requirement-terminal"))
          .toHaveLength(15);
        expect(elements.filter((element) =>
          element.mermaid?.kind === "edge-label"))
          .toHaveLength(7);
      }
      expect(model.slides.slice(0, 2).flatMap((slide) =>
        slide.fallbacks.filter((entry) => entry.type === "mermaid")))
        .toEqual([]);

      const fallback = model.slides[2];
      const mermaidFallbacks = fallback.fallbacks.filter((entry) =>
        entry.type === "mermaid");
      expect(mermaidFallbacks.map((entry) => ({
        sourcePath: entry.sourcePath,
        reason: entry.reason,
        captureId: entry.captureId,
      }))).toEqual([
        {
          sourcePath: "relations[1]",
          reason: "unsupported-mermaid-requirement-terminal-compositing",
          captureId: expect.any(String),
        },
        {
          sourcePath: "requirements[0].dividers[0]",
          reason: "unsupported-mermaid-requirement-divider-style",
          captureId: expect.any(String),
        },
      ]);
      const dividerFallback = mermaidFallbacks.find((entry) =>
        entry.sourcePath === "requirements[0].dividers[0]");
      expect(dividerFallback.width).toBeGreaterThan(200);
      expect(dividerFallback.height).toBeGreaterThan(100);
      expect(fallback.elements.filter((element) =>
        element.mermaid?.kind === "requirement-relation"))
        .toHaveLength(6);
      expect(fallback.elements.filter((element) =>
        element.mermaid?.kind === "requirement-terminal"))
        .toHaveLength(13);
      expect(fallback.elements.filter((element) =>
        element.mermaid?.kind === "requirement-divider" &&
        element.type === "connector")).toHaveLength(14);
      expect(fallback.elements.filter((element) =>
        element.mermaid?.kind === "edge-label")).toHaveLength(7);

      const basicSvg = page.locator("pre.mermaid > svg").nth(0);
      const lowercaseSvg = page.locator("pre.mermaid > svg").nth(1);
      const fallbackSvg = page.locator("pre.mermaid > svg").nth(2);
      for (const svg of [basicSvg, lowercaseSvg, fallbackSvg]) {
        await expect(svg).toHaveAttribute(
          "aria-roledescription",
          "requirement",
        );
        await expect(svg).toHaveClass(/requirementDiagram/);
      }
      for (const svg of [basicSvg, lowercaseSvg]) {
        await expect(svg.locator(
          "g.nodes > g.node > g.outer-path[data-pptx-native=shape]",
        )).toHaveCount(10);
        await expect(svg.locator(
          "g.nodes > g.node > g.label[data-pptx-native=text]",
        )).toHaveCount(40);
        await expect(svg.locator(
          "g.nodes > g.node > g.divider > path[data-pptx-native=connector]",
        )).toHaveCount(8);
        await expect(svg.locator(
          "path.relationshipLine[data-pptx-native=connector]",
        )).toHaveCount(7);
        await expect(svg.locator(
          "g.edgeLabel[data-pptx-native=shape]",
        )).toHaveCount(7);
        await expect(svg.locator("[data-pptx-fallback-ids]"))
          .toHaveCount(0);
      }
      const masks = await basicSvg.evaluate((svg) => ({
        boxes: [...svg.querySelectorAll(
          "g.outer-path[data-pptx-native] > path",
        )].map((path) => {
          const style = getComputedStyle(path);
          return [style.fill, style.stroke];
        }),
        labels: [...svg.querySelectorAll(
          "g.node > g.label[data-pptx-native] span.nodeLabel",
        )].map((label) => getComputedStyle(label).color),
        dividers: [...svg.querySelectorAll(
          "g.divider > path[data-pptx-native]",
        )].map((path) => getComputedStyle(path).stroke),
        relations: [...svg.querySelectorAll(
          "path.relationshipLine[data-pptx-native]",
        )].map((path) => {
          const style = getComputedStyle(path);
          return [style.stroke, style.markerStart, style.markerEnd];
        }),
        relationLabels: [...svg.querySelectorAll(
          "g.edgeLabel[data-pptx-native] span.edgeLabel",
        )].map((label) => getComputedStyle(label).color),
      }));
      expect(masks.boxes).toEqual(Array(20).fill([
        "rgba(0, 0, 0, 0)",
        "rgba(0, 0, 0, 0)",
      ]));
      expect(masks.labels).toEqual(Array(40).fill("rgba(0, 0, 0, 0)"));
      expect(masks.dividers).toEqual(Array(8).fill("rgba(0, 0, 0, 0)"));
      expect(masks.relations).toEqual(Array(7).fill([
        "rgba(0, 0, 0, 0)",
        "none",
        "none",
      ]));
      expect(masks.relationLabels)
        .toEqual(Array(7).fill("rgba(0, 0, 0, 0)"));

      await expect(fallbackSvg.locator(
        'g.node[id$="-root_req"] > g.divider[data-pptx-fallback-ids]',
      )).toHaveCount(1);
      await expect(fallbackSvg.locator(
        'g.node[id$="-root_req"] > g.divider[data-pptx-native], ' +
        'g.node[id$="-root_req"] > g.divider > path[data-pptx-native]',
      )).toHaveCount(0);
      await expect(fallbackSvg.locator(
        'path.relationshipLine[data-id="root_req-copy_req-0"][data-pptx-fallback-ids]',
      )).toHaveCount(1);
      await expect(fallbackSvg.locator(
        'path.relationshipLine[data-id="root_req-copy_req-0"][data-pptx-native]',
      )).toHaveCount(0);
      await expect(fallbackSvg.locator(
        "path.relationshipLine[data-pptx-native=connector]",
      )).toHaveCount(6);
      await expect(fallbackSvg.locator(
        "g.edgeLabel[data-pptx-native=shape]",
      )).toHaveCount(7);
      expect(await fallbackSvg.getAttribute("data-pptx-fallback-ids"))
        .toBeNull();

      const packageBytes = buildPptxPackage({
        slides: [{ elements: native }],
      });
      expect(inspectPptxPackage(packageBytes).valid).toBe(true);
      const packageXml = packageBytes.toString("utf8");
      expect((packageXml.match(/<a:prstGeom prst="ellipse">/g) || []))
        .toHaveLength(1);
      expect(packageXml).not.toMatch(/<a:(?:headEnd|tailEnd)\b/);
    } finally {
      await harness.close();
    }
  });
}

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  test(`real renderer exports state aliases, exact markers and local state fallbacks (${theme})`, async ({ page }) => {
    const diagram = await readFixture("state-basic.mmd");
    const compound = [
      "stateDiagram-v2",
      "[*] --> Parent",
      "state Parent {",
      "  [*] --> Child",
      "  Child --> [*]",
      "}",
      "Parent --> Outside",
      "Outside --> [*]",
    ].join("\n");
    const harness = await startHarness({
      slides: [
        `# State v2\n\n\`\`\`mermaid\n${diagram}\n\`\`\``,
        `# State legacy\n\n\`\`\`mermaid\n${diagram.replace(/^stateDiagram-v2$/m, "stateDiagram")}\n\`\`\``,
        `# Compound state\n\n\`\`\`mermaid\n${compound}\n\`\`\``,
      ],
      theme,
      customThemeCss: theme === "custom"
        ? "--bg:#102030;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;"
        : "",
    });
    try {
      await page.goto(`${harness.url}/?pptx=1&token=${encodeURIComponent(harness.printToken)}`);
      await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready") ||
        document.documentElement.hasAttribute("data-pptx-error"), undefined, { timeout: 120_000 });
      await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
      await expect(page.locator("pre.mermaid > svg[data-scene-backend=svg]")).toHaveCount(3);
      const model = await page.evaluate(() => window.__presentationPptxModel);
      const basic = model.slides[0].elements.filter((element) =>
        element.path?.startsWith("mermaid[0].state."));
      const legacy = model.slides[1].elements.filter((element) =>
        element.path?.startsWith("mermaid[0].state."));
      expect(legacy).toEqual(basic);
      expect(basic.filter((element) => element.type === "connector")).toHaveLength(4);
      expect(basic.filter((element) => element.type === "shape")).toHaveLength(9);
      expect(basic.filter((element) => element.arrowEnd === "stealth")).toHaveLength(4);
      expect(basic.filter((element) => element.dash === "dash")).toHaveLength(1);
      expect(basic.find((element) => element.dash === "dash")).toMatchObject({
        opacity: 0.75,
        arrowStart: "none",
        arrowEnd: "stealth",
      });
      const textOf = (element) => (element.text?.paragraphs || element.paragraphs || [])
        .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
        .join("\n");
      expect(basic.map(textOf)).toEqual(expect.arrayContaining([
        "待機\nIdle",
        "Running",
        "開始\nStart",
        "停止\nStop",
      ]));
      expect(model.slides.slice(0, 2).flatMap((slide) =>
        slide.fallbacks.filter((fallback) => fallback.type === "mermaid"))).toEqual([]);

      const compoundSlide = model.slides[2];
      expect(compoundSlide.elements.filter((element) =>
        element.path?.startsWith("mermaid[0].state.") &&
        element.type === "connector")).toHaveLength(5);
      expect(compoundSlide.elements.filter((element) =>
        element.mermaid?.kind === "state").map(textOf)).toEqual(["Child", "Outside"]);
      expect(compoundSlide.fallbacks.filter((fallback) =>
        fallback.type === "mermaid")).toMatchObject([{
        sourcePath: "state.regions[0].containers[0]",
        reason: "unsupported-mermaid-state-compound",
      }]);

      for (const index of [0, 1]) {
        const svg = page.locator("pre.mermaid > svg").nth(index);
        await expect(svg).toHaveAttribute("aria-roledescription", "stateDiagram");
        await expect(svg.locator(
          "g.node.statediagram-state[data-pptx-native=shape] > rect.basic",
        )).toHaveCount(2);
        await expect(svg.locator(
          "circle.state-start[data-pptx-native=shape]",
        )).toHaveCount(1);
        await expect(svg.locator(
          "g.outer-path path[data-pptx-native=shape]",
        )).toHaveCount(4);
        await expect(svg.locator(
          "path.transition[data-pptx-native=connector]",
        )).toHaveCount(4);
        await expect(svg.locator(
          "g.edgeLabel[data-pptx-native=shape]",
        )).toHaveCount(2);
        await expect(svg.locator("[data-pptx-fallback-ids]")).toHaveCount(0);
        const masks = await svg.evaluate((element) => ({
          states: [...element.querySelectorAll(
            "g.node.statediagram-state[data-pptx-native=shape] > rect.basic",
          )].map((state) => {
            const style = getComputedStyle(state);
            return [style.fill, style.stroke];
          }),
          start: [...element.querySelectorAll(
            "circle.state-start[data-pptx-native=shape]",
          )].map((state) => {
            const style = getComputedStyle(state);
            return [style.fill, style.stroke];
          }),
          end: [...element.querySelectorAll(
            "g.outer-path path[data-pptx-native=shape]",
          )].map((state) => {
            const style = getComputedStyle(state);
            return [style.fill, style.stroke];
          }),
          transitions: [...element.querySelectorAll(
            "path.transition[data-pptx-native=connector]",
          )].map((edge) => {
            const style = getComputedStyle(edge);
            return [style.stroke, style.markerStart, style.markerEnd];
          }),
          labels: [...element.querySelectorAll(
            "g.edgeLabel[data-pptx-native=shape] span.edgeLabel",
          )].map((label) => getComputedStyle(label).color),
        }));
        expect(masks.states).toEqual(Array(2).fill([
          "rgba(0, 0, 0, 0)",
          "rgba(0, 0, 0, 0)",
        ]));
        expect(masks.start).toEqual([[
          "rgba(0, 0, 0, 0)",
          "rgba(0, 0, 0, 0)",
        ]]);
        expect(masks.end).toEqual(Array(4).fill([
          "rgba(0, 0, 0, 0)",
          "rgba(0, 0, 0, 0)",
        ]));
        expect(masks.transitions).toEqual(Array(4).fill([
          "rgba(0, 0, 0, 0)",
          "none",
          "none",
        ]));
        expect(masks.labels).toEqual(Array(2).fill("rgba(0, 0, 0, 0)"));
      }

      const compoundSvg = page.locator("pre.mermaid > svg").nth(2);
      await expect(compoundSvg.locator(
        "g.statediagram-cluster[data-pptx-fallback-ids]",
      )).toHaveCount(1);
      await expect(compoundSvg.locator(
        "path.transition[data-pptx-native=connector]",
      )).toHaveCount(5);
      await expect(compoundSvg.locator(
        "g.node.statediagram-state[data-pptx-native=shape] > rect.basic",
      )).toHaveCount(2);
      expect(await compoundSvg.getAttribute("data-pptx-fallback-ids")).toBeNull();

      const statePackage = buildPptxPackage({ slides: [{ elements: basic }] });
      expect(inspectPptxPackage(statePackage).valid).toBe(true);
      expect((statePackage.toString("utf8").match(/<a:tailEnd type="stealth"\/>/g) || []))
        .toHaveLength(4);
    } finally {
      await harness.close();
    }
  });
}

test("actual export keeps rotated composites and connectors as exact local pictures", async ({ page }) => {
  const diagram = [
    '%%{init: {"themeCSS": "g.node:first-of-type{transform:rotate(12deg)} path.flowchart-link:nth-of-type(2){transform:rotate(8deg)}"}}%%',
    "flowchart LR",
    "A[One] --> B{Two}",
    "B -->|yes| C[Three]",
    "B --> D[Four]",
  ].join("\n");
  const harness = await startHarness({
    slides: [`# Local transform pictures\n\n\`\`\`mermaid\n${diagram}\n\`\`\``],
  });
  try {
    await page.goto(`${harness.url}/?pptx=1&token=${encodeURIComponent(harness.printToken)}`);
    await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready") ||
      document.documentElement.hasAttribute("data-pptx-error"), undefined, { timeout: 120_000 });
    await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
    const result = await page.evaluate(() => {
      const slide = window.__presentationPptxModel.slides[0];
      const svg = document.querySelector("pre.mermaid > svg");
      return {
        fallbacks: slide.fallbacks.filter((fallback) => fallback.type === "mermaid")
          .map((fallback) => ({
            sourcePath: fallback.sourcePath,
            reason: fallback.reason,
            captureId: fallback.captureId,
          })),
        nativePaths: slide.elements.filter((element) => element.path?.startsWith("mermaid[0]."))
          .map((element) => element.path),
        nodes: [...svg.querySelectorAll("g.node")].map((node) => ({
          text: node.textContent,
          native: node.getAttribute("data-pptx-native"),
          fallback: node.getAttribute("data-pptx-fallback-ids"),
        })),
        edges: [...svg.querySelectorAll("path.flowchart-link")].map((edge) => ({
          native: edge.getAttribute("data-pptx-native"),
          fallback: edge.getAttribute("data-pptx-fallback-ids"),
          stroke: getComputedStyle(edge).stroke,
          marker: getComputedStyle(edge).markerEnd,
        })),
        label: {
          native: svg.querySelector("g.edgeLabel:has(p)")?.getAttribute("data-pptx-native"),
          text: svg.querySelector("g.edgeLabel:has(p)")?.textContent,
        },
        svgFallback: svg.getAttribute("data-pptx-fallback-ids"),
      };
    });
    expect(result.fallbacks).toEqual([
      {
        sourcePath: "edges[1]",
        reason: "unsupported-mermaid-edge-transform",
        captureId: expect.stringMatching(/^pptx-fallback-\d+$/),
      },
      {
        sourcePath: "nodes[0]",
        reason: "unsupported-mermaid-node-transform",
        captureId: expect.stringMatching(/^pptx-fallback-\d+$/),
      },
    ]);
    expect(result.nativePaths).toEqual(expect.arrayContaining([
      "mermaid[0].edges[0]",
      "mermaid[0].edges[2]",
      "mermaid[0].edgeLabels[L_B_C_0]",
      "mermaid[0].nodes[1]",
      "mermaid[0].nodes[2]",
      "mermaid[0].nodes[3]",
    ]));
    expect(result.nodes).toEqual([
      { text: "One", native: null, fallback: expect.stringMatching(/^pptx-fallback-\d+$/) },
      { text: "Two", native: "shape", fallback: null },
      { text: "Three", native: "shape", fallback: null },
      { text: "Four", native: "shape", fallback: null },
    ]);
    expect(result.edges[0]).toEqual({
      native: "connector",
      fallback: null,
      stroke: "rgba(0, 0, 0, 0)",
      marker: "none",
    });
    expect(result.edges[1]).toMatchObject({
      native: null,
      fallback: expect.stringMatching(/^pptx-fallback-\d+$/),
      stroke: expect.not.stringMatching(/^rgba\(0, 0, 0, 0\)$/),
      marker: expect.stringContaining("pointEnd"),
    });
    expect(result.edges[2]).toEqual(result.edges[0]);
    expect(result.label).toEqual({ native: "shape", text: "yes" });
    expect(result.svgFallback).toBeNull();
  } finally {
    await harness.close();
  }
});

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  test(`real renderer exports rotated text and localizes unsupported text transforms (${theme})`, async ({ page }) => {
    const slideSource = [
      "# Rotated Mermaid text",
      "",
      "```mermaid",
      '%%{init: {"themeCSS": "text.messageText:first-of-type{transform-box:fill-box;transform-origin:center;transform:rotate(-30deg)} text.messageText:last-of-type{transform:skewX(12deg)}"}}%%',
      "sequenceDiagram",
      "participant A as Client",
      "participant B as Service",
      "A->>B: Rotated",
      "B-->>A: Skewed",
      "```",
    ].join("\n");
    const harness = await startHarness({
      slides: [slideSource],
      theme,
      customThemeCss: theme === "custom"
        ? "--bg:#102030;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;"
        : "",
    });
    try {
      await page.goto(`${harness.url}/?pptx=1&token=${encodeURIComponent(harness.printToken)}`);
      await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready") ||
        document.documentElement.hasAttribute("data-pptx-error"), undefined, { timeout: 120_000 });
      await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
      const result = await page.evaluate(() => {
        const slide = window.__presentationPptxModel.slides[0];
        const svg = document.querySelector("pre.mermaid > svg");
        const deckRect = svg.closest(".deck").getBoundingClientRect();
        const labels = [...svg.querySelectorAll("text.messageText")];
        const source = labels.find((label) => label.textContent === "Rotated");
        const sourceRect = source.getBoundingClientRect();
        const node = svg.__presentationScene.nodes.find((entry) =>
          entry.text?.paragraphs.some((paragraph) =>
            paragraph.runs.some((run) => run.text === "Rotated")));
        const element = slide.elements.find((entry) => entry.path === `mermaid[0].${node.sourcePath}`);
        return {
          slide,
          node,
          element,
          source: {
            centerX: sourceRect.left - deckRect.left + sourceRect.width / 2,
            centerY: sourceRect.top - deckRect.top + sourceRect.height / 2,
            width: sourceRect.width,
            height: sourceRect.height,
          },
          masks: labels.map((label) => ({
            text: label.textContent,
            native: label.getAttribute("data-pptx-native"),
            fallback: label.getAttribute("data-pptx-fallback-ids"),
            fill: getComputedStyle(label).fill,
          })),
        };
      });
      expect(result.node).toMatchObject({
        kind: "text",
        rotation: -30,
      });
      expect(result.element).toMatchObject({
        type: "text",
        rotation: -30,
      });
      expect(Math.abs(result.source.centerX -
        (result.element.x + result.element.width / 2))).toBeLessThanOrEqual(0.11);
      expect(Math.abs(result.source.centerY -
        (result.element.y + result.element.height / 2))).toBeLessThanOrEqual(0.11);
      const radians = Math.PI / 6;
      expect(Math.abs(result.source.width -
        (Math.cos(radians) * result.element.width + Math.sin(radians) * result.element.height)))
        .toBeLessThanOrEqual(0.2);
      expect(Math.abs(result.source.height -
        (Math.sin(radians) * result.element.width + Math.cos(radians) * result.element.height)))
        .toBeLessThanOrEqual(0.2);
      expect(result.slide.fallbacks.filter((fallback) => fallback.type === "mermaid")).toMatchObject([{
        sourcePath: expect.stringMatching(/^sequence\[\d+\]$/),
        reason: "unsupported-mermaid-text-transform",
      }]);
      expect(result.slide.elements.filter((element) => element.type === "connector" &&
        element.path?.startsWith("mermaid[0].sequence["))).toHaveLength(4);
      expect(result.masks).toEqual([
        { text: "Rotated", native: "text", fallback: null, fill: "rgba(0, 0, 0, 0)" },
        {
          text: "Skewed",
          native: null,
          fallback: expect.stringMatching(/^pptx-fallback-\d+$/),
          fill: expect.not.stringMatching(/^rgba\(0, 0, 0, 0\)$/),
        },
      ]);
      const xml = buildPptxPackage({
        title: "Rotated Mermaid text",
        slides: [{ elements: result.slide.elements }],
      }).toString("utf8");
      expect(xml).toContain('<a:xfrm rot="-1800000">');
    } finally {
      await harness.close();
    }
  });
}

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  test(`real renderer exports sequence self, asynchronous messages and editable loop frames (${theme})`, async ({ page }) => {
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
      expect(connectors).toHaveLength(21);
      expect(connectors.filter((element) => element.arrowEnd === "stealth")).toHaveLength(4);
      expect(connectors.filter((element) => element.arrowStart === "triangle")).toHaveLength(2);
      expect(connectors.filter((element) => element.points.length > 2)).toHaveLength(7);
      expect(connectors.filter((element) => element.mermaid?.shape === "cross")).toHaveLength(4);
      expect(connectors.filter((element) => element.mermaid?.kind === "sequence-frame-line")).toHaveLength(4);
      expect(slide.elements.filter((element) => element.shape === "sequenceTab")).toHaveLength(1);
      const labels = slide.elements.filter((element) => element.type === "text" &&
        element.path?.startsWith("mermaid[0].sequence["))
        .map((element) => element.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join("")).join("\n"));
      // The sequence renderer emits each line of a multiline message as a separate text element.
      expect(labels).toEqual([
        "Service", "Client", "Service", "Client", "loop", "[Retry loop]", "\u78ba\u8a8d", "\u51e6\u7406", "Retry",
        "\u975e\u540c\u671f", "\u9001\u4fe1", "Notify", "Schedule", "Exchange", "Recheck", "Reschedule",
        "Cancel self", "Cancel remote", "Again",
      ]);
      const fallbacks = slide.fallbacks.filter((fallback) => fallback.type === "mermaid");
      expect(fallbacks).toEqual([]);
      const svg = page.locator("pre.mermaid > svg");
      expect(await svg.getAttribute("data-pptx-fallback-ids")).toBeNull();
      await expect(svg.locator("path[data-et=message][data-pptx-native=connector]")).toHaveCount(7);
      await expect(svg.locator("line[data-et=message][data-pptx-native=connector]")).toHaveCount(4);
      await expect(svg.locator('g[data-et="control-structure"] line.loopLine[data-pptx-native=connector]')).toHaveCount(4);
      await expect(svg.locator('g[data-et="control-structure"] polygon.labelBox[data-pptx-native=shape]')).toHaveCount(1);
      await expect(svg.locator("[data-et=message][data-pptx-fallback-ids]")).toHaveCount(0);
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
      expect(masks.messages).toHaveLength(11);
      for (const message of masks.messages) {
        expect(message).toMatchObject({ stroke: "rgba(0, 0, 0, 0)", start: "none", end: "none" });
        expect(connectors.some((connector) => connector.path === `mermaid[0].${message.path}` ||
          connector.path === `mermaid[0].${message.path}.line`)).toBe(true);
      }
      expect(masks.fallback).toEqual([]);
      expect(masks.labels).toEqual(Array(13).fill({ native: "text", fill: "rgba(0, 0, 0, 0)" }));
    } finally {
      await harness.close();
    }
  });

  test(`real renderer masks native sequence decorations and keeps the box shadow local (${theme})`, async ({ page }) => {
    const diagram = await readFixture("sequence-decorations.mmd");
    const harness = await startHarness({
      slides: [`# Sequence decorations\n\n\`\`\`mermaid\n${diagram}\n\`\`\``],
      theme,
      customThemeCss: theme === "custom" ? "--bg:#102030;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;" : "",
    });
    try {
      await page.goto(`${harness.url}/?pptx=1&token=${encodeURIComponent(harness.printToken)}`);
      await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready") ||
        document.documentElement.hasAttribute("data-pptx-error"), undefined, { timeout: 120_000 });
      await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
      const slide = await page.evaluate(() => window.__presentationPptxModel.slides[0]);
      const sequence = slide.elements.filter((element) => element.path?.startsWith("mermaid[0].sequence["));
      expect(sequence.filter((element) => element.type === "shape")).toHaveLength(18);
      expect(sequence.filter((element) => element.type === "connector")).toHaveLength(36);
      expect(sequence.filter((element) => element.type === "text")).toHaveLength(34);
      expect(sequence.filter((element) => element.shape === "sequenceTab")).toHaveLength(4);
      expect(sequence.filter((element) => element.mermaid?.kind === "sequence-frame-line")).toHaveLength(18);
      expect(sequence.filter((element) => element.mermaid?.kind === "sequence-frame-label")).toHaveLength(10);
      expect(sequence.filter((element) => element.mermaid?.kind === "sequence-number-background")).toHaveLength(7);
      expect(sequence.filter((element) => element.mermaid?.kind === "sequence-number")).toHaveLength(7);
      expect(sequence.filter((element) => element.mermaid?.kind === "sequence-actor-part")).toHaveLength(10);
      expect(sequence.filter((element) => element.mermaid?.kind === "sequence-actor-label")).toHaveLength(4);
      expect(sequence.filter((element) => element.mermaid?.kind === "sequence-background")).toHaveLength(1);
      expect(sequence.filter((element) => element.mermaid?.kind === "sequence-box-title")
        .map((element) => element.paragraphs[0].runs[0].text)).toEqual(["サービス層"]);
      expect(slide.fallbacks.filter((fallback) => fallback.type === "mermaid")).toMatchObject([{
        path: "mermaid[0].sequence[0]",
        sourcePath: "sequence[0]",
        reason: "unsupported-mermaid-sequence-style",
      }]);

      const svg = page.locator("pre.mermaid > svg");
      expect(await svg.getAttribute("data-pptx-fallback-ids")).toBeNull();
      await expect(svg.locator(":scope > rect.rect[data-pptx-native=shape]")).toHaveCount(1);
      await expect(svg.locator(":scope > g > rect.rect[data-pptx-fallback-ids]")).toHaveCount(1);
      await expect(svg.locator(":scope > g > text.text[data-pptx-native=text]")).toHaveCount(1);
      await expect(svg.locator("rect.actor[data-pptx-native=shape]")).toHaveCount(4);
      await expect(svg.locator("text.actor.actor-box[data-pptx-native=text]")).toHaveCount(4);
      await expect(svg.locator("g.actor-man line[data-pptx-native=connector]")).toHaveCount(8);
      await expect(svg.locator("g.actor-man circle[data-pptx-native=shape]")).toHaveCount(2);
      await expect(svg.locator("g.actor-man text[data-pptx-native=text]")).toHaveCount(4);
      await expect(svg.locator("line.actor-line[data-pptx-native=connector]")).toHaveCount(3);
      await expect(svg.locator('g[data-et="control-structure"] line.loopLine[data-pptx-native=connector]')).toHaveCount(18);
      await expect(svg.locator('g[data-et="control-structure"] polygon.labelBox[data-pptx-native=shape]')).toHaveCount(4);
      await expect(svg.locator('g[data-et="control-structure"] text[data-pptx-native=text]')).toHaveCount(10);
      await expect(svg.locator('line[marker-start*="sequencenumber"][data-pptx-native=connector]')).toHaveCount(7);
      await expect(svg.locator("text.sequenceNumber[data-pptx-native=text]")).toHaveCount(7);
      await expect(svg.locator("[data-et=message][data-pptx-native=connector]")).toHaveCount(7);
      await expect(svg.locator("[data-et=message][data-pptx-fallback-ids]")).toHaveCount(0);

      const masks = await svg.evaluate((element) => ({
        background: [...element.querySelectorAll(":scope > rect.rect[data-pptx-native]")].map((entry) => {
          const style = getComputedStyle(entry);
          return [style.fill, style.stroke];
        }),
        boxFallbacks: [...element.querySelectorAll(":scope > g > rect.rect[data-pptx-fallback-ids]")]
          .map((entry) => entry.getAttribute("data-pptx-fallback-ids")),
        actorLines: [...element.querySelectorAll("g.actor-man line[data-pptx-native]")].map((entry) =>
          getComputedStyle(entry).stroke),
        actorHeads: [...element.querySelectorAll("g.actor-man circle[data-pptx-native]")].map((entry) => {
          const style = getComputedStyle(entry);
          return [style.fill, style.stroke];
        }),
        tabs: [...element.querySelectorAll("polygon.labelBox[data-pptx-native]")].map((entry) => {
          const style = getComputedStyle(entry);
          return [style.fill, style.stroke];
        }),
        numberMarkers: [...element.querySelectorAll('line[marker-start*="sequencenumber"][data-pptx-native]')]
          .map((entry) => getComputedStyle(entry).markerStart),
        nativeText: [...element.querySelectorAll("text.sequenceNumber[data-pptx-native], :scope > g > text.text[data-pptx-native]")]
          .map((entry) => getComputedStyle(entry).fill),
      }));
      expect(masks.background).toEqual([["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"]]);
      expect(masks.boxFallbacks).toHaveLength(1);
      expect(masks.boxFallbacks[0]).toMatch(/^pptx-fallback-\d+$/);
      expect(masks.actorLines).toEqual(Array(8).fill("rgba(0, 0, 0, 0)"));
      expect(masks.actorHeads).toEqual(Array(2).fill(["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"]));
      expect(masks.tabs).toEqual(Array(4).fill(["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"]));
      expect(masks.numberMarkers).toEqual(Array(7).fill("none"));
      expect(masks.nativeText).toEqual(Array(8).fill("rgba(0, 0, 0, 0)"));
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
      expect(edges.filter((edge) => edge.mermaid?.kind !== "marker").map((edge) => [edge.arrowStart, edge.arrowEnd])).toEqual([
        ["diamond", "none"], ["none", "stealth"], ["none", "stealth"], ["none", "none"],
        ["none", "none"], ["none", "none"],
      ]);
      expect(edges.filter((edge) => edge.mermaid?.kind === "marker").map((edge) => edge.mermaid.shape))
        .toEqual(["hollow-triangle", "hollow-diamond"]);
      const terminals = slide.elements.filter((element) => element.mermaid?.kind === "edge-terminal");
      expect(terminals.map((terminal) => terminal.text.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(""))))
        .toEqual([["1"], ["0..*", "\u8907\u6570"]]);
      expect(slide.elements.some((element) => element.text?.paragraphs?.map((paragraph) =>
        paragraph.runs.map((run) => run.text).join("")).join("\n") === "\u5408\u6210\n\u95a2\u4fc2")).toBe(true);
      expect(slide.fallbacks.filter((fallback) => fallback.type === "mermaid")).toEqual([]);
      const svg = page.locator("pre.mermaid > svg");
      await expect(svg.locator("path.relation[data-pptx-native=connector]")).toHaveCount(6);
      await expect(svg.locator("g.edgeTerminals[data-pptx-native=shape]")).toHaveCount(2);
      await expect(svg.locator("path.relation[data-pptx-fallback-ids]")).toHaveCount(0);
      expect(await svg.getAttribute("data-pptx-fallback-ids")).toBeNull();
      const masks = await svg.evaluate((svg) => ({
        edges: [...svg.querySelectorAll("path.relation[data-pptx-native]")].map((edge) => {
          const style = getComputedStyle(edge);
          return [style.stroke, style.markerStart, style.markerEnd];
        }),
        labels: [...svg.querySelectorAll("g.edgeTerminals span.edgeLabel")].map((label) => getComputedStyle(label).color),
        fallbackMarkers: [...svg.querySelectorAll("path.relation[data-pptx-fallback-ids]")].map((edge) => getComputedStyle(edge).markerStart),
      }));
      expect(masks.edges).toEqual(Array(6).fill(["rgba(0, 0, 0, 0)", "none", "none"]));
      expect(masks.labels).toEqual(Array(2).fill("rgba(0, 0, 0, 0)"));
      expect(masks.fallbackMarkers).toEqual([]);
    } finally {
      await harness.close();
    }
  });
}

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  test(`real renderer preserves independent Mermaid paint alpha and native masks (${theme})`, async ({ page }) => {
    const diagram = await readFixture("paint-alpha.mmd");
    const harness = await startHarness({
      slides: [`# Paint alpha\n\n\`\`\`mermaid\n${diagram}\n\`\`\``],
      theme,
      customThemeCss: theme === "custom"
        ? "--bg:#102030;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;"
        : "",
    });
    try {
      await page.goto(`${harness.url}/?pptx=1&token=${encodeURIComponent(harness.printToken)}`);
      await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready") ||
        document.documentElement.hasAttribute("data-pptx-error"), undefined, { timeout: 120_000 });
      await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
      const slide = await page.evaluate(() => window.__presentationPptxModel.slides[0]);
      expect(slide.fallbacks.filter((fallback) => fallback.type === "mermaid")).toEqual([]);
      const rect = slide.elements.find((element) => element.fill === "rgba(51, 102, 153, 0.5)");
      const circle = slide.elements.find((element) => element.fill === "rgba(34, 170, 68, 0.5)");
      const edge = slide.elements.find((element) => element.stroke === "rgba(0, 136, 204, 0.5)");
      expect(rect).toMatchObject({
        type: "shape",
        opacity: 0.8,
        fillOpacity: 0.5,
        strokeOpacity: 0.25,
      });
      expect(circle).toMatchObject({
        type: "shape",
        opacity: 0.6,
        fillOpacity: 0.7,
        strokeOpacity: 0.3,
      });
      expect(edge).toMatchObject({
        type: "connector",
        opacity: 0.5,
        strokeOpacity: 0.4,
      });
      const xml = buildPptxPackage({ slides: [{ elements: slide.elements }] }).toString("utf8");
      expect(xml).toContain('<a:srgbClr val="336699"><a:alpha val="20000"/></a:srgbClr>');
      expect(xml).toContain('<a:srgbClr val="CC3300"><a:alpha val="10000"/></a:srgbClr>');
      expect(xml).toContain('<a:srgbClr val="22AA44"><a:alpha val="21000"/></a:srgbClr>');
      expect(xml).toContain('<a:srgbClr val="8844CC"><a:alpha val="9000"/></a:srgbClr>');
      expect(xml).toContain('<a:srgbClr val="0088CC"><a:alpha val="10000"/></a:srgbClr>');

      const svg = page.locator("pre.mermaid > svg");
      await expect(svg.locator("g.node[data-pptx-native=shape]")).toHaveCount(2);
      await expect(svg.locator("path.flowchart-link[data-pptx-native=connector]")).toHaveCount(1);
      await expect(svg.locator("[data-pptx-fallback-ids]")).toHaveCount(0);
      const masks = await svg.evaluate((element) => ({
        scene: element.__presentationScene.nodes
          .filter((node) => ["edges[0]", "nodes[0]", "nodes[1]"].includes(node.sourcePath))
          .map((node) => ({ path: node.sourcePath, style: node.style })),
        nodes: [...element.querySelectorAll("g.node[data-pptx-native] > .label-container")].map((node) => {
          const style = getComputedStyle(node);
          return {
            fill: style.fill,
            stroke: style.stroke,
          };
        }),
        edges: [...element.querySelectorAll("path.flowchart-link[data-pptx-native]")].map((node) => {
          const style = getComputedStyle(node);
          return {
            stroke: style.stroke,
          };
        }),
      }));
      expect(masks.scene).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: "edges[0]",
          style: expect.objectContaining({ opacity: 0.5, strokeOpacity: 0.4 }),
        }),
        expect.objectContaining({
          path: "nodes[0]",
          style: expect.objectContaining({ opacity: 0.8, fillOpacity: 0.5, strokeOpacity: 0.25 }),
        }),
        expect.objectContaining({
          path: "nodes[1]",
          style: expect.objectContaining({ opacity: 0.6, fillOpacity: 0.7, strokeOpacity: 0.3 }),
        }),
      ]));
      expect(masks.nodes).toEqual([
        {
          fill: "rgba(0, 0, 0, 0)",
          stroke: "rgba(0, 0, 0, 0)",
        },
        {
          fill: "rgba(0, 0, 0, 0)",
          stroke: "rgba(0, 0, 0, 0)",
        },
      ]);
      expect(masks.edges).toEqual([{
        stroke: "rgba(0, 0, 0, 0)",
      }]);
    } finally {
      await harness.close();
    }
  });
}

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  test(`real renderer masks Priority 5 flowchart shapes and class containers (${theme})`, async ({ page }) => {
    const [flowchart, classes] = await Promise.all([
      readFixture("flowchart-additional-shapes.mmd"),
      readFixture("class-containers.mmd"),
    ]);
    const harness = await startHarness({
      slides: [
        `# Flowchart shapes\n\n\`\`\`mermaid\n${flowchart}\n\`\`\``,
        `# Class containers\n\n\`\`\`mermaid\n${classes}\n\`\`\``,
      ],
      theme,
      customThemeCss: theme === "custom"
        ? "--bg:#102030;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;"
        : "",
    });
    try {
      await page.goto(`${harness.url}/?pptx=1&token=${encodeURIComponent(harness.printToken)}`);
      await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready") ||
        document.documentElement.hasAttribute("data-pptx-error"), undefined, { timeout: 120_000 });
      await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
      const model = await page.evaluate(() => window.__presentationPptxModel);

      const flow = model.slides[0];
      expect(flow.fallbacks.filter((fallback) => fallback.type === "mermaid")).toEqual([]);
      expect(flow.elements.filter((element) => element.path?.startsWith("mermaid[0].nodes[0]."))).toHaveLength(4);
      expect(flow.elements.filter((element) => element.path?.startsWith("mermaid[0].nodes[1]."))).toHaveLength(4);
      expect(flow.elements.filter((element) => element.shape === "trapezoid")).toHaveLength(2);
      expect(flow.elements.filter((element) => element.shape === "invertedTrapezoid")).toHaveLength(2);
      expect(flow.elements.filter((element) => element.shape === "reverseParallelogram")).toHaveLength(2);
      const flowSvg = page.locator("pre.mermaid > svg").nth(0);
      await expect(flowSvg.locator("g.node[data-pptx-native=shape]")).toHaveCount(8);
      await expect(flowSvg.locator("g.node[data-pptx-fallback-ids]")).toHaveCount(0);

      const classSlide = model.slides[1];
      expect(classSlide.fallbacks.filter((fallback) => fallback.type === "mermaid")).toEqual([]);
      expect(classSlide.elements.filter((element) => element.mermaid?.kind === "class-namespace")).toHaveLength(3);
      expect(classSlide.elements.filter((element) => element.mermaid?.kind === "class-namespace-label")).toHaveLength(3);
      const notes = classSlide.elements.filter((element) => element.mermaid?.kind === "class-note");
      expect(notes).toHaveLength(["dark", "custom"].includes(theme) ? 4 : 2);
      expect(new Set(notes.map((element) => element.path.replace(/\.paths\[\d+\]$/, ""))).size).toBe(2);
      expect(classSlide.elements.filter((element) => element.mermaid?.kind === "class-note-label")).toHaveLength(2);
      expect(classSlide.elements.filter((element) => element.mermaid?.kind === "edge" &&
        element.path?.startsWith("mermaid[0].edges["))).toHaveLength(5);
      const classSvg = page.locator("pre.mermaid > svg").nth(1);
      await expect(classSvg.locator("g.cluster > rect[data-pptx-native=shape]")).toHaveCount(3);
      await expect(classSvg.locator("g.cluster > g.cluster-label[data-pptx-native=text]")).toHaveCount(3);
      await expect(classSvg.locator("g.node:has(.noteLabel) > g.label-container[data-pptx-native=shape]")).toHaveCount(2);
      await expect(classSvg.locator("g.node > g.noteLabel[data-pptx-native=text]")).toHaveCount(2);
      await expect(classSvg.locator("path.relation[data-pptx-native=connector]")).toHaveCount(5);
      await expect(classSvg.locator("[data-pptx-fallback-ids]")).toHaveCount(0);
      const masks = await classSvg.evaluate((svg) => ({
        namespaceFrames: [...svg.querySelectorAll("g.cluster > rect[data-pptx-native]")].map((element) => {
          const style = getComputedStyle(element);
          return [style.fill, style.stroke];
        }),
        noteFrames: [...svg.querySelectorAll("g.node:has(.noteLabel) > g.label-container[data-pptx-native]")]
          .map((element) => [...element.querySelectorAll("path")].map((path) => {
            const style = getComputedStyle(path);
            return [style.fill, style.stroke];
          })),
        relations: [...svg.querySelectorAll("path.relation[data-pptx-native]")].map((element) => {
          const style = getComputedStyle(element);
          return [style.stroke, style.markerStart, style.markerEnd];
        }),
      }));
      expect(masks.namespaceFrames).toEqual(Array(3).fill(["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"]));
      expect(masks.noteFrames.every((paths) =>
        paths.every((paint) => paint[0] === "rgba(0, 0, 0, 0)" && paint[1] === "rgba(0, 0, 0, 0)"))).toBe(true);
      expect(masks.relations).toEqual(Array(5).fill(["rgba(0, 0, 0, 0)", "none", "none"]));
    } finally {
      await harness.close();
    }
  });
}
