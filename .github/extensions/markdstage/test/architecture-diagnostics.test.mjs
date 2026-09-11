import assert from "node:assert/strict";
import test from "node:test";
import {
  ArchitectureError,
  MAX_SOURCE_LENGTH,
  architectureTextLayout,
  parseArchitecture,
  validateArchitecture,
} from "../renderer/architecture.mjs";
import { corpus } from "../../../../test/schema/corpus.mjs";
import { checkArchitectureReferences } from "../renderer/architecture-diagnostics.mjs";

const node = (id = "client", extra = {}) => ({
  type: "node", id, x: 0, y: 0, width: 120, height: 80, ...extra,
});
const source = (elements, extra = {}) => JSON.stringify({ elements, ...extra });
const fourMistakes = () => source([
  node("client", { label: "Client", subtitle: "Browser" }),
  node("api", { x: 300 }),
  { type: "connector", id: "request", from: "client", to: "api", text: "HTTPS" },
]);
const errors = (report) => report.diagnostics.filter((item) => item.severity === "error");
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

test("reports four independent unknown fields without changing the input", () => {
  const input = fourMistakes();
  const report = validateArchitecture(input);
  assert.equal(report.valid, false);
  assert.equal(report.truncated, false);
  assert.equal(report.complete, false);
  assert.equal(report.stages.structure, "failed");
  assert.equal(report.stages.semantic, "skipped");
  assert.equal(report.stages.layout, "skipped");
  assert.deepEqual(errors(report).map(({ code, pointer }) => ({ code, pointer })), [
    { code: "unknown_field", pointer: "/elements/0/label" },
    { code: "unknown_field", pointer: "/elements/0/subtitle" },
    { code: "unknown_field", pointer: "/elements/2/id" },
    { code: "unknown_field", pointer: "/elements/2/text" },
  ]);
  assert.equal(input, fourMistakes());
  assert.equal(own(report, "model"), false);
});

test("exception-based parse exposes the same primary and aggregate diagnostics", () => {
  const input = fourMistakes();
  const expected = validateArchitecture(input);
  assert.throws(() => parseArchitecture(input), (error) => {
    assert.ok(error instanceof ArchitectureError);
    assert.deepEqual(error.validation, expected);
    assert.deepEqual(error.diagnostic, expected.diagnostics[0]);
    assert.equal(error.message, expected.diagnostics[0].message);
    return true;
  });
});

test("unknown field pointers escape JSON Pointer tokens instead of parsing error messages", () => {
  const report = validateArchitecture(source([node("client", { "label.with/~[0]": "value" })], { "root/~": true }));
  assert.deepEqual(errors(report).map((item) => item.pointer), [
    "/root~1~0",
    "/elements/0/label.with~1~0[0]",
  ]);
});

test("suggestions detect existing values and never silently merge or delete data", () => {
  const report = validateArchitecture(source([
    node("client", { text: "Keep this", label: "Do not overwrite", subtitle: "Not the same layout" }),
    node("api"),
    { type: "connector", id: "request", from: "client", to: "api", label: "Keep", text: "Different" },
  ]));
  for (const diagnostic of errors(report)) {
    assert.ok(diagnostic.suggestions.length);
    assert.ok(diagnostic.suggestions.every((suggestion) => suggestion.automatic === false));
  }
  const label = errors(report).find((item) => item.pointer === "/elements/0/label").suggestions[0];
  assert.equal(label.action, "review");
  assert.equal(label.conflictsWithExistingValue, true);
  assert.equal(label.to, "/elements/0/text");
  const subtitle = errors(report).find((item) => item.pointer === "/elements/0/subtitle").suggestions[0];
  assert.equal(subtitle.action, "review");
  const id = errors(report).find((item) => item.pointer === "/elements/2/id").suggestions[0];
  assert.match(id.message, /why this identifier was supplied/);
});

test("collects independent scalar, style, required-field and conditional violations", () => {
  const report = validateArchitecture(source([
    node("client", { width: -1, text: 42, style: { opacity: 3, bogus: true } }),
    { type: "node", id: "missing-box" },
    {
      type: "group", id: "group", x: 0, y: 0, width: 500, height: 300,
      layout: { type: "row", direction: "right" }, children: [],
    },
  ]));
  const pointers = new Set(errors(report).map((item) => item.pointer));
  for (const pointer of [
    "/elements/0/width", "/elements/0/text", "/elements/0/style/opacity", "/elements/0/style/bogus",
    "/elements/1/x", "/elements/1/y", "/elements/1/width", "/elements/1/height",
    "/elements/2/layout/direction",
  ]) assert.ok(pointers.has(pointer), `${pointer}: ${JSON.stringify(report)}`);
  assert.equal(report.stages.semantic, "skipped");
});

