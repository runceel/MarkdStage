import { IO_LIMITS, IO_OPERATIONS, isWorkspacePath } from "./io.mjs";

const pathOperations = new Set(["readText", "readBytes", "stat", "list", "writeBytes", "replaceText", "makeDirectory", "watch"]);
const rootOperations = new Set(["stat", "list", "watch"]);
const voidOperations = new Set(["unwatch", "removeTransientDirectory", "closeBrowser"]);
const errorMessages = Object.freeze({
  denied: "The I/O request was denied.",
  unsupported: "The requested file type is unsupported.",
  missing: "The requested file or directory was not found.",
  too_large: "The file exceeds its size limit.",
  exists: "The output already exists.",
  conflict: "The source changed before it could be saved.",
  io_failed: "The I/O operation failed.",
});
const eventKinds = new Set(["change", "changed", "rename", "create", "modify", "delete", "created", "modified", "deleted"]);
const purposes = new Set(["inspect", "capture", "pdf", "pptx", "present"]);
const fail = (code = "io_failed") => ({ ok: false, code, message: errorMessages[code] });
const succeed = (value) => ({ ok: true, value });
// Opaque tokens are transport identifiers, never filesystem paths.
const isHandle = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/u.test(value);
const isSize = (value) => Number.isSafeInteger(value) && value >= 0;
const maxReadBytes = Math.max(...Object.values(IO_LIMITS));
const maxListEntries = 10000;

function readStat(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  // modifiedAt is an epoch-millisecond timestamp, including fractional milliseconds.
  const { kind, size, modifiedAt } = value;
  if ((kind !== "file" && kind !== "directory") || !isSize(size) ||
      !Number.isFinite(modifiedAt) || modifiedAt < 0) return null;
  return { kind, size, modifiedAt };
}

function readLimit(maxBytes) {
  return maxBytes === undefined ? maxReadBytes : Math.min(maxBytes, maxReadBytes);
}

function validLocalUrl(value, protocols) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol) &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function readBrowserOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) return null;
  const { url, profile, mode, windowSize } = options;
  if (!validLocalUrl(url, ["http:"]) || !isHandle(profile) ||
      (mode !== "app" && mode !== "automation")) return null;
  const result = { url, profile, mode };
  if (windowSize !== undefined) {
    if (!windowSize || typeof windowSize !== "object" || Array.isArray(windowSize)) return null;
    const { width, height } = windowSize;
    if (!Number.isSafeInteger(width) || width <= 0 || width > 8192 ||
        !Number.isSafeInteger(height) || height <= 0 || height > 8192) return null;
    result.windowSize = { width, height };
  }
  return result;
}

