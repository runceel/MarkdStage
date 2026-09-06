import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { validateScene } from "../../.github/extensions/markdstage/renderer/scene-graph.mjs";
import { sceneToPptxElements } from "../../.github/extensions/markdstage/renderer/scene-pptx.mjs";
import { buildPptxPackage, inspectPptxPackage } from "../../.github/extensions/markdstage/runtime/pptx-package.mjs";
import { startHarness } from "../harness/server.mjs";

const fixture = (name, extension = "svg") => readFile(new URL(`../fixtures/mermaid/${name}.${extension}`, import.meta.url), "utf8");
const cases = [
  ["class-hollow", 10, { "hollow-triangle": 6, "hollow-diamond": 4 }],
  ["flowchart-cross", 10, { cross: 10 }],
  ["sequence-cross", 8, { cross: 8 }],
];

async function extract(page) {
  return page.evaluate(async () => {
    const { mermaidSvgToScene } = await import("./renderer/mermaid-scene.mjs");
    const deck = document.querySelector("#fixture-deck");
    const result = mermaidSvgToScene(deck.querySelector("svg"), { deck, includeSourceElements: true });
    window.markerResult = result;
    return {
      scene: result.scene, diagnostics: result.diagnostics,
      sources: result.scene.nodes.map((node) => {
        const source = result.sourceElements.get(node.sourcePath);
        return { path: node.sourcePath, tag: source?.localName, id: source?.id || "", d: source?.getAttribute("d"),
          start: source && getComputedStyle(source).markerStart, end: source && getComputedStyle(source).markerEnd };
      }),
    };
  });
}

async function load(page, name) {
  await page.evaluate((svg) => {
    document.body.innerHTML = `<style>body{margin:0}#fixture-deck{position:relative;width:1200px;height:900px}</style><div id="fixture-deck">${svg}</div>`;
  }, await fixture(name));
  return extract(page);
}

function assertPackage(scene) {
  const mapped = sceneToPptxElements(scene);
  expect(mapped.fallbacks.map((fallback) => [fallback.sourcePath, fallback.reason]))
    .toEqual(scene.nodes.filter((node) => node.kind === "fallback").map((node) => [node.sourcePath, node.reason]));
  const packageBytes = buildPptxPackage({ slides: [{ elements: mapped.elements }] });
  expect(inspectPptxPackage(packageBytes).valid).toBe(true);
  const xml = packageBytes.toString("utf8");
  const markers = mapped.elements.filter((element) => element.mermaid?.kind === "marker");
  const markerPackage = buildPptxPackage({ slides: [{ elements: markers }] }).toString("utf8");
  expect(markerPackage).not.toMatch(/<a:(?:headEnd|tailEnd)\b|prst="(?:triangle|diamond)"/);
  expect((markerPackage.match(/prst="line"/g) || []).length)
    .toBe(markers.reduce((sum, marker) => sum + marker.points.length - 1, 0));
  // Check every native stroke's actual DrawingML origin, extent and direction.
  for (const marker of markers) {
    expect(marker.fill).toBeNull();
    expect(marker.dash).toBeUndefined();
    for (let i = 1; i < marker.points.length; i++) {
      const start = marker.points[i - 1];
      const end = marker.points[i];
      const flip = `${end.x < start.x ? ' flipH="1"' : ""}${end.y < start.y ? ' flipV="1"' : ""}`;
      const emu = (value) => Math.round(value * 9525);
      expect(markerPackage).toContain(`<a:xfrm${flip}><a:off x="${emu(Math.min(start.x, end.x))}" y="${emu(Math.min(start.y, end.y))}"/><a:ext cx="${emu(Math.abs(start.x - end.x))}" cy="${emu(Math.abs(start.y - end.y))}"/></a:xfrm>`);
      expect(markerPackage).toContain(`<a:ln w="${emu(marker.strokeWidth)}" cap="flat">`);
    }
  }
  return { xml, mapped };
}

