import { expect, test } from "@playwright/test";

import { startArchitectureEditorHarness } from "../harness/architecture-editor.mjs";

const SOURCE = `${JSON.stringify(
  {
    version: 1,
    canvas: { width: 1600, height: 900 },
    title: "Editor",
    elements: [
      {
        type: "node",
        id: "client",
        x: 100,
        y: 180,
        width: 260,
        height: 140,
        text: "Client",
      },
      {
        type: "node",
        id: "api",
        x: 650,
        y: 180,
        width: 260,
        height: 140,
        text: "API",
      },
      {
        type: "connector",
        from: "client",
        to: "api",
        routing: "orthogonal",
        arrow: true,
      },
    ],
  },
  null,
  2,
)}\n`;
const EXISTING_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
const MULTI_SOURCE = `${JSON.stringify({
  version: 1,
  canvas: { width: 1000, height: 700 },
  elements: [
    { type: "node", id: "alpha", x: 103, y: 127, width: 140, height: 80, text: "Alpha", shape: "rect", style: { fill: "#112233", opacity: 0.8 } },
    { type: "node", id: "beta", x: 323, y: 157, width: 160, height: 90, text: "Beta", shape: "ellipse", style: { fill: "#334455", opacity: 0.6 } },
    { type: "image", id: "picture", x: 600, y: 100, width: 100, height: 100, src: "assets/existing.svg" },
    { type: "group", id: "zone", x: 103, y: 353, width: 300, height: 220, title: "Zone", children: [
      { type: "node", id: "child", x: 23, y: 61, width: 100, height: 70, text: "Child" },
    ] },
    { type: "node", id: "outside", x: 803, y: 453, width: 100, height: 80, text: "Outside" },
    { type: "connector", from: "alpha", to: "beta", arrow: true, routing: "orthogonal", label: "Internal" },
    { type: "connector", from: "beta", to: "outside", arrow: false, routing: "straight", label: "External" },
  ],
}, null, 2)}\n`;

async function openMultiEditor(page, source = MULTI_SOURCE) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const harness = await startArchitectureEditorHarness({
    source,
    assets: { "assets/existing.svg": EXISTING_SVG },
  });
  await page.goto(harness.url, { waitUntil: "load" });
  await expect(page.locator(".tree-item")).toHaveCount(8);
  return harness;
}

async function selectRefs(page, refs) {
  for (const [index, ref] of refs.entries()) {
    await page.locator(`.tree-item[data-ref="${ref}"]`).click({
      modifiers: index ? ["Control"] : [],
    });
  }
}

async function expectSelected(page, refs) {
  await expect.poll(() => page.locator('.tree-item[aria-selected="true"]')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.ref).sort()))
    .toEqual([...refs].sort());
  await expect.poll(() => page.locator('[data-editor-selected="true"]')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.editorRef).sort()))
    .toEqual([...refs].sort());
}

async function dragBetween(page, from, to, { modifiers = [], button = "left", release = true } = {}) {
  const start = await screenPoint(page, ...from);
  const end = await screenPoint(page, ...to);
  for (const modifier of modifiers) await page.keyboard.down(modifier);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button });
  await page.mouse.move(end.x, end.y, { steps: 5 });
  if (release) await page.mouse.up({ button });
  for (const modifier of modifiers) await page.keyboard.up(modifier);
}

function draftElements(harness) {
  return JSON.parse(harness.draftSource).elements;
}

test("auto sizes and coordinate endpoints stay source-backed through inspector selection and edits", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const source = JSON.stringify({ elements: [
    { type: "node", id: "auto", x: 100, y: 180, width: "auto", height: "auto", text: "Automatic" },
    { type: "connector", from: { x: 10, y: 20 }, to: "auto" },
    { type: "connector", from: { x: 30, y: 40 }, to: { x: 500, y: 250 } },
  ] });
  const harness = await startArchitectureEditorHarness({ source });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(harness.url, { waitUntil: "load" });
    await expect(page.locator(".tree-item")).toHaveCount(3);
    await selectRefs(page, ["elements[1]"]);
    await openProperties(page);
    await expect(page.getByLabel("Source", { exact: true })).toHaveValue('{"x":10,"y":20}');
    await expect(page.locator('.tree-item[data-ref="elements[1]"]')).toContainText("(10, 20) → auto");
    await selectRefs(page, ["elements[1]", "elements[2]"]);
    await expect(page.getByLabel("Source", { exact: true })).toHaveValue("__mixed__");
    expect(harness.draftSource).toBe(source);
    await selectRefs(page, ["auto"]);
    await expect(page.getByLabel("Width", { exact: true })).toHaveValue("auto");
    await expect(page.getByLabel("Height", { exact: true })).toHaveValue("auto");
    await page.getByLabel("Text alignment", { exact: true }).selectOption("left");
    await expect.poll(() => draftElements(harness)[0].style?.textAlign).toBe("left");
    await page.getByLabel("Width", { exact: true }).fill("240");
    await page.getByLabel("Width", { exact: true }).press("Tab");
    await expect.poll(() => draftElements(harness)[0].width).toBe(240);
    expect(draftElements(harness)[0].height).toBe("auto");
    await page.getByLabel("Width", { exact: true }).fill("auto");
    await page.getByLabel("Width", { exact: true }).press("Tab");
    await expect.poll(() => draftElements(harness)[0].width).toBe("auto");
    expect(draftElements(harness)[1].from).toEqual({ x: 10, y: 20 });
    expect(errors).toEqual([]);
  } finally {
    await harness.close();
  }
});

async function openEditor(page) {
  const harness = await startArchitectureEditorHarness({
    source: SOURCE,
    assets: { "assets/existing.svg": EXISTING_SVG },
  });
  await page.goto(harness.url, { waitUntil: "load" });
  await expect(page.locator(".tree-item")).toHaveCount(3);
  return harness;
}

async function screenPoint(page, x, y) {
  return page.locator(".architecture-svg").evaluate((svg, point) => {
    const source = svg.createSVGPoint();
    source.x = point.x;
    source.y = point.y;
    const screen = source.matrixTransform(svg.getScreenCTM());
    return { x: screen.x, y: screen.y };
  }, { x, y });
}

