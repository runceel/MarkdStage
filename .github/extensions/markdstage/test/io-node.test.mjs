import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import nativeFs from "node:fs";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createNodeIO } from "../runtime/io-node.mjs";
import { createHostIO } from "../runtime/io-host.mjs";
import { IO_LIMITS, IO_OPERATIONS } from "../runtime/io.mjs";
import { findChromiumBrowser } from "../hosts/node/browser.mjs";

async function fixture(t) {
  const directory = await fs.mkdtemp(join(tmpdir(), ".io-node-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const workspaceRoot = join(directory, "workspace");
  const transientRoot = join(directory, "transient");
  await fs.mkdir(workspaceRoot);
  await fs.mkdir(transientRoot);
  const io = await createNodeIO({ workspaceRoot, transientRoot });
  return { io, directory, workspaceRoot, transientRoot };
}

function value(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}

function code(result, expected) {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.code, expected);
  assert.equal(typeof result.message, "string");
}

async function waitFor(predicate) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("Timed out waiting for a workspace change");
}

async function withFsMock(t, name, implementation, action) {
  t.mock.method(fs, name, implementation);
  syncBuiltinESMExports();
  try {
    return await action();
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
}

test("factory validates configuration and exposes only the thirteen operations", async (t) => {
  const { io, workspaceRoot, transientRoot } = await fixture(t);
  assert.deepEqual(Object.keys(io).sort(), [...IO_OPERATIONS].sort());
  assert.equal(Object.isFrozen(io), true);
  assert.equal(JSON.stringify(io).includes(workspaceRoot), false);
  for (const workspace of ["relative", "", join(workspaceRoot, "missing")]) {
    await assert.rejects(createNodeIO({ workspaceRoot: workspace, transientRoot }), (error) => {
      assert.equal(error instanceof TypeError, true);
      assert.equal(error.message.includes(workspaceRoot), false);
      return true;
    });
  }
  await fs.writeFile(join(workspaceRoot, "file"), "");
  await assert.rejects(createNodeIO({ workspaceRoot: join(workspaceRoot, "file"), transientRoot }), TypeError);
});

test("all workspace operations reject nonportable and escaping syntax without probing existence", async (t) => {
  const { io, directory, workspaceRoot } = await fixture(t);
  await fs.writeFile(join(directory, "outside.md"), "private");
  const bad = ["../outside.md", "../missing.md", "/existing.md", "/missing.md",
    workspaceRoot, "C:/Windows", "C:drive.md", "\\\\server\\share", "\\\\?\\C:\\file",
    "folder\\file.md", "a/../b", "./file.md", "a//b", "file.md/", "x\0y",
    "file.md:stream", "CON", "trailing.", "trailing "];
  for (const path of bad) {
    const operations = [
      () => io.readText(path), () => io.readBytes(path), () => io.stat(path),
      () => io.list(path), () => io.writeBytes(path, new Uint8Array()),
      () => io.replaceText(path, ""), () => io.makeDirectory(path),
      () => io.watch(path, {}, () => {}),
    ];
    for (const operation of operations) {
      assert.deepEqual(await operation(), { ok: false, code: "denied", message: "The operation is not permitted." }, path);
    }
  }
  code(await io.readText(""), "denied");
  code(await io.writeBytes("", new Uint8Array()), "denied");
  assert.equal(value(await io.stat("")).kind, "directory");
  code(await io.makeDirectory(""), "denied");
  code(await io.stat("missing.md"), "missing");
  assert.deepEqual(await fs.readdir(directory), ["outside.md", "transient", "workspace"]);
});

test("invalid option containers and unowned handles consistently return denied", async (t) => {
  const { io } = await fixture(t);
  for (const options of [null, false, 1, "options", []]) {
    code(await io.list("", options), "denied");
    code(await io.writeBytes("deck.md", new Uint8Array(), options), "denied");
    code(await io.replaceText("deck.md", "", options), "denied");
    code(await io.watch("", options, () => {}), "denied");
    code(await io.launchBrowser(options), "denied");
  }
  for (const handle of ["", "../path", "/private/profile", "C:\\secret", "x\nx", "x".repeat(257), {}, null, 42]) {
    code(await io.unwatch(handle), "denied");
    code(await io.removeTransientDirectory(handle), "denied");
    code(await io.closeBrowser(handle), "denied");
  }
});

test("in-root and outside symlinks, including parent directory links, are denied", async (t) => {
  const { io, directory, workspaceRoot } = await fixture(t);
  await fs.mkdir(join(workspaceRoot, "real"));
  await fs.writeFile(join(workspaceRoot, "real", "deck.md"), "safe");
  await fs.writeFile(join(directory, "outside.md"), "private");
  try {
    await fs.symlink(join(workspaceRoot, "real"), join(workspaceRoot, "alias"), "junction");
    await fs.symlink(join(workspaceRoot, "real", "deck.md"), join(workspaceRoot, "linked.md"));
    await fs.symlink(join(directory, "outside.md"), join(workspaceRoot, "outside.md"));
  } catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") return t.skip("Symbolic links require host permission");
    throw error;
  }
  for (const path of ["alias/deck.md", "linked.md", "outside.md"]) {
    code(await io.readBytes(path), "denied");
    code(await io.stat(path), "denied");
    code(await io.writeBytes(path, new Uint8Array(), { overwrite: true }), "denied");
    code(await io.replaceText(path, "changed"), "denied");
  }
  code(await io.makeDirectory("alias/new/nested"), "denied");
  code(await io.writeBytes("alias/new.md", new Uint8Array()), "denied");
  code(await io.list("", { recursive: true }), "denied");
  assert.equal(await fs.readFile(join(directory, "outside.md"), "utf8"), "private");
  assert.equal(await fs.readFile(join(workspaceRoot, "real", "deck.md"), "utf8"), "safe");
});

