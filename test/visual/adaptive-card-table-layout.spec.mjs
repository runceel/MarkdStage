import { expect, test } from "@playwright/test";
import { startHarness } from "../harness/server.mjs";
import { cardFence, staticCard } from "../harness/adaptive-cards.mjs";

const cell = (text, extra = {}) => ({ type: "TableCell",
  items: [{ type: "TextBlock", text, wrap: true, ...extra }] });
const table = (rows) => ({ type: "Table", columns: [{ width: 1 }], rows });

test("native table rows and centered wrapped lines retain measured offsets", async ({ page }) => {
  const source = staticCard([{ type: "ColumnSet", columns: [
    { type: "Column", width: "360px", items: [table([
      { type: "TableRow", cells: [cell("A centered line wraps across the narrow table cell.\n\nShort",
        { horizontalAlignment: "Center" })] },
      { type: "TableRow", cells: [cell("Tail")] },
    ])] },
    { type: "Column", width: "stretch", items: [{ type: "TextBlock", text: "Native neighbor" }] },
  ] }]);
  const harness = await startHarness({ slides: [cardFence(source)] });
  try {
    await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`);
    await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
    const slide = await page.evaluate(() => window.__presentationPptxModel.slides[0]);
    const native = slide.elements.find((element) => element.type === "table");
    expect(native).toBeTruthy();
    expect(native.measuredRows).toBe(true);
    expect(native.rows[0].height).toBeGreaterThan(native.rows[1].height);
    expect(native.rows.reduce((sum, row) => sum + row.height, 0)).toBeCloseTo(native.height, 2);
    expect(native.rows[0].cells[0].paragraphs.length).toBeGreaterThan(1);
    expect(native.rows[0].cells[0].paragraphs.some((paragraph) => paragraph.leftMargin > 20)).toBe(true);
    expect(slide.fallbacks.filter((entry) => entry.type === "adaptive-card")).toEqual([]);
  } finally { await harness.close(); }
});

test("RTL tables with Latin fields stay local artwork rather than swapping editable cell contents", async ({ page }) => {
  const source = staticCard([
    { type: "Container", rtl: true, items: [
      { type: "FactSet", facts: [{ title: "Key", value: "Value" }] },
      table([{ type: "TableRow", cells: [cell("First")] }]),
    ] },
    { type: "TextBlock", text: "Native outside the RTL tables" },
  ]);
  const harness = await startHarness({ slides: [cardFence(source)] });
  try {
    await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`);
    await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
    const slide = await page.evaluate(() => window.__presentationPptxModel.slides[0]);
    expect(slide.fallbacks.filter((entry) => entry.type === "adaptive-card").map((entry) => entry.reason))
      .toEqual(["adaptive-card-bidirectional-table", "adaptive-card-bidirectional-table"]);
    expect(slide.elements.filter((entry) => entry.type === "table")).toEqual([]);
    expect(slide.elements.some((entry) => entry.path.startsWith("adaptive-card[0]$.body[1].lines"))).toBe(true);
  } finally { await harness.close(); }
});