async function addShape(page, name = "Rounded rectangle") {
  await page.getByRole("button", { name: "Shape", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

async function openProperties(page) {
  const panel = page.locator("#inspectorPanel");
  if (!(await panel.isVisible())) {
    await page.getByRole("button", { name: "Properties", exact: true }).click();
  }
}

async function openMore(page) {
  const menu = page.getByRole("menu", { name: "More editing controls" });
  if (!(await menu.isVisible())) {
    await page.getByRole("button", { name: "More", exact: true }).click();
  }
}

async function clickEditorAction(page, action) {
  const control = page.locator(`[data-action="${action}"]`);
  if (!(await control.isVisible())) await openMore(page);
  await control.click();
}

function boxesIntersect(left, right, gap = 20) {
  return !(
    left.x + left.width + gap <= right.x ||
    right.x + right.width + gap <= left.x ||
    left.y + left.height + gap <= right.y ||
    right.y + right.height + gap <= left.y
  );
}

test("multiselection Ctrl clicks only add and Shift ranges follow displayed nested tree order", async ({ page }) => {
  const harness = await openMultiEditor(page);
  try {
    await expect(page.getByRole("tree")).toHaveAttribute("aria-multiselectable", "true");
    await selectRefs(page, ["alpha", "beta", "alpha"]);
    await expectSelected(page, ["alpha", "beta"]);
    await page.locator('[data-editor-ref="picture"]').click({ modifiers: ["Control"] });
    await page.locator('[data-editor-ref="picture"]').click({ modifiers: ["Control"] });
    await expectSelected(page, ["alpha", "beta", "picture"]);

    await selectRefs(page, ["beta"]);
    await page.locator('.tree-item[data-ref="child"]').click({ modifiers: ["Shift"] });
    await expectSelected(page, ["beta", "picture", "zone", "child"]);
    await page.locator('.tree-item[data-ref="outside"]').click({ modifiers: ["Control", "Shift"] });
    await expectSelected(page, ["beta", "picture", "zone", "child", "outside"]);
    await expect(page.locator('.tree-item[data-ref="outside"]')).toBeFocused();
    await page.locator('[data-editor-ref="beta"]').click();
    await expectSelected(page, ["beta"]);
    expect(harness.draftSource).toBe(MULTI_SOURCE);
    await expect(page.locator('[data-action="save"]')).toBeDisabled();
    await expect(page.locator('[data-action="undo"]')).toBeDisabled();
  } finally {
    await harness.close();
  }
});

test("multiselection marquee requires full containment, includes images and groups, and excludes connectors", async ({ page }) => {
  const harness = await openMultiEditor(page);
  try {
    const viewport = page.locator("#viewport");
    const scroll = await viewport.evaluate((node) => [node.scrollLeft, node.scrollTop]);
    await dragBetween(page, [90, 90], [350, 260]);
    await expectSelected(page, ["alpha"]);
    await dragBetween(page, [710, 210], [590, 90], { modifiers: ["Control"] });
    await expectSelected(page, ["alpha", "picture"]);
    await dragBetween(page, [710, 590], [90, 90]);
    await expectSelected(page, ["alpha", "beta", "picture", "zone", "child"]);
    expect(await viewport.evaluate((node) => [node.scrollLeft, node.scrollTop])).toEqual(scroll);
    expect(harness.draftSource).toBe(MULTI_SOURCE);
    await expect(page.locator('[data-action="save"]')).toBeDisabled();
  } finally {
    await harness.close();
  }
});

test("multiselection marquee transfers keyboard focus before arrows edit the new selection", async ({ page }) => {
  const harness = await openMultiEditor(page);
  try {
    await selectRefs(page, ["alpha"]);
    await page.locator('[data-editor-ref="alpha"]').focus();
    await dragBetween(page, [310, 145], [495, 260]);
    await expectSelected(page, ["beta"]);
    await expect(page.locator('[data-editor-ref="beta"]')).toBeFocused();
    await page.keyboard.press("ArrowRight");
    const expected = JSON.parse(MULTI_SOURCE).elements;
    expected[1].x = 330;
    expected[1].y = 160;
    await expect.poll(() => draftElements(harness)).toEqual(expected);
    await expectSelected(page, ["beta"]);
    await page.locator('[data-action="undo"]').click();
    await expect.poll(() => draftElements(harness)).toEqual(JSON.parse(MULTI_SOURCE).elements);
    await dragBetween(page, [20, 20], [60, 60]);
    await expectSelected(page, []);
    await expect(page.locator("#viewport")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('[data-action="undo"]')).toBeDisabled();
    expect(draftElements(harness)).toEqual(JSON.parse(MULTI_SOURCE).elements);
  } finally {
    await harness.close();
  }
});

test("multiselection marquee has a translucent fill and solid outline across themes", async ({ page }) => {
  const harness = await openMultiEditor(page);
  try {
    for (const theme of ["dark", "light", "microsoft"]) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      await dragBetween(page, [90, 90], [500, 270], { release: false });
      const marquee = page.locator(".editor-marquee");
      await expect(marquee).toBeVisible();
      await expect(marquee).toHaveCSS("fill-opacity", "0.18");
      await expect(marquee).toHaveCSS("stroke-opacity", "1");
      await expect(marquee).toHaveCSS("opacity", "1");
      await expect(marquee).toHaveCSS("pointer-events", "none");
      await expectSelected(page, ["alpha", "beta"]);
      await page.mouse.up();
      await expect(marquee).toHaveCount(0);
      await expectSelected(page, ["alpha", "beta"]);
    }
    expect(harness.draftSource).toBe(MULTI_SOURCE);
  } finally {
    await harness.close();
  }
});

test("multiselection Space-left and middle drags pan even when starting on a shape", async ({ page }) => {
  const harness = await openMultiEditor(page);
  try {
    await selectRefs(page, ["alpha", "beta"]);
    for (let index = 0; index < 4; index += 1) await clickEditorAction(page, "zoom-in");
    const viewport = page.locator("#viewport");
    for (const gesture of [{ modifiers: ["Space"] }, { button: "middle" }]) {
      await viewport.evaluate((node) => { node.scrollLeft = 0; node.scrollTop = 0; });
      await dragBetween(page, [180, 170], [130, 140], gesture);
      await expect.poll(() => viewport.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
      await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
      await expectSelected(page, ["alpha", "beta"]);
      expect(harness.draftSource).toBe(MULTI_SOURCE);
    }
    await expect(page.locator('[data-action="undo"]')).toBeDisabled();
  } finally {
    await harness.close();
  }
});

test("multiselection drag snaps absolute bounds to a 10-unit grid and matches preview after zoom and scroll", async ({ page }) => {
  const harness = await openMultiEditor(page);
  try {
    await selectRefs(page, ["alpha", "beta"]);
    await expect(page.locator(".editor-resize-handle")).toHaveCount(0);
    const pattern = page.locator("#editor-grid-pattern");
    await expect(pattern).toHaveAttribute("patternUnits", "userSpaceOnUse");
    await expect(pattern).toHaveAttribute("width", "10");
    await expect(pattern).toHaveAttribute("height", "10");
    await clickEditorAction(page, "zoom-in");
    await clickEditorAction(page, "zoom-in");
    await page.locator("#viewport").evaluate((node) => { node.scrollLeft = 30; node.scrollTop = 20; });
    await dragBetween(page, [170, 170], [184, 194], { release: false });
    for (const ref of ["alpha", "beta"]) {
      await expect(page.locator(`[data-editor-ref="${ref}"]`)).toHaveAttribute("transform", "translate(17 23)");
    }
    expect(harness.draftSource).toBe(MULTI_SOURCE);
    await page.mouse.up();
    await expect.poll(() => draftElements(harness).slice(0, 2).map(({ x, y }) => [x, y]))
      .toEqual([[120, 150], [340, 180]]);
    await expectSelected(page, ["alpha", "beta"]);
    expect(draftElements(harness).slice(2)).toEqual(JSON.parse(MULTI_SOURCE).elements.slice(2));
    await page.locator('[data-action="undo"]').click();
    await expect.poll(() => draftElements(harness)).toEqual(JSON.parse(MULTI_SOURCE).elements);
    await expect(page.locator('[data-action="undo"]')).toBeDisabled();
    await page.locator('[data-action="redo"]').click();
    await expect.poll(() => draftElements(harness)[0].x).toBe(120);
  } finally {
    await harness.close();
  }
});

test("multiselection moves a selected group and independent root once, not its selected descendant twice", async ({ page }) => {
  const harness = await openMultiEditor(page);
  try {
    await selectRefs(page, ["zone", "child", "outside"]);
    await dragBetween(page, [350, 520], [364, 544], { release: false });
    for (const ref of ["zone", "child", "outside"]) {
      await expect(page.locator(`[data-editor-ref="${ref}"]`)).toHaveAttribute("transform", "translate(17 27)");
    }
    expect(harness.draftSource).toBe(MULTI_SOURCE);
    await page.mouse.up();
    await expect.poll(() => draftElements(harness).slice(3, 5).map(({ x, y }) => [x, y]))
      .toEqual([[120, 380], [820, 480]]);
    expect(draftElements(harness)[3].children).toEqual(JSON.parse(MULTI_SOURCE).elements[3].children);
    await expectSelected(page, ["zone", "child", "outside"]);
    await page.locator('[data-action="undo"]').click();
    await expect.poll(() => draftElements(harness)).toEqual(JSON.parse(MULTI_SOURCE).elements);
  } finally {
    await harness.close();
  }
});

test("multiselection snap off preserves free deltas and Escape or pointercancel never commits previews", async ({ page }) => {
  const harness = await openMultiEditor(page);
  try {
    await selectRefs(page, ["alpha", "beta"]);
    for (const cancellation of ["Escape", "pointercancel"]) {
      await dragBetween(page, [170, 170], [184, 194], { release: false });
      await expect(page.locator('[data-editor-ref="alpha"]')).toHaveAttribute("transform", "translate(17 23)");
      if (cancellation === "Escape") await page.keyboard.press("Escape");
      else await page.locator("#viewport").dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse" });
      await page.mouse.up();
      await expect(page.locator(".editor-drag-target")).toHaveCount(0);
      await expect(page.locator('[data-editor-ref="alpha"]')).not.toHaveAttribute("transform", /translate/);
      await expectSelected(page, ["alpha", "beta"]);
      expect(harness.draftSource).toBe(MULTI_SOURCE);
      await expect(page.locator('[data-action="undo"]')).toBeDisabled();
    }
    await dragBetween(page, [710, 590], [90, 90], { release: false });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expectSelected(page, ["alpha", "beta"]);
    await openMore(page);
    await page.locator("#snapToggle").uncheck();
    await page.keyboard.press("Escape");
    await dragBetween(page, [170, 170], [184, 194], { release: false });
    const translation = await page.locator('[data-editor-ref="alpha"]').getAttribute("transform");
    expect(translation).toMatch(/^translate\(/);
    await page.mouse.up();
    await expect.poll(() => draftElements(harness)[0].x).not.toBe(103);
    const [alpha, beta] = draftElements(harness);
    expect(alpha.x).toBeCloseTo(117, 1);
    expect(alpha.y).toBeCloseTo(151, 1);
    expect(beta.x - alpha.x).toBeCloseTo(220, 5);
    expect(beta.y - alpha.y).toBeCloseTo(30, 5);
    const [dx, dy] = translation.match(/[-\d.]+/g).map(Number);
    expect(alpha.x).toBeCloseTo(103 + dx, 3);
    expect(alpha.y).toBeCloseTo(127 + dy, 3);
  } finally {
    await harness.close();
  }
});

test("multiselection explicit and omitted defaults share a DSL token rather than a mixed or CSS value", async ({ page }) => {
  const raw = JSON.parse(MULTI_SOURCE);
  raw.elements[0].shape = "rounded-rect";
  raw.elements[0].style.stroke = "accent";
  delete raw.elements[1].shape;
  const source = `${JSON.stringify(raw, null, 2)}\n`;
  const harness = await openMultiEditor(page, source);
  try {
    await selectRefs(page, ["alpha", "beta"]);
    await openProperties(page);
    const shape = page.getByLabel("Shape", { exact: true });
    const stroke = page.getByLabel("Stroke", { exact: true });
    await expect(shape).toHaveValue("rounded-rect");
    await expect(shape.locator('option[value="__mixed__"]')).toHaveCount(0);
    await expect(stroke).toHaveValue("accent");
    await expect(stroke).not.toHaveAttribute("placeholder", "Multiple values");
    await shape.focus();
    await page.keyboard.press("Tab");
    await stroke.focus();
    await page.keyboard.press("Tab");
    expect(harness.draftSource).toBe(source);
    await expect(page.locator('[data-action="save"]')).toBeDisabled();
    await expect(page.locator('[data-action="undo"]')).toBeDisabled();
  } finally {
    await harness.close();
  }
});

test("multiselection mixed inspector is a no-op until one shared property is edited and persisted", async ({ page }) => {
  const harness = await openMultiEditor(page);
  try {
    await selectRefs(page, ["alpha", "beta"]);
    await openProperties(page);
    await expect(page.getByLabel("Text", { exact: true })).toHaveAttribute("placeholder", "Multiple values");
    await expect(page.getByLabel("X", { exact: true })).toHaveAttribute("placeholder", "Multiple values");
    await expect(page.getByLabel("Shape", { exact: true })).toHaveValue("__mixed__");
    await expect(page.getByLabel("Fill", { exact: true })).toHaveAttribute("placeholder", "Multiple values");
    for (const label of ["Text", "X", "Shape", "Fill"]) {
      await page.getByLabel(label, { exact: true }).focus();
      await page.keyboard.press("Tab");
    }
    await expect(page.locator('[data-action="undo"]')).toBeDisabled();
    expect(harness.draftSource).toBe(MULTI_SOURCE);

    await page.getByLabel("Fill", { exact: true }).fill("#556677");
    await page.getByLabel("Fill", { exact: true }).press("Enter");
    const expected = JSON.parse(MULTI_SOURCE).elements;
    expected[0].style.fill = "#556677";
    expected[1].style.fill = "#556677";
    await expect.poll(() => draftElements(harness)).toEqual(expected);
    expect(harness.saves).toHaveLength(0);
    expect(harness.markdown).not.toContain("#556677");
    await page.locator('[data-action="undo"]').click();
    await expect.poll(() => draftElements(harness)).toEqual(JSON.parse(MULTI_SOURCE).elements);
    await expect(page.locator('[data-action="undo"]')).toBeDisabled();
    await page.locator('[data-action="redo"]').click();
    await page.locator('[data-action="save"]').click();
    await expect(page.locator("#status")).toContainText("Saved");
    expect(harness.saves).toHaveLength(1);
    expect(harness.markdown).toContain('"fill": "#556677"');
    await page.reload({ waitUntil: "load" });
    await expect(page.locator(".tree-item")).toHaveCount(8);
    await expect.poll(() => draftElements(harness)).toEqual(expected);
    await selectRefs(page, ["alpha", "beta"]);
    await openProperties(page);
    await expect(page.getByLabel("Fill", { exact: true })).toHaveValue("#556677");
    await expect(page.getByLabel("Text", { exact: true })).toHaveAttribute("placeholder", "Multiple values");
    await expect(page.locator('[data-action="save"]')).toBeDisabled();
  } finally {
    await harness.close();
  }
});

test("multiselection connector checkbox is indeterminate and mixed types expose only intersecting properties", async ({ page }) => {
  const harness = await openMultiEditor(page);
  try {
    await selectRefs(page, ["elements[5]", "elements[6]"]);
    await openProperties(page);
    const arrow = page.getByLabel("Arrow", { exact: true });
    await expect(arrow).toHaveJSProperty("indeterminate", true);
    await expect(page.getByLabel("Routing", { exact: true })).toHaveValue("__mixed__");
    await arrow.focus();
    await page.keyboard.press("Tab");
    expect(harness.draftSource).toBe(MULTI_SOURCE);
    await arrow.check();
    await expect.poll(() => draftElements(harness).slice(5).map((item) => item.arrow)).toEqual([true, true]);
    expect(draftElements(harness).slice(5).map((item) => item.routing)).toEqual(["orthogonal", "straight"]);
    await page.locator('[data-action="undo"]').click();
    await expect.poll(() => draftElements(harness)).toEqual(JSON.parse(MULTI_SOURCE).elements);

    await selectRefs(page, ["alpha", "picture", "zone"]);
    await expect(page.getByLabel("X", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Width", { exact: true })).toBeVisible();
    await page.locator('.tree-item[data-ref="elements[5]"]').click({ modifiers: ["Control"] });
    for (const label of ["ID", "Parent", "Layout", "Text", "Shape", "Image", "Routing", "Arrow", "X", "Width"]) {
      await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
    }
    await expect(page.getByLabel("Opacity", { exact: true })).toBeVisible();
    await page.getByLabel("Opacity", { exact: true }).fill("0.5");
    await page.getByLabel("Opacity", { exact: true }).press("Enter");
    const expected = JSON.parse(MULTI_SOURCE).elements;
    for (const index of [0, 2, 3, 5]) expected[index].style = { ...expected[index].style, opacity: 0.5 };
    await expect.poll(() => draftElements(harness)).toEqual(expected);
    await page.locator('[data-action="undo"]').click();
    await expect.poll(() => draftElements(harness)).toEqual(JSON.parse(MULTI_SOURCE).elements);
    await expect(page.locator('[data-action="undo"]')).toBeDisabled();
  } finally {
    await harness.close();
  }
});

test("multiselection waypoint validation recovers from malformed JSON without rebuilding the inspector", async ({ page }) => {
  const raw = JSON.parse(MULTI_SOURCE);
  for (const [index, connector] of raw.elements.slice(5).entries()) {
    connector.routing = "polyline";
    connector.points = [{ x: 500, y: 300 + index * 50 }];
  }
  const source = `${JSON.stringify(raw, null, 2)}\n`;
  const harness = await openMultiEditor(page, source);
  try {
    await selectRefs(page, ["elements[5]", "elements[6]"]);
    await openProperties(page);
    const waypoints = page.getByLabel("Waypoints JSON", { exact: true });
    await expect(waypoints).toHaveAttribute("placeholder", "Multiple values");
    const originalField = await waypoints.elementHandle();
    await waypoints.fill("{");
    await waypoints.press("Tab");
    await expect.poll(() => waypoints.evaluate((field) => field.validity.customError)).toBe(true);
    expect(await originalField.evaluate((field) => field.isConnected)).toBe(true);
    expect(harness.draftSource).toBe(source);
    await expect(page.locator('[data-action="undo"]')).toBeDisabled();

    const points = [{ x: 510, y: 280 }, { x: 580, y: 320 }];
    await waypoints.fill(JSON.stringify(points));
    await waypoints.press("Tab");
    const expected = structuredClone(raw.elements);
    for (const connector of expected.slice(5)) connector.points = points;
    await expect.poll(() => draftElements(harness)).toEqual(expected);
    await expect(page.getByLabel("Waypoints JSON", { exact: true })).toHaveJSProperty("validationMessage", "");
    await page.locator('[data-action="undo"]').click();
    await expect.poll(() => draftElements(harness)).toEqual(raw.elements);
    await expect(page.locator('[data-action="undo"]')).toBeDisabled();
  } finally {
    await harness.close();
  }
});

test("multiselection duplicate remaps selected connections and delete removes roots with one-step undo", async ({ page }) => {
  const harness = await openMultiEditor(page);
  try {
    const original = JSON.parse(MULTI_SOURCE).elements;
    await selectRefs(page, ["alpha", "beta", "elements[5]", "elements[6]"]);
    await page.keyboard.press("Control+d");
    await expect.poll(() => draftElements(harness).length).toBe(11);
    const duplicated = draftElements(harness);
    const clones = duplicated.filter((item) => item.id && !original.some((old) => old.id === item.id));
    expect(clones).toHaveLength(2);
    const alpha = clones.find((item) => item.text === "Alpha");
    const beta = clones.find((item) => item.text === "Beta");
    expect(alpha.id).not.toBe(beta.id);
    expect(beta.x - alpha.x).toBe(220);
    expect(beta.y - alpha.y).toBe(30);
    expect(alpha.x).toBeGreaterThan(103);
    expect(duplicated.filter((item) => item.type === "connector").map(({ from, to }) => [from, to]))
      .toEqual(expect.arrayContaining([
        ["alpha", "beta"], ["beta", "outside"], [alpha.id, beta.id], [beta.id, "outside"],
      ]));
    await expect(page.locator('.tree-item[aria-selected="true"]')).toHaveCount(4);
    await page.locator('[data-action="undo"]').click();
    await expect.poll(() => draftElements(harness)).toEqual(original);
    await expect(page.locator('[data-action="undo"]')).toBeDisabled();

    await selectRefs(page, ["zone", "child", "outside"]);
    await page.keyboard.press("Control+d");
    await expect.poll(() => draftElements(harness).length).toBe(9);
    const groupClone = draftElements(harness).find((item) => item.type === "group" && item.id !== "zone");
    expect(groupClone.children).toHaveLength(1);
    expect(groupClone.children[0]).toMatchObject({ x: 23, y: 61, text: "Child" });
    expect(groupClone.children[0].id).not.toBe("child");
    expect(draftElements(harness).filter((item) => item.type === "connector")).toEqual(original.slice(5));
    await page.locator('[data-action="undo"]').click();
    await expect.poll(() => draftElements(harness)).toEqual(original);
    await expect(page.locator('[data-action="undo"]')).toBeDisabled();

    await selectRefs(page, ["zone", "child", "beta"]);
    await page.keyboard.press("Delete");
    await expect.poll(() => draftElements(harness)).toEqual(original.filter((item) => ["alpha", "picture", "outside"].includes(item.id)));
    await expect(page.locator('.tree-item[data-ref="child"]')).toHaveCount(0);
    await page.locator('[data-action="undo"]').click();
    await expect.poll(() => draftElements(harness)).toEqual(original);
    await expect(page.locator('[data-action="undo"]')).toBeDisabled();
  } finally {
    await harness.close();
  }
});

test("changes remain in the draft until the save button writes them to Markdown", async ({ page }) => {
  const harness = await openEditor(page);
  try {
    await expect(page.locator('[data-action="save"]')).toBeDisabled();
    await addShape(page);
    await expect(page.locator(".tree-item")).toHaveCount(4);
    await expect(page.locator('[data-action="save"]')).toBeEnabled();
    expect(harness.saves).toHaveLength(0);
    expect(harness.markdown).not.toContain('"id": "node"');

    await page.locator('[data-action="save"]').click();
    await expect(page.locator("#status")).toContainText("Saved");
    expect(harness.saves).toHaveLength(1);
    expect(harness.markdown).toContain('"id": "node"');
    await expect(page.locator('[data-action="save"]')).toBeDisabled();
  } finally {
    await harness.close();
  }
});

test("connector label overlap can be placed in front of or behind boxes", async ({ page }) => {
  const harness = await openEditor(page);
  try {
    await page.locator('[data-ref="elements[2]"].tree-item').click();
    await openProperties(page);
    const layer = page.locator('select[id^="field-labelLayer"]');
    await expect(layer).toHaveValue("front");
    await expect(
      page.locator(
        '.architecture-svg > [data-architecture-connector-label][data-architecture-label-layer="front"]',
      ),
    ).toHaveCount(0);

    await page.locator('input[id^="field-label"]').fill("HTTPS");
    await page.locator('input[id^="field-label"]').press("Enter");
    await expect(
      page.locator(
        '.architecture-svg > [data-architecture-connector-label][data-architecture-label-layer="front"]',
      ),
    ).toHaveCount(1);

    await layer.selectOption("behind");
    await expect(
      page.locator(
        '[data-architecture-connector] > [data-architecture-connector-label][data-architecture-label-layer="behind"]',
      ),
    ).toHaveCount(1);
    await expect(page.locator('[data-action="save"]')).toBeEnabled();
  } finally {
    await harness.close();
  }
});

test("connector line-style presets preserve the Architecture v1 dash contract", async ({ page }) => {
  const harness = await openEditor(page);
  try {
    await page.locator('[data-ref="elements[2]"].tree-item').click();
    await openProperties(page);
    const lineStyle = page.getByLabel("Line style");
    await expect(lineStyle).toHaveValue("solid");

    await lineStyle.selectOption("dotted");
    await expect.poll(
      () => JSON.parse(harness.draftSource).elements[2].style?.dash,
    ).toBe("1 5");
    await page.getByLabel("Line style").selectOption("custom");
    await expect(page.getByLabel("Dash pattern")).toHaveValue("6 3");
    await page.getByLabel("Line style").selectOption("solid");
    await expect.poll(
      () => JSON.parse(harness.draftSource).elements[2].style?.dash || "",
    ).toBe("");
  } finally {
    await harness.close();
  }
});

test("selection, keyboard movement, resizing, and undo/redo share one draft", async ({ page }) => {
  const harness = await openEditor(page);
  try {
    const client = page.locator('[data-editor-ref="client"]');
    await client.focus();
    const before = await client.evaluate((node) => node.getBBox().x);
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() =>
        page.locator('[data-editor-ref="client"]').evaluate((node) => node.getBBox().x),
      )
      .toBeGreaterThan(before);

    await page.locator('[data-ref="client"].tree-item').click();
    await openProperties(page);
    await expect(page.locator(".editor-resize-handle")).toHaveCount(4);
    const width = page.locator('input[id^="field-width"]');
    await width.fill("340");
    await width.press("Enter");
    await expect
      .poll(() =>
        page.locator('[data-editor-ref="client"]').evaluate((node) => node.getBBox().width),
      )
      .toBeGreaterThan(260);

    await page.locator('[data-action="undo"]').click();
    await page.locator('[data-action="redo"]').click();
    await expect(page.locator('[data-action="save"]')).toBeEnabled();
  } finally {
    await harness.close();
  }
});

test("the shape palette stays bounded and adds PowerPoint-compatible shapes", async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 720 });
  const harness = await openEditor(page);
  try {
    const trigger = page.getByRole("button", { name: "Shape", exact: true });
    await trigger.click();
    const palette = page.getByRole("menu", { name: "Add a shape" });
    await expect(palette).toBeVisible();
    await expect(palette.getByRole("menuitem")).toHaveCount(7);
    const bounds = await palette.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(560);

    await palette.getByRole("menuitem", { name: "Diamond", exact: true }).click();
    await expect(page.locator('[data-ref="node"].tree-item')).toHaveCount(1);
    await expect.poll(
      () => JSON.parse(harness.draftSource).elements.find((element) => element.id === "node")?.shape,
    ).toBe("diamond");
    await expect(page.locator('[data-editor-ref="node"] > polygon')).toHaveCount(1);
  } finally {
    await harness.close();
  }
});

test("an empty diagram offers a direct first-shape action", async ({ page }) => {
  const harness = await startArchitectureEditorHarness({
    source: `${JSON.stringify({ version: 1, elements: [] }, null, 2)}\n`,
  });
  try {
    await page.goto(harness.url, { waitUntil: "load" });
    const empty = page.locator(".editor-empty-state");
    await expect(empty.getByRole("heading", { name: "Build your first diagram" })).toBeVisible();
    await expect(page.locator("#status")).toContainText("Add the first shape");
    await empty.getByRole("button", { name: "Add first shape" }).click();
    await expect(page.locator('[data-ref="node"].tree-item')).toBeVisible();
    await expect(empty).toHaveCount(0);
    await expect(page.locator('[data-editor-ref="node"]')).toBeVisible();
  } finally {
    await harness.close();
  }
});

test("toolbar-added shapes avoid occupied siblings", async ({ page }) => {
  const harness = await openEditor(page);
  try {
    await addShape(page);
    await addShape(page, "Hexagon");
    await expect(page.locator(".tree-item")).toHaveCount(5);
    const elements = JSON.parse(harness.draftSource).elements.filter(
      (element) => element.type === "node",
    );
    const added = elements.filter((element) => element.id.startsWith("node"));
    expect(added).toHaveLength(2);
    for (const candidate of added) {
      expect(
        elements.some(
          (element) => element.id !== candidate.id && boxesIntersect(candidate, element),
        ),
      ).toBe(false);
    }
  } finally {
    await harness.close();
  }
});

test("medium and narrow layouts expose Elements and Properties as responsive drawers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 720 });
  const harness = await openEditor(page);
  try {
    const elementsButton = page.getByRole("button", { name: "Elements", exact: true });
    const propertiesButton = page.getByRole("button", { name: "Properties", exact: true });
    await expect(elementsButton).toBeVisible();
    await expect(propertiesButton).toBeVisible();
    await expect(page.locator("#elementPanel")).not.toBeVisible();
    await expect(page.locator("#inspectorPanel")).not.toBeVisible();

    const client = page.locator('[data-editor-ref="client"]');
    const clientBounds = await client.boundingBox();
    await page.mouse.move(
      clientBounds.x + clientBounds.width / 2,
      clientBounds.y + clientBounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      clientBounds.x + clientBounds.width / 2 + 40,
      clientBounds.y + clientBounds.height / 2,
    );
    await page.mouse.up();
    await expect(page.locator("#inspectorPanel")).not.toBeVisible();
    await expect.poll(
      () => JSON.parse(harness.draftSource).elements.find((element) => element.id === "client")?.x,
    ).toBeGreaterThan(100);

    await elementsButton.click();
    await expect(elementsButton).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#elementPanel")).toBeVisible();
    await page.locator('[data-ref="client"].tree-item').click();
    await expect(page.locator("#elementPanel")).toBeVisible();
    await propertiesButton.click();
    await expect(page.locator("#elementPanel")).not.toBeVisible();
    await expect(page.locator("#inspectorPanel")).toBeVisible();
    await expect(propertiesButton).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("ID", { exact: true })).toBeFocused();
    await expect(page.locator("#panelScrim")).toHaveCount(0);
    const fitted = await page.evaluate(() => {
      const viewport = document.querySelector("#viewport").getBoundingClientRect();
      const diagram = document.querySelector(".architecture-diagram").getBoundingClientRect();
      return {
        left: diagram.left - viewport.left,
        right: viewport.right - diagram.right,
      };
    });
    expect(fitted.left).toBeGreaterThanOrEqual(0);
    expect(fitted.right).toBeGreaterThanOrEqual(0);

    const selectedBounds = await page.locator('[data-editor-ref="client"]').boundingBox();
    await page.mouse.move(
      selectedBounds.x + selectedBounds.width / 2,
      selectedBounds.y + selectedBounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      selectedBounds.x + selectedBounds.width / 2 + 30,
      selectedBounds.y + selectedBounds.height / 2,
    );
    await page.mouse.up();
    await expect(page.locator("#inspectorPanel")).toBeVisible();

    await page.setViewportSize({ width: 520, height: 720 });
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Shape", exact: true })).toBeVisible();
    await expect(page.locator("#inspectorPanel")).toBeVisible();
    const headerHeight = await page.locator(".editor-header").evaluate((element) => element.offsetHeight);
    expect(headerHeight).toBeLessThan(120);
    const primaryHeights = await page.locator(".editor-actions > button, .editor-actions > div > button")
      .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
    expect(Math.min(...primaryHeights)).toBeGreaterThanOrEqual(40);
    await openMore(page);
    await expect(page.locator("#inspectorPanel")).not.toBeVisible();
    await expect(page.getByRole("menu", { name: "More editing controls" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Group", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  } finally {
    await harness.close();
  }
});

test("breakpoint changes preserve the focused panel without stale Escape handling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1300, height: 720 });
  const harness = await openEditor(page);
  try {
    const clientTreeItem = page.locator('[data-ref="client"].tree-item');
    await clientTreeItem.click();
    // Move focus in the same task so any deferred panel autofocus runs afterward.
    await page.getByRole("button", { name: "Properties", exact: true }).evaluate((button) => {
      button.click();
      document.querySelector('[data-ref="client"].tree-item').focus();
      return new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await expect(clientTreeItem).toBeFocused();

    await page.setViewportSize({ width: 900, height: 720 });
    await expect(page.locator("#elementPanel")).toBeVisible();
    await expect(page.locator("#inspectorPanel")).not.toBeVisible();
    await expect(clientTreeItem).toBeFocused();

    await page.setViewportSize({ width: 1300, height: 720 });
    await expect(page.locator("#elementPanel")).toBeVisible();
    await expect(page.locator("#inspectorPanel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#elementPanel")).toBeVisible();
    await expect(clientTreeItem).toHaveAttribute("aria-selected", "false");
  } finally {
    await harness.close();
  }
});

test("move and resize gestures show live transforms before committing", async ({ page }) => {
  const harness = await openEditor(page);
  try {
    const client = page.locator('[data-editor-ref="client"]');
    const clientBounds = await client.boundingBox();
    await page.mouse.move(
      clientBounds.x + clientBounds.width / 2,
      clientBounds.y + clientBounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      clientBounds.x + clientBounds.width / 2 + 60,
      clientBounds.y + clientBounds.height / 2 + 30,
    );
    await expect(client).toHaveClass(/editor-drag-target/);
    await expect.poll(() => client.getAttribute("transform")).toContain("translate");
    await page.mouse.up();
    await expect.poll(
      () => JSON.parse(harness.draftSource).elements.find((element) => element.id === "client")?.x,
    ).toBeGreaterThan(100);

    await page.locator('[data-ref="client"].tree-item').click();
    const handle = page.locator('.editor-resize-handle[data-corner="se"]');
    const handleBounds = await handle.boundingBox();
    await page.mouse.move(
      handleBounds.x + handleBounds.width / 2,
      handleBounds.y + handleBounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      handleBounds.x + handleBounds.width / 2 + 70,
      handleBounds.y + handleBounds.height / 2 + 40,
    );
    await expect.poll(() => client.getAttribute("transform")).toContain("matrix");
    await page.mouse.up();
    await expect.poll(
      () => JSON.parse(harness.draftSource).elements.find((element) => element.id === "client")?.width,
    ).toBeGreaterThan(260);
  } finally {
    await harness.close();
  }
});

test("large diagrams scroll and pan to the edges, then fit centered in the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  const harness = await openEditor(page);
  try {
    const viewport = page.locator("#viewport");
    const surface = page.locator("#canvasSurface");
    const diagram = page.locator(".architecture-diagram");
    await expect(page.locator("#status")).toContainText("Select an element to edit it");
    await clickEditorAction(page, "zoom-in");
    await clickEditorAction(page, "zoom-in");
    await clickEditorAction(page, "zoom-in");
    const initial = await viewport.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      scrollLeft: element.scrollLeft,
    }));
    expect(initial.scrollWidth).toBeGreaterThan(initial.clientWidth);
    expect(initial.scrollLeft).toBe(0);
    const leftEdge = await page.evaluate(() => ({
      viewportLeft: document.getElementById("viewport").getBoundingClientRect().left,
      diagramLeft: document.querySelector(".architecture-diagram").getBoundingClientRect().left,
    }));
    expect(leftEdge.diagramLeft).toBeGreaterThanOrEqual(leftEdge.viewportLeft);
    await expect
      .poll(() => surface.evaluate((element) => element.scrollWidth))
      .toBeGreaterThan(initial.clientWidth);

    await viewport.evaluate((element) => {
      element.scrollLeft = element.scrollWidth - element.clientWidth;
    });
    const rightEdge = await page.evaluate(() => {
      const viewportBounds = document.getElementById("viewport").getBoundingClientRect();
      const diagramBounds = document.querySelector(".architecture-diagram").getBoundingClientRect();
      return {
        viewportRight: viewportBounds.right,
        diagramRight: diagramBounds.right,
      };
    });
    expect(rightEdge.diagramRight).toBeLessThanOrEqual(rightEdge.viewportRight);

    await viewport.evaluate((element) => {
      element.scrollLeft = 0;
      element.scrollTop = 0;
    });
    const bounds = await viewport.boundingBox();
    await page.keyboard.down("Space");
    await page.mouse.move(bounds.x + 44, bounds.y + 44);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 4, bounds.y + 4);
    await page.mouse.up();
    await page.keyboard.up("Space");
    await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    await clickEditorAction(page, "zoom-fit");
    const fitted = await viewport.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      scrollLeft: element.scrollLeft,
    }));
    expect(fitted.scrollWidth - fitted.clientWidth).toBeLessThanOrEqual(1);
    expect(fitted.scrollLeft).toBe(0);

    await clickEditorAction(page, "zoom-out");
    const centers = await page.evaluate(() => {
      const viewportBounds = document.getElementById("viewport").getBoundingClientRect();
      const diagramBounds = document.querySelector(".architecture-diagram").getBoundingClientRect();
      return {
        viewport: (viewportBounds.left + viewportBounds.right) / 2,
        diagram: (diagramBounds.left + diagramBounds.right) / 2,
      };
    });
    expect(Math.abs(centers.viewport - centers.diagram)).toBeLessThanOrEqual(1);
    await expect(diagram).toBeVisible();
  } finally {
    await harness.close();
  }
});

