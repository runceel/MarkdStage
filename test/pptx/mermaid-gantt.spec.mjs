import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, chromium } from "@playwright/test";
import { startHarness } from "../harness/server.mjs";
import { validateScene } from "../../.github/extensions/markdstage/renderer/scene-graph.mjs";
import { sceneToPptxElements } from "../../.github/extensions/markdstage/renderer/scene-pptx.mjs";
import { buildPptxPackage as buildPptxBytes, inspectPptxPackage } from "../../.github/extensions/markdstage/runtime/pptx-package.mjs";
import { withDeckServer } from "../../packages/markdstage-cli/src/deck.mjs";
import { exportPptx } from "../../.github/extensions/markdstage/runtime/output.mjs";
import { runPptxOutputBrowser } from "../../.github/extensions/markdstage/hosts/node/browser.mjs";

const buildPptxPackage = (model) => Buffer.from(buildPptxBytes(model));

const names = ["gantt-basic", "gantt-periods", "gantt-ticks", "gantt-hybrid", "gantt-milestone-hybrid"];
const fixture = (name, extension = "svg") => readFile(join(process.cwd(), "test", "fixtures", "mermaid", `${name}.${extension}`), "utf8");
const textOf = (node) => (node.text?.paragraphs || node.paragraphs || [])
  .map((paragraph) => paragraph.runs.map((run) => run.text).join("")).join("\n").trim();

async function extract(page, name = "gantt-basic", mutate, arg) {
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
      const local = element.getBBox();
      const center = new DOMPoint(local.x + local.width / 2, local.y + local.height / 2).matrixTransform(element.getScreenCTM());
      return { path: node.sourcePath, tag: element.localName, class: element.getAttribute("class"),
        bounds: { x: bounds.x - origin.x, y: bounds.y - origin.y, width: bounds.width, height: bounds.height },
        center: { x: center.x - origin.x, y: center.y - origin.y },
        text: element.textContent.trim() };
    });
    const native = result.scene.nodes.filter((node) => node.kind !== "fallback");
    const conflicts = result.scene.nodes.filter((node) => node.kind === "fallback")
      .flatMap((fallback) => native.filter((node) => {
        const a = result.sourceElements.get(node.sourcePath);
        const b = result.sourceElements.get(fallback.sourcePath);
        return a.contains(b) || b.contains(a);
      }));
    const nativeSvg = result.diagnostics.length ? null : sceneToSvg(result.scene).outerHTML;
    return { scene: result.scene, diagnostics: result.diagnostics, sources, conflicts, nativeSvg };
  });
}

