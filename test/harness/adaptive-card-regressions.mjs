import { cardFence, staticCard } from "./adaptive-cards.mjs";

export function fatalFallbackCases() {
  const replacement = { type: "TextBlock", text: "Replacement" };
  const base = { type: "TextBlock", text: "Original", requires: { otherHost: "1.0" }, fallback: replacement };
  return [
    { name: "invalid text before requires fallback", element: { ...base, text: 42 }, code: "invalid-property", path: "$.body[0].text" },
    { name: "selectAction before requires fallback", element: { ...base, selectAction: { type: "Action.OpenUrl", url: "https://blocked.example/action" } },
      code: "unsupported-interactivity", path: "$.body[0].selectAction" },
    { name: "background before requires fallback", element: { ...base, backgroundImage: "https://blocked.example/background.png" },
      code: "unsupported-resource", path: "$.body[0].backgroundImage" },
    { name: "complete requires map validation", element: { ...base, requires: { otherHost: "1.0", adaptiveCards: true } },
      code: "invalid-property", path: "$.body[0].requires.adaptiveCards" },
    { name: "malformed collection before fallback", element: { type: "Container", items: {}, requires: { otherHost: "1.0" }, fallback: replacement },
      code: "invalid-collection", path: "$.body[0].items" },
    { name: "fatal sibling after unsupported child", element: { type: "Container",
      items: [{ type: "Unknown" }, { type: "TextBlock", text: 42 }], fallback: replacement },
      code: "invalid-property", path: "$.body[0].items[1].text" },
    { name: "malformed unused fallback", element: { type: "TextBlock", text: "Original", fallback: { type: "TextBlock", text: 42 } },
      code: "invalid-property", path: "$.body[0].fallback.text" },
  ].map(({ element, ...entry }) => ({ ...entry, card: staticCard([element]) }));
}

export function cardMarkdownCases() {
  const good = (text) => cardFence(staticCard([{ type: "TextBlock", text }]));
  const invalid = cardFence(staticCard([{ type: "TextBlock", text: 42 }]));
  return [
    { name: "nested list", markdown: "- Parent\n  - Child\n\n" + invalid.split("\n").map((line) => `    ${line}`).join("\n"),
      states: ["error"], codes: ["invalid-property"] },
    { name: "speaker notes", markdown: `<!--\n${invalid}\n-->`, states: [], codes: [] },
    { name: "speaker notes followed by a card", markdown: `<!--\n${invalid}\n-->\n\n${good("Visible after notes")}`,
      states: ["ready"], codes: [], text: ["Visible after notes"] },
    { name: "mixed fences and multiple containers", markdown: [
      good("First"),
      "````markdown example\n" + invalid + "\n````",
      "<!--\n" + invalid + "\n-->",
      "> - Quoted parent\n>   - Quoted child\n>\n" + good("Nested second").split("\n").map((line) => `>     ${line}`).join("\n"),
      invalid,
    ].join("\n\n"), states: ["ready", "ready", "error"], codes: ["invalid-property"], text: ["First", "Nested second"] },
  ];
}
