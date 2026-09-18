import { expect, test } from "@playwright/test";
import { startHarness } from "../harness/server.mjs";
import { adaptiveCardGeometry, staticCard } from "../harness/adaptive-cards.mjs";
import { adaptiveCardValidationReport } from "../../.github/extensions/markdstage/runtime/deck-validation.mjs";

test("browser and CLI agree on card fences, closed markers, container prefixes and literal examples", async ({ page }) => {
  const json = JSON.stringify(staticCard([{ type: "TextBlock", text: "Shared fence contract" }]));
  const fragments = [
    `~~~ADAPTIVE-CARD\n${json}\n~~~`,
    `\`\`\`adaptive-card example\n${json}\n\`\`\``,
    `> \`\`\`adaptive-card\n> ${json}\n> \`\`\``,
    `- \`\`\`adaptive-card\n  ${json}\n  \`\`\``,
    `\`\`\`adaptive-card\n${json}`,
    `\`\`\`\`markdown example\n\`\`\`adaptive-card\n{\n\`\`\`\n\`\`\`\``,
  ];
  const validation = adaptiveCardValidationReport(fragments);
  expect(validation.blocks).toHaveLength(5);
  expect(validation.blocks.map((block) => block.valid)).toEqual([true, true, true, true, false]);
  expect(validation.diagnostics.map((entry) => entry.code)).toEqual(["unclosed-adaptive-card-fence"]);
  const harness = await startHarness({ slides: fragments });
  try {
    await page.goto(`${harness.url}/?print=1&token=${harness.printToken}`);
    await expect(page.locator("html")).toHaveAttribute("data-print-ready", "true");
    const geometry = await page.evaluate(adaptiveCardGeometry);
    expect(geometry.map((slide) => slide.cards.map((card) => card.status)))
      .toEqual([["ready"], ["ready"], ["ready"], ["ready"], ["error"], []]);
    expect(geometry[4].cards[0].diagnostics[0].code).toBe("unclosed-adaptive-card-fence");
    await expect(page.locator(".adaptive-card-host").last().getByRole("alert")).toContainText("unclosed-adaptive-card-fence");
  } finally { await harness.close(); }
});

test("supported static PNG, JPEG and GIF bytes decode without losing hidden semantic objects", async ({ page }) => {
  const images = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2; canvas.height = 2;
    const context = canvas.getContext("2d");
    context.fillStyle = "#dd5500"; context.fillRect(0, 0, 2, 2);
    return [canvas.toDataURL("image/png"), canvas.toDataURL("image/jpeg")];
  });
  images.push("data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==");
  const json = JSON.stringify(staticCard([
    { type: "TextBlock", text: "Intentionally hidden", isVisible: false },
    ...images.map((url) => ({ type: "Image", url, width: "32px", height: "32px" })),
  ]));
  const harness = await startHarness({ slides: [`\`\`\`adaptive-card\n${json}\n\`\`\``] });
  try {
    await page.goto(`${harness.url}/?print=1&token=${harness.printToken}`);
    await expect(page.locator("html")).toHaveAttribute("data-print-ready", "true");
    const card = (await page.evaluate(adaptiveCardGeometry))[0].cards[0];
    expect(card.status).toBe("ready");
    expect(card.diagnostics).toEqual([]);
    expect(card.objects[1].geometry).toBe("hidden");
    expect(card.objects.filter((object) => object.type === "Image")).toHaveLength(3);
  } finally { await harness.close(); }
});
