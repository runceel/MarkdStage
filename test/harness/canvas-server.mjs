import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { delimiter, dirname } from "node:path";
import { chromium } from "@playwright/test";

// Only the Copilot registration transport is stubbed. Open, file access,
// routing, validation and export run the actual Canvas Extension entry point.
export async function startCanvasServer(workspace, sourcePath = "cards.md") {
  const sessionId = `card-host-test-${randomUUID()}`;
  const sdk = `
    export class CanvasError extends Error {}
    export const createCanvas = (declaration) => ({ declaration });
    export async function joinSession(config) {
      globalThis.canvasConfig = config;
      return { log: async () => {} };
    }
  `;
  const script = `
    import { registerHooks } from "node:module";
    import { rm } from "node:fs/promises";
    import { join } from "node:path";
    import { tmpdir } from "node:os";
    registerHooks({ resolve(specifier, context, next) {
      return specifier === "@github/copilot-sdk/extension"
        ? { url: ${JSON.stringify(`data:text/javascript,${encodeURIComponent(sdk)}`)}, shortCircuit: true }
        : next(specifier, context);
    } });
    try {
      await import(${JSON.stringify(new URL("../../.github/extensions/markdstage/extension.mjs", import.meta.url).href)});
      const canvas = globalThis.canvasConfig.canvases[0].declaration;
      const ctx = { sessionId: ${JSON.stringify(sessionId)}, instanceId: "cards",
        extensionId: "test:canonical", session: { workingDirectory: ${JSON.stringify(workspace)} },
        input: { sourcePath: ${JSON.stringify(sourcePath)}, sourceMode: "snapshot" } };
      process.on("message", async (message) => {
        if (message !== "close") return;
        try {
          await canvas.onClose(ctx);
          await rm(join(tmpdir(), "markdstage-canvas", ${JSON.stringify(`${sessionId}__cards.json`)}), { force: true });
          process.disconnect();
        } catch (error) { process.send({ error: error.stack }); process.exitCode = 1; process.disconnect(); }
      });
      process.send({ ready: await canvas.open(ctx) });
    } catch (error) { process.send({ error: error.stack }); process.exitCode = 1; process.disconnect(); }
  `;
  // Let production PATH discovery find the installed test browser in containers
  // without a system Chrome/Edge, without replacing the browser or export adapter.
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
  env[pathKey] = [dirname(chromium.executablePath()), env[pathKey]].filter(Boolean).join(delimiter);
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
    env,
    windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let logs = "";
  child.stdout.on("data", (data) => { logs = (logs + data).slice(-16000); });
  child.stderr.on("data", (data) => { logs = (logs + data).slice(-16000); });
  const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
  try {
    const ready = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Canvas host startup timed out: ${logs}`)), 30_000);
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Canvas host exited ${code}: ${logs}`)); });
      child.once("message", (message) => {
        clearTimeout(timeout);
        if (message.error) reject(new Error(message.error));
        else resolve(message.ready);
      });
    });
    return {
      ...ready,
      async close() {
        if (child.connected) child.send("close");
        const timeout = setTimeout(() => child.kill(), 15_000);
        try {
          const code = await exited;
          if (code !== 0) throw new Error(`Canvas host cleanup exited ${code}: ${logs}`);
        } finally { clearTimeout(timeout); }
      },
    };
  } catch (error) {
    if (child.connected) child.send("close");
    else child.kill();
    throw error;
  }
}
