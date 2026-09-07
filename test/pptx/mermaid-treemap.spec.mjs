import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, chromium } from "@playwright/test";
import { startHarness } from "../harness/server.mjs";
import { waitForSlideReady } from "../utils/ready.mjs";
import { validateScene } from "../../.github/extensions/markdstage/renderer/scene-graph.mjs";
import { sceneToPptxElements } from "../../.github/extensions/markdstage/renderer/scene-pptx.mjs";
import { buildPptxPackage, inspectPptxPackage } from "../../.github/extensions/markdstage/runtime/pptx-package.mjs";
import { withDeckServer } from "../../packages/markdstage-cli/src/deck.mjs";
import { exportPptx } from "../../.github/extensions/markdstage/runtime/output.mjs";
import { runPptxOutputBrowser } from "../../.github/extensions/markdstage/runtime/browser.mjs";

const names = ["treemap-basic", "treemap-overflow", "treemap-hybrid", "treemap-alpha"];
const fixture = (name, extension = "svg") => readFile(join(process.cwd(), "test", "fixtures", "mermaid", `${name}.${extension}`), "utf8");
const textOf = (node) => (node.text?.paragraphs || node.paragraphs || [])
  .map((paragraph) => paragraph.runs.map((run) => run.text).join("")).join("\n").trim();

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
    const sources = result.scene.nodes.map((node) => {
      const element = result.sourceElements.get(node.sourcePath);
      const bounds = element.getBoundingClientRect();
      return { path: node.sourcePath, tag: element.localName, class: element.getAttribute("class"),
        bounds: { x: bounds.x - origin.x, y: bounds.y - origin.y, width: bounds.width, height: bounds.height },
        text: element.textContent.trim() };
    });
    const native = result.scene.nodes.filter((node) => node.kind !== "fallback");
    const conflicts = result.scene.nodes.filter((node) => node.kind === "fallback").flatMap((fallback) =>
      native.filter((node) => {
        const a = result.sourceElements.get(node.sourcePath);
        const b = result.sourceElements.get(fallback.sourcePath);
        return a.contains(b) || b.contains(a);
      }));
    return { scene: result.scene, diagnostics: result.diagnostics, sources, conflicts,
      nativeSvg: result.diagnostics.length ? null : sceneToSvg(result.scene).outerHTML };
  });
}

test("pinned treemap keeps measured cells, sections, title and fitting clipped text native", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Treemap"] });
  try {
    await page.goto(harness.url);
    const result = await extract(page);
    validateScene(result.scene);
    expect(result.diagnostics).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "treemap-cell-box")).toHaveLength(4);
    expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "treemap-section-box")).toHaveLength(2);
    expect(result.scene.nodes.map(textOf)).toEqual(expect.arrayContaining(["Portfolio / 配分", "API", "運用", "Mobile", "70"]));
    for (const node of result.scene.nodes) {
      const source = result.sources.find((source) => source.path === node.sourcePath);
      for (const key of ["x", "y", "width", "height"]) {
        expect(Math.abs(node.bounds[key] - source.bounds[key]), `${source.path}.${key}`).toBeLessThanOrEqual(0.11);
      }
    }
    const mapped = sceneToPptxElements(result.scene);
    expect(mapped.fallbacks).toEqual([]);
    const bytes = buildPptxPackage({ slides: [{ elements: mapped.elements }] });
    expect(inspectPptxPackage(bytes).valid).toBe(true);
    const xml = bytes.toString("utf8");
    expect(xml).not.toContain("<a:blip");
    expect(xml).toContain('<a:alpha val="60000"/>');
    expect(xml).toContain('<a:alpha val="40000"/>');
    expect(xml).toContain('<a:alpha val="30000"/>');
    expect(result.nativeSvg).not.toContain("clip-path");
  } finally { await harness.close(); }
});

