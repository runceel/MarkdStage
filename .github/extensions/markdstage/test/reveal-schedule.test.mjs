import test from "node:test";
import assert from "node:assert/strict";
import { markedLexer } from "../renderer/marked-lexer.mjs";
import { parseRevealSchedule } from "../renderer/reveal-schedule.mjs";
import { parseSlideMarkdown } from "../renderer/fenced-blocks.mjs";

const listDirective = (nested = "") =>
  `<!-- markdstage: reveal=list-items${nested ? ` nested=${nested}` : ""} -->`;

test("together groups every descendant under its top-level list item", () => {
  const schedule = parseRevealSchedule(
    [
      listDirective(),
      "",
      "- Plan",
      "  - Requirements",
      "    - Interviews",
      "  - Design",
      "- Deliver",
      "  - Implement",
    ].join("\n"),
    markedLexer,
  );
  assert.deepEqual(schedule.lists[0].steps, [[0, 1, 2, 3], [4, 5]]);
  assert.equal(schedule.schedule.length, 2);
});

test("separate reveals use depth-first parent-before-child order at arbitrary depth", () => {
  const schedule = parseRevealSchedule(
    [
      listDirective("separate"),
      "",
      "1. Plan",
      "   - Requirements",
      "     1. Interviews",
      "   - Design",
      "2. Deliver",
      "   1. Implement",
    ].join("\n"),
    markedLexer,
  );
  assert.deepEqual(schedule.lists[0].steps, [[0], [1], [2], [3], [4], [5]]);
});

test("different lists can opt into different policies", () => {
  const schedule = parseRevealSchedule(
    [
      listDirective("separate"),
      "",
      "- First",
      "  - Detail",
      "",
      listDirective(),
      "",
      "1. Second",
      "   1. Detail",
    ].join("\n"),
    markedLexer,
  );
  assert.deepEqual(schedule.lists.map(({ listIndex, steps }) => ({ listIndex, steps })), [
    { listIndex: 0, steps: [[0], [1]] },
    { listIndex: 2, steps: [[0, 1]] },
  ]);
});

test("Architecture groups include descendants and connectors wait for endpoints", () => {
  const schedule = parseRevealSchedule(
    [
      "<!-- markdstage:",
      '{"steps":[["frontend"],["backend"]]}',
      "-->",
      "```architecture",
      JSON.stringify({
        version: 1,
        elements: [
          { type: "group", id: "frontend", children: [{ type: "node", id: "web" }] },
          { type: "node", id: "backend" },
          { type: "connector", id: "request", from: "web", to: "backend" },
        ],
      }),
      "```",
    ].join("\n"),
    markedLexer,
  );
  assert.deepEqual(schedule.architectures[0].steps, [["frontend", "web"], ["backend", "request"]]);
});

test("fenced comment examples do not become reveal directives", () => {
  const markdown = ["```markdown", listDirective(), "```", "", "- Visible"].join("\n");
  assert.deepEqual(parseRevealSchedule(markdown, markedLexer).schedule, []);
});

test("HTML abrupt-close comments retain their reveal binding", () => {
  const schedule = parseRevealSchedule(
    ["<!-- markdstage: reveal=list-items --!>", "", "- First", "- Second"].join("\n"),
    markedLexer,
  );
  assert.deepEqual(schedule.lists[0].steps, [[0], [1]]);
});

test("invalid nested policies, malformed JSON, and unknown Architecture ids are actionable", () => {
  assert.throws(
    () => parseRevealSchedule(`${listDirective("invalid")}\n\n- Item`, markedLexer),
    /nested must be "together" or "separate"/,
  );
  assert.throws(
    () => parseRevealSchedule('<!-- markdstage:\n{"steps":\n-->\n```architecture\n{}\n```', markedLexer),
    /Malformed MarkdStage reveal metadata/,
  );
  assert.throws(
    () => parseRevealSchedule(
      '<!-- markdstage:\n{"steps":[["missing"]]}\n-->\n```architecture\n{"version":1,"elements":[]}\n```',
      markedLexer,
    ),
    /Unknown Architecture reveal target "missing"/,
  );
});

test("unsupported empty and image list items are rejected explicitly", () => {
  assert.throws(
    () => parseRevealSchedule(`${listDirective()}\n\n-`, markedLexer),
    /do not support empty list items/,
  );
  assert.throws(
    () => parseRevealSchedule(`${listDirective()}\n\n- ![diagram](diagram.png)`, markedLexer),
    /do not support list items containing images/,
  );
});

test("nested list directives cannot overlap a scheduled ancestor list", () => {
  assert.throws(
    () => parseRevealSchedule(
      `${listDirective()}\n\n- Parent\n  ${listDirective("separate")}\n  - Child`,
      markedLexer,
    ),
    /overlaps a previously scheduled ancestor list/,
  );
});

