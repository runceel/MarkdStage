import { expect, test } from "@playwright/test";

import { startHarness } from "../harness/server.mjs";

// Archify renders during the deferred diagram pass, so at first layout the slide
// only holds an empty `.archify-diagram` placeholder. Auto sizing used to run
// before that pass and saw a nearly empty body, which promoted the deck to
// `size-xlarge` and exported headings and prose far larger than the preview.
const ARCHIFY_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">',
  '  <g data-node-label="Checkout API">',
  '    <rect class="c-backend" x="40" y="60" width="240" height="90" rx="8"/>',
  '    <text class="t-backend" x="160" y="110" font-size="13" text-anchor="middle">Checkout API</text>',
  "  </g>",
  '  <g data-node-label="Storage">',
  '    <rect class="c-database" x="360" y="60" width="240" height="90" rx="8"/>',
  '    <text class="t-database" x="480" y="110" font-size="13" text-anchor="middle">Storage</text>',
  "  </g>",
  "</svg>",
].join("\n");

const SLIDE = [
  "## Archify import keeps preview sizing",
  "",
  "Short body copy that would look small on its own.",
  "",
  "```archify",
  "assets/archify-auto-size.svg",
  "```",
].join("\n");

test("an Archify slide exports at the preview text size instead of being promoted", async ({ page }) => {
  const harness = await startHarness({ slides: [SLIDE] });
  try {
    await page.route("**/assets/archify-auto-size.svg", (route) => route.fulfill({
      contentType: "image/svg+xml",
      body: ARCHIFY_SVG,
    }));

    await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`, { waitUntil: "load" });
    await expect(page.locator("html")).toHaveAttribute("data-pptx-ready", "true");
    await expect(page.locator(".archify-error, .architecture-error")).toHaveCount(0);

    // The deck must not have been promoted while the placeholder was empty.
    expect(await page.evaluate(() => [...document.querySelectorAll(".deck")]
      .map((deck) => [...deck.classList].filter((name) => name.startsWith("size-"))).flat()))
      .toEqual([]);

    const model = await page.evaluate(() => window.__presentationPptxModel);
    const slide = model.slides.find((entry) => entry.title?.includes("Archify import"));
    expect(slide).toBeTruthy();

    const runs = slide.elements
      .filter((element) => element.type === "text")
      .flatMap((element) => element.paragraphs?.flatMap((paragraph) => paragraph.runs) ?? []);
    const heading = runs.find((run) => run.text.includes("Archify import keeps preview sizing"));
    const body = runs.find((run) => run.text.includes("Short body copy"));

    // `body.fixed-output-mode .deck` normal tokens: h2 36px, body 22px.
    // `.size-xlarge` would report 48px and 28px instead.
    expect(heading.fontSize).toBe(36);
    expect(body.fontSize).toBe(22);
  } finally {
    await harness.close();
  }
});