function validateResult(operation, result, args) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return fail();
  const ok = result.ok;
  if (ok === false) {
    const code = result.code;
    return typeof code === "string" && Object.hasOwn(errorMessages, code) && typeof result.message === "string"
      ? fail(code) : fail();
  }
  if (ok !== true || !Object.hasOwn(result, "value")) return fail();
  const value = result.value;
  if (operation === "readText") {
    if (typeof value !== "string") return fail();
    if (value.length > readLimit(args[1]) || new TextEncoder().encode(value).byteLength > readLimit(args[1])) {
      return fail("too_large");
    }
    return succeed(value.replace(/^\uFEFF/u, ""));
  }
  if (operation === "readBytes") {
    if (!(value instanceof Uint8Array) && !Array.isArray(value)) return fail();
    const length = value.length;
    if (!isSize(length)) return fail();
    if (length > readLimit(args[1])) return fail("too_large");
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      const byte = value[index];
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) return fail();
      bytes[index] = byte;
    }
    return succeed(bytes);
  }
  if (operation === "stat") {
    const info = readStat(value);
    return info ? succeed(info) : fail();
  }
  if (operation === "list") {
    if (!Array.isArray(value)) return fail();
    const length = value.length;
    if (!isSize(length) || length > Math.min(args[1]?.maxEntries ?? maxListEntries, maxListEntries)) return fail();
    const entries = [];
    for (let index = 0; index < length; index += 1) {
      const entry = value[index];
      const info = readStat(entry);
      const path = entry?.path;
      if (!info || !isWorkspacePath(path)) return fail();
      if (args[0] !== "" && !path.startsWith(`${args[0]}/`)) return fail();
      entries.push({ path, ...info });
    }
    return succeed(entries);
  }
  if (["writeBytes", "replaceText", "makeDirectory"].includes(operation)) {
    return isWorkspacePath(value) && value === args[0] ? succeed(value) : fail();
  }
  if (operation === "watch" || operation === "createTransientDirectory") {
    return isHandle(value) ? succeed(value) : fail();
  }
  if (voidOperations.has(operation)) {
    return value === undefined || value === null ? succeed(undefined) : fail();
  }
  if (operation === "launchBrowser") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
    const { handle, debuggerEndpoint } = value;
    if (!isHandle(handle)) return fail();
    const browser = { handle };
    if (debuggerEndpoint !== undefined) {
      if (!validLocalUrl(debuggerEndpoint, ["ws:", "wss:", "http:", "https:"])) return fail();
      browser.debuggerEndpoint = debuggerEndpoint;
    }
    return succeed(browser);
  }
  return fail();
}

export function createHostIO(bridge) {
  const facade = {};
  for (const operation of IO_OPERATIONS) {
    const method = bridge?.[operation];
    if (typeof method !== "function") throw new TypeError(`Host bridge requires ${operation}().`);
    facade[operation] = async (...args) => {
      try {
        if (pathOperations.has(operation) && !isWorkspacePath(args[0], { allowRoot: rootOperations.has(operation) })) {
          return fail("denied");
        }
        const options = operation === "list" || operation === "watch" ? args[1]
          : operation === "writeBytes" || operation === "replaceText" ? args[2] : undefined;
        if (options !== undefined && (!options || typeof options !== "object" || Array.isArray(options))) {
          return fail("denied");
        }
        if (operation === "readText" || operation === "readBytes") {
          if (args[1] !== undefined && !isSize(args[1])) return fail("denied");
        }
        if (operation === "writeBytes" && !(args[1] instanceof Uint8Array)) return fail("denied");
        if (operation === "replaceText" && typeof args[1] !== "string") return fail("denied");
        if (operation === "list" && args[1]?.maxEntries !== undefined &&
            (!isSize(args[1].maxEntries) || args[1].maxEntries === 0 ||
             args[1].maxEntries > maxListEntries)) return fail("denied");
        if (voidOperations.has(operation) && !isHandle(args[0])) return fail("denied");
        if (operation === "createTransientDirectory" && !purposes.has(args[0])) return fail("denied");
        if (operation === "launchBrowser") {
          const options = readBrowserOptions(args[0]);
          if (!options) return fail("denied");
          args[0] = options;
        }
        if (operation === "watch") {
          const [path, , onChange] = args;
          if (onChange !== undefined && typeof onChange !== "function") return fail("denied");
          // The JS bridge receives onChange out-of-band; it is not serialized with options.
          args[2] = (event) => {
            try {
              if (!event || typeof event !== "object" || Array.isArray(event)) return;
              const { path: changedPath, kind } = event;
              if (!isWorkspacePath(changedPath) || !eventKinds.has(kind)) return;
              if (path !== "" && changedPath !== path && !changedPath.startsWith(`${path}/`)) return;
              const pending = onChange?.({ path: changedPath, kind });
              Promise.resolve(pending).catch(() => {});
            } catch {
              // Malformed events and callback failures must not cross the bridge.
            }
          };
        }
        return validateResult(operation, await method.apply(bridge, args), args);
      } catch {
        return fail();
      }
    };
  }
  return Object.freeze(facade);
}
