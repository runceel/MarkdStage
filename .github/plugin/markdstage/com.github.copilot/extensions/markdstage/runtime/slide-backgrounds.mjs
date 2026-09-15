// Compatibility entry point for Node CLI and canvas callers.
import { isAbsolute, join, relative, sep } from "node:path";
import { createNodeIO } from "./io-node.mjs";
import { resolveBackground, validateBackgrounds } from "./workspace-assets.mjs";

function sourcePath(root, source) {
  return isAbsolute(source || "") ? relative(root, source).split(sep).join("/") : source;
}

export async function resolveSlideBackgroundFile(workspaceRoot, sourceName, value, { io } = {}) {
  const adapter = io ?? await createNodeIO({ workspaceRoot });
  const path = await resolveBackground(adapter, sourcePath(workspaceRoot, sourceName), value);
  return path ? join(workspaceRoot, path) : null;
}

export async function loadSlideBackgrounds(workspaceRoot, sourceName, slides, { io } = {}) {
  const adapter = io ?? await createNodeIO({ workspaceRoot });
  return validateBackgrounds(adapter, sourcePath(workspaceRoot, sourceName), slides);
}
