import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, chromium } from "@playwright/test";
import { startHarness } from "../harness/server.mjs";
import { MAX_CONNECTOR_POINTS, validateScene } from "../../.github/extensions/markdstage/renderer/scene-graph.mjs";
import { sceneToPptxElements } from "../../.github/extensions/markdstage/renderer/scene-pptx.mjs";
import { buildPptxPackage as buildPptxBytes, inspectPptxPackage } from "../../.github/extensions/markdstage/runtime/pptx-package.mjs";
import { withDeckServer } from "../../packages/markdstage-cli/src/deck.mjs";
import { exportPptx } from "../../.github/extensions/markdstage/runtime/output.mjs";
import { runPptxOutputBrowser } from "../../.github/extensions/markdstage/hosts/node/browser.mjs";

const buildPptxPackage = (model) => Buffer.from(buildPptxBytes(model));

// Fixed SVGs: bundled Mermaid 11.15.0, default theme, Arial.
const fixtures = join(process.cwd(), "test", "fixtures", "mermaid");
const fixture = (name, extension = "svg") => readFile(join(fixtures, `${name}.${extension}`), "utf8");
const textOf = (node) => (node.text?.paragraphs || node.paragraphs || [])
  .map((paragraph) => paragraph.runs.map((run) => run.text).join("")).join("\n");

async function extract(page, name, mutate, arg) {
  await page.evaluate((svg) => {
    document.body.innerHTML = `<div id="fixture-deck" style="position:relative;width:1000px;height:700px">${svg}</div>`;
  }, await fixture(name));
  if (mutate) await page.evaluate(mutate, arg);
  return page.evaluate(async () => {
    const { mermaidSvgToScene, chartPathPoints } = await import("./renderer/mermaid-scene.mjs");
    const { sceneToSvg } = await import("./renderer/scene-svg.mjs");
    const deck = document.querySelector("#fixture-deck");
    const root = deck.querySelector("svg");
    const result = mermaidSvgToScene(root, { deck, includeSourceElements: true });
    const origin = deck.getBoundingClientRect();
    const sourceBounds = (element) => {
      const b = element.getBoundingClientRect();
      return { x: b.x - origin.x, y: b.y - origin.y, width: b.width, height: b.height };
    };
    const sources = result.scene.nodes.map((node) => {
      const element = result.sourceElements.get(node.sourcePath);
      const points = element.localName === "path" && chartPathPoints(element.getAttribute("d"));
      const matrix = element.getScreenCTM();
      return {
        path: node.sourcePath, bounds: sourceBounds(element), text: element.textContent,
        vertices: points && points.map((point) => {
          const p = new DOMPoint(point.x, point.y).matrixTransform(matrix);
          return { x: p.x - origin.x, y: p.y - origin.y };
        }),
      };
    });
    const ownershipConflicts = result.scene.nodes.filter((node) => node.kind === "fallback")
      .flatMap((fallback) => result.scene.nodes.filter((node) => node.kind !== "fallback" &&
        result.sourceElements.get(node.sourcePath).contains(result.sourceElements.get(fallback.sourcePath))));
    const rendered = result.diagnostics.length ? null : sceneToSvg(result.scene);
    return { scene: result.scene, diagnostics: result.diagnostics, sources,
      ownershipConflicts, svg: rendered?.outerHTML };
  });
}

