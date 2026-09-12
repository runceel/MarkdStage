import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, chromium } from "@playwright/test";
import { startHarness } from "../harness/server.mjs";
import { waitForSlideReady } from "../utils/ready.mjs";
import { validateScene } from "../../.github/extensions/markdstage/renderer/scene-graph.mjs";
import { sceneToPptxElements } from "../../.github/extensions/markdstage/renderer/scene-pptx.mjs";
import { buildPptxPackage as buildPptxBytes, inspectPptxPackage } from "../../.github/extensions/markdstage/runtime/pptx-package.mjs";
import { withDeckServer } from "../../packages/markdstage-cli/src/deck.mjs";
import { exportPptx } from "../../.github/extensions/markdstage/runtime/output.mjs";
import { runPptxOutputBrowser } from "../../.github/extensions/markdstage/runtime/browser.mjs";

const buildPptxPackage = (model) => Buffer.from(buildPptxBytes(model));

const names = ["ishikawa-basic", "ishikawa-multiline", "ishikawa-hybrid", "ishikawa-handdrawn", "ishikawa-native"];
const counts = [1, 1, 7, 22, 0];
const customThemeCss = "--bg:#102030;--print-slide-bg:#102030;--topbar:#ff6600;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;";
const fixture = (name, extension = "svg") => readFile(join(process.cwd(), "test", "fixtures", "mermaid", `${name}.${extension}`), "utf8");
const textOf = (node) => (node.text?.paragraphs || node.paragraphs || [])
  .map((paragraph) => paragraph.runs.map((run) => run.text).join("")).join("\n").trim();
const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children || [])]);
// The exporter launches full Chromium, not Playwright's default headless shell.
// Their SVG measurements/rasterization differ even at the same viewport and version.
const runtimeTest = test.extend({ launchOptions: { executablePath: chromium.executablePath() } });

async function extract(page, name = names[0], mutate, arg) {
  await page.evaluate((svg) => {
    document.body.innerHTML = `<div id="fixture-deck" style="position:relative;width:1280px;height:720px">${svg}</div>`;
  }, await fixture(name));
  if (mutate) await page.evaluate(mutate, arg);
  return page.evaluate(async () => {
    const { mermaidSvgToScene } = await import("./renderer/mermaid-scene.mjs");
    const { sceneToSvg } = await import("./renderer/scene-svg.mjs");
    const deck = document.querySelector("#fixture-deck");
    const svg = deck.querySelector("svg");
    const result = mermaidSvgToScene(svg, { deck, includeSourceElements: true });
    const origin = deck.getBoundingClientRect();
    const walk = (nodes) => nodes.flatMap((node) => [node, ...walk(node.children || [])]);
    const nodes = walk(result.scene.nodes);
    const sources = nodes.map((node) => {
      const element = result.sourceElements.get(node.sourcePath);
      if (!element) return { path: node.sourcePath };
      const bounds = element.getBoundingClientRect();
      const matrix = element.getScreenCTM();
      const point = (x, y) => {
        const p = new DOMPoint(x, y).matrixTransform(matrix);
        return { x: p.x - origin.x, y: p.y - origin.y };
      };
      return { path: node.sourcePath, tag: element.localName, class: element.getAttribute("class"),
        bounds: { x: bounds.x - origin.x, y: bounds.y - origin.y, width: bounds.width, height: bounds.height },
        text: element.textContent.trim(), scale: matrix.a,
        ...(element.localName === "line" ? {
          start: point(element.x1.baseVal.value, element.y1.baseVal.value),
          end: point(element.x2.baseVal.value, element.y2.baseVal.value),
          strokeWidth: Number.parseFloat(getComputedStyle(element).strokeWidth),
        } : {}) };
    });
    const native = nodes.filter((node) => node.kind !== "fallback");
    const conflicts = nodes.filter((node) => node.kind === "fallback").flatMap((fallback) =>
      native.filter((node) => {
        const a = result.sourceElements.get(node.sourcePath);
        const b = result.sourceElements.get(fallback.sourcePath);
        return a && b && (a.contains(b) || b.contains(a));
      }));
    return { scene: result.scene, diagnostics: result.diagnostics, sources, conflicts,
      nativeSvg: result.diagnostics.length ? null : sceneToSvg(result.scene).outerHTML };
  });
}