for (const [name, count, shapes] of cases) {
  test(`pinned ${name} preserves editable hollow/cross strokes, ownership, order and PPTX geometry`, async ({ page }) => {
    const h = await startHarness({ slides: ["# Markers"] });
    try {
      await page.goto(h.url);
      const result = await load(page, name);
      validateScene(result.scene);
      const fallbackPaths = name === "flowchart-cross" ? ["root.unknown[0]", "root.unknown[1]"] : [];
      expect(result.diagnostics).toEqual(fallbackPaths.map((path) => ({ path, kind: "fallback", reason: "unsupported-mermaid-svg-element" })));
      expect(result.scene.nodes.filter((node) => node.kind === "fallback").map((node) => node.sourcePath)).toEqual(fallbackPaths);
      const markers = result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "marker");
      expect(markers).toHaveLength(count);
      for (const [shape, size] of Object.entries(shapes)) expect(markers.filter((node) => node.meta.mermaid.shape === shape)).toHaveLength(size);
      for (const marker of markers) {
        expect(marker).toMatchObject({ kind: "connector", arrowStart: "none", arrowEnd: "none", style: { fill: null, dash: "solid" } });
        const ownerPath = marker.sourcePath.split(".markers.")[0];
        const owner = result.scene.nodes.find((node) => node.sourcePath === ownerPath);
        const main = result.scene.nodes.find((node) => node.sourcePath === `${ownerPath}.line`);
        expect(main.kind).toBe("connector");
        expect(marker.z).toBeGreaterThan(main.z);
        const source = result.sources.find((source) => source.path === marker.sourcePath);
        expect(source.tag).toMatch(/path|line/);
        expect({ ...source, path: ownerPath }).toEqual(result.sources.find((source) => source.path === ownerPath));
        for (const point of marker.points) {
          expect(point.x).toBeGreaterThanOrEqual(owner.bounds.x - 0.1);
          expect(point.x).toBeLessThanOrEqual(owner.bounds.x + owner.bounds.width + 0.1);
          expect(point.y).toBeGreaterThanOrEqual(owner.bounds.y - 0.1);
          expect(point.y).toBeLessThanOrEqual(owner.bounds.y + owner.bounds.height + 0.1);
        }
      }
      expect(result.scene.nodes.some((node) => (node.text?.paragraphs || [])
        .some((paragraph) => paragraph.runs.some((run) => /[^\x00-\x7f]/.test(run.text))))).toBe(true);
      assertPackage(result.scene);
      const native = await page.evaluate(async () => {
        const { sceneToSvg, captureSvgTree } = await import("./renderer/scene-svg.mjs");
        const svg = sceneToSvg(window.markerResult.scene, { resolveFallback: (node) =>
          captureSvgTree(window.markerResult.sourceElements.get(node.sourcePath)) });
        return [...svg.querySelectorAll("[data-scene-source-path]")].filter((node) => node.getAttribute("data-scene-source-path").includes(".markers."))
          .map((node) => ({ fill: node.querySelector("path")?.getAttribute("fill") ?? node.getAttribute("fill"),
            cap: node.querySelector("path")?.getAttribute("stroke-linecap"), text: node.outerHTML }));
      });
      expect(native).toHaveLength(count);
      expect(native.every((node) => node.fill === "none" && node.cap === "butt" && !node.text.includes("marker-end="))).toBe(true);
    } finally { await h.close(); }
  });
}