test("whole blocks and list items share source-ordered steps and retain token bindings", () => {
  const markdown = [
    "## Flow",
    "",
    "Initially visible.",
    "",
    "<!-- Presenter note. -->",
    listDirective(),
    "",
    "- First",
    "- Second",
    "",
    "<!-- markdstage: reveal=block -->",
    "",
    "Conclusion.",
    "",
    "<!-- markdstage: reveal=block -->",
    "",
    "```architecture",
    '{"elements":[{"type":"node","id":"api","x":0,"y":0,"width":100,"height":100}]}',
    "```",
  ].join("\n");
  const parsed = parseSlideMarkdown(markdown, markedLexer);
  assert.deepEqual(parsed.revealSchedule.schedule, [
    { kind: "list", listIndex: 0, targets: [0] },
    { kind: "list", listIndex: 0, targets: [1] },
    { kind: "block", blockIndex: 3, blockType: "paragraph" },
    { kind: "block", blockIndex: 4, blockType: "code" },
  ]);
  assert.equal(parsed.revealBlocks[0].token.text, "Conclusion.");
  assert.equal(parsed.revealBlocks[1].token.lang, "architecture");
  assert.equal(parsed.notes, "Presenter note.");
  const withMeta = `---\ntitle: Flow\ntheme: dark\n---\n\n${markdown}`;
  assert.deepEqual(parseRevealSchedule(withMeta, markedLexer).schedule, parsed.revealSchedule.schedule);
  assert.deepEqual(parseSlideMarkdown(withMeta, markedLexer).revealSchedule.schedule, parsed.revealSchedule.schedule);
});

test("block reveals accept images, tables, code, Mermaid and entire nested lists", () => {
  for (const [source, type] of [
    ["![Image](assets/sample.svg)", "paragraph"],
    ["| Name | Value |\n| --- | --- |\n| A | B |", "table"],
    ["```js\nconst answer = 42;\n```", "code"],
    ["```mermaid\nflowchart LR\nA --> B\n```", "code"],
    ["1. Parent\n   - Child\n2. Next", "list"],
  ]) {
    const parsed = parseSlideMarkdown(`<!-- markdstage: reveal=block -->\n\n${source}`, markedLexer);
    assert.deepEqual(parsed.revealSchedule.schedule, [{ kind: "block", blockIndex: 0, blockType: type }]);
    assert.equal(parsed.revealBlocks[0].token.type, type);
  }
});

test("whole-block reveals reject unsupported blocks, dangling directives and overlapping schedules", () => {
  for (const source of [
    "# Heading",
    "> Quote",
    "<div>HTML</div>",
    "```adaptive-card\n{}\n```",
    "```archify\n{}\n```",
  ]) {
    assert.throws(
      () => parseRevealSchedule(`<!-- markdstage: reveal=block -->\n\n${source}`, markedLexer),
      /must be followed by a top-level/,
    );
  }
  assert.throws(
    () => parseRevealSchedule("<!-- markdstage: reveal=block -->", markedLexer),
    /no following target/,
  );
  assert.throws(
    () => parseRevealSchedule(`<!-- markdstage: reveal=block -->\n${listDirective()}\n- Item`, markedLexer),
    /Unexpected second/,
  );
  assert.throws(
    () => parseRevealSchedule('<!-- markdstage: reveal=block -->\n<!-- markdstage: {"steps":[["api"]]} -->\n```architecture\n{}\n```', markedLexer),
    /Unexpected second/,
  );
  assert.throws(
    () => parseRevealSchedule(`<!-- markdstage: reveal=block -->\n- Parent\n  ${listDirective()}\n  - Child`, markedLexer),
    /overlaps/,
  );
  assert.throws(
    () => parseRevealSchedule("- Parent\n  <!-- markdstage: reveal=block -->\n  - Child", markedLexer),
    /top-level/,
  );
});

test("fenced block directive examples stay static and abrupt-close comments retain binding", () => {
  assert.deepEqual(parseRevealSchedule("```md\n<!-- markdstage: reveal=block -->\n```", markedLexer).schedule, []);
  const parsed = parseSlideMarkdown("<!-- markdstage: reveal=block --!>\n\nA paragraph.", markedLexer);
  assert.equal(parsed.revealBlocks[0].token.text, "A paragraph.");
});

test("Architecture element schedules count preceding unscheduled and whole-block diagrams", () => {
  const diagram = '{"elements":[{"type":"node","id":"api","x":0,"y":0,"width":100,"height":100}]}';
  const markdown = [
    "```architecture", diagram, "```",
    "<!-- markdstage: reveal=block -->",
    "```architecture", diagram, "```",
    '<!-- markdstage: {"steps":[["api"]]} -->',
    "```architecture", diagram, "```",
  ].join("\n\n");
  const parsed = parseSlideMarkdown(markdown, markedLexer);
  assert.deepEqual(parsed.revealSchedule.schedule, [
    { kind: "block", blockIndex: 1, blockType: "code" },
    { kind: "architecture", blockIndex: 2, targets: ["api"] },
  ]);
});