for (const name of names.slice(0, 3)) {
  test(`pinned ${name} preserves native dates, tasks, rows, text and rounded milestone geometry`, async ({ page }) => {
    const harness = await startHarness({ slides: ["# Gantt"] });
    try {
      await page.goto(harness.url);
      const result = await extract(page, name);
      validateScene(result.scene);
      expect(result.diagnostics).toEqual([]);
      expect(result.conflicts).toEqual([]);
      const nodes = result.scene.nodes;
      expect(nodes.filter((node) => node.meta?.mermaid?.kind === "gantt-milestone")).toHaveLength(name === "gantt-ticks" ? 2 : 1);
      expect(nodes.filter((node) => node.meta?.mermaid?.kind === "gantt-row")).toHaveLength(name === "gantt-basic" ? 5 : 4);
      expect(nodes.some((node) => node.meta?.mermaid?.kind === "gantt-tick")).toBe(true);
      expect(nodes.map(textOf)).toContain(name === "gantt-basic" ? "Gate / 承認" : name === "gantt-periods" ? "Design" : "Build / 実装");
      if (name === "gantt-periods") expect(nodes.map(textOf)).toContain("設計");
      if (name === "gantt-periods") expect(nodes.filter((node) => node.meta?.mermaid?.kind === "gantt-excluded-period")).toHaveLength(2);
      if (name === "gantt-ticks") expect(nodes.filter((node) => node.kind === "text" && node.rotation === 25).length).toBeGreaterThan(0);
      for (const node of nodes) {
        const source = result.sources.find((entry) => entry.path === node.sourcePath);
        expect(source, node.sourcePath).toBeTruthy();
        if (node.rotation) {
          for (const key of ["x", "y"]) {
            const half = key === "x" ? node.bounds.width / 2 : node.bounds.height / 2;
            expect(Math.abs(node.bounds[key] + half - source.center[key])).toBeLessThanOrEqual(0.11);
          }
          expect(result.nativeSvg).toContain(`rotate(${node.rotation} `);
          if (node.kind === "shape") {
            expect(node.preset).toBe("roundedRect");
            expect(node.style.cornerRadius / node.bounds.width).toBeCloseTo(
              3 / (name === "gantt-periods" ? 26 : name === "gantt-ticks" ? 28 : 20), 2);
            expect(node.rotation).toBe(45);
          }
        } else if (node.bounds) {
          for (const key of ["x", "y", "width", "height"]) {
            expect(Math.abs(node.bounds[key] - source.bounds[key]), `${node.sourcePath}.${key}`).toBeLessThanOrEqual(0.11);
          }
        }
      }
      const mapped = sceneToPptxElements(result.scene);
      expect(mapped.fallbacks).toEqual([]);
      const bytes = buildPptxPackage({ slides: [{ elements: mapped.elements }] });
      expect(inspectPptxPackage(bytes).valid).toBe(true);
      const xml = bytes.toString("utf8");
      expect(xml).toContain('rot="2700000"');
      expect(xml).toContain('<a:prstGeom prst="roundRect">');
      expect(xml).toContain(`<a:gd name="adj" fmla="val ${Math.round(300000 /
        (name === "gantt-periods" ? 26 : name === "gantt-ticks" ? 28 : 20))}"/>`);
      expect(xml).not.toContain("<a:blip");
      if (name !== "gantt-ticks") expect(xml).toContain('<a:alpha val="80000"/>');
    } finally { await harness.close(); }
  });
}

test("Gantt uses SVG placement/scale, exact axis corners, multiline labels and independent paint alpha", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Gantt geometry"] });
  try {
    await page.goto(harness.url);
    for (const scale of [0.5, 1.25]) {
      const result = await extract(page, "gantt-basic", (scale) => {
        const svg = document.querySelector("svg");
        svg.style.cssText = "width:640px;height:auto;margin-left:63px;margin-top:27px";
        svg.querySelector("rect.milestone").parentElement.setAttribute("transform", `translate(17, 13) scale(${scale})`);
        svg.querySelector("rect.milestone").style.cssText =
          "fill:rgba(10,20,30,.8);stroke:rgba(40,50,60,.6);stroke-width:3px;fill-opacity:.5;stroke-opacity:.25;opacity:.8";
        svg.querySelector(".taskText").innerHTML = '<tspan x="100" dy="0">日本語</tspan><tspan x="100" dy="14">Second line</tspan>';
        svg.querySelector(".grid .domain").style.strokeWidth = "1px";
      }, scale);
      expect(result.diagnostics).toEqual([]);
      expect(result.scene.nodes.map(textOf)).toContain("日本語");
      expect(result.scene.nodes.map(textOf)).toContain("Second line");
      const milestone = result.scene.nodes.find((node) => node.meta?.mermaid?.kind === "gantt-milestone");
      const source = result.sources.find((entry) => entry.path === milestone.sourcePath);
      expect(milestone.bounds.width).toBeCloseTo(20 * 0.8 * 0.5 * scale, 1);
      expect(milestone.bounds.x + milestone.bounds.width / 2).toBeCloseTo(source.center.x, 0);
      expect(milestone.bounds.y + milestone.bounds.height / 2).toBeCloseTo(source.center.y, 0);
      expect(milestone.style.cornerRadius).toBeCloseTo(3 * 0.8 * 0.5 * scale, 1);
      const axis = result.scene.nodes.find((node) => node.meta?.mermaid?.kind === "gantt-axis-line");
      expect(axis.points).toHaveLength(4);
      expect(axis.points[0].x).toBe(axis.points[1].x);
      expect(axis.points[1].y).toBe(axis.points[2].y);
      expect(axis.points[2].x).toBe(axis.points[3].x);
      expect(axis.points[0].y).toBe(axis.points[3].y);
      const bytes = buildPptxPackage({ slides: [{ elements: sceneToPptxElements(result.scene).elements }] });
      expect(bytes.toString("utf8")).toContain('<a:alpha val="32000"/>');
      expect(bytes.toString("utf8")).toContain('<a:alpha val="12000"/>');
    }
  } finally { await harness.close(); }
});