test("text decoding strips a UTF-8 BOM, bytes remain unchanged, and limits cannot be raised", async (t) => {
  const { io, workspaceRoot } = await fixture(t);
  const bytes = Buffer.from("\uFEFF# 日本語\n");
  await fs.writeFile(join(workspaceRoot, "deck.md"), bytes);
  assert.equal(value(await io.readText("deck.md")), "# 日本語\n");
  assert.deepEqual(value(await io.readBytes("deck.md")), new Uint8Array(bytes));
  assert.equal(value(await io.readBytes("deck.md", bytes.length)).length, bytes.length);
  code(await io.readText("deck.md", bytes.length - 1), "too_large");
  for (const hint of [-1, Infinity, NaN, 1.5, "100", null, Number.MAX_SAFE_INTEGER + 1]) {
    code(await io.readBytes("deck.md", hint), "denied");
  }
  await fs.writeFile(join(workspaceRoot, "empty.md"), "");
  assert.equal(value(await io.readText("empty.md", 0)), "");
  const ceilings = [
    ["large.md", IO_LIMITS.markdown], ["large.markdown", IO_LIMITS.markdown],
    ["large.CSS", IO_LIMITS.themeCss], ["theme.json", IO_LIMITS.themeMetadata],
    ["large.png", IO_LIMITS.themeAsset], ["large.svg", IO_LIMITS.themeAsset],
    ["large.mmd", IO_LIMITS.architectureAsset], ["large.dsl", IO_LIMITS.architectureAsset],
    ["large.json", IO_LIMITS.architectureAsset], ["large.bin", IO_LIMITS.architectureAsset],
  ];
  for (const [name, limit] of ceilings) {
    const file = await fs.open(join(workspaceRoot, name), "w");
    await file.truncate(limit + 1);
    await file.close();
  }
  const originalOpen = fs.open;
  let opens = 0;
  await withFsMock(t, "open", async (...args) => {
    opens++;
    return originalOpen(...args);
  }, async () => {
    for (const [name] of ceilings) code(await io.readBytes(name, Number.MAX_SAFE_INTEGER), "too_large");
  });
  assert.equal(opens, 0, "size ceilings apply before opening for reading");
  await fs.mkdir(join(workspaceRoot, "nested"));
  await fs.writeFile(join(workspaceRoot, "architecture.json"), Buffer.alloc(IO_LIMITS.themeMetadata + 1));
  assert.equal(value(await io.readBytes("architecture.json")).length, IO_LIMITS.themeMetadata + 1);
  code(await io.readBytes("architecture.json", IO_LIMITS.themeMetadata), "too_large");
  await fs.writeFile(join(workspaceRoot, "nested", "THEME.JSON"), Buffer.alloc(IO_LIMITS.themeMetadata + 1));
  code(await io.readBytes("nested/THEME.JSON", IO_LIMITS.architectureAsset), "too_large");
});