test("adding connectors and deleting nodes preserves reference integrity", async ({ page }) => {
  const harness = await openEditor(page);
  try {
    await clickEditorAction(page, "add-connector");
    await page.locator('[data-editor-ref="api"]').click();
    await page.locator('[data-editor-ref="client"]').click();
    await expect(page.locator(".tree-item")).toHaveCount(4);

    await page.locator('[data-ref="api"].tree-item').click();
    await clickEditorAction(page, "delete");
    await expect(page.locator('[data-ref="api"].tree-item')).toHaveCount(0);
    await expect(page.locator(".tree-item")).toHaveCount(1);
  } finally {
    await harness.close();
  }
});

test("the asset picker edits standalone images and node icons", async ({ page }) => {
  const harness = await openEditor(page);
  try {
    await clickEditorAction(page, "add-image");
    const dialog = page.getByRole("dialog", { name: "Add image" });
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => dialog.locator(".asset-option img").first().evaluate((image) => image.naturalWidth))
      .toBeGreaterThan(0);
    await dialog.getByRole("option", { name: "assets/existing.svg" }).click();
    await dialog.getByRole("button", { name: "Select", exact: true }).click();

    await expect(page.locator('[data-ref="existing"].tree-item')).toBeVisible();
    await expect(page.locator('[data-editor-ref="existing"]')).toHaveAttribute(
      "data-architecture-type",
      "image",
    );
    await openProperties(page);
    await page.getByLabel("Display mode").selectOption("cover");
    await expect
      .poll(
        () =>
          JSON.parse(harness.draftSource).elements.find((element) => element.id === "existing")
            ?.fit,
      )
      .toBe("cover");

    await page.locator('[data-ref="existing"].tree-item').click({ button: "right" });
    await page.getByRole("menuitem", { name: "Start connector here" }).click();
    await page.locator('[data-editor-ref="api"]').click();
    await expect(page.locator('[data-architecture-type="connector"]')).toHaveCount(2);

    await page.locator('[data-ref="client"].tree-item').click();
    await openProperties(page);
    await page.getByRole("button", { name: "Select image from assets/" }).click();
    await expect(page.getByRole("dialog", { name: "Select node image" })).toBeVisible();
    await page.getByRole("option", { name: "assets/existing.svg" }).click();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await expect
      .poll(
        () =>
          JSON.parse(harness.draftSource).elements.find((element) => element.id === "client")
            ?.icon,
      )
      .toBe("assets/existing.svg");
  } finally {
    await harness.close();
  }
});

