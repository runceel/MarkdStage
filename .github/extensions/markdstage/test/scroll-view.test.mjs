import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_VIEW_MODE, parseViewMode, normalizeViewMode } from "../renderer/view-mode.mjs";
import { resolveViewMode, createSessionState } from "../runtime/session-state.mjs";
import { adjacentIssueIndex } from "../renderer/scroll-view.mjs";

test("view mode defaults to scroll and validates input", () => {
  assert.equal(DEFAULT_VIEW_MODE, "scroll");
  assert.equal(parseViewMode("slide"), "slide");
  assert.equal(parseViewMode("grid"), null);
  assert.equal(normalizeViewMode("grid"), "scroll");
  assert.equal(resolveViewMode(undefined), "scroll");
  assert.equal(resolveViewMode("slide"), "slide");
  assert.throws(() => resolveViewMode("grid"), { code: "invalid_input" });
  assert.equal(typeof createSessionState, "function");
});

test("adjacentIssueIndex wraps around issue indexes", () => {
  assert.equal(adjacentIssueIndex([1, 4], 1, 1), 4);
  assert.equal(adjacentIssueIndex([1, 4], 4, 1), 1);
  assert.equal(adjacentIssueIndex([1, 4], 1, -1), 4);
  assert.equal(adjacentIssueIndex([], 0, 1), -1);
});

test("renderer wires the scroll view controls", () => {
  const html = readFileSync(new URL("../renderer/index.html", import.meta.url), "utf8");
  for (const id of ["navViewMode", "navIssues", "issuesPanel", "issuesList", "issuesClose"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  const js = readFileSync(new URL("../renderer/renderer.js", import.meta.url), "utf8");
  assert.match(js, /createScrollView/);
  assert.match(js, /\/view-mode/);
});

test("scroll view reserves space between slides and the scrollbar", () => {
  const css = readFileSync(new URL("../renderer/slides.css", import.meta.url), "utf8");
  assert.match(css, /\.scroll-view\{[^}]*padding:8px 12px 40vh/);
  assert.match(css, /\.scroll-view\{[^}]*scrollbar-gutter:stable/);
});

test("shape editing works from scroll view", () => {
  const js = readFileSync(new URL("../renderer/renderer.js", import.meta.url), "utf8");
  assert.match(js, /Scroll frames render lazily/);
  assert.match(js, /restoreFixedPreviewAfterEdit/);
});