test("a file growing during a read is detected with a bounded allocation", async (t) => {
  const { io, workspaceRoot } = await fixture(t);
  const path = join(workspaceRoot, "growing.md");
  await fs.writeFile(path, "small");
  const originalOpen = fs.open;
  let readCapacity;
  await withFsMock(t, "open", async (...args) => {
    const file = await originalOpen(...args);
    if (args[0] === path) {
      const originalRead = file.read.bind(file);
      file.read = async (buffer, ...rest) => {
        readCapacity = buffer.length;
        await fs.appendFile(path, "more than the permitted bytes");
        return originalRead(buffer, ...rest);
      };
    }
    return file;
  }, async () => code(await io.readBytes("growing.md", 8), "too_large"));
  assert.equal(readCapacity, 9);
});

test("reads reject a file edited or replaced during the read instead of returning torn content", async (t) => {
  const { io, workspaceRoot } = await fixture(t);
  const path = join(workspaceRoot, "changing.md");
  const originalOpen = fs.open;
  for (const replace of [false, true]) {
    await fs.writeFile(path, "original");
    await withFsMock(t, "open", async (...args) => {
      const file = await originalOpen(...args);
      const originalRead = file.read.bind(file);
      let changed = false;
      file.read = async (...readArgs) => {
        const read = await originalRead(...readArgs);
        if (!changed) {
          changed = true;
          if (replace) await fs.unlink(path);
          await fs.writeFile(path, "external");
          const future = new Date(Date.now() + 1000);
          await fs.utimes(path, future, future);
        }
        return read;
      };
      return file;
    }, async () => code(await io.readText("changing.md"), "io_failed"));
  }
});

test("stat and deterministic bounded enumeration expose relative paths and filtered descendants", async (t) => {
  const { io, workspaceRoot } = await fixture(t);
  await fs.mkdir(join(workspaceRoot, "nested"));
  for (const name of ["z.md", "a.md", "other.txt", "nested/b.MD"]) {
    await fs.writeFile(join(workspaceRoot, name), name);
  }
  const metadata = value(await io.stat("a.md"));
  assert.equal(metadata.kind, "file");
  assert.equal(metadata.size, 4);
  assert.equal(Number.isFinite(metadata.modifiedAt), true);
  assert.deepEqual(Object.keys(metadata).sort(), ["kind", "modifiedAt", "size"]);
  const entries = value(await io.list("", { extensions: [".md"], recursive: true, maxEntries: 2 }));
  assert.deepEqual(entries.map((entry) => entry.path), ["a.md", "z.md"]);
  const all = value(await io.list("", { extensions: [".md"], recursive: true }));
  assert.deepEqual(all.map((entry) => entry.path), ["a.md", "z.md", "nested/b.MD"]);
  assert.equal(JSON.stringify(all).includes(workspaceRoot), false);
  for (const maxEntries of [0, -1, 10_001, Infinity, null, 1.1, "4"]) {
    code(await io.list("", { maxEntries }), "denied");
  }
  code(await io.list("", { recursive: "yes" }), "denied");
  code(await io.list("", { extensions: ["/.md"] }), "denied");
  code(await io.list("a.md"), "missing");
  const originalOpendir = fs.opendir;
  let scanned = 0;
  await withFsMock(t, "opendir", async (...args) => {
    if (args[0] !== workspaceRoot) return originalOpendir(...args);
    return {
      async *[Symbol.asyncIterator]() {
        for (let index = 0; index < 20_000; index++) {
          scanned++;
          yield { name: `${index}.txt` };
        }
      },
    };
  }, async () => code(await io.list("", { extensions: [".md"], maxEntries: 1 }), "too_large"));
  assert.equal(scanned, 10_001);
});

