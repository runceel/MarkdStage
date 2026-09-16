import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isSampleDeckPath } from "../../scripts/ci-sample-path.mjs";
import { CI_AREAS, classifyCiPaths } from "../../scripts/ci-paths.mjs";

const none = { docs: false, test: false, cli: false, desktop: false, samples: false, awesome: false };
const all = { docs: true, test: true, cli: true, desktop: true, samples: true, awesome: true };

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
  assert.deepEqual(
    classifyCiPaths([
      "docs/architecture.md",
      "docs/adr/0004-agent-skills-as-installation-artifacts.md",
      "docs/specs/README.md",
    ]),
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
    expected({ test: true, awesome: true }),
  );
});

test("the Agent Skill generator selects every packaging consumer", () => {
  for (const path of [
    "packages/markdstage-cli/src/commands/guide.mjs",
    "packages/markdstage-cli/src/exit.mjs",
    "packages/markdstage-cli/src/runtime.mjs",
    "packages/markdstage-cli/src/skills.mjs",
  ]) {
    assert.deepEqual(
      classifyCiPaths([path]),
      expected({ cli: true, desktop: true }),
      path,
    );
  }
});

test("canonical shared files select their real consumers", () => {
  assert.deepEqual(
    classifyCiPaths([".github/extensions/markdstage/renderer/slides.css"]),
    expected({ test: true, cli: true, desktop: true, awesome: true }),
  );
  assert.deepEqual(
    classifyCiPaths([".github/extensions/markdstage/runtime/output.mjs"]),
    expected({ test: true, cli: true, desktop: true, awesome: true }),
  );
  assert.deepEqual(
    classifyCiPaths([".github/extensions/markdstage/windows/pen-button-listener.ps1"]),
    expected({ test: true, desktop: true, awesome: true }),
  );
});

test("desktop hosting selects shared parsing, state, validation and runtime changes", () => {
  for (const file of [
    "markdown-deck.mjs", "deck-state.mjs", "architecture-validation.mjs",
    "runtime/io-host.mjs", "schema/theme-v1.json", "scripts/markdown-path.mjs",
  ]) {
    assert.deepEqual(
      classifyCiPaths([`.github/extensions/markdstage/${file}`]),
      expected({ test: true, cli: true, desktop: true, awesome: true }),
      file,
    );
  }
});

test("canonical documentation is not treated as a sample deck", () => {
  assert.deepEqual(
    classifyCiPaths([".github/extensions/markdstage/README.md"]),
    expected({ docs: true, test: true, cli: true, awesome: true }),
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

test("store assets select no checks beyond the published plugin preview", () => {
  assert.deepEqual(
    classifyCiPaths([
      ".github/store/README.md",
      ".github/store/listing-en-us.md",
      ".github/store/logos/BoxArt-2160x2160.png",
      ".github/store/scripts/Render-Svg.ps1",
    ]),
    expected({}),
  );
  // This screenshot is the source of the plugin preview image.
  assert.deepEqual(
    classifyCiPaths([".github/store/screenshots/01-architecture.png"]),
    expected({ awesome: true }),
  );
});

test("the published plugin tree selects only its own verification", () => {
  assert.deepEqual(
    classifyCiPaths([
      ".github/plugin/markdstage/plugin.json",
      ".github/plugin/markdstage/com.github.copilot/extensions/markdstage/extension.mjs",
    ]),
    expected({ awesome: true }),
  );
  assert.deepEqual(
    classifyCiPaths([".github/plugin/markdstage/README.md"]),
    expected({ docs: true, awesome: true }),
  );
  // The manifest version must stay aligned with the CLI product version.
  assert.deepEqual(
    classifyCiPaths(["packages/markdstage-cli/package.json"]),
    expected({ cli: true, desktop: true, awesome: true }),
  );
});

test("sample path predicate distinguishes decks from explanatory documents", () => {
  for (const path of [
    "docs/user-guide/diagrams-and-media.md",
    "docs/user-guide/ja/diagrams-and-media.md",
    ".github/extensions/markdstage/README.md",
    "docs/user-guide/examples/custom-theme-helioworks/themes/helioworks/assets/logo.svg",
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
    all,
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

test("every classified area is published, selectable, and verified by the workflow", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  const gate = workflow.split("  gate:")[1];
  for (const area of CI_AREAS) {
    assert.match(workflow, new RegExp(`^      ${area}: \\$\\{\\{ steps\\.classify\\.outputs\\.${area} \\}\\}$`, "m"), area);
    assert.match(workflow, new RegExp(`^    if: needs\\.changes\\.outputs\\.${area} == 'true'$`, "m"), area);
    assert.match(gate, new RegExp(`^      - ${area}$`, "m"), area);
    assert.match(gate, new RegExp(`needs\\.changes\\.outputs\\.${area}`), area);
  }
  assert.match(gate, /check_job "Awesome Copilot plugin" "\$AWESOME_SELECTED" "\$AWESOME_RESULT"/);
});

test("the Awesome Copilot plugin verification never writes during CI or release", async () => {
  const scripts = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ).scripts;
  assert.equal(scripts["awesome:sync"], "node scripts/sync-awesome-copilot-plugin.mjs");
  assert.match(scripts["awesome:check"], /sync-awesome-copilot-plugin\.mjs --check/);
  assert.doesNotMatch(scripts["awesome:check"], /awesome:sync/);

  const release = await readFile(
    new URL("../../.github/workflows/npm-publish.yml", import.meta.url),
    "utf8",
  );
  assert.match(release, /Verify the published Awesome Copilot plugin tree/);
  assert.match(release, /run: npm run awesome:check/);
});
