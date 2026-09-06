# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: visual/scene-svg.spec.mjs >> shared backend displays both producers and faithful fallback in microsoft
- Location: test/visual/scene-svg.spec.mjs:28:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Page snapshot

```yaml
- generic [active] [ref=f6e1]:
  - generic [ref=f6e3]:
    - banner [ref=f6e4]:
      - heading "Sequence Mermaid" [level=1] [ref=f6e5]
    - document [ref=f6e8]:
      - generic [ref=f6e9]: Bob
      - generic [ref=f6e12]: Alice
      - generic [ref=f6e15]: Bob
      - generic [ref=f6e19]: Alice
      - generic [ref=f6e23]: Hello
      - generic [ref=f6e24]: Reply
  - navigation "Slide controls" [ref=f6e25]:
    - group "Slide navigation" [ref=f6e26]:
      - button "Previous slide" [ref=f6e27] [cursor=pointer]: ◀
      - generic [ref=f6e28]: 3 / 4
      - button "Next slide" [ref=f6e29] [cursor=pointer]: ▶
      - button "Slide list" [ref=f6e30] [cursor=pointer]: ☰
    - button "More controls" [ref=f6e32] [cursor=pointer]: ⋯
  - status [ref=f6e35]
  - alert [ref=f6e36]
```

# Test source

