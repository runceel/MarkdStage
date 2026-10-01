import assert from "node:assert/strict";
import test from "node:test";
import { projectDiagnostics, slideStartLines } from "../src/diagnostics.js";

const deck = `---
deck: demo
---
# One

---
---
page: 2
---
# Two
\`\`\`architecture
bad
\`\`\`
`;

test("slideStartLines maps canonical slides to visible source bodies", () => {
  assert.deepEqual(slideStartLines(deck), [3, 9]);
});

test("projectDiagnostics maps slide-relative line data and removes duplicates", () => {
  const projected = projectDiagnostics({
    ok: false,
    errors: [{ code: "bad", message: "Broken", page: 2 }],
    diagnostics: [
      { code: "bad", message: "Broken", page: 2, severity: "error" },
      { code: "dsl", message: "Invalid DSL", page: 2, openLine: 6, endLine: 8, lineBasis: "slide-fragment", bodyStartLine: 5, severity: "warning" },
    ],
  }, deck);
  assert.equal(projected.length, 2);
  assert.deepEqual(projected[0], {
    startLine: 9,
    endLine: 9,
    severity: "error",
    message: "Broken",
    code: "bad",
  });
  assert.equal(projected[1].startLine, 10);
  assert.equal(projected[1].endLine, 12);
});

test("projectDiagnostics keeps repeated issues on different slides", () => {
  const projected = projectDiagnostics({
    ok: false,
    warnings: [
      { code: "missing_front_matter", message: "Front matter is missing.", page: 1 },
      { code: "missing_front_matter", message: "Front matter is missing.", page: 2 },
    ],
  }, deck);
  assert.equal(projected.length, 2);
  assert.notEqual(projected[0].startLine, projected[1].startLine);
});
