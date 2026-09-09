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
import { systemsIsolationContract, readSystemsPackage, assertSystemsPackage } from "../utils/systems-fallback-contract.mjs";

const names = ["c4-basic", "c4-hybrid", "architecture-basic", "architecture-hybrid", "eventmodeling-basic", "eventmodeling-hybrid"];
const counts = [0, 5, 0, 3, 0, 1];
const fixture = (name, extension = "svg") => readFile(join(process.cwd(), "test", "fixtures", "mermaid", `${name}.${extension}`), "utf8");
const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children || [])]);
const textOf = (node) => (node.text?.paragraphs || []).map((paragraph) => paragraph.runs.map((run) => run.text).join("")).join("\n");
const customThemeCss = "--bg:#102030;--print-slide-bg:#102030;--topbar:#ff6600;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;";
const runtimeTest = test.extend({ launchOptions: { executablePath: chromium.executablePath(),
  args: ["--disable-gpu", "--force-color-profile=srgb", "--force-device-scale-factor=1",
    "--hide-scrollbars", "--run-all-compositor-stages-before-draw"] } });

async function extract(page, name, mutate, arg) {
  await page.evaluate((svg) => {
    document.body.innerHTML = `<div id="fixture-deck" style="position:relative;width:1280px;height:720px">${svg}</div>`;
  }, await fixture(name));
  if (mutate) await page.evaluate(mutate, arg);
  return page.evaluate(async () => {
    const { mermaidSvgToScene, markerEndpointTangents } = await import("./renderer/mermaid-scene.mjs");
    const deck = document.querySelector("#fixture-deck");
    const result = mermaidSvgToScene(deck.querySelector("svg"), { deck, includeSourceElements: true });
    const walk = (nodes, x = 0, y = 0) => nodes.flatMap((node) => {
      const absolute = node.bounds && { ...node.bounds, x: node.bounds.x + x, y: node.bounds.y + y };
      return [{ ...node, absolute, offset: { x, y } }, ...walk(node.children || [], absolute?.x || 0, absolute?.y || 0)];
    });
    const nodes = walk(result.scene.nodes);
    const origin = deck.getBoundingClientRect();
    const sources = nodes.map((node) => {
      const element = result.sourceElements.get(node.sourcePath);
      if (!element) return { path: node.sourcePath };
      const box = element.getBoundingClientRect();
      const matrix = element.getScreenCTM();
      const css = getComputedStyle(element);
      const bounds = (box) => ({ x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height });
      return { path: node.sourcePath, tag: element.localName, class: element.getAttribute("class"),
        text: element.textContent, scale: matrix.a, bounds: bounds(box),
        paint: { stroke: css.stroke, fill: css.fill, strokeWidth: Number.parseFloat(css.strokeWidth) * matrix.a,
          dashArray: css.strokeDasharray.split(/[,\s]+/).map(Number.parseFloat).map((value) => value * matrix.a) },
        ...(node.meta?.mermaid?.kind?.endsWith("dashed-primitive") ? { contourLength: element.getTotalLength() * matrix.a } : {}),
        ...(node.meta?.mermaid?.kind?.endsWith("-dash") ? {
          dash: ["start", "end"].map((end) => {
            const point = element.getPointAtLength(node.meta.mermaid[end] / matrix.a);
            const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
            return { x: screen.x - origin.x, y: screen.y - origin.y };
          }),
        } : {}),
        ...(node.meta?.mermaid?.kind?.endsWith("-arrow") && node.meta.mermaid.placement ? (() => {
          const ends = element.localName === "path" ? markerEndpointTangents(element.getAttribute("d")) : {
            start: { point: { x: element.x1.baseVal.value, y: element.y1.baseVal.value } },
            end: { point: { x: element.x2.baseVal.value, y: element.y2.baseVal.value } },
          };
          const placement = node.meta.mermaid.placement;
          const point = new DOMPoint(ends[placement].point.x, ends[placement].point.y).matrixTransform(matrix);
          const direction = ends[placement].direction || { x: ends.end.point.x - ends.start.point.x, y: ends.end.point.y - ends.start.point.y };
          return { endpoint: { x: point.x - origin.x, y: point.y - origin.y },
            tangent: Math.atan2(direction.y, direction.x), strokeWidth: Number.parseFloat(getComputedStyle(element).strokeWidth) };
        })() : {}),
        ...(node.meta?.mermaid?.kind === "c4-stereotype" && node.kind === "text" ? (() => {
          const index = Number(node.sourcePath.match(/text\[(\d+)\]$/)[1]);
          const glyph = element.getExtentOfChar(index);
          const point = new DOMPoint(glyph.x, glyph.y).matrixTransform(matrix);
          return { glyph: { x: point.x - origin.x, y: point.y - origin.y,
            width: glyph.width * matrix.a, height: glyph.height * matrix.a } };
        })() : {}),
        ...(node.meta?.mermaid?.kind === "architecture-text-line" && node.kind === "text" ? {
          row: bounds(element.children[Number(node.sourcePath.match(/text\[(\d+)\]$/)[1])].getBoundingClientRect()),
        } : {}),
      };
    });
    const conflicts = nodes.filter((node) => node.kind === "fallback").flatMap((fallback) =>
      nodes.filter((node) => node.kind !== "fallback").filter((node) => {
        const a = result.sourceElements.get(node.sourcePath);
        const b = result.sourceElements.get(fallback.sourcePath);
        return a && b && (a.contains(b) || b.contains(a));
      }).map((node) => node.sourcePath));
    return { scene: result.scene, diagnostics: result.diagnostics, nodes, sources, conflicts };
  });
}