test("Gantt multiline text preserves each rendered line's advance, bounds and independent ownership", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Gantt line positions"] });
  try {
    await page.goto(harness.url);
    for (const entry of [
      { scale: 1, advance: "1em", rotation: 0 },
      { scale: 0.5, advance: "18px", rotation: 0 },
      { scale: 1.25, advance: "0.8em", rotation: 25 },
    ]) {
      const result = await extract(page, "gantt-periods", ({ scale, advance, rotation }) => {
        const svg = document.querySelector("svg");
        svg.style.cssText = "width:640px;height:auto;margin-left:63px;margin-top:27px";
        const label = svg.querySelector(".sectionTitle");
        label.parentElement.setAttribute("transform", `translate(17,13) scale(${scale})`);
        label.setAttribute("transform", `rotate(${rotation} 10 80)`);
        label.children[1].setAttribute("dy", advance);
      }, entry);
      expect(result.diagnostics).toEqual([]);
      const lines = result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "gantt-text-line");
      expect(lines).toHaveLength(4);
      expect(lines.map(textOf)).toEqual(["設計", "Design", "開発", "Build"]);
      for (const line of lines) {
        expect(line.text.paragraphs).toHaveLength(1);
        const source = result.sources.find((source) => source.path === line.sourcePath);
        expect(source.tag).toBe("tspan");
        expect(source.text).toBe(textOf(line));
        if (!line.rotation) {
          for (const key of ["x", "y", "width", "height"]) {
            expect(Math.abs(line.bounds[key] - source.bounds[key])).toBeLessThanOrEqual(0.11);
          }
        } else {
          expect(line.rotation).toBe(entry.rotation);
          expect(line.bounds.x + line.bounds.width / 2).toBeCloseTo(source.center.x, 0);
          expect(line.bounds.y + line.bounds.height / 2).toBeCloseTo(source.center.y, 0);
        }
      }
      const [first, second] = lines;
      const sourceFirst = result.sources.find((source) => source.path === first.sourcePath);
      const sourceSecond = result.sources.find((source) => source.path === second.sourcePath);
      if (!first.rotation) {
        expect(Math.abs((second.bounds.y - first.bounds.y) -
          (sourceSecond.bounds.y - sourceFirst.bounds.y))).toBeLessThanOrEqual(0.11);
      } else {
        expect((second.bounds.y + second.bounds.height / 2) - (first.bounds.y + first.bounds.height / 2))
          .toBeCloseTo(sourceSecond.center.y - sourceFirst.center.y, 0);
      }
      const mapped = sceneToPptxElements(result.scene);
      const bytes = buildPptxPackage({ slides: [{ elements: mapped.elements }] });
      const xml = bytes.toString("utf8");
      const objects = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((match) => match[0]);
      for (const line of lines) {
        const object = objects.find((object) => object.includes(`<a:t>${textOf(line)}</a:t>`));
        expect(object).toBeTruthy();
        expect([...object.matchAll(/<a:p>/g)]).toHaveLength(1);
        const offset = /<a:off x="(-?\d+)" y="(-?\d+)"/.exec(object);
        expect(Number(offset[1]) / 9525).toBeCloseTo(line.bounds.x, 3);
        expect(Number(offset[2]) / 9525).toBeCloseTo(line.bounds.y, 3);
      }
      expect(result.conflicts).toEqual([]);
    }
    for (const mutation of ["nested", "inline", "per-glyph", "effect"]) {
      const result = await extract(page, "gantt-periods", (mutation) => {
        const label = document.querySelector(".sectionTitle");
        if (mutation === "nested") label.children[1].innerHTML = "<tspan>Design</tspan>";
        if (mutation === "inline") label.prepend(document.createTextNode("Inline"));
        if (mutation === "per-glyph") label.children[1].setAttribute("x", "10 20");
        if (mutation === "effect") label.children[1].style.filter = "blur(2px)";
      }, mutation);
      expect(result.scene.nodes.filter((node) => node.kind === "fallback")).toHaveLength(1);
      expect(result.scene.nodes.filter((node) => node.meta?.mermaid?.kind === "gantt-text-line").map(textOf)).toEqual(["開発", "Build"]);
      expect(result.conflicts).toEqual([]);
    }
  } finally { await harness.close(); }
});

