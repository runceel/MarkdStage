import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";
import {
  BoundedLineParser,
  parseArchitectureEditorEvent,
  parseExportEvent,
  parseReadyEvent,
} from "../src/jsonLines.js";

test("bounded parser handles split lines", () => {
  const lines: string[] = [];
  const parser = new BoundedLineParser((line) => lines.push(line));
  parser.push('{"type":"rea');
  parser.push('dy"}\n');
  assert.deepEqual(lines, ['{"type":"ready"}']);
});

test("bounded parser rejects oversized lines", () => {
  const parser = new BoundedLineParser(() => {}, 8);
  assert.throws(() => parser.push("123456789"), /oversized/);
});

test("ready event requires exact version and loopback URL", () => {
  const event = parseReadyEvent(JSON.stringify({
    type: "ready",
    url: "http://127.0.0.1:4321/",
    operation: "preview",
    workspace: "C:\\repo",
    sourceMode: "live",
    version: "4.3.1",
  }), "4.3.1");
  assert.equal(event?.operation, "preview");
  assert.equal(parseReadyEvent(JSON.stringify({ ...event, version: "4.2.0" }), "4.3.1"), undefined);
  assert.equal(parseReadyEvent(JSON.stringify(event), "4.3.1", "present"), undefined);
  assert.throws(() => parseReadyEvent(JSON.stringify({ ...event, url: "https://example.com/" }), "4.3.1"), /loopback/);
  assert.throws(() => parseReadyEvent(JSON.stringify({ ok: false, message: "Deck is invalid." }), "4.3.1"), /Deck is invalid/);
});

test("Architecture Editor events require exact version and loopback URL", () => {
  assert.equal(
    parseArchitectureEditorEvent(JSON.stringify({
      type: "architecture-editor",
      previewUrl: "http://127.0.0.1:4321/token/",
      url: "http://127.0.0.1:4567/editor/",
      version: "4.3.1",
    }), "4.3.1", "http://127.0.0.1:4321/token/?presenter=1")?.url,
    "http://127.0.0.1:4567/editor/",
  );
  assert.equal(
    parseArchitectureEditorEvent(JSON.stringify({
      type: "architecture-editor",
      previewUrl: "http://127.0.0.1:4321/token/",
      url: "http://127.0.0.1:4567/editor/",
      version: "4.3.0",
    }), "4.3.1", "http://127.0.0.1:4321/token/"),
    undefined,
  );
  assert.throws(
    () => parseArchitectureEditorEvent(JSON.stringify({
      type: "architecture-editor",
      previewUrl: "http://127.0.0.1:4321/token/",
      url: "https://example.com/editor/",
      version: "4.3.1",
    }), "4.3.1", "http://127.0.0.1:4321/token/"),
    /loopback/,
  );
  assert.throws(
    () => parseArchitectureEditorEvent(JSON.stringify({
      type: "architecture-editor",
      previewUrl: "http://127.0.0.1:4321/other/",
      url: "http://127.0.0.1:4567/editor/",
      version: "4.3.1",
    }), "4.3.1", "http://127.0.0.1:4321/token/"),
    /another preview session/,
  );
});

test("export events require the owned preview, exact version, and a workspace path", () => {
  const preview = "http://127.0.0.1:4321/token/?presenter=1";
  const parse = (event: Record<string, unknown>) => parseExportEvent(
    JSON.stringify({
      type: "export",
      previewUrl: "http://127.0.0.1:4321/token/",
      format: "pdf",
      path: "C:\\repo\\decks\\slides.pdf",
      version: "4.4.1",
      ...event,
    }),
    "4.4.1",
    preview,
    "C:\\repo",
    path.win32,
  );
  assert.equal(parse({})?.path, "C:\\repo\\decks\\slides.pdf");
  assert.equal(parse({ format: "pptx", path: "C:\\repo\\slides.pptx" })?.format, "pptx");
  assert.equal(parse({ version: "4.4.0" }), undefined);
  assert.equal(parse({ format: "docx" }), undefined);
  assert.throws(() => parse({ previewUrl: "http://127.0.0.1:9999/token/" }), /another preview/);
  assert.throws(() => parse({ path: "C:\\other\\slides.pdf" }), /outside the workspace/);
  assert.throws(() => parse({ path: "C:\\repo\\..\\slides.pdf" }), /outside the workspace/);
  assert.throws(() => parse({ path: "decks\\slides.pdf" }), /outside the workspace/);
  assert.throws(() => parse({ path: "C:\\repo\\slides.pptx" }), /outside the workspace/);
});