test("pinned systems keep frames, text, relations, exact triangles and local artwork with exclusive ownership", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Systems"] });
  try {
    await page.goto(harness.url);
    for (const [index, name] of names.entries()) {
      const result = await extract(page, name);
      validateScene(result.scene);
      expect(result.diagnostics, name).toHaveLength(counts[index]);
      expect(result.conflicts, name).toEqual([]);
      const nodes = flatten(result.scene.nodes);
      expect(nodes.filter((node) => node.kind === "connector").length, name).toBeGreaterThan(1);
      expect(nodes.filter((node) => node.kind === "text").length, name).toBeGreaterThan(3);
      expect(nodes.filter((node) => node.kind === "shape").length, name).toBeGreaterThan(2);
      expect(nodes.filter((node) => node.preset === "triangle").length, name).toBeGreaterThan(1);
      expect(result.sources.every((source) => source.tag), name).toBe(true);
      for (const diagnostic of result.diagnostics) {
        expect(diagnostic.path).not.toBe("svg");
        expect(diagnostic.reason).toContain(`unsupported-mermaid-${name.split("-")[0]}-`);
      }
      const mapped = sceneToPptxElements(result.scene);
      const bytes = buildPptxPackage({ slides: [{ elements: mapped.elements }] });
      expect(inspectPptxPackage(bytes).valid).toBe(true);
      const xml = bytes.toString("utf8");
      expect(xml).not.toMatch(/<a:(?:custDash|prstDash)/);
      expect(xml).toContain('prst="triangle"');
      expect(xml).toMatch(/<a:lnTo>|prst="line"/);
      expect(xml).toContain("<a:t>");
      if (name === "c4-basic") {
        expect(nodes.map(textOf)).toEqual(expect.arrayContaining(["画面", "Web", "検証", "Validate", "送信", "Submit"]));
        expect(xml).toContain("注文");
        expect(nodes.filter((node) => node.meta?.mermaid?.kind === "c4-stereotype" && node.kind === "group")).toHaveLength(3);
      }
      if (name === "architecture-basic") {
        expect(nodes.filter((node) => node.preset === "topRoundedRect")).toHaveLength(3);
        expect([...xml.matchAll(/<a:quadBezTo>/g)]).toHaveLength(6);
        expect(nodes.filter((node) => node.kind === "text" && node.meta?.mermaid?.kind === "architecture-text-line")
          .map(textOf)).toEqual(["Request", "processing"]);
      }
      if (name.startsWith("eventmodeling")) {
        for (const label of ["Submit", "Accepted", "List"]) expect(nodes.filter((node) => textOf(node) === label)).toHaveLength(1);
      }
    }
  } finally { await harness.close(); }
});

test("positioned/scaled systems preserve source geometry, C4 adjusted glyphs, HTML lines and alpha", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Geometry"] });
  try {
    await page.goto(harness.url);
    for (const name of names.filter((name) => name.endsWith("basic"))) {
      for (const width of [480, 960]) {
        const result = await extract(page, name, ({ name, width }) => {
          document.querySelector("svg").style.cssText = `width:${width}px;height:auto;margin-left:47px;margin-top:31px`;
          const shape = document.querySelector(name.startsWith("architecture") ? ".architecture-groups > rect" : "rect");
          shape.style.cssText = "fill:rgba(10,20,30,.8);stroke:rgba(40,50,60,.6);stroke-width:2px;fill-opacity:.5;stroke-opacity:.25;opacity:.8;stroke-dasharray:none";
          if (name.startsWith("eventmodeling")) document.querySelector("foreignObject b").innerHTML = "入力<br>Order form";
        }, { name, width });
        expect(result.diagnostics, name).toEqual([]);
        expect(result.conflicts).toEqual([]);
        for (const node of result.nodes.filter((node) => node.kind === "shape" &&
          !node.meta?.mermaid?.kind.endsWith("-arrow") && !node.meta?.mermaid?.kind.endsWith("-dash-join"))) {
          const source = result.sources.find((source) => source.path === node.sourcePath);
          for (const key of ["x", "y", "width", "height"]) {
            expect(Math.abs(node.absolute[key] - source.bounds[key]), `${name} ${key}`).toBeLessThanOrEqual(.11);
          }
        }
        for (const node of result.nodes.filter((node) => node.kind === "text" && node.meta?.mermaid?.kind === "c4-stereotype")) {
          const source = result.sources.find((source) => source.path === node.sourcePath);
          for (const key of ["x", "y", "width", "height"]) {
            expect(Math.abs(node.absolute[key] - source.glyph[key]), `C4 glyph ${key}`).toBeLessThanOrEqual(.16);
          }
        }
        for (const node of result.nodes.filter((node) => node.kind === "text" && node.meta?.mermaid?.kind === "architecture-text-line")) {
          const source = result.sources.find((source) => source.path === node.sourcePath);
          for (const key of ["x", "y", "width", "height"]) {
            expect(Math.abs(node.absolute[key] - source.row[key]), `architecture row ${key}`).toBeLessThanOrEqual(.16);
          }
        }
        for (const node of result.nodes.filter((node) => node.meta?.mermaid?.placement)) {
          const source = result.sources.find((source) => source.path === node.sourcePath);
          const c4 = name.startsWith("c4");
          const unit = source.scale * (c4 ? 1 : source.strokeWidth);
          const radians = node.rotation * Math.PI / 180;
          const tip = { x: node.absolute.x + node.absolute.width / 2 + Math.sin(radians) * node.absolute.height / 2,
            y: node.absolute.y + node.absolute.height / 2 - Math.cos(radians) * node.absolute.height / 2 };
          const advance = c4 ? (node.meta.mermaid.placement === "start" ? -unit : unit) : 0;
          expect(node.bounds.width).toBeCloseTo((c4 ? 10 : 7) * unit, 0);
          expect(node.bounds.height).toBeCloseTo(10 * unit, 0);
          expect(tip.x).toBeCloseTo(source.endpoint.x + Math.cos(source.tangent) * advance, 0);
          expect(tip.y).toBeCloseTo(source.endpoint.y + Math.sin(source.tangent) * advance, 0);
        }
        if (name.startsWith("eventmodeling")) {
          const texts = result.nodes.filter((node) => ["入力", "Order form"].includes(textOf(node)));
          expect(texts).toHaveLength(2);
          expect(texts[1].absolute.y).toBeGreaterThan(texts[0].absolute.y + texts[0].absolute.height);
        }
        const xml = buildPptxPackage({ slides: [{ elements: sceneToPptxElements(result.scene).elements }] }).toString("utf8");
        for (const alpha of ["32000", "12000"]) expect(xml).toContain(`<a:alpha val="${alpha}"/>`);
        for (const node of result.nodes.filter((node) => ["shape", "connector"].includes(node.kind) &&
          !node.meta?.mermaid?.kind.endsWith("-arrow") && !node.meta?.mermaid?.kind.endsWith("-dash-join") &&
          !node.sourcePath.endsWith(".fill"))) {
          const source = result.sources.find((source) => source.path === node.sourcePath);
          expect(Math.abs(node.style.strokeWidth - source.paint.strokeWidth), `${name} measured stroke width`).toBeLessThanOrEqual(.051);
        }
        expect(result.nodes.filter((node) => node.meta?.mermaid?.kind?.endsWith("dashed-primitive")).length)
          .toBe(name.startsWith("architecture") ? 3 : name.startsWith("c4") ? 1 : 0);
        expect(xml).not.toMatch(/<a:(?:custDash|prstDash)/);
      }
    }
  } finally { await harness.close(); }
});

