import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const generator = join(
  repositoryRoot,
  "apps",
  "MarkdStage.Desktop",
  "src",
  "MarkdStage.Cli",
  "package-data.mjs",
);
const shared = join(repositoryRoot, "packages", "markdstage-cli", "shared");
const canonicalDeck = join(
  repositoryRoot,
  ".github",
  "extensions",
  "markdstage",
  "markdown-deck.mjs",
);

function generate(output) {
  const result = spawnSync(process.execPath, [generator, output], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(
    result.status,
    0,
    `package data generation failed:\n${result.stdout}\n${result.stderr}`,
  );
  return readFileSync(join(output, "CliData", "commands.json"));
}

test("Desktop package data ignores missing and incomplete npm shared mirrors", () => {
  const scratch = mkdtempSync(join(tmpdir(), "markdstage-package-data-"));
  const backup = `${shared}.package-data-test-${process.pid}-${basename(scratch)}`;
  const hadShared = existsSync(shared);

  try {
    if (hadShared) renameSync(shared, backup);

    const withoutShared = generate(join(scratch, "missing"));

    mkdirSync(shared, { recursive: true });
    copyFileSync(canonicalDeck, join(shared, "markdown-deck.mjs"));
    const withIncompleteShared = generate(join(scratch, "incomplete"));

    assert.deepEqual(withIncompleteShared, withoutShared);
  } finally {
    rmSync(shared, { recursive: true, force: true });
    if (hadShared) renameSync(backup, shared);
    rmSync(scratch, { recursive: true, force: true });
  }
});