test("atomic writes create parents, preserve no-clobber and reject stale replacements", async (t) => {
  const { io, workspaceRoot } = await fixture(t);
  assert.equal(value(await io.writeBytes("nested/deck.md", new TextEncoder().encode("original"))), "nested/deck.md");
  code(await io.writeBytes("nested/deck.md", new Uint8Array()), "exists");
  const original = value(await io.stat("nested/deck.md"));
  code(await io.replaceText("nested/deck.md", "wrong", { expectedModifiedAt: original.modifiedAt - 1 }), "conflict");
  assert.equal(value(await io.replaceText("nested/deck.md", "new", { expectedModifiedAt: original.modifiedAt })), "nested/deck.md");
  assert.equal(value(await io.readText("nested/deck.md")), "new");
  value(await io.writeBytes("nested/deck.md", new TextEncoder().encode("overwritten"), { overwrite: true }));
  assert.equal(value(await io.readText("nested/deck.md")), "overwritten");
  code(await io.replaceText("missing.md", "new"), "missing");
  code(await io.replaceText("nested/deck.md", "new", { expectedModifiedAt: NaN }), "denied");
  code(await io.writeBytes("invalid.md", "not bytes"), "denied");
  code(await io.writeBytes("invalid.md", new Uint8Array(), { overwrite: "yes" }), "denied");
  assert.deepEqual(await fs.readdir(join(workspaceRoot, "nested")), ["deck.md"]);
});

test("writeBytes snapshots caller bytes synchronously before enqueuing the mutation", async (t) => {
  const { io } = await fixture(t);
  const bytes = new TextEncoder().encode("original");
  const pending = io.writeBytes("snapshot.md", bytes);
  bytes.fill(0);
  value(await pending);
  assert.equal(value(await io.readText("snapshot.md")), "original");
});

test("no-clobber remains safe when another writer creates the destination at commit time", async (t) => {
  const { io, workspaceRoot } = await fixture(t);
  const originalLink = fs.link;
  await withFsMock(t, "link", async (source, destination) => {
    await fs.writeFile(destination, "external");
    return originalLink(source, destination);
  }, async () => code(await io.writeBytes("race.md", new TextEncoder().encode("ours")), "exists"));
  assert.equal(await fs.readFile(join(workspaceRoot, "race.md"), "utf8"), "external");
  assert.deepEqual(await fs.readdir(workspaceRoot), ["race.md"]);
});

test("replacement rechecks identity and metadata after staging and cleans up on conflict", async (t) => {
  const { io, workspaceRoot } = await fixture(t);
  const target = join(workspaceRoot, "race.md");
  await fs.writeFile(target, "initial");
  const expectedModifiedAt = value(await io.stat("race.md")).modifiedAt;
  const originalOpen = fs.open;
  await withFsMock(t, "open", async (...args) => {
    const file = await originalOpen(...args);
    if (String(args[0]).endsWith(".tmp")) {
      const originalSync = file.sync.bind(file);
      file.sync = async () => {
        await originalSync();
        await fs.unlink(target);
        await fs.writeFile(target, "external edit");
      };
    }
    return file;
  }, async () => code(await io.replaceText("race.md", "ours", { expectedModifiedAt }), "conflict"));
  assert.equal(await fs.readFile(target, "utf8"), "external edit");
  assert.deepEqual(await fs.readdir(workspaceRoot), ["race.md"]);
});