test("treemap retains independent alpha and individually measured multiline text at changed size/placement", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Treemap lines"] });
  try {
    await page.goto(harness.url);
    for (const scale of [0.5, 1.25]) {
      const result = await extract(page, names[0], (scale) => {
        const svg = document.querySelector("svg");
        svg.style.cssText = "width:640px;height:auto;margin-left:63px;margin-top:27px";
        const group = svg.querySelector(".treemapLeafGroup");
        group.setAttribute("transform", `translate(45,80) scale(${scale})`);
        group.querySelector("rect").style.cssText =
          "fill:rgba(10,20,30,.8);stroke:rgba(40,50,60,.6);stroke-width:3px;fill-opacity:.5;stroke-opacity:.25;opacity:.8";
        const text = group.querySelector(".treemapLabel");
        text.innerHTML = '<tspan x="180" y="100">日本語</tspan><tspan x="180" dy="1.4em">Second line</tspan>';
        text.style.fontSize = "20px";
      }, scale);
      expect(result.diagnostics).toEqual([]);
      const lines = result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "treemap-text-line");
      expect(lines.map(textOf)).toEqual(["日本語", "Second line"]);
      for (const line of lines) {
        const source = result.sources.find((source) => source.path === line.sourcePath);
        expect(source.tag).toBe("tspan");
        expect(line.text.paragraphs).toHaveLength(1);
        for (const key of ["x", "y", "width", "height"]) {
          expect(Math.abs(line.bounds[key] - source.bounds[key])).toBeLessThanOrEqual(0.11);
        }
      }
      expect(lines[1].bounds.y - lines[0].bounds.y).toBeCloseTo(28 * scale * 640 / 996, 0);
      const cell = result.scene.nodes.find((node) => node.meta?.mermaid?.kind === "treemap-cell-box");
      expect(cell.bounds.width).toBeCloseTo(375 * scale * 640 / 996, 0);
      const bytes = buildPptxPackage({ slides: [{ elements: sceneToPptxElements(result.scene).elements }] });
      const xml = bytes.toString("utf8");
      expect(xml).toContain('<a:alpha val="32000"/>');
      expect(xml).toContain('<a:alpha val="12000"/>');
      const objects = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((match) => match[0]);
      for (const line of lines) {
        const object = objects.find((object) => object.includes(`<a:t>${textOf(line)}</a:t>`));
        expect([...object.matchAll(/<a:p>/g)]).toHaveLength(1);
        const offset = /<a:off x="(-?\d+)" y="(-?\d+)"/.exec(object);
        expect(Number(offset[1]) / 9525).toBeCloseTo(line.bounds.x, 3);
        expect(Number(offset[2]) / 9525).toBeCloseTo(line.bounds.y, 3);
      }
      expect(result.nativeSvg).toContain('fill="rgba(10, 20, 30, 0.8)"');
      expect(result.nativeSvg).toContain('stroke="rgba(40, 50, 60, 0.6)"');
      expect(result.nativeSvg).toContain('opacity="0.8" fill-opacity="0.5" stroke-opacity="0.25"');
      expect(result.conflicts).toEqual([]);
    }
  } finally { await harness.close(); }
});

test("treemap overflow is only local text artwork and does not resurrect source-hidden small-cell labels", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Overflow"] });
  try {
    await page.goto(harness.url);
    const result = await extract(page, names[1]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].reason).toBe("mermaid-treemap-text-overflow");
    const fallback = result.scene.nodes.find((node) => node.kind === "fallback");
    expect(result.sources.find((source) => source.path === fallback.sourcePath).tag).toBe("text");
    expect(result.scene.nodes.map(textOf)).not.toContain("Hidden");
    expect(result.scene.nodes.map(textOf)).not.toContain("Tiny");
    expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "treemap-cell-box")).toHaveLength(5);
    expect(result.conflicts).toEqual([]);
  } finally { await harness.close(); }
});

