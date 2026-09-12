import { constants, watch as watchDirectory } from "node:fs";
import { lstat, realpath, open, opendir, mkdir, mkdtemp, rename, link, unlink, rm } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { IO_LIMITS, isWorkspacePath } from "./io.mjs";
import { findChromiumBrowser, terminateProcessTree, delay } from "./browser.mjs";

const MESSAGES = Object.freeze({
  denied: "The operation is not permitted.",
  missing: "The requested file or directory is unavailable.",
  too_large: "The operation exceeds its size or enumeration limit.",
  exists: "The destination already exists.",
  conflict: "The source changed before it could be saved.",
  io_failed: "The I/O operation failed.",
});
const MAX_ENTRIES = 10_000;
const MAX_DEPTH = 64;
const PURPOSES = new Set(["inspect", "capture", "pdf", "pptx", "present"]);

class PortError extends Error {
  constructor(code, message = MESSAGES[code]) {
    super(message);
    this.portCode = code;
  }
}

function fail(code, message) {
  throw new PortError(code, message);
}

function failure(error) {
  const code = error instanceof PortError ? error.portCode : ({
    ENOENT: "missing", ENOTDIR: "missing", EEXIST: "exists",
    ELOOP: "denied", EACCES: "denied", EPERM: "denied",
  })[error?.code] || "io_failed";
  return { ok: false, code, message: error instanceof PortError ? error.message : MESSAGES[code] };
}

