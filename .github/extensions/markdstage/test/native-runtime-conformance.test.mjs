import assert from "node:assert/strict";
import test from "node:test";
import { buildDeckSlides } from "../markdown-deck.mjs";
import { ensureBackCover } from "../deck-state.mjs";
import { parseFrontMatter } from "../renderer/theme.mjs";
import { deriveTitle } from "../renderer/slide-title.mjs";
import { extractSpeakerNotes, stripSpeakerNotes } from "../renderer/speaker-notes.mjs";
import { resolveDeckTheme, createSessionState, snapshotSession } from "../runtime/session-state.mjs";

// Preserve the retired Core parser/title/notes assertions in the shared engine.
for (const background of ["/assets/cover image.png", ""]) {
  test(`native parser parity: first-slide background ${JSON.stringify(background)} is not inherited`, () => {
    const slides = ensureBackCover(buildDeckSlides(
      `---\nlayout: title\nbackground-image: ${background}\n---\n# Title\n\n---\n\n# Body`,
    ));
    assert.equal(parseFrontMatter(slides[0])["background-image"], background);
    for (const slide of slides.slice(1)) assert.equal(Object.hasOwn(parseFrontMatter(slide), "background-image"), false);
  });
}

test("native parser parity: deck metadata, page numbers, theme and back cover", () => {
  const slides = ensureBackCover(buildDeckSlides(
    "---\ndeck: Demo\nlayout: title\ntheme: microsoft\n---\n# Cover\n\n---\n\n## Details\n\n- One",
  ));
  assert.equal(slides.length, 3);
  assert.match(slides[0], /layout: title/);
  assert.doesNotMatch(slides[0], /page:/);
  assert.match(slides[1], /page: 2/);
  assert.match(slides[1], /total: 2/);
  assert.match(slides[2], /layout: backcover/);
  assert.equal(resolveDeckTheme({ slides }).theme, "microsoft");
});

test("native parser parity: fenced separators and Setext headings do not split slides", () => {
  const slides = ensureBackCover(buildDeckSlides("## Code\n\n```text\n---\n```\n\nHeading\n---\n\nText"));
  assert.equal(slides.length, 2);
  assert.match(slides[0], /```text\n---\n```/);
  assert.match(slides[0], /Heading\n---/);
});

test("native parser parity: empty Markdown has no slides", () => {
  assert.deepEqual(buildDeckSlides(" \r\n\t"), []);
});

for (const [name, markdown, expected] of [
  ["first ATX heading", "Introductory text\n\n## Selected heading\n# Later heading", "Selected heading"],
  ["first body line", "\n\n  First body line  \nSecond body line", "First body line"],
  ["private notes are not fallback titles", "<!-- Internal talking point -->\nPublic body line", "Public body line"],
  ["leading slide front matter", "\n  ---\nlayout: section\npage: 2\n  ---\n# Deck content", "Deck content"],
  ["Markdown and link decoration", "### > **[`Linked_title`](https://example.com)** and ![image](asset.png) ~tag~", "Linkedtitle and image tag"],
  ["forty character limit", `# ${"a".repeat(41)}`, `${"a".repeat(40)}…`],
  ["empty", "", "(Untitled)"],
  ["whitespace", " \n\t", "(Untitled)"],
  ["decoration only", "# ~_`*_", "(Untitled)"],
  ["back cover", "---\nlayout: backcover\n---\n", "(Untitled)"],
]) {
  test(`native title parity: ${name}`, () => assert.equal(deriveTitle(markdown), expected));
}

test("native notes parity: top-level comments preserve Markdown and paragraph boundaries", () => {
  assert.equal(
    extractSpeakerNotes("## Slide\n\n<!--\nStart with **why**.\nThen show the demo.\n-->\n\n<!-- End with questions. -->"),
    "Start with **why**.\nThen show the demo.\n\nEnd with questions.",
  );
});

test("native notes parity: fenced examples and slide-size directives are excluded", () => {
  assert.equal(
    extractSpeakerNotes("<!-- slide-size: large -->\n\n```markdown\n<!-- This is an example, not a note. -->\n```\n\n<!-- Actual note. -->"),
    "Actual note.",
  );
});

test("native notes parity: fenced code inside a speaker note is preserved", () => {
  assert.match(
    extractSpeakerNotes('<!--\nShow this code:\n\n```js\nconst marker = "---";\n```\n-->'),
    /```js\nconst marker = "---";\n```/,
  );
});

test("native notes parity: stripping notes preserves fenced comments", () => {
  assert.equal(
    stripSpeakerNotes("Intro\n<!-- private note -->\n```html\n<!-- visible example -->\n```\nOutro"),
    "Intro\n\n```html\n<!-- visible example -->\n```\nOutro",
  );
});

test("native notes parity: inline and indented code markers stay visible", () => {
  const markdown = "`<!-- inline code -->`\n    <!-- indented code -->\n<!-- actual note -->";
  assert.equal(extractSpeakerNotes(markdown), "actual note");
  assert.equal(stripSpeakerNotes(markdown), "`<!-- inline code -->`\n    <!-- indented code -->\n");
});

test("native snapshot exposes detached shared speaker notes alongside titles", () => {
  const session = createSessionState();
  session.slides = ["# Public\n<!-- Private **note** -->", "---\nlayout: backcover\n---\n"];
  const snapshot = snapshotSession(session);
  assert.deepEqual(snapshot.titles, ["Public", "(Untitled)"]);
  assert.deepEqual(snapshot.notes, ["Private **note**", ""]);
  snapshot.notes[0] = "Changed";
  assert.equal(snapshotSession(session).notes[0], "Private **note**");
});