test("straight system relations preserve physical dash and gap lengths with independently owned markers", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Dashed relation"] });
  try {
    await page.goto(harness.url);
    const result = await extract(page, "eventmodeling-basic", () => {
      document.querySelector(".em-relation").style.strokeDasharray = "3 5";
    });
    expect(result.diagnostics).toEqual([]);
    const node = result.nodes.find((node) => node.meta?.mermaid?.kind === "eventmodeling-dash");
    const source = result.sources.find((source) => source.path === node.sourcePath);
    expect(node.meta.mermaid.start).toBe(0);
    expect(node.meta.mermaid.end).toBeCloseTo(3 * source.scale, 5);
    expect(node.style.dash).toBe("solid");
    expect(result.conflicts).toEqual([]);
    const xml = buildPptxPackage({ slides: [{ elements: sceneToPptxElements(result.scene).elements }] }).toString("utf8");
    expect(xml).not.toMatch(/<a:(?:custDash|prstDash)/);
  } finally { await harness.close(); }
});

test("system dash geometry handles large lengths without DrawingML percentages and bounds dense patterns locally", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Dash percentage bounds"] });
  try {
    await page.goto(harness.url);
    for (const length of [50000, 20000, .0001]) {
      const result = await extract(page, "architecture-basic", (length) => {
        const frame = document.querySelector(".architecture-groups > rect");
        frame.style.strokeWidth = "2px";
        frame.style.strokeDasharray = `${length} ${length}`;
      }, length);
      const fallbackCount = length === .0001 ? 1 : 0;
      expect(result.diagnostics).toHaveLength(fallbackCount);
      expect(result.conflicts).toEqual([]);
      if (fallbackCount) {
        expect(result.diagnostics[0].reason).toBe("unsupported-mermaid-architecture-style");
        expect(result.sources.find((source) => source.path === result.diagnostics[0].path).tag).toBe("rect");
      }
      expect(result.nodes.filter((node) => node.preset === "topRoundedRect")).toHaveLength(3);
      const mapped = sceneToPptxElements(result.scene);
      expect(mapped.fallbacks).toHaveLength(fallbackCount);
      expect(inspectPptxPackage(buildPptxPackage({ slides: [{ elements: mapped.elements }] })).valid).toBe(true);
    }
  } finally { await harness.close(); }
});

test("native rectangular/card dash endpoints and repeats match measured source contours at every tested scale", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Coordinate dashes"] });
  try {
    await page.goto(harness.url);
    for (const name of ["c4-basic", "c4-hybrid", "architecture-basic", "architecture-hybrid"]) {
      for (const width of [480, 960, 1280]) {
        const result = await extract(page, name, (width) => {
          document.querySelector("svg").style.cssText = `width:${width}px;height:auto;margin-left:23px;margin-top:17px`;
        }, width);
        expect(result.diagnostics).toHaveLength(counts[names.indexOf(name)]);
        expect(result.conflicts).toEqual([]);
        const groups = result.nodes.filter((node) => node.meta?.mermaid?.kind?.endsWith("dashed-primitive"));
        expect(groups).toHaveLength(name.startsWith("c4") ? 1 : name.endsWith("basic") ? 4 : 2);
        for (const group of groups) {
          const owner = result.sources.find((source) => source.path === group.sourcePath);
          const pattern = owner.paint.dashArray.length === 1 ? Array(2).fill(owner.paint.dashArray[0]) : owner.paint.dashArray;
          const dashes = result.nodes.filter((node) => node.kind === "connector" && node.sourcePath.startsWith(`${group.sourcePath}.dash[`));
          expect(dashes.length).toBe(Math.ceil(owner.contourLength / (pattern[0] + pattern[1])));
          expect(result.nodes.find((node) => node.sourcePath === `${group.sourcePath}.fill`))
            .toMatchObject({ kind: "shape", style: { stroke: null, strokeWidth: 0 } });
          for (const [index, node] of dashes.entries()) {
            const source = result.sources.find((source) => source.path === node.sourcePath);
            expect(node.meta.mermaid.start).toBeCloseTo(index * (pattern[0] + pattern[1]), 5);
            expect(node.meta.mermaid.end).toBeCloseTo(Math.min(node.meta.mermaid.start + pattern[0], owner.contourLength), 5);
            expect(node.style).toMatchObject({ dash: "solid", lineCap: "butt" });
            for (const [endpoint, point] of [node.points[0], node.points.at(-1)].entries()) {
              expect(Math.abs(point.x + node.offset.x - source.dash[endpoint].x)).toBeLessThanOrEqual(.16);
              expect(Math.abs(point.y + node.offset.y - source.dash[endpoint].y)).toBeLessThanOrEqual(.16);
            }
            const length = node.points.slice(1).reduce((sum, point, pointIndex) =>
              sum + Math.hypot(point.x - node.points[pointIndex].x, point.y - node.points[pointIndex].y), 0);
            expect(Math.abs(length - (node.meta.mermaid.end - node.meta.mermaid.start))).toBeLessThanOrEqual(.3);
            expect(node.points.length).toBeLessThanOrEqual(64);
          }
        }
        const xml = buildPptxPackage({ slides: [{ elements: sceneToPptxElements(result.scene).elements }] }).toString("utf8");
        expect(xml).not.toMatch(/<a:(?:custDash|prstDash)/);
      }
    }
  } finally { await harness.close(); }
});

