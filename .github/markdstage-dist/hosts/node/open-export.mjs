import { realpath, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { extname, resolve } from "node:path";
import { isPathInside } from "../../runtime/output-paths.mjs";

const EXPORT_EXTENSIONS = new Set([".pdf", ".pptx"]);

export async function openExportFile(workspaceRoot, requestedPath) {
  if (typeof requestedPath !== "string" || !requestedPath.trim()) {
    const error = new Error("An export path is required.");
    error.code = "invalid_export_path";
    throw error;
  }

  let root;
  try {
    root = await realpath(resolve(workspaceRoot));
  } catch (_) {
    const error = new Error("The workspace could not be resolved.");
    error.code = "workspace_not_found";
    throw error;
  }
  const candidate = resolve(root, requestedPath);
  if (!isPathInside(root, candidate) || !EXPORT_EXTENSIONS.has(extname(candidate).toLowerCase())) {
    const error = new Error("The export path is invalid.");
    error.code = "invalid_export_path";
    throw error;
  }

  let file;
  let info;
  try {
    file = await realpath(candidate);
    info = await stat(file);
  } catch (_) {
    const error = new Error("The exported file was not found.");
    error.code = "export_not_found";
    throw error;
  }
  if (!info.isFile() || !isPathInside(root, file)) {
    const error = new Error("The exported file was not found.");
    error.code = "export_not_found";
    throw error;
  }

  const [command, args] = process.platform === "win32"
    ? ["explorer.exe", [file]]
    : process.platform === "darwin"
      ? ["open", [file]]
      : ["xdg-open", [file]];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  await new Promise((resolvePromise, rejectPromise) => {
    child.once("spawn", resolvePromise);
    child.once("error", (cause) => {
      const error = new Error("The exported file could not be opened.");
      error.code = cause?.code || "open_export_failed";
      rejectPromise(error);
    });
  });
  child.unref();
  return { ok: true };
}
