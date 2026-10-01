import { spawn, type SpawnOptionsWithoutStdio } from "node:child_process";

export interface SpawnedProcess {
  readonly pid?: number;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  readonly exitCode: number | null;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export type SpawnProcess = (
  executable: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => SpawnedProcess;

export const spawnProcess: SpawnProcess = (executable, args, options) =>
  spawn(executable, [...args], {
    ...options,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }) as SpawnedProcess;

export async function terminateProcess(child: SpawnedProcess, platform = globalThis.process.platform): Promise<void> {
  if (child.exitCode !== null) return;
  if (platform === "win32" && child.pid) {
    const taskkill = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
    await new Promise<void>((resolve) => {
      taskkill.once("exit", () => resolve());
      taskkill.once("error", () => {
        child.kill("SIGTERM");
        resolve();
      });
    });
    return;
  }
  child.kill("SIGTERM");
}

export async function collectProcess(
  process: SpawnedProcess,
  limits: { stdoutBytes: number; stderrBytes: number },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let overflow: Error | undefined;

  const collect = (chunks: Buffer[], limit: number, current: () => number, update: (size: number) => void) =>
    (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const next = current() + buffer.byteLength;
      if (next > limit) {
        overflow ??= new Error("MarkdStage CLI output exceeded the extension safety limit.");
        void terminateProcess(process);
        return;
      }
      update(next);
      chunks.push(buffer);
    };

  process.stdout.on("data", collect(stdout, limits.stdoutBytes, () => stdoutBytes, (size) => { stdoutBytes = size; }));
  process.stderr.on("data", collect(stderr, limits.stderrBytes, () => stderrBytes, (size) => { stderrBytes = size; }));

  const exitCode = await new Promise<number>((resolve, reject) => {
    process.once("error", reject);
    process.once("exit", (code) => resolve(code ?? 4));
  });
  if (overflow) throw overflow;
  return {
    exitCode,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
}
