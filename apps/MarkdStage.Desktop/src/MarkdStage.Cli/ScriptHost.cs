using System.Collections.Concurrent;
using System.Text.Json;
using MarkdStage.Core;
using Microsoft.Web.WebView2.Core;

namespace MarkdStage.Cli;

internal sealed class ScriptHost : IAsyncDisposable
{
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> pending = new();
    private readonly TaskCompletionSource ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly Func<string, JsonElement, Task<object>> handleRequest;
    private readonly CancellationToken cancellationToken;
    private readonly SynchronizationContext dispatcher = SynchronizationContext.Current
        ?? throw new InvalidOperationException("The script host requires an STA dispatcher.");
    private CoreWebView2Controller? controller;
    private string trustedUrl = "";
    private bool disposed;
    public event Action<JsonElement>? SnapshotChanged;

    public ScriptHost(Func<string, JsonElement, Task<object>> handleRequest, CancellationToken cancellationToken)
    { this.handleRequest = handleRequest; this.cancellationToken = cancellationToken; }

    public async Task InitializeAsync(nint window, string profile, string packageDirectory)
    {
        if (!File.Exists(Path.Combine(packageDirectory, "CliData", "host.html")) ||
            !File.Exists(Path.Combine(packageDirectory, "CliData", "host.mjs")))
            throw new CliException("runtime_unavailable", "The packaged shared runtime is missing. Repair or reinstall MarkdStage.", 4);
        try
        {
            _ = CoreWebView2Environment.GetAvailableBrowserVersionString();
            var environment = await CoreWebView2Environment.CreateWithOptionsAsync(null, profile,
                new CoreWebView2EnvironmentOptions { AdditionalBrowserArguments = "--disable-background-networking --disable-component-update" });
            controller = await environment.CreateCoreWebView2ControllerAsync(
                CoreWebView2ControllerWindowReference.CreateFromWindowHandle((ulong)window));
            controller.IsVisible = false;
            controller.Bounds = new Windows.Foundation.Rect(0, 0, 1, 1);
            var core = controller.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreHostObjectsAllowed = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsBuiltInErrorPageEnabled = false;
            core.PermissionRequested += (_, eventArgs) => eventArgs.State = CoreWebView2PermissionState.Deny;
            core.NewWindowRequested += (_, eventArgs) => eventArgs.Handled = true;
            core.DownloadStarting += (_, eventArgs) => eventArgs.Cancel = true;
            core.SetVirtualHostNameToFolderMapping("markdstage.internal", packageDirectory, CoreWebView2HostResourceAccessKind.DenyCors);
            trustedUrl = "https://markdstage.internal/CliData/host.html";
            core.NavigationStarting += (_, eventArgs) => eventArgs.Cancel = eventArgs.Uri != trustedUrl;
            core.WebMessageReceived += OnMessage;
            var loaded = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            core.NavigationCompleted += (_, eventArgs) =>
            {
                if (eventArgs.IsSuccess) loaded.TrySetResult();
                else loaded.TrySetException(new IOException("The packaged script host could not load."));
            };
            core.Navigate(trustedUrl);
            await loaded.Task.WaitAsync(TimeSpan.FromSeconds(30), cancellationToken);
            try { await ready.Task.WaitAsync(TimeSpan.FromSeconds(30), cancellationToken); }
            catch (TimeoutException)
            {
                throw new CliException("runtime_unavailable", "The packaged shared JavaScript runtime could not initialize. Repair or reinstall MarkdStage.", 4);
            }
        }
        catch (OperationCanceledException) { throw; }
        catch (CliException) { throw; }
        catch (Exception error)
        {
            throw new CliException("webview2_unavailable",
                $"Microsoft Edge WebView2 Runtime is missing or its package data folder is inaccessible. Install the runtime from Microsoft and retry. ({error.GetType().Name})", 3);
        }
    }

    private async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs eventArgs)
    {
        if (disposed || eventArgs.Source != trustedUrl) return;
        try
        {
            using var message = JsonDocument.Parse(eventArgs.WebMessageAsJson);
            var root = message.RootElement;
            var type = root.GetProperty("type").GetString();
            if (type == "ready") { ready.TrySetResult(); return; }
            if (type == "snapshot")
            {
                SnapshotChanged?.Invoke(root.GetProperty("value").Clone());
                return;
            }
            var id = root.GetProperty("id").GetString()!;
            if (type == "result")
            {
                if (pending.TryRemove(id, out var completion))
                {
                    if (root.TryGetProperty("error", out var error))
                    {
                        var code = error.TryGetProperty("code", out var value) ? value.GetString() ?? "unexpected_error" : "unexpected_error";
                        completion.TrySetException(new CliException(code, error.GetProperty("message").GetString() ?? "Shared runtime failed.", ExitCodeFor(code)));
                    }
                    else completion.TrySetResult(root.GetProperty("value").Clone());
                }
            }
            else if (type == "io")
            {
                var operation = root.GetProperty("operation").GetString()!;
                var args = root.GetProperty("args").Clone();
                object result;
                try { result = await handleRequest(operation, args); }
                catch { result = new { ok = false, code = "io_failed", message = "The I/O operation failed." }; }
                if (!disposed) controller!.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "io-result", id, result }));
            }
        }
        catch (Exception error)
        {
            foreach (var completion in pending.Values) completion.TrySetException(error);
        }
    }

    public async Task<JsonElement> InvokeAsync(string method, object arguments)
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        var id = Guid.NewGuid().ToString("N");
        var completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        pending[id] = completion;
        try
        {
            dispatcher.Post(async _ =>
            {
                try
                {
                    if (disposed) { completion.TrySetCanceled(); return; }
                    await controller!.CoreWebView2.ExecuteScriptAsync(
                        $"window.markdstageInvoke({JsonSerializer.Serialize(id)},{JsonSerializer.Serialize(method)},{JsonSerializer.Serialize(arguments)});");
                }
                catch (Exception error) { completion.TrySetException(error); }
            }, null);
            var timeout = method is "inspect" or "capture" or "export" ? TimeSpan.FromMinutes(30) : TimeSpan.FromSeconds(60);
            return await completion.Task.WaitAsync(timeout, cancellationToken);
        }

        finally { pending.TryRemove(id, out _); }
    }

    public void NotifyWatch(WorkspaceChange change) => dispatcher.Post(_ =>
    {
        if (!disposed) controller!.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
        {
            type = "io-watch", handle = change.Handle,
            @event = new { path = change.Path, kind = change.Kind }
        }));
    }, null);

    public static int ExitCodeFor(string code) => code switch
    {
        "usage_error" => 1,
        "empty_markdown" or "file_not_found" or "file_too_large" or "invalid_input" or "invalid_markdown_path"
            or "invalid_output_path" or "invalid_theme_file" or "io_failed" or "no_deck" or "path_outside_workspace"
            or "slide_out_of_range" or "theme_file_not_found" or "too_many_slides" => 2,
        "browser_not_found" or "browser_automation_unavailable" or "webview2_unavailable" => 3,
        _ => code.EndsWith("browser_not_found", StringComparison.Ordinal) ? 3 : 4
    };

    public ValueTask DisposeAsync()
    {
        disposed = true;
        foreach (var completion in pending.Values) completion.TrySetCanceled();
        controller?.Close();
        controller = null;
        return ValueTask.CompletedTask;
    }
}