test("known dashed rectangle miters cover outer corner quadrants that flat connector segments cannot cover", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Native miter joins"] });
  try {
    await page.goto(harness.url);
    for (const width of [480, 1280]) {
      const result = await extract(page, "architecture-basic", (width) => {
        document.querySelector("svg").style.width = `${width}px`;
        const frame = document.querySelector(".architecture-groups > rect");
        frame.style.strokeWidth = "20px";
        frame.style.strokeDasharray = "50000 50000";
      }, width);
      expect(result.diagnostics).toEqual([]);
      expect(result.conflicts).toEqual([]);
      const group = result.nodes.find((node) => node.meta?.mermaid?.kind === "architecture-dashed-primitive" &&
        result.sources.find((source) => source.path === node.sourcePath)?.tag === "rect");
      const owner = result.sources.find((source) => source.path === group.sourcePath);
      const mapped = sceneToPptxElements(result.scene).elements;
      const joins = mapped.filter((element) => element.path.startsWith(`${group.sourcePath}.join[`));
      expect(joins).toHaveLength(4);
      const bytes = buildPptxPackage({ slides: [{ elements: joins }] });
      expect(inspectPptxPackage(bytes).valid).toBe(true);
      const xml = bytes.toString("utf8");
      const slideXml = xml.match(/<p:sld\b[\s\S]*?<\/p:sld>/)[0];
      const paintedRectangles = [...slideXml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map(([shape]) => {
        expect(shape).toContain('<a:prstGeom prst="rect">');
        expect(shape).toContain("<a:solidFill>");
        const [, x, y] = shape.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/);
        const [, cx, cy] = shape.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
        return { x: Number(x) / 9525, y: Number(y) / 9525, width: Number(cx) / 9525, height: Number(cy) / 9525 };
      });
      expect(paintedRectangles).toHaveLength(4);
      const corner = { x: owner.bounds.x + owner.bounds.width, y: owner.bounds.y };
      const lines = mapped.filter((element) => element.path.startsWith(`${group.sourcePath}.dash[`));
      for (const dx of [2, 4, 6, 8]) {
        for (const dy of [-2, -4, -6, -8]) {
          const point = { x: corner.x + dx * owner.scale, y: corner.y + dy * owner.scale };
          expect(paintedRectangles.some((join) => point.x > join.x && point.x < join.x + join.width &&
            point.y > join.y && point.y < join.y + join.height), "Actual DrawingML fill covers the source miter quadrant").toBe(true);
          expect(lines.some((line) => line.points.slice(1).some((end, index) => {
            const start = line.points[index];
            const horizontal = start.y === end.y;
            return horizontal
              ? point.x >= Math.min(start.x, end.x) && point.x <= Math.max(start.x, end.x) &&
                Math.abs(point.y - start.y) <= line.strokeWidth / 2
              : point.y >= Math.min(start.y, end.y) && point.y <= Math.max(start.y, end.y) &&
                Math.abs(point.x - start.x) <= line.strokeWidth / 2;
          })), "Flat-segment-only negative control leaves the outer quadrant empty").toBe(false);
        }
      }
      expect(xml).not.toMatch(/<a:(?:custDash|prstDash)/);
    }
    for (const [pattern, expected] of [["100 200", 0], ["50 50", 0], ["90 20", 3]]) {
      const result = await extract(page, "architecture-basic", (pattern) => {
        const frame = document.querySelector(".architecture-groups > rect");
        frame.setAttribute("width", "100"); frame.setAttribute("height", "50");
        frame.style.strokeWidth = "20px"; frame.style.strokeDasharray = pattern;
      }, pattern);
      expect(result.diagnostics).toEqual([]);
      const group = result.nodes.find((node) => node.meta?.mermaid?.kind === "architecture-dashed-primitive" &&
        result.sources.find((source) => source.path === node.sourcePath)?.tag === "rect");
      const joins = result.nodes.filter((node) => node.sourcePath.startsWith(`${group.sourcePath}.join[`));
      expect(joins, "Dash gaps and flat ends at corners do not receive miter pieces").toHaveLength(expected);
    }
    for (const change of ["round-join", "bevel-join", "miter-limit", "round-cap", "wide-card", "wide-rounded-frame",
      "opacity", "stroke-opacity", "stroke-alpha"]) {
      const name = change === "wide-rounded-frame" ? "c4-basic" : "architecture-basic";
      const result = await extract(page, name, (change) => {
        const frame = change === "wide-card" ? document.querySelector(".architecture-service path.node-bkg")
          : change === "wide-rounded-frame" ? [...document.querySelectorAll("rect")].find((rect) => getComputedStyle(rect).strokeDasharray === "7px, 7px")
          : document.querySelector(".architecture-groups > rect");
        frame.style.strokeWidth = "20px";
        frame.style.strokeDasharray = "50000 50000";
        if (change === "round-join") frame.style.strokeLinejoin = "round";
        if (change === "bevel-join") frame.style.strokeLinejoin = "bevel";
        if (change === "miter-limit") frame.style.strokeMiterlimit = "1";
        if (change === "round-cap") frame.style.strokeLinecap = "round";
        if (change === "opacity") frame.style.opacity = ".5";
        if (change === "stroke-opacity") frame.style.strokeOpacity = ".5";
        if (change === "stroke-alpha") frame.style.stroke = "rgba(20,30,40,.5)";
      }, change);
      expect(result.diagnostics, change).toHaveLength(1);
      expect(result.diagnostics[0].reason).toContain("-style");
      expect(result.diagnostics[0].path).not.toBe("svg");
      expect(result.conflicts).toEqual([]);
    }
  } finally { await harness.close(); }
});

test("systems retain clipped HTML ancestors, unsupported parent text semantics and complete unknown polygons locally", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Ownership guards"] });
  try {
    await page.goto(harness.url);
    for (const mutation of ["html-clip-x", "html-clip-y", "html-clip-parent", "html-clip-frame",
      "parent-text-length", "parent-coordinates", "parent-rotate", "extra-arrow-vertex"]) {
      const name = mutation.startsWith("html") ? "eventmodeling-basic" : "architecture-basic";
      const result = await extract(page, name, (mutation) => {
        if (mutation.startsWith("html")) {
          const label = document.querySelector("foreignObject");
          const bold = label.querySelector("b");
          if (mutation === "html-clip-x") bold.style.cssText = "display:inline-block;width:8px;overflow:hidden;white-space:nowrap";
          if (mutation === "html-clip-y") bold.style.cssText = "display:inline-block;height:4px;overflow:hidden;white-space:nowrap";
          if (mutation === "html-clip-parent") label.querySelector("div").style.cssText =
            "display:block;width:8px;overflow:clip;white-space:nowrap";
          if (mutation === "html-clip-frame") { label.setAttribute("width", "8"); label.style.overflow = "hidden"; }
        } else if (mutation.startsWith("parent")) {
          const label = [...document.querySelectorAll("text")].find((element) => element.textContent === "Requestprocessing");
          if (mutation === "parent-text-length") { label.setAttribute("textLength", "250"); label.setAttribute("lengthAdjust", "spacingAndGlyphs"); }
          if (mutation === "parent-coordinates") label.setAttribute("x", "0 40");
          if (mutation === "parent-rotate") label.setAttribute("rotate", "0 45");
        } else {
          const arrow = document.querySelector("polygon.arrow");
          arrow.setAttribute("points", "10,5,100,100 0,10 0,0");
          if (arrow.points.numberOfItems !== 4) throw new Error("Regression must contain four rendered SVG vertices");
        }
      }, mutation);
      expect(result.diagnostics, mutation).toHaveLength(1);
      expect(result.diagnostics[0].path, mutation).not.toBe("svg");
      expect(result.conflicts, mutation).toEqual([]);
      const fallback = result.nodes.find((node) => node.kind === "fallback");
      const source = result.sources.find((source) => source.path === fallback.sourcePath);
      expect(source.tag).toBe(mutation.startsWith("html") ? "foreignObject" : mutation.startsWith("parent") ? "text" : "polygon");
      expect(fallback.reason).toBe(`unsupported-mermaid-${name.split("-")[0]}-${mutation === "extra-arrow-vertex" ? "geometry" : "label"}`);
      if (mutation.startsWith("html")) expect(result.nodes.some((node) => node.kind === "text" && textOf(node) === "Form")).toBe(false);
      if (mutation.startsWith("parent")) expect(result.nodes.some((node) =>
        node.kind === "text" && ["Request", "processing"].includes(textOf(node)))).toBe(false);
      expect(result.nodes.some((node) => node.kind === "connector")).toBe(true);
      expect(result.nodes.some((node) => node.kind === "text")).toBe(true);
      const mapped = sceneToPptxElements(result.scene);
      expect(mapped.fallbacks).toHaveLength(1);
      expect(inspectPptxPackage(buildPptxPackage({ slides: [{ elements: mapped.elements }] })).valid).toBe(true);
    }
  } finally { await harness.close(); }
});