test("aggregates duplicate IDs, both missing endpoints and self-references as semantic errors", () => {
  const report = validateArchitecture(source([
    node("client"), node("client"),
    { type: "connector", from: "missing-from", to: "missing-to" },
    { type: "connector", from: "client", to: "client" },
  ]));
  assert.equal(report.stages.structure, "passed");
  assert.equal(report.stages.semantic, "failed");
  assert.deepEqual(errors(report).map(({ code, pointer }) => ({ code, pointer })), [
    { code: "duplicate_id", pointer: "/elements/1/id" },
    { code: "undefined_reference", pointer: "/elements/2/from" },
    { code: "undefined_reference", pointer: "/elements/2/to" },
    { code: "self_reference", pointer: "/elements/3" },
  ]);
  assert.ok(errors(report).every((item) => item.category === "semantic"));
});

test("coordinate endpoints are not missing IDs or self-referencing elements", () => {
  const point = { x: 100, y: 120 };
  const diagnostics = [];
  const count = checkArchitectureReferences([
    { type: "node", id: "client", sourcePath: "elements[0]" },
    { type: "connector", from: point, to: point, sourcePath: "elements[1]" },
    { type: "connector", from: "client", to: point, sourcePath: "elements[2]" },
    { type: "connector", from: point, to: "missing", sourcePath: "elements[3]" },
  ], (diagnostic) => diagnostics.push(diagnostic));
  assert.equal(count, 3);
  assert.deepEqual(diagnostics.map(({ code, pointer }) => ({ code, pointer })), [
    { code: "undefined_reference", pointer: "/elements/3/to" },
  ]);
});

test("text shrinking reports requested and effective size without rejecting valid input", () => {
  const input = source([node("label", {
    text: "A long label that cannot fit at the requested font size",
    style: { fontSize: 32 },
  })]);
  const report = validateArchitecture(input);
  assert.equal(report.valid, true);
  assert.equal(report.complete, true);
  assert.equal(report.stages.layout, "passed");
  const warning = report.diagnostics.find((item) => item.code === "text_shrunk");
  assert.equal(warning.severity, "warning");
  assert.equal(warning.category, "layout");
  assert.equal(warning.pointer, "/elements/0/text");
  assert.equal(warning.requestedFontSize, 32);
  assert.ok(warning.effectiveFontSize < warning.requestedFontSize);
  assert.equal(warning.effectiveFontSize, architectureTextLayout(report.model.elements[0]).effectiveFontSize);
  assert.match(warning.message, /requested 32.*effective/);
  assert.deepEqual(parseArchitecture(input), report.model);
});

test("autoFit none overflow warnings cover horizontal and vertical overflow", () => {
  for (const extra of [
    { text: "A label much too long for this width", width: 60, height: 200 },
    { text: "One\nTwo\nThree", width: 600, height: 20 },
  ]) {
    const report = validateArchitecture(source([node("label", {
      ...extra, style: { autoFit: "none", fontSize: 32 },
    })]));
    assert.equal(report.valid, true);
    const warning = report.diagnostics.find((item) => item.code === "text_overflow");
    assert.equal(warning.severity, "warning");
    assert.equal(warning.requestedFontSize, warning.effectiveFontSize);
    assert.equal(warning.overflow.horizontal, extra.width === 60);
    assert.equal(warning.overflow.vertical, extra.height === 20);
    assert.ok(!report.diagnostics.some((item) => item.code === "text_shrunk"));
  }
});

test("silent eight-line truncation is a warning with nested source pointers", () => {
  const report = validateArchitecture(source([{
    type: "group", id: "group", x: 0, y: 0, width: 800, height: 600,
    children: [node("label", {
      width: 600, height: 500, text: Array.from({ length: 10 }, (_, index) => `Line ${index + 1}`).join("\n"),
    })],
  }]));
  assert.equal(report.valid, true);
  const warning = report.diagnostics.find((item) => item.code === "text_truncated");
  assert.equal(warning.severity, "warning");
  assert.equal(warning.pointer, "/elements/0/children/0/text");
  assert.equal(warning.lineCount, 10);
  assert.equal(warning.renderedLineCount, 8);
  assert.match(warning.message, /10 lines.*8.*truncated/);
  assert.ok(warning.suggestions.every((suggestion) => suggestion.automatic === false));
});

