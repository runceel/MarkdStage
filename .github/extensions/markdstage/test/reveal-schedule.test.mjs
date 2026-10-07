import test from "node:test";
import assert from "node:assert/strict";
import { markedLexer } from "../renderer/marked-lexer.mjs";
import { parseRevealSchedule } from "../renderer/reveal-schedule.mjs";

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
