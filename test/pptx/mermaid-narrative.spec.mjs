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

const names = ["mindmap-basic", "mindmap-hybrid", "timeline-basic", "timeline-hybrid", "journey-basic", "journey-hybrid"];
const counts = [0, 2, 0, 6, 0, 2];
const customThemeCss = "--bg:#102030;--print-slide-bg:#102030;--topbar:#ff6600;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;";
const fixture = (name, extension = "svg") => readFile(join(process.cwd(), "test", "fixtures", "mermaid", `${name}.${extension}`), "utf8");
const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children || [])]);
const textOf = (node) => (node.text?.paragraphs || node.paragraphs || [])
  .map((paragraph) => paragraph.runs.map((run) => run.text).join("")).join("\n").trim();
// Actual export uses full Chromium, not Playwright's default headless shell.
const runtimeTest = test.extend({ launchOptions: { executablePath: chromium.executablePath(),
  args: ["--disable-gpu", "--force-color-profile=srgb", "--force-device-scale-factor=1",
    "--hide-scrollbars", "--run-all-compositor-stages-before-draw"] } });

async function extract(page, name, mutate, arg) {
  await page.evaluate((svg) => {
    document.body.innerHTML = `<div id="fixture-deck" style="position:relative;width:1280px;height:720px">${svg}</div>`;
  }, await fixture(name));
  if (mutate) await page.evaluate(mutate, arg);
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
      const matrix = element.getScreenCTM();
      const point = (x, y) => {
        const p = new DOMPoint(x, y).matrixTransform(matrix);
        return { x: p.x - origin.x, y: p.y - origin.y };
      };
      return { path: node.sourcePath, tag: element.localName, class: element.getAttribute("class"),
        text: element.textContent, scale: matrix.a,
        bounds: { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height },
        ...(element.localName === "switch" ? (() => {
          const range = document.createRange();
          range.selectNodeContents(element.querySelector("div.label"));
          const line = range.getBoundingClientRect();
          return { lineBounds: { x: line.x - origin.x, y: line.y - origin.y, width: line.width, height: line.height } };
        })() : {}),
        ...(element.localName === "line" ? {
          start: point(element.x1.baseVal.value, element.y1.baseVal.value),
          end: point(element.x2.baseVal.value, element.y2.baseVal.value),
          strokeWidth: Number.parseFloat(getComputedStyle(element).strokeWidth),
        } : {}) };
    });
    const conflicts = nodes.filter((node) => node.kind === "fallback").flatMap((fallback) =>
      nodes.filter((node) => node.kind !== "fallback" && node.kind !== "group").filter((node) => {
        const a = result.sourceElements.get(node.sourcePath);
        const b = result.sourceElements.get(fallback.sourcePath);
        return a && b && (a.contains(b) || b.contains(a));
      }).map((node) => node.sourcePath));
    return { scene: result.scene, diagnostics: result.diagnostics, sources, conflicts };
  });
}

