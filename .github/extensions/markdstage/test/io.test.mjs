import assert from "node:assert/strict";
import test from "node:test";
import { MarkdStageError } from "../runtime/errors.mjs";
import { IO_LIMITS, IO_OPERATIONS, getIO, installIO, isWorkspacePath, unwrapIOResult } from "../runtime/io.mjs";
import { createHostIO } from "../runtime/io-host.mjs";

const ok = (value) => ({ ok: true, value });
const failure = (code) => ({ ok: false, code, message: "EACCES /private/secret C:\\private\\secret errno -13" });
const bridgeWith = (overrides = {}) => Object.assign(
  Object.fromEntries(IO_OPERATIONS.map((operation) => [operation, async () => ok(undefined)])),
  overrides,
);
const info = { kind: "file", size: 12, modifiedAt: 1234.5 };

test("installation is explicit, complete, bound, and captured per caller", async () => {
  assert.throws(() => getIO(), /installed/);
  const first = bridgeWith({ name: "first", readText() { return Promise.resolve(ok(this.name)); } });
  const installed = installIO(first);
  assert.deepEqual(Object.keys(installed), IO_OPERATIONS);
  assert.equal(getIO(), installed);
  assert.equal(Object.isFrozen(first), false);
  first.readText = async () => ok("replacement");
  const { readText } = installed;
  assert.deepEqual(await readText("deck.md"), ok("first"));
  const second = installIO(bridgeWith({ readText: async () => ok("second") }));
  assert.deepEqual(await installed.readText("deck.md"), ok("first"));
  assert.deepEqual(await getIO().readText("deck.md"), ok("second"));
  assert.throws(() => installIO({}), TypeError);
  assert.equal(getIO(), second);
});

test("the operation list and byte limits are fixed", () => {
  assert.equal(IO_OPERATIONS.length, 13);
  assert.equal(new Set(IO_OPERATIONS).size, 13);
  assert.equal(Object.isFrozen(IO_OPERATIONS), true);
  assert.equal(Object.isFrozen(IO_LIMITS), true);
  assert.deepEqual(IO_LIMITS, {
    markdown: 2097152, themeCss: 65536, themeMetadata: 65536,
    themeAsset: 2097152, architectureAsset: 10485760,
  });
});

test("workspace syntax rejects traversal and Windows aliases on every platform", () => {
  for (const path of ["slides.md", "deck/slides.md", "日本語/a b.md", ".hidden/file", "com10.md"]) {
    assert.equal(isWorkspacePath(path), true, path);
  }
  for (const path of [
    "", "/", "/secret", "C:/secret", "C:secret", "//server/share", "\\\\server\\share",
    "\\\\?\\C:\\secret", "\\\\.\\pipe\\secret", "a\\b", "../a", "a/../b",
    "a/./b", ".", "a//b", "a/", "a\u0000b", "a\nb", "file:stream", "a?b",
    "CON", "aux.md", "folder/NUL.txt", "COM1", "lpt9.md", "com¹.txt",
    "CON .txt", "conin$", "conout$", "a.", "a ", "a. /b", undefined, 17,
  ]) assert.equal(isWorkspacePath(path), false, String(path));
  assert.equal(isWorkspacePath("", { allowRoot: true }), true);
  assert.equal(isWorkspacePath("", { allowRoot: "yes" }), false);
  assert.equal(isWorkspacePath("/", { allowRoot: true }), false);
});

function assertMapped(result, context, code) {
  assert.throws(() => unwrapIOResult(result, context), (error) => {
    assert.ok(error instanceof MarkdStageError);
    assert.equal(error.code, code);
    assert.doesNotMatch(error.message, /EACCES|errno|private|C:\\/u);
    return true;
  });
}