test("all regular and margin markers honor endpoints, curve tangents, units, references and viewport scaling", async ({ page }) => {
  const h = await startHarness({ slides: ["# Placement"] });
  try {
    await page.goto(h.url);
    for (const name of ["class-hollow", "flowchart-cross", "sequence-cross"]) {
      await load(page, name);
      const ids = await page.evaluate(() => [...document.querySelectorAll("marker")].filter((marker) =>
        /(?:extension|aggregation|cross)(?:Start|End)(?:-margin)?$|-crosshead$/.test(marker.id)).map((marker) => marker.id));
      for (const [index, id] of ids.entries()) {
        for (const placement of ["start", "end"]) {
          await load(page, name);
          const expected = await page.evaluate(({ id, placement, index }) => {
            const deck = document.querySelector("#fixture-deck");
            deck.style.margin = "23px 0 0 31px";
            const svg = deck.querySelector("svg");
            svg.style.cssText = "width:900px;max-width:none;transform:translate(18px,12px) scale(1.25)";
            const source = svg.querySelector("path.relation, path.flowchart-link, [data-et=message]");
            source.setAttribute("transform", "translate(11,7) scale(1.2)");
            source.style.strokeWidth = "2px";
            source.style.markerStart = "none";
            source.style.markerEnd = "none";
            source.style.setProperty(`marker-${placement}`, `url("#${id}")`);
            if (source.localName === "path") source.setAttribute("d", "M100 100 C100 150 220 50 220 100");
            else for (const [key, value] of Object.entries({ x1: 220, y1: 100, x2: 100, y2: 100 })) source.setAttribute(key, value);
            const marker = document.getElementById(id);
            const shape = marker.firstElementChild;
            // Reference vertices are specified independently of the adapter.
            const start = /Start/.test(id);
            const margin = /-margin$/.test(id);
            const vertices = /aggregation/.test(id) ? [[[18,7],[9,13],[1,7],[9,1],[18,7]]]
              : /extension/.test(id) ? [margin ? start ? [[10,7],[18,13],[18,1],[10,7]] : [[10,1],[10,13],[18,7],[10,1]]
                : start ? [[1,7],[18,13],[18,1],[1,7]] : [[1,1],[1,13],[18,7],[1,1]]]
              : /crosshead/.test(id) ? [[[1,2],[6,7]],[[6,2],[1,7]]]
                : margin ? [[[1,1],[14,14]],[[1,14],[14,1]]] : [[[1,1],[10,10]],[[10,1],[1,10]]];
            const endpoint = source.localName === "path" ? placement === "start" ? [100,100] : [220,100]
              : placement === "start" ? [220,100] : [100,100];
            const angle = source.localName === "path" ? 90 : 180;
            const units = (marker.getAttribute("markerUnits") || "strokeWidth") === "strokeWidth" ? 2 : 1;
            const view = marker.viewBox.baseVal;
            const s = marker.hasAttribute("viewBox") ? Math.min(marker.markerWidth.baseVal.value / view.width, marker.markerHeight.baseVal.value / view.height) : 1;
            const refX = marker.refX.baseVal.value;
            const refY = marker.refY.baseVal.value;
            const transform = source.getScreenCTM().translate(...endpoint).rotate(angle).scale(units * s).translate(-refX, -refY);
            const rect = deck.getBoundingClientRect();
            const round = (value) => Math.round(value * 10) / 10;
            const expected = vertices.map((stroke) => stroke.map(([x,y]) => {
              const point = new DOMPoint(x,y).matrixTransform(transform);
              return { x: round(point.x - rect.left), y: round(point.y - rect.top) };
            }));
            const width = parseFloat(getComputedStyle(shape).strokeWidth) * source.getScreenCTM().a * units * s;
            source.setAttribute("data-marker-test", "selected");
            return { expected, width: round(width), id, placement, index };
          }, { id, placement, index });
          const result = await extract(page);
          const mainSource = result.sources.find((source) => source.path.endsWith(".line") &&
            (placement === "start" ? source.start : source.end).includes(`#${id}`));
          expect(mainSource, `${id} ${placement}`).toBeTruthy();
          const owner = mainSource.path.slice(0, -5);
          const markers = result.scene.nodes.filter((node) => node.sourcePath.startsWith(`${owner}.markers.${placement}`));
          expect(markers.map((node) => node.points)).toEqual(expected.expected);
          expect(markers.map((node) => node.style.strokeWidth)).toEqual(markers.map(() => expected.width));
          assertPackage(result.scene);
        }
      }
    }
  } finally { await h.close(); }
});