test("staging and commit failures return scrubbed errors and leave no temporary siblings", async (t) => {
  const { io, workspaceRoot } = await fixture(t);
  const originalOpen = fs.open;
  await withFsMock(t, "open", async (...args) => {
    const file = await originalOpen(...args);
    file.sync = async () => { throw new Error(`EIO secret ${workspaceRoot}`); };
    return file;
  }, async () => {
    const failed = await io.writeBytes("failed.md", new Uint8Array([1]));
    code(failed, "io_failed");
    assert.equal(JSON.stringify(failed).includes(workspaceRoot), false);
    assert.equal(failed.message.includes("EIO"), false);
  });
  assert.deepEqual(await fs.readdir(workspaceRoot), []);
  await withFsMock(t, "rename", async () => { throw new Error("private host details"); },
    async () => code(await io.writeBytes("failed.md", new Uint8Array([1]), { overwrite: true }), "io_failed"));
  assert.deepEqual(await fs.readdir(workspaceRoot), []);
});

test("watch events are relative, filtered, resilient to replacement, and stop after unwatch", async (t) => {
  const { io, workspaceRoot, transientRoot } = await fixture(t);
  const another = await createNodeIO({ workspaceRoot, transientRoot });
  await fs.writeFile(join(workspaceRoot, "deck.md"), "before");
  const events = [];
  const handle = value(await io.watch("deck.md", { extensions: [".md"] }, (event) => events.push(event)));
  t.after(() => io.unwatch(handle));
  code(await another.unwatch(handle), "denied");
  code(await io.unwatch(workspaceRoot), "denied");
  await fs.writeFile(join(workspaceRoot, "other.md"), "ignored");
  value(await io.replaceText("deck.md", "after"));
  await waitFor(() => events.some((event) => event.path === "deck.md" && event.kind === "changed"));
  await fs.unlink(join(workspaceRoot, "deck.md"));
  await waitFor(() => events.some((event) => event.kind === "deleted"));
  await fs.writeFile(join(workspaceRoot, "deck.md"), "created");
  await waitFor(() => events.some((event) => event.kind === "created"));
  assert.equal(events.every((event) => event.path === "deck.md"), true);
  value(await io.unwatch(handle));
  const count = events.length;
  await fs.writeFile(join(workspaceRoot, "deck.md"), "unobserved");
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(events.length, count);
  code(await io.unwatch(handle), "denied");
});

test("directory watchers filter extensions and contain callback failures", async (t) => {
  const { io, workspaceRoot } = await fixture(t);
  const events = [];
  const handle = value(await io.watch("", { extensions: [".md"] }, (event) => {
    events.push(event);
    throw new Error("consumer failure");
  }));
  t.after(() => io.unwatch(handle));
  await fs.writeFile(join(workspaceRoot, "ignored.txt"), "ignored");
  await fs.writeFile(join(workspaceRoot, "new.md"), "new");
  await waitFor(() => events.length === 1);
  assert.deepEqual(events, [{ path: "new.md", kind: "created" }]);
  await fs.writeFile(join(workspaceRoot, "new.md"), "changed");
  await waitFor(() => events.some((event) => event.kind === "changed"));
  value(await io.unwatch(handle));
  code(await io.watch("", {}, null), "denied");
});

test("directory watchers include confined nested Markdown changes", async (t) => {
  const { io, workspaceRoot } = await fixture(t);
  await fs.mkdir(join(workspaceRoot, "nested"));
  await fs.writeFile(join(workspaceRoot, "nested", "deck.md"), "before");
  const events = [];
  const handle = value(await io.watch("", { extensions: [".md"] }, (event) => events.push(event)));
  t.after(() => io.unwatch(handle));
  await fs.writeFile(join(workspaceRoot, "nested", "deck.md"), "after");
  await waitFor(() => events.some((event) => event.path === "nested/deck.md" && event.kind === "changed"));
  await fs.writeFile(join(workspaceRoot, "nested", "new.md"), "created");
  await waitFor(() => events.some((event) => event.path === "nested/new.md" && event.kind === "created"));
  await fs.unlink(join(workspaceRoot, "nested", "deck.md"));
  await waitFor(() => events.some((event) => event.path === "nested/deck.md" && event.kind === "deleted"));
  assert.equal(events.every((event) => !event.path.includes(workspaceRoot) && !event.path.includes("\\")), true);
  value(await io.unwatch(handle));
});

