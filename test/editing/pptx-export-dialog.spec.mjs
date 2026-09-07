import { expect, test } from "@playwright/test";
import { startHarness } from "../harness/server.mjs";
import { clickMoreControl } from "../utils/nav.mjs";
import { waitForSlideReady } from "../utils/ready.mjs";

const MERMAID = "## Diagram\n\n```mermaid\nflowchart LR\n  A --> B\n```";

async function withDeck(page, slides, run) {
  const harness = await startHarness({ slides });
  try {
    await page.goto(harness.url);
    await waitForSlideReady(page);
    await run(harness);
  } finally {
    await harness.close();
  }
}

test("PowerPoint dialog detects later slides, submits images, and resets to shapes", async ({ page }) => {
  await withDeck(page, ["# Cover", MERMAID], async (harness) => {
    const requests = [];
    await page.route("**/export-pptx", (route) => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true, path: "slides.pptx" } });
    });
    await clickMoreControl(page, "#navExportPptx");
    const dialog = page.getByRole("dialog", { name: "Export PowerPoint" });
    const shapes = dialog.getByRole("radio", { name: "Editable shapes" });
    await expect(dialog).toBeVisible();
    await expect(shapes).toBeChecked();
    await expect(shapes).toBeFocused();
    expect(requests).toHaveLength(0);
    await page.keyboard.press("ArrowDown");
    await expect(dialog.getByRole("radio", { name: "Images", exact: true })).toBeChecked();
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    await expect.poll(() => requests).toEqual([{ mermaidImageFallback: true }]);
    await expect(dialog).not.toBeVisible();
    await expect(page.locator("#navMore")).toBeFocused();
    await expect(page.locator("#navExportPptx")).toBeEnabled();
    await clickMoreControl(page, "#navExportPptx");
    await expect(shapes).toBeChecked();
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    await expect.poll(() => requests).toEqual([
      { mermaidImageFallback: true },
      { mermaidImageFallback: false },
    ]);
    expect(harness.index).toBe(0);
  });
});

test("Cancel and Escape never export; focus and slide shortcuts stay in the dialog", async ({ page }) => {
  await withDeck(page, ["# Cover", MERMAID], async (harness) => {
    let requests = 0;
    await page.route("**/export-pptx", (route) => {
      requests++;
      return route.fulfill({ json: { ok: true, path: "slides.pptx" } });
    });
    const dialog = page.getByRole("dialog", { name: "Export PowerPoint" });
    await clickMoreControl(page, "#navExportPptx");
    await dialog.getByRole("button", { name: "Cancel" }).focus();
    for (const key of ["ArrowRight", "PageDown", "End", "o", "i"]) {
      await page.keyboard.press(key);
    }
    expect(harness.index).toBe(0);
    await expect(page.locator("#overview")).toBeHidden();
    await expect(page.locator("#importPicker")).toBeHidden();
    await dialog.getByRole("button", { name: "Export", exact: true }).focus();
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(page.locator("#navMore")).toBeFocused();
    await clickMoreControl(page, "#navExportPptx");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
    expect(requests).toBe(0);
  });
});

test("Mermaid examples in notes or outer code fences do not trigger the dialog", async ({ page }) => {
  const example = "# Examples\n\n````markdown\n```mermaid\nA --> B\n```\n````\n\n<!--\n```mermaid\nA --> B\n```\n-->";
  await withDeck(page, [example], async () => {
    await page.route("**/export-pptx", (route) => route.fulfill({ json: { ok: true, path: "slides.pptx" } }));
    await clickMoreControl(page, "#navExportPptx");
    await expect(page.locator("#exportNotification")).toHaveAttribute("data-state", "success");
    await expect(page.locator("#pptxExportDialog")).not.toBeVisible();
  });
});

test("PDF bypasses Mermaid options and deck lookup failures remain actionable", async ({ page }) => {
  await withDeck(page, ["# Cover", MERMAID], async () => {
    await page.route("**/export", (route) => route.fulfill({ json: { ok: true, path: "slides.pdf" } }));
    await clickMoreControl(page, "#navExport");
    await expect(page.locator("#exportNotification")).toHaveAttribute("data-state", "success");
    await expect(page.locator("#pptxExportDialog")).not.toBeVisible();
    await page.route("**/deck", (route) => route.fulfill({ status: 500 }));
    await clickMoreControl(page, "#navExportPptx");
    await expect(page.locator("#exportNotification")).toHaveAttribute("data-state", "error");
    await expect(page.locator("#exportNotification")).toContainText("Could not load the export deck");
    await expect(page.locator("#navExportPptx")).toBeEnabled();
  });
});

test("dialog fits narrow screens and remains accessible", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await withDeck(page, ["# Cover", MERMAID], async () => {
    await clickMoreControl(page, "#navExportPptx");
    const dialog = page.getByRole("dialog", { name: "Export PowerPoint" });
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(360);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(640);
    const { default: AxeBuilder } = await import("@axe-core/playwright");
    const result = await new AxeBuilder({ page }).include("#pptxExportDialog").analyze();
    expect(result.violations).toEqual([]);
    await page.emulateMedia({ forcedColors: "active" });
    await expect(dialog.getByRole("button", { name: "Export", exact: true })).toBeVisible();
  });
});
