import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveNodeWorkspace } from "../runtime/io-node.mjs";
import { resolveWorkspaceRoot } from "../scripts/workspace-root.mjs";

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), "markdstage-explicit-root-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("workspace resolution never derives a root from missing or relative arguments", async () => {
  for (const args of [{}, { workspaceRoot: "." }, { file: "slides.md" }, { workspaceRoot: "" }]) {
    await assert.rejects(resolveNodeWorkspace(args), { code: "invalid_input" });
  }
});

test("file resolution selects the nearest .git marker, including a worktree file", async (t) => {
  const root = await workspace(t);
  const nested = join(root, "worktree");
  const directory = join(nested, "decks");
  await mkdir(join(root, ".git"));
  await mkdir(directory, { recursive: true });
  await writeFile(join(nested, ".git"), "gitdir: deliberately-not-resolved\n");
  const file = join(directory, "slides.md");
  await writeFile(file, "# Test\n");
  assert.equal(resolveWorkspaceRoot(directory, root), nested);
  assert.deepEqual(await resolveNodeWorkspace({ file }), {
    workspaceRoot: await realpath(nested), file,
  });
});

test("file outside Git uses its containing directory and explicit workspace takes priority", async (t) => {
  const root = await workspace(t);
  const directory = join(root, "decks");
  await mkdir(directory);
  const file = join(directory, "slides.md");
  await writeFile(file, "# Test\n");
  assert.equal((await resolveNodeWorkspace({ file })).workspaceRoot, await realpath(directory));
  assert.equal((await resolveNodeWorkspace({ workspaceRoot: root, file })).workspaceRoot, await realpath(root));
  assert.deepEqual(await resolveNodeWorkspace({ workspaceRoot: root }), {
    workspaceRoot: await realpath(root), file: undefined,
  });
});

test("explicit workspace rejects files outside the root and symlinks inside it", async (t) => {
  const root = await workspace(t);
  const inside = join(root, "workspace");
  await mkdir(inside);
  const outside = join(root, "outside.md");
  await writeFile(outside, "# Outside\n");
  await assert.rejects(resolveNodeWorkspace({ workspaceRoot: inside, file: outside }), {
    code: "path_outside_workspace",
  });
  const link = join(inside, "linked.md");
  try {
    await symlink(outside, link);
  } catch (error) {
    if (error.code === "EPERM") return t.skip("Symlink creation requires Windows developer privileges.");
    throw error;
  }
  await assert.rejects(resolveNodeWorkspace({ workspaceRoot: inside, file: link }), {
    code: "path_outside_workspace",
  });
});

test("an unavailable workspace is a classified error", async (t) => {
  const root = await workspace(t);
  await assert.rejects(resolveNodeWorkspace({ workspaceRoot: join(root, "missing") }), {
    code: "workspace_not_found",
  });
});
