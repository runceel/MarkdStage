import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, chromium } from "@playwright/test";
import { startHarness } from "../harness/server.mjs";
import { validateScene } from "../../.github/extensions/markdstage/renderer/scene-graph.mjs";
import { sceneToPptxElements } from "../../.github/extensions/markdstage/renderer/scene-pptx.mjs";
import { buildPptxPackage, inspectPptxPackage } from "../../.github/extensions/markdstage/runtime/pptx-package.mjs";
import { withDeckServer } from "../../packages/markdstage-cli/src/deck.mjs";
import { exportPptx } from "../../.github/extensions/markdstage/runtime/output.mjs";
import { runPptxOutputBrowser } from "../../.github/extensions/markdstage/runtime/browser.mjs";

// Fixed SVGs use Mermaid 11.15.0's default theme with fontFamily: "Arial",
// whose metric-compatible Liberation Sans substitution is available in Linux CI.
const fixtures = join(process.cwd(), "test", "fixtures", "mermaid");
const fixture = (name, extension = "svg") => readFile(join(fixtures, `${name}.${extension}`), "utf8");
const textOf = (node) => (node.text?.paragraphs || node.paragraphs || [])
  .map((paragraph) => paragraph.runs.map((run) => run.text).join("")).join("\n");

async function extract(page, name, mutate) {
  await page.evaluate(({ svg, name }) => {
    document.body.innerHTML = `<div id="fixture-deck" style="width:1000px;height:700px">${svg}</div>`;
    window.fixtureName = name;
  }, { svg: await fixture(name), name });
  if (mutate) await page.evaluate(mutate);
  return page.evaluate(async () => {
    const { mermaidSvgToScene } = await import("./renderer/mermaid-scene.mjs");
    const deck = document.querySelector("#fixture-deck");
    const result = mermaidSvgToScene(deck.querySelector("svg"), {
      deck, path: `${window.fixtureName}.svg`, includeSourceElements: true,
    });
    return {
      scene: result.scene,
      diagnostics: result.diagnostics,
      sources: [...result.sourceElements].map(([path, element]) => ({
        path, tag: element.localName, id: element.id,
        bounds: (() => {
          const bounds = element.getBoundingClientRect();
          const origin = deck.getBoundingClientRect();
          return { x: bounds.x - origin.x, y: bounds.y - origin.y,
            width: bounds.width, height: bounds.height };
        })(),
      })),
      ownershipConflicts: result.scene.nodes.filter((node) => node.kind === "fallback").flatMap((fallback) => {
        const source = result.sourceElements.get(fallback.sourcePath);
        return result.scene.nodes.filter((node) => node.kind !== "fallback" &&
          node.kind !== "group" && result.sourceElements.has(node.sourcePath) &&
          result.sourceElements.get(node.sourcePath).contains(source)).map((node) => node.sourcePath);
      }),
    };
  });
}

test("pinned kanban columns, cards, all HTML fields and priority bars are independently editable", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Kanban"] });
  try {
    await page.goto(harness.url);
    const result = await extract(page, "kanban-basic");
    validateScene(result.scene);
    expect(result.diagnostics).toEqual([]);
    expect(result.scene.nodes.filter((node) => node.kind === "shape")).toHaveLength(5);
    expect(result.scene.nodes.filter((node) => node.kind === "connector")).toHaveLength(2);
    const labels = result.scene.nodes.filter((node) => node.kind === "text");
    expect(labels.map(textOf)).toEqual([
      "Todo / 未着手", "Done / 完了", "設計\nDesign", "Review API", "42", "Alice", "Ship", "43", "Bob",
    ]);
    expect(labels[3].text.paragraphs[0].runs.find((run) => run.text === "API").bold).toBe(true);
    expect(labels.slice(2).every((node) => node.textLayout.alignment === "left")).toBe(true);
    for (const node of result.scene.nodes) {
      const source = result.sources.find((entry) => entry.path === node.sourcePath);
      expect(source, node.sourcePath).toBeTruthy();
      if (node.kind !== "shape") continue;
      for (const key of ["x", "y", "width", "height"]) {
        expect(Math.abs(node.bounds[key] - source.bounds[key])).toBeLessThanOrEqual(0.1);
      }
      expect(node.style.cornerRadius).toBe(5);
    }
    const mapped = sceneToPptxElements(result.scene);
    expect(mapped.fallbacks).toEqual([]);
    const bytes = buildPptxPackage({ slides: [{ elements: mapped.elements }] });
    expect(inspectPptxPackage(bytes).valid).toBe(true);
    const xml = bytes.toString("utf8");
    for (const text of ["Todo / 未着手", "設計", "Design", "Alice", "Bob", "42", "43"]) {
      expect(xml.split(`<a:t>${text}</a:t>`)).toHaveLength(2);
    }
    expect(xml).toContain('<a:gd name="adj" fmla="val 7353"/>');
    expect(xml).toContain('<a:gd name="adj" fmla="val 8929"/>');
  } finally {
    await harness.close();
  }
});

