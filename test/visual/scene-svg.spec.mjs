import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import { startHarness } from "../harness/server.mjs";
import { getSlideFrame, waitForSlideReady } from "../utils/ready.mjs";

const architecture = {
  title: "Shared SVG", canvas: { width: 1200, height: 500 },
  elements: [
    { type: "node", id: "client", x: 60, y: 100, width: 300, height: 140, text: "Client", icon: "server" },
    { type: "node", id: "api", x: 650, y: 100, width: 300, height: 140, text: "API", shape: "rounded-rect" },
    { type: "connector", from: "client", to: "api", label: "Request", arrow: true, labelLayer: "front" },
  ],
};
const classRelationsSlide = `# Class relationships\n\n\`\`\`mermaid\n${await readFile(new URL("../fixtures/mermaid/class-relations.mmd", import.meta.url), "utf8")}\n\`\`\``;
const sequencePathsSlide = `# Sequence paths\n\n\`\`\`mermaid\n${await readFile(new URL("../fixtures/mermaid/sequence-paths.mmd", import.meta.url), "utf8")}\n\`\`\``;
const sequenceDecorationsSlide = `# Sequence decorations\n\n\`\`\`mermaid\n${await readFile(new URL("../fixtures/mermaid/sequence-decorations.mmd", import.meta.url), "utf8")}\n\`\`\``;
const flowchartAdditionalShapesSlide = `# Additional flowchart shapes\n\n\`\`\`mermaid\n${await readFile(new URL("../fixtures/mermaid/flowchart-additional-shapes.mmd", import.meta.url), "utf8")}\n\`\`\``;
const classContainersSlide = `# Class containers\n\n\`\`\`mermaid\n${await readFile(new URL("../fixtures/mermaid/class-containers.mmd", import.meta.url), "utf8")}\n\`\`\``;
const paintAlphaSlide = `# Paint alpha\n\n\`\`\`mermaid\n${await readFile(new URL("../fixtures/mermaid/paint-alpha.mmd", import.meta.url), "utf8")}\n\`\`\``;
const packetSlide = `# Packet\n\n\`\`\`mermaid\n${await readFile(new URL("../fixtures/mermaid/packet.mmd", import.meta.url), "utf8")}\n\`\`\``;
const treeViewSlide = `# treeView\n\n\`\`\`mermaid\n${await readFile(new URL("../fixtures/mermaid/tree-view.mmd", import.meta.url), "utf8")}\n\`\`\``;
const stateBasicSlide = `# State diagram\n\n\`\`\`mermaid\n${await readFile(new URL("../fixtures/mermaid/state-basic.mmd", import.meta.url), "utf8")}\n\`\`\``;
const erBasicSlide = `# ER diagram\n\n\`\`\`mermaid\n${await readFile(new URL("../fixtures/mermaid/er-basic.mmd", import.meta.url), "utf8")}\n\`\`\``;
const requirementSource = await readFile(new URL("../fixtures/mermaid/requirement-basic.mmd", import.meta.url), "utf8");
const requirementBasicSlide = `# Requirement diagram\n\n\`\`\`mermaid\n${requirementSource}\n\`\`\``;
const requirementHiddenSlide = `# Hidden requirement content\n\n\`\`\`mermaid\n${requirementSource.replace(
  '{"handDrawnSeed": 42}',
  JSON.stringify({
    handDrawnSeed: 42,
    themeCSS:
      ".nodes .node{visibility:hidden} " +
      ".edge-pattern-dashed{visibility:hidden}",
  }),
)}\n\`\`\``;
const requirementHiddenTextSlide = `# Hidden requirement text\n\n\`\`\`mermaid\n${requirementSource.replace(
  '{"handDrawnSeed": 42}',
  JSON.stringify({
    handDrawnSeed: 42,
    themeCSS:
      ".highlighted .label{display:none} " +
      ".node span{color:transparent!important}",
  }),
)}\n\`\`\``;
const requirementTransformedSlide = `# Transformed requirement text\n\n\`\`\`mermaid\n${requirementSource.replace(
  '{"handDrawnSeed": 42}',
  JSON.stringify({
    handDrawnSeed: 42,
    themeCSS:
      ".highlighted span{text-transform:uppercase} " +
      ".edgeLabel span{text-transform:uppercase}",
  }),
)}\n\`\`\``;
const requirementDecoratedLabelSlide = `# Decorated transparent requirement label\n\n\`\`\`mermaid\n${requirementSource.replace(
  '{"handDrawnSeed": 42}',
  JSON.stringify({
    handDrawnSeed: 42,
    themeCSS:
      ".edgeLabel:nth-child(2) span{" +
      "color:transparent!important;" +
      "background-color:transparent!important} " +
      ".edgeLabel:nth-child(2) p{background-color:red!important}",
  }),
)}\n\`\`\``;
const rotatedTextSlide = [
  "# Rotated Mermaid text",
  "",
  "```mermaid",
  '%%{init: {"themeCSS": "text.messageText:first-of-type{transform-box:fill-box;transform-origin:center;transform:rotate(30deg)}"}}%%',
  "sequenceDiagram",
  "participant A as Client",
  "participant B as Service",
  "A->>B: Rotated",
  "B-->>A: Plain",
  "```",
].join("\n");
const slides = [
  `# Architecture\n\n\`\`\`architecture\n${JSON.stringify(architecture)}\n\`\`\``,
  "# Mermaid\n\n```mermaid\nflowchart LR\nA[Client] -->|Request| B(API)\nB --> C[(Database)]\n```",
  "# Sequence Mermaid\n\n```mermaid\nsequenceDiagram\nAlice->>Bob: Hello\nBob-->>Alice: Reply\n```",
  "# Unsupported Mermaid\n\n```mermaid\npie title Shares\n\"One\" : 40\n\"Two\" : 60\n```",
  "# Nested Mermaid\n\n```mermaid\nflowchart TB\nsubgraph Cloud\nA --> B{Check}\nB -->|Yes| C((Done))\nend\n```",
  "# Styled Mermaid\n\n```mermaid\nflowchart LR\nA[Styled]:::red --> B([Done])\nclassDef red fill:#ffdddd,stroke:#ff0000,stroke-width:3px,color:#111111\n```",
  "# Class Mermaid\n\n```mermaid\nclassDiagram\nclass Animal {\n+String name\n+walk()\n}\nAnimal <|-- Duck\n```",
  ...await Promise.all(["class-hollow", "flowchart-cross", "sequence-cross"].map(async (name) =>
    `# Hollow and cross markers\n\n\`\`\`mermaid\n${await readFile(new URL(`../fixtures/mermaid/${name}.mmd`, import.meta.url), "utf8")}\n\`\`\``)),
  classRelationsSlide,
  sequencePathsSlide,
  sequenceDecorationsSlide,
  flowchartAdditionalShapesSlide,
  classContainersSlide,
  paintAlphaSlide,
  rotatedTextSlide,
  packetSlide,
  treeViewSlide,
  stateBasicSlide,
  erBasicSlide,
  requirementBasicSlide,
  requirementHiddenSlide,
  requirementHiddenTextSlide,
  requirementTransformedSlide,
  requirementDecoratedLabelSlide,
];

