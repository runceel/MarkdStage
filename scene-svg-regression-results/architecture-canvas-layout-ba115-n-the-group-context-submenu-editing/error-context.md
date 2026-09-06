# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editing/architecture-canvas.spec.mjs >> layout actions appear only in the group context submenu
- Location: test/editing/architecture-canvas.spec.mjs:847:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('[data-ref="api"].tree-item')

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
  782 |   } finally {
  783 |     await harness.close();
  784 |   }
  785 | });
  786 | 
  787 | test("context menus support ordering, connector duplication, undo, and save", async ({ page }) => {
  788 |   const harness = await openEditor(page);
  789 |   try {
  790 |     const menu = page.locator("#contextMenu");
  791 |     await page.locator('[data-ref="client"].tree-item').click({ button: "right" });
  792 |     await menu.getByRole("menuitem", { name: "Bring forward" }).click();
  793 |     await expect.poll(() => JSON.parse(harness.draftSource).elements[1].id).toBe("client");
  794 |     await page.locator('[data-ref="client"].tree-item').click({ button: "right" });
  795 |     await menu.getByRole("menuitem", { name: "Send backward" }).click();
  796 |     await expect.poll(() => JSON.parse(harness.draftSource).elements[0].id).toBe("client");
  797 | 
  798 |     await page.locator(".tree-item").filter({ hasText: "client → api" }).click({ button: "right" });
  799 |     await expect(menu.getByRole("menuitem", { name: "Start connector here" })).toHaveCount(0);
  800 |     await menu.getByRole("menuitem", { name: "Duplicate" }).click();
  801 |     await expect(page.locator('[data-architecture-type="connector"]')).toHaveCount(2);
  802 | 
  803 |     const panel = page.locator(".element-panel");
  804 |     await panel.click({ button: "right", position: { x: 40, y: 400 } });
  805 |     await menu.getByRole("menuitem", { name: "Undo" }).click();
  806 |     await expect(page.locator('[data-architecture-type="connector"]')).toHaveCount(1);
  807 |     await panel.click({ button: "right", position: { x: 40, y: 400 } });
  808 |     await menu.getByRole("menuitem", { name: "Redo" }).click();
  809 |     await expect(page.locator('[data-architecture-type="connector"]')).toHaveCount(2);
  810 | 
  811 |     await panel.click({ button: "right", position: { x: 40, y: 400 } });
  812 |     await menu.getByRole("menuitem", { name: "Save to Markdown" }).click();
  813 |     await expect(page.locator("#status")).toContainText("Saved");
  814 |     expect(harness.saves).toHaveLength(1);
  815 |   } finally {
  816 |     await harness.close();
  817 |   }
  818 | });
  819 | 
  820 | test("blank space in the element tree adds near the visible canvas without overlap", async ({ page }) => {
  821 |   const harness = await openEditor(page);
  822 |   try {
  823 |     const menu = page.locator("#contextMenu");
  824 |     await page.locator(".element-panel").click({
  825 |       button: "right",
  826 |       position: { x: 40, y: 400 },
  827 |     });
  828 |     await expect(menu.getByRole("menuitem", { name: "Add node", exact: true })).toBeVisible();
  829 |     await expect(menu.getByRole("menuitem", { name: "Undo" })).toBeDisabled();
  830 |     await expect(menu.getByRole("menuitem", { name: "Save to Markdown" })).toBeDisabled();
  831 | 
  832 |     await menu.getByRole("menuitem", { name: "Add node", exact: true }).click();
  833 |     await expect(page.locator('[data-ref="node"].tree-item')).toHaveCount(1);
  834 |     await expect.poll(() => JSON.parse(harness.draftSource).elements.find(
  835 |       (element) => element.id === "node",
  836 |     )).toMatchObject({ width: 260, height: 140 });
  837 |     const elements = JSON.parse(harness.draftSource).elements;
  838 |     const added = elements.find((element) => element.id === "node");
  839 |     expect(added.x).toBeGreaterThan(300);
  840 |     expect(added.y).toBeGreaterThan(200);
  841 |     expect(elements.slice(0, 2).some((element) => boxesIntersect(added, element))).toBe(false);
  842 |   } finally {
  843 |     await harness.close();
  844 |   }
  845 | });
  846 | 
  847 | test("layout actions appear only in the group context submenu", async ({ page }) => {
  848 |   const source = `${JSON.stringify(
  849 |     {
  850 |       version: 1,
  851 |       canvas: { width: 1200, height: 700 },
  852 |       elements: [
  853 |         {
  854 |           type: "group",
  855 |           id: "zone",
  856 |           x: 100,
  857 |           y: 100,
  858 |           width: 800,
  859 |           height: 400,
  860 |           layout: {
  861 |             type: "grid",
  862 |             gap: 30,
  863 |             rowGap: 24,
  864 |             columnGap: 36,
  865 |             padding: 40,
  866 |             columns: 2,
  867 |           },
  868 |           children: [
  869 |             { type: "node", id: "api", text: "API" },
  870 |             { type: "node", id: "db", text: "Database" },
  871 |           ],
  872 |         },
  873 |       ],
  874 |     },
  875 |     null,
  876 |     2,
  877 |   )}\n`;
  878 |   const harness = await startArchitectureEditorHarness({ source });
  879 |   try {
  880 |     await page.goto(harness.url, { waitUntil: "load" });
  881 |     const menu = page.locator("#contextMenu");
> 882 |     await page.locator('[data-ref="api"].tree-item').click({ button: "right" });
      |                                                      ^ Error: locator.click: Test timeout of 30000ms exceeded.
  883 |     await expect(menu.getByRole("menuitem", { name: "Layout", exact: true })).toHaveCount(0);
  884 |     await expect(menu.getByRole("menuitem", { name: "Release layout" })).toHaveCount(0);
  885 |     await expect(page.locator('[data-action="release-layout"]')).toBeDisabled();
  886 | 
  887 |     await page.locator('[data-ref="zone"].tree-item').click();
  888 |     await openProperties(page);
  889 |     await page.locator('[data-ref="zone"].tree-item').click({ button: "right" });
  890 |     const layoutTrigger = menu.getByRole("menuitem", { name: "Layout", exact: true });
  891 |     await expect(layoutTrigger).toHaveAttribute("aria-haspopup", "menu");
  892 |     await layoutTrigger.hover();
  893 |     const submenu = page.getByRole("menu", { name: "Layout for zone" });
  894 |     await expect(submenu).toBeVisible();
  895 |     await expect(submenu.getByRole("menuitemradio", { name: "grid" })).toHaveAttribute(
  896 |       "aria-checked",
  897 |       "true",
  898 |     );
  899 |     await expect(page.getByLabel("Columns")).toBeVisible();
  900 |     await submenu.getByRole("menuitemradio", { name: "layered" }).click();
  901 | 
  902 |     await expect.poll(() => JSON.parse(harness.draftSource).elements[0].layout).toEqual({
  903 |       type: "layered",
  904 |       gap: 30,
  905 |       rowGap: 24,
  906 |       columnGap: 36,
  907 |       padding: 40,
  908 |     });
  909 |     await page.getByLabel("Direction").selectOption("right");
  910 |     await expect.poll(
  911 |       () => JSON.parse(harness.draftSource).elements[0].layout.direction,
  912 |     ).toBe("right");
  913 |     await expect(page.getByLabel("Columns")).toHaveCount(0);
  914 | 
  915 |     await page.locator('[data-ref="zone"].tree-item').click({ button: "right" });
  916 |     await menu.getByRole("menuitem", { name: "Layout", exact: true }).hover();
  917 |     await submenu.getByRole("menuitemradio", { name: "column" }).click();
  918 |     await expect.poll(() => JSON.parse(harness.draftSource).elements[0].layout).toEqual({
  919 |       type: "column",
  920 |       gap: 30,
  921 |       rowGap: 24,
  922 |       columnGap: 36,
  923 |       padding: 40,
  924 |     });
  925 |     await expect(page.getByLabel("Direction")).toHaveCount(0);
  926 | 
  927 |     await page.locator('[data-ref="zone"].tree-item').click({ button: "right" });
  928 |     await menu.getByRole("menuitem", { name: "Layout", exact: true }).hover();
  929 |     await submenu.getByRole("menuitemradio", { name: "None" }).click();
  930 |     await expect.poll(
  931 |       () => JSON.parse(harness.draftSource).elements[0].layout,
  932 |     ).toBeUndefined();
  933 |     const child = JSON.parse(harness.draftSource).elements[0].children[0];
  934 |     expect(child.x).toEqual(expect.any(Number));
  935 |     expect(child.y).toEqual(expect.any(Number));
  936 | 
  937 |     await page.locator('[data-ref="zone"].tree-item').click({ button: "right" });
  938 |     await menu.getByRole("menuitem", { name: "Layout", exact: true }).hover();
  939 |     await submenu.getByRole("menuitemradio", { name: "row" }).click();
  940 |     await expect.poll(() => JSON.parse(harness.draftSource).elements[0].layout).toEqual({
  941 |       type: "row",
  942 |     });
  943 |     const managedChild = JSON.parse(harness.draftSource).elements[0].children[0];
  944 |     expect(managedChild.x).toBeUndefined();
  945 |     expect(managedChild.y).toBeUndefined();
  946 |     await expect(page.locator('[data-action="release-layout"]')).toBeEnabled();
  947 |   } finally {
  948 |     await harness.close();
  949 |   }
  950 | });
  951 | 
  952 | test("group layout submenu supports left/right arrows and Escape returns focus to the target", async ({ page }) => {
  953 |   const source = `${JSON.stringify(
  954 |     {
  955 |       version: 1,
  956 |       canvas: { width: 1200, height: 700 },
  957 |       elements: [
  958 |         {
  959 |           type: "group",
  960 |           id: "zone",
  961 |           x: 100,
  962 |           y: 100,
  963 |           width: 800,
  964 |           height: 400,
  965 |           layout: "row",
  966 |           children: [{ type: "node", id: "api", text: "API" }],
  967 |         },
  968 |       ],
  969 |     },
  970 |     null,
  971 |     2,
  972 |   )}\n`;
  973 |   const harness = await startArchitectureEditorHarness({ source });
  974 |   try {
  975 |     await page.goto(harness.url, { waitUntil: "load" });
  976 |     const group = page.locator('[data-ref="zone"].tree-item');
  977 |     await group.focus();
  978 |     await page.keyboard.press("Shift+F10");
  979 |     const trigger = page.getByRole("menuitem", { name: "Layout", exact: true });
  980 |     await trigger.focus();
  981 |     await page.keyboard.press("ArrowRight");
  982 |     const submenu = page.getByRole("menu", { name: "Layout for zone" });
```