test("systems preserve root compositing as one owned SVG fallback without independently opaque children", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Root compositing"] });
  try {
    await page.goto(harness.url);
    for (const name of ["c4-basic", "architecture-basic", "eventmodeling-basic"]) {
      for (const effect of ["opacity:.5", "filter:blur(1px)", "clip-path:inset(5px)", "mix-blend-mode:multiply"]) {
        const result = await extract(page, name, (effect) => { document.querySelector("svg").style.cssText = effect; }, effect);
        expect(result.diagnostics, `${name} ${effect}`).toHaveLength(1);
        expect(result.diagnostics[0]).toMatchObject({ path: "svg", kind: "fallback" });
        expect(result.diagnostics[0].reason).toContain("-style");
        expect(result.scene.nodes, `${name} ${effect}`).toHaveLength(1);
        expect(result.scene.nodes[0]).toMatchObject({ kind: "fallback", sourcePath: "svg" });
        expect(result.sources[0].tag).toBe("svg");
        expect(result.conflicts).toEqual([]);
        expect(sceneToPptxElements(result.scene).elements).toEqual([]);
      }
    }
  } finally { await harness.close(); }
});

test("system marker paint remains independent of connector paint and external C4 stereotypes stay editable", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Marker paint"] });
  try {
    await page.goto(harness.url);
    for (const name of ["c4-basic", "eventmodeling-basic"]) {
      const result = await extract(page, name, () => {
        const relation = document.querySelector("line[marker-end], path[marker-end]");
        relation.style.stroke = "rgba(40,50,60,.6)";
        relation.style.strokeOpacity = ".25";
        const marker = document.querySelector("marker");
        marker.firstElementChild.style.fill = "rgba(10,20,30,.8)";
        marker.firstElementChild.style.fillOpacity = ".5";
        marker.style.opacity = ".5";
        const stereotype = document.querySelector("text[textLength]");
        if (stereotype) stereotype.textContent = "<<external_container>>";
      });
      expect(result.diagnostics).toEqual([]);
      const xml = buildPptxPackage({ slides: [{ elements: sceneToPptxElements(result.scene).elements }] }).toString("utf8");
      for (const alpha of ["20000", "15000"]) expect(xml).toContain(`<a:alpha val="${alpha}"/>`);
    }
  } finally { await harness.close(); }
});

test("systems reject unknown geometry, unsafe labels, marker/effect changes locally and preserve guard limits", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Guard coverage"] });
  try {
    await page.goto(harness.url);
    for (const [name, mutations] of [
      ["c4-basic", ["opacity", "skew", "label-effect", "text-length", "closed-relation", "multi-path", "marker-size", "marker-path", "marker-transform", "marker-opacity", "marker-css-d", "marker-ref", "marker-units", "dash-offset", "dash-pattern", "dash-range", "dash-relation", "dash-opacity", "dash-stroke-opacity", "dash-path-length", "dash-elliptical"]],
      ["architecture-basic", ["opacity", "skew", "label-effect", "card", "arrow", "closed-relation", "multi-path", "gradient", "dash-offset", "dash-pattern", "dash-range", "dash-relation", "dash-opacity", "dash-stroke-opacity", "dash-path-length", "dash-elliptical"]],
      ["eventmodeling-basic", ["opacity", "skew", "label-effect", "html-image", "html-wrap", "html-transform", "html-content", "marker-size", "marker-path", "marker-transform", "marker-opacity", "marker-ref", "marker-units", "dash-offset", "dash-pattern", "dash-range", "dash-opacity", "dash-stroke-opacity", "dash-path-length", "dash-elliptical"]],
    ]) {
      for (const mutation of mutations) {
        const result = await extract(page, name, ({ mutation }) => {
          const svg = document.querySelector("svg");
          const node = svg.querySelector(".person-man, .architecture-service, .em-box");
          const label = node.querySelector("text, foreignObject");
          const relation = svg.querySelector("line[marker-end], path[marker-end], path.edge");
          if (mutation === "opacity") node.style.opacity = ".5";
          if (mutation === "skew") node.setAttribute("transform", "skewX(20)");
          const shape = node.querySelector("path.node-bkg") || node.querySelector("rect");
          if (mutation === "dash-offset") { shape.style.strokeDasharray = "8 8"; shape.style.strokeDashoffset = "2px"; }
          if (mutation === "dash-pattern") shape.style.strokeDasharray = "8 4 2 4";
          if (mutation === "dash-range") shape.style.strokeDasharray = ".0001px .0001px";
          if (mutation === "dash-opacity") { shape.style.strokeDasharray = "8 8"; shape.style.opacity = ".5"; }
          if (mutation === "dash-stroke-opacity") { shape.style.strokeDasharray = "8 8"; shape.style.strokeOpacity = ".5"; }
          if (mutation === "dash-path-length") { shape.style.strokeDasharray = "8 8"; shape.setAttribute("pathLength", "80"); }
          if (mutation === "dash-elliptical") {
            const frame = svg.querySelector(".architecture-groups > rect") || node.querySelector("rect");
            frame.style.strokeDasharray = "8 8"; frame.style.rx = "12px"; frame.style.ry = "3px";
          }
          if (mutation === "dash-relation") {
            const path = svg.querySelector("path[marker-end], path.edge");
            path.setAttribute("d", "M0 0L10 0L10 20");
            path.style.strokeDasharray = "8 8";
          }
          if (mutation === "label-effect") label.style.filter = "blur(1px)";
          if (mutation === "text-length") label.setAttribute("lengthAdjust", "spacingAndGlyphs");
          if (mutation === "closed-relation") {
            const path = svg.querySelector("path[marker-end], path.edge");
            path.setAttribute("d", `${path.getAttribute("d")} Z`);
          }
          if (mutation === "multi-path") svg.querySelector("path[marker-end], path.edge").setAttribute("d", "M0 0L10 10 M20 20L30 30");
          if (mutation === "card") node.querySelector("path.node-bkg").setAttribute("d", "M0 0L20 0L10 20Z");
          if (mutation === "arrow") svg.querySelector("polygon.arrow").setAttribute("points", "0,0 20,0 10,8");
          if (mutation === "gradient") {
            const defs = document.createElementNS(svg.namespaceURI, "defs");
            defs.innerHTML = '<linearGradient id="unknown-gradient"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient>';
            svg.append(defs);
            node.querySelector("path.node-bkg").style.fill = "url(#unknown-gradient)";
          }
          const marker = svg.querySelector("marker");
          if (mutation === "marker-size") marker.setAttribute("markerWidth", "20");
          if (mutation === "marker-ref") marker.setAttribute("refX", "5");
          if (mutation === "marker-units") marker.setAttribute("markerUnits", "objectBoundingBox");
          if (mutation === "marker-path") {
            marker.firstElementChild.setAttribute(marker.firstElementChild.localName === "path" ? "d" : "points", "0,0 20,0 10,8");
          }
          if (mutation === "marker-css-d") marker.firstElementChild.style.d = 'path("M0 0L10 10L0 5Z")';
          if (mutation === "marker-transform") marker.firstElementChild.style.transform = "translateX(2px)";
          if (mutation === "marker-opacity") relation.style.opacity = ".5";
          const bold = svg.querySelector("foreignObject b");
          if (mutation === "html-image") bold.innerHTML = '<img width="20" height="20" src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27/%3E">';
          if (mutation === "html-wrap") bold.textContent = "Long Japanese 利用者 label with several measured lines and more words";
          if (mutation === "html-transform") bold.style.transform = "rotate(10deg)";
          if (mutation === "html-content") {
            const style = document.createElementNS(svg.namespaceURI, "style");
            style.textContent = "foreignObject b::before {content: 'warning'; color: red}";
            svg.append(style);
          }
        }, { mutation });
        expect(result.diagnostics.length, `${name} ${mutation}`).toBeGreaterThan(0);
        expect(result.diagnostics.every((entry) => entry.path !== "svg"), `${name} ${mutation}`).toBe(true);
        expect(result.conflicts, `${name} ${mutation}`).toEqual([]);
        expect(flatten(result.scene.nodes).some((node) => node.kind === "text"), `${name} ${mutation}`).toBe(true);
      }
      const limited = await extract(page, name, async () => {
        const { MAX_SCENE_NODES } = await import("./renderer/scene-graph.mjs");
        const fragment = document.createDocumentFragment();
        for (let index = 0; index <= MAX_SCENE_NODES * 10; index++) fragment.append(document.createElementNS("http://www.w3.org/2000/svg", "g"));
        document.querySelector("svg").append(fragment);
      });
      expect(limited.scene.nodes).toHaveLength(1);
      expect(limited.diagnostics[0].reason).toContain("SVG element count");
    }
  } finally { await harness.close(); }
});