test("pinned Ishikawa has native measured lines, label boxes, text and exact spine-facing triangles", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Ishikawa"] });
  try {
    await page.goto(harness.url);
    const result = await extract(page);
    validateScene(result.scene);
    expect(result.diagnostics.map((entry) => entry.reason)).toEqual(["unsupported-mermaid-ishikawa-geometry"]);
    expect(result.conflicts).toEqual([]);
    const nodes = flatten(result.scene.nodes);
    expect(nodes.filter((node) => node.meta?.mermaid?.kind === "ishikawa-arrow")).toHaveLength(8);
    expect(nodes.filter((node) => node.meta?.mermaid?.kind === "ishikawa-label-box")).toHaveLength(4);
    expect(nodes.filter((node) => node.kind === "connector")).toHaveLength(9);
    expect(nodes.map(textOf)).toEqual(expect.arrayContaining(["品質低下", "人材", "方法", "設備", "材料", "Training"]));
    const fallback = nodes.find((node) => node.kind === "fallback");
    expect(result.sources.find((source) => source.path === fallback.sourcePath).class).toBe("ishikawa-head");
    const mapped = sceneToPptxElements(result.scene);
    const bytes = buildPptxPackage({ slides: [{ elements: mapped.elements }] });
    expect(inspectPptxPackage(bytes).valid).toBe(true);
    expect([...bytes.toString("utf8").matchAll(/prst="triangle"/g)]).toHaveLength(8);
    expect(bytes.toString("utf8")).not.toContain("<a:headEnd");
    expect(bytes.toString("utf8")).not.toContain("<a:tailEnd");
  } finally { await harness.close(); }
});

test("Ishikawa positions, line direction, arrow size and multiline baselines survive scaled placement", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Measured Ishikawa"] });
  try {
    await page.goto(harness.url);
    for (const scale of [0.5, 1.25]) {
      const result = await extract(page, names[1], (scale) => {
        document.querySelector("svg").style.cssText = "width:640px;height:auto;margin-left:47px;margin-top:31px";
        document.querySelector("g.ishikawa").setAttribute("transform", `translate(18,23) scale(${scale})`);
      }, scale);
      expect(result.conflicts).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      const mapped = sceneToPptxElements(result.scene);
      const nodes = flatten(result.scene.nodes);
      const lines = nodes.filter((node) => node.meta?.mermaid?.kind === "ishikawa-text-line");
      expect(lines.length).toBeGreaterThan(5);
      for (const node of nodes.filter((node) => node.kind === "text" || node.meta?.mermaid?.kind === "ishikawa-label-box")) {
        const source = result.sources.find((source) => source.path === node.sourcePath);
        for (const key of ["x", "y", "width", "height"]) expect(Math.abs(node.bounds[key] - source.bounds[key])).toBeLessThanOrEqual(0.11);
      }
      for (const group of result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "ishikawa-marked-line")) {
        const line = nodes.find((node) => node.sourcePath === `${group.sourcePath}.line`);
        const arrow = nodes.find((node) => node.sourcePath === `${group.sourcePath}.arrow`);
        const source = result.sources.find((source) => source.path === group.sourcePath);
        const angle = arrow.rotation * Math.PI / 180;
        const center = { x: arrow.bounds.x + arrow.bounds.width / 2,
          y: arrow.bounds.y + arrow.bounds.height / 2 };
        const tip = { x: center.x + Math.sin(angle) * arrow.bounds.height / 2,
          y: center.y - Math.cos(angle) * arrow.bounds.height / 2 };
        expect(arrow.bounds.width).toBeCloseTo(6 * source.strokeWidth * source.scale, 1);
        for (const key of ["x", "y"]) {
          expect(tip[key]).toBeCloseTo(source.start[key], 0);
          expect(line.points[0][key]).toBeCloseTo(source.start[key], 0);
          expect(line.points[1][key]).toBeCloseTo(source.end[key], 0);
        }
      }
      const xml = buildPptxPackage({ slides: [{ elements: mapped.elements }] }).toString("utf8");
      const objects = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((match) => match[0]);
      for (const line of lines) {
        const object = objects.find((object) => object.includes(`<a:t>${textOf(line)}</a:t>`));
        expect([...object.matchAll(/<a:p>/g)]).toHaveLength(1);
        const offset = /<a:off x="(-?\d+)" y="(-?\d+)"/.exec(object);
        expect(Number(offset[2]) / 9525).toBeCloseTo(line.bounds.y, 3);
      }
    }
  } finally { await harness.close(); }
});