const customThemeCss = ":root{--bg:#102030;--fg:#f8fafc;--body:#d7e3f0;--muted:#abbdd0;--surface:#203448;--border:#486580;--accent:#39b8f2;--accent-strong:#72d4ff;--accent-soft:#163b50;}";

// Mirrored sequence actors acquire Chromium subpixel rounding when scene SVGs are reinserted.
// Keep that workaround in this byte-for-byte loop; cross-surface and PPTX tests cover the full fixtures.
const fidelitySlides = slides.map((slide) =>
  slide === sequencePathsSlide || slide === sequenceDecorationsSlide
    ? slide.replace('"handDrawnSeed": 42', '"handDrawnSeed": 42, "sequence": {"mirrorActors": false}')
    : slide);

async function assertBackend(page, count) {
  const slide = await getSlideFrame(page);
  await expect(slide.locator("svg[data-scene-backend=svg]")).toHaveCount(count);
  expect(await slide.locator("svg[data-scene-backend=svg]").evaluateAll((svgs) =>
    svgs.every((svg) => svg.__presentationScene && (svg.hasAttribute("data-scene-source-path") || svg.querySelectorAll("[data-scene-source-path]").length > 0)),
  )).toBe(true);
}

for (const theme of ["dark", "light", "microsoft", "custom"]) {
  test(`shared backend displays both producers and faithful fallback in ${theme}`, async ({ page }) => {
    test.setTimeout(120_000);
    const harness = await startHarness({ slides: fidelitySlides, theme, customThemeCss: theme === "custom" ? customThemeCss : "" });
    await page.addInitScript(() => {
      const replaceWith = Element.prototype.replaceWith;
      Element.prototype.replaceWith = function (...nodes) {
        if (this.localName === "svg" && nodes[0]?.getAttribute?.("data-scene-source") === "mermaid") {
          nodes[0].__originalMermaidSvg = this;
        }
        return replaceWith.apply(this, nodes);
      };
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error" || message.text().startsWith("mermaid-svg-source-fallback:")) errors.push(message.text()); });
    try {
      for (let index = 0; index < slides.length; index++) {
        await page.request.post(`${harness.url}/navigate`, { data: { index } });
        await page.goto(`${harness.url}?present=1`);
        const slide = await waitForSlideReady(page);
        await assertBackend(page, 1);
        const svg = slide.locator("svg[data-scene-backend=svg]");
        const before = await svg.screenshot();
        if (index > 0) {
          await svg.evaluate((element) => {
            const original = element.__originalMermaidSvg;
            original.__sharedSceneSvg = element;
            element.replaceWith(original);
          });
          expect(await slide.locator(".mermaid svg").screenshot()).toEqual(before);
          await slide.locator(".mermaid svg").evaluate((element) => element.replaceWith(element.__sharedSceneSvg));
        }
        await svg.evaluate(async (element) => {
          const { sceneToSvg } = await import("./renderer/scene-svg.mjs");
          const scene = JSON.parse(JSON.stringify(element.__presentationScene));
          element.replaceWith(sceneToSvg(scene));
        });
        await assertBackend(page, 1);
        expect(await slide.locator("svg[data-scene-backend=svg]").screenshot()).toEqual(before);
        if (index === 0) {
          await expect(slide.locator("[data-architecture-icon=server]")).toHaveCount(1);
          await expect(slide.locator("[data-architecture-id=client]")).toHaveAttribute("data-scene-source-path", "elements[0]");
        } else if (index === 2) {
          await expect(slide.locator("svg[data-scene-backend=svg]")).toContainText("Hello");
          expect(await slide.locator("svg[data-scene-backend=svg]").evaluate((element) =>
            element.__presentationScene.nodes.some((node) => node.kind === "connector" && node.sourcePath.startsWith("sequence[")),
          )).toBe(true);
        } else if (index === 3) {
          await expect(slide.locator("svg[data-scene-backend=svg]")).toContainText("Shares");
          expect(await slide.locator("svg[data-scene-backend=svg]").evaluate((element) =>
            element.__presentationScene.nodes.some((node) => node.kind === "fallback"),
          )).toBe(true);
        } else if (index === 6) {
          const paths = await slide.locator("svg[data-scene-backend=svg]").evaluate((element) => ({
            labels: element.__presentationScene.nodes.filter((node) => /^classes\[\d+\]\.labels\[/.test(node.sourcePath)).map((node) => node.sourcePath),
            rendered: [...element.querySelectorAll("[data-scene-source-path]")].map((node) => node.dataset.sceneSourcePath),
          }));
          expect(paths.labels.length).toBeGreaterThan(0);
          for (const path of paths.labels) expect(paths.rendered).toContain(path);
        }
      }
      expect(errors).toEqual([]);
    } finally { await harness.close(); }
  });
}

test("default fixed preview, presenter, PNG and PDF use the same shared scene structure", async ({ browser }) => {
  test.setTimeout(240_000);
  const surfaceSlides = [
    slides[0],
    slides[1],
    classRelationsSlide,
    sequencePathsSlide,
    sequenceDecorationsSlide,
    flowchartAdditionalShapesSlide,
    classContainersSlide,
    paintAlphaSlide,
    rotatedTextSlide,
    packetSlide,
    treeViewSlide,
    stateBasicSlide,
    erBasicSlide,
    requirementBasicSlide,
    ...slides.slice(7, 10),
  ];
  const harness = await startHarness({ slides: surfaceSlides });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  try {
    for (const index of surfaceSlides.keys()) {
      await page.request.post(`${harness.url}/navigate`, { data: { index } });
      await page.goto(`${harness.url}/?responsive=1`);
      await waitForSlideReady(page);
      await expect(page.locator("body")).not.toHaveClass(/fixed-preview-mode/);
      await expect(page.locator(index === 0 ? "svg.architecture-svg" : ".mermaid svg").first())
        .toHaveAttribute("data-scene-backend", "svg");
      const signatures = [];
      const views = [
        "",
        "?present=1",
        "?preview=1",
        `?capture=1&token=${harness.printToken}&index=${index}`,
        `?print=1&token=${harness.printToken}`,
      ];
      for (const query of views) {
        await page.goto(`${harness.url}/${query}`);
        if (query.includes("print=")) await expect(page.locator("html"))
          .toHaveAttribute("data-print-ready", "true", { timeout: 30_000 });
        else if (query.includes("capture=")) await expect(page.locator("html"))
          .toHaveAttribute("data-capture-ready", "true", { timeout: 30_000 });
        else await waitForSlideReady(page);
        if (!query) {
          await expect(page.locator("body")).toHaveClass(/fixed-preview-mode/);
        }
        const svg = (await getSlideFrame(page)).locator(index === 0 ? "svg.architecture-svg" : ".mermaid svg")
          .nth(query.includes("print=") && index > 0 ? index - 1 : 0);
        await expect(svg).toHaveAttribute("data-scene-backend", "svg");
        signatures.push(await svg.evaluate((element) => ({
          pathCount: element.querySelectorAll("path").length,
          shapeCounts: Object.fromEntries(
            ["circle", "ellipse", "line", "path", "polygon", "rect"].map((tag) => [
              tag,
              element.querySelectorAll(tag).length,
            ]),
          ),
          text: [...element.querySelectorAll("text, span.edgeLabel")].map((label) => label.textContent),
          sceneNodes: element.__presentationScene.nodes.map((node) => [
            node.kind,
            node.sourcePath,
          ]),
          nodes: [...element.querySelectorAll("[data-architecture-id]")].map((node) => [node.getAttribute("data-architecture-id"), node.getAttribute("data-scene-source-path")]),
        })));
        if (query.includes("capture=")) expect((await page.screenshot()).length).toBeGreaterThan(1000);
        if (query.includes("print=")) {
          await assertBackend(page, surfaceSlides.length);
          expect((await page.pdf()).subarray(0, 5).toString()).toBe("%PDF-");
        }
      }
      for (const signature of signatures) expect(signature).toEqual(signatures[0]);
    }
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await harness.close();
  }
});

test("an invalid Mermaid block does not bypass the backend for valid sibling diagrams", async ({ page }) => {
  const harness = await startHarness({ slides: [
    "# Mixed input\n\n```mermaid\nflowchart LR\nA --> B\n```\n\n```mermaid\nnot-a-diagram invalid\n```\n\n```mermaid\nflowchart LR\nC --> D\n```",
  ] });
  try {
    await page.goto(harness.url);
    const slide = await waitForSlideReady(page);
    await assertBackend(page, 3);
    await expect(slide.locator(".mermaid").nth(0)).toContainText("A");
    await expect(slide.locator(".mermaid").nth(1)).toContainText("Syntax error");
    await expect(slide.locator(".mermaid").nth(2)).toContainText("D");
  } finally { await harness.close(); }
});

test("safe Mermaid primitive capture retains curves, HTML labels and unknown visuals without executable DOM", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Safe scene"] });
  try {
    await page.goto(harness.url);
    const result = await page.evaluate(async () => {
      const { captureSvgTree, sceneToSvg } = await import("./renderer/scene-svg.mjs");
      const { createScene, normalizeScene } = await import("./renderer/scene-graph.mjs");
      const source = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
        <path d="M0 0 Q50 100 200 0" stroke="red"/>
        <g name="Actor"><circle cx="10" cy="10" r="5"/></g>
        <foreignObject width="150" height="40"><div xmlns="http://www.w3.org/1999/xhtml"><b>Rich</b><br/>label<img src="javascript:alert(1)" onerror="alert(1)"/></div></foreignObject>
        <script>alert(1)</script><image href="javascript:alert(1)" onload="alert(1)"/>
      </svg>`, "image/svg+xml").documentElement;
      const scene = normalizeScene(createScene({ width: 200, height: 100, source: { kind: "mermaid", path: "fixture" }, nodes: [
        { kind: "fallback", sourcePath: "svg", z: 0, bounds: { x: 0, y: 0, width: 200, height: 100 }, reason: "unknown",
          meta: { svg: captureSvgTree(source, { computedStyle: null }) } },
      ] })).scene;
      const svg = sceneToSvg(scene);
      return {
        path: svg.querySelector("path").getAttribute("d"), label: svg.querySelector("foreignObject").textContent,
        name: svg.querySelector("g").getAttribute("name"),
        executable: svg.querySelectorAll("script,[onload],[onerror],[href^='javascript:'],[src^='javascript:']").length,
        lineBreaks: svg.querySelectorAll("br").length,
      };
    });

    expect(result).toEqual({
      path: "M0 0 Q50 100 200 0",
      label: "Richlabel",
      name: "Actor",
      executable: 0,
      lineBreaks: 1,
    });
  } finally { await harness.close(); }
});

test("captured relative paths keep attribute geometry without duplicate computed d", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Relative path capture"] });
  try {
    await page.goto(harness.url);
    const result = await page.evaluate(async () => {
      const {
        captureSvgTree,
        sceneToSvg,
      } = await import("./renderer/scene-svg.mjs");
      const {
        createScene,
        normalizeScene,
      } = await import("./renderer/scene-graph.mjs");
      const namespace = "http://www.w3.org/2000/svg";
      const source = document.createElementNS(namespace, "svg");
      source.setAttribute("viewBox", "0 0 3000 3000");
      const relative = document.createElementNS(namespace, "path");
      relative.setAttribute("d", "m0 0h10v20z");
      const longRelative = document.createElementNS(namespace, "path");
      const longD = `m0 0${"h1v1".repeat(2500)}z`;
      longRelative.setAttribute("d", longD);
      source.append(relative, longRelative);
      source.style.cssText =
        "position:absolute;left:-10000px;top:-10000px;width:1px;height:1px";
      document.body.append(source);

      const relativePrimitive = captureSvgTree(relative);
      const longPrimitive = captureSvgTree(longRelative);
      const scene = normalizeScene(createScene({
        width: 100,
        height: 100,
        source: { kind: "mermaid", path: "relative-paths.svg" },
        nodes: [
          {
            kind: "fallback",
            sourcePath: "relative",
            z: 0,
            bounds: { x: 0, y: 0, width: 10, height: 20 },
            reason: "test",
            meta: { svg: relativePrimitive },
          },
          {
            kind: "fallback",
            sourcePath: "long-relative",
            z: 1,
            bounds: { x: 0, y: 0, width: 50, height: 50 },
            reason: "test",
            meta: { svg: longPrimitive },
          },
        ],
      })).scene;
      const restored = sceneToSvg(scene);
      restored.style.cssText =
        "position:absolute;left:-10000px;top:-10000px;width:1px;height:1px";
      document.body.append(restored);
      const paths = [...restored.querySelectorAll("path")];
      const output = {
        source: [
          {
            attribute: relative.getAttribute("d"),
            computed: getComputedStyle(relative).d,
          },
          {
            attribute: longRelative.getAttribute("d"),
            computed: getComputedStyle(longRelative).d,
          },
        ],
        primitives: [relativePrimitive, longPrimitive].map((primitive) => ({
          attributeIsChunked: Array.isArray(primitive.attributes.d),
          attribute: Array.isArray(primitive.attributes.d)
            ? primitive.attributes.d.join("")
            : primitive.attributes.d,
          computedStyleD: primitive.style.d,
        })),
        restored: paths.map((path) => ({
          attribute: path.getAttribute("d"),
          inline: path.style.d,
          computed: getComputedStyle(path).d,
        })),
      };
      restored.remove();
      source.remove();
      return output;
    });
    expect(result.source[0]).toEqual({
      attribute: "m0 0h10v20z",
      computed: 'path("M 0 0 H 10 V 20 Z")',
    });
    expect(result.primitives[0]).toEqual({
      attributeIsChunked: false,
      attribute: "m0 0h10v20z",
      computedStyleD: undefined,
    });
    expect(result.restored[0]).toEqual({
      attribute: "m0 0h10v20z",
      inline: "",
      computed: 'path("M 0 0 H 10 V 20 Z")',
    });
    expect(result.primitives[1].attributeIsChunked).toBe(true);
    expect(result.primitives[1].attribute).toBe(result.source[1].attribute);
    expect(result.primitives[1].computedStyleD).toBeUndefined();
    expect(result.restored[1].attribute).toBe(result.source[1].attribute);
    expect(result.restored[1].inline).toBe("");
    expect(result.restored[1].computed).toBe(result.source[1].computed);
  } finally {
    await harness.close();
  }
});