test("fitting text and exactly eight lines do not produce text warnings", () => {
  const report = validateArchitecture(source([
    node("plain", { text: "OK", width: 600, height: 200, style: { autoFit: "none" } }),
    node("eight", { text: Array(8).fill("OK").join("\n"), width: 600, height: 600 }),
  ]));
  assert.equal(report.valid, true);
  assert.deepEqual(report.diagnostics, []);
});

test("autoFit none preserves font size but still warns about the eight-line limit", () => {
  const report = validateArchitecture(source([node("all-lines", {
    text: Array(10).fill("OK").join("\n"), width: 600, height: 600,
    style: { autoFit: "none" },
  })]));
  assert.equal(report.valid, true);
  assert.equal(report.diagnostics.length, 1);
  assert.equal(report.diagnostics[0].code, "text_truncated");
  assert.equal(report.diagnostics[0].lineCount, 10);
  assert.equal(report.diagnostics[0].renderedLineCount, 8);
});

test("explicitly fitted group title diagnostics use shared measurements and title pointers", () => {
  const report = validateArchitecture(source([{
    type: "group", id: "group", x: 0, y: 0, width: 120, height: 300,
    title: "A long group title that needs to shrink", style: { autoFit: "shrink" }, children: [],
  }]));
  assert.equal(report.valid, true);
  const warning = report.diagnostics.find((item) => item.code === "text_shrunk");
  assert.equal(warning.pointer, "/elements/0/title");
  assert.equal(warning.effectiveFontSize, architectureTextLayout(report.model.elements[0]).effectiveFontSize);
});

test("legacy group titles do not report font shrinking that is not rendered", () => {
  const report = validateArchitecture(source([{
    type: "group", id: "group", x: 0, y: 0, width: 120, height: 300,
    title: "A long group title retaining its legacy font size", children: [],
  }]));
  assert.equal(report.valid, true);
  assert.ok(!report.diagnostics.some((item) => item.code === "text_shrunk"));
  const metrics = architectureTextLayout(report.model.elements[0]);
  assert.equal(metrics.requestedFontSize, metrics.effectiveFontSize);
});

test("thin stroked rectangles suggest coordinate connectors only for line-like rectangles", () => {
  for (const dimensions of [{ width: 2, height: 100 }, { width: 100, height: 1 }]) {
    const report = validateArchitecture(source([node("line", { shape: "rect", ...dimensions })]));
    assert.equal(report.valid, true);
    assert.equal(report.diagnostics.length, 1);
    const warning = report.diagnostics[0];
    assert.equal(warning.code, "thin_stroked_rect");
    assert.equal(warning.severity, "warning");
    assert.equal(warning.pointer, "/elements/0");
    assert.match(warning.message, /connector with coordinate endpoints/);
  }
  for (const extra of [
    { width: 3, height: 3 },
    { width: 1, style: { stroke: "none" } },
    { height: 2, style: { stroke: "none" } },
    { height: 2, shape: "ellipse" },
  ]) {
    const report = validateArchitecture(source([node("not-line", { shape: "rect", ...extra })]));
    assert.equal(report.valid, true);
    assert.ok(!report.diagnostics.some((item) => item.code === "thin_stroked_rect"));
  }
});

test("warning diagnostics are bounded without changing parser acceptance", () => {
  const input = source(Array.from({ length: 60 }, (_, index) =>
    node(`line${index}`, { shape: "rect", width: 1 })));
  const report = validateArchitecture(input, { maxDiagnostics: 2 });
  assert.equal(report.valid, true);
  assert.equal(report.diagnostics.length, 2);
  assert.equal(report.truncated, true);
  assert.deepEqual(report.truncationReasons, ["maxDiagnostics"]);
  assert.equal(parseArchitecture(input).elements.length, 60);
});

test("mixed coordinate endpoints retain actual missing-reference errors", () => {
  const report = validateArchitecture(source([
    { type: "connector", from: { x: 20, y: 30 }, to: "missing" },
    { type: "connector", from: { x: 30, y: 40 }, to: { x: 100, y: 200 } },
  ]));
  assert.equal(report.stages.structure, "passed");
  assert.deepEqual(errors(report).map(({ code, pointer }) => ({ code, pointer })), [
    { code: "undefined_reference", pointer: "/elements/0/to" },
  ]);
});