test("marker viewport alignment, orient and paint are independent from the main dashed line", async ({ page }) => {
  const h = await startHarness({ slides: ["# Marker viewport"] });
  try {
    await page.goto(h.url);
    for (const orient of ["auto", "auto-start-reverse", "90", "0.25turn"]) {
      for (const aspect of ["xMinYMin meet", "xMaxYMax meet", "xMidYMid slice", "none"]) {
        await load(page, "flowchart-cross");
        await page.evaluate(({ orient, aspect }) => {
          const edge = document.querySelector("path.flowchart-link");
          edge.setAttribute("d", "M100 100 L200 100");
          edge.style.stroke = "rgb(12, 34, 56)";
          edge.style.strokeDasharray = "5 5";
          edge.style.strokeWidth = "3px";
          const marker = document.querySelector('[id$="-crossStart"]');
          marker.setAttribute("orient", orient);
          marker.setAttribute("markerUnits", "strokeWidth");
          marker.setAttribute("markerWidth", "44");
          marker.setAttribute("markerHeight", "44");
          marker.setAttribute("viewBox", "-5 -5 22 22");
          marker.setAttribute("preserveAspectRatio", aspect);
          marker.setAttribute("refX", "2");
          marker.setAttribute("refY", "3");
          marker.firstElementChild.style.stroke = "rgb(90, 80, 70)";
          edge.style.markerStart = `url(#${marker.id})`;
          edge.style.markerEnd = "none";
        }, { orient, aspect });
        const result = await extract(page);
        const main = result.scene.nodes.find((node) => node.sourcePath === "edges[0].line");
        expect(main).toMatchObject({ style: { dash: "dash", stroke: "rgb(12, 34, 56)", strokeWidth: 3 } });
        const markers = result.scene.nodes.filter((node) => node.sourcePath.startsWith("edges[0].markers"));
        expect(markers).toHaveLength(2);
        expect(markers[0].style).toMatchObject({ stroke: "rgb(90, 80, 70)", strokeWidth: 12, dash: "solid", fill: null });
        const expected = orient === "auto" ? [[94,88],[148,142]] : orient === "auto-start-reverse" ? [[106,112],[52,58]]
          : [[112,94],[58,148]];
        expect(markers[0].points).toEqual(expected.map(([x,y]) => ({x,y})));
        const { xml } = assertPackage(result.scene);
        expect(xml).toContain('val="0C2238"');
        expect(xml).toContain('val="5A5046"');
        expect(xml).toContain('<a:prstDash val="dash"/>');
      }
    }
  } finally { await h.close(); }
});

test("unsupported hollow marker variants keep just their source connector and its markers as local fallback", async ({ page }) => {
  const h = await startHarness({ slides: ["# Marker boundaries"] });
  try {
    await page.goto(h.url);
    const mutations = [
      (marker) => { marker.firstElementChild.style.fill = "white"; },
      (marker) => { marker.firstElementChild.style.fill = "red"; },
      (marker) => { marker.firstElementChild.style.strokeWidth = ".001"; },
      (marker) => { marker.firstElementChild.style.strokeDasharray = "3 2"; },
      (marker) => { marker.firstElementChild.style.strokeDashoffset = "2"; },
      (marker) => { marker.firstElementChild.style.strokeLinecap = "round"; },
      (marker) => { marker.firstElementChild.style.strokeLinejoin = "bevel"; },
      (marker) => { marker.firstElementChild.style.transform = "rotate(10deg)"; },
      (marker) => { marker.firstElementChild.setAttribute("d", "M0 0L5 5L0 10Z"); },
      (marker) => { marker.firstElementChild.style.d = 'path("M0 0L5 5L0 10Z")'; },
      (marker) => { marker.style.filter = "blur(1px)"; },
      (marker) => { marker.style.mixBlendMode = "multiply"; },
      (marker) => { marker.style.transform = "translate(1px,2px)"; },
      (marker) => { marker.setAttribute("markerWidth", "2"); },
      (marker) => { marker.setAttribute("markerHeight", "0"); },
      (marker) => { marker.setAttribute("markerUnits", "unknown"); },
      (marker) => { marker.setAttribute("refX", "left"); },
      (marker) => { marker.setAttribute("viewBox", "0 0 5 5"); },
      (marker) => { marker.setAttribute("viewBox", "0 0 20 14"); marker.setAttribute("preserveAspectRatio", "none"); },
      (marker) => { marker.setAttribute("preserveAspectRatio", "invalid"); marker.setAttribute("viewBox", "0 0 20 14"); },
      (marker) => { marker.insertAdjacentHTML("beforeend", "<circle r='3'/>"); },
      (marker) => { marker.remove(); },
    ];
    for (const mutate of mutations) {
      await load(page, "class-hollow");
      await page.evaluate((mutation) => {
        const edge = document.querySelector("path.relation");
        const original = document.querySelector('[id$="-extensionStart"]');
        const marker = original.cloneNode(true);
        marker.id = "mutated-extensionStart";
        original.parentElement.append(marker);
        edge.setAttribute("marker-start", `url(#${marker.id})`);
        // The mutation functions are authored in this test, not untrusted content.
        (0, eval)(`(${mutation})`)(marker);
      }, mutate.toString());
      const result = await extract(page);
      expect(result.scene.nodes.filter((node) => node.kind === "fallback"), mutate.toString())
        .toMatchObject([{ sourcePath: "edges[0]", reason: "unsupported-mermaid-edge-style" }]);
      expect(result.diagnostics).toEqual([{ path: "edges[0]", kind: "fallback", reason: "unsupported-mermaid-edge-style" }]);
      expect(result.scene.nodes.some((node) => node.sourcePath === "edges[0].line")).toBe(false);
      expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "marker")).toHaveLength(9);
      expect(result.sources.find((source) => source.path === "edges[0]").tag).toBe("path");
      expect(sceneToPptxElements(result.scene).fallbacks.map((fallback) => fallback.sourcePath)).toEqual(["edges[0]"]);
    }
  } finally { await h.close(); }
});