test("importing an image from the computer numbers duplicate names and diagram undo keeps the asset", async ({
  page,
}) => {
  const harness = await openEditor(page);
  try {
    await clickEditorAction(page, "add-image");
    await page.locator("#assetFileInput").setInputFiles({
      name: "existing.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(EXISTING_SVG),
    });
    await expect(page.locator("#assetDialogStatus")).toContainText(
      "Imported as assets/existing-2.svg",
    );
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await expect(page.locator('[data-ref="existing-2"].tree-item')).toBeVisible();
    expect(harness.assets.has("assets/existing-2.svg")).toBe(true);

    await page.locator('[data-action="undo"]').click();
    await expect(page.locator('[data-ref="existing-2"].tree-item')).toHaveCount(0);
    expect(harness.assets.has("assets/existing-2.svg")).toBe(true);

    await page.locator(".element-panel").click({
      button: "right",
      position: { x: 40, y: 400 },
    });
    await expect(
      page.getByRole("menuitem", { name: "Add image", exact: true }),
    ).toBeVisible();
  } finally {
    await harness.close();
  }
});

test("external-change conflicts remain visible without overwriting Markdown", async ({ page }) => {
  const harness = await openEditor(page);
  try {
    await addShape(page);
    harness.setConflict();
    await page.locator('[data-action="save"]').click();
    await expect(page.locator("#status")).toContainText("changed outside");
    await expect(page.locator("#status")).toHaveAttribute("data-kind", "error");
    expect(harness.saves).toHaveLength(0);
    await expect(page.locator('[data-action="save"]')).toBeEnabled();

    page.once("dialog", (dialog) => dialog.accept());
    await clickEditorAction(page, "reload");
    await expect(page.locator("#status")).toContainText("Reloaded");
    await expect(page.locator('[data-ref="node"].tree-item')).toHaveCount(0);
    await expect(page.locator('[data-action="save"]')).toBeDisabled();

    await addShape(page);
    await page.locator('[data-action="save"]').click();
    await expect(page.locator("#status")).toContainText("Saved");
    expect(harness.saves).toHaveLength(1);
  } finally {
    await harness.close();
  }
});