test("treemap recognizes only its own plain rectangular text clips; no arbitrary clip optimization", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Clip guards"] });
  try {
    await page.goto(harness.url);
    for (const mutation of ["units", "path", "rounded", "translated", "scaled", "css-shift", "css-rounded",
      "width", "outside", "duplicate", "mask", "nested-clip", "hidden-clip", "clip-animation", "text-transform"]) {
      const result = await extract(page, names[0], (mutation) => {
        const svg = document.querySelector("svg");
        const group = svg.querySelector(".treemapLeafGroup");
        const clip = group.querySelector("clipPath");
        const rect = clip.querySelector("rect");
        const text = group.querySelector(".treemapLabel");
        if (mutation === "units") clip.setAttribute("clipPathUnits", "objectBoundingBox");
        if (mutation === "path") rect.outerHTML = '<path d="M0,0L100,0L100,100Z"/>';
        if (mutation === "rounded") rect.setAttribute("rx", "5");
        if (mutation === "translated") clip.setAttribute("transform", "translate(2,0)");
        if (mutation === "scaled") rect.setAttribute("transform", "scale(.5)");
        if (mutation === "css-shift") rect.style.x = "4px";
        if (mutation === "css-rounded") rect.style.rx = "2px";
        if (mutation === "width") rect.style.width = "100px";
        if (mutation === "outside") svg.append(clip);
        if (mutation === "duplicate") svg.append(clip.cloneNode(true));
        if (mutation === "mask") rect.style.maskImage = "linear-gradient(black,transparent)";
        if (mutation === "nested-clip") rect.style.clipPath = "inset(5px)";
        if (mutation === "hidden-clip") rect.style.display = "none";
        if (mutation === "clip-animation") rect.style.animationName = "unknown-animation";
        if (mutation === "text-transform") text.setAttribute("transform", "rotate(15)");
      }, mutation);
      const fallbacks = result.scene.nodes.filter((node) => node.kind === "fallback");
      expect(fallbacks, mutation).toHaveLength(mutation === "text-transform" ? 1 : 2);
      expect(fallbacks.every((node) => node.reason === "unsupported-mermaid-treemap-clip"), mutation).toBe(true);
      expect(fallbacks.every((node) => result.sources.find((source) => source.path === node.sourcePath).tag === "text")).toBe(true);
      expect(result.conflicts).toEqual([]);
    }
  } finally { await harness.close(); }
});

test("treemap effects, group clipping and unsafe text preserve the smallest safe source subtree", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Effects"] });
  try {
    await page.goto(harness.url);
    const hybrid = await extract(page, names[2]);
    expect(hybrid.diagnostics.map((entry) => entry.reason)).toEqual([
      "unsupported-mermaid-treemap-label", "unsupported-mermaid-treemap-style", "unsupported-mermaid-treemap-style",
    ]);
    expect(hybrid.scene.nodes.filter((node) => node.kind === "fallback").map((node) =>
      hybrid.sources.find((source) => source.path === node.sourcePath).tag)).toEqual(["text", "rect", "g"]);
    expect(hybrid.conflicts).toEqual([]);
    for (const mutation of ["group-clip", "group-filter", "group-opacity", "text-filter", "text-stroke", "text-mask",
      "text-spacing", "tspan-effect", "tspan-nested", "tspan-coordinate", "overflow", "unclipped-overflow"]) {
      const result = await extract(page, names[0], (mutation) => {
        const group = document.querySelector(".treemapLeafGroup");
        const text = group.querySelector(".treemapLabel");
        if (mutation === "group-clip") group.style.clipPath = "inset(4px)";
        if (mutation === "group-filter") group.style.filter = "blur(2px)";
        if (mutation === "group-opacity") group.style.opacity = ".4";
        if (mutation === "text-filter") text.style.filter = "blur(2px)";
        if (mutation === "text-stroke") text.style.stroke = "red";
        if (mutation === "text-mask") text.style.maskImage = "linear-gradient(black,transparent)";
        if (mutation === "text-spacing") text.style.letterSpacing = "5px";
        if (mutation.startsWith("tspan")) {
          text.innerHTML = '<tspan x="100" y="90">A</tspan><tspan x="100" dy="1em">B</tspan>';
          if (mutation === "tspan-effect") text.children[1].style.filter = "blur(2px)";
          if (mutation === "tspan-nested") text.children[1].innerHTML = "<tspan>B</tspan>";
          if (mutation === "tspan-coordinate") text.children[1].setAttribute("x", "10 20");
        }
        if (mutation.includes("overflow")) {
          text.textContent = "An overflowing label that must not become an unclipped native text box";
          if (mutation === "unclipped-overflow") text.removeAttribute("clip-path");
        }
      }, mutation);
      const fallbacks = result.scene.nodes.filter((node) => node.kind === "fallback");
      expect(fallbacks, mutation).toHaveLength(1);
      expect(result.sources.find((source) => source.path === fallbacks[0].sourcePath).tag)
        .toBe(mutation.startsWith("group") ? "g" : "text");
      expect(result.conflicts).toEqual([]);
    }
  } finally { await harness.close(); }
});