test("pinned basic narratives keep known nodes, cards, people, branches and visible text editable", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Narrative fixtures"] });
  try {
    await page.goto(harness.url);
    for (const [index, name] of names.entries()) {
      const result = await extract(page, name);
      validateScene(result.scene);
      expect(result.diagnostics, name).toHaveLength(counts[index]);
      expect(result.conflicts, name).toEqual([]);
      const nodes = flatten(result.scene.nodes);
      expect(nodes.filter((node) => node.kind === "connector").length).toBeGreaterThan(2);
      expect(nodes.filter((node) => node.kind === "text").length).toBeGreaterThan(2);
      expect(nodes.filter((node) => node.kind === "shape").length).toBeGreaterThan(1);
      const mapped = sceneToPptxElements(result.scene);
      const bytes = buildPptxPackage({ slides: [{ elements: mapped.elements }] });
      expect(inspectPptxPackage(bytes).valid).toBe(true);
      const xml = bytes.toString("utf8");
      if (name === "mindmap-basic") {
        expect(nodes.map(textOf)).toEqual(expect.arrayContaining(["計画", "設計\nDesign", "検証"]));
        expect(nodes.some((node) => node.preset === "quarterHeightHexagon")).toBe(true);
        expect(xml).toContain('fmla="*/ h 1 4"');
      }
      if (name === "timeline-basic") {
        expect(nodes.filter((node) => node.preset === "topRoundedRect")).toHaveLength(8);
        expect(nodes.map(textOf)).toEqual(expect.arrayContaining(["設計とレビュー", "Design review", "implementation"]));
        expect([...xml.matchAll(/<a:quadBezTo>/g)]).toHaveLength(16);
      }
      if (name.startsWith("journey")) {
        for (const label of ["開始", "準備 Prepare", "確認", "完了", "公開"]) {
          expect(nodes.filter((node) => textOf(node) === label), label).toHaveLength(1);
        }
        expect(nodes.filter((node) => node.meta?.mermaid?.kind === "journey-person")).toHaveLength(6);
        expect(nodes.filter((node) => node.meta?.mermaid?.kind === "journey-eye")).toHaveLength(6);
      }
    }
  } finally { await harness.close(); }
});

test("narrative SVG scale, position, top corners and measured marker offsets survive mapping", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Scaled geometry"] });
  try {
    await page.goto(harness.url);
    for (const name of names.filter((name) => name.endsWith("basic"))) {
      for (const width of [480, 960]) {
        const result = await extract(page, name, (width) => {
          document.querySelector("svg").style.cssText = `width:${width}px;height:auto;margin-left:47px;margin-top:31px`;
        }, width);
        expect(result.diagnostics).toEqual([]);
        const nodes = flatten(result.scene.nodes);
        for (const node of nodes.filter((node) => node.kind === "shape" && !node.sourcePath.endsWith(".arrow"))) {
          const source = result.sources.find((source) => source.path === node.sourcePath);
          for (const key of ["x", "y", "width", "height"]) {
            expect(Math.abs(node.bounds[key] - source.bounds[key]), `${name} ${key}`).toBeLessThanOrEqual(.11);
          }
          if (node.preset === "topRoundedRect") expect(node.style.cornerRadius).toBeCloseTo(5 * source.scale, 0);
        }
        for (const node of nodes.filter((node) => node.meta?.mermaid?.kind === "journey-label")) {
          const source = result.sources.find((source) => source.path === node.sourcePath);
          for (const key of ["x", "y", "width", "height"]) {
            expect(Math.abs(node.bounds[key] - source.lineBounds[key]), `journey rendered text ${key}`).toBeLessThanOrEqual(.11);
          }
          expect(node.bounds.height).toBeLessThan(source.bounds.height);
          expect(node.textLayout.verticalAlignment).toBe("top");
        }
        for (const group of result.scene.nodes.filter((node) => node.meta?.mermaid?.kind.endsWith("marked-line"))) {
          const arrow = nodes.find((node) => node.sourcePath === `${group.sourcePath}.arrow`);
          const source = result.sources.find((source) => source.path === group.sourcePath);
          const unit = source.strokeWidth * source.scale;
          const angle = arrow.rotation * Math.PI / 180;
          const tip = { x: arrow.bounds.x + arrow.bounds.width / 2 + Math.sin(angle) * arrow.bounds.height / 2,
            y: arrow.bounds.y + arrow.bounds.height / 2 - Math.cos(angle) * arrow.bounds.height / 2 };
          const direction = Math.atan2(source.end.y - source.start.y, source.end.x - source.start.x);
          expect(arrow.bounds.width).toBeCloseTo(4 * unit, 0);
          expect(arrow.bounds.height).toBeCloseTo(6 * unit, 0);
          expect(tip.x).toBeCloseTo(source.end.x + Math.cos(direction) * unit, 0);
          expect(tip.y).toBeCloseTo(source.end.y + Math.sin(direction) * unit, 0);
        }
      }
    }
  } finally { await harness.close(); }
});