test("editing can continue with the current revision after reloading an unsaved draft", async ({ page }) => {
  const harness = await openEditor(page);
  try {
    await addShape(page);
    await expect(page.locator(".tree-item")).toHaveCount(4);
    await page.reload({ waitUntil: "load" });
    await expect(page.locator(".tree-item")).toHaveCount(4);

    await addShape(page);
    await expect(page.locator(".tree-item")).toHaveCount(5);
    await page.locator('[data-action="save"]').click();
    await expect(page.locator("#status")).toContainText("Saved");
    expect(JSON.parse(harness.saves[0]).elements).toHaveLength(5);
  } finally {
    await harness.close();
  }
});

test("reloading source Markdown does not carry over a draft from the old generation", async ({ page }) => {
  const harness = await openEditor(page);
  try {
    await addShape(page);
    await expect(page.locator('[data-ref="node"].tree-item')).toHaveCount(1);

    harness.reloadSource(SOURCE.replace('"text": "Client"', '"text": "Reloaded client"'));
    await expect(page.locator('[data-ref="node"].tree-item')).toHaveCount(0);
    await expect(page.locator('[data-ref="client"].tree-item')).toContainText("Reloaded client");

    await addShape(page);
    await page.locator('[data-action="save"]').click();
    await expect(page.locator("#status")).toContainText("Saved");
    expect(harness.markdown).toContain("Reloaded client");
    expect(harness.markdown).toContain('"id": "node"');
  } finally {
    await harness.close();
  }
});

