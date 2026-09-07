import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { startHarness } from "../harness/server.mjs";
import { waitForSlideReady } from "../utils/ready.mjs";
import { validateScene } from "../../.github/extensions/markdstage/renderer/scene-graph.mjs";
import { sceneToPptxElements } from "../../.github/extensions/markdstage/renderer/scene-pptx.mjs";
import { buildPptxPackage, inspectPptxPackage } from "../../.github/extensions/markdstage/runtime/pptx-package.mjs";
import { withDeckServer } from "../../packages/markdstage-cli/src/deck.mjs";
import { exportPptx } from "../../.github/extensions/markdstage/runtime/output.mjs";
import { runPptxOutputBrowser } from "../../.github/extensions/markdstage/runtime/browser.mjs";

const names = ["c4-basic", "c4-hybrid", "mermaid-architecture-basic", "mermaid-architecture-hybrid",
  "eventmodeling-basic", "eventmodeling-hybrid"];
const fixture = (name, extension = "svg") => readFile(join(process.cwd(), "test", "fixtures", "mermaid", `${name}.${extension}`), "utf8");
const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children || [])]);
const textOf = (node) => (node.text?.paragraphs || node.paragraphs || [])
  .map((paragraph) => paragraph.runs.map((run) => run.text).join("")).join("\n").trim();
const customThemeCss = "--bg:#102030;--print-slide-bg:#102030;--topbar:#ff6600;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;";
const runtimeTest = test.extend({ launchOptions: { executablePath: chromium.executablePath(),
  args: ["--disable-gpu", "--force-color-profile=srgb", "--force-device-scale-factor=1",
    "--hide-scrollbars", "--run-all-compositor-stages-before-draw"] } });

