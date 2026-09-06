# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editing/architecture-canvas.spec.mjs >> group layout submenu supports left/right arrows and Escape returns focus to the target
- Location: test/editing/architecture-canvas.spec.mjs:952:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.focus: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('[data-ref="zone"].tree-item')

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
  877  |   )}\n`;
  878  |   const harness = await startArchitectureEditorHarness({ source });
  879  |   try {
  880  |     await page.goto(harness.url, { waitUntil: "load" });
  881  |     const menu = page.locator("#contextMenu");
  882  |     await page.locator('[data-ref="api"].tree-item').click({ button: "right" });
  883  |     await expect(menu.getByRole("menuitem", { name: "Layout", exact: true })).toHaveCount(0);
  884  |     await expect(menu.getByRole("menuitem", { name: "Release layout" })).toHaveCount(0);
  885  |     await expect(page.locator('[data-action="release-layout"]')).toBeDisabled();
  886  | 
  887  |     await page.locator('[data-ref="zone"].tree-item').click();
  888  |     await openProperties(page);
  889  |     await page.locator('[data-ref="zone"].tree-item').click({ button: "right" });
  890  |     const layoutTrigger = menu.getByRole("menuitem", { name: "Layout", exact: true });
  891  |     await expect(layoutTrigger).toHaveAttribute("aria-haspopup", "menu");
  892  |     await layoutTrigger.hover();
  893  |     const submenu = page.getByRole("menu", { name: "Layout for zone" });
  894  |     await expect(submenu).toBeVisible();
  895  |     await expect(submenu.getByRole("menuitemradio", { name: "grid" })).toHaveAttribute(
  896  |       "aria-checked",
  897  |       "true",
  898  |     );
  899  |     await expect(page.getByLabel("Columns")).toBeVisible();
  900  |     await submenu.getByRole("menuitemradio", { name: "layered" }).click();
  901  | 
  902  |     await expect.poll(() => JSON.parse(harness.draftSource).elements[0].layout).toEqual({
  903  |       type: "layered",
  904  |       gap: 30,
  905  |       rowGap: 24,
  906  |       columnGap: 36,
  907  |       padding: 40,
  908  |     });
  909  |     await page.getByLabel("Direction").selectOption("right");
  910  |     await expect.poll(
  911  |       () => JSON.parse(harness.draftSource).elements[0].layout.direction,
  912  |     ).toBe("right");
  913  |     await expect(page.getByLabel("Columns")).toHaveCount(0);
  914  | 
  915  |     await page.locator('[data-ref="zone"].tree-item').click({ button: "right" });
  916  |     await menu.getByRole("menuitem", { name: "Layout", exact: true }).hover();
  917  |     await submenu.getByRole("menuitemradio", { name: "column" }).click();
  918  |     await expect.poll(() => JSON.parse(harness.draftSource).elements[0].layout).toEqual({
  919  |       type: "column",
  920  |       gap: 30,
  921  |       rowGap: 24,
  922  |       columnGap: 36,
  923  |       padding: 40,
  924  |     });
  925  |     await expect(page.getByLabel("Direction")).toHaveCount(0);
  926  | 
  927  |     await page.locator('[data-ref="zone"].tree-item').click({ button: "right" });
  928  |     await menu.getByRole("menuitem", { name: "Layout", exact: true }).hover();
  929  |     await submenu.getByRole("menuitemradio", { name: "None" }).click();
  930  |     await expect.poll(
  931  |       () => JSON.parse(harness.draftSource).elements[0].layout,
  932  |     ).toBeUndefined();
  933  |     const child = JSON.parse(harness.draftSource).elements[0].children[0];
  934  |     expect(child.x).toEqual(expect.any(Number));
  935  |     expect(child.y).toEqual(expect.any(Number));
  936  | 
  937  |     await page.locator('[data-ref="zone"].tree-item').click({ button: "right" });
  938  |     await menu.getByRole("menuitem", { name: "Layout", exact: true }).hover();
  939  |     await submenu.getByRole("menuitemradio", { name: "row" }).click();
  940  |     await expect.poll(() => JSON.parse(harness.draftSource).elements[0].layout).toEqual({
  941  |       type: "row",
  942  |     });
  943  |     const managedChild = JSON.parse(harness.draftSource).elements[0].children[0];
  944  |     expect(managedChild.x).toBeUndefined();
  945  |     expect(managedChild.y).toBeUndefined();
  946  |     await expect(page.locator('[data-action="release-layout"]')).toBeEnabled();
  947  |   } finally {
  948  |     await harness.close();
  949  |   }
  950  | });
  951  | 
  952  | test("group layout submenu supports left/right arrows and Escape returns focus to the target", async ({ page }) => {
  953  |   const source = `${JSON.stringify(
  954  |     {
  955  |       version: 1,
  956  |       canvas: { width: 1200, height: 700 },
  957  |       elements: [
  958  |         {
  959  |           type: "group",
  960  |           id: "zone",
  961  |           x: 100,
  962  |           y: 100,
  963  |           width: 800,
  964  |           height: 400,
  965  |           layout: "row",
  966  |           children: [{ type: "node", id: "api", text: "API" }],
  967  |         },
  968  |       ],
  969  |     },
  970  |     null,
  971  |     2,
  972  |   )}\n`;
  973  |   const harness = await startArchitectureEditorHarness({ source });
  974  |   try {
  975  |     await page.goto(harness.url, { waitUntil: "load" });
  976  |     const group = page.locator('[data-ref="zone"].tree-item');
> 977  |     await group.focus();
       |                 ^ Error: locator.focus: Test timeout of 30000ms exceeded.
  978  |     await page.keyboard.press("Shift+F10");
  979  |     const trigger = page.getByRole("menuitem", { name: "Layout", exact: true });
  980  |     await trigger.focus();
  981  |     await page.keyboard.press("ArrowRight");
  982  |     const submenu = page.getByRole("menu", { name: "Layout for zone" });
  983  |     await expect(submenu).toBeVisible();
  984  |     await expect(submenu.getByRole("menuitemradio", { name: "None" })).toBeFocused();
  985  | 
  986  |     await page.keyboard.press("ArrowDown");
  987  |     await expect(submenu.getByRole("menuitemradio", { name: "row" })).toBeFocused();
  988  |     await page.keyboard.press("ArrowLeft");
  989  |     await expect(submenu).toBeHidden();
  990  |     await expect(trigger).toBeFocused();
  991  | 
  992  |     await page.keyboard.press("ArrowRight");
  993  |     await page.keyboard.press("Escape");
  994  |     await expect(page.locator("#contextMenu")).toBeHidden();
  995  |     await expect(group).toBeFocused();
  996  | 
  997  |     await group.evaluate((element) => {
  998  |       element.dispatchEvent(
  999  |         new MouseEvent("contextmenu", {
  1000 |           bubbles: true,
  1001 |           cancelable: true,
  1002 |           clientX: window.innerWidth - 2,
  1003 |           clientY: window.innerHeight - 2,
  1004 |         }),
  1005 |       );
  1006 |     });
  1007 |     await page.getByRole("menuitem", { name: "Layout", exact: true }).hover();
  1008 |     const bounds = await submenu.boundingBox();
  1009 |     const viewport = await page.evaluate(() => ({
  1010 |       width: window.innerWidth,
  1011 |       height: window.innerHeight,
  1012 |     }));
  1013 |     expect(bounds.x).toBeGreaterThanOrEqual(0);
  1014 |     expect(bounds.y).toBeGreaterThanOrEqual(0);
  1015 |     expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  1016 |     expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
  1017 |   } finally {
  1018 |     await harness.close();
  1019 |   }
  1020 | });
  1021 | 
  1022 | test("keyboard controls the context menu and closing returns focus to the target", async ({ page }) => {
  1023 |   const harness = await openEditor(page);
  1024 |   try {
  1025 |     const api = page.locator('[data-ref="api"].tree-item');
  1026 |     await api.focus();
  1027 |     await page.keyboard.press("Shift+F10");
  1028 |     const menu = page.locator("#contextMenu");
  1029 |     await expect(menu).toBeVisible();
  1030 |     await expect(menu.getByRole("menuitem", { name: "Start connector here" })).toBeFocused();
  1031 | 
  1032 |     await page.keyboard.press("ArrowDown");
  1033 |     await expect(menu.getByRole("menuitem", { name: "Duplicate" })).toBeFocused();
  1034 |     await page.keyboard.press("End");
  1035 |     await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeFocused();
  1036 |     await page.keyboard.press("Escape");
  1037 |     await expect(menu).toBeHidden();
  1038 |     await expect(page.locator('[data-ref="api"].tree-item')).toBeFocused();
  1039 | 
  1040 |     const prevented = await page.locator('input[id^="field-"]').first().evaluate((input) => {
  1041 |       const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  1042 |       input.dispatchEvent(event);
  1043 |       return event.defaultPrevented;
  1044 |     });
  1045 |     expect(prevented).toBe(false);
  1046 |   } finally {
  1047 |     await harness.close();
  1048 |   }
  1049 | });
  1050 | 
  1051 | test("Ctrl+S while editing an inspector field commits and saves the change", async ({ page }) => {
  1052 |   const harness = await openEditor(page);
  1053 |   try {
  1054 |     await page.locator('[data-ref="client"].tree-item').click();
  1055 |     await openProperties(page);
  1056 |     const text = page.locator('textarea[id^="field-text-"]');
  1057 |     await text.fill("Updated client");
  1058 |     await page.keyboard.press("Control+S");
  1059 | 
  1060 |     await expect(page.locator("#status")).toContainText("Saved");
  1061 |     expect(harness.saves).toHaveLength(1);
  1062 |     expect(JSON.parse(harness.saves[0]).elements[0].text).toBe("Updated client");
  1063 |   } finally {
  1064 |     await harness.close();
  1065 |   }
  1066 | });
  1067 | 
```