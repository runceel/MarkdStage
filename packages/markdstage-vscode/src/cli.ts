import type { SpawnOptionsWithoutStdio } from "node:child_process";
import { collectProcess, spawnProcess, type SpawnProcess } from "./process.js";
import type { CliInfo, JsonProcessResult } from "./types.js";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/;
const JSON_LIMIT = 4 * 1024 * 1024;

export interface CliDiscoveryOptions {
  configuredPath?: string;
  expectedVersion: string;
  cwd?: string;
  spawn?: SpawnProcess;
}

export async function probeCli(
  executable: string,
  expectedVersion: string,
  cwd: string | undefined,
  spawn: SpawnProcess = spawnProcess,
): Promise<CliInfo> {
  const child = spawn(executable, ["--version"], { cwd, env: process.env } as SpawnOptionsWithoutStdio);
  const result = await collectProcess(child, { stdoutBytes: 16 * 1024, stderrBytes: 16 * 1024 });
  const version = result.stdout.trim();
  if (result.exitCode !== 0 || !SEMVER.test(version)) {
    throw new Error(result.stderr.trim() || `${executable} did not return a semantic version.`);
  }
  if (version !== expectedVersion) {
    throw new Error(`MarkdStage CLI ${version} is incompatible with extension ${expectedVersion}.`);
  }
  return { executable, version };
}

export async function discoverCli(options: CliDiscoveryOptions): Promise<CliInfo> {
  const configured = options.configuredPath?.trim();
  const candidates = configured ? [configured, "markdstage"] : ["markdstage"];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await probeCli(candidate, options.expectedVersion, options.cwd, options.spawn);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("MarkdStage CLI was not found.");
}

export async function runCliJson<T>(
  executable: string,
  args: readonly string[],
  cwd: string,
  spawn: SpawnProcess = spawnProcess,
): Promise<JsonProcessResult<T>> {
  const child = spawn(executable, args, { cwd, env: process.env } as SpawnOptionsWithoutStdio);
  const result = await collectProcess(child, { stdoutBytes: JSON_LIMIT, stderrBytes: 256 * 1024 });
  let value: T;
  try {
    value = JSON.parse(result.stdout) as T;
  } catch {
    throw new Error(result.stderr.trim() || "MarkdStage CLI returned invalid JSON.");
  }
  return { ...result, value };
}