test("a delayed stale state response does not roll back the generation after reload", async ({ page }) => {
  const harness = await openEditor(page);
  try {
    harness.delayNextState(300);
    await addShape(page);
    harness.reloadSource(SOURCE.replace('"text": "Client"', '"text": "Reloaded client"'));

    await expect(page.locator('[data-ref="client"].tree-item')).toContainText("Reloaded client");
    await page.waitForTimeout(400);
    await expect(page.locator('[data-ref="client"].tree-item')).toContainText("Reloaded client");
    await expect(page.locator('[data-ref="node"].tree-item')).toHaveCount(0);

    await addShape(page);
    await page.locator('[data-action="save"]').click();
    await expect(page.locator("#status")).toContainText("Saved");
    expect(harness.markdown).toContain("Reloaded client");
  } finally {
    await harness.close();
  }
});

test("edits made during save remain dirty instead of being marked saved", async ({ page }) => {
  const harness = await startArchitectureEditorHarness({
    source: SOURCE,
    saveDelay: 300,
  });
  try {
    await page.goto(harness.url, { waitUntil: "load" });
    await expect(page.locator(".tree-item")).toHaveCount(3);
    await addShape(page);
    await page.locator('[data-action="save"]').click();
    await expect(page.locator("#status")).toContainText("Saving");

    await addShape(page);
    await expect(page.locator(".tree-item")).toHaveCount(5);
    await expect(page.locator("#status")).toContainText("still unsaved");
    await expect(page.locator('[data-action="save"]')).toBeEnabled();
    expect(JSON.parse(harness.saves[0]).elements).toHaveLength(4);

    await page.locator('[data-action="save"]').click();
    await expect(page.locator("#status")).toContainText("Saved");
    expect(JSON.parse(harness.saves[1]).elements).toHaveLength(5);
  } finally {
    await harness.close();
  }
});

test("save server communication failures appear in the UI", async ({ page }) => {
  const harness = await openEditor(page);
  try {
    await addShape(page);
    await expect(page.locator('[data-action="save"]')).toBeEnabled();
    await page.route("**/save", (route) => route.abort("connectionfailed"));

    await page.locator('[data-action="save"]').click();
    await expect(page.locator("#status")).toContainText("Could not connect");
    await expect(page.locator('[data-action="save"]')).toBeEnabled();
  } finally {
    await harness.close();
  }
});