```ts
  1   | import { expect, test } from "@playwright/test";
  2   | import { startHarness } from "../harness/server.mjs";
  3   | import { waitForSlideReady } from "../utils/ready.mjs";
  4   | 
  5   | const architecture = {
  6   |   title: "Shared SVG", canvas: { width: 1200, height: 500 },
  7   |   elements: [
  8   |     { type: "node", id: "client", x: 60, y: 100, width: 300, height: 140, text: "Client", icon: "server" },
  9   |     { type: "node", id: "api", x: 650, y: 100, width: 300, height: 140, text: "API", shape: "rounded-rect" },
  10  |     { type: "connector", from: "client", to: "api", label: "Request", arrow: true, labelLayer: "front" },
  11  |   ],
  12  | };
  13  | const slides = [
  14  |   `# Architecture\n\n\`\`\`architecture\n${JSON.stringify(architecture)}\n\`\`\``,
  15  |   "# Mermaid\n\n```mermaid\nflowchart LR\nA[Client] -->|Request| B(API)\nB --> C[(Database)]\n```",
  16  |   "# Sequence Mermaid\n\n```mermaid\nsequenceDiagram\nAlice->>Bob: Hello\nBob-->>Alice: Reply\n```",
  17  |   "# Unsupported Mermaid\n\n```mermaid\npie title Shares\n\"One\" : 40\n\"Two\" : 60\n```",
  18  | ];
  19  | 
  20  | async function assertBackend(page, count) {
  21  |   await expect(page.locator("svg[data-scene-backend=svg]")).toHaveCount(count);
  22  |   expect(await page.locator("svg[data-scene-backend=svg]").evaluateAll((svgs) =>
  23  |     svgs.every((svg) => svg.__presentationScene && svg.querySelectorAll("[data-scene-source-path]").length > 0),
> 24  |   )).toBe(true);
      |      ^ Error: expect(received).toBe(expected) // Object.is equality
  25  | }
  26  | 
  27  | for (const theme of ["dark", "light", "microsoft"]) {
  28  |   test(`shared backend displays both producers and faithful fallback in ${theme}`, async ({ page }) => {
  29  |     const harness = await startHarness({ slides, theme });
  30  |     const errors = [];
  31  |     page.on("pageerror", (error) => errors.push(error.message));
  32  |     page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  33  |     try {
  34  |       for (let index = 0; index < slides.length; index++) {
  35  |         await page.request.post(`${harness.url}/navigate`, { data: { index } });
  36  |         await page.goto(harness.url);
  37  |         await waitForSlideReady(page);
  38  |         await assertBackend(page, 1);
  39  |         const svg = page.locator("svg[data-scene-backend=svg]");
  40  |         const before = await svg.screenshot();
  41  |         await svg.evaluate(async (element) => {
  42  |           const { sceneToSvg } = await import("./renderer/scene-svg.mjs");
  43  |           const scene = JSON.parse(JSON.stringify(element.__presentationScene));
  44  |           element.replaceWith(sceneToSvg(scene));
  45  |         });
  46  |         await assertBackend(page, 1);
  47  |         expect(await page.locator("svg[data-scene-backend=svg]").screenshot()).toEqual(before);
  48  |         if (index === 0) {
  49  |           await expect(page.locator("[data-architecture-icon=server]")).toHaveCount(1);
  50  |           await expect(page.locator("[data-architecture-id=client]")).toHaveAttribute("data-scene-source-path", "elements[0]");
  51  |         } else if (index === 2) {
  52  |           await expect(page.locator("svg[data-scene-backend=svg]")).toContainText("Hello");
  53  |         } else if (index === 3) {
  54  |           await expect(page.locator("svg[data-scene-backend=svg]")).toContainText("Shares");
  55  |           expect(await page.locator("svg[data-scene-backend=svg]").evaluate((element) =>
  56  |             element.__presentationScene.nodes.some((node) => node.kind === "fallback"),
  57  |           )).toBe(true);
  58  |         }
  59  |       }
  60  |       expect(errors).toEqual([]);
  61  |     } finally { await harness.close(); }
  62  |   });
  63  | }
  64  | 
  65  | test("normal, presenter, fixed preview, PNG and PDF use the same shared scene rendering", async ({ browser }) => {
  66  |   const harness = await startHarness({ slides: slides.slice(0, 2) });
  67  |   const page = await browser.newPage();
  68  |   const errors = [];
  69  |   page.on("pageerror", (error) => errors.push(error.message));
  70  |   page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  71  |   try {
  72  |     const signatures = [];
  73  |     for (const query of ["", "?present=1", "?preview=1", "fixed", `?capture=1&token=${harness.printToken}&index=0`, `?print=1&token=${harness.printToken}`]) {
  74  |       await page.goto(`${harness.url}/${query === "fixed" ? "" : query}`);
  75  |       if (query.includes("print=")) await expect(page.locator("html")).toHaveAttribute("data-print-ready", "true");
  76  |       else if (query.includes("capture=")) await expect(page.locator("html")).toHaveAttribute("data-capture-ready", "true");
  77  |       else await waitForSlideReady(page);
  78  |       if (query === "fixed") {
  79  |         await page.locator("#navMore").click();
  80  |         await page.locator("#navFixedPreview").click();
  81  |         await expect(page.locator("body")).toHaveClass(/fixed-preview-mode/);
  82  |       }
  83  |       const svg = page.locator("svg.architecture-svg").first();
  84  |       await expect(svg).toHaveAttribute("data-scene-backend", "svg");
  85  |       signatures.push(await svg.evaluate((element) => ({
  86  |         viewBox: element.getAttribute("viewBox"),
  87  |         paths: [...element.querySelectorAll("path")].map((path) => path.getAttribute("d")),
  88  |         text: [...element.querySelectorAll("text")].map((label) => label.textContent),
  89  |         nodes: [...element.querySelectorAll("[data-architecture-id]")].map((node) => [node.getAttribute("data-architecture-id"), node.getAttribute("data-scene-source-path")]),
  90  |       })));
  91  |       if (query.includes("capture=")) expect((await page.screenshot()).length).toBeGreaterThan(1000);
  92  |       if (query.includes("print=")) {
  93  |         await assertBackend(page, 2);
  94  |         expect((await page.pdf()).subarray(0, 5).toString()).toBe("%PDF-");
  95  |       }
  96  |     }
  97  |     for (const signature of signatures) expect(signature).toEqual(signatures[0]);
  98  |     expect(errors).toEqual([]);
  99  |   } finally {
  100 |     await page.close();
  101 |     await harness.close();
  102 |   }
  103 | });
  104 | 
  105 | test("safe Mermaid primitive capture retains curves, HTML labels and unknown visuals without executable DOM", async ({ page }) => {
  106 |   const harness = await startHarness({ slides: ["# Safe scene"] });
  107 |   try {
  108 |     await page.goto(harness.url);
  109 |     const result = await page.evaluate(async () => {
  110 |       const { captureSvgTree, sceneToSvg } = await import("./renderer/scene-svg.mjs");
  111 |       const { createScene, normalizeScene } = await import("./renderer/scene-graph.mjs");
  112 |       const source = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  113 |         <path d="M0 0 Q50 100 200 0" stroke="red"/>
  114 |         <foreignObject width="150" height="40"><div xmlns="http://www.w3.org/1999/xhtml"><b>Rich</b><br/>label<img src="javascript:alert(1)" onerror="alert(1)"/></div></foreignObject>
  115 |         <script>alert(1)</script><image href="javascript:alert(1)" onload="alert(1)"/>
  116 |       </svg>`, "image/svg+xml").documentElement;
  117 |       const scene = normalizeScene(createScene({ width: 200, height: 100, source: { kind: "mermaid", path: "fixture" }, nodes: [
  118 |         { kind: "fallback", sourcePath: "svg", z: 0, bounds: { x: 0, y: 0, width: 200, height: 100 }, reason: "unknown",
  119 |           meta: { svg: captureSvgTree(source, { computedStyle: null }) } },
  120 |       ] })).scene;
  121 |       const svg = sceneToSvg(scene);
  122 |       return {
  123 |         path: svg.querySelector("path").getAttribute("d"), label: svg.querySelector("foreignObject").textContent,
  124 |         executable: svg.querySelectorAll("script,[onload],[onerror],[href^='javascript:'],[src^='javascript:']").length,
```