test("unknown shapes, icons, filled branches, effects, marker mutations and unsafe labels remain local", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Local guard coverage"] });
  try {
    await page.goto(harness.url);
    for (const [name, mutations] of [
      ["mindmap-basic", ["card-geometry", "node-opacity", "branch-fill", "icon", "label-effect", "skew"]],
      ["timeline-basic", ["card-geometry", "node-opacity", "marker-geometry", "marker-size", "marker-css-d", "marker-transform", "marker-opacity", "label-effect", "skew"]],
      ["journey-basic", ["node-opacity", "marker-geometry", "switch-condition", "label-effect", "label-wrap", "label-transform", "skew"]],
    ]) {
      for (const mutation of mutations) {
        const result = await extract(page, name, ({ mutation, name }) => {
          const svg = document.querySelector("svg");
          const container = svg.querySelector(".mindmap-node, .timeline-node") || svg.querySelector("rect.task").parentElement;
          if (mutation === "card-geometry") svg.querySelector("path.node-bkg").setAttribute("d", "M0,0L30,0L10,40Z");
          if (mutation === "node-opacity") container.style.opacity = ".5";
          if (mutation === "branch-fill") svg.querySelector(".edge").style.fill = "red";
          if (mutation === "icon") {
            const label = container.querySelector("g.label");
            const image = document.createElementNS(svg.namespaceURI, "image");
            image.setAttribute("width", "20"); image.setAttribute("height", "20");
            image.setAttribute("href", "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='20' height='20' fill='red'/%3E%3C/svg%3E");
            label.append(image);
          }
          if (mutation === "label-effect") (svg.querySelector(".label") || svg.querySelector("text")).style.filter = "blur(1px)";
          if (mutation === "skew") container.setAttribute("transform", "skewX(20)");
          const marker = svg.querySelector("marker");
          if (mutation === "marker-geometry") marker.firstElementChild.setAttribute("d", "M0 0L6 4L0 2Z");
          if (mutation === "marker-css-d") marker.firstElementChild.style.d = 'path("M0 0L6 4L0 2Z")';
          if (mutation === "marker-size") marker.setAttribute("markerWidth", "20");
          if (mutation === "marker-transform") marker.firstElementChild.style.transform = "translateX(2px)";
          if (mutation === "marker-opacity") svg.querySelector("line[marker-end]").style.opacity = ".5";
          const switchElement = svg.querySelector("switch");
          if (mutation === "switch-condition") switchElement.firstElementChild.setAttribute("systemLanguage", "xx");
          if (mutation === "label-wrap") switchElement.querySelector(".label").textContent = "Very long wrapped Japanese 利用者 label with several measured lines";
          if (mutation === "label-transform") switchElement.querySelector(".label").style.transform = "rotate(10deg)";
        }, { mutation, name });
        expect(result.diagnostics.length, `${name} ${mutation}`).toBeGreaterThan(0);
        expect(result.diagnostics.every((entry) => entry.path !== "svg"), mutation).toBe(true);
        expect(result.conflicts, mutation).toEqual([]);
        expect(flatten(result.scene.nodes).some((node) => node.kind === "text"), mutation).toBe(true);
      }
    }
  } finally { await harness.close(); }
});