test("all port errors map to stable safe runtime errors", () => {
  const expected = {
    denied: "path_outside_workspace", unsupported: "invalid_markdown_path",
    missing: "file_not_found", too_large: "file_too_large", exists: "invalid_output_path",
    conflict: "source_changed", locked: "file_locked", io_failed: "io_failed",
  };
  for (const [port, code] of Object.entries(expected)) {
    assertMapped(failure(port), { operation: "readText", path: "deck.md" }, code);
  }
  for (const operation of ["writeBytes", "replaceText", "makeDirectory"]) {
    assertMapped(failure("denied"), { operation, path: "deck.md" }, "invalid_output_path");
    assertMapped(failure("denied"), { operation, path: "../private" }, "invalid_input");
  }
  assertMapped(failure("denied"), { operation: "stat", path: "" }, "path_outside_workspace");
  assertMapped(failure("denied"), { operation: "readText", path: "" }, "invalid_input");
  assertMapped(failure("denied"), { path: "/private/secret" }, "invalid_input");
  assert.equal(unwrapIOResult(ok("value")), "value");
  assert.equal(unwrapIOResult(ok(undefined)), undefined);
});

test("theme and background error mappings follow the port specification", () => {
  const mappings = {
    theme: {
      denied: "path_outside_workspace", unsupported: "invalid_markdown_path",
      missing: "theme_file_not_found", too_large: "file_too_large",
      exists: "invalid_output_path", conflict: "source_changed", locked: "file_locked",
      io_failed: "io_failed",
    },
    "slide-background": {
      denied: "path_outside_workspace", unsupported: "invalid_markdown_path",
      missing: "file_not_found", too_large: "slide_background_too_large",
      exists: "invalid_output_path", conflict: "source_changed", locked: "file_locked",
      io_failed: "io_failed",
    },
  };
  for (const [kind, expected] of Object.entries(mappings)) {
    for (const [port, code] of Object.entries(expected)) {
      assertMapped(failure(port), { operation: "readBytes", path: "assets/file", kind }, code);
    }
  }
});

test("a locked destination names the output file and explains the recovery", () => {
  assert.throws(
    () => unwrapIOResult(failure("locked"), { operation: "writeBytes", path: "decks/slides.pptx" }),
    (error) => {
      assert.equal(error.code, "file_locked");
      assert.match(error.message, /open in another application/u);
      assert.match(error.message, /\(decks\/slides\.pptx\)$/u);
      return true;
    },
  );
});

test("unwrapping malformed values and hostile getters never exposes host errors", () => {
  for (const value of [
    null, undefined, false, [], {}, { ok: true }, { ok: "true", value: 1 },
    failure("EACCES"), { ok: false, code: "missing" }, { ok: false, code: "constructor", message: "" },
    { get ok() { throw new Error("/private/secret"); } },
    { ok: true, get value() { throw new Error("/private/secret"); } },
  ]) assertMapped(value, { path: "deck.md" }, "io_failed");
});

test("host facade has exactly the port operations and forwards this and arguments", async () => {
  const calls = [];
  const bytes = new Uint8Array([1, 2]);
  const options = { overwrite: true };
  const bridge = bridgeWith({
    writeBytes(...args) { assert.equal(this, bridge); calls.push(args); return ok(args[0]); },
    unrelated() {},
  });
  const host = createHostIO(bridge);
  assert.deepEqual(Object.keys(host), IO_OPERATIONS);
  assert.deepEqual(await host.writeBytes("out/a.bin", bytes, options), ok("out/a.bin"));
  assert.deepEqual(calls, [["out/a.bin", bytes, options]]);
  assert.equal(calls[0][1], bytes);
  assert.equal(calls[0][2], options);
  assert.equal(Object.isFrozen(options), false);
  assert.equal(Object.isFrozen(bridge), false);
  assert.throws(() => createHostIO({}), TypeError);
});

test("host rejects invalid paths before calling the bridge", async () => {
  let called = false;
  const host = createHostIO(bridgeWith(Object.fromEntries(IO_OPERATIONS.map((name) => [
    name, async () => { called = true; return ok(undefined); },
  ]))));
  for (const operation of ["readText", "readBytes", "stat", "list", "writeBytes", "replaceText", "makeDirectory", "watch"]) {
    for (const path of ["../private", "/private", "C:private", "NUL.md"]) {
      assert.equal((await host[operation](path)).code, "denied");
    }
  }
  assert.equal(called, false);
});