test("Ishikawa rough group artwork includes scaled path strokes but not hidden or definition paint", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Rough bounds"] });
  try {
    await page.goto(harness.url);
    for (const scale of [0.5, 1.25]) {
      const result = await extract(page, names[3], (scale) => {
        const spine = document.querySelector(".ishikawa-spine");
        spine.setAttribute("transform", `translate(30,40) scale(${scale})`);
        spine.querySelector("path").style.strokeWidth = "8px";
        const hidden = spine.querySelector("path").cloneNode();
        hidden.style.cssText = "display:none;stroke-width:1000px";
        spine.append(hidden);
        const defs = document.createElementNS(spine.namespaceURI, "defs");
        defs.append(hidden.cloneNode());
        defs.firstChild.style.display = "";
        spine.append(defs);
      }, scale);
      const fallback = result.scene.nodes.find((node) => node.kind === "fallback" && node.meta?.mermaid?.class === "ishikawa-spine");
      const source = result.sources.find((source) => source.path === fallback.sourcePath);
      const padding = 8 * 2 * source.scale + 1;
      expect(source.bounds.x - fallback.bounds.x).toBeCloseTo(padding, 0);
      expect(source.bounds.y - fallback.bounds.y).toBeCloseTo(padding, 0);
      expect(fallback.bounds.width - source.bounds.width).toBeCloseTo(2 * padding, 0);
      expect(fallback.bounds.height - source.bounds.height).toBeCloseTo(2 * padding, 0);
      expect(result.conflicts).toEqual([]);
    }
  } finally { await harness.close(); }
});

test("Ishikawa native subset retains independent box, line and marker alpha", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Alpha"] });
  try {
    await page.goto(harness.url);
    const result = await extract(page, names[4], () => {
      document.querySelector(".ishikawa-label-box").style.cssText =
        "fill:rgba(10,20,30,.8);stroke:rgba(40,50,60,.6);fill-opacity:.5;stroke-opacity:.25;opacity:.8";
      document.querySelector(".ishikawa-branch").style.strokeOpacity = ".4";
      document.querySelector(".ishikawa-arrow").style.cssText = "fill:rgba(90,100,110,.8);fill-opacity:.5";
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.conflicts).toEqual([]);
    const xml = buildPptxPackage({ slides: [{ elements: sceneToPptxElements(result.scene).elements }] }).toString("utf8");
    for (const alpha of ["32000", "12000", "40000"]) expect(xml).toContain(`<a:alpha val="${alpha}"/>`);
    expect(result.nativeSvg).toContain('fill="rgba(90, 100, 110, 0.8)"');
  } finally { await harness.close(); }
});

test("Ishikawa unknown marker geometry, transforms and effects keep the entire affected line local", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Marker guards"] });
  try {
    await page.goto(harness.url);
    for (const mutation of ["shape", "css-d", "ref", "size", "units", "viewbox", "aspect", "orientation", "duplicate",
      "stroke", "filter", "marker-transform", "hidden", "animation", "end", "mid", "line-opacity", "line-skew"]) {
      const result = await extract(page, names[0], (mutation) => {
        const line = document.querySelector(".ishikawa-branch");
        const original = document.querySelector("marker");
        // Restrict the changed definition to one line, preserving the pinned id.
        for (const other of document.querySelectorAll("line[marker-start]")) if (other !== line) other.removeAttribute("marker-start");
        const outline = original.firstElementChild;
        if (mutation === "shape") outline.setAttribute("d", "M0,0L10,5L0,10Z");
        if (mutation === "css-d") outline.style.d = 'path("M0,0L10,5L0,10Z")';
        if (mutation === "ref") original.setAttribute("refX", "2");
        if (mutation === "size") original.setAttribute("markerWidth", "10");
        if (mutation === "units") original.setAttribute("markerUnits", "userSpaceOnUse");
        if (mutation === "viewbox") original.setAttribute("viewBox", "0 0 8 10");
        if (mutation === "aspect") original.setAttribute("preserveAspectRatio", "none");
        if (mutation === "orientation") original.setAttribute("orient", "auto-start-reverse");
        if (mutation === "duplicate") original.after(original.cloneNode(true));
        if (mutation === "stroke") outline.style.stroke = "red";
        if (mutation === "filter") outline.style.filter = "blur(1px)";
        if (mutation === "marker-transform") outline.style.transform = "translateX(1px)";
        if (mutation === "hidden") outline.style.display = "none";
        if (mutation === "animation") outline.style.animationName = "unexpected";
        if (mutation === "end") line.setAttribute("marker-end", line.getAttribute("marker-start"));
        if (mutation === "mid") line.setAttribute("marker-mid", line.getAttribute("marker-start"));
        if (mutation === "line-opacity") line.style.opacity = ".5";
        if (mutation === "line-skew") line.setAttribute("transform", "skewX(20)");
      }, mutation);
      const fallbacks = result.scene.nodes.filter((node) => node.kind === "fallback");
      expect(fallbacks, mutation).toHaveLength(2);
      expect(result.sources.find((source) => source.path === fallbacks[1].sourcePath).class, mutation).toBe("ishikawa-branch");
      expect(result.conflicts, mutation).toEqual([]);
      expect(flatten(result.scene.nodes).filter((node) => node.meta?.mermaid?.kind === "ishikawa-arrow"), mutation).toHaveLength(0);
    }
  } finally { await harness.close(); }
});

