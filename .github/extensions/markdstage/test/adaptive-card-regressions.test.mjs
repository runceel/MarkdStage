import assert from "node:assert/strict";
import test from "node:test";
import { buildDeckSlides } from "../markdown-deck.mjs";
import { validateLoadedDeck } from "../runtime/deck-validation.mjs";
import { validateAdaptiveCardSource } from "../renderer/adaptive-card-validation.mjs";
import { cardMarkdownCases, fatalFallbackCases } from "../../../../test/harness/adaptive-card-regressions.mjs";

for (const entry of fatalFallbackCases()) {
  test(`fatal structure cannot be rescued: ${entry.name}`, () => {
    const result = validateAdaptiveCardSource(JSON.stringify(entry.card));
    assert.equal(result.valid, false);
    assert.equal(result.card, null);
    assert.deepEqual(result.diagnostics.map(({ code, path, severity }) => ({ code, path, severity })),
      [{ code: entry.code, path: entry.path, severity: "error" }]);
  });
}

for (const entry of cardMarkdownCases()) {
  test(`canonical deck builder and validation use rendered Markdown semantics: ${entry.name}`, () => {
    const slides = buildDeckSlides(entry.markdown);
    const report = validateLoadedDeck({ slides, sourceName: "cards.md" });
    assert.equal(report.valid, !entry.states.includes("error"));
    assert.equal(report.complete, true);
    assert.equal(report.adaptiveCards.blocks.length, entry.states.length);
    assert.deepEqual(report.adaptiveCards.diagnostics.map((diagnostic) => diagnostic.code), entry.codes);
    for (const block of report.adaptiveCards.blocks) {
      assert.match(block.markdownPath, /^tokens\[/);
      assert.equal(block.lineBasis, "visible-markdown-body");
    }
    if (entry.name === "mixed fences and multiple containers") {
      assert.equal(report.adaptiveCards.diagnostics[0].blockIndex, 2);
      assert.equal(report.adaptiveCards.diagnostics[0].sourcePath, "adaptive-card[2]$.body[0].text");
    }
  });
}