test("host sanitizes every failure, rejection, and malformed envelope", async () => {
  for (const code of ["denied", "unsupported", "missing", "too_large", "exists", "conflict", "locked", "io_failed"]) {
    const result = await createHostIO(bridgeWith({ readText: async () => failure(code) })).readText("deck.md");
    assert.equal(result.code, code);
    assert.doesNotMatch(result.message, /private|EACCES|errno/u);
    assert.deepEqual(Object.keys(result), ["ok", "code", "message"]);
  }
  for (const readText of [
    async () => { throw new Error("EACCES /private/secret"); },
    () => { throw new Error("C:\\private\\secret"); },
    async () => failure("EACCES"), async () => failure("constructor"),
    async () => failure({ toString: () => "missing" }),
    async () => undefined, async () => ({ ok: true }),
    async () => ({ get ok() { throw new Error("/private"); } }),
    async () => ({ ok: false, code: "missing", message: 12 }),
  ]) {
    const result = await createHostIO(bridgeWith({ readText })).readText("deck.md");
    assert.equal(result.code, "io_failed");
    assert.doesNotMatch(result.message, /private|EACCES/u);
  }
});

test("host marshals bounded byte arrays and preserves typed-array offsets", async () => {
  for (const bytes of [[0, 255, 128], new Uint8Array([19, 0, 255, 128, 20]).subarray(1, 4)]) {
    const result = await createHostIO(bridgeWith({ readBytes: async () => ok(bytes) })).readBytes("a.bin", 3);
    assert.equal(result.ok, true);
    assert.ok(result.value instanceof Uint8Array);
    assert.deepEqual([...result.value], [0, 255, 128]);
  }
  for (const bytes of [[-1], [256], [1.5], ["1"], [NaN], new Array(1), new Uint16Array([1]), new ArrayBuffer(1)]) {
    const result = await createHostIO(bridgeWith({ readBytes: async () => ok(bytes) })).readBytes("a.bin", 3);
    assert.equal(result.code, "io_failed");
  }
  const host = createHostIO(bridgeWith({ readBytes: async () => ok([1, 2]) }));
  assert.equal((await host.readBytes("a.bin", 1)).code, "too_large");
  assert.deepEqual(
    await createHostIO(bridgeWith({ readBytes: async () => ok([]) })).readBytes("empty.bin", 0),
    ok(new Uint8Array()),
  );
  for (const limit of [-1, NaN, Infinity, "3", 1.5]) {
    assert.equal((await host.readBytes("a.bin", limit)).code, "denied");
  }
  const oversized = new Array(IO_LIMITS.architectureAsset + 1);
  assert.equal((await createHostIO(bridgeWith({ readBytes: async () => ok(oversized) }))
    .readBytes("a.bin", Number.MAX_SAFE_INTEGER)).code, "too_large");
  const hostile = [1, 2];
  hostile[Symbol.iterator] = () => { throw new Error("/private"); };
  assert.deepEqual([...(await createHostIO(bridgeWith({ readBytes: async () => ok(hostile) }))
    .readBytes("a.bin", 2)).value], [1, 2]);
});

test("host checks UTF-8 byte limits and strips a text BOM", async () => {
  const host = createHostIO(bridgeWith({ readText: async () => ok("é") }));
  assert.equal((await host.readText("deck.md", 1)).code, "too_large");
  assert.deepEqual(await host.readText("deck.md", 2), ok("é"));
  assert.deepEqual(
    await createHostIO(bridgeWith({ readText: async () => ok("") })).readText("empty.md", 0),
    ok(""),
  );
  assert.deepEqual(
    await createHostIO(bridgeWith({ readText: async () => ok("\uFEFF# Deck") })).readText("deck.md", 100),
    ok("# Deck"),
  );
  assert.equal((await createHostIO(bridgeWith({ readText: async () => ok(17) })).readText("deck.md")).code, "io_failed");
});