for (const name of ["quadrant-basic", "xychart-basic", "xychart-horizontal"]) {
  test(`pinned ${name} exports native geometry, exact vertices, rotated text and DrawingML`, async ({ page }) => {
    const harness = await startHarness({ slides: ["# Charts"] });
    try {
      await page.goto(harness.url);
      const result = await extract(page, name);
      validateScene(result.scene);
      expect(result.diagnostics).toEqual([]);
      const nodes = result.scene.nodes;
      const quadrant = name.startsWith("quadrant");
      expect(nodes.filter((node) => node.kind === "shape")).toHaveLength(quadrant ? 8 : 5);
      expect(nodes.filter((node) => node.rotation === -90)).toHaveLength(quadrant ? 2 : 1);
      expect(nodes.map(textOf)).toContain(quadrant ? "Invest / 投資"
        : name === "xychart-basic" ? "Revenue / 収益" : "Period / 期間");
      const line = nodes.find((node) => node.meta?.mermaid?.kind === "xychart-line-plot");
      if (line) expect(line.points).toHaveLength(4);
      for (const node of nodes) {
        const source = result.sources.find((entry) => entry.path === node.sourcePath);
        expect(source, node.sourcePath).toBeTruthy();
        if (source.vertices) {
          expect(node.points).toHaveLength(source.vertices.length);
          node.points.forEach((point, i) => {
            expect(Math.abs(point.x - source.vertices[i].x)).toBeLessThanOrEqual(0.051);
            expect(Math.abs(point.y - source.vertices[i].y)).toBeLessThanOrEqual(0.051);
          });
        }
        if (node.bounds && !node.rotation) {
          for (const key of ["x", "y", "width", "height"]) {
            expect(Math.abs(node.bounds[key] - source.bounds[key]), `${node.sourcePath}.${key}`).toBeLessThanOrEqual(0.1);
          }
        }
        if (node.rotation) expect(result.svg).toContain(`rotate(-90 ${node.bounds.x + node.bounds.width / 2} ${node.bounds.y + node.bounds.height / 2})`);
      }
      const mapped = sceneToPptxElements(result.scene);
      expect(mapped.fallbacks).toEqual([]);
      const bytes = buildPptxPackage({ slides: [{ elements: mapped.elements }] });
      expect(inspectPptxPackage(bytes).valid).toBe(true);
      const xml = bytes.toString("utf8");
      expect(xml).toContain('rot="-5400000"');
      expect(xml).not.toContain("<c:chart");
      expect(xml).not.toContain("ppt/charts/");
      expect(xml).not.toContain("<a:blip");
      for (const label of quadrant ? ["Alpha", "Invest / 投資"] : ["Revenue / 収益", "Period / 期間"].filter((text) => nodes.map(textOf).includes(text))) {
        expect(xml.split(`<a:t>${label}</a:t>`)).toHaveLength(2);
      }
      if (quadrant) expect(xml.match(/<a:prstGeom prst="ellipse"/g)).toHaveLength(4);
    } finally {
      await harness.close();
    }
  });
}

test("chart transforms, paint and multiline SVG labels retain their measured geometry", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Measured charts"] });
  try {
    await page.goto(harness.url);
    const result = await extract(page, "quadrant-basic", () => {
      const svg = document.querySelector("#fixture-deck > svg");
      svg.style.cssText = "width:350px;margin-left:63px;margin-top:27px";
      const circle = svg.querySelector("circle");
      circle.style.cssText = "fill:rgba(10,20,30,.8);stroke:rgba(40,50,60,.6);stroke-width:3px;fill-opacity:.5;stroke-opacity:.25;opacity:.8";
      const text = svg.querySelector(".quadrant text");
      text.innerHTML = '<tspan x="0" dy="0">投資</tspan><tspan x="0" dy="18">Invest</tspan>';
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.scene.nodes.map(textOf)).toContain("投資\nInvest");
    const point = result.scene.nodes.find((node) => node.meta?.mermaid?.kind === "quadrantChart-point");
    expect(point.style).toMatchObject({
      fill: "rgba(10, 20, 30, 0.8)", stroke: "rgba(40, 50, 60, 0.6)",
      fillOpacity: 0.5, strokeOpacity: 0.25, opacity: 0.8,
    });
    const source = result.sources.find((entry) => entry.path === point.sourcePath);
    for (const key of ["x", "y", "width", "height"]) expect(Math.abs(point.bounds[key] - source.bounds[key])).toBeLessThanOrEqual(0.1);
    const mapped = sceneToPptxElements(result.scene);
    const bytes = buildPptxPackage({ slides: [{ elements: mapped.elements }] });
    expect(inspectPptxPackage(bytes).valid).toBe(true);
    expect(bytes.toString("utf8")).toContain('<a:alpha val="32000"/>');
    expect(bytes.toString("utf8")).toContain('<a:alpha val="12000"/>');
  } finally {
    await harness.close();
  }
});