test("treemap unknown structures, transforms and limits stay diagnostic", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Limits"] });
  try {
    await page.goto(harness.url);
    for (const [mutation, reason] of [
      ["structure", "unsupported-mermaid-treemap-structure"],
      ["transform", "unsupported-mermaid-svg-transform"],
      ["unknown", "unsupported-mermaid-treemap-geometry"],
      ["deep", "unsupported-mermaid-treemap-geometry"],
      ["elements", "mermaid-scene-limit-exceeded: SVG element count"],
      ["nodes", "mermaid-scene-limit-exceeded"],
    ]) {
      const result = await extract(page, names[0], async (mutation) => {
        const { MAX_SCENE_NODES, MAX_GROUP_DEPTH } = await import("./renderer/scene-graph.mjs");
        const svg = document.querySelector("svg");
        const group = svg.querySelector(".treemapLeafGroup");
        if (mutation === "structure") svg.querySelector(".treemapContainer").classList.remove("treemapContainer");
        if (mutation === "transform") svg.style.transform = "skewX(10deg)";
        if (mutation === "unknown") {
          const path = document.createElementNS(svg.namespaceURI, "path");
          path.setAttribute("d", "M20,50L70,20L80,70Z");
          group.append(path);
        }
        if (mutation === "deep") {
          let parent = group;
          for (let i = 0; i < MAX_GROUP_DEPTH + 2; i++) {
            const next = document.createElementNS(svg.namespaceURI, "g");
            parent.append(next);
            parent = next;
          }
          parent.append(group.querySelector("rect").cloneNode());
        }
        if (["elements", "nodes"].includes(mutation)) {
          const fragment = document.createDocumentFragment();
          for (let i = 0; i < MAX_SCENE_NODES * (mutation === "elements" ? 10 : 1); i++) {
            fragment.append(mutation === "elements" ? document.createElementNS(svg.namespaceURI, "g") : group.querySelector("rect").cloneNode());
          }
          group.append(fragment);
        }
      }, mutation);
      expect(result.scene.nodes.filter((node) => node.kind === "fallback"), mutation).toHaveLength(1);
      expect(result.diagnostics[0].reason).toContain(reason);
      expect(result.conflicts).toEqual([]);
    }
  } finally { await harness.close(); }
});

