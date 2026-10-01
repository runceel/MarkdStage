import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { discoverCli, probeCli } from "../src/cli.js";
import type { SpawnProcess, SpawnedProcess } from "../src/process.js";

function fakeProcess(stdoutText: string, stderrText = "", exitCode = 0): SpawnedProcess {
  const events = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const process = Object.assign(events, {
    pid: 123,
    stdout,
    stderr,
    exitCode: null as number | null,
    kill: () => true,
  }) as SpawnedProcess;
  queueMicrotask(() => {
    stdout.end(stdoutText);
    stderr.end(stderrText);
    Object.defineProperty(process, "exitCode", { value: exitCode, configurable: true });
    events.emit("exit", exitCode, null);
  });
  return process;
}

test("probeCli accepts an exact semantic product version", async () => {
  const spawn: SpawnProcess = () => fakeProcess("4.3.1\n");
  assert.deepEqual(await probeCli("custom", "4.3.1", undefined, spawn), {
    executable: "custom",
    version: "4.3.1",
  });
});

test("probeCli rejects incompatible versions", async () => {
  const spawn: SpawnProcess = () => fakeProcess("4.2.0\n");
  await assert.rejects(() => probeCli("custom", "4.3.1", undefined, spawn), /incompatible/);
});

test("discoverCli uses configured path before PATH", async () => {
  const calls: string[] = [];
  const spawn: SpawnProcess = (executable) => {
    calls.push(executable);
    return fakeProcess("4.3.1\n");
  };
  await discoverCli({ configuredPath: "C:\\Tools\\markdstage.exe", expectedVersion: "4.3.1", spawn });
  assert.deepEqual(calls, ["C:\\Tools\\markdstage.exe"]);
});

test("discoverCli falls back to PATH after a configured path fails", async () => {
  const calls: string[] = [];
  const spawn: SpawnProcess = (executable) => {
    calls.push(executable);
    return fakeProcess(executable === "markdstage" ? "4.3.1\n" : "", "not found", executable === "markdstage" ? 0 : 1);
  };
  const result = await discoverCli({
    configuredPath: "C:\\Missing\\markdstage.exe",
    expectedVersion: "4.3.1",
    spawn,
  });
  assert.equal(result.executable, "markdstage");
  assert.deepEqual(calls, ["C:\\Missing\\markdstage.exe", "markdstage"]);
});
