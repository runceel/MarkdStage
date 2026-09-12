import assert from "node:assert/strict";
import test from "node:test";

import { isSampleDeckPath } from "../../scripts/ci-sample-path.mjs";
import { classifyCiPaths } from "../../scripts/ci-paths.mjs";

const none = { docs: false, test: false, cli: false, desktop: false, samples: false };
const all = { docs: true, test: true, cli: true, desktop: true, samples: true };

function expected(overrides) {
  return { ...none, ...overrides };
}

test("published documentation runs only documentation validation", () => {
  assert.deepEqual(
    classifyCiPaths(["docs/user-guide/ja/installation.md"]),
    expected({ docs: true }),
  );
  assert.deepEqual(
    classifyCiPaths(["packages\\markdstage-cli\\README.md"]),
    expected({ docs: true }),
  );
});

test("component-only changes stay within their component", () => {
  assert.deepEqual(
    classifyCiPaths(["packages/markdstage-cli/src/cli.mjs"]),
    expected({ cli: true }),
  );
  assert.deepEqual(
    classifyCiPaths(["apps/MarkdStage.Desktop/src/MarkdStage.App/MainPage.xaml"]),
    expected({ desktop: true }),
  );
  assert.deepEqual(
    classifyCiPaths([".github/extensions/markdstage/extension.mjs"]),
    expected({ test: true }),
  );
});

test("canonical shared files select their real consumers", () => {
  assert.deepEqual(
    classifyCiPaths([".github/extensions/markdstage/renderer/slides.css"]),
    expected({ test: true, cli: true, desktop: true }),
  );
  assert.deepEqual(
    classifyCiPaths([".github/extensions/markdstage/runtime/output.mjs"]),
    expected({ test: true, cli: true, desktop: true }),
  );
  assert.deepEqual(
    classifyCiPaths([".github/extensions/markdstage/windows/pen-button-listener.ps1"]),
    expected({ test: true, desktop: true }),
  );
});

test("desktop hosting selects shared parsing, state, validation and runtime changes", () => {
  for (const file of [
    "markdown-deck.mjs", "deck-state.mjs", "architecture-validation.mjs",
    "runtime/io-host.mjs", "schema/theme-v1.json", "scripts/markdown-path.mjs",
  ]) {
    assert.deepEqual(
      classifyCiPaths([`.github/extensions/markdstage/${file}`]),
      expected({ test: true, cli: true, desktop: true }),
      file,
    );
  }
});

test("canonical documentation is not treated as a sample deck", () => {
  assert.deepEqual(
    classifyCiPaths([".github/extensions/markdstage/README.md"]),
    expected({ docs: true, test: true, cli: true }),
  );
});

test("shared corpus and sample deck keep their executable checks", () => {
  assert.deepEqual(
    classifyCiPaths(["test/fixtures/markdown-deck-corpus.json"]),
    expected({ test: true, desktop: true }),
  );
  assert.deepEqual(
    classifyCiPaths(["slides.md"]),
    expected({ test: true, cli: true, samples: true }),
  );
});

test("site content and sample decks select only their relevant checks", () => {
  assert.deepEqual(
    classifyCiPaths(["site/content/ja/index.md", "assets/readme/simple-slide.png"]),
    expected({}),
  );
  assert.deepEqual(
    classifyCiPaths(["site/examples/architecture.md"]),
    expected({ samples: true }),
  );
  assert.deepEqual(
    classifyCiPaths(["docs/user-guide/diagrams-and-media.md"]),
    expected({ docs: true }),
  );
  assert.deepEqual(
    classifyCiPaths(["docs/user-guide/ja/diagrams-and-media.md"]),
    expected({ docs: true }),
  );
});

test("sample path predicate distinguishes decks from explanatory documents", () => {
  for (const path of [
    "docs/user-guide/diagrams-and-media.md",
    "docs/user-guide/ja/diagrams-and-media.md",
    ".github/extensions/markdstage/README.md",
  ]) {
    assert.equal(isSampleDeckPath(path), false, path);
  }
  for (const path of [
    "slides.md",
    "site/examples/architecture.md",
    "docs/user-guide/examples/quick-start.md",
  ]) {
    assert.equal(isSampleDeckPath(path), true, path);
  }
});

test("deleted, renamed, and shared paths retain safe classifications", () => {
  assert.deepEqual(
    classifyCiPaths(["site/examples/removed.md", "site/examples/renamed.md"]),
    expected({ samples: true }),
  );
  assert.deepEqual(
    classifyCiPaths(["assets/shared/theme.css"]),
    { docs: true, test: true, cli: true, desktop: true, samples: true },
  );
});

test("mixed changes combine the selected areas", () => {
  assert.deepEqual(
    classifyCiPaths([
      "docs/user-guide/README.md",
      "packages/markdstage-cli/src/commands/export.mjs",
    ]),
    expected({ docs: true, cli: true }),
  );
});

test("infrastructure, unknown paths, empty diffs, and manual runs fail safe", () => {
  assert.deepEqual(classifyCiPaths([".github/workflows/ci.yml"]), all);
  assert.deepEqual(classifyCiPaths(["future-product/source.ts"]), all);
  assert.deepEqual(classifyCiPaths([]), all);
  assert.deepEqual(classifyCiPaths(["docs/user-guide/README.md"], { forceAll: true }), all);
});