test("pinned block shapes reuse composite primitives and retain connector and HTML label order", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Block"] });
  try {
    await page.goto(harness.url);
    const result = await extract(page, "block-basic");
    validateScene(result.scene);
    expect(result.diagnostics).toEqual([]);
    expect(result.scene.nodes.map(textOf).filter(Boolean)).toEqual([
      "受付\nIntake", "Review", "承認", "Store", "Circle", "Subroutine", "Stadium", "Double", "送信\nSend",
    ]);
    const edges = result.scene.nodes.filter((node) => node.sourcePath.startsWith("block.edges["));
    expect(edges).toHaveLength(4);
    expect(edges.every((node) => node.kind === "connector" && node.arrowEnd === "triangle")).toBe(true);
    const edgeLabel = result.scene.nodes.find((node) => node.sourcePath.startsWith("block.edgeLabels"));
    expect(edgeLabel.z).toBeGreaterThan(edges[0].z);
    expect(edgeLabel.z).toBeLessThan(edges[1].z);
    expect(result.scene.nodes.filter((node) => node.kind === "group")
      .map((node) => node.meta.mermaid.shape)).toEqual(["cylinder", "subroutine", "double-circle"]);
    const mapped = sceneToPptxElements(result.scene);
    expect(mapped.fallbacks).toEqual([]);
    const bytes = buildPptxPackage({ slides: [{ elements: mapped.elements }] });
    expect(inspectPptxPackage(bytes).valid).toBe(true);
    const xml = bytes.toString("utf8");
    expect(xml.match(/<a:tailEnd type="triangle"\/>/g)).toHaveLength(4);
    expect(xml).toContain('<a:gd name="adj" fmla="val 50000"/>');
    for (const text of ["Store", "Subroutine", "Double", "受付", "送信"]) {
      expect(xml.split(`<a:t>${text}</a:t>`)).toHaveLength(2);
    }
  } finally {
    await harness.close();
  }
});