test("narrative alpha, hidden parts, stroke bounds and existing element limits remain guarded", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Narrative boundaries"] });
  try {
    await page.goto(harness.url);
    for (const name of names.filter((name) => name.endsWith("basic"))) {
      const result = await extract(page, name, (name) => {
        const shape = document.querySelector(name.startsWith("mindmap") ? "circle.label-container"
          : name.startsWith("timeline") ? "path.node-bkg" : "rect.task");
        shape.style.cssText = "fill:rgba(10,20,30,.8);stroke:rgba(40,50,60,.6);stroke-width:2px;fill-opacity:.5;stroke-opacity:.25;opacity:.8";
      }, name);
      expect(result.diagnostics).toEqual([]);
      const mapped = sceneToPptxElements(result.scene);
      const xml = buildPptxPackage({ slides: [{ elements: mapped.elements }] }).toString("utf8");
      for (const value of ["32000", "12000"]) expect(xml).toContain(`<a:alpha val="${value}"/>`);
      const limited = await extract(page, name, async () => {
        const { MAX_SCENE_NODES } = await import("./renderer/scene-graph.mjs");
        const svg = document.querySelector("svg");
        const fragment = document.createDocumentFragment();
        for (let i = 0; i <= MAX_SCENE_NODES * 10; i++) fragment.append(document.createElementNS(svg.namespaceURI, "g"));
        svg.append(fragment);
      });
      expect(limited.scene.nodes).toHaveLength(1);
      expect(limited.diagnostics[0].reason).toContain("SVG element count");
    }
    for (const scale of [.5, 1.25]) {
      const result = await extract(page, "journey-basic", (scale) => {
        const face = document.querySelector("circle.face");
        face.style.cssText = "filter:brightness(1.2);stroke:red;stroke-width:12px";
        face.setAttribute("transform", `scale(${scale})`);
        const hidden = face.cloneNode();
        hidden.style.cssText = "visibility:hidden;stroke-width:1000px";
        face.after(hidden);
      }, scale);
      expect(result.diagnostics).toHaveLength(1);
      const fallback = result.scene.nodes.find((node) => node.kind === "fallback");
      const source = result.sources.find((source) => source.path === fallback.sourcePath);
      expect(source.bounds.x - fallback.bounds.x).toBeCloseTo(6 * source.scale + 1, 0);
      expect(source.bounds.y - fallback.bounds.y).toBeCloseTo(6 * source.scale + 1, 0);
      expect(result.conflicts).toEqual([]);
    }
  } finally { await harness.close(); }
});

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  runtimeTest(`real narrative renderer has native masks, local ownership and unchanged source pixels (${theme})`, async ({ page }) => {
    test.setTimeout(120_000);
    const sources = await Promise.all(names.map((name) => fixture(name, "mmd")));
    const harness = await startHarness({
      slides: sources.map((source) => `## Narratives\n\n\`\`\`mermaid\n${source}\n\`\`\``),
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
      expect(model.slides.slice(0, 6).map((slide) => slide.fallbacks.filter((entry) => entry.type === "mermaid").length)).toEqual(counts);
      const masks = await page.evaluate(() => [...document.querySelectorAll(".deck svg[data-scene-source=mermaid]")].map((svg) => ({
        native: svg.querySelectorAll("[data-pptx-native]").length,
        nested: [...svg.querySelectorAll("[data-pptx-fallback-ids]")].filter((element) =>
          element.closest("[data-pptx-native]") || element.querySelector("[data-pptx-native]")).length,
      })));
      expect(masks.every((entry) => entry.native > 0 && entry.nested === 0)).toBe(true);
      for (const index of names.keys()) {
        await page.request.post(`${harness.url}/navigate`, { data: { index } });
        await page.goto(`${harness.url}?present=1`);
        let slide = await waitForSlideReady(page);
        // Isolate SVG compositing so reinsertion inside the scaled iframe does
        // not change Chromium's curve-edge paint cache. Keep exact pixel equality.
        await slide.addStyleTag({ content: ".mermaid > svg { will-change: transform; }" });
        const before = await slide.locator(".deck").screenshot();
        const displayMarkup = await slide.locator("pre.mermaid > svg").evaluate((svg) => svg.outerHTML);
        await slide.locator("svg[data-scene-source=mermaid]").evaluate(async (element) => {
          const { captureSvgTree, sceneToSvg } = await import("./renderer/scene-svg.mjs");
          window.__sceneReference = element.__presentationScene;
          const original = element.__originalMermaidSvg;
          element.replaceWith(original);
          // The pre-adapter runtime preserves an unsupported diagram using the
          // same inert source snapshot. Compare that unchanged display path,
          // not raw CSS SVG reinsertion with different Chromium paint caches.
          const svgRoot = captureSvgTree(original);
          original.replaceWith(sceneToSvg({ ...window.__sceneReference, nodes: [], meta: { svgRoot } }));
        });
        const original = await slide.locator(".deck").screenshot();
        const serializedScene = await slide.evaluate(() => JSON.parse(JSON.stringify(window.__sceneReference)));
        // Match the reference's one-replacement paint history. Repeated swaps in
        // one document change a Chromium cloud-path edge pixel even when the
        // in-memory scene, DOM, computed styles and geometry are unchanged.
        await page.goto(`${harness.url}?present=1`);
        slide = await waitForSlideReady(page);
        await slide.addStyleTag({ content: ".mermaid > svg { will-change: transform; }" });
        await slide.locator("pre.mermaid > svg").evaluate(async (element, scene) => {
          const { sceneToSvg } = await import("./renderer/scene-svg.mjs");
          element.replaceWith(sceneToSvg(scene));
        }, serializedScene);
        expect(await slide.locator("pre.mermaid > svg").evaluate((svg) => svg.outerHTML),
          `${names[index]} serialization preserves the exact displayed SVG`).toBe(displayMarkup);
        const serialized = await slide.locator(".deck").screenshot();
        for (const [operation, actual] of [["display", before], ["serialized", serialized]]) {
          const matches = original.equals(actual);
          if (!matches) {
            await writeFile(test.info().outputPath(`${names[index]}-${operation}-actual.png`), actual);
            await writeFile(test.info().outputPath(`${names[index]}-${operation}-source.png`), original);
          }
          expect(matches, `${names[index]} ${operation} equals the unchanged source snapshot raster`).toBe(true);
        }
        if (names[index] === "mindmap-hybrid") {
          const cloud = slide.locator('pre.mermaid > svg path[data-scene-node="fallback"]').nth(1);
          for (const control of ["missing", "subpixel-shift"]) {
            await cloud.evaluate((element, control) => {
              element.style.visibility = control === "missing" ? "hidden" : "visible";
              element.style.translate = control === "subpixel-shift" ? ".25px 0" : "none";
            }, control);
            expect((await slide.locator(".deck").screenshot()).equals(original),
              `${control} cloud negative control must be detected`).toBe(false);
          }
          await cloud.evaluate((element) => {
            element.style.visibility = "visible";
            element.style.removeProperty("translate");
          });
        }
        await slide.locator("pre.mermaid > svg").evaluate((svg) => {
          svg.style.transform = "translateX(2px)";
        });
        const shifted = await slide.locator(".deck").screenshot();
        expect(original.equals(shifted), "Shifted-source negative control").toBe(false);
      }
    } finally { await harness.close(); }
  });
}