test("unsupported chart effects and geometry preserve only the owning source subtree", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Hybrid charts"] });
  try {
    await page.goto(harness.url);
    for (const entry of [
      { name: "quadrant-basic", selector: ".data-point circle", style: "filter:blur(2px)", reason: "style", keep: "Alpha" },
      { name: "quadrant-basic", selector: ".data-point", style: "opacity:.5", reason: "style", keep: "Alpha" },
      { name: "quadrant-basic", selector: ".quadrant rect", style: "transform:rotate(12deg)", reason: "transform", keep: "Alpha" },
      { name: "quadrant-basic", selector: ".data-point text", style: "text-shadow:2px 2px red", reason: "label", keep: "Alpha" },
      { name: "quadrant-basic", selector: ".data-point text", style: "letter-spacing:3px", reason: "label", keep: "Alpha" },
      { name: "xychart-basic", selector: ".bar-plot-0", style: "opacity:.5", reason: "style", keep: "Revenue / 収益" },
      { name: "xychart-basic", selector: ".bar-plot-0 rect", style: "clip-path:inset(2px)", reason: "style", keep: "Revenue / 収益" },
      { name: "xychart-basic", selector: ".line-plot-1 path", d: "M0,0L20,20M40,40L60,60", reason: "geometry", keep: "Revenue / 収益" },
      { name: "xychart-basic", selector: ".line-plot-1 path", d: "M0,0L20,20L30,0Z", reason: "geometry", keep: "Revenue / 収益" },
      { name: "xychart-basic", selector: ".line-plot-1 path", style: "fill:red", reason: "geometry", keep: "Revenue / 収益" },
      { name: "xychart-basic", selector: ".left-axis .title text", style: "transform:skewX(20deg)", reason: "text-transform", keep: "Month / 月" },
      { name: "xychart-basic", selector: ".left-axis .title text", style: "stroke:red;stroke-width:1px", reason: "label", keep: "Month / 月" },
      { name: "xychart-basic", selector: ".left-axis .title text", style: "text-decoration:underline", reason: "label", keep: "Month / 月" },
    ]) {
      const result = await extract(page, entry.name, ({ selector, style, d }) => {
        const element = document.querySelector(selector);
        if (style) element.setAttribute("style", style);
        if (d) element.setAttribute("d", d);
      }, entry);
      const fallbacks = result.scene.nodes.filter((node) => node.kind === "fallback");
      expect(fallbacks, JSON.stringify(entry)).toHaveLength(1);
      const reason = entry.reason === "text-transform" ? "unsupported-mermaid-text-transform"
        : `unsupported-mermaid-${entry.name.startsWith("quadrant") ? "quadrantChart" : "xychart"}-${entry.reason}`;
      expect(fallbacks[0].reason).toBe(reason);
      expect(fallbacks[0].sourcePath).not.toBe("svg");
      expect(result.scene.nodes.map(textOf)).toContain(entry.keep);
      expect(result.ownershipConflicts).toEqual([]);
      expect(result.diagnostics).toContainEqual({ kind: "fallback", reason, path: fallbacks[0].sourcePath });
      expect(sceneToPptxElements(result.scene).fallbacks).toHaveLength(1);
    }
    const hidden = await extract(page, "xychart-basic", () => {
      document.querySelector(".plot").style.display = "none";
    });
    expect(hidden.diagnostics).toEqual([]);
    expect(hidden.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "xychart-bar")).toEqual([]);
    expect(hidden.scene.nodes.map(textOf)).toContain("Revenue / 収益");
    const oversized = await extract(page, "xychart-basic", (limit) => {
      document.querySelector(".line-plot-1 path").setAttribute("d",
        Array.from({ length: limit + 1 }, (_, i) => `${i ? "L" : "M"}${i},${i % 2}`).join(""));
    }, MAX_CONNECTOR_POINTS);
    expect(oversized.diagnostics).toHaveLength(1);
    expect(oversized.diagnostics[0].reason).toBe("unsupported-mermaid-xychart-geometry");
    const unknown = await extract(page, "quadrant-basic", () => {
      const group = document.querySelector(".data-points");
      const svg = group.ownerSVGElement;
      const image = document.createElementNS(svg.namespaceURI, "path");
      image.setAttribute("d", "M40,50L70,20L80,70Z");
      group.append(image);
    });
    expect(unknown.diagnostics).toHaveLength(1);
    expect(unknown.scene.nodes.map(textOf)).toContain("Alpha");
  } finally {
    await harness.close();
  }
});