test("bundled C4 variants and architecture/Event Modeling detector names use the measured adapters", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Aliases"] });
  try {
    await page.goto(harness.url);
    await page.waitForFunction(() => window.mermaid);
    const result = await page.evaluate(async () => {
      const { mermaidSvgToScene } = await import("./renderer/mermaid-scene.mjs");
      const records = [];
      for (const [keyword, body] of [
        ["C4Context", 'System(a,"A","one")\nSystem(b,"B","two")\nRel(a,b,"uses")'],
        ["C4Container", 'Container(a,"A","tech")\nContainer(b,"B","tech")\nRel(a,b,"uses")'],
        ["C4Component", 'Component(a,"A","tech")\nComponent(b,"B","tech")\nRel(a,b,"uses")'],
        ["C4Dynamic", 'Container(a,"A","tech")\nContainer(b,"B","tech")\nRel(a,b,"uses")'],
        ["C4Deployment", 'Deployment_Node(node,"Host") {\nContainer(a,"A","tech")\nContainer(b,"B","tech")\n}\nRel(a,b,"uses")'],
        ["architecture-beta", "service a[A]\nservice b[B]\na:R --> L:b"],
        ["eventmodeling", "entity Order.Form\nentity Order.Submit\ntimeframe 1 ui Order.Form\ntimeframe 2 command Order.Submit ->> 1"],
      ]) {
        mermaid.initialize({ startOnLoad: false, securityLevel: "loose" });
        const source = `${keyword}\n${body}`;
        const { svg } = await mermaid.render(`alias-${records.length}`, source);
        const deck = document.createElement("div"); deck.innerHTML = svg; document.body.append(deck);
        const result = mermaidSvgToScene(deck.querySelector("svg"), { deck });
        records.push({ keyword, type: mermaid.detectType(source), role: deck.querySelector("svg").getAttribute("aria-roledescription"),
          diagnostics: result.diagnostics });
        deck.remove();
      }
      return records;
    });
    for (const record of result) {
      expect(record.diagnostics, record.keyword).toEqual([]);
      expect(record.role).toBe(record.type);
    }
  } finally { await harness.close(); }
});

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  runtimeTest(`real systems have native masks, local source ownership and unchanged source pixels (${theme})`, async ({ page }) => {
    test.setTimeout(120_000);
    const sources = await Promise.all(names.map((name) => fixture(name, "mmd")));
    const harness = await startHarness({
      slides: sources.map((source) => `## Systems\n\n\`\`\`mermaid\n${source}\n\`\`\``),
      theme, customThemeCss: theme === "custom" ? customThemeCss : "",
    });
    await page.addInitScript(() => {
      const replaceWith = Element.prototype.replaceWith;
      Element.prototype.replaceWith = function (...nodes) {
        if (this.localName === "svg" && nodes[0]?.getAttribute?.("data-scene-source") === "mermaid") {
          nodes[0].__originalMermaidSvg = this;
          const title = [...this.querySelectorAll("text")].find((element) => element.textContent === "注文システム");
          if (title) window.__systemTitleFill = getComputedStyle(title).fill;
        }
        return replaceWith.apply(this, nodes);
      };
    });
    try {
      await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`);
      await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready") ||
        document.documentElement.hasAttribute("data-pptx-error"));
      await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
      const model = await page.evaluate(() => window.__presentationPptxModel);
      expect(model.slides.slice(0, names.length).map((slide) => slide.fallbacks.filter((entry) => entry.type === "mermaid").length)).toEqual(counts);
      const title = model.slides[0].elements.find((element) =>
        element.paragraphs?.some((paragraph) => paragraph.runs.some((run) => run.text === "注文システム")));
      const titleRun = title.paragraphs.flatMap((paragraph) => paragraph.runs).find((run) => run.text === "注文システム");
      const titleColor = await page.evaluate(() => {
        return `#${window.__systemTitleFill.match(/\d+/g).slice(0, 3).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
      });
      expect(titleRun.color.toUpperCase()).toBe(titleColor);
      if (theme === "custom") expect(titleColor).toBe("#FEFEFE");
      const titleXml = buildPptxPackage({ slides: [{ elements: [title] }] }).toString("utf8");
      expect(titleXml).toContain(`<a:srgbClr val="${titleColor.slice(1)}">`);
      const masks = await page.evaluate(() => [...document.querySelectorAll(".deck svg[data-scene-source=mermaid]")].map((svg) => ({
        native: svg.querySelectorAll("[data-pptx-native]").length,
        nested: [...svg.querySelectorAll("[data-pptx-fallback-ids]")].filter((element) =>
          element.closest("[data-pptx-native]") || element.querySelector("[data-pptx-native]")).length,
      })));
      expect(masks.every((entry) => entry.native > 0 && entry.nested === 0)).toBe(true);
      for (const index of names.keys()) {
        await page.request.post(`${harness.url}/navigate`, { data: { index } });
        await page.goto(`${harness.url}?present=1`);
        const slide = await waitForSlideReady(page);
        // Keep the source/scene swaps on identical compositor layers in the iframe.
        await slide.addStyleTag({ content: ".mermaid > svg { will-change: transform; }" });
        const before = await slide.locator(".deck").screenshot();
        await slide.locator("svg[data-scene-source=mermaid]").evaluate(async (element) => {
          const { captureSvgTree, sceneToSvg } = await import("./renderer/scene-svg.mjs");
          window.__systemScene = element.__presentationScene;
          const original = element.__originalMermaidSvg;
          element.replaceWith(original);
          const svgRoot = captureSvgTree(original);
          original.replaceWith(sceneToSvg({ ...window.__systemScene, nodes: [], meta: { svgRoot } }));
        });
        const original = await slide.locator(".deck").screenshot();
        expect(before.equals(original), `${names[index]} source snapshot pixels`).toBe(true);
        await slide.locator("pre.mermaid > svg").evaluate((svg) => { svg.style.transform = "translateX(2px)"; });
        expect((await slide.locator(".deck").screenshot()).equals(original), "Shifted-source negative control").toBe(false);
      }
    } finally { await harness.close(); }
  });
}