test("invalid JSON does not pretend to run structural, semantic or layout validation", () => {
  const report = validateArchitecture('{"elements":[');
  assert.equal(report.valid, false);
  assert.equal(report.complete, false);
  assert.equal(report.diagnostics.length, 1);
  assert.equal(report.diagnostics[0].code, "invalid_json");
  assert.equal(report.diagnostics[0].pointer, "");
  assert.deepEqual(report.stages, { json: "failed", structure: "skipped", semantic: "skipped", layout: "skipped" });
});

test("diagnostic and processing limits produce explicit incomplete results", () => {
  const report = validateArchitecture(fourMistakes(), { maxDiagnostics: 2 });
  assert.equal(report.diagnostics.length, 2);
  assert.equal(report.truncated, true);
  assert.deepEqual(report.truncationReasons, ["maxDiagnostics"]);
  assert.equal(report.complete, false);
  assert.equal(report.valid, false);
  const oversized = validateArchitecture(" ".repeat(MAX_SOURCE_LENGTH + 1));
  assert.equal(oversized.valid, false);
  assert.equal(oversized.complete, false);
  assert.equal(oversized.stages.structure, "skipped");
  assert.equal(oversized.diagnostics[0].code, "source_limit");
  for (const maxDiagnostics of [0, -1, 101, 2.5, NaN, "2", null]) {
    assert.throws(() => validateArchitecture("{}", { maxDiagnostics }), /maxDiagnostics/);
  }
});

test("element and depth caps stop diagnostic traversal without certifying the remainder", () => {
  const many = validateArchitecture(source(Array.from({ length: 201 }, (_, index) => node(`n${index}`))));
  assert.equal(many.valid, false);
  assert.equal(many.truncated, true);
  assert.equal(many.complete, false);
  assert.equal(many.diagnostics[0].code, "element_limit");
  assert.deepEqual(many.truncationReasons, ["maxElements"]);
  assert.equal(many.limits.maxElements, 200);
  assert.equal(many.stages.semantic, "skipped");
  let nested = node("leaf");
  for (let index = 0; index < 6; index += 1) {
    nested = {
      type: "group", id: `g${index}`, x: 0, y: 0, width: 500, height: 300, children: [nested],
    };
  }
  const deep = validateArchitecture(source([nested]));
  assert.equal(deep.valid, false);
  assert.equal(deep.truncated, true);
  assert.equal(deep.diagnostics[0].code, "nesting_limit");
  assert.deepEqual(deep.truncationReasons, ["maxDepth"]);
  assert.equal(deep.limits.maxDepth, 4);
});

test("v1 source length remains a code-unit limit, not a new UTF-8 byte rejection", () => {
  const input = source([], { $schema: "\u754c".repeat(30_000) });
  assert.ok(Buffer.byteLength(input, "utf8") > MAX_SOURCE_LENGTH);
  assert.ok(input.length < MAX_SOURCE_LENGTH);
  assert.equal(validateArchitecture(input).valid, true);
});

test("an empty fence is still a valid canonical empty diagram", () => {
  const report = validateArchitecture(" \n\t ");
  assert.equal(report.valid, true);
  assert.equal(report.complete, true);
  assert.equal(report.truncated, false);
  assert.deepEqual(report.model, parseArchitecture('{"version":1,"elements":[]}'));
  assert.deepEqual(report.diagnostics, []);
});

test("flow-coordinate and ignored-schema differences are warnings, not new rejections", () => {
  const input = source([{
    type: "group", id: "group", x: 0, y: 0, width: 500, height: 300, layout: "row",
    children: [{ type: "node", id: "client", x: "ignored", y: { ignored: true } }],
  }], { $schema: { ignored: true } });
  const report = validateArchitecture(input, { maxDiagnostics: 1 });
  assert.equal(report.valid, true);
  assert.equal(report.complete, true);
  assert.equal(report.truncated, false);
  assert.equal(report.diagnostics.length, 1);
  assert.equal(report.diagnostics[0].severity, "warning");
  assert.equal(report.diagnostics[0].occurrences, 3);
  const clean = JSON.parse(input);
  delete clean.$schema;
  delete clean.elements[0].children[0].x;
  delete clean.elements[0].children[0].y;
  assert.deepEqual(report.model, parseArchitecture(JSON.stringify(clean)));
});

