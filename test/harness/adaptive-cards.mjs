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

export const multipleCardsSlide = [
  "## Multiple cards, separate native and fallback ownership",
  cardFence(staticCard([{ type: "Container", style: "emphasis", items: [{ type: "TextBlock", text: "First card", weight: "Bolder" }] }])),
  cardFence(staticCard([{ type: "TextBlock", text: "Second transparent card" }])),
  cardFence("{"),
].join("\n\n");

export const boundarySlide = [
  "## Card crossing the bottom-right boundary",
  '<div style="position:absolute;left:1120px;top:610px;width:260px">',
  cardFence(staticCard([{ type: "Container", style: "emphasis", minHeight: "160px",
    items: [{ type: "TextBlock", text: "Visible corner", size: "Large", wrap: true }] }])),
  "</div>",
].join("\n\n");

export async function adaptiveCardReviewCases() {
  const initial = [...await adaptiveCardSlides(), placementSlide].map((markdown, index) => ({
    name: [...CARD_FIXTURES, "placement"][index], markdown,
    expected: [{ status: index === 5 ? "error" : "ready", codes: index === 5 ? ["unsupported-element"] : [] }],
  }));
  const extra = [];
  for (const [name, status, codes] of [
    ["fallbacks", "ready", ["requires-not-met", "fallback-substituted", "unsupported-element", "fallback-dropped"]],
    ["blocked-images", "ready", ["blocked-image", "image-load-failed", "blocked-image"]],
    ["malformed", "error", ["invalid-property"]],
  ]) extra.push({
    name, markdown: `## Adaptive Cards: ${name}\n\n${cardFence(await readFile(join(CARD_FIXTURE_DIRECTORY, `${name}.json`), "utf8"))}`,
    expected: [{ status, codes }],
  });
  const native = [];
  for (const [name, codes] of [
    ["mixed-native", ["static-link"]],
    ["native-text", []],
    ["static-inputs", Array(7).fill("static-input")],
    ["static-actions-media", ["static-action", "static-action", "static-link", "static-action", "static-media"]],
  ]) native.push({
    name, markdown: `## Adaptive Cards: ${name}\n\n${cardFence(await readFile(join(CARD_FIXTURE_DIRECTORY, `${name}.json`), "utf8"))}`,
    expected: [{ status: "ready", codes }],
  });
  return [...initial, ...extra,
    { name: "multiple", markdown: multipleCardsSlide,
      expected: [{ status: "ready", codes: [] }, { status: "ready", codes: [] }, { status: "error", codes: ["invalid-json"] }] },
    { name: "boundary", markdown: boundarySlide, expected: [{ status: "ready", codes: [] }] },
    ...native,
  ];
}

// Runs unchanged in Chromium and an actual CoreWebView2 controller.
export async function adaptiveCardGeometry() {
  const { collectAdaptiveCardGeometry } = await import(new URL("./renderer/adaptive-card.mjs", document.baseURI));
  return [...document.querySelectorAll(".deck:not(.pptx-layout-template)")].map((deck, index) => ({
    index, cards: [...deck.querySelectorAll(".adaptive-card-host")].map((host) => collectAdaptiveCardGeometry(host, deck)),
  }));
}

export async function adaptiveCardNativeModel() {
  const { collectAdaptiveCardPptx } = await import(new URL("./renderer/adaptive-card.mjs", document.baseURI));
  return Promise.all([...document.querySelectorAll(".deck:not(.pptx-layout-template)")].map(async (deck, index) => ({
    index, cards: await Promise.all([...deck.querySelectorAll(".adaptive-card-host")].map(async (host) => {
      const result = await collectAdaptiveCardPptx(host, deck);
      if (!result) return null;
      return { scene: result.scene, elements: result.elements, conversions: result.conversions,
        fallbacks: result.fallbacks.map(({ element: _element, ...fallback }) => fallback) };
    })),
  })));
}