test("host validates stat/list records and strips unrecognized fields", async () => {
  const extra = { ...info, absolutePath: "/private/secret" };
  const host = createHostIO(bridgeWith({
    stat: async () => ok(extra),
    list: async () => ok([{ path: "decks/a.md", ...extra }]),
  }));
  assert.deepEqual(await host.stat("deck.md"), ok(info));
  assert.deepEqual(await host.list("decks", { maxEntries: 1 }), ok([{ path: "decks/a.md", ...info }]));
  assert.equal((await host.list("decks", { maxEntries: 0 })).code, "denied");
  for (const value of [null, {}, { ...info, kind: "symlink" }, { ...info, size: -1 }, { ...info, modifiedAt: Infinity }, { ...info, modifiedAt: "/private" }]) {
    assert.equal((await createHostIO(bridgeWith({ stat: async () => ok(value) })).stat("deck.md")).code, "io_failed");
  }
  for (const path of ["/private/secret", "C:/private", "../private", "other/a.md", "decks/NUL.md"]) {
    assert.equal((await createHostIO(bridgeWith({ list: async () => ok([{ path, ...info }]) })).list("decks")).code, "io_failed");
  }
  const oversized = createHostIO(bridgeWith({ list: async () => ok(new Array(10001)) }));
  assert.equal((await oversized.list("")).code, "io_failed");
  assert.equal((await oversized.list("", { maxEntries: 100000 })).code, "denied");
});

test("successful mutation paths cannot leak absolute or unexpected paths", async () => {
  for (const operation of ["writeBytes", "replaceText", "makeDirectory"]) {
    for (const value of ["/private", "C:/private", "../private", "other.md", {}, undefined]) {
      const host = createHostIO(bridgeWith({ [operation]: async () => ok(value) }));
      const content = operation === "writeBytes" ? new Uint8Array([1]) : "text";
      assert.equal((await host[operation]("deck.md", content)).code, "io_failed");
    }
  }
});

test("opaque handles, void results and browser results are marshalled", async () => {
  const handle = "opaque-identifier_123";
  const host = createHostIO(bridgeWith({
    createTransientDirectory: async () => ok(handle),
    removeTransientDirectory: async (received) => { assert.equal(received, handle); return ok(null); },
    launchBrowser: async () => ok({ handle, debuggerEndpoint: "ws://127.0.0.1:9000/devtools/browser/id", osPath: "/private" }),
  }));
  assert.deepEqual(await host.createTransientDirectory("pdf"), ok(handle));
  assert.deepEqual(await host.removeTransientDirectory(handle), ok(undefined));
  assert.deepEqual(await host.launchBrowser({ url: "http://127.0.0.1", profile: handle, mode: "automation" }),
    ok({ handle, debuggerEndpoint: "ws://127.0.0.1:9000/devtools/browser/id" }));
  for (const value of [null, { handle: "" }, { handle, debuggerEndpoint: "/private" }, { handle, debuggerEndpoint: "file:///private" }]) {
    assert.equal((await createHostIO(bridgeWith({ launchBrowser: async () => ok(value) }))
      .launchBrowser({ url: "http://127.0.0.1", profile: handle, mode: "automation" })).code, "io_failed");
  }
  assert.equal((await createHostIO(bridgeWith({ closeBrowser: async () => ok("/private") })).closeBrowser(handle)).code, "io_failed");
});

test("watch events only expose validated relative paths within the subscription", async () => {
  let emit;
  const events = [];
  const options = { extensions: [".md"] };
  const bridge = bridgeWith({
    watch(path, receivedOptions, callback) {
      assert.equal(this, bridge);
      assert.equal(path, "decks");
      assert.equal(receivedOptions, options);
      emit = callback;
      return ok("watch-opaque");
    },
  });
  const host = createHostIO(bridge);
  assert.deepEqual(await host.watch("decks", options, (event) => events.push(event)), ok("watch-opaque"));
  emit({ path: "decks/a.md", kind: "change", absolutePath: "/private" });
  emit({ path: "decks/b.md", kind: "changed" });
  for (const path of ["/private", "../private", "C:/private", "decks/NUL.md", "elsewhere/a.md"]) {
    emit({ path, kind: "change" });
  }
  emit({ path: "decks/a.md", kind: "/private" });
  emit({ get path() { throw new Error("/private"); } });
  emit(null);
  assert.deepEqual(events, [{ path: "decks/a.md", kind: "change" }, { path: "decks/b.md", kind: "changed" }]);
});

