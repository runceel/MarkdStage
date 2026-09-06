import { expect, test } from "@playwright/test";
import { startHarness } from "../harness/server.mjs";
import { waitForSlideReady } from "../utils/ready.mjs";

const architecture = {
  title: "Shared SVG", canvas: { width: 1200, height: 500 },
  elements: [
    { type: "node", id: "client", x: 60, y: 100, width: 300, height: 140, text: "Client", icon: "server" },
    { type: "node", id: "api", x: 650, y: 100, width: 300, height: 140, text: "API", shape: "rounded-rect" },
    { type: "connector", from: "client", to: "api", label: "Request", arrow: true, labelLayer: "front" },
  ],
};
const slides = [
  `# Architecture\n\n\`\`\`architecture\n${JSON.stringify(architecture)}\n\`\`\``,
  "# Mermaid\n\n```mermaid\nflowchart LR\nA[Client] -->|Request| B(API)\nB --> C[(Database)]\n```",
  "# Sequence Mermaid\n\n```mermaid\nsequenceDiagram\nAlice->>Bob: Hello\nBob-->>Alice: Reply\n```",
  "# Unsupported Mermaid\n\n```mermaid\npie title Shares\n\"One\" : 40\n\"Two\" : 60\n```",
  "# Nested Mermaid\n\n```mermaid\nflowchart TB\nsubgraph Cloud\nA --> B{Check}\nB -->|Yes| C((Done))\nend\n```",
];

async function assertBackend(page, count) {
  await expect(page.locator("svg[data-scene-backend=svg]")).toHaveCount(count);
  expect(await page.locator("svg[data-scene-backend=svg]").evaluateAll((svgs) =>
    svgs.every((svg) => svg.__presentationScene && (svg.hasAttribute("data-scene-source-path") || svg.querySelectorAll("[data-scene-source-path]").length > 0)),
  )).toBe(true);
}

for (const theme of ["dark", "light", "microsoft"]) {
  test(`shared backend displays both producers and faithful fallback in ${theme}`, async ({ page }) => {
    const harness = await startHarness({ slides, theme });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error" || message.text().startsWith("mermaid-svg-source-fallback:")) errors.push(message.text()); });
    try {
      for (let index = 0; index < slides.length; index++) {
        await page.request.post(`${harness.url}/navigate`, { data: { index } });
        await page.goto(harness.url);
        await waitForSlideReady(page);
        await assertBackend(page, 1);
        const svg = page.locator("svg[data-scene-backend=svg]");
        const before = await svg.screenshot();
        await svg.evaluate(async (element) => {
          const { sceneToSvg } = await import("./renderer/scene-svg.mjs");
          const scene = JSON.parse(JSON.stringify(element.__presentationScene));
          element.replaceWith(sceneToSvg(scene));
        });
        await assertBackend(page, 1);
        expect(await page.locator("svg[data-scene-backend=svg]").screenshot()).toEqual(before);
        if (index === 0) {
          await expect(page.locator("[data-architecture-icon=server]")).toHaveCount(1);
          await expect(page.locator("[data-architecture-id=client]")).toHaveAttribute("data-scene-source-path", "elements[0]");
        } else if (index === 2) {
          await expect(page.locator("svg[data-scene-backend=svg]")).toContainText("Hello");
          expect(await page.locator("svg[data-scene-backend=svg]").evaluate((element) =>
            element.__presentationScene.nodes.some((node) => node.kind === "connector" && node.sourcePath.startsWith("sequence[")),
          )).toBe(true);
        } else if (index === 3) {
          await expect(page.locator("svg[data-scene-backend=svg]")).toContainText("Shares");
          expect(await page.locator("svg[data-scene-backend=svg]").evaluate((element) =>
            element.__presentationScene.nodes.some((node) => node.kind === "fallback"),
          )).toBe(true);
        }
      }
      expect(errors).toEqual([]);
    } finally { await harness.close(); }
  });
}

test("normal, presenter, fixed preview, PNG and PDF use the same shared scene rendering", async ({ browser }) => {
  const harness = await startHarness({ slides: slides.slice(0, 2) });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  try {
    for (const index of [0, 1]) {
      await page.request.post(`${harness.url}/navigate`, { data: { index } });
      const signatures = [];
      for (const query of ["", "?present=1", "?preview=1", "fixed", `?capture=1&token=${harness.printToken}&index=${index}`, `?print=1&token=${harness.printToken}`]) {
        await page.goto(`${harness.url}/${query === "fixed" ? "" : query}`);
        if (query.includes("print=")) await expect(page.locator("html")).toHaveAttribute("data-print-ready", "true");
        else if (query.includes("capture=")) await expect(page.locator("html")).toHaveAttribute("data-capture-ready", "true");
        else await waitForSlideReady(page);
        if (query === "fixed") {
          await page.locator("#navMore").click();
          await page.locator("#navFixedPreview").click();
          await expect(page.locator("body")).toHaveClass(/fixed-preview-mode/);
        }
        const svg = page.locator(index === 0 ? "svg.architecture-svg" : ".mermaid svg").first();
        await expect(svg).toHaveAttribute("data-scene-backend", "svg");
        signatures.push(await svg.evaluate((element) => ({
          viewBox: element.getAttribute("viewBox"),
          paths: [...element.querySelectorAll("path")].map((path) => path.getAttribute("d")),
          text: [...element.querySelectorAll("text")].map((label) => label.textContent),
          nodes: [...element.querySelectorAll("[data-architecture-id]")].map((node) => [node.getAttribute("data-architecture-id"), node.getAttribute("data-scene-source-path")]),
        })));
        if (query.includes("capture=")) expect((await page.screenshot()).length).toBeGreaterThan(1000);
        if (query.includes("print=")) {
          await assertBackend(page, 2);
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

test("safe Mermaid primitive capture retains curves, HTML labels and unknown visuals without executable DOM", async ({ page }) => {
  const harness = await startHarness({ slides: ["# Safe scene"] });
  try {
    await page.goto(harness.url);
    const result = await page.evaluate(async () => {
      const { captureSvgTree, sceneToSvg } = await import("./renderer/scene-svg.mjs");
      const { createScene, normalizeScene } = await import("./renderer/scene-graph.mjs");
      const source = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
        <path d="M0 0 Q50 100 200 0" stroke="red"/>
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
        executable: svg.querySelectorAll("script,[onload],[onerror],[href^='javascript:'],[src^='javascript:']").length,
        lineBreaks: svg.querySelectorAll("br").length,
      };
    });
    expect(result).toEqual({ path: "M0 0 Q50 100 200 0", label: "Richlabel", executable: 0, lineBreaks: 1 });
  } finally { await harness.close(); }
});