async function extract(page, name, mutation, arg) {
  await page.evaluate((svg) => {
    document.body.innerHTML = `<div id="fixture-deck" style="position:relative;width:1280px;height:720px">${svg}</div>`;
  }, await fixture(name));
  if (mutation) await page.evaluate(mutation, arg);
  return page.evaluate(async () => {
    const { mermaidSvgToScene } = await import("./renderer/mermaid-scene.mjs");
    const deck = document.querySelector("#fixture-deck");
    const result = mermaidSvgToScene(deck.querySelector("svg"), { deck, includeSourceElements: true });
    const walk = (nodes) => nodes.flatMap((node) => [node, ...walk(node.children || [])]);
    const nodes = walk(result.scene.nodes);
    const origin = deck.getBoundingClientRect();
    const sources = nodes.map((node) => {
      const element = result.sourceElements.get(node.sourcePath);
      if (!element) return { path: node.sourcePath };
      const box = element.getBoundingClientRect();
      let vertices;
      if (node.preset === "triangle") {
        const matrix = element.getScreenCTM();
        let points;
        if (element.localName === "polygon") {
          points = [...element.points].map((point) => ({ x: point.x, y: point.y }));
        } else if (node.meta?.mermaid?.placement) {
          const placement = node.meta.mermaid.placement;
          const css = getComputedStyle(element);
          const marker = document.getElementById((placement === "start" ? css.markerStart : css.markerEnd).match(/#([^)"']+)/)[1]);
          const outline = marker.firstElementChild;
          const values = (outline.getAttribute("d") || outline.getAttribute("points")).match(/[-+]?(?:\d*\.?\d+)/g).map(Number);
          const length = element.getTotalLength();
          const end = placement === "end";
          const anchor = element.getPointAtLength(end ? length : 0);
          const neighbor = element.getPointAtLength(end ? length - .001 : .001);
          const angle = Math.atan2(end ? anchor.y - neighbor.y : neighbor.y - anchor.y,
            end ? anchor.x - neighbor.x : neighbor.x - anchor.x);
          const unit = marker.getAttribute("markerUnits") === "userSpaceOnUse" ? 1 : Number.parseFloat(css.strokeWidth);
          points = [];
          for (let index = 0; index < values.length; index += 2) {
            const x = (values[index] - Number(marker.getAttribute("refX"))) * unit;
            const y = (values[index + 1] - Number(marker.getAttribute("refY"))) * unit;
            points.push({ x: anchor.x + x * Math.cos(angle) - y * Math.sin(angle),
              y: anchor.y + x * Math.sin(angle) + y * Math.cos(angle) });
          }
        }
        vertices = points?.map((point) => {
          const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
          return { x: screen.x - origin.x, y: screen.y - origin.y };
        });
      }
      return { path: node.sourcePath, tag: element.localName, class: element.getAttribute("class"), vertices,
        bounds: { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height } };
    });
    const conflicts = nodes.filter((node) => node.kind === "fallback").flatMap((fallback) =>
      nodes.filter((node) => !["fallback", "group"].includes(node.kind)).filter((node) => {
        const native = result.sourceElements.get(node.sourcePath);
        const artwork = result.sourceElements.get(fallback.sourcePath);
        return native && artwork && (native.contains(artwork) || artwork.contains(native));
      }).map((node) => node.sourcePath));
    return { scene: result.scene, diagnostics: result.diagnostics, sources, conflicts };
  });
}

test("pinned C4, architecture and Event Modeling retain native boxes, labels and relations", async ({ page }) => {
  const harness = await startHarness({ slides: ["# System model fixtures"] });
  try {
    await page.goto(harness.url);
    for (const name of names) {
      const result = await extract(page, name);
      validateScene(result.scene);
      expect(result.conflicts, name).toEqual([]);
      const nodes = flatten(result.scene.nodes);
      expect(nodes.filter((node) => node.kind === "shape").length, name).toBeGreaterThan(0);
      expect(nodes.filter((node) => node.kind === "text").length, name).toBeGreaterThan(2);
      expect(nodes.filter((node) => node.kind === "connector").length, name).toBeGreaterThan(1);
      expect(result.diagnostics.every((entry) => entry.path !== "svg" && entry.reason), name).toBe(true);
      const fallbacks = nodes.filter((node) => node.kind === "fallback");
      if (name === "c4-basic") {
        expect(fallbacks).toHaveLength(1);
        expect(result.sources.find((source) => source.path === fallbacks[0].sourcePath).tag).toBe("image");
        expect(nodes.map(textOf)).toEqual(expect.arrayContaining(["利用者", "注文システム", "Web", "Mobile", "配送情報"]));
      }
      if (name === "c4-hybrid") {
        expect(fallbacks.length).toBeGreaterThan(1);
        expect(nodes.map(textOf)).toEqual(expect.arrayContaining(["データ", "通知", "保存", "非同期"]));
      }
      if (name === "mermaid-architecture-basic") {
        expect(fallbacks).toEqual([]);
        expect(nodes.filter((node) => node.preset === "triangle")).toHaveLength(3);
        expect(nodes.filter((node) => node.preset === "topRoundedRect")).toHaveLength(3);
      }
      if (name === "mermaid-architecture-hybrid") {
        expect(fallbacks).toHaveLength(5);
        expect(fallbacks.every((node) => result.sources.find((source) => source.path === node.sourcePath).tag === "svg")).toBe(true);
        expect(nodes.map(textOf)).toEqual(expect.arrayContaining(["API", "Database", "Storage", "Internet", "Cloud"]));
      }
      if (name === "eventmodeling-basic") {
        expect(fallbacks).toEqual([]);
        expect(nodes.map(textOf)).toEqual(expect.arrayContaining(["CartUI", "AddItem", "ItemAdded", "CartView", "CheckoutUI"]));
      }
      const mapped = sceneToPptxElements(result.scene);
      const bytes = buildPptxPackage({ slides: [{ elements: mapped.elements }] });
      expect(inspectPptxPackage(bytes).valid, name).toBe(true);
      const xml = bytes.toString("utf8");
      expect(xml).toContain("<a:t>");
      expect(xml).toContain("<a:ln");
      if (name === "eventmodeling-basic") expect(xml).toContain('b="1"');
    }
  } finally { await harness.close(); }
});

test("system-model primitives retain measured bounds, independent alpha and source ownership at two sizes", async ({ page }) => {
  const harness = await startHarness({ slides: ["# System model geometry"] });
  try {
    await page.goto(harness.url);
    for (const name of names.filter((name) => name.endsWith("basic"))) {
      for (const width of [480, 960]) {
        const result = await extract(page, name, (width) => {
          document.querySelector("svg").style.cssText = `width:${width}px;height:auto;margin-left:43px;margin-top:29px`;
          const shape = document.querySelector("svg > g rect");
          shape.style.cssText = "fill:rgba(10,20,30,.8);stroke:rgba(40,50,60,.6);stroke-width:2px;fill-opacity:.5;stroke-opacity:.25;opacity:.8";
        }, width);
        expect(result.conflicts).toEqual([]);
        for (const node of flatten(result.scene.nodes).filter((node) => node.kind === "shape")) {
          const source = result.sources.find((source) => source.path === node.sourcePath);
          if (!source?.bounds || source.tag === "polygon" || node.meta?.mermaid?.kind?.endsWith("-arrow")) continue;
          for (const key of ["x", "y", "width", "height"]) {
            expect(Math.abs(node.bounds[key] - source.bounds[key]), `${name} ${key}`).toBeLessThanOrEqual(.11);
          }
        }
        const xml = buildPptxPackage({ slides: [{ elements: sceneToPptxElements(result.scene).elements }] }).toString("utf8");
        expect(xml).toContain('<a:alpha val="32000"/>');
        expect(xml).toContain('<a:alpha val="12000"/>');
      }
    }
  } finally { await harness.close(); }
});

test("unknown geometry, marker changes, HTML decoration and unsafe shared effects stay local", async ({ page }) => {
  const harness = await startHarness({ slides: ["# System model guards"] });
  try {
    await page.goto(harness.url);
    for (const name of names.filter((name) => name.endsWith("basic"))) {
      for (const mutation of ["group-opacity", "skew", "shape-effect", "arrow-geometry", "arrow-effect", "label-effect"]) {
        const result = await extract(page, name, ({ mutation, name }) => {
          const svg = document.querySelector("svg");
          const container = svg.querySelector(".person-man, .architecture-service, .em-box");
          if (mutation === "group-opacity") container.style.opacity = ".5";
          if (mutation === "skew") container.setAttribute("transform", "skewX(15)");
          if (mutation === "shape-effect") container.querySelector("rect, path").style.filter = "blur(1px)";
          if (mutation === "label-effect") container.querySelector("text, foreignObject").style.filter = "blur(1px)";
          if (mutation === "arrow-effect") {
            svg.querySelector(name.startsWith("mermaid-architecture") ? "polygon.arrow" : "marker path, marker polygon").style.filter = "blur(1px)";
          }
          if (mutation === "arrow-geometry") {
            if (name.startsWith("mermaid-architecture")) svg.querySelector("polygon.arrow").setAttribute("points", "0,0 20,0 10,5 0,20");
            else {
              const outline = svg.querySelector("marker path, marker polygon");
              outline.setAttribute(outline.localName === "path" ? "d" : "points",
                outline.localName === "path" ? "M0,0L20,0L10,5L0,20Z" : "0,0 20,0 10,5 0,20");
            }
          }
        }, { mutation, name });
        expect(result.diagnostics.length, `${name} ${mutation}`).toBeGreaterThan(0);
        expect(result.diagnostics.some((entry) => !result.sources.some((source) =>
          source.path === entry.path && source.tag === "image")), `${name} ${mutation} has a new local fallback`).toBe(true);
        expect(result.diagnostics.every((entry) => entry.path !== "svg"), `${name} ${mutation}`).toBe(true);
        expect(result.conflicts, `${name} ${mutation}`).toEqual([]);
        expect(flatten(result.scene.nodes).some((node) => node.kind === "text")).toBe(true);
      }
    }
  } finally { await harness.close(); }
});

test("native triangles preserve C4 bidirectional and Event Modeling marker vertices and architecture directions", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Measured arrows"] });
  try {
    await page.goto(harness.url);
    for (const name of ["c4-basic", "mermaid-architecture-basic", "mermaid-architecture-hybrid", "eventmodeling-basic"]) {
      for (const width of [480, 960]) {
        const result = await extract(page, name, (width) => {
          document.querySelector("svg").style.cssText = `width:${width}px;height:auto;margin:23px`;
        }, width);
        let count = 0;
        const walk = (nodes, x = 0, y = 0) => {
          for (const node of nodes) {
            if (node.kind === "group") walk(node.children, x + node.bounds.x, y + node.bounds.y);
            if (node.preset !== "triangle") continue;
            count++;
            const expected = result.sources.find((source) => source.path === node.sourcePath).vertices;
            expect(expected, node.sourcePath).toHaveLength(3);
            const angle = (node.rotation || 0) * Math.PI / 180;
            const { width, height } = node.bounds;
            const center = { x: x + node.bounds.x + width / 2, y: y + node.bounds.y + height / 2 };
            for (const [dx, dy] of [[0, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]]) {
              const point = { x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle),
                y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
              expect(Math.min(...expected.map((vertex) => Math.hypot(point.x - vertex.x, point.y - vertex.y))),
                `${name} ${node.sourcePath}`).toBeLessThan(.25);
            }
          }
        };
        walk(result.scene.nodes);
        expect(count, name).toBeGreaterThan(1);
      }
    }
  } finally { await harness.close(); }
});

test("all C4 entry points share the bounded adapter and architecture aliases follow the bundled parser", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Mermaid entry points"] });
  try {
    await page.goto(harness.url);
    await page.waitForFunction(() => window.mermaid);
    const result = await page.evaluate(async () => {
      const { mermaidSvgToScene } = await import("./renderer/mermaid-scene.mjs");
      mermaid.initialize({ startOnLoad: false, theme: "default", fontFamily: "Arial", securityLevel: "loose" });
      const results = [];
      for (const [kind, source] of [
        ["C4Context", 'System(a, "A")\nSystem(b, "B")\nRel(a, b, "uses")'],
        ["C4Container", 'Container(a, "A", "HTTP")\nContainer(b, "B", "HTTP")\nRel(a, b, "uses")'],
        ["C4Component", 'Component(a, "A", "HTTP")\nComponent(b, "B", "HTTP")\nRel(a, b, "uses")'],
        ["C4Dynamic", 'Container(a, "A", "HTTP")\nContainer(b, "B", "HTTP")\nRel(a, b, "uses")'],
        ["C4Deployment", 'Deployment_Node(host, "Host") {\nContainer(a, "A", "HTTP")\nContainer(b, "B", "HTTP")\n}\nRel(a, b, "uses")'],
      ]) {
        const { svg } = await mermaid.render(`entry-${kind}`, `${kind}\n${source}`);
        const deck = document.createElement("div");
        deck.innerHTML = svg;
        document.body.append(deck);
        const result = mermaidSvgToScene(deck.querySelector("svg"), { deck });
        const walk = (nodes) => nodes.flatMap((node) => [node, ...walk(node.children || [])]);
        results.push({ kind, diagnostics: result.diagnostics, kinds: walk(result.scene.nodes).map((node) => node.kind) });
        deck.remove();
      }
      let rejectedAlias = false;
      try { await mermaid.parse("architecture\nservice api[API]"); } catch { rejectedAlias = true; }
      return { results, rejectedAlias };
    });
    expect(result.rejectedAlias).toBe(true);
    for (const entry of result.results) {
      expect(entry.diagnostics, entry.kind).toEqual([]);
      expect(entry.kinds, entry.kind).toEqual(expect.arrayContaining(["shape", "text", "connector"]));
    }
  } finally { await harness.close(); }
});

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  runtimeTest(`real system-model renderer retains source artwork and disjoint native masks (${theme})`, async ({ page }) => {
    test.setTimeout(120_000);
    const sources = await Promise.all(names.map((name) => fixture(name, "mmd")));
    const harness = await startHarness({
      slides: sources.map((source) => `## System models\n\n\`\`\`mermaid\n${source}\n\`\`\``),
      theme, customThemeCss: theme === "custom" ? customThemeCss : "",
    });
    await page.addInitScript(() => {
      const replaceWith = Element.prototype.replaceWith;
      Element.prototype.replaceWith = function (...nodes) {
        if (this.localName === "svg" && nodes[0]?.getAttribute?.("data-scene-source") === "mermaid") nodes[0].__originalMermaidSvg = this;
        return replaceWith.apply(this, nodes);
      };
    });
    try {
      await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`);
      await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready") ||
        document.documentElement.hasAttribute("data-pptx-error"));
      await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
      const model = await page.evaluate(() => window.__presentationPptxModel);
      for (const slide of model.slides.slice(0, names.length)) {
        expect(slide.elements.some((element) => element.type === "text")).toBe(true);
        expect(slide.fallbacks.filter((entry) => entry.type === "mermaid").every((entry) => entry.path && entry.reason)).toBe(true);
      }
      const masks = await page.evaluate(() => [...document.querySelectorAll(".deck svg[data-scene-source=mermaid]")].map((svg) => ({
        native: svg.querySelectorAll("[data-pptx-native]").length,
        nested: [...svg.querySelectorAll("[data-pptx-fallback-ids]")].filter((element) =>
          element.closest("[data-pptx-native]") || element.querySelector("[data-pptx-native]")).length,
      })));
      expect(masks).toHaveLength(names.length);
      expect(masks.every((entry) => entry.native > 0 && entry.nested === 0)).toBe(true);
      for (const index of names.keys()) {
        await page.request.post(`${harness.url}/navigate`, { data: { index } });
        await page.goto(`${harness.url}?present=1`);
        await waitForSlideReady(page);
        const before = await page.locator(".deck").screenshot();
        await page.locator("svg[data-scene-source=mermaid]").evaluate(async (element) => {
          const { captureSvgTree, sceneToSvg } = await import("./renderer/scene-svg.mjs");
          const scene = element.__presentationScene;
          const original = element.__originalMermaidSvg;
          element.replaceWith(original);
          original.replaceWith(sceneToSvg({ ...scene, nodes: [], meta: { svgRoot: captureSvgTree(original) } }));
        });
        const original = await page.locator(".deck").screenshot();
        if (!before.equals(original)) {
          await writeFile(test.info().outputPath(`${names[index]}-actual.png`), before);
          await writeFile(test.info().outputPath(`${names[index]}-source.png`), original);
        }
        expect(before.equals(original), `${names[index]} retains source pixels`).toBe(true);
        await page.locator("pre.mermaid > svg").evaluate((svg) => { svg.style.transform = "translateX(2px)"; });
        expect((await page.locator(".deck").screenshot()).equals(original), "shifted-source negative control").toBe(false);
      }
    } finally { await harness.close(); }
  });
}

runtimeTest("actual system-model PPTX preserves local icons once in native paint order", async ({ page }) => {
  test.setTimeout(120_000);
  const directory = test.info().outputPath();
  const file = join(directory, "slides.md");
  const sources = await Promise.all(names.map((name) => fixture(name, "mmd")));
  await writeFile(file, ["# System models", ...sources.map((source) => `## System models\n\n\`\`\`mermaid\n${source}\n\`\`\``)].join("\n\n---\n\n"));
  await withDeckServer({ file, workspace: directory, theme: "light" }, async (session) => {
    let rendered;
    const output = join(directory, "editable-hybrid.pptx");
    await exportPptx(session, output, "light", {
      findChromiumBrowser: () => chromium.executablePath(),
      runPptxOutputBrowser: async (...args) => {
        rendered = await runPptxOutputBrowser(...args);
        await page.goto(args[1]);
        await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready"));
        return rendered;
      },
    });
    const bytes = await readFile(output);
    expect(inspectPptxPackage(bytes).valid).toBe(true);
    const slides = [...bytes.toString("utf8").matchAll(/<p:sld\b[\s\S]*?<\/p:sld>/g)].map((match) => match[0]);
    for (let index = 1; index <= names.length; index++) {
      const model = rendered.model.slides[index];
      const objects = [...slides[index].matchAll(/<p:(sp|pic|cxnSp)>[\s\S]*?<\/p:\1>/g)];
      const expected = [...model.elements, ...model.fallbacks.filter((fallback) => fallback.artwork !== false)].sort((a, b) => a.zOrder - b.zOrder);
      expect(objects.map((object) => object[1])).toEqual(expected.map((element) => model.fallbacks.includes(element) ? "pic" : "sp"));
      for (const image of rendered.slideFallbackImages[index]) {
        const fallback = model.fallbacks[image.fallbackIndex];
        if (fallback.type !== "mermaid") continue;
        expect(bytes.indexOf(image.data)).toBeGreaterThan(0);
        expect(bytes.indexOf(image.data, bytes.indexOf(image.data) + 1)).toBe(-1);
        expect(image.width).toBeGreaterThan(0);
        expect(image.height).toBeGreaterThan(0);
        expect(image.width).toBeLessThan(1280);
        expect(image.height).toBeLessThan(720);
        expect(model.elements.some((element) => element.path === fallback.path)).toBe(false);
        await writeFile(test.info().outputPath(`${names[index - 1]}-fallback-${image.fallbackIndex}.png`), image.data);
        const paint = await page.evaluate(async (data) => {
          const image = new Image();
          image.src = `data:image/png;base64,${data}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.width; canvas.height = image.height;
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, image.width, image.height).data;
          let visible = 0;
          for (let offset = 3; offset < pixels.length; offset += 4) if (pixels[offset] > 0) visible++;
          return visible;
        }, image.data.toString("base64"));
        expect(paint, `${names[index - 1]} local artwork is not empty`).toBeGreaterThan(0);
      }
    }
  });
});
