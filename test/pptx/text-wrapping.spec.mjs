import { expect, test } from "@playwright/test";

import { startHarness } from "../harness/server.mjs";

async function exportModel(page, harness) {
  await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`, { waitUntil: "load" });
  await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
  return page.evaluate(() => window.__presentationPptxModel);
}

const textOf = (element) =>
  element.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join("")).join("\n");

function findText(slide, needle) {
  const element = slide.elements.find(
    (candidate) => candidate.type === "text" && textOf(candidate).includes(needle),
  );
  expect(element, `no exported text contains ${JSON.stringify(needle)}`).toBeTruthy();
  return element;
}

test("a heading the deck wraps stays wrappable in PowerPoint", async ({ page }) => {
  // Line rects overlap whenever the line height is tighter than the font box, so
  // a wrapped heading used to be counted as a single line and exported with
  // wrapping switched off. PowerPoint then ran it off the side of the slide.
  const heading = "AI と人が一緒に育てる、Markdown ベースのスライド作成環境と長い見出しの例";
  const harness = await startHarness({
    slides: [["---", "layout: title", "---", "# Title", "", `## ${heading}`].join("\n")],
  });
  // Themes routinely set a line height tighter than the font's own box, which is
  // what makes consecutive line rects overlap and used to merge them into one.
  await page.addInitScript(() => {
    const inject = () => {
      if (!document.documentElement) {
        setTimeout(inject, 0);
        return;
      }
      const style = document.createElement("style");
      style.textContent = ".title-slide .body h2{line-height:1.14 !important;}";
      document.documentElement.append(style);
    };
    inject();
  });
  try {
    const model = await exportModel(page, harness);
    const element = findText(model.slides[0], heading);

    const lines = await page.evaluate((text) => {
      const node = [...document.querySelectorAll(".slide-title, .body h2")]
        .find((candidate) => candidate.textContent.includes(text));
      const range = document.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()]
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => Math.round(rect.bottom));
    }, heading);
    expect(new Set(lines).size, "the deck itself must wrap this heading").toBeGreaterThan(1);

    expect(element.textWrap).toBeUndefined();
  } finally {
    await harness.close();
  }
});

test("a shrink-to-fit paragraph exports with the room the deck gave it", async ({ page }) => {
  // A paragraph sized to its own glyph advances has no slack, and PowerPoint
  // measures the same string slightly wider, which used to drop the last
  // character of a long URL onto its own line.
  const url = "https://github.com/runceel/markdstage-with-a-long-path";
  const harness = await startHarness({
    slides: [["---", "layout: title", "---", "# Title", "", "**MarkdStage**  ", url].join("\n")],
  });
  // Themes are free to lay the title column out as a shrink-to-fit block, which
  // is how the reported deck hit this. Reproduce that here rather than relying on
  // a built-in theme keeping its current box model.
  await page.addInitScript(() => {
    const inject = () => {
      if (!document.documentElement) {
        setTimeout(inject, 0);
        return;
      }
      const style = document.createElement("style");
      style.textContent =
        ".title-slide .body{align-items:flex-start !important;text-align:left !important;}";
      document.documentElement.append(style);
    };
    inject();
  });
  try {
    const model = await exportModel(page, harness);
    const element = findText(model.slides[0], url);

    const room = await page.evaluate((text) => {
      const node = [...document.querySelectorAll(".body p")]
        .find((candidate) => candidate.textContent.includes(text));
      const style = getComputedStyle(node.parentElement);
      const rect = node.parentElement.getBoundingClientRect();
      return {
        paragraph: node.getBoundingClientRect().width,
        available: rect.width -
          Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight) -
          Number.parseFloat(style.borderLeftWidth) - Number.parseFloat(style.borderRightWidth),
      };
    }, url);

    expect(room.paragraph, "the fixture must be shrink to fit").toBeLessThan(room.available - 1);
    expect(element.width).toBeGreaterThan(room.paragraph + 1);
    expect(element.width).toBeLessThanOrEqual(Math.ceil(room.available) + 1);
  } finally {
    await harness.close();
  }
});