test("Ishikawa mixed effects, unsupported labels, visibility, structures and limits are diagnostic", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Local guards"] });
  try {
    await page.goto(harness.url);
    for (const [name, expected] of names.map((name, index) => [name, counts[index]])) {
      const result = await extract(page, name);
      expect(result.diagnostics, name).toHaveLength(expected);
      expect(result.conflicts, name).toEqual([]);
      expect(result.scene.nodes.filter((node) => node.kind === "text").length, name).toBeGreaterThan(3);
    }
    for (const mutation of ["group-opacity", "group-clip", "label-spacing", "tspan-effect", "tspan-coordinate",
      "unknown", "structure", "depth", "elements", "nodes"]) {
      const result = await extract(page, names[0], async (mutation) => {
        const { MAX_SCENE_NODES, MAX_GROUP_DEPTH } = await import("./renderer/scene-graph.mjs");
        const root = document.querySelector("g.ishikawa");
        const group = document.querySelector(".ishikawa-sub-group");
        const text = group.querySelector("text");
        if (mutation === "group-opacity") group.style.opacity = ".5";
        if (mutation === "group-clip") group.style.clipPath = "inset(3px)";
        if (mutation === "label-spacing") text.style.letterSpacing = "3px";
        if (mutation === "tspan-effect") text.firstElementChild.style.filter = "blur(1px)";
        if (mutation === "tspan-coordinate") text.firstElementChild.setAttribute("x", "10 20");
        if (mutation === "unknown") root.insertAdjacentHTML("beforeend", '<path d="M0,0L10,20Q40,30,20,10Z"/>');
        if (mutation === "structure") root.setAttribute("class", "future-ishikawa");
        if (mutation === "depth") {
          let parent = root;
          for (let i = 0; i < MAX_GROUP_DEPTH + 1; i++) {
            const group = document.createElementNS(root.namespaceURI, "g");
            parent.append(group); parent = group;
          }
          parent.append(text.cloneNode(true));
        }
        if (mutation === "elements") for (let i = 0; i < MAX_SCENE_NODES * 10; i++) root.append(document.createElementNS(root.namespaceURI, "g"));
        if (mutation === "nodes") for (let i = 0; i < MAX_SCENE_NODES; i++) root.append(root.querySelector(".ishikawa-spine").cloneNode(true));
      }, mutation);
      expect(result.diagnostics.length, mutation).toBeGreaterThan(0);
      expect(result.diagnostics.some((entry) => entry.reason.startsWith("mermaid-scene-adapter-failed")), mutation).toBe(false);
      expect(result.diagnostics.every((entry) => entry.path && entry.reason), mutation).toBe(true);
      expect(result.conflicts, mutation).toEqual([]);
      if (["structure", "elements", "nodes"].includes(mutation)) expect(result.scene.nodes, mutation).toHaveLength(1);
      else expect(result.scene.nodes.filter((node) => node.kind === "fallback"), mutation).toHaveLength(2);
    }
  } finally { await harness.close(); }
});

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  test(`real Ishikawa aliases and look variants retain native exclusions and source ownership (${theme})`, async ({ page }) => {
    const sources = await Promise.all(names.map((name) => fixture(name, "mmd")));
    const harness = await startHarness({ slides: sources.map((source) => `## Ishikawa\n\n\`\`\`mermaid\n${source}\n\`\`\``),
      theme, customThemeCss: theme === "custom" ? customThemeCss : "" });
    try {
      await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`);
      await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready") ||
        document.documentElement.hasAttribute("data-pptx-error"), undefined, { timeout: 120_000 });
      await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
      const model = await page.evaluate(() => window.__presentationPptxModel);
      expect(model.slides.map((slide) => slide.fallbacks.filter((item) => item.type === "mermaid").length)).toEqual(counts);
      const svgs = page.locator("pre.mermaid > svg");
      await expect(svgs.nth(0).locator("line[data-pptx-native]")).toHaveCount(9);
      await expect(svgs.nth(0).locator(".ishikawa-label-box[data-pptx-native=shape]")).toHaveCount(4);
      await expect(svgs.nth(0).locator(".ishikawa-head[data-pptx-fallback-ids]")).toHaveCount(1);
      await expect(svgs.nth(1).locator(".ishikawa-head-label > tspan[data-pptx-native=text]")).toHaveCount(3);
      await expect(svgs.nth(2).locator(".ishikawa-head-label[data-pptx-fallback-ids]")).toHaveCount(1);
      await expect(svgs.nth(2).locator(".ishikawa-branch[data-pptx-fallback-ids]")).toHaveCount(1);
      await expect(svgs.nth(2).locator(".ishikawa-label-group[data-pptx-fallback-ids]")).toHaveCount(4);
      await expect(svgs.nth(3).locator(".ishikawa-label[data-pptx-native=text]")).toHaveCount(8);
      await expect(svgs.nth(4).locator("[data-pptx-fallback-ids]")).toHaveCount(0);
      expect(await page.evaluate(() => [...document.querySelectorAll("pre.mermaid [data-pptx-fallback-ids]")].filter((fallback) =>
        fallback.hasAttribute("data-pptx-native") || fallback.closest("[data-pptx-native]") || fallback.querySelector("[data-pptx-native]")).length)).toBe(0);
      const xml = buildPptxPackage({ slides: [{ elements: model.slides[0].elements }] }).toString("utf8");
      expect([...xml.matchAll(/prst="triangle"/g)]).toHaveLength(8);
      expect(xml).toContain("<a:t>品質低下</a:t>");
      await writeFile(test.info().outputPath(`${theme}-model.json`), JSON.stringify(model, null, 2));
    } finally { await harness.close(); }
  });

  test(`Ishikawa source pixels survive scene reconstruction and serialization (${theme})`, async ({ page }) => {
    test.setTimeout(120_000);
    const sources = await Promise.all(names.map((name) => fixture(name, "mmd")));
    const harness = await startHarness({ slides: sources.map((source) => `## Ishikawa\n\n\`\`\`mermaid\n${source}\n\`\`\``),
      theme, customThemeCss: theme === "custom" ? customThemeCss : "" });
    await page.addInitScript(() => {
      const replaceWith = Element.prototype.replaceWith;
      Element.prototype.replaceWith = function (...nodes) {
        if (this.localName === "svg" && nodes[0]?.getAttribute?.("data-scene-source") === "mermaid") nodes[0].__originalMermaidSvg = this;
        return replaceWith.apply(this, nodes);
      };
    });
    try {
      for (const index of names.keys()) {
        await page.request.post(`${harness.url}/navigate`, { data: { index } });
        // Use separate loads: repeatedly reinserting the same curved SVG can
        // change Chromium's subpixel paint cache even with identical markup.
        for (const operation of ["original", "serialized"]) {
          await page.goto(`${harness.url}?present=1`);
          const slide = await waitForSlideReady(page);
          // Isolate SVG compositing so reinsertion inside the scaled iframe does
          // not change Chromium's curve-edge paint cache. Keep exact pixel equality.
          await slide.addStyleTag({ content: ".mermaid > svg { will-change: transform; }" });
          const before = await slide.locator(".deck").screenshot();
          await slide.locator("svg[data-scene-source=mermaid]").evaluate(async (element, operation) => {
            const { sceneToSvg } = await import("./renderer/scene-svg.mjs");
            element.replaceWith(operation === "original" ? element.__originalMermaidSvg
              : sceneToSvg(JSON.parse(JSON.stringify(element.__presentationScene))));
          }, operation);
          const after = await slide.locator(".deck").screenshot();
          if (!after.equals(before)) {
            await writeFile(test.info().outputPath(`${names[index]}-${operation}-before.png`), before);
            await writeFile(test.info().outputPath(`${names[index]}-${operation}-after.png`), after);
          }
          expect(after.equals(before), `${names[index]} ${operation} pixels`).toBe(true);
        }
      }
    } finally { await harness.close(); }
  });
}

