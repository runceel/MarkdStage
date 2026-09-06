// Deck lifecycle, page parsing, and presentation-server security.

import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request as httpRequest } from "node:http";

import { parsePageList, withDeckServer } from "../src/deck.mjs";
import { createDeckSession, MarkdStageError } from "../src/runtime.mjs";

const DECK = [
  "---",
  "deck: Server test",
  "---",
  "# One",
  "",
  "---",
  "",
  "---",
  "---",
  "## Two",
  "",
].join("\n");

async function withWorkspace(run) {
  const dir = await mkdtemp(join(tmpdir(), "markdstage-deck-test-"));
  const file = join(dir, "slides.md");
  await writeFile(file, DECK, "utf8");
  try {
    return await run({ dir, file });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function post(baseUrl, route, body = {}) {
  return fetch(new URL(route, baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: new URL(baseUrl).origin,
    },
    body: JSON.stringify(body),
  });
}

async function waitFor(check, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("Condition was not met before the timeout.");
}

test("parsePageList understands lists and ranges", () => {
  assert.deepEqual(parsePageList("2,4"), [1, 3]);
  assert.deepEqual(parsePageList("2-4"), [1, 2, 3]);
  assert.deepEqual(parsePageList("3, 1 , 3"), [0, 2]);
  assert.throws(() => parsePageList("0"), RangeError);
  assert.throws(() => parsePageList("a"), RangeError);
  assert.throws(() => parsePageList("4-2"), RangeError);
  assert.throws(() => parsePageList(""), RangeError);
  assert.throws(() => parsePageList("9", { total: 3 }), RangeError);
});

test("createDeckSession confines the deck to the workspace", async () => {
  await withWorkspace(async ({ dir }) => {
    await assert.rejects(
      createDeckSession({ file: join(dir, "..", "outside.md"), workspaceRoot: dir }),
      (error) => error instanceof MarkdStageError,
    );
  });

  test("createDeckSession can start empty and open a source later", async () => {
    await withWorkspace(async ({ dir, file }) => {
      const session = await createDeckSession({ workspaceRoot: dir });
      assert.equal(session.file, "");
      assert.equal(session.sourceName, "");
      assert.deepEqual(session.slides, []);

      await session.openFile(file);
      assert.equal(session.sourceName, "slides.md");
      assert.ok(session.slides.length >= 2);
    });
  });

  test("application mode exposes the empty UI and imports a live source", async () => {
    await withWorkspace(async ({ dir, file }) => {
      const presenter = {
        isRunning: () => false,
        open: async () => ({ alreadyRunning: false }),
        close: async () => ({ stopped: true }),
      };
      await withDeckServer(
        {
          workspace: dir,
          application: true,
          presenter,
        },
        async (session, server) => {
          const empty = await fetch(new URL("state", server.url)).then((response) =>
            response.json(),
          );
          assert.equal(empty.total, 0);
          assert.equal(empty.markdownImportAvailable, true);
          assert.equal(empty.sourceBacked, false);
          assert.equal(empty.sourceModeAvailable, false);
          assert.equal(empty.pdfExportAvailable, false);
          assert.equal(empty.presenterViewAvailable, true);
          assert.equal((await post(server.url, "export")).status, 409);
          assert.equal((await post(server.url, "present")).status, 409);

          const imported = await post(server.url, "import", {
            path: "slides.md",
            sourceMode: "live",
          });
          assert.equal(imported.status, 200);
          assert.equal((await imported.json()).sourceMode, "live");
          assert.equal(session.file, file);

          const loaded = await fetch(new URL("state", server.url)).then((response) =>
            response.json(),
          );
          assert.equal(loaded.sourceBacked, true);
          assert.equal(loaded.sourceModeAvailable, true);
          assert.equal(loaded.sourceMode, "live");
          assert.equal(loaded.sourceWatchStatus, "watching");
          assert.equal(loaded.architectureEditAvailable, true);
          assert.equal(loaded.pdfExportAvailable, true);
          assert.equal(loaded.pptxExportAvailable, true);
        },
      );
    });
  });

  test("application source mode can stop and restart automatic refresh", async () => {
    await withWorkspace(async ({ dir, file }) => {
      await withDeckServer(
        {
          file,
          workspace: dir,
          application: true,
          initialSourceMode: "live",
        },
        async (session, server) => {
          assert.equal(session.slides.length, 3);

          const snapshot = await post(server.url, "source-mode", { mode: "snapshot" });
          assert.equal(snapshot.status, 200);
          assert.equal((await snapshot.json()).sourceWatchStatus, "inactive");

          await writeFile(file, `${DECK}\n---\n\n---\n### Snapshot only\n`, "utf8");
          await new Promise((resolve) => setTimeout(resolve, 250));
          assert.equal(session.slides.length, 3);

          const live = await post(server.url, "source-mode", { mode: "live" });
          assert.equal(live.status, 200);
          assert.equal((await live.json()).sourceWatchStatus, "watching");
          await waitFor(() => session.slides.length > 3);
          const liveTotal = session.slides.length;

          await writeFile(
            file,
            `${DECK}\n---\n\n---\n### Live reload\n\n---\n\n### Another slide\n`,
            "utf8",
          );
          await waitFor(() => session.slides.length > liveTotal);
        },
      );
    });
  });

  test("initial live mode catches a save made while the watcher starts", async () => {
    await withWorkspace(async ({ dir, file }) => {
      await withDeckServer(
        {
          file,
          workspace: dir,
          application: true,
          initialSourceMode: "live",
          watcherFactory: ({ path }) => {
            writeFileSync(path, `${DECK}\n---\n\n---\n### Startup save\n`, "utf8");
            return { close() {} };
          },
        },
        async (session) => {
          assert.match(session.sourceMarkdown, /Startup save/);
          assert.ok(session.slides.length > 3);
        },
      );
    });
  });

  test("watcher startup failure keeps an imported deck in live error state", async () => {
    await withWorkspace(async ({ dir }) => {
      await withDeckServer(
        {
          workspace: dir,
          application: true,
          watcherFactory: () => {
            throw new Error("watch unavailable");
          },
        },
        async (session, server) => {
          const imported = await post(server.url, "import", {
            path: "slides.md",
            sourceMode: "live",
          });
          assert.equal(imported.status, 200);
          const result = await imported.json();
          assert.equal(result.ok, true);
          assert.equal(result.sourceMode, "live");
          assert.equal(result.sourceWatchStatus, "error");
          assert.equal(session.sourceName, "slides.md");
          assert.ok(session.slides.length > 0);
        },
      );
    });
  });

  test("live refresh follows the Markdown file selected in the application", async () => {
    await withWorkspace(async ({ dir, file }) => {
      const second = join(dir, "second.md");
      await writeFile(second, "# Second source\n", "utf8");
      await withDeckServer(
        {
          file,
          workspace: dir,
          application: true,
          initialSourceMode: "live",
        },
        async (session, server) => {
          const imported = await post(server.url, "import", {
            path: "second.md",
            sourceMode: "live",
          });
          assert.equal(imported.status, 200);
          assert.equal(session.sourceName, "second.md");
          const importedTotal = session.slides.length;

          await writeFile(file, `${DECK}\n---\n\n---\n### Old source changed\n`, "utf8");
          await new Promise((resolve) => setTimeout(resolve, 250));
          assert.equal(session.sourceName, "second.md");
          assert.equal(session.slides.length, importedTotal);

          await writeFile(second, "# Second source\n\n---\n\n## Reloaded\n", "utf8");
          await waitFor(() => session.slides.length > importedTotal);
        },
      );
    });
  });

  test("import waits for an in-flight live reload before switching sources", async () => {
    await withWorkspace(async ({ dir, file }) => {
      const second = join(dir, "second.md");
      await writeFile(second, "# Second source\n", "utf8");
      await withDeckServer(
        {
          file,
          workspace: dir,
          application: true,
          initialSourceMode: "live",
        },
        async (session, server) => {
          const originalLoad = session.load;
          let releaseReload;
          let announceReload;
          const reloadStarted = new Promise((resolve) => {
            announceReload = resolve;
          });
          const reloadReleased = new Promise((resolve) => {
            releaseReload = resolve;
          });
          let blockNextReload = true;
          session.load = async (options) => {
            if (blockNextReload) {
              blockNextReload = false;
              announceReload();
              await reloadReleased;
            }
            return originalLoad(options);
          };

          await writeFile(file, `${DECK}\n\n<!-- reload -->\n`, "utf8");
          await reloadStarted;
          const importing = post(server.url, "import", {
            path: "second.md",
            sourceMode: "live",
          });
          await new Promise((resolve) => setTimeout(resolve, 50));
          assert.equal(session.sourceName, "slides.md");

          releaseReload();
          assert.equal((await importing).status, 200);
          assert.equal(session.sourceName, "second.md");
          assert.match(session.sourceMarkdown, /Second source/);
        },
      );
    });
  });

  test("application export routes use workspace-safe default names", async () => {
    await withWorkspace(async ({ dir, file }) => {
      const calls = [];
      await withDeckServer(
        {
          file,
          workspace: dir,
          application: true,
          exporters: {
            pdf: async (_session, output, theme) => {
              calls.push({ format: "pdf", output, theme });
              return { ok: true, path: output };
            },
            pptx: async (_session, output, theme) => {
              calls.push({ format: "pptx", output, theme });
              return { ok: true, path: output };
            },
          },
        },
        async (_session, server) => {
          assert.equal((await post(server.url, "export")).status, 200);
          assert.equal((await post(server.url, "export-pptx")).status, 200);
        },
      );
      assert.deepEqual(calls, [
        { format: "pdf", output: "slides.pdf", theme: "dark" },
        { format: "pptx", output: "slides.pptx", theme: "dark" },
      ]);
    });
  });
});

test("the presentation server serves the deck only below its token", async () => {
  await withWorkspace(async ({ dir, file }) => {
    await withDeckServer({ file, workspace: dir }, async (session, server) => {
      assert.ok(session.slides.length >= 2);
      assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{16,}\/$/);

      const shell = await fetch(server.url);
      assert.equal(shell.status, 200);
      assert.match(shell.headers.get("content-type") ?? "", /text\/html/);

      const state = await fetch(new URL("state", server.url));
      assert.equal(state.status, 200);
      assert.equal(state.headers.get("cache-control"), "no-store");
      const payload = await state.json();
      assert.equal(payload.total, session.slides.length);

      // Without the per-process token nothing is reachable.
      const untokenized = await fetch(new URL("/state", server.url));
      assert.equal(untokenized.status, 404);

      // A wrong token is rejected as well.
      const wrongToken = await fetch(new URL("/not-the-token/state", server.url));
      assert.equal(wrongToken.status, 404);
    });
  });
});

