using System.Collections.Concurrent;
using System.Text.Json;
using MarkdStage.Cli;
using MarkdStage.Core;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;

namespace MarkdStageApp.Services;

internal sealed class NativeRuntimeHost(
    WebView2 webView,
    PresentationSession session,
    NativeBrowserHost browserHost) : IAsyncDisposable
{
    private const string Origin = "https://runtime.markdstage.invalid";
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> _pending = new();
    private readonly SemaphoreSlim _commands = new(1, 1);
    private readonly TaskCompletionSource _ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private WorkspaceIoService? _io;
    private bool _disposed;

    public async Task InitializeAsync(CoreWebView2Environment environment, Uri baseUri)
    {
        await webView.EnsureCoreWebView2Async(environment);
        var core = webView.CoreWebView2;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreHostObjectsAllowed = false;
        core.Settings.IsStatusBarEnabled = false;
        core.SetVirtualHostNameToFolderMapping("runtime.markdstage.invalid",
            AppContext.BaseDirectory, CoreWebView2HostResourceAccessKind.DenyCors);
        core.NavigationStarting += (_, args) =>
            args.Cancel = args.Uri != Origin + "/Assets/runtime-host.html";
        core.NewWindowRequested += (_, args) => args.Handled = true;
        core.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
        core.WebMessageReceived += OnMessage;
        core.NavigationCompleted += OnNavigationCompleted;
        core.Navigate(Origin + "/Assets/runtime-host.html");
        await _ready.Task.WaitAsync(TimeSpan.FromSeconds(30));
        await CallAsync(
            "initializeOutput",
            new { baseUrl = baseUri.AbsoluteUri },
            CancellationToken.None);
        session.Navigate = NavigateAsync;
    }

    private async void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs args)
    {
        if (!args.IsSuccess) { _ready.TrySetException(new IOException("Shared runtime could not be loaded.")); return; }
        try { await webView.CoreWebView2.ExecuteScriptAsync(Bootstrap); }
        catch (Exception error) when (error is InvalidOperationException or System.Runtime.InteropServices.COMException)
        { _ready.TrySetException(new IOException("Shared runtime could not be initialized.")); }
    }

    public void BindWorkspace(WorkspaceIoService io)
    {
        if (_io is not null) throw new InvalidOperationException("The runtime workspace cannot change.");
        _io = io;
        io.Changed += OnWorkspaceChange;
    }

    public async Task LoadAsync(string relativePath, string theme, CancellationToken cancellationToken)
    {
        var snapshot = await CallAsync("load", new { path = relativePath, theme }, cancellationToken);
        Apply(snapshot);
    }

    public Task<JsonElement> ExportAsync(
        string format,
        bool mermaidImageFallback,
        CancellationToken cancellationToken)
    {
        if (format is not ("pdf" or "pptx"))
            throw new ArgumentOutOfRangeException(nameof(format));
        var snapshot = session.GetSnapshot();
        if (string.IsNullOrWhiteSpace(snapshot.SourcePath) ||
            string.IsNullOrWhiteSpace(snapshot.WorkspaceRoot))
            throw new DeckLoadException("A source-backed deck is required.", "no_deck");
        var extension = format == "pptx" ? ".pptx" : ".pdf";
        var outputPath = Path.ChangeExtension(snapshot.SourcePath, extension);
        var relativeOutput = Path.GetRelativePath(snapshot.WorkspaceRoot, outputPath).Replace('\\', '/');
        return CallAsync(
            "export",
            new
            {
                output = relativeOutput,
                mermaidImageFallback = format == "pptx" && mermaidImageFallback,
            },
            cancellationToken,
            TimeSpan.FromMinutes(10));
    }

    public Task<JsonElement> GetExportDataAsync(
        string token,
        CancellationToken cancellationToken) =>
        CallAsync(
            "exportData",
            new { token },
            cancellationToken,
            serialize: false);

    public async Task ReportExportStatusAsync(
        string token,
        JsonElement body,
        CancellationToken cancellationToken)
    {
        _ = await CallAsync(
            "exportStatus",
            new { token, body },
            cancellationToken,
            serialize: false);
    }

    private async Task<bool> NavigateAsync(int? index, int? delta)
    {
        try
        {
            var previous = session.GetSnapshot().Version;
            var options = index.HasValue ? (object)new { index = index.Value } : new { delta = delta!.Value };
            Apply(await CallAsync("navigate", options, CancellationToken.None));
            return session.GetSnapshot().Version != previous;
        }
        catch (Exception error) when (error is IOException or InvalidOperationException or OperationCanceledException)
        { return false; }
    }

    private void Apply(JsonElement value)
    {
        var io = _io ?? throw new InvalidOperationException("Choose a workspace first.");
        var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        var snapshot = value.Deserialize<PresentationSnapshot>(options)
            ?? throw new IOException("The shared runtime did not return a snapshot.");
        if (snapshot.Slides is null || snapshot.Theme is null || snapshot.Titles is null || snapshot.Notes is null ||
            snapshot.Slides.Count == 0 || snapshot.Index < 0 || snapshot.Index >= snapshot.Slides.Count ||
            snapshot.Titles.Count != snapshot.Slides.Count || snapshot.Notes.Count != snapshot.Slides.Count ||
            string.IsNullOrEmpty(snapshot.SourcePath))
            throw new IOException("The shared runtime returned an incomplete snapshot.");
        var sourcePath = WorkspaceResolver.ResolveRelative(io.Root, snapshot.SourcePath);
        var assetRoot = snapshot.Theme.Name == "custom"
            ? WorkspaceResolver.ResolveRelative(io.Root, snapshot.Theme.AssetRoot ?? "", true)
            : "";
        session.ApplySnapshot(snapshot with
        {
            SourcePath = sourcePath,
            WorkspaceRoot = io.Root,
            Theme = snapshot.Theme with { AssetRoot = assetRoot },
        });
    }

    private async Task<JsonElement> CallAsync(
        string method,
        object args,
        CancellationToken cancellationToken,
        TimeSpan? timeout = null,
        bool serialize = true)
    {
        if (serialize) await _commands.WaitAsync(cancellationToken);
        var id = Guid.NewGuid().ToString("N");
        var completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[id] = completion;
        try
        {
            var request = JsonSerializer.Serialize(new { type = "runtime:command", id, method, args });
            if (!webView.DispatcherQueue.TryEnqueue(() =>
            {
                if (!_disposed) webView.CoreWebView2.PostWebMessageAsJson(request);
                else completion.TrySetCanceled();
            })) throw new IOException("The runtime window is unavailable.");
            try
            {
                return await completion.Task.WaitAsync(
                    timeout ?? TimeSpan.FromSeconds(30),
                    cancellationToken);
            }
            catch (TimeoutException) { throw new IOException("The shared runtime did not respond."); }
        }
        finally
        {
            _pending.TryRemove(id, out _);
            if (serialize) _commands.Release();
        }
    }

    private async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (_disposed || args.Source != Origin + "/Assets/runtime-host.html") return;
        try
        {
            if (args.WebMessageAsJson.Length > 360 * 1024 * 1024) return;
            using var document = JsonDocument.Parse(args.WebMessageAsJson);
            var message = document.RootElement;
            switch (message.GetProperty("type").GetString())
            {
                case "runtime:ready": _ready.TrySetResult(); break;
                case "runtime:error": _ready.TrySetException(new IOException("Shared runtime could not be initialized.")); break;
                case "runtime:result":
                    if (_pending.TryGetValue(message.GetProperty("id").GetString()!, out var completion))
                    {
                        if (message.GetProperty("ok").GetBoolean())
                            completion.TrySetResult(message.GetProperty("value").Clone());
                        else
                            completion.TrySetException(new DeckLoadException(
                                message.TryGetProperty("message", out var error)
                                    ? error.GetString()!
                                    : "The shared runtime operation failed.",
                                message.TryGetProperty("code", out var code)
                                    ? code.GetString() ?? "runtime_failed"
                                    : "runtime_failed"));
                    }
                    break;
                case "io:request":
                    var id = message.GetProperty("id").GetString();
                    var method = message.GetProperty("method").GetString()!;
                    var parameters = message.GetProperty("args").Clone();
                    object result;
                    if (method == "cdp")
                    {
                        try
                        {
                            result = new
                            {
                                ok = true,
                                value = await browserHost.CommandAsync(
                                    parameters[0].GetString()!,
                                    parameters[1].GetString()!,
                                    parameters[2],
                                    CancellationToken.None),
                            };
                        }
                        catch (Exception error)
                        {
                            result = new
                            {
                                ok = false,
                                code = "rendering_failed",
                                message = error.Message,
                            };
                        }
                    }
                    else
                    {
                        result = _io is null
                            ? new PortResult(false, Code: "denied", Message: "Choose a workspace first.")
                            : await _io.ExecuteAsync(method, parameters);
                    }
                    if (!_disposed)
                        webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "io:result", id, result }));
                    break;
            }
        }
        catch (Exception error) when (error is JsonException or KeyNotFoundException or InvalidOperationException or System.Runtime.InteropServices.COMException) { }
    }

    private void OnWorkspaceChange(object? sender, WorkspaceChange change) =>
        webView.DispatcherQueue.TryEnqueue(() =>
        {
            if (!_disposed)
                webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
                {
                    type = "io:watch", handle = change.Handle,
                    @event = new { path = change.Path, kind = change.Kind },
                }));
        });

    public ValueTask DisposeAsync()
    {
        _disposed = true;
        _ready.TrySetCanceled();
        session.Navigate = null;
        if (_io is not null) _io.Changed -= OnWorkspaceChange;
        foreach (var pending in _pending.Values) pending.TrySetCanceled();
        if (webView.CoreWebView2 is { } core)
        {
            core.WebMessageReceived -= OnMessage;
            core.NavigationCompleted -= OnNavigationCompleted;
        }
        return ValueTask.CompletedTask;
    }

    private const string Bootstrap = """
        (async () => {
          try {
            const waiting = new Map(), watches = new Map();
            let sequence = 0, runtime, output;
            const methods = ["readText","readBytes","stat","list","writeBytes","replaceText",
              "makeDirectory","watch","unwatch","createTransientDirectory","removeTransientDirectory","launchBrowser","closeBrowser"];
            const bridge = Object.fromEntries(methods.map(method => [method, async (...args) => {
              const id = String(++sequence);
              const callback = method === "watch" ? args.pop() : undefined;
              if (method === "writeBytes") {
                let binary = "";
                for (let i = 0; i < args[1].length; i += 32768)
                  binary += String.fromCharCode(...args[1].subarray(i, i + 32768));
                args[1] = { base64: btoa(binary) };
              }
              const promise = new Promise(resolve => waiting.set(id, resolve));
              chrome.webview.postMessage({ type: "io:request", id, method, args });
              const result = await promise;
              if (result.ok && method === "readBytes")
                result.value = Uint8Array.from(atob(result.value.base64), value => value.charCodeAt(0));
              if (result.ok && method === "watch") watches.set(result.value, callback);
              if (method === "unwatch") watches.delete(args[0]);
              return result;
            }]));
            chrome.webview.addEventListener("message", async ({data}) => {
              if (data.type === "io:result") {
                waiting.get(data.id)?.(data.result); waiting.delete(data.id);
              } else if (data.type === "io:watch") {
                watches.get(data.handle)?.(data.event);
              } else if (data.type === "runtime:command") {
                try {
                  let snapshot;
                  if (data.method === "load") {
                    const current = await runtime.snapshot();
                    snapshot = await runtime.loadDeck(data.args.path, {
                      preserveIndex: current.sourceName === data.args.path,
                      theme: data.args.theme || undefined
                    });
                  } else if (data.method === "navigate") snapshot = await runtime.navigate(data.args);
                  else if (data.method === "getSnapshot") snapshot = await runtime.snapshot();
                  else if (data.method === "initializeOutput") {
                    output = createPortableOutput({
                      runtime,
                      io: createHostIO(bridge),
                      baseUrl: data.args.baseUrl,
                      sendCdp: async (handle, method, parameters = {}) => {
                        const id = String(++sequence);
                        const promise = new Promise(resolve => waiting.set(id, resolve));
                        chrome.webview.postMessage({
                          type: "io:request",
                          id,
                          method: "cdp",
                          args: [handle, method, parameters]
                        });
                        const response = await promise;
                        if (!response.ok)
                          throw Object.assign(new Error(response.message), { code: response.code });
                        return response.value;
                      }
                    });
                    chrome.webview.postMessage({
                      type:"runtime:result",id:data.id,ok:true,value:{ok:true}
                    });
                    return;
                  } else if (data.method === "export") {
                    if (!output) throw Object.assign(
                      new Error("The output runtime is unavailable."),
                      { code: "runtime_unavailable" });
                    const pptx = data.args.output?.toLowerCase().endsWith(".pptx");
                    snapshot = await output[pptx ? "exportPptx" : "exportPdf"](data.args);
                  } else if (data.method === "exportData") {
                    if (!output) throw Object.assign(
                      new Error("The output runtime is unavailable."),
                      { code: "runtime_unavailable" });
                    snapshot = await output.getData(data.args.token);
                  } else if (data.method === "exportStatus") {
                    if (!output) throw Object.assign(
                      new Error("The output runtime is unavailable."),
                      { code: "runtime_unavailable" });
                    snapshot = await output.reportStatus(data.args.token, data.args.body);
                  }
                  else throw new Error("Unsupported runtime operation.");
                  if (data.method === "export" ||
                      data.method === "exportData" ||
                      data.method === "exportStatus") {
                    chrome.webview.postMessage({
                      type:"runtime:result",id:data.id,ok:true,value:snapshot ?? {ok:true}
                    });
                    return;
                  }
                  const value = {
                    slides: snapshot.slides, titles: snapshot.titles,
                    notes: snapshot.notes ?? snapshot.slides.map(extractSpeakerNotes),
                    index: snapshot.index, version: snapshot.version, deckVersion: snapshot.deckVersion,
                    sourcePath: snapshot.sourceName,
                    theme: { name: snapshot.theme, css: snapshot.customThemeCss,
                      metadataJson: snapshot.customThemeMeta ? JSON.stringify(snapshot.customThemeMeta) : "",
                      assetRoot: snapshot.customThemeDir }
                  };
                  chrome.webview.postMessage({type:"runtime:result",id:data.id,ok:true,value});
                } catch (error) {
                  chrome.webview.postMessage({
                    type:"runtime:result",
                    id:data.id,
                    ok:false,
                    code:error.code ?? "runtime_failed",
                    message:error.message
                  });
                }
              }
            });
            const { createHostRuntime } = await import("/Shared/runtime/host-bootstrap.mjs");
            const { createHostIO } = await import("/Shared/runtime/io-host.mjs");
            const { createPortableOutput } = await import("/Shared/runtime/portable-output.mjs");
            const { extractSpeakerNotes } = await import("/Shared/renderer/speaker-notes.mjs");
            runtime = await createHostRuntime(bridge, { assetUrlPrefix: "theme-assets/" });
            chrome.webview.postMessage({type:"runtime:ready"});
          } catch {
            chrome.webview.postMessage({type:"runtime:error"});
          }
        })();
        """;
}