test("hollow marker alpha stays editable while translucent cross overlap remains local fallback", async ({ page }) => {
  const h = await startHarness({ slides: ["# Marker alpha"] });
  try {
    await page.goto(h.url);
    await load(page, "class-hollow");
    await page.evaluate(() => {
      const edge = document.querySelector("path.relation");
      const original = document.querySelector('[id$="-extensionStart"]');
      const marker = original.cloneNode(true);
      marker.id = "alpha-extensionStart";
      marker.style.opacity = "0.5";
      marker.firstElementChild.style.stroke = "rgba(90, 80, 70, 0.5)";
      marker.firstElementChild.style.strokeOpacity = "0.4";
      original.parentElement.append(marker);
      edge.setAttribute("marker-start", `url(#${marker.id})`);
    });
    const hollow = await extract(page);
    expect(hollow.diagnostics).toEqual([]);
    const alphaMarkers = hollow.scene.nodes.filter((node) =>
      node.meta?.mermaid?.kind === "marker" && node.style.stroke === "rgba(90, 80, 70, 0.5)");
    expect(alphaMarkers).toHaveLength(1);
    expect(alphaMarkers[0].style).toMatchObject({
      fill: null,
      opacity: 0.5,
      strokeOpacity: 0.4,
      lineCap: "butt",
    });
    const { xml } = assertPackage(hollow.scene);
    expect(xml).toContain('<a:srgbClr val="5A5046"><a:alpha val="10000"/></a:srgbClr>');
    const rendered = await page.evaluate(async () => {
      const { sceneToSvg } = await import("./renderer/scene-svg.mjs");
      const svg = sceneToSvg(window.markerResult.scene);
      const marker = [...svg.querySelectorAll("[data-scene-source-path]")]
        .find((node) => node.getAttribute("data-scene-source-path")?.includes(".markers.start"));
      const path = marker?.querySelector("path");
      return {
        opacity: path?.getAttribute("opacity"),
        strokeOpacity: path?.getAttribute("stroke-opacity"),
        stroke: path?.getAttribute("stroke"),
      };
    });
    expect(rendered).toEqual({
      opacity: "0.5",
      strokeOpacity: "0.4",
      stroke: "rgba(90, 80, 70, 0.5)",
    });

    await load(page, "sequence-cross");
    await page.evaluate(() => {
      const edge = document.querySelector("[data-et=message]");
      const original = document.querySelector('[id$="-crosshead"]');
      const marker = original.cloneNode(true);
      marker.id = "alpha-crosshead";
      marker.firstElementChild.style.strokeOpacity = "0.5";
      original.parentElement.append(marker);
      edge.setAttribute("marker-end", `url(#${marker.id})`);
    });
    const cross = await extract(page);
    expect(cross.scene.nodes.filter((node) => node.kind === "fallback")).toMatchObject([
      { reason: "unsupported-mermaid-sequence-element" },
    ]);
    expect(cross.scene.nodes.filter((node) => node.meta?.mermaid?.shape === "cross")).toHaveLength(6);
  } finally { await h.close(); }
});

