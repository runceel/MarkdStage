import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const CARD_FIXTURE_DIRECTORY = fileURLToPath(new URL("../fixtures/adaptive-cards/", import.meta.url));
export const CARD_FIXTURES = ["typography", "columns", "images", "facts-table", "clipping", "unsupported"];
export const cardFence = (card) => `\`\`\`adaptive-card\n${typeof card === "string" ? card : JSON.stringify(card)}\n\`\`\``;
export const staticCard = (body) => ({ type: "AdaptiveCard", version: "1.5", body });

export const placementSlide = [
  "## Bounded card and neighboring artwork",
  '<div style="position:absolute;left:84px;top:120px;width:500px;height:180px;background:#703020;z-index:0">Generic background</div>',
  cardFence(staticCard([{ type: "Container", style: "emphasis", minHeight: "140px",
    items: [{ type: "TextBlock", text: "Card artwork", size: "Large", weight: "Bolder" }] }])),
  '<p style="position:absolute;left:140px;top:210px;z-index:10;color:#ffcc44">Native foreground neighbor</p>',
].join("\n\n");

export async function adaptiveCardSlides() {
  return Promise.all(CARD_FIXTURES.map(async (name) =>
    `## Adaptive Cards: ${name}\n\n${cardFence(await readFile(join(CARD_FIXTURE_DIRECTORY, `${name}.json`), "utf8"))}`));
}

// Runs unchanged in Chromium and an actual CoreWebView2 controller.
export async function adaptiveCardGeometry() {
  const { collectAdaptiveCardGeometry } = await import(new URL("./renderer/adaptive-card.mjs", document.baseURI));
  return [...document.querySelectorAll(".deck:not(.pptx-layout-template)")].map((deck, index) => ({
    index, cards: [...deck.querySelectorAll(".adaptive-card-host")].map((host) => collectAdaptiveCardGeometry(host, deck)),
  }));
}