runtimeTest("actual Ishikawa PPTX embeds local artwork once in paint order without native siblings", async ({ page }) => {
  test.setTimeout(120_000);
  const directory = test.info().outputPath();
  const sources = await Promise.all(names.map((name) => fixture(name, "mmd")));
  const file = join(directory, "slides.md");
  await writeFile(file, ["# Ishikawa export", ...sources.map((source) => `## Ishikawa\n\n\`\`\`mermaid\n${source}\n\`\`\``)].join("\n\n---\n\n"));
  await withDeckServer({ file, workspace: directory, theme: "light" }, async (session) => {
    let rendered;
    let headFill;
    let spineFrame;
    let sourcePng;
    const output = join(directory, "editable-hybrid.pptx");
    await exportPptx(session, output, "light", {
      findChromiumBrowser: () => chromium.executablePath(),
      runPptxOutputBrowser: async (...args) => {
        rendered = await runPptxOutputBrowser(...args);
        await page.goto(args[1]);
        await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready"));
        headFill = await page.locator(".deck").nth(1).locator(".ishikawa-head").evaluate((head) => getComputedStyle(head).fill);
        spineFrame = await page.locator(".deck").nth(4).locator(".ishikawa-spine").evaluate((spine) => {
          const box = spine.getBoundingClientRect();
          const deck = spine.closest(".deck").getBoundingClientRect();
          return { x: box.x - deck.x, y: box.y - deck.y, width: box.width, height: box.height };
        });
        await page.evaluate(() => document.body.classList.remove("pptx-artwork-mode", "pptx-layout-artwork-mode"));
        sourcePng = await page.locator(".deck").nth(4).screenshot();
        return rendered;
      },
    });
    const bytes = await readFile(output);
    expect(inspectPptxPackage(bytes).valid).toBe(true);
    const slides = [...bytes.toString("utf8").matchAll(/<p:sld\b[\s\S]*?<\/p:sld>/g)].map((match) => match[0]);
    let count = 0;
    for (let index = 1; index <= names.length; index++) {
      const model = rendered.model.slides[index];
      const objects = [...slides[index].matchAll(/<p:(sp|pic|cxnSp)>[\s\S]*?<\/p:\1>/g)];
      const expected = [...model.elements, ...model.fallbacks.filter((fallback) => fallback.artwork !== false)].sort((a, b) => a.zOrder - b.zOrder);
      expect(objects.map((object) => object[1])).toEqual(expected.map((element) => model.fallbacks.includes(element) ? "pic" : "sp"));
      for (const image of rendered.slideFallbackImages[index]) {
        const fallback = model.fallbacks[image.fallbackIndex];
        if (fallback.type !== "mermaid") continue;
        count++;
        expect(bytes.indexOf(image.data)).toBeGreaterThan(0);
        expect(bytes.indexOf(image.data, bytes.indexOf(image.data) + 1)).toBe(-1);
        expect(image.width).toBeGreaterThan(0);
        expect(image.height).toBeGreaterThan(0);
        expect(image.width).toBeLessThan(1280);
        expect(image.height).toBeLessThan(720);
        expect(model.elements.some((element) => element.path === fallback.path)).toBe(false);
        if (index === 1) {
          const masked = await page.evaluate(async ({ base64, fill }) => {
            const image = new Image();
            image.src = `data:image/png;base64,${base64}`;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext("2d");
            context.fillStyle = fill;
            context.fillRect(0, 0, 1, 1);
            const expected = [...context.getImageData(0, 0, 1, 1).data];
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(Math.floor(canvas.width * .2), Math.floor(canvas.height * .4),
              Math.floor(canvas.width * .4), Math.floor(canvas.height * .2)).data;
            let different = 0;
            for (let i = 0; i < pixels.length; i += 4) {
              if (expected.some((value, channel) => Math.abs(value - pixels[i + channel]) > 1)) different++;
            }
            return { different, pixels: pixels.length / 4 };
          }, { base64: image.data.toString("base64"), fill: headFill });
          expect(masked.pixels).toBeGreaterThan(10);
          expect(masked.different, "Local head artwork must exclude its native text and crossing spine").toBe(0);
        }
        if (index === 4 && image.fallbackIndex === counts[3] - 1) {
          expect(image.y).toBeLessThan(spineFrame.y - 1);
          expect(image.y + image.height).toBeGreaterThan(spineFrame.y + spineFrame.height + 1);
          const painted = await page.evaluate(async ({ source, artwork, frame, bounds }) => {
            const decode = async (base64) => {
              const image = new Image();
              image.src = `data:image/png;base64,${base64}`;
              await image.decode();
              return image;
            };
            const original = document.createElement("canvas");
            original.width = 1280; original.height = 720;
            const context = original.getContext("2d");
            context.drawImage(await decode(source), 0, 0);
            const background = [...context.getImageData(Math.floor(frame.x + 5), Math.floor(frame.y - 8), 1, 1).data];
            const composed = document.createElement("canvas");
            composed.width = 1280; composed.height = 720;
            const target = composed.getContext("2d");
            const raster = await decode(artwork);
            const energy = (context) => {
              const data = context.getImageData(Math.ceil(frame.x + frame.width * .05), Math.floor(frame.y - 4),
                Math.floor(frame.width * .25), Math.ceil(frame.height + 8)).data;
              let sum = 0;
              for (let i = 0; i < data.length; i += 4) for (let channel = 0; channel < 3; channel++) {
                sum += Math.abs(data[i + channel] - background[channel]);
              }
              return sum;
            };
            const paint = ({ cropped = false, copies = 1 } = {}) => {
              target.fillStyle = `rgb(${background.slice(0, 3).join(",")})`;
              target.fillRect(0, 0, 1280, 720);
              target.save();
              if (cropped) {
                // Reproduce geometry-only clipping that discards the rough path's stroke.
                target.beginPath();
                target.rect(bounds.x, frame.y, bounds.width, frame.height);
                target.clip();
              }
              for (let copy = 0; copy < copies; copy++) {
                target.drawImage(raster, bounds.x, bounds.y, bounds.width, bounds.height);
              }
              target.restore();
              return energy(target);
            };
            return { source: energy(context), actual: paint(), cropped: paint({ cropped: true }), doubled: paint({ copies: 2 }) };
          }, { source: sourcePng.toString("base64"), artwork: image.data.toString("base64"), frame: spineFrame, bounds: image });
          await test.info().attach("rough-spine-coverage", {
            body: JSON.stringify({ browser: chromium.executablePath(), frame: spineFrame,
              bounds: { x: image.x, y: image.y, width: image.width, height: image.height }, ...painted }, null, 2),
            contentType: "application/json",
          });
          expect(painted.source).toBeGreaterThan(100);
          expect(painted.actual / painted.source, "Rough spine stroke must not be cropped into a fading hairline").toBeGreaterThan(.9);
          expect(painted.actual / painted.source).toBeLessThan(1.1);
          expect(painted.cropped / painted.source, "The lower bound must reject geometry-only stroke clipping").toBeLessThan(.9);
          expect(painted.doubled / painted.source, "The upper bound must reject painting the same artwork twice").toBeGreaterThan(1.1);
        }
      }
    }
    expect(count).toBe(counts.reduce((a, b) => a + b));
    expect(slides[3]).not.toContain("<a:t>局所効果</a:t>");
    expect(slides[3]).not.toContain("<a:t>人材</a:t>");
    expect(slides[3].split("<a:t>Training</a:t>")).toHaveLength(2);
    expect(slides[4].split("<a:t>人材</a:t>")).toHaveLength(2);
    expect(rendered.model.slides[5].fallbacks.filter((fallback) => fallback.type === "mermaid")).toEqual([]);
    expect([...slides[5].matchAll(/prst="triangle"/g)]).toHaveLength(8);
  });
});