test("group artwork bounds include visible transformed rectangle strokes, not clip definitions or hidden paint", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Group stroke"] });
  try {
    await page.goto(harness.url);
    for (const entry of [
      { scale: 0.5, rotation: 0, width: 8 },
      { scale: 1.25, rotation: 25, width: 8 },
      { scale: 0.5, rotation: 0, width: 8, vectorEffect: "non-scaling-stroke" },
      { scale: 1, rotation: 0, width: 0 },
    ]) {
      const result = await extract(page, names[0], (entry) => {
        const group = document.querySelector(".treemapLeafGroup");
        group.style.opacity = ".6";
        group.setAttribute("transform", `translate(45,80) scale(${entry.scale}) rotate(${entry.rotation})`);
        const rect = group.querySelector("rect");
        rect.style.strokeWidth = `${entry.width}px`;
        if (entry.vectorEffect) rect.style.vectorEffect = entry.vectorEffect;
        group.querySelector("clipPath rect").style.strokeWidth = "1000px";
        const hidden = rect.cloneNode();
        hidden.style.cssText = "stroke-width:1000px;display:none";
        group.append(hidden);
      }, entry);
      const fallback = result.scene.nodes.find((node) => node.kind === "fallback");
      expect(fallback.reason).toBe("unsupported-mermaid-treemap-style");
      const source = result.sources.find((source) => source.path === fallback.sourcePath);
      // Fixed source SVG is capped at its 996px viewBox width.
      const scale = entry.vectorEffect ? 1 : entry.scale;
      const expected = entry.width ? entry.width * scale / Math.SQRT2 + 1 : 0;
      expect(source.bounds.x - fallback.bounds.x).toBeCloseTo(expected, 0);
      expect(source.bounds.y - fallback.bounds.y).toBeCloseTo(expected, 0);
      expect(fallback.bounds.width - source.bounds.width).toBeCloseTo(expected * 2, 0);
      expect(fallback.bounds.height - source.bounds.height).toBeCloseTo(expected * 2, 0);
      expect(result.conflicts).toEqual([]);
    }
  } finally { await harness.close(); }
});

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  test(`real treemap aliases retain exact native masks and local text/cell/group artwork (${theme})`, async ({ page }) => {
    const sources = await Promise.all(names.map((name) => fixture(name, "mmd")));
    const harness = await startHarness({
      slides: sources.map((source) => `## Treemap\n\n\`\`\`mermaid\n${source}\n\`\`\``), theme,
      customThemeCss: theme === "custom" ? "--bg:#102030;--print-slide-bg:#102030;--topbar:#ff6600;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;" : "",
    });
    try {
      await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`);
      await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready") ||
        document.documentElement.hasAttribute("data-pptx-error"), undefined, { timeout: 120_000 });
      await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
      const model = await page.evaluate(() => window.__presentationPptxModel);
      expect(model.slides.map((slide) => slide.fallbacks.filter((item) => item.type === "mermaid").length)).toEqual([0, 1, 3, 0]);
      const svgs = page.locator("pre.mermaid > svg");
      await expect(svgs.nth(0).locator(".treemapLeaf[data-pptx-native=shape]")).toHaveCount(4);
      await expect(svgs.nth(0).locator(".treemapLabel[data-pptx-native=text]")).toHaveCount(4);
      await expect(svgs.nth(0).locator("clipPath[data-pptx-native]")).toHaveCount(0);
      await expect(svgs.nth(1).locator(".leaf1x .treemapLabel[data-pptx-fallback-ids]")).toHaveCount(1);
      await expect(svgs.nth(1).locator(".leaf1x .treemapLeaf[data-pptx-native=shape]")).toHaveCount(1);
      await expect(svgs.nth(2).locator(".leaf0x .treemapLabel[data-pptx-fallback-ids]")).toHaveCount(1);
      expect(await svgs.nth(2).locator(".leaf0x .treemapLabel").evaluate((element) =>
        getComputedStyle(element).textShadow)).toContain("2px");
      await expect(svgs.nth(2).locator(".leaf1x .treemapLeaf[data-pptx-fallback-ids]")).toHaveCount(1);
      await expect(svgs.nth(2).locator(".leaf2x[data-pptx-fallback-ids]")).toHaveCount(1);
      const ownership = await page.evaluate(() => [...document.querySelectorAll("pre.mermaid [data-pptx-fallback-ids]")].filter((fallback) =>
        fallback.hasAttribute("data-pptx-native") || fallback.closest("[data-pptx-native]") || fallback.querySelector("[data-pptx-native]")).length);
      expect(ownership).toBe(0);
      expect(model.slides[0].elements.map(textOf)).toContain("運用");
      const alphaXml = buildPptxPackage({ slides: [{ elements: model.slides[3].elements }] }).toString("utf8");
      expect(alphaXml).toContain('<a:alpha val="32000"/>');
      expect(alphaXml).toContain('<a:alpha val="12000"/>');
      const bounds = await svgs.nth(0).locator(".treemapLabel").evaluateAll((labels) => labels.map((label) => {
        const box = label.getBoundingClientRect();
        const deck = label.closest(".deck").getBoundingClientRect();
        return { text: label.textContent, x: box.x - deck.x, y: box.y - deck.y, width: box.width, height: box.height };
      }));
      for (const source of bounds) {
        const node = model.slides[0].elements.find((element) => textOf(element) === source.text);
        for (const key of ["x", "y", "width", "height"]) expect(Math.abs(node[key] - source[key])).toBeLessThanOrEqual(0.11);
      }
      await writeFile(test.info().outputPath(`${theme}-model.json`), JSON.stringify(model, null, 2));
    } finally { await harness.close(); }
  });

  test(`treemap source pixels survive scene reconstruction and serialization (${theme})`, async ({ page }) => {
    test.setTimeout(120_000);
    const sources = await Promise.all(names.map((name) => fixture(name, "mmd")));
    const harness = await startHarness({
      slides: sources.map((source) => `## Treemap\n\n\`\`\`mermaid\n${source}\n\`\`\``), theme,
      customThemeCss: theme === "custom" ? "--bg:#102030;--print-slide-bg:#102030;--topbar:#ff6600;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;" : "",
    });
    await page.addInitScript(() => {
      const replaceWith = Element.prototype.replaceWith;
      Element.prototype.replaceWith = function (...nodes) {
        if (this.localName === "svg" && nodes[0]?.getAttribute?.("data-scene-source") === "mermaid") {
          nodes[0].__originalMermaidSvg = this;
        }
        return replaceWith.apply(this, nodes);
      };
    });
    try {
      for (const index of names.keys()) {
        await page.request.post(`${harness.url}/navigate`, { data: { index } });
        await page.goto(`${harness.url}?present=1`);
        await waitForSlideReady(page);
        const svg = page.locator("svg[data-scene-source=mermaid]");
        const before = await svg.screenshot();
        await svg.evaluate((element) => {
          const original = element.__originalMermaidSvg;
          original.__sharedSceneSvg = element;
          element.replaceWith(original);
        });
        expect(await page.locator(".mermaid svg").screenshot(), names[index]).toEqual(before);
        await page.locator(".mermaid svg").evaluate((element) => element.replaceWith(element.__sharedSceneSvg));
        await svg.evaluate(async (element) => {
          const { sceneToSvg } = await import("./renderer/scene-svg.mjs");
          element.replaceWith(sceneToSvg(JSON.parse(JSON.stringify(element.__presentationScene))));
        });
        expect(await svg.screenshot(), names[index]).toEqual(before);
      }
    } finally { await harness.close(); }
  });
}