test("schema-only differences do not obscure a real independent semantic error", () => {
  const report = validateArchitecture(source([
    {
      type: "group", id: "group", x: 0, y: 0, width: 500, height: 300, layout: "row",
      children: [{ type: "node", id: "client", x: "ignored", y: null }],
    },
    { type: "connector", from: "client", to: "missing" },
  ], { $schema: 42 }));
  assert.deepEqual(errors(report).map((item) => item.code), ["undefined_reference"]);
  assert.equal(report.stages.structure, "passed");
});

test("layout failures remain distinct from structural and reference failures", () => {
  const report = validateArchitecture(source([{
    type: "group", id: "group", x: 0, y: 0, width: 100, height: 100,
    layout: { type: "row", padding: 60 }, children: [{ type: "node", id: "client" }],
  }]));
  assert.equal(report.diagnostics[0].code, "layout_fit");
  assert.equal(report.diagnostics[0].category, "layout");
  assert.equal(report.diagnostics[0].pointer, "/elements/0/layout");
  assert.equal(report.stages.layout, "failed");
  assert.equal(report.valid, false);
});

test("malformed flow dimensions are structural errors, not duplicate layout failures", () => {
  for (const width of ["wide", 0, 4001]) {
    const report = validateArchitecture(source([{
      type: "group", id: "group", x: 0, y: 0, width: 400, height: 300, layout: "row",
      children: [{ type: "node", id: "client", width }],
    }]));
    assert.equal(errors(report).length, 1, JSON.stringify(report));
    assert.equal(report.diagnostics[0].category, "structure");
    assert.equal(report.diagnostics[0].pointer, "/elements/0/children/0/width");
    assert.equal(report.stages.structure, "failed");
    assert.equal(report.stages.layout, "skipped");
  }
});

test("a late connector-lane failure preserves completed semantic validation", () => {
  const report = validateArchitecture(source([
    node("a"), node("b", { x: 300 }),
    { type: "connector", from: "a", to: "b", lane: 0 },
    { type: "connector", from: "a", to: "b", lane: 0 },
  ]));
  assert.equal(report.diagnostics[0].code, "duplicate_lane");
  assert.deepEqual(report.stages, {
    json: "passed", structure: "passed", semantic: "passed", layout: "failed",
  });
});

test("malformed children in a layout are diagnosed rather than throwing a TypeError", () => {
  const report = validateArchitecture(source([{
    type: "group", id: "group", x: 0, y: 0, width: 500, height: 300, layout: "row", children: {},
  }]));
  assert.equal(report.valid, false);
  assert.equal(report.diagnostics[0].code, "invalid_type");
  assert.equal(report.diagnostics[0].pointer, "/elements/0/children");
});

test("a group's own layout does not waive its parent's fixed-placement requirements", () => {
  const report = validateArchitecture(source([{ type: "group", id: "group", layout: "row", children: [] }]));
  assert.equal(report.valid, false);
  assert.deepEqual(new Set(errors(report).map((item) => item.pointer)), new Set([
    "/elements/0/x", "/elements/0/y", "/elements/0/width", "/elements/0/height",
  ]));
});

test("preflight and parser agree on every v1 conformance corpus case", () => {
  for (const entry of corpus) {
    const report = validateArchitecture(entry.source);
    assert.equal(report.valid, entry.expect === "accept", `${entry.name}: ${JSON.stringify(report)}`);
    if (report.valid) assert.deepEqual(report.model, parseArchitecture(entry.source), entry.name);
  }
});

test("explaining a bad reference never invents structural errors in otherwise accepted v1 content", () => {
  const elementCount = (items) => items.reduce(
    (count, element) => count + 1 + (element.type === "group" ? elementCount(element.children ?? []) : 0),
    0,
  );
  let inspected = 0;
  for (const entry of corpus.filter((item) => item.expect === "accept")) {
    const raw = JSON.parse(entry.source);
    if (elementCount(raw.elements) >= 200) continue;
    raw.elements.push({
      type: "connector",
      from: "missing-from-for-diagnostic-probe",
      to: "missing-to-for-diagnostic-probe",
    });
    const input = JSON.stringify(raw);
    if (input.length > MAX_SOURCE_LENGTH) continue;
    const report = validateArchitecture(input);
    assert.equal(report.valid, false, entry.name);
    assert.equal(report.stages.structure, "passed", `${entry.name}: ${JSON.stringify(report)}`);
    assert.ok(errors(report).every((item) => item.category === "semantic"),
      `${entry.name}: ${JSON.stringify(report.diagnostics)}`);
    inspected += 1;
  }
  assert.ok(inspected >= 40, `expected broad compatibility coverage, got ${inspected}`);
});
