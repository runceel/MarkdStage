import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSlideMarkdown } from "../renderer/fenced-blocks.mjs";
import { markedLexer } from "../renderer/marked-lexer.mjs";
import { ALERT_TYPES, extractAlerts } from "../renderer/markdown-alerts.mjs";

const parse = (markdown) => parseSlideMarkdown(markdown, markedLexer);
const html = (tokens) => markedLexer.parser(tokens);

test("every GitHub alert type is recognized case-insensitively", () => {
  for (const type of Object.keys(ALERT_TYPES)) {
    for (const spelling of [type.toUpperCase(), type, type[0].toUpperCase() + type.slice(1)]) {
      const { alerts } = parse(`> [!${spelling}]\n> Body text`);
      assert.equal(alerts.length, 1, spelling);
      assert.equal(alerts[0].type, type);
      assert.equal(alerts[0].label, ALERT_TYPES[type].label);
    }
  }
});

test("the marker line is removed and the remaining Markdown is preserved", () => {
  const parsed = parse([
    "> [!WARNING]",
    "> Rotate **keys** before [the release][r].",
    ">",
    "> - one",
    "> - two",
    "",
    "[r]: https://example.com/release",
  ].join("\n"));
  assert.equal(parsed.alerts.length, 1);
  const output = html(parsed.tokens);
  assert.doesNotMatch(output, /\[!WARNING\]/i);
  assert.match(output, /<p>Rotate <strong>keys<\/strong> before <a href="https:\/\/example\.com\/release">the release<\/a>\.<\/p>/);
  assert.match(output, /<li>one<\/li>/);
});

test("a marker on its own paragraph is dropped together with the following blank", () => {
  const parsed = parse("> [!TIP]\n>\n> Separate paragraph");
  assert.equal(parsed.alerts[0].type, "tip");
  const [first, ...rest] = parsed.alerts[0].token.tokens;
  assert.equal(first.type, "paragraph");
  assert.equal(first.text, "Separate paragraph");
  assert.equal(rest.length, 0);
});

test("trailing spaces after the marker are accepted, including a hard break", () => {
  for (const markdown of ["> [!NOTE]   \n> Body", "> [!NOTE] \t\n> Body"]) {
    const parsed = parse(markdown);
    assert.equal(parsed.alerts.length, 1, JSON.stringify(markdown));
    const output = html(parsed.tokens);
    assert.doesNotMatch(output, /<br>|\[!NOTE\]/);
    assert.match(output, /<p>Body<\/p>/);
  }
});

test("non-alert block quotes stay plain block quotes", () => {
  const cases = [
    "> Plain quote",
    "> [!INFO]\n> Unsupported type",
    "> [!NOTE] Text on the marker line\n> more",
    "> [!NOTE]",
    "> [!NOTE]\n>",
    "> Text\n> [!NOTE]\n> later marker",
    "- item\n\n  > [!NOTE]\n  > Nested in a list",
    "> > [!NOTE]\n> > Nested quote",
    "> **[!NOTE]**\n> Formatted marker",
  ];
  for (const markdown of cases) {
    const parsed = parse(markdown);
    assert.equal(parsed.alerts.length, 0, markdown);
  }
  assert.match(html(parse("> [!NOTE]").tokens), /\[!NOTE\]/);
});

test("alerts are reported in document order and may contain other blocks", () => {
  const parsed = parse([
    "> [!NOTE]",
    "> First",
    "",
    "Between",
    "",
    "> [!CAUTION]",
    "> ```js",
    "> run();",
    "> ```",
  ].join("\n"));
  assert.deepEqual(parsed.alerts.map(({ index, type, tone }) => [index, type, tone]), [
    [0, "note", "info"],
    [1, "caution", "danger"],
  ]);
  assert.equal(parsed.alerts[1].token.tokens[0].type, "code");
});

test("adaptive-card paths inside an alert keep the original token paths", () => {
  const parsed = parse("> [!NOTE]\n>\n> ```adaptive-card\n> {}\n> ```");
  assert.equal(parsed.alerts.length, 1);
  assert.equal(parsed.cards.length, 1);
  assert.equal(parsed.cards[0].markdownPath, "tokens[0].tokens[2]");
  assert.equal(parsed.alerts[0].token.tokens[0], parsed.cards[0].token);
});

test("extractAlerts tolerates missing token lists", () => {
  assert.deepEqual(extractAlerts(undefined), []);
  assert.deepEqual(extractAlerts([{ type: "blockquote" }]), []);
});