async function exportSystems(observe = false) {
  const directory = test.info().outputPath();
  const file = join(directory, "slides.md");
  const sources = await Promise.all(names.map((name) => fixture(name, "mmd")));
  await writeFile(file, ["# Systems", ...sources.map((source) => `## Systems\n\n\`\`\`mermaid\n${source}\n\`\`\``)].join("\n\n---\n\n"));
  return withDeckServer({ file, workspace: directory, theme: "light" }, async (session) => {
    let rendered, captured, manifest;
    const observations = [];
    const output = join(directory, "editable-hybrid.pptx");
    await exportPptx(session, output, "light", {
      findChromiumBrowser: () => chromium.executablePath(),
      runPptxOutputBrowser: async (...args) => {
        if (!observe) {
          rendered = await runPptxOutputBrowser(...args);
          captured = rendered.slideFallbackImages.map((images) => images.map((image) => ({ ...image, data: Buffer.from(image.data) })));
          return rendered;
        }
        // Hold only the ready handshake while attaching a read-only observer.
        // It records the real exporter's synchronous mask mutations before its
        // double-RAF/capture, without extra screenshots or a production hook.
        let hold = true;
        const job = args[3];
        args[3] = new Proxy(job, { get: (target, key) => key === "status" && hold && target.status === "ready"
          ? "pending" : Reflect.get(target, key) });
        const operation = runPptxOutputBrowser(...args);
        operation.catch(() => {});
        let browser;
        try {
          let port;
          await expect.poll(async () => {
            try { port = Number((await readFile(join(args[2], "DevToolsActivePort"), "utf8")).split(/\r?\n/)[0]); }
            catch (_) { return false; }
            return Boolean(port);
          }, { timeout: 15_000 }).toBe(true);
          browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
          const context = browser.contexts()[0];
          const outputPage = context.pages()[0] || await context.waitForEvent("page");
          await outputPage.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready"));
          const cdp = await outputPage.context().newCDPSession(outputPage);
          cdp.on("Runtime.bindingCalled", ({ name, payload }) => {
            if (name === "__reportSystemsIsolation") observations.push(JSON.parse(payload));
          });
          await cdp.send("Runtime.enable");
          await cdp.send("Runtime.addBinding", { name: "__reportSystemsIsolation" });
          await outputPage.evaluate(`window.__systemsContract = (${systemsIsolationContract.toString()})()`);
          manifest = await outputPage.evaluate(() => window.__systemsContract.manifest);
          await outputPage.evaluate(() => {
            const contract = window.__systemsContract;
            const schedule = window.__presentationPptxModel.slides.flatMap((slide, slideIndex) =>
              slide.fallbacks.map((fallback, fallbackIndex) => ({ ...fallback, slideIndex, fallbackIndex }))
                .filter((fallback) => fallback.artwork !== false));
            let index = 0;
            const observer = new MutationObserver((mutations) => {
              if (!mutations.some(({ target }) => target.hasAttribute("data-pptx-fallback-ids"))) return;
              try {
                if (index < schedule.length) {
                  const capture = schedule[index++];
                  const entry = contract.entries.findIndex(({ slideIndex, fallbackIndex }) =>
                    slideIndex === capture.slideIndex && fallbackIndex === capture.fallbackIndex);
                  if (entry >= 0) window.__reportSystemsIsolation(JSON.stringify(contract.inspect(entry)));
                } else {
                  window.__reportSystemsIsolation(JSON.stringify({
                    cleanup: document.querySelectorAll(".pptx-fallback-hidden").length === 0,
                  }));
                  observer.disconnect();
                  delete window.__systemsContract;
                }
              } catch (error) {
                window.__reportSystemsIsolation(JSON.stringify({ observerError: error.stack }));
                observer.disconnect();
              }
            });
            observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
          });
        } finally {
          hold = false;
          try { rendered = await operation; }
          finally { await browser?.close(); }
        }
        captured = rendered.slideFallbackImages.map((images) => images.map((image) => ({ ...image, data: Buffer.from(image.data) })));
        return rendered;
      },
    });
    const bytes = await readFile(output);
    expect(inspectPptxPackage(bytes).valid).toBe(true);
    expect(rendered.model.slides.slice(1, 7).map((slide) => slide.fallbacks.filter((fallback) => fallback.type === "mermaid").length)).toEqual(counts);
    expect(captured.slice(1, 7).map((images, index) => images.filter((image) =>
      rendered.model.slides[index + 1].fallbacks[image.fallbackIndex].type === "mermaid").length)).toEqual(counts);
    return { rendered, captured, files: readSystemsPackage(bytes), observations, manifest, sources };
  });
}