test("Gantt guards unknown milestone transforms, effects and uncertain tick overlap locally", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Gantt fallbacks"] });
  try {
    await page.goto(harness.url);
    for (const entry of [
      { selector: "rect.milestone", style: "transform:rotate(30deg) scale(.8)", reason: "transform" },
      { selector: "rect.milestone", style: "transform:rotate(45deg) scale(1)", reason: "transform" },
      { selector: "rect.milestone", style: "transform-origin:0 0", reason: "transform" },
      { selector: "rect.milestone", style: "transform:rotate(45deg) scale(.8);translate:5px", reason: "transform" },
      { selector: "rect.milestone", style: "transform:skewX(15deg)", reason: "transform" },
      { selector: "rect.milestone", style: "transform:scaleX(-1)", reason: "transform" },
      { selector: "rect.milestone", style: "transform:rotateX(45deg)", reason: "transform" },
      { selector: "rect.milestone", style: "width:40px", reason: "transform" },
      { selector: "rect.milestone", style: "x:50%", reason: "transform" },
      { selector: "rect.milestone", style: "rx:10%;ry:10%", reason: "transform" },
      { selector: "rect.milestone", style: "rx:2px;ry:5px", reason: "transform" },
      { selector: "rect.milestone", style: "filter:blur(2px)", reason: "style" },
      { selector: "rect.active0", style: "transform:rotate(45deg) scale(.8)", reason: "transform" },
      { selector: "rect.active0", style: "clip-path:inset(2px)", reason: "style" },
      { selector: "rect.active0", style: "fill:url(#gradient)", reason: "style" },
      { selector: ".taskText", style: "text-decoration:underline", reason: "label" },
      { selector: ".sectionTitle", style: "letter-spacing:2px", reason: "label" },
      { selector: ".grid .tick", style: "filter:blur(2px)", reason: "style" },
      { selector: ".grid .tick line", style: "stroke-width:30px", reason: "style", parent: true },
      { selector: ".grid .tick text", style: "transform:translateY(-10px)", reason: "style", parent: true },
      { selector: ".grid .tick text", style: "stroke:red;stroke-width:3px", reason: "style", parent: true },
    ]) {
      const result = await extract(page, "gantt-basic", ({ selector, style }) => {
        document.querySelector(selector).setAttribute("style", style);
      }, entry);
      const fallbacks = result.scene.nodes.filter((node) => node.kind === "fallback");
      expect(fallbacks, JSON.stringify(entry)).toHaveLength(1);
      expect(fallbacks[0].reason).toBe(`unsupported-mermaid-gantt-${entry.reason}`);
      expect(fallbacks[0].sourcePath).not.toBe("svg");
      const source = result.sources.find((item) => item.path === fallbacks[0].sourcePath);
      if (entry.parent) expect(source.class).toBe("tick");
      expect(fallbacks[0].bounds.width).toBeGreaterThan(0);
      expect(fallbacks[0].bounds.height).toBeGreaterThan(0);
      expect(result.diagnostics).toContainEqual({ path: fallbacks[0].sourcePath, reason: fallbacks[0].reason, kind: "fallback" });
      expect(result.conflicts).toEqual([]);
      expect(result.scene.nodes.map(textOf)).toContain("Release");
      expect(sceneToPptxElements(result.scene).fallbacks).toHaveLength(1);
    }
    const subtree = await extract(page, "gantt-basic", () => {
      document.querySelector("rect.task").parentElement.style.opacity = ".5";
    });
    expect(subtree.diagnostics).toHaveLength(1);
    expect(subtree.conflicts).toEqual([]);
    expect(subtree.scene.nodes.some((node) => node.meta?.mermaid?.kind === "gantt-row")).toBe(true);
    expect(subtree.scene.nodes.map(textOf)).toContain("Delivery / リリース");
    const nestedTransform = await extract(page, "gantt-basic", () => {
      document.querySelector("rect.task").parentElement.setAttribute("transform", "rotate(15)");
    });
    expect(nestedTransform.diagnostics).toHaveLength(1);
    expect(nestedTransform.diagnostics[0].reason).toBe("unsupported-mermaid-gantt-transform");
    expect(nestedTransform.conflicts).toEqual([]);
    const inheritedTransform = await extract(page, "gantt-basic", () => {
      document.querySelector("rect.milestone").setAttribute("transform", "translate(1, 2)");
    });
    expect(inheritedTransform.diagnostics).toHaveLength(1);
    expect(inheritedTransform.diagnostics[0].reason).toBe("unsupported-mermaid-gantt-transform");
  } finally { await harness.close(); }
});

