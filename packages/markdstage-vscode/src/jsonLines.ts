import type { ArchitectureEditorEvent, ReadyEvent } from "./types.js";

export const MAX_READY_LINE_BYTES = 64 * 1024;

export class BoundedLineParser {
  private pending = Buffer.alloc(0);

  constructor(
    private readonly onLine: (line: string) => void,
    private readonly maxLineBytes = MAX_READY_LINE_BYTES,
  ) {}

  push(chunk: Buffer | string): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.pending = Buffer.concat([this.pending, buffer]);
    if (this.pending.byteLength > this.maxLineBytes && !this.pending.includes(0x0a)) {
      throw new Error("MarkdStage CLI emitted an oversized JSON line.");
    }
    let newline = this.pending.indexOf(0x0a);
    while (newline >= 0) {
      if (newline > this.maxLineBytes) throw new Error("MarkdStage CLI emitted an oversized JSON line.");
      const line = this.pending.subarray(0, newline).toString("utf8").replace(/\r$/, "");
      this.pending = this.pending.subarray(newline + 1);
      if (line) this.onLine(line);
      newline = this.pending.indexOf(0x0a);
    }
  }
}

export function parseReadyEvent(
  line: string,
  expectedVersion: string,
  expectedOperation?: "preview" | "present",
): ReadyEvent | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const event = value as Record<string, unknown>;
  if (event.ok === false && typeof event.message === "string") {
    throw new Error(event.message);
  }
  if (
    event.type !== "ready" ||
    (event.operation !== "preview" && event.operation !== "present") ||
    (expectedOperation !== undefined && event.operation !== expectedOperation) ||
    typeof event.url !== "string" ||
    typeof event.workspace !== "string" ||
    (event.sourceMode !== "live" && event.sourceMode !== "snapshot") ||
    event.version !== expectedVersion
  ) {
    return undefined;
  }
  const url = new URL(event.url);
  const host = url.hostname.toLowerCase();
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    (host !== "localhost" && host !== "127.0.0.1" && host !== "::1" && host !== "[::1]")
  ) {
    throw new Error("MarkdStage CLI returned a non-loopback preview URL.");
  }
  return event as unknown as ReadyEvent;
}

export function parseArchitectureEditorEvent(
  line: string,
  expectedVersion: string,
  expectedPreviewUrl: string,
): ArchitectureEditorEvent | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const event = value as Record<string, unknown>;
  if (
    event.type !== "architecture-editor" ||
    typeof event.previewUrl !== "string" ||
    typeof event.url !== "string" ||
    event.version !== expectedVersion
  ) {
    return undefined;
  }
  const url = new URL(event.url);
  const host = url.hostname.toLowerCase();
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    (host !== "localhost" && host !== "127.0.0.1" && host !== "::1" && host !== "[::1]")
  ) {
    throw new Error("MarkdStage CLI returned a non-loopback Architecture Editor URL.");
  }
  const previewUrl = new URL(event.previewUrl);
  const expectedUrl = new URL(expectedPreviewUrl);
  if (
    previewUrl.origin !== expectedUrl.origin ||
    previewUrl.pathname !== expectedUrl.pathname
  ) {
    throw new Error("MarkdStage CLI returned an Architecture Editor event for another preview session.");
  }
  return event as unknown as ArchitectureEditorEvent;
}