test("mutating routes require a same-origin request", async () => {
  await withWorkspace(async ({ dir, file }) => {
    await withDeckServer({ file, workspace: dir }, async (session, server) => {
      const foreign = await fetch(new URL("navigate", server.url), {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify({ delta: 1 }),
      });
      assert.equal(foreign.status, 403);
      assert.equal(session.index, 0);

      const allowed = await fetch(new URL("navigate", server.url), {
        method: "POST",
        headers: { "content-type": "application/json", origin: new URL(server.url).origin },
        body: JSON.stringify({ delta: 1 }),
      });
      assert.equal(allowed.status, 200);
      assert.equal(session.index, 1);
    });
  });
});

test("requests with a foreign Host header are rejected", async () => {
  await withWorkspace(async ({ dir, file }) => {
    await withDeckServer({ file, workspace: dir }, async (_session, server) => {
      const url = new URL(server.url);
      const status = await new Promise((resolve, reject) => {
        const request = httpRequest(
          {
            host: "127.0.0.1",
            port: url.port,
            path: url.pathname,
            headers: { Host: "markdstage.example" },
          },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        );
        request.on("error", reject);
        request.end();
      });
      assert.equal(status, 403);
      assert.equal((await fetch(url)).status, 200);
    });
  });
});

test("watching reloads the deck and preserves the current slide", async () => {
  await withWorkspace(async ({ dir, file }) => {
    const session = await createDeckSession({ file, workspaceRoot: dir });
    await session.load();
    session.index = 1;
    await writeFile(file, `${DECK}\n---\n\n---\n### Three\n`, "utf8");
    await session.load({ preserveIndex: true });
    assert.equal(session.index, 1);
    assert.ok(session.slides.length >= 3);
  });
});

test("a temporarily invalid watched file keeps the last valid deck", async () => {
  await withWorkspace(async ({ dir, file }) => {
    const session = await createDeckSession({ file, workspaceRoot: dir });
    session.navigate(1);
    const previousSlides = session.slides;
    const previousMarkdown = session.sourceMarkdown;
    const previousVersion = session.version;

    await writeFile(file, "", "utf8");
    await assert.rejects(session.load({ preserveIndex: true }), /has no slides/);
    assert.equal(session.slides, previousSlides);
    assert.equal(session.sourceMarkdown, previousMarkdown);
    assert.equal(session.index, 1);
    assert.equal(session.version, previousVersion);
  });
});