test("kanban and block keep unsafe subtrees local without losing labels or consuming native siblings", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Local fallback"] });
  try {
    await page.goto(harness.url);
    for (const { name, mutate, reason, text, count = 1 } of [
      { name: "block-hybrid", reason: "unsupported-mermaid-block-node-geometry", text: "Special" },
      {
        name: "block-basic", reason: "unsupported-mermaid-block-node-label", text: "Review",
        mutate: () => { document.querySelector("g.block > g.node .label p").style.backgroundColor = "red"; },
      },
      {
        name: "kanban-basic", reason: "unsupported-mermaid-kanban-card-label", text: "Alice",
        mutate: () => { document.querySelector("g.items > g.node .label p").style.textShadow = "2px 2px red"; },
      },
      {
        name: "kanban-basic", reason: "unsupported-mermaid-kanban-card-label", text: "Alice",
        mutate: () => { document.querySelector("g.items > g.node .label p").textContent = "A long label that exceeds the foreignObject and must retain the original clipping"; },
      },
      {
        name: "kanban-basic", reason: "unsupported-mermaid-kanban-card-style", text: "Alice",
        mutate: () => { document.querySelector("g.items > g.node").style.opacity = "0.5"; },
      },
      {
        name: "kanban-basic", reason: "unsupported-mermaid-kanban-column-style", text: "設計\nDesign",
        mutate: () => { document.querySelector("g.sections > g.cluster rect").style.filter = "blur(2px)"; },
      },
      {
        name: "block-basic", reason: "unsupported-mermaid-block-node-transform", text: "Review",
        mutate: () => { document.querySelector("g.block > g.node").style.transform = "rotate(12deg)"; },
      },
      {
        name: "block-basic", reason: "unsupported-mermaid-block-node-label", text: "Review",
        mutate: () => { document.querySelector("g.block > g.node .label p").innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><circle r="8" cx="10" cy="10"/></svg>'; },
      },
      {
        name: "block-basic", reason: "unsupported-mermaid-block-node-geometry", text: "Double",
        mutate: () => { document.querySelector('g.node[id$="-h"] > g > circle:last-child').setAttribute("cx", "8"); },
      },
    ]) {
      const result = await extract(page, name, mutate);
      const fallbacks = result.scene.nodes.filter((node) => node.kind === "fallback");
      expect(fallbacks, reason).toHaveLength(count);
      expect(fallbacks[0].reason).toBe(reason);
      expect(fallbacks[0].sourcePath).not.toBe("svg");
      expect(result.scene.nodes.map(textOf)).toContain(text);
      expect(result.ownershipConflicts).toEqual([]);
      expect(result.diagnostics).toContainEqual({
        path: fallbacks[0].sourcePath, kind: "fallback", reason,
      });
      expect(result.sources.some((entry) => entry.path === fallbacks[0].sourcePath)).toBe(true);
      expect(sceneToPptxElements(result.scene).fallbacks).toHaveLength(count);
    }
    const hidden = await extract(page, "kanban-basic", () => {
      document.querySelector("g.items > g.node").style.display = "none";
    });
    expect(hidden.diagnostics).toEqual([]);
    expect(hidden.scene.nodes.map(textOf)).not.toContain("設計\nDesign");
    expect(hidden.scene.nodes.map(textOf)).toContain("Alice");
    const hiddenBlock = await extract(page, "block-basic", () => {
      document.querySelector("g.block > g.node").style.display = "none";
    });
    expect(hiddenBlock.diagnostics).toEqual([]);
    expect(hiddenBlock.scene.nodes.map(textOf)).not.toContain("受付\nIntake");
    const hiddenOutline = await extract(page, "block-basic", () => {
      document.querySelector("g.block > g.node > rect").style.visibility = "hidden";
    });
    expect(hiddenOutline.scene.nodes.find((node) => node.sourcePath === "block.nodes[0]")).toBeUndefined();
    expect(hiddenOutline.scene.nodes.find((node) => textOf(node) === "受付\nIntake").kind).toBe("text");
    const hiddenEdge = await extract(page, "block-basic", () => {
      document.querySelector("g.block > path.flowchart-link").style.visibility = "hidden";
    });
    expect(hiddenEdge.scene.nodes.filter((node) => node.sourcePath.startsWith("block.edges["))).toHaveLength(3);
    expect(hiddenEdge.scene.nodes.map(textOf)).toContain("送信\nSend");
    const generated = await extract(page, "kanban-basic", () => {
      const style = document.createElement("style");
      style.textContent = '.items > .node:first-child .label:last-child span::before {content:"Generated";color:red}';
      document.head.append(style);
    });
    expect(generated.scene.nodes.filter((node) => node.kind === "fallback")).toMatchObject([{
      sourcePath: "kanban.kanban-card[0].parts[3]", reason: "unsupported-mermaid-kanban-card-label",
    }]);
    await page.evaluate(() => document.head.lastElementChild.remove());
    const scaled = await extract(page, "kanban-basic", () => {
      document.querySelector("svg").style.width = "212.5px";
    });
    expect(scaled.scene.nodes.find((node) => node.kind === "shape").style.cornerRadius).toBe(2.5);
    const limits = await page.evaluate(async () => {
      const { mermaidSvgToScene } = await import("./renderer/mermaid-scene.mjs");
      const { MAX_SCENE_NODES } = await import("./renderer/scene-graph.mjs");
      const svg = document.querySelector("svg");
      const g = document.createElementNS(svg.namespaceURI, "g");
      for (let index = 0; index < MAX_SCENE_NODES * 10; index++) {
        g.append(document.createElementNS(svg.namespaceURI, "g"));
      }
      svg.append(g);
      return mermaidSvgToScene(svg).diagnostics;
    });
    expect(limits[0].reason).toContain("mermaid-scene-limit-exceeded");
  } finally {
    await harness.close();
  }
});

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  test(`real renderer exports kanban and both block aliases with native masks and local hybrid output (${theme})`, async ({ page }) => {
    const kanban = await fixture("kanban-basic", "mmd");
    const block = await fixture("block-basic", "mmd");
    const hybrid = await fixture("block-hybrid", "mmd");
    const slides = [kanban, block, block.replace("block-beta", "block"), hybrid]
      .map((source, index) => `## Rank 12 / ${index + 1}\n\n\`\`\`mermaid\n${source}\n\`\`\``);
    const harness = await startHarness({
      slides, theme,
      customThemeCss: theme === "custom"
        ? "--bg:#102030;--fg:#fefefe;--body:#e0e4e8;--accent:#ff6600;--surface:#203040;--border:#405060;"
        : "",
    });
    try {
      await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`);
      await page.waitForFunction(() => document.documentElement.hasAttribute("data-pptx-ready") ||
        document.documentElement.hasAttribute("data-pptx-error"), undefined, { timeout: 120_000 });
      await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
      const model = await page.evaluate(() => window.__presentationPptxModel);
      const native = model.slides.map((slide) => slide.elements.filter((element) =>
        element.path?.startsWith("mermaid[0].")));
      expect(model.slides.slice(0, 3).flatMap((slide) =>
        slide.fallbacks.filter((fallback) => fallback.type === "mermaid"))).toEqual([]);
      expect(native[0].map(textOf)).toEqual(expect.arrayContaining(["設計\nDesign", "Review API", "42", "Alice", "43", "Bob"]));
      const withoutRenderIds = (elements) => JSON.stringify(elements).replace(/mermaid-\d+/g, "mermaid-render");
      expect(withoutRenderIds(native[2])).toEqual(withoutRenderIds(native[1]));
      expect(native[1].filter((element) => element.arrowEnd === "triangle")).toHaveLength(4);
      const fallbacks = model.slides[3].fallbacks.filter((fallback) => fallback.type === "mermaid");
      expect(fallbacks).toMatchObject([{
        sourcePath: "block.nodes[1].parts[0]", reason: "unsupported-mermaid-block-node-geometry",
      }]);
      expect(native[3].map(textOf)).toContain("Special");
      const svgs = page.locator("pre.mermaid > svg");
      const kanbanSvg = svgs.nth(0);
      await expect(kanbanSvg.locator("g.items > g.node > rect[data-pptx-native=shape]")).toHaveCount(3);
      await expect(kanbanSvg.locator("g.items > g.node > line[data-pptx-native=connector]")).toHaveCount(2);
      await expect(kanbanSvg.locator("g.items > g.node > g.label[data-pptx-native=text]")).toHaveCount(7);
      expect(await kanbanSvg.evaluate((svg) => [...svg.querySelectorAll("[data-pptx-native=text] span")]
        .map((label) => getComputedStyle(label).color)))
        .toEqual(Array(9).fill("rgba(0, 0, 0, 0)"));
      const hybridSvg = svgs.nth(3);
      await expect(hybridSvg.locator("polygon[data-pptx-fallback-ids]")).toHaveCount(1);
      await expect(hybridSvg.locator("polygon[data-pptx-native]")).toHaveCount(0);
      await expect(hybridSvg.locator('g.node:has(polygon) > g.label[data-pptx-native=text]')).toHaveCount(1);
      expect(await hybridSvg.getAttribute("data-pptx-fallback-ids")).toBeNull();
      const bytes = buildPptxPackage({ slides: native.slice(0, 3).map((elements) => ({ elements })) });
      expect(inspectPptxPackage(bytes).valid).toBe(true);
      await writeFile(test.info().outputPath(`${theme}-native.pptx`), bytes);
      await writeFile(test.info().outputPath(`${theme}-model.json`), JSON.stringify(model, null, 2));
      await test.info().attach(`${theme}-native-pptx`, {
        path: test.info().outputPath(`${theme}-native.pptx`),
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });
    } finally {
      await harness.close();
    }
  });
}

test("actual kanban/block PowerPoint package embeds local label and outline artwork exactly once", async () => {
  test.setTimeout(120_000);
  const directory = test.info().outputPath();
  const kanban = (await fixture("kanban-basic", "mmd")).replace("Review **API**", "<u>Review API</u>");
  const block = (await fixture("block-hybrid", "mmd")).replace("Decorated label", "<u>Decorated label</u>");
  const markdown = [
    "# Hybrid rank 12",
    ...[kanban, block].map((source) => `## Local artwork\n\n\`\`\`mermaid\n${source}\n\`\`\``),
  ].join("\n\n---\n\n");
  const file = join(directory, "slides.md");
  await writeFile(file, markdown);
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
    const fallbackPaths = [];
    for (const index of [1, 2]) {
      const slide = rendered.model.slides[index];
      const native = slide.elements.filter((element) => element.path?.startsWith("mermaid[0]."));
      expect(native.map(textOf)).toContain(index === 1 ? "Alice" : "Special");
      for (const image of rendered.slideFallbackImages[index]) {
        const fallback = slide.fallbacks[image.fallbackIndex];
        if (fallback.type !== "mermaid") continue;
        fallbackPaths.push(fallback.sourcePath);
        expect(image.width).toBeGreaterThan(0);
        expect(image.height).toBeGreaterThan(0);
        expect(bytes.indexOf(image.data)).toBeGreaterThan(0);
        expect(bytes.indexOf(image.data, bytes.indexOf(image.data) + 1)).toBe(-1);
        expect(native.some((element) => element.path === fallback.path)).toBe(false);
      }
    }
    expect(fallbackPaths).toEqual([
      "kanban.kanban-card[1].parts[1]", "block.nodes[1].parts[0]", "block.nodes[3].parts[1]",
    ]);
    for (const label of ["Alice", "Special", "Neighbor"]) {
      expect(bytes.toString("utf8").split(`<a:t>${label}</a:t>`)).toHaveLength(2);
    }
    await test.info().attach("actual-editable-hybrid-pptx", {
      path: output, contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
  });
});