test("browser launch arguments are validated before forwarding", async () => {
  let calls = 0;
  const host = createHostIO(bridgeWith({ launchBrowser: async () => { calls += 1; return ok({ handle: "browser" }); } }));
  const valid = { url: "http://127.0.0.1:3000/", profile: "profile", mode: "app", windowSize: { width: 800, height: 600 } };
  assert.deepEqual(await host.launchBrowser(valid), ok({ handle: "browser" }));
  for (const options of [
    null, {}, { ...valid, url: "file:///private" }, { ...valid, url: "https://external.example" },
    { ...valid, url: "https://localhost/" },
    { ...valid, url: "******localhost/" }, { ...valid, mode: "shell" },
    { ...valid, profile: "" }, { ...valid, profile: 12 }, { ...valid, windowSize: { width: 0, height: 600 } },
    { ...valid, windowSize: { width: 1.5, height: 600 } }, { ...valid, windowSize: null },
    { ...valid, windowSize: { width: 8193, height: 600 } },
    { ...valid, windowSize: { width: 800, height: 8193 } },
  ]) assert.equal((await host.launchBrowser(options)).code, "denied");
  assert.equal(calls, 1);
});

test("handles cannot expose filesystem paths or carry malformed transport values", async () => {
  const browserOptions = { url: "http://localhost/", profile: "profile", mode: "app" };
  for (const handle of ["C:\\secret", "C:secret", "/private/profile", "../profile", "folder/name", "watch:token", "a\nb", "", "a".repeat(257), 12, {}]) {
    const host = createHostIO(bridgeWith({
      watch: async () => ok(handle),
      createTransientDirectory: async () => ok(handle),
      launchBrowser: async () => ok({ handle }),
    }));
    for (const result of [
      await host.watch("", {}, () => {}),
      await host.createTransientDirectory("present"),
      await host.launchBrowser(browserOptions),
    ]) {
      assert.equal(result.code, "io_failed");
      assert.doesNotMatch(result.message, /private|secret/u);
    }
    for (const operation of ["unwatch", "closeBrowser", "removeTransientDirectory"]) {
      assert.equal((await host[operation](handle)).code, "denied");
    }
    assert.equal((await host.launchBrowser({ ...browserOptions, profile: handle })).code, "denied");
  }
});

test("invalid port arguments return denied without crossing the bridge", async () => {
  let calls = 0;
  const host = createHostIO(bridgeWith(Object.fromEntries(IO_OPERATIONS.map((operation) => [
    operation, async () => { calls += 1; return ok(undefined); },
  ]))));
  for (const result of [
    await host.readText("deck.md", -1), await host.readBytes("deck.md", NaN),
    await host.list("", { maxEntries: 0 }), await host.list("", { maxEntries: "1" }),
    await host.writeBytes("deck.md", [1]), await host.replaceText("deck.md", 12),
    await host.watch("", {}, "callback"), await host.createTransientDirectory("invalid"),
  ]) assert.equal(result.code, "denied");
  for (const options of [null, true, 1, "options", []]) {
    for (const result of [
      await host.list("", options), await host.watch("", options, () => {}),
      await host.writeBytes("deck.md", new Uint8Array(), options),
      await host.replaceText("deck.md", "", options),
    ]) assert.equal(result.code, "denied");
  }
  assert.equal(calls, 0);
});

test("bridge getters cannot replace validated paths or errors with private values", async () => {
  let calls = 0;
  const entry = { ...info, get path() { return calls++ === 0 ? "decks/a.md" : "/private"; } };
  const result = await createHostIO(bridgeWith({ list: async () => ok([entry]) })).list("decks");
  assert.deepEqual(result, ok([{ path: "decks/a.md", ...info }]));

  calls = 0;
  const hostileFailure = { ok: false, message: "", get code() { return calls++ === 0 ? "missing" : "/private"; } };
  assertMapped(hostileFailure, { path: "deck.md" }, "file_not_found");
  calls = 0;
  assert.equal((await createHostIO(bridgeWith({ readText: async () => hostileFailure })).readText("deck.md")).code, "missing");
});