test("chart structure, SVG element, scene node and subtree depth guards remain bounded", async ({ page }) => {
  test.setTimeout(120_000);
  const harness = await startHarness({ slides: ["# Chart limits"] });
  try {
    await page.goto(harness.url);
    const malformed = await extract(page, "xychart-basic", () => {
      document.querySelector("g.main").classList.remove("main");
    });
    expect(malformed.diagnostics[0].reason).toBe("unsupported-mermaid-xychart-structure");
    const transform = await extract(page, "xychart-basic", () => {
      document.querySelector("g.main").setAttribute("transform", "skewX(10)");
    });
    expect(transform.diagnostics).toEqual([{
      kind: "fallback", path: "xychart.main", reason: "unsupported-mermaid-xychart-transform",
    }]);
    const deep = await extract(page, "xychart-basic", async () => {
      const { MAX_GROUP_DEPTH } = await import("./renderer/scene-graph.mjs");
      const root = document.querySelector("svg");
      let parent = root;
      for (let index = 0; index < MAX_GROUP_DEPTH + 2; index++) {
        const group = document.createElementNS(root.namespaceURI, "g");
        group.classList.add("root");
        parent.append(group);
        parent = group;
      }
      const rect = document.createElementNS(root.namespaceURI, "rect");
      rect.setAttribute("width", "20");
      rect.setAttribute("height", "20");
      parent.append(rect);
    });
    expect(deep.diagnostics).toHaveLength(1);
    expect(deep.diagnostics[0].reason).toBe("unsupported-mermaid-svg-depth");
    expect(deep.scene.nodes.map(textOf)).toContain("Revenue / 収益");
    for (const type of ["elements", "nodes"]) {
      const result = await extract(page, "xychart-basic", async (type) => {
        const { MAX_SCENE_NODES } = await import("./renderer/scene-graph.mjs");
        const parent = document.querySelector(".bar-plot-0");
        const template = parent.firstElementChild;
        const fragment = document.createDocumentFragment();
        const count = type === "elements" ? MAX_SCENE_NODES * 10 : MAX_SCENE_NODES;
        for (let index = 0; index < count; index++) {
          fragment.append(type === "elements"
            ? document.createElementNS(parent.namespaceURI, "g") : template.cloneNode());
        }
        parent.append(fragment);
      }, type);
      expect(result.scene.nodes).toHaveLength(1);
      expect(result.scene.nodes[0].kind).toBe("fallback");
      expect(result.diagnostics.some((item) => item.reason.startsWith("mermaid-scene-limit-exceeded"))).toBe(true);
    }
  } finally {
    await harness.close();
  }
});

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  test(`real renderer supports chart aliases and masks only native artwork (${theme})`, async ({ page }) => {
    const names = ["quadrant-basic", "xychart-basic", "xychart-horizontal", "quadrant-hybrid", "xychart-hybrid"];
    const sources = await Promise.all(names.map((name) => fixture(name, "mmd")));
    sources.push(sources[1].replace("xychart-beta", "xychart"));
    sources.push("quadrantChart\n A: [0.3, 0.7]", "xychart\n bar [1, 2, 3]",
      "xychart\n x-axis [a, b, c]\n line [1, 2, 3]");
    const harness = await startHarness({
      slides: sources.map((source) => `## Charts\n\n\`\`\`mermaid\n${source}\n\`\`\``), theme,
      customThemeCss: theme === "custom" ? "--bg:#102030;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;" : "",
    });
    try {
      await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`);
      await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready") ||
        document.documentElement.hasAttribute("data-pptx-error"), undefined, { timeout: 120_000 });
      await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
      const model = await page.evaluate(() => window.__presentationPptxModel);
      const native = model.slides.map((slide) => slide.elements.filter((element) => element.path?.startsWith("mermaid[0].")));
      expect(model.slides.map((slide) => slide.fallbacks.filter((item) => item.type === "mermaid").length)).toEqual([0, 0, 0, 1, 2, 0, 0, 0, 0]);
      expect(native[0].map(textOf)).toContain("Invest / 投資");
      expect(native[1].map(textOf)).toContain("Revenue / 収益");
      expect(native[1]).toEqual(native[5]);
      expect(native[6].map(textOf)).toContain("A");
      const svgs = page.locator("pre.mermaid > svg");
      await expect(svgs.nth(0).locator("circle[data-pptx-native=shape]")).toHaveCount(4);
      await expect(svgs.nth(1).locator(".bar-plot-0 rect[data-pptx-native=shape]")).toHaveCount(4);
      await expect(svgs.nth(1).locator(".line-plot-1 path[data-pptx-native=connector]")).toHaveCount(1);
      await expect(svgs.nth(3).locator("circle[data-pptx-fallback-ids]")).toHaveCount(1);
      await expect(svgs.nth(3).locator(".data-point text[data-pptx-native=text]")).toHaveCount(2);
      await expect(svgs.nth(4).locator("rect[data-pptx-fallback-ids]")).toHaveCount(1);
      await expect(svgs.nth(4).locator("text[data-pptx-fallback-ids]")).toHaveCount(1);
      expect(await svgs.nth(4).getAttribute("data-pptx-fallback-ids")).toBeNull();
      expect(await svgs.nth(4).locator(".plot").getAttribute("data-pptx-native")).toBeNull();
      const bytes = buildPptxPackage({ slides: native.slice(0, 3).map((elements) => ({ elements })) });
      expect(inspectPptxPackage(bytes).valid).toBe(true);
      await writeFile(test.info().outputPath(`${theme}-model.json`), JSON.stringify(model, null, 2));
    } finally {
      await harness.close();
    }
  });
}

test("actual chart PPTX embeds each local fallback once in native paint order without chart data parts", async () => {
  test.setTimeout(120_000);
  const directory = test.info().outputPath();
  const sources = await Promise.all(["quadrant-hybrid", "xychart-hybrid"].map((name) => fixture(name, "mmd")));
  const file = join(directory, "slides.md");
  await writeFile(file, ["# Chart hybrid", ...sources.map((source) => `## Charts\n\n\`\`\`mermaid\n${source}\n\`\`\``)].join("\n\n---\n\n"));
  await withDeckServer({ file, workspace: directory, theme: "dark" }, async (session) => {
    let rendered;
    const output = join(directory, "editable-hybrid.pptx");
    await exportPptx(session, output, "dark", {
      findChromiumBrowser: () => chromium.executablePath(),
      runPptxOutputBrowser: async (...args) => {
        rendered = await runPptxOutputBrowser(...args);
        return rendered;
      },
    });
    const bytes = await readFile(output);
    expect(inspectPptxPackage(bytes).valid).toBe(true);
    const xml = bytes.toString("utf8");
    expect(xml).not.toContain("ppt/charts/");
    const chartXml = [...xml.matchAll(/<p:sld\b[\s\S]*?<\/p:sld>/g)][2]?.[0];
    expect(chartXml).toBeTruthy();
    const objects = [...chartXml.matchAll(/<p:(sp|pic|cxnSp)>[\s\S]*?<\/p:\1>/g)];
    const objectKinds = objects.map((match) => match[1]);
    // Heading, background, chart title, bar 1, local bar 2, bars 3/4, then the line plot.
    expect(objectKinds.slice(0, 8)).toEqual(["sp", "sp", "sp", "sp", "pic", "sp", "sp", "sp"]);
    expect(objects[7][0]).toContain('name="Connector ');
    expect(objects.filter((match) => match[1] === "pic" && match[0].includes('name="mermaid artwork"'))).toHaveLength(2);
    let count = 0;
    for (const index of [1, 2]) {
      const slide = rendered.model.slides[index];
      for (const image of rendered.slideFallbackImages[index]) {
        const fallback = slide.fallbacks[image.fallbackIndex];
        if (fallback.type !== "mermaid") continue;
        count++;
        expect(image.width).toBeGreaterThan(0);
        expect(image.height).toBeGreaterThan(0);
        expect(bytes.indexOf(image.data)).toBeGreaterThan(0);
        expect(bytes.indexOf(image.data, bytes.indexOf(image.data) + 1)).toBe(-1);
        expect(slide.elements.some((element) => element.path === fallback.path)).toBe(false);
      }
    }
    expect(count).toBe(3);
    expect(xml.split("<a:t>Native</a:t>")).toHaveLength(2);
    expect(xml.split("<a:t>Shadow</a:t>")).toHaveLength(2);
    expect(xml).not.toContain("<a:t>Revenue / 収益</a:t>");
    const chart = rendered.model.slides[2];
    const bar = chart.fallbacks.find((fallback) => fallback.type === "mermaid" && fallback.reason.endsWith("-style"));
    const bars = chart.elements.filter((element) => element.path?.includes(".parts[2].parts[0].parts["));
    expect(bars.some((element) => element.zOrder < bar.zOrder)).toBe(true);
    expect(bars.some((element) => element.zOrder > bar.zOrder)).toBe(true);
    await test.info().attach("actual-chart-pptx", {
      path: output, contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
  });
});