const result = (operation) => async (...args) => {
  try {
    return { ok: true, value: await operation(...args) };
  } catch (error) {
    return failure(error);
  }
};

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameVersion(left, right) {
  return sameIdentity(left, right) && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function inside(root, path) {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function describe(info) {
  if (!info.isFile() && !info.isDirectory()) fail("missing");
  return { kind: info.isDirectory() ? "directory" : "file", size: info.size, modifiedAt: info.mtimeMs };
}

function optionsObject(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) fail("denied");
  return options;
}

function extensionsOption(extensions) {
  if (extensions === undefined) return null;
  if (!Array.isArray(extensions) || extensions.length > 100 ||
      extensions.some((value) => typeof value !== "string" || !/^\.[a-z0-9]+$/i.test(value))) fail("denied");
  return new Set(extensions.map((value) => value.toLowerCase()));
}

function readLimit(path, hint) {
  const extension = extname(path).toLowerCase();
  const ceiling = extension === ".md" || extension === ".markdown" ? IO_LIMITS.markdown :
    extension === ".css" ? IO_LIMITS.themeCss :
      basename(path).toLowerCase() === "theme.json" ? IO_LIMITS.themeMetadata :
        [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".ico", ".bmp"].includes(extension)
          ? IO_LIMITS.themeAsset : IO_LIMITS.architectureAsset;
  if (hint === undefined) return ceiling;
  if (!Number.isSafeInteger(hint) || hint < 0) fail("denied");
  return Math.min(hint, ceiling);
}

// Node cannot make path-based checks race-free against a hostile directory
// swap, or identify every Windows reparse tag. The native host must provide
// those guarantees using directory handles and platform-specific checks.
export async function createNodeIO({ workspaceRoot, transientRoot = tmpdir() } = {}) {
  let root;
  let rootInfo;
  let transient;
  let transientInfo;
  try {
    if (typeof workspaceRoot !== "string" || !isAbsolute(workspaceRoot) ||
        typeof transientRoot !== "string" || !isAbsolute(transientRoot)) fail("denied");
    root = await realpath(workspaceRoot);
    rootInfo = await lstat(root);
    transient = await realpath(transientRoot);
    transientInfo = await lstat(transient);
    if (!rootInfo.isDirectory() || !transientInfo.isDirectory()) fail("missing");
  } catch {
    throw new TypeError("The Node I/O adapter requires existing absolute workspace and transient directories.");
  }

  const subscriptions = new Map();
  // An age/prefix sweep cannot distinguish abandoned profiles from another
  // active adapter. Cleanup is limited to handles created by this instance.
  const transients = new Map();
  const browsers = new Map();
  let mutationTail = Promise.resolve();
  const mutate = (operation) => {
    const pending = mutationTail.then(operation);
    mutationTail = pending.catch(() => {});
    return pending;
  };

  function syntax(path, allowRoot = false) {
    if (!isWorkspacePath(path, { allowRoot }) || path.split("/").length > MAX_DEPTH) fail("denied");
  }

  async function checkRoot(path, original) {
    const current = await lstat(path);
    if (current.isSymbolicLink() || !current.isDirectory() || !sameIdentity(current, original) ||
        await realpath(path) !== path) fail("denied");
    return current;
  }

  async function resolvePath(path, { allowRoot = false, missingLeaf = false, createParents = false } = {}) {
    syntax(path, allowRoot);
    const currentRootInfo = await checkRoot(root, rootInfo);
    let absolute = root;
    let info = currentRootInfo;
    const parts = path ? path.split("/") : [];
    for (let index = 0; index < parts.length; index++) {
      absolute = join(absolute, parts[index]);
      const leaf = index === parts.length - 1;
      try {
        info = await lstat(absolute);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        if (!leaf && createParents) {
          await resolvePath(parts.slice(0, index).join("/"), { allowRoot: true });
          await mkdir(absolute).catch((mkdirError) => {
            if (mkdirError.code !== "EEXIST") throw mkdirError;
          });
          info = await lstat(absolute);
        } else if (leaf && missingLeaf) {
          return { absolute, info: null };
        } else {
          throw error;
        }
      }
      if (info.isSymbolicLink() || info.dev !== rootInfo.dev) fail("denied");
      if (!inside(root, await realpath(absolute))) fail("denied");
      if (!leaf && !info.isDirectory()) fail("missing");
    }
    return { absolute, info };
  }

  async function read(path, maxBytes) {
    syntax(path);
    const limit = readLimit(path, maxBytes);
    const entry = await resolvePath(path);
    if (!entry.info.isFile()) fail("missing");
    if (entry.info.size > limit) fail("too_large");
    const file = await open(entry.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const before = await file.stat();
      if (!before.isFile()) fail("missing");
      if (before.size > limit) fail("too_large");
      if (!sameVersion(before, entry.info)) fail("io_failed");
      if (!sameVersion(before, (await resolvePath(path)).info)) fail("io_failed");
      const buffer = Buffer.alloc(limit + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      const after = await file.stat();
      if (length > limit || after.size > limit) fail("too_large");
      if (!sameVersion(before, after) || !sameVersion(before, (await resolvePath(path)).info)) fail("io_failed");
      return new Uint8Array(buffer.subarray(0, length));
    } finally {
      await file.close();
    }
  }

  async function listEntries(path, options = {}) {
    syntax(path, true);
    const { extensions, maxEntries = 1000, recursive = false } = optionsObject(options);
    const filter = extensionsOption(extensions);
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_ENTRIES ||
        typeof recursive !== "boolean") fail("denied");
    const start = await resolvePath(path, { allowRoot: true });
    if (!start.info.isDirectory()) fail("missing");
    const entries = [];
    const pending = [{ path, depth: 0 }];
    let scanned = 0;
    while (pending.length && entries.length < maxEntries) {
      const current = pending.shift();
      const directory = await resolvePath(current.path, { allowRoot: true });
      const names = [];
      const stream = await opendir(directory.absolute);
      for await (const entry of stream) {
        if (++scanned > MAX_ENTRIES) fail("too_large");
        names.push(entry.name);
      }
      names.sort();
      for (const name of names) {
        const child = current.path ? `${current.path}/${name}` : name;
        const { info } = await resolvePath(child);
        const item = describe(info);
        if (recursive && info.isDirectory()) {
          if (current.depth + 1 >= MAX_DEPTH) fail("too_large");
          pending.push({ path: child, depth: current.depth + 1 });
        }
        if (!filter || (info.isFile() && filter.has(extname(name).toLowerCase()))) {
          entries.push({ path: child, ...item });
          if (entries.length === maxEntries) break;
        }
      }
    }
    return entries;
  }

  async function atomicWrite(path, bytes, { overwrite, expectedModifiedAt, replace = false }) {
    syntax(path);
    if (!(bytes instanceof Uint8Array) || typeof overwrite !== "boolean" ||
        (expectedModifiedAt !== undefined && (!Number.isFinite(expectedModifiedAt) || expectedModifiedAt < 0))) fail("denied");
    const target = await resolvePath(path, { missingLeaf: !replace, createParents: !replace });
    if (target.info && !target.info.isFile()) fail("missing");
    if (target.info && !overwrite) fail("exists");
    if (replace && expectedModifiedAt !== undefined && target.info.mtimeMs !== expectedModifiedAt) fail("conflict");
    const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const parent = await resolvePath(parentPath, { allowRoot: true });
    const temporaryName = `.markdstage-${randomUUID()}.tmp`;
    const temporaryPath = parentPath ? `${parentPath}/${temporaryName}` : temporaryName;
    const temporary = join(parent.absolute, temporaryName);
    let file;
    let staged = false;
    let stagedInfo;
    try {
      file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0),
        target.info ? target.info.mode & 0o777 : 0o600);
      staged = true;
      await file.writeFile(bytes);
      await file.sync();
      stagedInfo = await file.stat();
      await file.close();
      file = null;
      const latestParent = await resolvePath(parentPath, { allowRoot: true });
      if (!sameIdentity(parent.info, latestParent.info)) fail("denied");
      let latest;
      try {
        latest = await resolvePath(path, { missingLeaf: true });
      } catch (error) {
        if (replace && error.code === "ENOENT") fail("conflict");
        throw error;
      }
      if (replace && (!latest.info || !sameVersion(target.info, latest.info))) fail("conflict");
      if (latest.info && !latest.info.isFile()) fail("missing");
      const checkedStage = await resolvePath(temporaryPath);
      if (!sameVersion(stagedInfo, checkedStage.info)) fail("denied");
      if (overwrite) {
        await rename(temporary, target.absolute);
        staged = false;
      } else {
        // Linking the flushed sibling gives atomic no-clobber semantics;
        // rename alone would silently replace a concurrently created target.
        await link(temporary, target.absolute);
        await unlink(temporary);
        staged = false;
      }
      return path;
    } finally {
      if (file) await file.close().catch(() => {});
      if (staged) {
        // Never follow a replaced parent merely to clean up a staging name.
        const current = await resolvePath(parentPath, { allowRoot: true }).catch(() => null);
        if (current && sameIdentity(parent.info, current.info)) {
          await unlink(temporary).catch(() => {});
        }
      }
    }
  }

  function stopWatching(handle) {
    const subscription = subscriptions.get(handle);
    if (!subscription) fail("denied");
    subscription.closed = true;
    clearTimeout(subscription.timer);
    subscriptions.delete(handle);
    try {
      subscription.watcher.close();
    } catch {
      // A failed native watcher may already have closed itself.
    }
  }

  async function ownedTransient(handle) {
    const entry = transients.get(handle);
    if (!entry) fail("denied");
    await checkRoot(transient, transientInfo);
    await checkRoot(entry.path, entry.info);
    return entry;
  }

  return Object.freeze({
    readText: result(async (path, maxBytes) => new TextDecoder().decode(await read(path, maxBytes))),
    readBytes: result(read),
    stat: result(async (path) => describe((await resolvePath(path, { allowRoot: true })).info)),
    list: result(listEntries),
    writeBytes: result((path, bytes, options = {}) => {
      syntax(path);
      const { overwrite = false } = optionsObject(options);
      if (!(bytes instanceof Uint8Array)) fail("denied");
      const snapshot = new Uint8Array(bytes);
      return mutate(() => atomicWrite(path, snapshot, { overwrite }));
    }),
    replaceText: result((path, contents, options = {}) => {
      const { expectedModifiedAt } = optionsObject(options);
      if (typeof contents !== "string") fail("denied");
      return mutate(() => atomicWrite(path, new TextEncoder().encode(contents), { overwrite: true, replace: true, expectedModifiedAt }));
    }),
    makeDirectory: result((path) => mutate(async () => {
      const entry = await resolvePath(path, { missingLeaf: true, createParents: true });
      if (!entry.info) await mkdir(entry.absolute).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
      if (!(await resolvePath(path)).info.isDirectory()) fail("missing");
      return path;
    })),
    watch: result(async (path, options = {}, onChange) => {
      syntax(path, true);
      const { extensions } = optionsObject(options);
      const filter = extensionsOption(extensions);
      if (typeof onChange !== "function") fail("denied");
      const entry = await resolvePath(path, { allowRoot: true });
      describe(entry.info);
      const directoryPath = entry.info.isDirectory() ? path : (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
      const directory = await resolvePath(directoryPath, { allowRoot: true });
      const known = new Set(entry.info.isFile() ? [path] :
        (await listEntries(path, { maxEntries: MAX_ENTRIES, recursive: true })).map((item) => item.path));
      const handle = randomUUID();
      const subscription = { closed: false, timer: null, watcher: null };
      const pending = new Set();
      let running = false;
      const flush = async () => {
        if (subscription.closed || running) return;
        running = true;
        try {
          const changed = [...pending].sort();
          pending.clear();
          for (const changedPath of changed) {
            if (subscription.closed) break;
            let kind;
            try {
              await resolvePath(changedPath);
              kind = known.has(changedPath) ? "changed" : "created";
              if (!known.has(changedPath) && known.size >= MAX_ENTRIES) {
                stopWatching(handle);
                break;
              }
              known.add(changedPath);
            } catch (error) {
              if (error.code !== "ENOENT" || !known.has(changedPath)) continue;
              kind = "deleted";
              known.delete(changedPath);
            }
            if (!subscription.closed) await Promise.resolve(onChange({ path: changedPath, kind })).catch(() => {});
          }
        } catch {
          // Watch callbacks and OS errors never cross the port as exceptions.
        } finally {
          running = false;
          if (pending.size && !subscription.closed) subscription.timer = setTimeout(flush, 120);
        }
      };
      subscription.watcher = watchDirectory(directory.absolute, { persistent: false, recursive: entry.info.isDirectory() }, (_kind, filename) => {
        if (subscription.closed) return;
        const name = filename == null ? null : String(filename).split(sep).join("/");
        const changedPath = name === null ? (entry.info.isFile() ? path : null) :
          (directoryPath ? `${directoryPath}/${name}` : name);
        if (changedPath === null || !isWorkspacePath(changedPath) ||
            (entry.info.isFile() && changedPath !== path) ||
            (filter && !filter.has(extname(changedPath).toLowerCase()))) return;
        pending.add(changedPath);
        if (pending.size > MAX_ENTRIES) {
          stopWatching(handle);
          return;
        }
        clearTimeout(subscription.timer);
        subscription.timer = setTimeout(flush, 120);
      });
      subscriptions.set(handle, subscription);
      subscription.watcher.on("error", () => {
        if (subscriptions.has(handle)) stopWatching(handle);
      });
      return handle;
    }),
    unwatch: result(async (handle) => stopWatching(handle)),
    createTransientDirectory: result((purpose) => mutate(async () => {
      if (!PURPOSES.has(purpose)) fail("denied");
      await checkRoot(transient, transientInfo);
      const path = await mkdtemp(join(transient, `markdstage-${purpose}-`));
      const info = await lstat(path);
      const handle = randomUUID();
      transients.set(handle, { path, info, busy: false });
      return handle;
    })),
    removeTransientDirectory: result((handle) => mutate(async () => {
      const entry = await ownedTransient(handle);
      if (entry.busy) fail("denied");
      await rm(entry.path, { recursive: true, force: false });
      transients.delete(handle);
    })),
    launchBrowser: result((options) => mutate(async () => {
      const { url, profile, mode, windowSize = { width: 1280, height: 720 } } = optionsObject(options);
      let parsed;
      try { parsed = new URL(url); } catch { fail("denied"); }
      if (typeof url !== "string" || parsed.protocol !== "http:" ||
          !["127.0.0.1", "[::1]", "localhost"].includes(parsed.hostname) ||
          parsed.username || parsed.password || !["app", "automation"].includes(mode) ||
          !windowSize || !Number.isInteger(windowSize.width) || !Number.isInteger(windowSize.height) ||
          windowSize.width < 1 || windowSize.height < 1 || windowSize.width > 8192 || windowSize.height > 8192) fail("denied");
      const entry = await ownedTransient(profile);
      if (entry.busy) fail("denied");
      const executable = findChromiumBrowser();
      if (!executable) fail("io_failed", "No installed Chromium-based browser was found.");
      const args = [
        "--no-first-run", "--no-default-browser-check", "--disable-extensions",
        "--disable-background-networking", "--disable-component-update",
        `--user-data-dir=${entry.path}`, `--window-size=${windowSize.width},${windowSize.height}`,
      ];
      if (mode === "app") args.push(`--app=${parsed.href}`);
      else args.push("--headless=new", "--disable-gpu", "--force-color-profile=srgb",
        "--force-device-scale-factor=1", "--hide-scrollbars", "--disable-default-apps",
        "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", parsed.href);
      const portPath = join(entry.path, "DevToolsActivePort");
      await unlink(portPath).catch((error) => { if (error.code !== "ENOENT") throw error; });
      const child = spawn(executable, args, {
        shell: false, detached: process.platform !== "win32", windowsHide: true, stdio: "ignore",
      });
      entry.busy = true;
      let processError = false;
      child.on("error", () => { processError = true; });
      try {
        await new Promise((resolve, reject) => {
          child.once("spawn", resolve);
          child.once("error", reject);
        });
        const handle = randomUUID();
        let debuggerEndpoint;
        if (mode === "automation") {
          const deadline = Date.now() + 10_000;
          while (Date.now() < deadline) {
            if (processError || child.exitCode !== null || child.signalCode !== null) fail("io_failed");
            await ownedTransient(profile);
            let portFile;
            try {
              const info = await lstat(portPath);
              if (info.isSymbolicLink() || !info.isFile() || info.size > 1024) fail("denied");
              portFile = await open(portPath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
              const bytes = Buffer.alloc(1025);
              const { bytesRead } = await portFile.read(bytes, 0, bytes.length, 0);
              if (bytesRead > 1024) fail("denied");
              const [port, endpoint] = bytes.subarray(0, bytesRead).toString("utf8").trim().split(/\r?\n/);
              if (/^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535 &&
                  /^\/devtools\/browser\/[a-z0-9-]+$/i.test(endpoint)) {
                debuggerEndpoint = `ws://127.0.0.1:${Number(port)}${endpoint}`;
                break;
              }
            } catch (error) {
              if (error.code !== "ENOENT") throw error;
            } finally {
              await portFile?.close();
            }
            await delay(25);
          }
          if (!debuggerEndpoint) fail("io_failed", "Browser automation did not become ready. Browser policy may disable remote debugging.");
        }
        browsers.set(handle, { child, profile });
        return debuggerEndpoint ? { handle, debuggerEndpoint } : { handle };
      } catch (error) {
        await terminateProcessTree(child);
        entry.busy = false;
        throw error;
      }
    })),
    closeBrowser: result((handle) => mutate(async () => {
      const browser = browsers.get(handle);
      if (!browser) fail("denied");
      await terminateProcessTree(browser.child);
      if (browser.child.exitCode === null && browser.child.signalCode === null && browser.child.pid) fail("io_failed");
      const profile = transients.get(browser.profile);
      if (profile) profile.busy = false;
      browsers.delete(handle);
    })),
  });
}
