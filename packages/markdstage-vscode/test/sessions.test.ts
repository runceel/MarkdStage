import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import type { SpawnProcess, SpawnedProcess } from "../src/process.js";
import { PreviewSessions } from "../src/sessions.js";

type MutableSpawnedProcess = Omit<SpawnedProcess, "exitCode"> & {
  exitCode: number | null;
  emitReady(line: string): void;
  emittedArgs?: readonly string[];
};

function controllableProcess(): MutableSpawnedProcess {
  const events = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child: MutableSpawnedProcess = Object.assign(events, {
    pid: undefined,
    stdout,
    stderr,
    exitCode: null as number | null,
    kill() {
      child.exitCode = 0;
      events.emit("exit", 0, null);
      return true;
    },
    emitReady(line: string) {
      stdout.write(`${line}\n`);
    },
  });
  return child;
}

test("preview session uses the streaming CLI contract and owns cleanup", async () => {
  const child = controllableProcess();
  let args: readonly string[] = [];
  const editorUrls: string[] = [];
  const spawn: SpawnProcess = (_executable, passedArgs) => {
    args = passedArgs;
    return child;
  };
  const sessions = new PreviewSessions();
  const starting = sessions.start({
    executable: "markdstage",
    operation: "preview",
    file: "C:\\repo\\slides.md",
    workspace: "C:\\repo",
    version: "4.3.1",
    spawn,
    onArchitectureEditor: (url) => editorUrls.push(url),
  });
  child.emitReady(JSON.stringify({
    type: "ready",
    url: "http://localhost:4321/",
    operation: "preview",
    workspace: "C:\\repo",
    sourceMode: "live",
    version: "4.3.1",
  }));
  assert.equal((await starting).url, "http://localhost:4321/");
  child.emitReady(JSON.stringify({
    type: "architecture-editor",
    previewUrl: "http://localhost:4321/",
    url: "http://127.0.0.1:5678/editor/",
    version: "4.3.1",
  }));
  assert.deepEqual(editorUrls, ["http://127.0.0.1:5678/editor/"]);
  assert.deepEqual(args, [
    "preview",
    "C:\\repo\\slides.md",
    "--workspace",
    "C:\\repo",
    "--watch",
    "--no-open",
    "--json-lines",
    "--architecture-editor-target",
    "host",
  ]);
  assert.equal(await sessions.stopAll(), 1);
  assert.equal(child.exitCode, 0);
});

test("preview session ignores an untrusted post-ready editor URL", async () => {
  const child = controllableProcess();
  const editorUrls: string[] = [];
  const sessions = new PreviewSessions();
  const starting = sessions.start({
    executable: "markdstage",
    operation: "preview",
    file: "C:\\repo\\slides.md",
    workspace: "C:\\repo",
    version: "4.3.1",
    spawn: () => child,
    onArchitectureEditor: (url) => editorUrls.push(url),
  });
  child.emitReady(JSON.stringify({
    type: "ready", url: "http://localhost:4321/", operation: "preview",
    workspace: "C:\\repo", sourceMode: "live", version: "4.3.1",
  }));
  await starting;
  child.emitReady(JSON.stringify({
    type: "architecture-editor",
    previewUrl: "http://localhost:4321/",
    url: "https://example.com/editor/",
    version: "4.3.1",
  }));
  assert.deepEqual(editorUrls, []);
  await sessions.stopAll();
});

test("starting the same preview replaces the owned process", async () => {
  const first = controllableProcess();
  const second = controllableProcess();
  const children = [first, second];
  const sessions = new PreviewSessions();
  const options = {
    executable: "markdstage",
    operation: "preview" as const,
    file: "C:\\repo\\slides.md",
    workspace: "C:\\repo",
    version: "4.3.1",
    spawn: () => children.shift()!,
  };

  const firstStart = sessions.start(options);
  first.emitReady(JSON.stringify({
    type: "ready", url: "http://localhost:4321/", operation: "preview",
    workspace: "C:\\repo", sourceMode: "live", version: "4.3.1",
  }));
  await firstStart;

  const secondStart = sessions.start(options);
  assert.equal(first.exitCode, 0);
  second.emitReady(JSON.stringify({
    type: "ready", url: "http://localhost:4322/", operation: "preview",
    workspace: "C:\\repo", sourceMode: "live", version: "4.3.1",
  }));
  assert.equal((await secondStart).url, "http://localhost:4322/");
  assert.equal(await sessions.stopAll(), 1);
});

test("preview session rejects non-loopback ready URLs and stops the process", async () => {
  const child = controllableProcess();
  const sessions = new PreviewSessions();
  const starting = sessions.start({
    executable: "markdstage",
    operation: "present",
    file: "C:\\repo\\slides.md",
    workspace: "C:\\repo",
    version: "4.3.1",
    spawn: () => child,
  });
  child.emitReady(JSON.stringify({
    type: "ready",
    url: "https://example.com/",
    operation: "present",
    workspace: "C:\\repo",
    sourceMode: "live",
    version: "4.3.1",
  }));
  await assert.rejects(starting, /loopback/);
  assert.equal(child.exitCode, 0);
});