test("watcher errors close the subscription without escaping as exceptions", async (t) => {
  const { io } = await fixture(t);
  const watcher = new EventEmitter();
  let closed = false;
  watcher.close = () => { closed = true; };
  t.mock.method(nativeFs, "watch", () => watcher);
  syncBuiltinESMExports();
  try {
    const handle = value(await io.watch("", {}, () => assert.fail("Unexpected change")));
    assert.doesNotThrow(() => watcher.emit("error", new Error("private OS details")));
    assert.equal(closed, true);
    code(await io.unwatch(handle), "denied");
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("transient directories use owned opaque handles and never sweep another session", async (t) => {
  const { io, workspaceRoot, transientRoot } = await fixture(t);
  const another = await createNodeIO({ workspaceRoot, transientRoot });
  const stale = join(transientRoot, "markdstage-present-other-session");
  await fs.mkdir(stale);
  await fs.utimes(stale, new Date(0), new Date(0));
  await createNodeIO({ workspaceRoot, transientRoot });
  assert.equal((await fs.stat(stale)).isDirectory(), true);
  code(await io.createTransientDirectory("../outside"), "denied");
  const handle = value(await io.createTransientDirectory("inspect"));
  assert.equal(handle.includes(transientRoot), false);
  const names = (await fs.readdir(transientRoot)).filter((name) => name !== "markdstage-present-other-session");
  assert.equal(names.length, 1);
  assert.match(names[0], /^markdstage-inspect-[a-z0-9]+$/i);
  await fs.writeFile(join(transientRoot, names[0], "result"), "result");
  code(await another.removeTransientDirectory(handle), "denied");
  code(await io.removeTransientDirectory(join(transientRoot, names[0])), "denied");
  code(await io.removeTransientDirectory("markdstage-present-other-session"), "denied");
  value(await io.removeTransientDirectory(handle));
  code(await io.removeTransientDirectory(handle), "denied");
  assert.deepEqual(await fs.readdir(transientRoot), ["markdstage-present-other-session"]);
});

test("replaced workspace roots and transient directories are not trusted", async (t) => {
  const { io, workspaceRoot, transientRoot } = await fixture(t);
  const handle = value(await io.createTransientDirectory("capture"));
  const [name] = await fs.readdir(transientRoot);
  const original = join(transientRoot, name);
  await fs.rename(original, `${original}-moved`);
  await fs.mkdir(original);
  await fs.writeFile(join(original, "unowned"), "preserve");
  code(await io.removeTransientDirectory(handle), "denied");
  assert.equal(await fs.readFile(join(original, "unowned"), "utf8"), "preserve");
  await fs.rename(workspaceRoot, `${workspaceRoot}-moved`);
  await fs.mkdir(workspaceRoot);
  await fs.writeFile(join(workspaceRoot, "deck.md"), "unowned");
  code(await io.readText("deck.md"), "denied");
  code(await io.writeBytes("deck.md", new Uint8Array(), { overwrite: true }), "denied");
  assert.equal(await fs.readFile(join(workspaceRoot, "deck.md"), "utf8"), "unowned");
});

test("browser inputs reject external URLs, argument injection and unowned profile/process handles", async (t) => {
  const { io, workspaceRoot, transientRoot } = await fixture(t);
  const another = await createNodeIO({ workspaceRoot, transientRoot });
  const profile = value(await io.createTransientDirectory("present"));
  for (const url of ["https://example.com", "file:///private", "javascript:alert(1)",
    "http://127.0.0.1.example.com", "******127.0.0.1:8080", "--no-sandbox"]) {
    code(await io.launchBrowser({ url, profile, mode: "app" }), "denied");
  }
  const valid = { url: "http://127.0.0.1:8080/view", profile, mode: "app" };
  code(await another.launchBrowser(valid), "denied");
  code(await io.launchBrowser({ ...valid, profile: workspaceRoot }), "denied");
  code(await io.launchBrowser({ ...valid, mode: "--disable-web-security" }), "denied");
  code(await io.launchBrowser({ ...valid, windowSize: { width: "1280,--no-sandbox", height: 720 } }), "denied");
  code(await io.launchBrowser({ ...valid, windowSize: { width: 100_000, height: 720 } }), "denied");
  code(await io.closeBrowser(profile), "denied");
  code(await io.closeBrowser(process.pid), "denied");
  value(await io.removeTransientDirectory(profile));
  code(await io.launchBrowser(valid), "denied");
});

test("browser absence is a scrubbed io_failed result without launching a process", async (t) => {
  const { io } = await fixture(t);
  const profile = value(await io.createTransientDirectory("present"));
  t.mock.method(nativeFs, "existsSync", () => false);
  t.mock.method(childProcess, "execFileSync", () => { throw new Error("private discovery error"); });
  t.mock.method(childProcess, "spawn", () => assert.fail("A missing browser must not be spawned"));
  syncBuiltinESMExports();
  try {
    const failed = await io.launchBrowser({ url: "http://127.0.0.1:8080", profile, mode: "app" });
    code(failed, "io_failed");
    assert.match(failed.message, /No installed Chromium-based browser/);
    value(await io.removeTransientDirectory(profile));
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("browser argv, debugger endpoints, and lifetime stay bound to owned opaque handles", async (t) => {
  const { io, workspaceRoot, transientRoot } = await fixture(t);
  const another = await createNodeIO({ workspaceRoot, transientRoot });
  const launches = [];
  t.mock.method(nativeFs, "existsSync", () => true);
  t.mock.method(childProcess, "spawn", (executable, args, options) => {
    launches.push({ executable, args, options });
    const child = Object.assign(new EventEmitter(), { pid: 0, exitCode: null, signalCode: null });
    if (args.includes("--remote-debugging-port=0")) {
      const profilePath = args.find((arg) => arg.startsWith("--user-data-dir=")).slice("--user-data-dir=".length);
      nativeFs.writeFileSync(join(profilePath, "DevToolsActivePort"), "43210\n/devtools/browser/test-123\n");
    }
    queueMicrotask(() => child.emit("spawn"));
    return child;
  });
  syncBuiltinESMExports();
  try {
    for (const mode of ["app", "automation"]) {
      const profile = value(await io.createTransientDirectory(mode === "app" ? "present" : "capture"));
      const options = { url: "http://127.0.0.1:8080/view?x=1", profile, mode, windowSize: { width: 1600, height: 900 } };
      const launched = value(await io.launchBrowser(options));
      const invocation = launches.at(-1);
      assert.equal(invocation.options.shell, false);
      assert.equal(invocation.args.includes("--window-size=1600,900"), true);
      assert.equal(invocation.args.includes("--disable-web-security"), false);
      assert.equal(invocation.args.includes("--no-sandbox"), false);
      if (mode === "app") {
        assert.equal(invocation.args.includes(`--app=${options.url}`), true);
        assert.equal(launched.debuggerEndpoint, undefined);
      } else {
        assert.equal(invocation.args.includes("--remote-debugging-address=127.0.0.1"), true);
        assert.equal(invocation.args.includes("--headless=new"), true);
        assert.equal(invocation.args.includes(options.url), true);
        assert.equal(launched.debuggerEndpoint, "ws://127.0.0.1:43210/devtools/browser/test-123");
      }
      assert.equal(JSON.stringify(launched).includes(transientRoot), false);
      code(await io.removeTransientDirectory(profile), "denied");
      code(await io.launchBrowser(options), "denied");
      code(await another.closeBrowser(launched.handle), "denied");
      value(await io.closeBrowser(launched.handle));
      code(await io.closeBrowser(launched.handle), "denied");
      value(await io.removeTransientDirectory(profile));
    }
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.equal(launches.length, 2);
});

test("host-to-Node roundtrip preserves workspace, watch, and transient result contracts", async (t) => {
  const { io: nodeIO, workspaceRoot, transientRoot } = await fixture(t);
  const io = createHostIO(nodeIO);
  assert.equal(value(await io.makeDirectory("nested")), "nested");
  const bytes = new TextEncoder().encode("\uFEFF# Initial\n");
  assert.equal(value(await io.writeBytes("nested/deck.md", bytes)), "nested/deck.md");
  assert.deepEqual(value(await io.readBytes("nested/deck.md")), bytes);
  assert.equal(value(await io.readText("nested/deck.md")), "# Initial\n");
  const info = value(await io.stat("nested/deck.md"));
  assert.equal(info.kind, "file");
  assert.equal(info.size, bytes.length);
  assert.equal(Number.isFinite(info.modifiedAt), true);
  assert.equal(value(await io.stat("")).kind, "directory");
  const listed = value(await io.list("", { recursive: true, extensions: [".md"], maxEntries: 10 }));
  assert.deepEqual(listed, [{ path: "nested/deck.md", ...info }]);
  const events = [];
  const watchHandle = value(await io.watch("", { extensions: [".md"] }, (event) => events.push(event)));
  t.after(() => io.unwatch(watchHandle));
  assert.equal(value(await io.replaceText("nested/deck.md", "# Changed\n", { expectedModifiedAt: info.modifiedAt })), "nested/deck.md");
  await waitFor(() => events.some((event) => event.path === "nested/deck.md" && event.kind === "changed"));
  assert.equal(value(await io.readText("nested/deck.md")), "# Changed\n");
  value(await io.unwatch(watchHandle));
  const profile = value(await io.createTransientDirectory("inspect"));
  assert.match(profile, /^[A-Za-z0-9_-]{1,256}$/);
  assert.equal((await fs.readdir(transientRoot)).length, 1);
  value(await io.removeTransientDirectory(profile));
  assert.deepEqual(await fs.readdir(transientRoot), []);
  code(await io.readText("../missing.md"), "denied");
  code(await io.makeDirectory(""), "denied");
  assert.equal(JSON.stringify({ listed, events }).includes(workspaceRoot), false);
});

test("installed browser automation starts and closes without weakening the sandbox", async (t) => {
  if (process.env.MARKDSTAGE_TEST_REAL_BROWSER !== "1") {
    return t.skip("Set MARKDSTAGE_TEST_REAL_BROWSER=1 to opt into installed-browser automation.");
  }
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    return t.skip("Chromium sandbox cannot run as root; the adapter intentionally does not add --no-sandbox.");
  }
  const executable = findChromiumBrowser();
  if (!executable) return t.skip("No installed Chromium-based browser is available.");
  if (process.platform === "linux") {
    const browserDirectory = dirname(await fs.realpath(executable));
    for (const name of ["msedge-sandbox", "chrome-sandbox"]) {
      const sandbox = await fs.stat(join(browserDirectory, name)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
        return null;
      });
      if (sandbox && (sandbox.uid !== 0 || (sandbox.mode & 0o4755) !== 0o4755)) {
        return t.skip("Installed Chromium SUID sandbox helper lacks root ownership or mode 4755; sandbox remains enabled.");
      }
    }
  }
  const { io, transientRoot } = await fixture(t);
  const profile = value(await io.createTransientDirectory("inspect"));
  let browser;
  try {
    browser = value(await io.launchBrowser({ url: "http://127.0.0.1:1", profile, mode: "automation" }));
    const endpoint = new URL(browser.debuggerEndpoint);
    const response = await fetch(`http://${endpoint.host}/json/version`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.ok, true);
    assert.equal((await response.json()).webSocketDebuggerUrl, browser.debuggerEndpoint);
  } finally {
    if (browser) value(await io.closeBrowser(browser.handle));
    value(await io.removeTransientDirectory(profile));
  }
  assert.deepEqual(await fs.readdir(transientRoot), []);
});
