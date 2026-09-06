# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editing/architecture-canvas.spec.mjs >> an empty diagram offers a direct first-shape action
- Location: test/editing/architecture-canvas.spec.mjs:231:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.editor-empty-state').getByRole('heading', { name: 'Build your first diagram' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('.editor-empty-state').getByRole('heading', { name: 'Build your first diagram' })

```

```yaml
- banner:
  - strong: Architecture Editor
  - group "Designer panels":
    - button "Elements"
    - button "Properties"
  - toolbar "Architecture editing controls":
    - button "Undo": ↶
    - button "Redo": ↷
    - button "Shape"
    - button "Save"
    - button "More"
- main:
  - complementary "Elements":
    - heading "Elements" [level=2]
    - button "Close Elements": ×
    - tree
  - region "Drawing area"
- contentinfo:
  - status: Loading…
  - text: 100%
```

# Test source

```ts
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
  151 | test("connector line-style presets preserve the Architecture v1 dash contract", async ({ page }) => {
  152 |   const harness = await openEditor(page);
  153 |   try {
  154 |     await page.locator('[data-ref="elements[2]"].tree-item').click();
  155 |     await openProperties(page);
  156 |     const lineStyle = page.getByLabel("Line style");
  157 |     await expect(lineStyle).toHaveValue("solid");
  158 | 
  159 |     await lineStyle.selectOption("dotted");
  160 |     await expect.poll(
  161 |       () => JSON.parse(harness.draftSource).elements[2].style?.dash,
  162 |     ).toBe("1 5");
  163 |     await page.getByLabel("Line style").selectOption("custom");
  164 |     await expect(page.getByLabel("Dash pattern")).toHaveValue("6 3");
  165 |     await page.getByLabel("Line style").selectOption("solid");
  166 |     await expect.poll(
  167 |       () => JSON.parse(harness.draftSource).elements[2].style?.dash || "",
  168 |     ).toBe("");
  169 |   } finally {
  170 |     await harness.close();
  171 |   }
  172 | });
  173 | 
  174 | test("selection, keyboard movement, resizing, and undo/redo share one draft", async ({ page }) => {
  175 |   const harness = await openEditor(page);
  176 |   try {
  177 |     const client = page.locator('[data-editor-ref="client"]');
  178 |     await client.focus();
  179 |     const before = await client.evaluate((node) => node.getBBox().x);
  180 |     await page.keyboard.press("ArrowRight");
  181 |     await expect
  182 |       .poll(() =>
  183 |         page.locator('[data-editor-ref="client"]').evaluate((node) => node.getBBox().x),
  184 |       )
  185 |       .toBeGreaterThan(before);
  186 | 
  187 |     await page.locator('[data-ref="client"].tree-item').click();
  188 |     await openProperties(page);
  189 |     await expect(page.locator(".editor-resize-handle")).toHaveCount(4);
  190 |     const width = page.locator('input[id^="field-width"]');
  191 |     await width.fill("340");
  192 |     await width.press("Enter");
  193 |     await expect
  194 |       .poll(() =>
  195 |         page.locator('[data-editor-ref="client"]').evaluate((node) => node.getBBox().width),
  196 |       )
  197 |       .toBeGreaterThan(260);
  198 | 
  199 |     await page.locator('[data-action="undo"]').click();
  200 |     await page.locator('[data-action="redo"]').click();
  201 |     await expect(page.locator('[data-action="save"]')).toBeEnabled();
  202 |   } finally {
  203 |     await harness.close();
  204 |   }
  205 | });
  206 | 
  207 | test("the shape palette stays bounded and adds PowerPoint-compatible shapes", async ({ page }) => {
  208 |   await page.setViewportSize({ width: 560, height: 720 });
  209 |   const harness = await openEditor(page);
  210 |   try {
  211 |     const trigger = page.getByRole("button", { name: "Shape", exact: true });
  212 |     await trigger.click();
  213 |     const palette = page.getByRole("menu", { name: "Add a shape" });
  214 |     await expect(palette).toBeVisible();
  215 |     await expect(palette.getByRole("menuitem")).toHaveCount(7);
  216 |     const bounds = await palette.boundingBox();
  217 |     expect(bounds.x).toBeGreaterThanOrEqual(0);
  218 |     expect(bounds.x + bounds.width).toBeLessThanOrEqual(560);
  219 | 
  220 |     await palette.getByRole("menuitem", { name: "Diamond", exact: true }).click();
  221 |     await expect(page.locator('[data-ref="node"].tree-item')).toHaveCount(1);
  222 |     await expect.poll(
  223 |       () => JSON.parse(harness.draftSource).elements.find((element) => element.id === "node")?.shape,
  224 |     ).toBe("diamond");
  225 |     await expect(page.locator('[data-editor-ref="node"] > polygon')).toHaveCount(1);
  226 |   } finally {
  227 |     await harness.close();
  228 |   }
  229 | });
  230 | 
  231 | test("an empty diagram offers a direct first-shape action", async ({ page }) => {
  232 |   const harness = await startArchitectureEditorHarness({
  233 |     source: `${JSON.stringify({ version: 1, elements: [] }, null, 2)}\n`,
  234 |   });
  235 |   try {
  236 |     await page.goto(harness.url, { waitUntil: "load" });
  237 |     const empty = page.locator(".editor-empty-state");
> 238 |     await expect(empty.getByRole("heading", { name: "Build your first diagram" })).toBeVisible();
      |                                                                                    ^ Error: expect(locator).toBeVisible() failed
  239 |     await expect(page.locator("#status")).toContainText("Add the first shape");
  240 |     await empty.getByRole("button", { name: "Add first shape" }).click();
  241 |     await expect(page.locator('[data-ref="node"].tree-item')).toBeVisible();
  242 |     await expect(empty).toHaveCount(0);
  243 |     await expect(page.locator('[data-editor-ref="node"]')).toBeVisible();
  244 |   } finally {
  245 |     await harness.close();
  246 |   }
  247 | });
  248 | 
  249 | test("toolbar-added shapes avoid occupied siblings", async ({ page }) => {
  250 |   const harness = await openEditor(page);
  251 |   try {
  252 |     await addShape(page);
  253 |     await addShape(page, "Hexagon");
  254 |     await expect(page.locator(".tree-item")).toHaveCount(5);
  255 |     const elements = JSON.parse(harness.draftSource).elements.filter(
  256 |       (element) => element.type === "node",
  257 |     );
  258 |     const added = elements.filter((element) => element.id.startsWith("node"));
  259 |     expect(added).toHaveLength(2);
  260 |     for (const candidate of added) {
  261 |       expect(
  262 |         elements.some(
  263 |           (element) => element.id !== candidate.id && boxesIntersect(candidate, element),
  264 |         ),
  265 |       ).toBe(false);
  266 |     }
  267 |   } finally {
  268 |     await harness.close();
  269 |   }
  270 | });
  271 | 
  272 | test("medium and narrow layouts expose Elements and Properties as responsive drawers", async ({
  273 |   page,
  274 | }) => {
  275 |   await page.setViewportSize({ width: 900, height: 720 });
  276 |   const harness = await openEditor(page);
  277 |   try {
  278 |     const elementsButton = page.getByRole("button", { name: "Elements", exact: true });
  279 |     const propertiesButton = page.getByRole("button", { name: "Properties", exact: true });
  280 |     await expect(elementsButton).toBeVisible();
  281 |     await expect(propertiesButton).toBeVisible();
  282 |     await expect(page.locator("#elementPanel")).not.toBeVisible();
  283 |     await expect(page.locator("#inspectorPanel")).not.toBeVisible();
  284 | 
  285 |     const client = page.locator('[data-editor-ref="client"]');
  286 |     const clientBounds = await client.boundingBox();
  287 |     await page.mouse.move(
  288 |       clientBounds.x + clientBounds.width / 2,
  289 |       clientBounds.y + clientBounds.height / 2,
  290 |     );
  291 |     await page.mouse.down();
  292 |     await page.mouse.move(
  293 |       clientBounds.x + clientBounds.width / 2 + 40,
  294 |       clientBounds.y + clientBounds.height / 2,
  295 |     );
  296 |     await page.mouse.up();
  297 |     await expect(page.locator("#inspectorPanel")).not.toBeVisible();
  298 |     await expect.poll(
  299 |       () => JSON.parse(harness.draftSource).elements.find((element) => element.id === "client")?.x,
  300 |     ).toBeGreaterThan(100);
  301 | 
  302 |     await elementsButton.click();
  303 |     await expect(elementsButton).toHaveAttribute("aria-expanded", "true");
  304 |     await expect(page.locator("#elementPanel")).toBeVisible();
  305 |     await page.locator('[data-ref="client"].tree-item').click();
  306 |     await expect(page.locator("#elementPanel")).toBeVisible();
  307 |     await propertiesButton.click();
  308 |     await expect(page.locator("#elementPanel")).not.toBeVisible();
  309 |     await expect(page.locator("#inspectorPanel")).toBeVisible();
  310 |     await expect(propertiesButton).toHaveAttribute("aria-expanded", "true");
  311 |     await expect(page.getByLabel("ID", { exact: true })).toBeFocused();
  312 |     await expect(page.locator("#panelScrim")).toHaveCount(0);
  313 |     const fitted = await page.evaluate(() => {
  314 |       const viewport = document.querySelector("#viewport").getBoundingClientRect();
  315 |       const diagram = document.querySelector(".architecture-diagram").getBoundingClientRect();
  316 |       return {
  317 |         left: diagram.left - viewport.left,
  318 |         right: viewport.right - diagram.right,
  319 |       };
  320 |     });
  321 |     expect(fitted.left).toBeGreaterThanOrEqual(0);
  322 |     expect(fitted.right).toBeGreaterThanOrEqual(0);
  323 | 
  324 |     const selectedBounds = await page.locator('[data-editor-ref="client"]').boundingBox();
  325 |     await page.mouse.move(
  326 |       selectedBounds.x + selectedBounds.width / 2,
  327 |       selectedBounds.y + selectedBounds.height / 2,
  328 |     );
  329 |     await page.mouse.down();
  330 |     await page.mouse.move(
  331 |       selectedBounds.x + selectedBounds.width / 2 + 30,
  332 |       selectedBounds.y + selectedBounds.height / 2,
  333 |     );
  334 |     await page.mouse.up();
  335 |     await expect(page.locator("#inspectorPanel")).toBeVisible();
  336 | 
  337 |     await page.setViewportSize({ width: 520, height: 720 });
  338 |     await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
```