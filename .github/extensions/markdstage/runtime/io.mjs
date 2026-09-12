import { MarkdStageError } from "./errors.mjs";

// Port methods return asynchronous { ok, value } / { ok, code, message } results.
// Handles are opaque [A-Za-z0-9_-] tokens of 1–256 characters, never paths.
export const IO_OPERATIONS = Object.freeze([
  "readText",
  "readBytes",
  "stat",
  "list",
  "writeBytes",
  "replaceText",
  "makeDirectory",
  "watch",
  "unwatch",
  "createTransientDirectory",
  "removeTransientDirectory",
  "launchBrowser",
  "closeBrowser",
]);

export const IO_LIMITS = Object.freeze({
  markdown: 2097152,
  themeCss: 65536,
  themeMetadata: 65536,
  themeAsset: 2097152,
  architectureAsset: 10485760,
});

export function isWorkspacePath(path, { allowRoot = false } = {}) {
  if (typeof path !== "string") return false;
  if (path === "") return allowRoot === true;
  if (/[\\<>:"|?*\u0000-\u001f\u007f]/u.test(path)) return false;
  return path.split("/").every((segment) => (
    segment !== "" &&
    segment !== "." &&
    segment !== ".." &&
    !/[. ]$/u.test(segment) &&
    !/^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:[ .]|$)/iu.test(segment)
  ));
}

let installedIO;

export function installIO(adapter) {
  const facade = {};
  for (const operation of IO_OPERATIONS) {
    const method = adapter?.[operation];
    if (typeof method !== "function") {
      throw new TypeError(`I/O adapter requires ${operation}().`);
    }
    facade[operation] = method.bind(adapter);
  }
  installedIO = Object.freeze(facade);
  return installedIO;
}

export function getIO() {
  if (!installedIO) throw new Error("An I/O adapter must be installed before use.");
  return installedIO;
}

const portCodes = new Set(["denied", "unsupported", "missing", "too_large", "exists", "conflict", "io_failed"]);
const writes = new Set(["writeBytes", "replaceText", "makeDirectory"]);
const rootOperations = new Set(["stat", "list", "watch"]);
const messages = {
  invalid_input: "The workspace-relative path is invalid.",
  path_outside_workspace: "The path is not accessible within the workspace.",
  invalid_output_path: "The output path is not available.",
  invalid_markdown_path: "The file must have a Markdown extension.",
  file_not_found: "The requested file or directory was not found.",
  file_too_large: "The file exceeds its size limit.",
  theme_file_not_found: "The theme file was not found.",
  slide_background_too_large: "The slide background exceeds its size limit.",
  source_changed: "The source changed before it could be saved.",
  io_failed: "The I/O operation failed.",
};

export function unwrapIOResult(result, { operation, path, kind } = {}) {
  let portCode = "io_failed";
  try {
    if (result && typeof result === "object" && !Array.isArray(result)) {
      const ok = result.ok;
      if (ok === true && Object.hasOwn(result, "value")) return result.value;
      const code = result.code;
      if (ok === false && portCodes.has(code) && typeof result.message === "string") {
        portCode = code;
      }
    }
  } catch {
    // Bridge exceptions and transport objects are never user-facing diagnostics.
  }
  const validPath = isWorkspacePath(path, { allowRoot: rootOperations.has(operation) });
  let code = {
    denied: path !== undefined && !validPath
      ? "invalid_input"
      : writes.has(operation) ? "invalid_output_path" : "path_outside_workspace",
    unsupported: "invalid_markdown_path",
    missing: "file_not_found",
    too_large: "file_too_large",
    exists: "invalid_output_path",
    conflict: "source_changed",
    io_failed: "io_failed",
  }[portCode];
  if (kind === "theme" && portCode === "missing") code = "theme_file_not_found";
  if (kind === "slide-background" && portCode === "too_large") code = "slide_background_too_large";
  const suffix = validPath && path !== "" ? ` (${path})` : "";
  throw new MarkdStageError(code, `${messages[code]}${suffix}`);
}
