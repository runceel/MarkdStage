# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editing/architecture-canvas.spec.mjs >> changes remain in the draft until the save button writes them to Markdown
- Location: test/editing/architecture-canvas.spec.mjs:98:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('.tree-item')
Expected: 3
Received: 0
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" with timeout 5000ms
  - waiting for locator('.tree-item')
    14 × locator resolved to 0 elements
       - unexpected value "0"

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - banner [ref=e2]:
    - strong [ref=e4]: Architecture Editor
    - group "Designer panels" [ref=e5]:
      - button "Elements" [ref=e6] [cursor=pointer]
      - button "Properties" [ref=e7] [cursor=pointer]
    - toolbar "Architecture editing controls" [ref=e8]:
      - button "Undo" [ref=e9] [cursor=pointer]: ↶
      - button "Redo" [ref=e10] [cursor=pointer]: ↷
      - button "Shape" [ref=e12] [cursor=pointer]
      - button "Save" [ref=e13] [cursor=pointer]
      - button "More" [ref=e15] [cursor=pointer]
  - main [ref=e16]:
    - complementary "Elements" [ref=e17]:
      - generic [ref=e18]:
        - heading "Elements" [level=2] [ref=e19]
        - button "Close Elements" [ref=e20] [cursor=pointer]: ×
      - tree [ref=e21]
    - region "Drawing area" [ref=e22]
  - contentinfo [ref=e24]:
    - status [ref=e25]: Loading…
    - generic [ref=e26]: 100%
```

# Test source

```ts
  1   | import { expect, test } from "@playwright/test";
  2   | 
  3   | import { startArchitectureEditorHarness } from "../harness/architecture-editor.mjs";
  4   | 
  5   | const SOURCE = `${JSON.stringify(
  6   |   {
  7   |     version: 1,
  8   |     canvas: { width: 1600, height: 900 },
  9   |     title: "Editor",
  10  |     elements: [
  11  |       {
  12  |         type: "node",
  13  |         id: "client",
  14  |         x: 100,
  15  |         y: 180,
  16  |         width: 260,
  17  |         height: 140,
  18  |         text: "Client",
  19  |       },
  20  |       {
  21  |         type: "node",
  22  |         id: "api",
  23  |         x: 650,
  24  |         y: 180,
  25  |         width: 260,
  26  |         height: 140,
  27  |         text: "API",
  28  |       },
  29  |       {
  30  |         type: "connector",
  31  |         from: "client",
  32  |         to: "api",
  33  |         routing: "orthogonal",
  34  |         arrow: true,
  35  |       },
  36  |     ],
  37  |   },
  38  |   null,
  39  |   2,
  40  | )}\n`;
  41  | const EXISTING_SVG =
  42  |   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
  43  | 
  44  | async function openEditor(page) {
  45  |   const harness = await startArchitectureEditorHarness({
  46  |     source: SOURCE,
  47  |     assets: { "assets/existing.svg": EXISTING_SVG },
  48  |   });
  49  |   await page.goto(harness.url, { waitUntil: "load" });
> 50  |   await expect(page.locator(".tree-item")).toHaveCount(3);
      |                                            ^ Error: expect(locator).toHaveCount(expected) failed
  51  |   return harness;
  52  | }
  53  | 
  54  | async function screenPoint(page, x, y) {
  55  |   return page.locator(".architecture-svg").evaluate((svg, point) => {
  56  |     const source = svg.createSVGPoint();
  57  |     source.x = point.x;
  58  |     source.y = point.y;
  59  |     const screen = source.matrixTransform(svg.getScreenCTM());
  60  |     return { x: screen.x, y: screen.y };
  61  |   }, { x, y });
  62  | }
  63  | 
  64  | async function addShape(page, name = "Rounded rectangle") {
  65  |   await page.getByRole("button", { name: "Shape", exact: true }).click();
  66  |   await page.getByRole("menuitem", { name, exact: true }).click();
  67  | }
  68  | 
  69  | async function openProperties(page) {
  70  |   const panel = page.locator("#inspectorPanel");
  71  |   if (!(await panel.isVisible())) {
  72  |     await page.getByRole("button", { name: "Properties", exact: true }).click();
  73  |   }
  74  | }
  75  | 
  76  | async function openMore(page) {
  77  |   const menu = page.getByRole("menu", { name: "More editing controls" });
  78  |   if (!(await menu.isVisible())) {
  79  |     await page.getByRole("button", { name: "More", exact: true }).click();
  80  |   }
  81  | }
  82  | 
  83  | async function clickEditorAction(page, action) {
  84  |   const control = page.locator(`[data-action="${action}"]`);
  85  |   if (!(await control.isVisible())) await openMore(page);
  86  |   await control.click();
  87  | }
  88  | 
  89  | function boxesIntersect(left, right, gap = 20) {
  90  |   return !(
  91  |     left.x + left.width + gap <= right.x ||
  92  |     right.x + right.width + gap <= left.x ||
  93  |     left.y + left.height + gap <= right.y ||
  94  |     right.y + right.height + gap <= left.y
  95  |   );
  96  | }
  97  | 
  98  | test("changes remain in the draft until the save button writes them to Markdown", async ({ page }) => {
  99  |   const harness = await openEditor(page);
  100 |   try {
  101 |     await expect(page.locator('[data-action="save"]')).toBeDisabled();
  102 |     await addShape(page);
  103 |     await expect(page.locator(".tree-item")).toHaveCount(4);
  104 |     await expect(page.locator('[data-action="save"]')).toBeEnabled();
  105 |     expect(harness.saves).toHaveLength(0);
  106 |     expect(harness.markdown).not.toContain('"id": "node"');
  107 | 
  108 |     await page.locator('[data-action="save"]').click();
  109 |     await expect(page.locator("#status")).toContainText("Saved");
  110 |     expect(harness.saves).toHaveLength(1);
  111 |     expect(harness.markdown).toContain('"id": "node"');
  112 |     await expect(page.locator('[data-action="save"]')).toBeDisabled();
  113 |   } finally {
  114 |     await harness.close();
  115 |   }
  116 | });
  117 | 
  118 | test("connector label overlap can be placed in front of or behind boxes", async ({ page }) => {
  119 |   const harness = await openEditor(page);
  120 |   try {
  121 |     await page.locator('[data-ref="elements[2]"].tree-item').click();
  122 |     await openProperties(page);
  123 |     const layer = page.locator('select[id^="field-labelLayer"]');
  124 |     await expect(layer).toHaveValue("front");
  125 |     await expect(
  126 |       page.locator(
  127 |         '.architecture-svg > [data-architecture-connector-label][data-architecture-label-layer="front"]',
  128 |       ),
  129 |     ).toHaveCount(0);
  130 | 
  131 |     await page.locator('input[id^="field-label"]').fill("HTTPS");
  132 |     await page.locator('input[id^="field-label"]').press("Enter");
  133 |     await expect(
  134 |       page.locator(
  135 |         '.architecture-svg > [data-architecture-connector-label][data-architecture-label-layer="front"]',
  136 |       ),
  137 |     ).toHaveCount(1);
  138 | 
  139 |     await layer.selectOption("behind");
  140 |     await expect(
  141 |       page.locator(
  142 |         '[data-architecture-connector] > [data-architecture-connector-label][data-architecture-label-layer="behind"]',
  143 |       ),
  144 |     ).toHaveCount(1);
  145 |     await expect(page.locator('[data-action="save"]')).toBeEnabled();
  146 |   } finally {
  147 |     await harness.close();
  148 |   }
  149 | });
  150 | 
```