test("cross fallback keeps unsupported source transforms, paint and viewport cases local without losing terminals", async ({ page }) => {
  const h = await startHarness({ slides: ["# Cross boundaries"] });
  try {
    await page.goto(h.url);
    for (const mode of ["nonuniform", "zero-stroke", "transparent-stroke", "opacity", "mid", "css-subpaths", "css-closed", "unknown", "clipped"]) {
      await load(page, "sequence-cross");
      await page.evaluate((mode) => {
        const edge = document.querySelector("[data-et=message]");
        if (mode === "nonuniform") edge.setAttribute("transform", "translate(20,10) scale(2,1)");
        if (mode === "zero-stroke") edge.style.strokeWidth = "0";
        if (mode === "transparent-stroke") edge.style.stroke = "none";
        if (mode === "opacity") edge.style.opacity = ".5";
        if (mode === "mid") edge.style.markerMid = edge.getAttribute("marker-end");
        if (mode === "unknown") edge.setAttribute("marker-end", "url(#unknown-crosshead)");
        if (mode.startsWith("css-")) {
          const path = document.querySelector("path.messageLine0");
          path.style.d = mode === "css-subpaths" ? 'path("M100 100L150 100M150 150L100 150")' : 'path("M100 100L150 100L100 150Z")';
        }
        if (mode === "clipped") {
          const original = document.querySelector('[id$="-crosshead"]');
          const marker = original.cloneNode(true);
          marker.id = "clipped-crosshead";
          marker.setAttribute("markerWidth", "3");
          original.parentElement.append(marker);
          edge.setAttribute("marker-end", `url(#${marker.id})`);
        }
      }, mode);
      const result = await extract(page);
      const fallbacks = result.scene.nodes.filter((node) => node.kind === "fallback");
      expect(fallbacks, mode).toHaveLength(1);
      expect(fallbacks[0].sourcePath).toMatch(/^sequence\[\d+\]$/);
      expect(result.diagnostics).toEqual([{ path: fallbacks[0].sourcePath, kind: "fallback", reason: fallbacks[0].reason }]);
      expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "marker")).toHaveLength(6);
      expect(result.scene.nodes.filter((node) => node.kind === "text")).toHaveLength(9);
      expect(result.scene.nodes.some((node) => node.sourcePath.startsWith(`${fallbacks[0].sourcePath}.`))).toBe(false);
    }
    await load(page, "sequence-cross");
    const bounds = await page.evaluate(() => {
      const source = document.querySelector("[data-et=message]");
      source.style.strokeWidth = "4";
      source.style.opacity = ".5";
      const original = document.querySelector('[id$="-crosshead"]');
      const marker = original.cloneNode(true);
      marker.id = "offset-crosshead";
      marker.setAttribute("refX", "100");
      original.parentElement.append(marker);
      source.setAttribute("marker-end", `url(#${marker.id})`);
      const rect = source.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    const result = await extract(page);
    const fallback = result.scene.nodes.find((node) => node.kind === "fallback");
    // A 100-unit reference with strokeWidth units needs much more than the old 20px padding.
    expect(fallback.bounds.x).toBeLessThanOrEqual(Math.max(0, bounds.x - 350));
    expect(fallback.bounds.width).toBeGreaterThan(bounds.width + 700);

    await load(page, "class-hollow");
    await page.evaluate(() => {
      const edge = document.querySelector("path.relation");
      edge.setAttribute("marker-end", `url(#${document.querySelector('[id$="-compositionEnd"]').id})`);
    });
    const mixed = await extract(page);
    expect(mixed.scene.nodes.filter((node) => node.kind === "fallback")).toMatchObject([
      { sourcePath: "edges[0]", reason: "unsupported-mermaid-edge-style" },
    ]);
    expect(mixed.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "marker")).toHaveLength(9);
  } finally { await h.close(); }
});

