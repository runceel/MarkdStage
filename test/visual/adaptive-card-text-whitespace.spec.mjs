import { expect, test } from "@playwright/test";
import { startHarness } from "../harness/server.mjs";
import { cardFence, staticCard } from "../harness/adaptive-cards.mjs";

test("native table text retains visible spaces at Markdown font-family boundaries", async ({ page }) => {
  const source = staticCard([
    { type: "FactSet", facts: [
      { title: "Code", value: "`code` next **bold** tail" },
      { title: "Space", value: "A<em> </em>B" },
    ] },
    { type: "Table", columns: [{ width: 1 }], rows: [
      { type: "TableRow", cells: [{ type: "TableCell", items: [
        { type: "TextBlock", text: "`mono` normal", wrap: true },
      ] }] },
    ] },
  ]);
  const harness = await startHarness({ slides: [cardFence(source)] });
  try {
    await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`);
    await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
    const slide = await page.evaluate(() => window.__presentationPptxModel.slides[0]);
    const tables = slide.elements.filter((element) => element.type === "table");
    expect(tables).toHaveLength(2);
    expect(tables[0].rows[0].cells[1].paragraphs.flatMap((paragraph) => paragraph.runs).map((run) => run.text).join(""))
      .toBe("code next bold tail");
    expect(tables[0].rows[1].cells[1].paragraphs.flatMap((paragraph) => paragraph.runs).map((run) => run.text).join(""))
      .toBe("A B");
    expect(tables[1].rows[0].cells[0].paragraphs.flatMap((paragraph) => paragraph.runs).map((run) => run.text).join(""))
      .toBe("mono normal");
    expect(slide.fallbacks.filter((entry) => entry.type === "adaptive-card")).toEqual([]);
  } finally { await harness.close(); }
});
