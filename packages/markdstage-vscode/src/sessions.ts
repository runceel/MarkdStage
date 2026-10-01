import type { SpawnOptionsWithoutStdio } from "node:child_process";
import {
  BoundedLineParser,
  parseArchitectureEditorEvent,
  parseReadyEvent,
} from "./jsonLines.js";
import { spawnProcess, terminateProcess, type SpawnProcess, type SpawnedProcess } from "./process.js";
import type { ReadyEvent } from "./types.js";

export interface StartSessionOptions {
  executable: string;
  operation: "preview" | "present";
  file: string;
  workspace: string;
  version: string;
  timeoutMs?: number;
  spawn?: SpawnProcess;
  onStderr?: (text: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  onArchitectureEditor?: (url: string) => void;
}

export class PreviewSessions {
  private readonly processes = new Map<string, SpawnedProcess>();

  async start(options: StartSessionOptions): Promise<ReadyEvent> {
    const key = `${options.workspace}\0${options.file}\0${options.operation}`;
    const previous = this.processes.get(key);
    if (previous) await terminateProcess(previous);

    const spawn = options.spawn ?? spawnProcess;
    const process = spawn(
      options.executable,
      [
        options.operation,
        options.file,
        "--workspace",
        options.workspace,
        "--watch",
        "--no-open",
        "--json-lines",
        "--architecture-editor-target",
        "host",
      ],
      { cwd: options.workspace, env: globalThis.process.env } as SpawnOptionsWithoutStdio,
    );
    this.processes.set(key, process);
    process.once("exit", (code, signal) => {
      if (this.processes.get(key) === process) this.processes.delete(key);
      options.onExit?.(code, signal);
    });

    let stderr = "";
    process.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      if (Buffer.byteLength(stderr) < 64 * 1024) stderr += text;
      options.onStderr?.(text);
    });

    try {
      return await new Promise<ReadyEvent>((resolve, reject) => {
        let settled = false;
        let readyUrl = "";
        const finish = (action: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          action();
        };
        const parser = new BoundedLineParser((line) => {
          try {
            const event = parseReadyEvent(line, options.version, options.operation);
            if (event) {
              readyUrl = event.url;
              finish(() => resolve(event));
              return;
            }
            if (!readyUrl) return;
            const editor = parseArchitectureEditorEvent(line, options.version, readyUrl);
            if (editor) options.onArchitectureEditor?.(editor.url);
          } catch (error) {
            finish(() => reject(error));
          }
        });
        process.stdout.on("data", (chunk: Buffer | string) => {
          try {
            parser.push(chunk);
          } catch (error) {
            finish(() => reject(error));
          }
        });
        process.once("error", (error) => finish(() => reject(error)));
        process.once("exit", (code) => finish(() => reject(
          new Error(stderr.trim() || `MarkdStage ${options.operation} exited before it was ready (${code ?? "signal"}).`),
        )));
        const timer = setTimeout(
          () => finish(() => reject(new Error(`MarkdStage ${options.operation} did not become ready in time.`))),
          options.timeoutMs ?? 60_000,
        );
      });
    } catch (error) {
      await terminateProcess(process);
      if (this.processes.get(key) === process) this.processes.delete(key);
      throw error;
    }
  }

  async stopAll(): Promise<number> {
    const running = [...this.processes.values()];
    this.processes.clear();
    await Promise.all(running.map((process) => terminateProcess(process)));
    return running.length;
  }
}