test("actual mixed export captures only an unsupported marked connector and leaves native markers and labels masked", async ({ page }) => {
  const h = await startHarness({ slides: [`# Mixed markers\n\n\`\`\`mermaid\n${await fixture("class-hollow", "mmd")}\n\`\`\``] });
  await page.addInitScript(() => {
    const replace = Element.prototype.replaceWith;
    Element.prototype.replaceWith = function (...nodes) {
      const svg = nodes[0];
      if (this.localName === "svg" && svg?.getAttribute?.("data-scene-source") === "mermaid") {
        const source = svg.querySelector("path.relation");
        const original = svg.querySelector('[id$="-extensionStart"]');
        const marker = original.cloneNode(true);
        marker.id = "white-extensionStart";
        marker.firstElementChild.style.setProperty("fill", "white", "important");
        original.parentElement.append(marker);
        source.style.setProperty("marker-start", `url(#${marker.id})`);
      }
      return replace.apply(this, nodes);
    };
  });
  try {
    await page.goto(`${h.url}/?pptx=1&token=${h.printToken}`);
    await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready") || document.documentElement.hasAttribute("data-pptx-error"));
    await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
    const result = await page.evaluate(() => ({
      slide: window.__presentationPptxModel.slides[0],
      edges: [...document.querySelectorAll("path.relation")].map((edge) => ({
        native: edge.getAttribute("data-pptx-native"), fallback: edge.getAttribute("data-pptx-fallback-ids"),
        stroke: getComputedStyle(edge).stroke, marker: getComputedStyle(edge).markerStart,
      })),
    }));
    expect(result.slide.fallbacks.filter((fallback) => fallback.type === "mermaid")).toMatchObject([
      { path: "mermaid[0].edges[0]", sourcePath: "edges[0]", reason: "unsupported-mermaid-edge-style", captureId: expect.any(String) },
    ]);
    expect(result.slide.elements.filter((element) => element.mermaid?.kind === "marker")).toHaveLength(9);
    expect(result.edges[0].native).toBeNull();
    expect(result.edges[0].fallback).toBeTruthy();
    expect(result.edges[0].stroke).not.toBe("rgba(0, 0, 0, 0)");
    expect(result.edges[0].marker).toContain("white-extensionStart");
    expect(result.edges.slice(1).every((edge) => edge.native === "connector" && edge.fallback === null &&
      edge.stroke === "rgba(0, 0, 0, 0)" && edge.marker === "none")).toBe(true);
    await expect(page.locator("g.edgeLabel[data-pptx-native=shape]")).toHaveCount(8);
  } finally { await h.close(); }
});

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  test(`actual renderer masks complete hollow/cross composites and preserves labels (${theme})`, async ({ page }) => {
    const diagrams = await Promise.all(cases.map(([name]) => fixture(name, "mmd")));
    const h = await startHarness({ slides: diagrams.map((source) => `# Markers\n\n\`\`\`mermaid\n${source}\n\`\`\``), theme,
      customThemeCss: theme === "custom" ? "--bg:#102030;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;" : "" });
    try {
      await page.goto(`${h.url}/?pptx=1&token=${h.printToken}`);
      await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready") || document.documentElement.hasAttribute("data-pptx-error"));
      await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
      const result = await page.evaluate(() => ({
        slides: window.__presentationPptxModel.slides,
        diagrams: [...document.querySelectorAll("pre.mermaid > svg")].map((svg) => ({
          sources: [...svg.querySelectorAll("path.relation, path.flowchart-link, [data-et=message]")].map((source) => ({
            path: source.getAttribute("data-scene-source-path"), native: source.getAttribute("data-pptx-native"),
            stroke: getComputedStyle(source).stroke, start: getComputedStyle(source).markerStart, end: getComputedStyle(source).markerEnd,
          })),
          fallback: svg.querySelectorAll("[data-pptx-fallback-ids]").length,
          nodes: svg.__presentationScene.nodes.map((node) => ({ path: node.sourcePath, owner: node.meta?.svgOwner, captured: Boolean(node.meta?.svg) })),
        })),
      }));
      for (const [index, slide] of result.slides.entries()) {
        const fallbacks = slide.fallbacks.filter((fallback) => fallback.type === "mermaid");
        expect(fallbacks.map((fallback) => [fallback.path, fallback.reason])).toEqual(index === 1
          ? ["mermaid[0].root.unknown[0]", "mermaid[0].root.unknown[1]"].map((path) => [path, "unsupported-mermaid-svg-element"]) : []);
        const markers = slide.elements.filter((element) => element.mermaid?.kind === "marker");
        expect(markers).toHaveLength(cases[index][1]);
        expect(result.diagrams[index].fallback).toBe(index === 1 ? 2 : 0);
        for (const source of result.diagrams[index].sources) {
          expect(source).toMatchObject({ native: "connector", stroke: "rgba(0, 0, 0, 0)", start: "none", end: "none" });
          expect(slide.elements.some((element) => element.path === `mermaid[0].${source.path}.line` || element.path === `mermaid[0].${source.path}`)).toBe(true);
          const nodes = result.diagrams[index].nodes.filter((node) => node.path === source.path || node.path.startsWith(`${source.path}.`));
          expect(nodes.filter((node) => node.captured)).toHaveLength(1);
          expect(nodes.filter((node) => node.owner).every((node) => node.owner === source.path)).toBe(true);
        }
        expect(markers.every((marker) => marker.fill === null && !marker.dash && marker.arrowStart === "none" && marker.arrowEnd === "none")).toBe(true);
        expect(inspectPptxPackage(buildPptxPackage({ slides: [{ elements: slide.elements }] })).valid).toBe(true);
      }
    } finally { await h.close(); }
  });
}