test("context menus on the canvas and element tree expose target-specific edit actions", async ({ page }) => {
  const harness = await openEditor(page);
  try {
    const menu = page.locator("#contextMenu");
    await page.locator('[data-editor-ref="client"]').click({ button: "right" });
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute("aria-label", /client/);
    await menu.getByRole("menuitem", { name: "Start connector here" }).click();
    await expect(page.locator(".connector-source")).toHaveCount(1);
    await page.locator('[data-editor-ref="api"]').click();
    await expect(page.locator(".tree-item")).toHaveCount(4);

    await page.locator('[data-ref="api"].tree-item').click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(page.locator('[data-ref="api-copy"].tree-item')).toHaveCount(1);

    await page.locator('[data-ref="api-copy"].tree-item').click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.locator('[data-ref="api-copy"].tree-item')).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

test("adds at a blank-area context-menu position and converts to parent-relative coordinates in groups", async ({ page }) => {
  const harness = await openEditor(page);
  try {
    const menu = page.locator("#contextMenu");
    const groupPoint = await screenPoint(page, 1200, 650);
    await page.mouse.click(groupPoint.x, groupPoint.y, { button: "right" });
    await menu.getByRole("menuitem", { name: "Add group here" }).click();
    await expect(page.locator('[data-ref="group"].tree-item')).toHaveCount(1);
    await expect.poll(() => JSON.parse(harness.draftSource).elements.find(
      (element) => element.id === "group",
    )).toMatchObject({ x: 940, y: 490, width: 520, height: 320 });

    const childPoint = await screenPoint(page, 1100, 600);
    await page.mouse.click(childPoint.x, childPoint.y, { button: "right" });
    await expect(menu.getByRole("menuitem", { name: "Add child node here" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "Add child node here" }).click();
    await expect(page.locator('[data-ref="node"].tree-item')).toHaveCount(1);
    await expect.poll(() => {
      const group = JSON.parse(harness.draftSource).elements.find(
        (element) => element.id === "group",
      );
      return group.children.find((element) => element.id === "node");
    }).toMatchObject({ x: 30, y: 40, width: 260, height: 140 });
  } finally {
    await harness.close();
  }
});

test("context menus support ordering, connector duplication, undo, and save", async ({ page }) => {
  const harness = await openEditor(page);
  try {
    const menu = page.locator("#contextMenu");
    await page.locator('[data-ref="client"].tree-item').click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Bring forward" }).click();
    await expect.poll(() => JSON.parse(harness.draftSource).elements[1].id).toBe("client");
    await page.locator('[data-ref="client"].tree-item').click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Send backward" }).click();
    await expect.poll(() => JSON.parse(harness.draftSource).elements[0].id).toBe("client");

    await page.locator(".tree-item").filter({ hasText: "client → api" }).click({ button: "right" });
    await expect(menu.getByRole("menuitem", { name: "Start connector here" })).toHaveCount(0);
    await menu.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(page.locator('[data-architecture-type="connector"]')).toHaveCount(2);

    const panel = page.locator(".element-panel");
    await panel.click({ button: "right", position: { x: 40, y: 400 } });
    await menu.getByRole("menuitem", { name: "Undo" }).click();
    await expect(page.locator('[data-architecture-type="connector"]')).toHaveCount(1);
    await panel.click({ button: "right", position: { x: 40, y: 400 } });
    await menu.getByRole("menuitem", { name: "Redo" }).click();
    await expect(page.locator('[data-architecture-type="connector"]')).toHaveCount(2);

    await panel.click({ button: "right", position: { x: 40, y: 400 } });
    await menu.getByRole("menuitem", { name: "Save to Markdown" }).click();
    await expect(page.locator("#status")).toContainText("Saved");
    expect(harness.saves).toHaveLength(1);
  } finally {
    await harness.close();
  }
});

test("blank space in the element tree adds near the visible canvas without overlap", async ({ page }) => {
  const harness = await openEditor(page);
  try {
    const menu = page.locator("#contextMenu");
    await page.locator(".element-panel").click({
      button: "right",
      position: { x: 40, y: 400 },
    });
    await expect(menu.getByRole("menuitem", { name: "Add node", exact: true })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Undo" })).toBeDisabled();
    await expect(menu.getByRole("menuitem", { name: "Save to Markdown" })).toBeDisabled();

    await menu.getByRole("menuitem", { name: "Add node", exact: true }).click();
    await expect(page.locator('[data-ref="node"].tree-item')).toHaveCount(1);
    await expect.poll(() => JSON.parse(harness.draftSource).elements.find(
      (element) => element.id === "node",
    )).toMatchObject({ width: 260, height: 140 });
    const elements = JSON.parse(harness.draftSource).elements;
    const added = elements.find((element) => element.id === "node");
    expect(added.x).toBeGreaterThan(300);
    expect(added.y).toBeGreaterThan(200);
    expect(elements.slice(0, 2).some((element) => boxesIntersect(added, element))).toBe(false);
  } finally {
    await harness.close();
  }
});

const WEIGHTED_GRID_SOURCE = JSON.stringify({
  elements: [{
    type: "group", id: "grid", x: 100, y: 100, width: 900, height: 500,
    layout: { type: "grid", columns: 2, columnWidths: [1, 2] },
    children: [{ type: "node", id: "a", text: "A" }, { type: "node", id: "b", text: "B" }],
  }],
});

test("weighted grid columns preserve ratios through count edits, undo, and save", async ({ page }) => {
  const harness = await startArchitectureEditorHarness({ source: WEIGHTED_GRID_SOURCE });
  try {
    await page.goto(harness.url, { waitUntil: "load" });
    await selectRefs(page, ["grid"]);
    await openProperties(page);
    const columns = page.getByLabel("Columns", { exact: true });
    const ratios = page.getByLabel("Column widths JSON", { exact: true });
    await expect(ratios).toHaveValue("[1,2]");
    await columns.fill("3");
    await columns.press("Tab");
    await expect.poll(() => draftElements(harness)[0].layout).toEqual({
      type: "grid", columns: 3, columnWidths: [1, 2, 1],
    });
    await ratios.fill("[2,3,4]");
    await ratios.press("Tab");
    await expect.poll(() => draftElements(harness)[0].layout.columnWidths).toEqual([2, 3, 4]);
    await columns.fill("1");
    await columns.press("Tab");
    await expect.poll(() => draftElements(harness)[0].layout.columnWidths).toEqual([2]);
    await page.locator('[data-action="undo"]').click();
    await expect.poll(() => draftElements(harness)[0].layout).toEqual({
      type: "grid", columns: 3, columnWidths: [2, 3, 4],
    });
    await columns.fill("2");
    await columns.press("Tab");
    await expect.poll(() => draftElements(harness)[0].layout.columnWidths).toEqual([2, 3]);
    await columns.fill("");
    await columns.press("Tab");
    await expect.poll(() => draftElements(harness)[0].layout).toEqual({
      type: "grid", columnWidths: [2, 3, 1],
    });
    await page.locator('[data-action="save"]').click();
    await expect(page.locator("#status")).toContainText("Saved");
    expect(harness.saves).toHaveLength(1);
    expect(harness.markdown).toContain(harness.draftSource.trim());
  } finally {
    await harness.close();
  }
});

test("weighted grid ratio validation is atomic and recovers without losing edits", async ({ page }) => {
  const harness = await startArchitectureEditorHarness({ source: WEIGHTED_GRID_SOURCE });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(harness.url, { waitUntil: "load" });
    await selectRefs(page, ["grid"]);
    await openProperties(page);
    const ratios = page.getByLabel("Column widths JSON", { exact: true });
    await ratios.fill("{");
    await ratios.press("Tab");
    await expect(ratios).toHaveJSProperty("validationMessage",
      "Enter a JSON array with one positive ratio per column.");
    expect(harness.draftSource).toBe(WEIGHTED_GRID_SOURCE);
    for (const invalid of ["[1]", "[0,2]", "[-1,2]", "[4001,2]", '["1",2]', "null", "{}"]) {
      await ratios.fill(invalid);
      await ratios.press("Tab");
      await expect(page.locator("#status")).toHaveAttribute("data-kind", "error");
      await expect(page.locator("#status")).toContainText("columnWidths");
      expect(harness.draftSource).toBe(WEIGHTED_GRID_SOURCE);
      await expect(page.locator('[data-action="undo"]')).toBeDisabled();
    }
    await ratios.fill("[3,1]");
    await ratios.press("Tab");
    await expect.poll(() => draftElements(harness)[0].layout.columnWidths).toEqual([3, 1]);
    await expect(ratios).toHaveJSProperty("validationMessage", "");
    await ratios.fill("");
    await ratios.press("Tab");
    await expect.poll(() => draftElements(harness)[0].layout.columnWidths).toBeUndefined();
    await page.locator('[data-action="undo"]').click();
    await expect.poll(() => draftElements(harness)[0].layout.columnWidths).toEqual([3, 1]);
    expect(errors).toEqual([]);
  } finally {
    await harness.close();
  }
});

test("weighted grid reselection preserves ratios and switching layout removes grid-only fields", async ({ page }) => {
  const harness = await startArchitectureEditorHarness({ source: WEIGHTED_GRID_SOURCE });
  try {
    await page.goto(harness.url, { waitUntil: "load" });
    await selectRefs(page, ["grid"]);
    await openProperties(page);
    await page.getByLabel("Layout", { exact: true }).selectOption("grid");
    expect(harness.draftSource).toBe(WEIGHTED_GRID_SOURCE);
    await expect(page.locator('[data-action="undo"]')).toBeDisabled();
    await page.locator('.tree-item[data-ref="grid"]').click({ button: "right" });
    await page.locator("#contextMenu").getByRole("menuitem", { name: "Layout", exact: true }).hover();
    await page.getByRole("menu", { name: "Layout for grid" })
      .getByRole("menuitemradio", { name: "grid", exact: true }).click();
    expect(harness.draftSource).toBe(WEIGHTED_GRID_SOURCE);
    await expect(page.locator('[data-action="undo"]')).toBeDisabled();
    await page.getByLabel("Layout", { exact: true }).selectOption("row");
    await expect.poll(() => draftElements(harness)[0].layout).toEqual({ type: "row" });
    await expect(page.getByLabel("Column widths JSON", { exact: true })).toHaveCount(0);
    await page.locator('[data-action="undo"]').click();
    await expect.poll(() => draftElements(harness)[0].layout).toEqual({
      type: "grid", columns: 2, columnWidths: [1, 2],
    });
  } finally {
    await harness.close();
  }
});

test("layout actions appear only in the group context submenu", async ({ page }) => {
  const source = `${JSON.stringify(
    {
      version: 1,
      canvas: { width: 1200, height: 700 },
      elements: [
        {
          type: "group",
          id: "zone",
          x: 100,
          y: 100,
          width: 800,
          height: 400,
          layout: {
            type: "grid",
            gap: 30,
            rowGap: 24,
            columnGap: 36,
            padding: 40,
            columns: 2,
          },
          children: [
            { type: "node", id: "api", text: "API" },
            { type: "node", id: "db", text: "Database" },
          ],
        },
      ],
    },
    null,
    2,
  )}\n`;
  const harness = await startArchitectureEditorHarness({ source });
  try {
    await page.goto(harness.url, { waitUntil: "load" });
    const menu = page.locator("#contextMenu");
    await page.locator('[data-ref="api"].tree-item').click({ button: "right" });
    await expect(menu.getByRole("menuitem", { name: "Layout", exact: true })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Release layout" })).toHaveCount(0);
    await expect(page.locator('[data-action="release-layout"]')).toBeDisabled();

    await page.locator('[data-ref="zone"].tree-item').click();
    await openProperties(page);
    await page.locator('[data-ref="zone"].tree-item').click({ button: "right" });
    const layoutTrigger = menu.getByRole("menuitem", { name: "Layout", exact: true });
    await expect(layoutTrigger).toHaveAttribute("aria-haspopup", "menu");
    await layoutTrigger.hover();
    const submenu = page.getByRole("menu", { name: "Layout for zone" });
    await expect(submenu).toBeVisible();
    await expect(submenu.getByRole("menuitemradio", { name: "grid" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByLabel("Columns")).toBeVisible();
    await submenu.getByRole("menuitemradio", { name: "layered" }).click();

    await expect.poll(() => JSON.parse(harness.draftSource).elements[0].layout).toEqual({
      type: "layered",
      gap: 30,
      rowGap: 24,
      columnGap: 36,
      padding: 40,
    });
    await page.getByLabel("Direction").selectOption("right");
    await expect.poll(
      () => JSON.parse(harness.draftSource).elements[0].layout.direction,
    ).toBe("right");
    await expect(page.getByLabel("Columns")).toHaveCount(0);

    await page.locator('[data-ref="zone"].tree-item').click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Layout", exact: true }).hover();
    await submenu.getByRole("menuitemradio", { name: "column" }).click();
    await expect.poll(() => JSON.parse(harness.draftSource).elements[0].layout).toEqual({
      type: "column",
      gap: 30,
      rowGap: 24,
      columnGap: 36,
      padding: 40,
    });
    await expect(page.getByLabel("Direction")).toHaveCount(0);

    await page.locator('[data-ref="zone"].tree-item').click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Layout", exact: true }).hover();
    await submenu.getByRole("menuitemradio", { name: "None" }).click();
    await expect.poll(
      () => JSON.parse(harness.draftSource).elements[0].layout,
    ).toBeUndefined();
    const child = JSON.parse(harness.draftSource).elements[0].children[0];
    expect(child.x).toEqual(expect.any(Number));
    expect(child.y).toEqual(expect.any(Number));

    await page.locator('[data-ref="zone"].tree-item').click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Layout", exact: true }).hover();
    await submenu.getByRole("menuitemradio", { name: "row" }).click();
    await expect.poll(() => JSON.parse(harness.draftSource).elements[0].layout).toEqual({
      type: "row",
    });
    const managedChild = JSON.parse(harness.draftSource).elements[0].children[0];
    expect(managedChild.x).toBeUndefined();
    expect(managedChild.y).toBeUndefined();
    await expect(page.locator('[data-action="release-layout"]')).toBeEnabled();
  } finally {
    await harness.close();
  }
});

test("group layout submenu supports left/right arrows and Escape returns focus to the target", async ({ page }) => {
  const source = `${JSON.stringify(
    {
      version: 1,
      canvas: { width: 1200, height: 700 },
      elements: [
        {
          type: "group",
          id: "zone",
          x: 100,
          y: 100,
          width: 800,
          height: 400,
          layout: "row",
          children: [{ type: "node", id: "api", text: "API" }],
        },
      ],
    },
    null,
    2,
  )}\n`;
  const harness = await startArchitectureEditorHarness({ source });
  try {
    await page.goto(harness.url, { waitUntil: "load" });
    const group = page.locator('[data-ref="zone"].tree-item');
    await group.focus();
    await page.keyboard.press("Shift+F10");
    const trigger = page.getByRole("menuitem", { name: "Layout", exact: true });
    await trigger.focus();
    await page.keyboard.press("ArrowRight");
    const submenu = page.getByRole("menu", { name: "Layout for zone" });
    await expect(submenu).toBeVisible();
    await expect(submenu.getByRole("menuitemradio", { name: "None" })).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(submenu.getByRole("menuitemradio", { name: "row" })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(submenu).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");
    await expect(page.locator("#contextMenu")).toBeHidden();
    await expect(group).toBeFocused();

    await group.evaluate((element) => {
      element.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: window.innerWidth - 2,
          clientY: window.innerHeight - 2,
        }),
      );
    });
    await page.getByRole("menuitem", { name: "Layout", exact: true }).hover();
    const bounds = await submenu.boundingBox();
    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
  } finally {
    await harness.close();
  }
});

test("keyboard controls the context menu and closing returns focus to the target", async ({ page }) => {
  const harness = await openEditor(page);
  try {
    const api = page.locator('[data-ref="api"].tree-item');
    await api.focus();
    await page.keyboard.press("Shift+F10");
    const menu = page.locator("#contextMenu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Start connector here" })).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "Duplicate" })).toBeFocused();
    await page.keyboard.press("End");
    await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(page.locator('[data-ref="api"].tree-item')).toBeFocused();

    const prevented = await page.locator('input[id^="field-"]').first().evaluate((input) => {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(false);
  } finally {
    await harness.close();
  }
});

test("Ctrl+S while editing an inspector field commits and saves the change", async ({ page }) => {
  const harness = await openEditor(page);
  try {
    await page.locator('[data-ref="client"].tree-item').click();
    await openProperties(page);
    const text = page.locator('textarea[id^="field-text-"]');
    await text.fill("Updated client");
    await page.keyboard.press("Control+S");

    await expect(page.locator("#status")).toContainText("Saved");
    expect(harness.saves).toHaveLength(1);
    expect(JSON.parse(harness.saves[0]).elements[0].text).toBe("Updated client");
  } finally {
    await harness.close();
  }
});

test("More stays open for repeated zoom clicks and keyboard activation", async ({ page }) => {
  const harness = await openEditor(page);
  try {
    const menu = page.getByRole("menu", { name: "More editing controls" });
    const trigger = page.getByRole("button", { name: "More", exact: true });
    const zoomIn = page.getByRole("menuitem", { name: "Zoom in", exact: true });
    const zoomOut = page.getByRole("menuitem", { name: "Zoom out", exact: true });
    const initialZoom = Number.parseInt(await page.locator("#zoomStatus").textContent(), 10);

    await openMore(page);
    for (let count = 1; count <= 2; count += 1) {
      await zoomIn.click();
      await expect(menu).toBeVisible();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(zoomIn).toBeFocused();
      await expect(page.locator("#zoomStatus")).toHaveText(`${initialZoom + count * 10}%`);
    }
    for (let count = 1; count <= 2; count += 1) {
      await zoomOut.click();
      await expect(menu).toBeVisible();
      await expect(zoomOut).toBeFocused();
      await expect(page.locator("#zoomStatus")).toHaveText(`${initialZoom + 20 - count * 10}%`);
    }
    await zoomIn.focus();
    await zoomIn.press("Enter");
    await expect(menu).toBeVisible();
    await expect(zoomIn).toBeFocused();
    await expect(page.locator("#zoomStatus")).toHaveText(`${initialZoom + 10}%`);
    await zoomOut.focus();
    await zoomOut.press("Space");
    await expect(menu).toBeVisible();
    await expect(zoomOut).toBeFocused();
    await expect(page.locator("#zoomStatus")).toHaveText(`${initialZoom}%`);
    expect(harness.draftSource).toBe(SOURCE);

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await openMore(page);
    await page.locator("#zoomStatus").click();
    await expect(menu).toBeHidden();
    await openMore(page);
    await page.locator('[data-action="zoom-fit"]').click();
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  } finally {
    await harness.close();
  }
});
