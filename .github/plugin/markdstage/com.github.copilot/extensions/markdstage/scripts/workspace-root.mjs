import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function resolveWorkspaceRoot(workingDirectory, fallbackRoot) {
  const fallback = resolve(fallbackRoot);
  if (!workingDirectory) return fallback;

  const workspace = resolve(workingDirectory);
  if (!existsSync(workspace)) return fallback;

  let directory = workspace;
  for (;;) {
    if (existsSync(join(directory, ".git"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  return workspace;
}
