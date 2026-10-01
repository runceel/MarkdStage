import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { checkCliVersion, compareVersions, discoverCli, probeCli } from "../src/cli.js";
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

const requirement = { expectedVersion: "4.3.1", minimumVersion: "4.2.0" };

test("probeCli accepts an exact semantic product version without a warning", async () => {
  const spawn: SpawnProcess = () => fakeProcess("4.3.1\n");
  assert.deepEqual(await probeCli("custom", requirement, undefined, spawn), {
    executable: "custom",
    version: "4.3.1",
  });
});

test("probeCli accepts an older compatible CLI with an update warning", async () => {
  const spawn: SpawnProcess = () => fakeProcess("4.2.5\n");
  const info = await probeCli("custom", requirement, undefined, spawn);
  assert.equal(info.version, "4.2.5");
  assert.match(info.warning ?? "", /4\.2\.5 is outdated\. Updating to 4\.3\.1 is recommended\./);
});

test("probeCli rejects a CLI older than the minimum compatible version", async () => {
  const spawn: SpawnProcess = () => fakeProcess("4.1.9\n");
  await assert.rejects(
    () => probeCli("custom", requirement, undefined, spawn),
    /4\.1\.9 is incompatible with extension 4\.3\.1\. Install or update MarkdStage CLI 4\.3\.1 \(minimum 4\.2\.0\)/,
  );
});

test("probeCli defaults the minimum compatible version to the extension version", async () => {
  const spawn: SpawnProcess = () => fakeProcess("4.3.0\n");
  await assert.rejects(() => probeCli("custom", { expectedVersion: "4.3.1" }, undefined, spawn), /incompatible/);
});

test("probeCli rejects invalid semantic versions", async () => {
  const spawn: SpawnProcess = () => fakeProcess("4.3\n");
  await assert.rejects(() => probeCli("custom", requirement, undefined, spawn), /did not return a semantic version/);
});

test("checkCliVersion accepts newer CLIs within the same major version", () => {
  assert.equal(checkCliVersion("4.4.0", requirement), undefined);
  assert.equal(checkCliVersion("4.3.2", requirement), undefined);
});

test("checkCliVersion rejects a newer major CLI", () => {
  assert.throws(() => checkCliVersion("5.0.0", requirement), /incompatible.*Update the MarkdStage VS Code extension/);
});

test("checkCliVersion treats prereleases below their release", () => {
  assert.throws(() => checkCliVersion("4.2.0-beta.1", requirement), /incompatible/);
  assert.match(checkCliVersion("4.3.1-rc.1", requirement) ?? "", /outdated/);
});

test("checkCliVersion rejects a minimum newer than the extension", () => {
  assert.throws(
    () => checkCliVersion("4.3.1", { expectedVersion: "4.3.1", minimumVersion: "4.4.0" }),
    /minimum CLI version 4\.4\.0 is invalid/,
  );
});

test("compareVersions follows SemVer precedence", () => {
  assert.equal(compareVersions("4.3.1", "4.3.1+build.5"), 0);
  assert.equal(compareVersions("4.10.0", "4.9.9"), 1);
  assert.equal(compareVersions("1.0.0-alpha", "1.0.0-alpha.1"), -1);
  assert.equal(compareVersions("1.0.0-alpha.2", "1.0.0-alpha.10"), -1);
  assert.equal(compareVersions("1.0.0-1", "1.0.0-alpha"), -1);
  assert.throws(() => compareVersions("x", "1.0.0"), /Invalid semantic version: x/);
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
