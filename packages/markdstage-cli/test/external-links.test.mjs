import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { withDeckServer } from "../src/deck.mjs";
import {
  externalHttpUrl,
  openExternalUrl,
} from "../../../.github/extensions/markdstage/hosts/node/open-external.mjs";

test("OS launcher passes the URL as one argument without invoking a shell", async () => {
  for (const [platform, command] of [
    ["win32", "explorer.exe"], ["darwin", "open"], ["linux", "xdg-open"],
  ]) {
    const calls = [];
    const child = new EventEmitter();
    child.unref = () => { calls.push("unref"); };
    await openExternalUrl("https://example.com/?q=%26", (file, args, options) => {
      calls.push({ file, args, options });
      queueMicrotask(() => child.emit("spawn"));
      return child;
    }, platform);
    assert.deepEqual(calls, [
      {
        file: command,
        args: ["https://example.com/?q=%26"],
        options: { detached: true, stdio: "ignore", windowsHide: true },
      },
      "unref",
    ]);
  }
});

test("OS launcher reports spawn failures", async () => {
  const child = new EventEmitter();
  child.unref = () => assert.fail("failed launch must not detach");
  await assert.rejects(
    openExternalUrl("https://example.com", () => {
      queueMicrotask(() => child.emit("error", new Error("no browser")));
      return child;
    }),
    /no browser/,
  );
});

test("external URL validation rejects local origin, other schemes, credentials, and oversized URLs", () => {
  const origin = "http://127.0.0.1:1234";
  assert.equal(externalHttpUrl("https://example.com/a", origin), "https://example.com/a");
  for (const value of [
    `${origin}/`, "javascript:alert(1)", "file:///etc/passwd",
    "https://user:pass@example.com", "/relative", "https://example.com/" + "a".repeat(2048),
    123,
  ]) {
    assert.equal(externalHttpUrl(value, origin), null);
  }
});

test("token-scoped launch endpoint accepts only same-origin JSON POSTs with external HTTP(S) URLs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "markdstage-external-link-"));
  const file = join(dir, "slides.md");
  await writeFile(file, "# Link\n\n[External](https://example.com/)\n");
  const opened = [];
  try {
    await withDeckServer({
      file, workspace: dir, application: true,
      openExternal: async (url) => { opened.push(url); },
    }, async (_session, server) => {
      const endpoint = new URL("open-external", server.url);
      const origin = endpoint.origin;
      const send = (url, headers = { origin, "content-type": "application/json" }) =>
        fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ url }) });
      const state = await fetch(new URL("state", server.url)).then((response) => response.json());
      assert.equal(state.externalLinkAvailable, true);

      assert.equal((await fetch(endpoint)).status, 405);
      assert.equal((await send("https://example.com/a?x=1")).status, 200);
      assert.deepEqual(opened, ["https://example.com/a?x=1"]);
      assert.equal((await send("https://example.com/b", {
        origin, "content-type": "application/json; charset=utf-8",
      })).status, 200);
      for (const headers of [
        { "content-type": "application/json" },
        { origin: "https://example.com", "content-type": "application/json" },
        { origin, "content-type": "text/plain" },
      ]) {
        assert.equal((await send("https://example.com/", headers)).status, 403);
      }
      for (const url of [origin, "file:///tmp/test", "javascript:alert(1)", "/relative"]) {
        assert.equal((await send(url)).status, 400);
      }
      assert.equal((await fetch(endpoint, {
        method: "POST", headers: { origin, "content-type": "application/json" },
        body: "{",
      })).status, 400);
      assert.equal((await send("https://example.com/")).status, 200);
      assert.deepEqual(opened, [
        "https://example.com/a?x=1",
        "https://example.com/b",
        "https://example.com/",
      ]);
      assert.equal((await fetch(new URL("open-external", origin))).status, 404);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("launch failure is visible as a server error, not a successful link open", async () => {
  const dir = await mkdtemp(join(tmpdir(), "markdstage-external-error-"));
  try {
    await withDeckServer({
      workspace: dir, application: true,
      openExternal: async () => { throw new Error("no browser"); },
    }, async (_session, server) => {
      const endpoint = new URL("open-external", server.url);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { origin: endpoint.origin, "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/" }),
      });
      assert.equal(response.status, 500);
      assert.equal((await response.json()).error, "external_launch_failed");
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
