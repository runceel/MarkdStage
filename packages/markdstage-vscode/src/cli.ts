import type { SpawnOptionsWithoutStdio } from "node:child_process";
import { collectProcess, spawnProcess, type SpawnProcess } from "./process.js";
import type { CliInfo, JsonProcessResult } from "./types.js";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const JSON_LIMIT = 4 * 1024 * 1024;

export interface CliVersionRequirement {
  /** The extension's own product version. */
  expectedVersion: string;
  /** The oldest CLI version whose arguments and JSON Lines protocol the extension supports. */
  minimumVersion?: string;
}

export interface CliDiscoveryOptions extends CliVersionRequirement {
  configuredPath?: string;
  cwd?: string;
  spawn?: SpawnProcess;
}

interface ParsedVersion {
  core: [number, number, number];
  prerelease: string[];
}

function parseVersion(version: string): ParsedVersion | undefined {
  const match = SEMVER.exec(version);
  if (!match) return undefined;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareIdentifiers(a: string, b: string): number {
  const numericA = /^\d+$/.test(a);
  const numericB = /^\d+$/.test(b);
  if (numericA && numericB) return Math.sign(Number(a) - Number(b));
  if (numericA !== numericB) return numericA ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareParsed(a: ParsedVersion, b: ParsedVersion): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = a.core[index] - b.core[index];
    if (difference !== 0) return Math.sign(difference);
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    if (index >= a.prerelease.length) return -1;
    if (index >= b.prerelease.length) return 1;
    const difference = compareIdentifiers(a.prerelease[index], b.prerelease[index]);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Compares two semantic versions using SemVer precedence. Build metadata is ignored. */
export function compareVersions(a: string, b: string): number {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);
  if (!parsedA || !parsedB) throw new Error(`Invalid semantic version: ${parsedA ? b : a}.`);
  return compareParsed(parsedA, parsedB);
}

/**
 * Checks a CLI version against the extension's compatibility range.
 * Returns a warning for an older but compatible CLI and throws for an incompatible one.
 */
export function checkCliVersion(version: string, requirement: CliVersionRequirement): string | undefined {
  const { expectedVersion } = requirement;
  const minimumVersion = requirement.minimumVersion ?? expectedVersion;
  const cli = parseVersion(version);
  const expected = parseVersion(expectedVersion);
  const minimum = parseVersion(minimumVersion);
  if (!cli) throw new Error(`MarkdStage CLI returned an invalid semantic version: ${version}.`);
  if (!expected) throw new Error(`The extension version ${expectedVersion} is not a semantic version.`);
  if (!minimum || compareParsed(minimum, expected) > 0) {
    throw new Error(`The extension minimum CLI version ${minimumVersion} is invalid.`);
  }
  if (compareParsed(cli, minimum) < 0) {
    throw new Error(
      `MarkdStage CLI ${version} is incompatible with extension ${expectedVersion}. ` +
        `Install or update MarkdStage CLI ${expectedVersion} (minimum ${minimumVersion}).`,
    );
  }
  if (cli.core[0] > expected.core[0]) {
    throw new Error(
      `MarkdStage CLI ${version} is incompatible with extension ${expectedVersion}. ` +
        `Update the MarkdStage VS Code extension to ${version}.`,
    );
  }
  if (compareParsed(cli, expected) < 0) {
    return `MarkdStage CLI ${version} is outdated. Updating to ${expectedVersion} is recommended.`;
  }
  return undefined;
}

export async function probeCli(
  executable: string,
  requirement: CliVersionRequirement,
  cwd: string | undefined,
  spawn: SpawnProcess = spawnProcess,
): Promise<CliInfo> {
  const child = spawn(executable, ["--version"], { cwd, env: process.env } as SpawnOptionsWithoutStdio);
  const result = await collectProcess(child, { stdoutBytes: 16 * 1024, stderrBytes: 16 * 1024 });
  const version = result.stdout.trim();
  if (result.exitCode !== 0 || !SEMVER.test(version)) {
    throw new Error(result.stderr.trim() || `${executable} did not return a semantic version.`);
  }
  const warning = checkCliVersion(version, requirement);
  return warning ? { executable, version, warning } : { executable, version };
}

export async function discoverCli(options: CliDiscoveryOptions): Promise<CliInfo> {
  const configured = options.configuredPath?.trim();
  const candidates = configured ? [configured, "markdstage"] : ["markdstage"];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await probeCli(
        candidate,
        { expectedVersion: options.expectedVersion, minimumVersion: options.minimumVersion },
        options.cwd,
        options.spawn,
      );
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