test("actual treemap PPTX embeds each local image once with native exclusions and original paint order", async ({ page }) => {
  test.setTimeout(120_000);
  const directory = test.info().outputPath();
  const sources = await Promise.all(names.map((name) => fixture(name, "mmd")));
  const file = join(directory, "slides.md");
  await writeFile(file, ["# Treemap hybrid", ...sources.map((source) => `## Treemap\n\n\`\`\`mermaid\n${source}\n\`\`\``)].join("\n\n---\n\n"));
  await withDeckServer({ file, workspace: directory, theme: "light" }, async (session) => {
    let rendered;
    let groupBounds;
    let sourcePng;
    const output = join(directory, "editable-hybrid.pptx");
    await exportPptx(session, output, "light", {
      findChromiumBrowser: () => chromium.executablePath(),
      runPptxOutputBrowser: async (...args) => {
        rendered = await runPptxOutputBrowser(...args);
        await page.goto(args[1]);
        await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready"));
        groupBounds = await page.locator(".deck").nth(3).locator(".leaf2x > rect").evaluate((rect) => {
          const bounds = rect.getBoundingClientRect();
          const deck = rect.closest(".deck").getBoundingClientRect();
          return { x: bounds.x - deck.x, y: bounds.y - deck.y, width: bounds.width, height: bounds.height };
        });
        await page.evaluate(() => document.body.classList.remove("pptx-artwork-mode", "pptx-layout-artwork-mode"));
        sourcePng = await page.locator(".deck").nth(3).screenshot();
        return rendered;
      },
    });
    const bytes = await readFile(output);
    expect(inspectPptxPackage(bytes).valid).toBe(true);
    const slides = [...bytes.toString("utf8").matchAll(/<p:sld\b[\s\S]*?<\/p:sld>/g)].map((match) => match[0]);
    let count = 0;
    for (const index of [1, 2, 3]) {
      const model = rendered.model.slides[index];
      const objects = [...slides[index].matchAll(/<p:(sp|pic|cxnSp)>[\s\S]*?<\/p:\1>/g)];
      const expected = [...model.elements, ...model.fallbacks.filter((fallback) => fallback.artwork !== false)]
        .sort((a, b) => a.zOrder - b.zOrder);
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
        if (index === 3 && image.fallbackIndex === 1) {
          // This padded cell-shadow capture overlaps the adjacent group fallback.
          // Its far-right padding must not contain that group's fill or label.
          const leakedPixels = await page.evaluate(async (base64) => {
            const image = new Image();
            image.src = `data:image/png;base64,${base64}`;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext("2d");
            context.drawImage(image, 0, 0);
            const data = context.getImageData(canvas.width - 8, Math.floor(canvas.height / 4),
              8, Math.floor(canvas.height / 2)).data;
            let count = 0;
            for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++;
            return count;
          }, image.data.toString("base64"));
          expect(leakedPixels).toBe(0);
        }
        if (index === 3 && image.fallbackIndex === 2) {
          expect(image.x).toBeLessThan(groupBounds.x - 1);
          expect(image.y).toBeLessThan(groupBounds.y - 1);
          expect(image.x + image.width).toBeGreaterThan(groupBounds.x + groupBounds.width + 1);
          expect(image.y + image.height).toBeGreaterThan(groupBounds.y + groupBounds.height + 1);
          const pixels = await page.evaluate(async ({ source, artwork, bounds, frame }) => {
            const decode = async (base64) => {
              const image = new Image();
              image.src = `data:image/png;base64,${base64}`;
              await image.decode();
              return image;
            };
            const original = document.createElement("canvas");
            original.width = 1280;
            original.height = 720;
            const context = original.getContext("2d");
            context.drawImage(await decode(source), 0, 0);
            const rgb = (context, x, y) => [...context.getImageData(x, y, 1, 1).data];
            const background = rgb(context, Math.floor(frame.x + frame.width / 2), Math.floor(frame.y - 5));
            const composed = document.createElement("canvas");
            composed.width = 1280;
            composed.height = 720;
            const target = composed.getContext("2d");
            target.fillStyle = `rgb(${background.slice(0, 3).join(",")})`;
            target.fillRect(0, 0, 1280, 720);
            // Use actual package placement and scaling, not a standalone PNG.
            target.drawImage(await decode(artwork), bounds.x, bounds.y, bounds.width, bounds.height);
            const points = [
              [Math.floor(frame.x + frame.width / 2), Math.floor(frame.y - 1)],
              [Math.floor(frame.x + frame.width), Math.floor(frame.y + frame.height / 4)],
              [Math.floor(frame.x + frame.width / 2), Math.ceil(frame.y + frame.height)],
              [Math.floor(frame.x - 1), Math.floor(frame.y + frame.height / 4)],
            ];
            return points.map(([x, y]) => ({ x, y, source: rgb(context, x, y), actual: rgb(target, x, y), background }));
          }, { source: sourcePng.toString("base64"), artwork: image.data.toString("base64"),
            bounds: image, frame: groupBounds });
          for (const pixel of pixels) {
            expect(pixel.source[0], JSON.stringify(pixel)).toBeLessThan(pixel.background[0] - 5);
            expect(Math.abs(pixel.actual[0] - pixel.source[0]), JSON.stringify(pixel)).toBeLessThanOrEqual(5);
          }
          await writeFile(join(directory, "group-outer-stroke-pixels.json"), JSON.stringify(pixels, null, 2));
        }
      }
    }
    expect(count).toBe(4);
    expect(slides[1]).toContain("<a:t>運用</a:t>");
    expect(slides[2]).not.toContain("Long Japanese");
    expect(slides[3]).not.toContain("<a:t>Label shadow</a:t>");
    expect(slides[3]).not.toContain("<a:t>Group alpha</a:t>");
    expect(slides[3].split("<a:t>Cell shadow</a:t>")).toHaveLength(2);
    expect(slides[3].split("<a:t>OK</a:t>")).toHaveLength(2);
  });
});