runtimeTest("systems fallback isolation observes all nine real capture states and rejects malformed source DOM", async ({ page }) => {
  test.setTimeout(120_000);
  const { rendered, captured, observations, manifest, sources } = await exportSystems(true);
  expect(manifest.map(({ id }) => id)).toEqual(["c4-person", "c4-database-body", "c4-database-rim",
    "c4-queue-body", "c4-queue-tail", "architecture-database", "architecture-server", "architecture-cloud", "eventmodeling-html"]);
  expect(observations).toEqual([...manifest.map(({ id, slideIndex, fallbackIndex }) =>
    ({ id, slideIndex, fallbackIndex, errors: [] })), { cleanup: true }]);
  for (const { slideIndex, fallbackIndex } of manifest) {
    const fallback = rendered.model.slides[slideIndex].fallbacks[fallbackIndex];
    const image = captured[slideIndex].find((image) => image.fallbackIndex === fallbackIndex);
    const x = Math.floor(Math.max(0, fallback.x)), y = Math.floor(Math.max(0, fallback.y));
    expect({ x: image.x, y: image.y, width: image.width, height: image.height }).toEqual({
      x, y, width: Math.ceil(Math.min(1280, fallback.x + fallback.width)) - x,
      height: Math.ceil(Math.min(720, fallback.y + fallback.height)) - y,
    });
  }
  expect(rendered.model.slides[2].fallbacks[manifest[4].fallbackIndex].width,
    "the thin source C4 queue tail remains a separate fallback before pixel alignment").toBeLessThan(3);

  // Negative controls use a separate renderer, never the page being captured.
  const harness = await startHarness({ slides: ["# Systems", ...sources.map((source) =>
    `## Systems\n\n\`\`\`mermaid\n${source}\n\`\`\``)], theme: "light" });
  try {
    await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`);
    await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready"));
    await page.evaluate(`window.__systemsContract = (${systemsIsolationContract.toString()})()`);
    const controls = await page.evaluate(() => {
      const { entries, inspect } = window.__systemsContract;
      const records = [];
      const select = (index) => {
        const entry = entries[index];
        const id = window.__presentationPptxModel.slides[entry.slideIndex].fallbacks[entry.fallbackIndex].captureId;
        document.querySelectorAll("[data-pptx-fallback-ids]").forEach((part) =>
          part.classList.toggle("pptx-fallback-hidden", !part.getAttribute("data-pptx-fallback-ids").split(/\s+/).includes(id)));
      };
      const change = (name, index, element, attribute, value) => {
        select(index);
        const before = inspect(index);
        const original = element.getAttribute(attribute);
        let broken;
        try { element.setAttribute(attribute, value); broken = inspect(index); }
        finally {
          if (original === null) element.removeAttribute(attribute);
          else element.setAttribute(attribute, original);
        }
        records.push({ name, before, broken, restored: inspect(index) });
      };
      for (const [index, { id, target }] of entries.entries()) {
        change(`missing-artwork ${id}`, index, target, "style",
          `${target.getAttribute("style") || ""};display:none!important`);
      }
      const label = entries[1].target.parentElement.querySelector("text");
      change("native-paint DB label", 1, label, "style",
        `${label.getAttribute("style") || ""};fill:red!important;-webkit-text-fill-color:red!important`);
      const connector = entries[1].deck.querySelector('[data-pptx-native="connector"]');
      change("native-paint connector", 1, connector, "style", "stroke:red!important;marker-end:url(#wrong)!important");
      change("other-artwork exposed", 1, entries[2].target, "class", "");
      change("other-artwork descendant override", 1, entries[5].target.querySelector("path"), "style", "visibility:visible!important;stroke:red");
      const wrongId = entries[2].target.getAttribute("data-pptx-fallback-ids");
      change("ownership wrong source", 1, entries[1].target, "data-pptx-fallback-ids", wrongId);
      select(1);
      const beforeSelection = inspect(1);
      select(2);
      const wrongSelection = inspect(1);
      select(1);
      records.push({ name: "missing-artwork wrong selection", before: beforeSelection,
        broken: wrongSelection, restored: inspect(1) });
      change("content path", 4, entries[4].target, "d", `${entries[4].target.getAttribute("d")} l1,0`);
      change("geometry shifted target", 4, entries[4].target, "style",
        `${entries[4].target.getAttribute("style") || ""};transform:translateX(2px)!important`);
      select(4);
      const entry = entries[4], fallback = window.__presentationPptxModel.slides[2].fallbacks[entry.fallbackIndex];
      const originalX = fallback.x, before = inspect(4);
      let broken;
      try { fallback.x += 2; broken = inspect(4); } finally { fallback.x = originalX; }
      records.push({ name: "crop shifted", before, broken, restored: inspect(4) });
      document.querySelectorAll(".pptx-fallback-hidden").forEach((part) => part.classList.remove("pptx-fallback-hidden"));
      delete window.__systemsContract;
      return records;
    });
    expect(controls).toHaveLength(18);
    for (const { name, before, broken, restored } of controls) {
      expect(before.errors, `${name} baseline`).toEqual([]);
      expect(broken.errors.some((error) => error.startsWith(`${name.split(" ")[0]}:`)), `${name}: ${JSON.stringify(broken)}`).toBe(true);
      expect(restored.errors, `${name} restored`).toEqual([]);
    }
  } finally { await harness.close(); }
});

runtimeTest("actual systems PPTX preserves captured media bytes, picture associations, placement and paint order", async ({ page }) => {
  test.setTimeout(120_000);
  const { rendered, captured, files } = await exportSystems();
  const associations = assertSystemsPackage(files, rendered.model, captured);
  for (const { slideIndex, fallbackIndex, media } of associations) {
    const image = captured[slideIndex].find((image) => image.fallbackIndex === fallbackIndex);
    expect(image.width).toBeGreaterThan(0);
    expect(image.height).toBeGreaterThan(0);
    expect(image.width).toBeLessThan(1280);
    expect(image.height).toBeLessThan(720);
    const png = await page.evaluate(async (data) => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
      return { width: image.width, height: image.height,
        painted: context.getImageData(0, 0, image.width, image.height).data.some((value, index) => index % 4 === 3 && value > 0) };
    }, files.get(media).toString("base64"));
    expect(png.painted, "Embedded image is not blank").toBe(true);
    expect(png.width).toBe(image.width);
    expect(png.height).toBe(image.height);
    const corrupt = new Map(files);
    const changed = Buffer.from(files.get(media)); changed[changed.length - 1] ^= 1;
    corrupt.set(media, changed);
    expect(() => assertSystemsPackage(corrupt, rendered.model, captured), `corrupted ${media}`).toThrow(/captured media integrity/);
  }
  for (const [index, association] of associations.entries()) {
    const wrong = new Map(files), other = associations[(index + 1) % associations.length];
    const rels = files.get(association.relsName).toString("utf8").replace(
      new RegExp(`<Relationship\\b(?=[^>]*Id="${association.relationship}")[^>]*\\/>`),
      (relation) => relation.replace(`Target="${association.target}"`, `Target="${other.target}"`));
    wrong.set(association.relsName, Buffer.from(rels));
    expect(() => assertSystemsPackage(wrong, rendered.model, captured), `wrong media for ${association.media}`)
      .toThrow(/captured media integrity/);
  }
  expect(() => assertSystemsPackage(files, rendered.model, captured), "negative controls leave original package intact").not.toThrow();
});
