using System.Collections.Concurrent;
using System.Text.Json;
using MarkdStage.Core;

namespace MarkdStage.Cli;

internal sealed class NativeBrowserHost : IBrowserHost, IAsyncDisposable
{
    private readonly ConcurrentDictionary<string, BrowserAutomation> automation = new();
    private readonly ConcurrentDictionary<string, BrowserProcess> windows = new();
    public Uri? AllowedBaseUri { get; set; }
    public CliException? LastEnvironmentError { get; private set; }
    public bool HasRunningWindows => windows.Values.Any(window => !window.HasExited);

    public async Task<object> LaunchAsync(JsonElement options, string profileDirectory, CancellationToken cancellationToken)
    {
        var url = options.GetProperty("url").GetString()!;
        if (AllowedBaseUri is null || !Uri.TryCreate(url, UriKind.Absolute, out var target) ||
            !AllowedBaseUri.IsBaseOf(target))
            throw new UnauthorizedAccessException("The browser can only open this presentation.");
        var handle = Guid.NewGuid().ToString("N");
        try
        {
            if (options.GetProperty("mode").GetString() == "app")
            {
                windows[handle] = BrowserAutomation.OpenWindow(url, profileDirectory);
                return new { handle };
            }
            if (options.GetProperty("mode").GetString() != "automation")
                throw new ArgumentException("Unknown browser mode.");
            var browser = await BrowserAutomation.OpenAsync(url, profileDirectory, cancellationToken);
            automation[handle] = browser;
            return new { handle, debuggerEndpoint = browser.Endpoint.AbsoluteUri };
        }
        catch (CliException error) { LastEnvironmentError = error; throw; }
    }

    public async Task<JsonElement> CommandAsync(string handle, string method, JsonElement parameters, CancellationToken cancellationToken)
    {
        if (!automation.TryGetValue(handle, out var browser)) throw new InvalidOperationException("Unknown browser handle.");
        if (method is not ("Runtime.evaluate" or "Page.printToPDF" or "Page.captureScreenshot" or
            "Page.enable" or "Runtime.enable" or "Emulation.setDeviceMetricsOverride"))
            throw new UnauthorizedAccessException("Unsupported browser operation.");
        return await browser.CallAsync(method, parameters, cancellationToken);
    }

    public async Task CloseAsync(string handle, CancellationToken cancellationToken)
    {
        if (automation.TryRemove(handle, out var browser)) await browser.DisposeAsync();
        if (windows.TryRemove(handle, out var window)) await window.DisposeAsync();
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var handle in automation.Keys.Concat(windows.Keys)) await CloseAsync(handle, CancellationToken.None);
    }
}
