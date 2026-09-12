import { createHostRuntime } from "../Shared/runtime/host-bootstrap.mjs";
import { createHostIO } from "../Shared/runtime/io-host.mjs";
import { extractSpeakerNotes } from "../Shared/renderer/speaker-notes.mjs";
import { createPortableOutput } from "../Shared/runtime/portable-output.mjs";

const waiting = new Map();
const watches = new Map();
let sequence = 0;
let runtime;
let output;
let settings;

function request(operation, args) {
  const id = String(++sequence);
  const promise = new Promise(resolve => waiting.set(id, resolve));
  chrome.webview.postMessage({ type: "io", id, operation, args });
  return promise;
}

const operations = ["readText", "readBytes", "stat", "list", "writeBytes", "replaceText",
  "makeDirectory", "watch", "unwatch", "createTransientDirectory", "removeTransientDirectory",
  "launchBrowser", "closeBrowser"];
const bridge = Object.fromEntries(operations.map(operation => [operation, async (...args) => {
  const callback = operation === "watch" ? args.pop() : undefined;
  if (operation === "writeBytes") {
    let binary = "";
    for (let offset = 0; offset < args[1].length; offset += 32768)
      binary += String.fromCharCode(...args[1].subarray(offset, offset + 32768));
    args[1] = { base64: btoa(binary) };
  }
  const result = await request(operation, args);
  if (result.ok && operation === "readBytes")
    result.value = Uint8Array.from(atob(result.value.base64), character => character.charCodeAt(0));
  if (result.ok && operation === "watch") watches.set(result.value, callback);
  if (operation === "unwatch") watches.delete(args[0]);
  return result;
}]));

chrome.webview.addEventListener("message", ({ data }) => {
  if (data.type === "io-result") { waiting.get(data.id)?.(data.result); waiting.delete(data.id); }
  else if (data.type === "io-watch") watches.get(data.handle)?.(data.event);
});

function publish(snapshot) {
  chrome.webview.postMessage({
    type: "snapshot",
    value: {
      slides: snapshot.slides, index: snapshot.index, version: snapshot.version,
      deckVersion: snapshot.deckVersion, sourcePath: snapshot.sourceName,
      workspaceRoot: settings.workspace, titles: snapshot.titles,
      notes: snapshot.slides.map(extractSpeakerNotes),
      theme: {
        name: snapshot.theme, css: snapshot.customThemeCss,
        metadataJson: snapshot.customThemeMeta ? JSON.stringify(snapshot.customThemeMeta) : "",
        assetRoot: snapshot.customThemeDir
      }
    }
  });
}

const methods = {
  async initialize(options) {
    settings = options;
    runtime = await createHostRuntime(bridge, {
      theme: options.theme ?? undefined, themeFile: options.themeFile ?? undefined,
      assetUrlPrefix: "theme-assets/"
    });
    runtime.subscribe(publish);
    output = options.baseUrl ? createPortableOutput({
      runtime, io: createHostIO(bridge), baseUrl: options.baseUrl,
      sendCdp: async (handle, method, parameters = {}) => {
        const response = await request("cdp", [handle, method, parameters]);
        if (!response.ok) throw Object.assign(new Error(response.message), { code: response.code });
        return response.value;
      }
    }) : null;
    return { ok: true };
  },
  async load({ path }) { return runtime.loadDeck(path); },
  async state({ offset = 0 }) {
    const snapshot = await runtime.snapshot({ offset });
    return { ...snapshot, sourceModeAvailable: snapshot.sourceBacked, markdownImportAvailable: true,
      presenterViewAvailable: true, presenterWindowAvailable: false, presenterRunning: false,
      pdfExportAvailable: false, pptxExportAvailable: false, architectureEditAvailable: false };
  },
  async deck() {
    const snapshot = await runtime.snapshot();
    return { slides: snapshot.slides, deckVersion: snapshot.deckVersion };
  },
  async navigate({ body }) { return { ok: true, ...(await runtime.navigate(body)) }; },
  async sourceMode({ body }) { return { ok: true, ...(await runtime.setSourceMode(body.mode)) }; },
  async markdownFiles() {
    const entries = await runtime.listMarkdown();
    return { ok: true, files: entries.map(entry => entry.path), current: (await runtime.snapshot()).sourceName,
      truncated: entries.length >= 10000 };
  },
  async import({ body }) {
    await runtime.loadDeck(body.path);
    if (body.sourceMode) await runtime.setSourceMode(body.sourceMode);
    return { ok: true, ...(await runtime.snapshot()) };
  },
  async exportData({ token }) { return output.getData(token); },
  async exportStatus({ token, body }) { return output.reportStatus(token, body); },
  async validate(options) {
    const report = await runtime.validate({
      ...options,
      workspace: settings.workspace,
    });
    return { report, exitCode: report.ok ? 0 : 2, text: JSON.stringify(report, null, 2) };
  },
  async inspect(options) {
    const report = await output.inspect(options);
    return { report, exitCode: options.failOnIssues && report.hasIssues ? 5 : 0, text: JSON.stringify(report, null, 2) };
  },
  async capture(options) {
    const report = await output.capture(options);
    return { report, exitCode: 0, text: JSON.stringify(report, null, 2) };
  },
  async export(options) {
    const pptx = options.output?.toLowerCase().endsWith(".pptx");
    if (options.mermaidImageFallback && !pptx)
      throw Object.assign(new Error("--mermaid-image-fallback requires an explicit .pptx output."), { code: "usage_error" });
    const report = await output[pptx ? "exportPptx" : "exportPdf"](options);
    return { report, exitCode: 0, text: JSON.stringify(report, null, 2) };
  }
};

window.markdstageInvoke = async (id, method, args) => {
  try {
    if (!Object.hasOwn(methods, method)) throw new Error("Unsupported native runtime command.");
    const value = await methods[method](args);
    chrome.webview.postMessage({ type: "result", id, value });
  } catch (error) {
    chrome.webview.postMessage({ type: "result", id, error: {
      code: error.code ?? "unexpected_error", message: error.message ?? String(error)
    } });
  }
};
chrome.webview.postMessage({ type: "ready" });