runtimeTest("actual narrative PPTX captures each local face/card once, excluding native neighbors in paint order", async ({ page }) => {
  test.setTimeout(120_000);
  const directory = test.info().outputPath();
  const file = join(directory, "slides.md");
  const sources = await Promise.all(names.map((name) => fixture(name, "mmd")));
  await page.addInitScript(() => {
    const replaceWith = Element.prototype.replaceWith;
    Element.prototype.replaceWith = function (...nodes) {
      if (this.localName === "svg" && nodes[0]?.getAttribute?.("data-scene-source") === "mermaid") nodes[0].__originalMermaidSvg = this;
      return replaceWith.apply(this, nodes);
    };
  });
  await writeFile(file, ["# Narratives", ...sources.map((source) => `## Narratives\n\n\`\`\`mermaid\n${source}\n\`\`\``)].join("\n\n---\n\n"));
  await withDeckServer({ file, workspace: directory, theme: "light" }, async (session) => {
    let rendered;
    const output = join(directory, "editable-hybrid.pptx");
    await exportPptx(session, output, "light", {
      findChromiumBrowser: () => chromium.executablePath(),
      runPptxOutputBrowser: async (...args) => {
        rendered = await runPptxOutputBrowser(...args);
        await page.goto(args[1]);
        await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready"));
        await page.evaluate(() => {
          document.body.classList.remove("pptx-layout-artwork-mode");
          document.body.classList.add("pptx-slide-artwork-mode");
        });
        return rendered;
      },
    });
    const bytes = await readFile(output);
    expect(inspectPptxPackage(bytes).valid).toBe(true);
    const slides = [...bytes.toString("utf8").matchAll(/<p:sld\b[\s\S]*?<\/p:sld>/g)].map((match) => match[0]);
    for (let index = 1; index <= names.length; index++) {
      const model = rendered.model.slides[index];
      expect(model.fallbacks.filter((fallback) => fallback.type === "mermaid")).toHaveLength(counts[index - 1]);
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
        if (index === 6) {
          const mouthIndex = image.fallbackIndex;
          await page.locator(".deck").nth(index).locator("pre.mermaid > svg").evaluate((svg, mouthIndex) => {
            const original = svg.__originalMermaidSvg || svg;
            if (original !== svg) svg.replaceWith(original);
            original.querySelectorAll("[data-negative-control]").forEach((part) => part.remove());
            original.querySelectorAll("path, line, rect, circle, text, foreignObject").forEach((part) =>
              part.style.setProperty("visibility", "hidden", "important"));
            original.querySelectorAll("path.mouth")[mouthIndex].style.setProperty("visibility", "visible", "important");
          }, mouthIndex);
          await test.info().attach(`mouth-${mouthIndex}-reference-geometry`, {
            body: JSON.stringify(await page.locator(".deck").nth(index).locator("path.mouth").nth(mouthIndex).evaluate((mouth) => ({
              bounds: mouth.getBoundingClientRect().toJSON(), deck: mouth.closest(".deck").getBoundingClientRect().toJSON(),
              matrix: Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((key) => [key, mouth.getScreenCTM()[key]])),
            }))),
            contentType: "application/json",
          });
          const clip = { x: image.x, y: index * 720 + image.y, width: image.width, height: image.height };
          const cdp = await page.context().newCDPSession(page);
          await cdp.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
          const capture = async () => Buffer.from((await cdp.send("Page.captureScreenshot", {
            format: "png", fromSurface: true, captureBeyondViewport: true, clip: { ...clip, scale: 1 },
          })).data, "base64");
          const reference = await capture();
          if (!reference.equals(image.data)) {
            await writeFile(test.info().outputPath(`mouth-${mouthIndex}-source.png`), reference);
            await writeFile(test.info().outputPath(`mouth-${mouthIndex}-artwork.png`), image.data);
          }
          expect(reference.equals(image.data), "Local mouth artwork must equal the original isolated source pixels").toBe(true);
          for (const control of ["missing", "duplicate", "neighbor"]) {
            await page.locator(".deck").nth(index).locator("pre.mermaid > svg").evaluate((svg, { mouthIndex, control }) => {
              svg.querySelectorAll("[data-negative-control]").forEach((part) => part.remove());
              const mouth = svg.querySelectorAll("path.mouth")[mouthIndex];
              mouth.style.setProperty("visibility", control === "missing" ? "hidden" : "visible", "important");
              svg.querySelectorAll("circle.face").forEach((face) => face.style.setProperty("visibility", "hidden", "important"));
              if (control === "duplicate") {
                const duplicate = mouth.cloneNode(true);
                duplicate.setAttribute("data-negative-control", "true"); mouth.after(duplicate);
              }
              if (control === "neighbor") svg.querySelectorAll("circle.face")[mouthIndex].style.setProperty("visibility", "visible", "important");
            }, { mouthIndex, control });
            const changed = await capture();
            expect(changed.equals(reference), `${control} negative control must be detected`).toBe(false);
          }
          await cdp.detach();
        }
      }
    }
    for (const label of ["開始", "準備 Prepare", "確認", "完了", "公開"]) {
      expect(slides[6].split(`<a:t>${label}</a:t>`), label).toHaveLength(2);
    }
  });
});
