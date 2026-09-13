using System.Text.Json;
using Microsoft.Win32;

namespace MarkdStage.Cli;

internal sealed class BrowserAutomation : IAsyncDisposable
{
    private readonly BrowserProcess process;
    private readonly CdpConnection cdp;
    public Uri Endpoint { get; }
    private BrowserAutomation(BrowserProcess process, CdpConnection cdp, Uri endpoint)
    { this.process = process; this.cdp = cdp; Endpoint = endpoint; }

    public static string FindBrowser()
    {
        var candidates = new List<string>();
        foreach (var basePath in new[] {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)
        }.Where(path => !string.IsNullOrEmpty(path)))
        {
            candidates.Add(Path.Combine(basePath, "Microsoft", "Edge", "Application", "msedge.exe"));
            candidates.Add(Path.Combine(basePath, "Google", "Chrome", "Application", "chrome.exe"));
            candidates.Add(Path.Combine(basePath, "Chromium", "Application", "chrome.exe"));
        }
        foreach (var hive in new[] { Registry.CurrentUser, Registry.LocalMachine })
        foreach (var browser in new[] { "msedge.exe", "chrome.exe", "chromium.exe" })
        {
            using var key = hive.OpenSubKey($@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{browser}");
            if (key?.GetValue(null) is string registered) candidates.Add(registered.Trim('"'));
        }
        foreach (var path in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
        {
            if (!Path.IsPathFullyQualified(path)) continue;
            foreach (var browser in new[] { "msedge.exe", "chrome.exe", "chromium.exe" })
                candidates.Add(Path.Combine(path, browser));
        }
        return candidates.FirstOrDefault(path => Path.IsPathFullyQualified(path) && File.Exists(path)) ??
            throw new CliException("browser_not_found",
                "Install Microsoft Edge, Google Chrome, or Chromium to use inspect, capture, and export. MarkdStage never downloads a browser.", 3);
    }

    public static BrowserProcess OpenWindow(string url, string profile)
    {
        RequireLoopback(url);
        return BrowserProcess.Start(FindBrowser(),
            [$"--user-data-dir={profile}", "--no-first-run", "--no-default-browser-check", "--window-size=1280,720", $"--app={url}"]);
    }

    public static async Task<BrowserAutomation> OpenAsync(string url, string profile, CancellationToken cancellationToken)
    {
        RequireLoopback(url);
        var process = BrowserProcess.Start(FindBrowser(),
            [$"--user-data-dir={profile}", "--headless=new", "--remote-debugging-address=127.0.0.1",
             "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
             "--force-device-scale-factor=1", "--hide-scrollbars", "--window-size=1280,720", "about:blank"]);
        var cdp = new CdpConnection();
        try
        {
            var endpoint = await BrowserEndpointDiscovery.DiscoverAsync(
                () => process.HasExited,
                profile,
                cancellationToken);
            using var http = new HttpClient(new HttpClientHandler { UseProxy = false }) { Timeout = TimeSpan.FromSeconds(5) };
            // A page target is created through a loopback-only endpoint in this fresh private profile.
            using var request = new HttpRequestMessage(HttpMethod.Put, new Uri(endpoint, "json/new?about:blank"));
            using var response = await http.SendAsync(request, cancellationToken);
            response.EnsureSuccessStatusCode();
            using var target = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            var websocket = new Uri(target.RootElement.GetProperty("webSocketDebuggerUrl").GetString()!);
            await cdp.ConnectAsync(websocket, cancellationToken);
            await cdp.CallAsync("Page.enable", null, cancellationToken);
            await cdp.CallAsync("Runtime.enable", null, cancellationToken);
            await cdp.CallAsync("Emulation.setDeviceMetricsOverride",
                new { width = 1280, height = 720, deviceScaleFactor = 1, mobile = false }, cancellationToken);
            await cdp.CallAsync("Page.navigate", new { url }, cancellationToken);
            return new BrowserAutomation(process, cdp, websocket);
        }
        catch (Exception error)
        {
            await cdp.DisposeAsync();
            await process.DisposeAsync();
            if (error is OperationCanceledException or CliException) throw;
            throw new CliException("browser_automation_unavailable",
                "Chromium automation could not start. Enterprise policy may disable remote debugging; this is a known limitation. Check browser policy and access to the package temporary profile.", 3);
        }
    }

    private static void RequireLoopback(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != "http" || uri.Host != "127.0.0.1" || uri.UserInfo.Length != 0)
            throw new InvalidDataException("Browser navigation must use the native loopback server.");
    }

    public Task<JsonElement> CallAsync(string method, object? parameters, CancellationToken cancellationToken) =>
        cdp.CallAsync(method, parameters, cancellationToken);

    public async ValueTask DisposeAsync()
    {
        await cdp.DisposeAsync();
        await process.DisposeAsync();
    }
}