test("Gantt keeps structure and global limits and preserves unexpected paths or local axis edits", async ({ page }) => {
  test.setTimeout(120_000);
  const harness = await startHarness({ slides: ["# Gantt bounds"] });
  try {
    await page.goto(harness.url);
    for (const [mutation, reason] of [
      ["structure", "unsupported-mermaid-gantt-structure"],
      ["transform", "unsupported-mermaid-svg-transform"],
      ["geometry", "unsupported-mermaid-gantt-geometry"],
      ["unknown", "unsupported-mermaid-gantt-geometry"],
      ["deep", "unsupported-mermaid-gantt-geometry"],
      ["elements", "mermaid-scene-limit-exceeded: SVG element count"],
      ["nodes", "mermaid-scene-limit-exceeded"],
    ]) {
      const result = await extract(page, "gantt-basic", async (mutation) => {
        const { MAX_SCENE_NODES, MAX_GROUP_DEPTH } = await import("./renderer/scene-graph.mjs");
        const svg = document.querySelector("svg");
        if (mutation === "structure") svg.querySelector(".grid").classList.remove("grid");
        if (mutation === "transform") svg.style.transform = "skewX(10deg)";
        if (mutation === "geometry") {
          const axis = svg.querySelector(".domain");
          axis.style.strokeWidth = "1px";
          axis.setAttribute("d", "M0,0C1,1,2,2,3,3Z");
        }
        if (mutation === "unknown") {
          const path = document.createElementNS(svg.namespaceURI, "path");
          path.setAttribute("d", "M40,50L70,20L80,70Z");
          svg.querySelector("rect.task").parentElement.append(path);
        }
        if (mutation === "deep") {
          let parent = svg;
          for (let i = 0; i < MAX_GROUP_DEPTH + 2; i++) {
            const group = document.createElementNS(svg.namespaceURI, "g");
            parent.append(group);
            parent = group;
          }
          parent.append(svg.querySelector("rect.task").cloneNode());
        }
        if (["elements", "nodes"].includes(mutation)) {
          const parent = svg.querySelector("rect.task").parentElement;
          const template = parent.querySelector("rect.task");
          const fragment = document.createDocumentFragment();
          for (let i = 0; i < MAX_SCENE_NODES * (mutation === "elements" ? 10 : 1); i++) {
            fragment.append(mutation === "elements" ? document.createElementNS(svg.namespaceURI, "g") : template.cloneNode());
          }
          parent.append(fragment);
        }
      }, mutation);
      expect(result.scene.nodes.filter((node) => node.kind === "fallback")).toHaveLength(1);
      expect(result.diagnostics[0].reason).toContain(reason);
      expect(result.conflicts).toEqual([]);
    }
  } finally { await harness.close(); }
});

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  test(`real Gantt renderer masks exactly native tasks, milestones, labels and ticks (${theme})`, async ({ page }) => {
    const sources = await Promise.all(names.map((name) => fixture(name, "mmd")));
    const harness = await startHarness({
      slides: sources.map((source) => `## Gantt\n\n\`\`\`mermaid\n${source}\n\`\`\``), theme,
      customThemeCss: theme === "custom" ? "--bg:#102030;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;" : "",
    });
    try {
      await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`);
      await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready") ||
        document.documentElement.hasAttribute("data-pptx-error"), undefined, { timeout: 120_000 });
      await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
      const model = await page.evaluate(() => window.__presentationPptxModel);
      expect(model.slides.map((slide) => slide.fallbacks.filter((item) => item.type === "mermaid").length)).toEqual([0, 0, 0, 1, 2]);
      const svgs = page.locator("pre.mermaid > svg");
      await expect(svgs.nth(0).locator("rect.task[data-pptx-native=shape]")).toHaveCount(5);
      await expect(svgs.nth(0).locator("rect.milestone[data-pptx-native=shape]")).toHaveCount(1);
      await expect(svgs.nth(0).locator(".tick text[data-pptx-native=text]")).toHaveCount(8);
      await expect(svgs.nth(0).locator(".tick line[data-pptx-native=connector]")).toHaveCount(8);
      await expect(svgs.nth(3).locator("rect.active0[data-pptx-fallback-ids]")).toHaveCount(1);
      await expect(svgs.nth(3).locator(".taskText[data-pptx-native=text]")).toHaveCount(4);
      await expect(svgs.nth(4).locator("rect.milestone[data-pptx-fallback-ids]")).toHaveCount(1);
      await expect(svgs.nth(4).locator(".sectionTitle0[data-pptx-fallback-ids]")).toHaveCount(1);
      const ownership = await page.evaluate(() => [...document.querySelectorAll("pre.mermaid [data-pptx-fallback-ids]")].filter((fallback) =>
        fallback.hasAttribute("data-pptx-native") || fallback.closest("[data-pptx-native]") || fallback.querySelector("[data-pptx-native]")).length);
      expect(ownership).toBe(0);
      expect(model.slides[0].elements.map(textOf)).toContain("Gate / 承認");
      const lineBounds = await svgs.nth(1).locator(".sectionTitle tspan").evaluateAll((spans) => spans.map((span) => {
        const box = span.getBoundingClientRect();
        const deck = span.closest(".deck").getBoundingClientRect();
        return { text: span.textContent, x: box.x - deck.x, y: box.y - deck.y,
          width: box.width, height: box.height, native: span.getAttribute("data-pptx-native") };
      }));
      expect(lineBounds).toHaveLength(4);
      for (const source of lineBounds) {
        expect(source.native).toBe("text");
        const line = model.slides[1].elements.filter((element) => textOf(element) === source.text);
        expect(line).toHaveLength(1);
        expect(line[0].paragraphs).toHaveLength(1);
        for (const key of ["x", "y", "width", "height"]) {
          expect(Math.abs(line[0][key] - source[key])).toBeLessThanOrEqual(0.11);
        }
      }
      const first = model.slides[1].elements.find((element) => textOf(element) === "設計");
      const second = model.slides[1].elements.find((element) => textOf(element) === "Design");
      expect(second.y - first.y).toBeCloseTo(11, 1);
      await writeFile(test.info().outputPath(`${theme}-model.json`), JSON.stringify(model, null, 2));
    } finally { await harness.close(); }
  });
}

test("real top-axis tick groups retain local images when their painted extents may overlap", async ({ page }) => {
  const source = `%%{init: {"gantt": {"topAxis": true}}}%%\n${await fixture("gantt-basic", "mmd")}`;
  const harness = await startHarness({ slides: [`## Top axis\n\n\`\`\`mermaid\n${source}\n\`\`\``] });
  try {
    await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`);
    await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready"));
    const model = await page.evaluate(() => window.__presentationPptxModel);
    const fallbacks = model.slides[0].fallbacks.filter((f) => f.type === "mermaid");
    expect(fallbacks).toHaveLength(8);
    expect(fallbacks.every((f) => f.reason === "unsupported-mermaid-gantt-style")).toBe(true);
    await expect(page.locator("pre.mermaid .grid").nth(0).locator("text[data-pptx-native=text]")).toHaveCount(8);
    await expect(page.locator("pre.mermaid .grid").nth(1).locator(".tick[data-pptx-fallback-ids]")).toHaveCount(8);
    await expect(page.locator("rect.milestone[data-pptx-native=shape]")).toHaveCount(1);
  } finally { await harness.close(); }
});

test("actual Gantt PPTX packages each local fallback once in native SVG paint order", async () => {
  test.setTimeout(120_000);
  const directory = test.info().outputPath();
  const sources = await Promise.all([...names.slice(3), "gantt-periods"].map((name) => fixture(name, "mmd")));
  const file = join(directory, "slides.md");
  await writeFile(file, ["# Gantt hybrid", ...sources.map((source) => `## Gantt\n\n\`\`\`mermaid\n${source}\n\`\`\``)].join("\n\n---\n\n"));
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
    const slides = [...xml.matchAll(/<p:sld\b[\s\S]*?<\/p:sld>/g)].map((match) => match[0]);
    let count = 0;
    for (const index of [1, 2]) {
      const model = rendered.model.slides[index];
      const objects = [...slides[index].matchAll(/<p:(sp|pic|cxnSp)>[\s\S]*?<\/p:\1>/g)];
      const expected = [...model.elements, ...model.fallbacks.filter((f) => f.type === "mermaid")].sort((a, b) => a.zOrder - b.zOrder);
      // A native connector can use several editable line segments. Compare
      // fallback placement against neighboring native task/label objects.
      const pictures = objects.filter((match) => match[1] === "pic" && match[0].includes('name="mermaid artwork"'));
      expect(pictures).toHaveLength(index === 1 ? 1 : 2);
      for (const image of rendered.slideFallbackImages[index]) {
        const fallback = model.fallbacks[image.fallbackIndex];
        if (fallback.type !== "mermaid") continue;
        count++;
        expect(bytes.indexOf(image.data)).toBeGreaterThan(0);
        expect(bytes.indexOf(image.data, bytes.indexOf(image.data) + 1)).toBe(-1);
        expect(image.width).toBeGreaterThan(0);
        expect(image.height).toBeGreaterThan(0);
        const order = expected.indexOf(fallback);
        expect(expected[order - 1].type).toBe(fallback.reason.endsWith("-label") ? "text" : "shape");
        expect(expected[order + 1].type).toMatch(/shape|text/);
        expect(model.elements.some((element) => element.path === fallback.path)).toBe(false);
      }
    }
    expect(count).toBe(3);
    expect(slides[1].split("<a:t>Shadow / 影</a:t>")).toHaveLength(2);
    expect(slides[2]).not.toContain("<a:t>Unsafe label / 装飾</a:t>");
    expect(slides[2].split("<a:t>Unusual milestone</a:t>")).toHaveLength(2);
    expect(slides[1]).toContain('rot="2700000"');
    const shapeOrder = [...slides[1].matchAll(/<p:(sp|pic|cxnSp)>[\s\S]*?<\/p:\1>/g)];
    const imageIndex = shapeOrder.findIndex((match) => match[1] === "pic" && match[0].includes('name="mermaid artwork"'));
    expect(shapeOrder[imageIndex - 1][0]).toContain('<a:prstGeom prst="roundRect">');
    expect(shapeOrder[imageIndex + 1][0]).toContain('rot="2700000"');
    const multilineObjects = [...slides[3].matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((match) => match[0]);
    const lineY = (label) => {
      const objects = multilineObjects.filter((object) => object.includes(`<a:t>${label}</a:t>`));
      expect(objects).toHaveLength(1);
      expect([...objects[0].matchAll(/<a:p>/g)]).toHaveLength(1);
      return Number(/<a:off x="-?\d+" y="(-?\d+)"/.exec(objects[0])[1]) / 9525;
    };
    expect(lineY("Design") - lineY("設計")).toBeCloseTo(11, 3);
    expect(lineY("Build") - lineY("開発")).toBeCloseTo(11, 3);
  });
});
