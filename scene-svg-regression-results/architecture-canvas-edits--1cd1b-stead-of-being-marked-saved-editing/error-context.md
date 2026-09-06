# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editing/architecture-canvas.spec.mjs >> edits made during save remain dirty instead of being marked saved
- Location: test/editing/architecture-canvas.spec.mjs:694:1

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
  601 |     await expect(
  602 |       page.getByRole("menuitem", { name: "Add image", exact: true }),
  603 |     ).toBeVisible();
  604 |   } finally {
  605 |     await harness.close();
  606 |   }
  607 | });
  608 | 
  609 | test("external-change conflicts remain visible without overwriting Markdown", async ({ page }) => {
  610 |   const harness = await openEditor(page);
  611 |   try {
  612 |     await addShape(page);
  613 |     harness.setConflict();
  614 |     await page.locator('[data-action="save"]').click();
  615 |     await expect(page.locator("#status")).toContainText("changed outside");
  616 |     await expect(page.locator("#status")).toHaveAttribute("data-kind", "error");
  617 |     expect(harness.saves).toHaveLength(0);
  618 |     await expect(page.locator('[data-action="save"]')).toBeEnabled();
  619 | 
  620 |     page.once("dialog", (dialog) => dialog.accept());
  621 |     await clickEditorAction(page, "reload");
  622 |     await expect(page.locator("#status")).toContainText("Reloaded");
  623 |     await expect(page.locator('[data-ref="node"].tree-item')).toHaveCount(0);
  624 |     await expect(page.locator('[data-action="save"]')).toBeDisabled();
  625 | 
  626 |     await addShape(page);
  627 |     await page.locator('[data-action="save"]').click();
  628 |     await expect(page.locator("#status")).toContainText("Saved");
  629 |     expect(harness.saves).toHaveLength(1);
  630 |   } finally {
  631 |     await harness.close();
  632 |   }
  633 | });
  634 | 
  635 | test("editing can continue with the current revision after reloading an unsaved draft", async ({ page }) => {
  636 |   const harness = await openEditor(page);
  637 |   try {
  638 |     await addShape(page);
  639 |     await expect(page.locator(".tree-item")).toHaveCount(4);
  640 |     await page.reload({ waitUntil: "load" });
  641 |     await expect(page.locator(".tree-item")).toHaveCount(4);
  642 | 
  643 |     await addShape(page);
  644 |     await expect(page.locator(".tree-item")).toHaveCount(5);
  645 |     await page.locator('[data-action="save"]').click();
  646 |     await expect(page.locator("#status")).toContainText("Saved");
  647 |     expect(JSON.parse(harness.saves[0]).elements).toHaveLength(5);
  648 |   } finally {
  649 |     await harness.close();
  650 |   }
  651 | });
  652 | 
  653 | test("reloading source Markdown does not carry over a draft from the old generation", async ({ page }) => {
  654 |   const harness = await openEditor(page);
  655 |   try {
  656 |     await addShape(page);
  657 |     await expect(page.locator('[data-ref="node"].tree-item')).toHaveCount(1);
  658 | 
  659 |     harness.reloadSource(SOURCE.replace('"text": "Client"', '"text": "Reloaded client"'));
  660 |     await expect(page.locator('[data-ref="node"].tree-item')).toHaveCount(0);
  661 |     await expect(page.locator('[data-ref="client"].tree-item')).toContainText("Reloaded client");
  662 | 
  663 |     await addShape(page);
  664 |     await page.locator('[data-action="save"]').click();
  665 |     await expect(page.locator("#status")).toContainText("Saved");
  666 |     expect(harness.markdown).toContain("Reloaded client");
  667 |     expect(harness.markdown).toContain('"id": "node"');
  668 |   } finally {
  669 |     await harness.close();
  670 |   }
  671 | });
  672 | 
  673 | test("a delayed stale state response does not roll back the generation after reload", async ({ page }) => {
  674 |   const harness = await openEditor(page);
  675 |   try {
  676 |     harness.delayNextState(300);
  677 |     await addShape(page);
  678 |     harness.reloadSource(SOURCE.replace('"text": "Client"', '"text": "Reloaded client"'));
  679 | 
  680 |     await expect(page.locator('[data-ref="client"].tree-item')).toContainText("Reloaded client");
  681 |     await page.waitForTimeout(400);
  682 |     await expect(page.locator('[data-ref="client"].tree-item')).toContainText("Reloaded client");
  683 |     await expect(page.locator('[data-ref="node"].tree-item')).toHaveCount(0);
  684 | 
  685 |     await addShape(page);
  686 |     await page.locator('[data-action="save"]').click();
  687 |     await expect(page.locator("#status")).toContainText("Saved");
  688 |     expect(harness.markdown).toContain("Reloaded client");
  689 |   } finally {
  690 |     await harness.close();
  691 |   }
  692 | });
  693 | 
  694 | test("edits made during save remain dirty instead of being marked saved", async ({ page }) => {
  695 |   const harness = await startArchitectureEditorHarness({
  696 |     source: SOURCE,
  697 |     saveDelay: 300,
  698 |   });
  699 |   try {
  700 |     await page.goto(harness.url, { waitUntil: "load" });
> 701 |     await expect(page.locator(".tree-item")).toHaveCount(3);
      |                                              ^ Error: expect(locator).toHaveCount(expected) failed
  702 |     await addShape(page);
  703 |     await page.locator('[data-action="save"]').click();
  704 |     await expect(page.locator("#status")).toContainText("Saving");
  705 | 
  706 |     await addShape(page);
  707 |     await expect(page.locator(".tree-item")).toHaveCount(5);
  708 |     await expect(page.locator("#status")).toContainText("still unsaved");
  709 |     await expect(page.locator('[data-action="save"]')).toBeEnabled();
  710 |     expect(JSON.parse(harness.saves[0]).elements).toHaveLength(4);
  711 | 
  712 |     await page.locator('[data-action="save"]').click();
  713 |     await expect(page.locator("#status")).toContainText("Saved");
  714 |     expect(JSON.parse(harness.saves[1]).elements).toHaveLength(5);
  715 |   } finally {
  716 |     await harness.close();
  717 |   }
  718 | });
  719 | 
  720 | test("save server communication failures appear in the UI", async ({ page }) => {
  721 |   const harness = await openEditor(page);
  722 |   try {
  723 |     await addShape(page);
  724 |     await expect(page.locator('[data-action="save"]')).toBeEnabled();
  725 |     await page.route("**/save", (route) => route.abort("connectionfailed"));
  726 | 
  727 |     await page.locator('[data-action="save"]').click();
  728 |     await expect(page.locator("#status")).toContainText("Could not connect");
  729 |     await expect(page.locator('[data-action="save"]')).toBeEnabled();
  730 |   } finally {
  731 |     await harness.close();
  732 |   }
  733 | });
  734 | 
  735 | test("context menus on the canvas and element tree expose target-specific edit actions", async ({ page }) => {
  736 |   const harness = await openEditor(page);
  737 |   try {
  738 |     const menu = page.locator("#contextMenu");
  739 |     await page.locator('[data-editor-ref="client"]').click({ button: "right" });
  740 |     await expect(menu).toBeVisible();
  741 |     await expect(menu).toHaveAttribute("aria-label", /client/);
  742 |     await menu.getByRole("menuitem", { name: "Start connector here" }).click();
  743 |     await expect(page.locator(".connector-source")).toHaveCount(1);
  744 |     await page.locator('[data-editor-ref="api"]').click();
  745 |     await expect(page.locator(".tree-item")).toHaveCount(4);
  746 | 
  747 |     await page.locator('[data-ref="api"].tree-item').click({ button: "right" });
  748 |     await menu.getByRole("menuitem", { name: "Duplicate" }).click();
  749 |     await expect(page.locator('[data-ref="api-copy"].tree-item')).toHaveCount(1);
  750 | 
  751 |     await page.locator('[data-ref="api-copy"].tree-item').click({ button: "right" });
  752 |     await menu.getByRole("menuitem", { name: "Delete" }).click();
  753 |     await expect(page.locator('[data-ref="api-copy"].tree-item')).toHaveCount(0);
  754 |   } finally {
  755 |     await harness.close();
  756 |   }
  757 | });
  758 | 
  759 | test("adds at a blank-area context-menu position and converts to parent-relative coordinates in groups", async ({ page }) => {
  760 |   const harness = await openEditor(page);
  761 |   try {
  762 |     const menu = page.locator("#contextMenu");
  763 |     const groupPoint = await screenPoint(page, 1200, 650);
  764 |     await page.mouse.click(groupPoint.x, groupPoint.y, { button: "right" });
  765 |     await menu.getByRole("menuitem", { name: "Add group here" }).click();
  766 |     await expect(page.locator('[data-ref="group"].tree-item')).toHaveCount(1);
  767 |     await expect.poll(() => JSON.parse(harness.draftSource).elements.find(
  768 |       (element) => element.id === "group",
  769 |     )).toMatchObject({ x: 940, y: 490, width: 520, height: 320 });
  770 | 
  771 |     const childPoint = await screenPoint(page, 1100, 600);
  772 |     await page.mouse.click(childPoint.x, childPoint.y, { button: "right" });
  773 |     await expect(menu.getByRole("menuitem", { name: "Add child node here" })).toBeVisible();
  774 |     await menu.getByRole("menuitem", { name: "Add child node here" }).click();
  775 |     await expect(page.locator('[data-ref="node"].tree-item')).toHaveCount(1);
  776 |     await expect.poll(() => {
  777 |       const group = JSON.parse(harness.draftSource).elements.find(
  778 |         (element) => element.id === "group",
  779 |       );
  780 |       return group.children.find((element) => element.id === "node");
  781 |     }).toMatchObject({ x: 30, y: 40, width: 260, height: 140 });
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
```