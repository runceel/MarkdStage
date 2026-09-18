using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using MarkdStage.Cli;
using Microsoft.Web.WebView2.Core;
using Windows.Foundation;
using Windows.Storage.Streams;

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 3)
        {
            Console.Error.WriteLine("MarkdStage.WebView2.Probe <loopback-url> <expression-file> <artifact-directory>");
            return 1;
        }
        var url = new Uri(args[0]);
        if (!url.IsLoopback || url.Scheme != "http")
            throw new ArgumentException("Only an explicit local HTTP origin is permitted.");
        var expression = Path.GetFullPath(args[1]);
        var output = Path.GetFullPath(args[2]);
        Directory.CreateDirectory(output);
        if (!SetProcessDpiAwarenessContext(new nint(-4)))
            Console.Error.WriteLine($"DPI awareness was not changed (Win32 {Marshal.GetLastWin32Error()}); actual DPR is measured.");
        try { return StaDispatcher.Run(dispatcher => RunAsync(dispatcher, url, expression, output)); }
        catch (Exception error)
        {
            File.WriteAllText(Path.Combine(output, "native-error.txt"), error.ToString());
            Console.Error.WriteLine(error);
            return 4;
        }
    }

    private static async Task<int> RunAsync(StaDispatcher dispatcher, Uri url, string expressionFile, string output)
    {
        var profile = Path.Combine(output, "webview2-profile-" + Guid.NewGuid().ToString("N"));
        var availableVersion = CoreWebView2Environment.GetAvailableBrowserVersionString();
        var environment = await CoreWebView2Environment.CreateWithOptionsAsync(null, profile,
            new CoreWebView2EnvironmentOptions
            {
                AdditionalBrowserArguments = "--disable-background-networking --disable-component-update"
            });
        CoreWebView2Controller? controller = null;
        Process? browser = null;
        try
        {
            controller = await environment.CreateCoreWebView2ControllerAsync(
                CoreWebView2ControllerWindowReference.CreateFromWindowHandle((ulong)dispatcher.Window));
            controller.ShouldDetectMonitorScaleChanges = false;
            controller.RasterizationScale = 1;
            controller.ZoomFactor = 1;
            controller.Bounds = new Rect(0, 0, 1280, 720);
            controller.IsVisible = true;
            if (!SetWindowPos(dispatcher.Window, 0, 0, 0, 1280, 720, 0x0014))
                throw new System.ComponentModel.Win32Exception();
            ShowWindow(dispatcher.Window, 4);
            var core = controller.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreHostObjectsAllowed = false;
            core.Settings.IsZoomControlEnabled = false;
            core.PermissionRequested += (_, eventArgs) => eventArgs.State = CoreWebView2PermissionState.Deny;
            core.NewWindowRequested += (_, eventArgs) => eventArgs.Handled = true;
            core.DownloadStarting += (_, eventArgs) => eventArgs.Cancel = true;
            core.NavigationStarting += (_, eventArgs) =>
            {
                if (!Uri.TryCreate(eventArgs.Uri, UriKind.Absolute, out var requested) ||
                    requested.GetLeftPart(UriPartial.Authority) != url.GetLeftPart(UriPartial.Authority))
                    eventArgs.Cancel = true;
            };
            var loaded = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            core.NavigationCompleted += (_, eventArgs) =>
            {
                if (eventArgs.IsSuccess) loaded.TrySetResult();
                else loaded.TrySetException(new IOException($"WebView2 navigation failed: {eventArgs.WebErrorStatus}"));
            };
            await core.CallDevToolsProtocolMethodAsync("Emulation.setEmulatedMedia",
                """{"features":[{"name":"prefers-reduced-motion","value":"reduce"}]}""");
            await core.CallDevToolsProtocolMethodAsync("Emulation.setDeviceMetricsOverride",
                """{"width":1280,"height":720,"deviceScaleFactor":1,"mobile":false}""");
            core.Navigate(url.AbsoluteUri);
            await loaded.Task.WaitAsync(TimeSpan.FromSeconds(30));
            browser = Process.GetProcessById(checked((int)core.BrowserProcessId));
            var executable = browser.MainModule?.FileName ?? throw new IOException("Cannot identify the WebView2 process.");
            if (!Path.GetFileName(executable).Equals("msedgewebview2.exe", StringComparison.OrdinalIgnoreCase))
                throw new IOException($"Unexpected native browser executable: {executable}");
            var engine = new
            {
                availableVersion, runtimeVersion = environment.BrowserVersionString,
                processId = browser.Id, executable,
                fileVersion = FileVersionInfo.GetVersionInfo(executable).FileVersion,
                processArchitecture = RuntimeInformation.ProcessArchitecture.ToString(),
                webView2Assembly = typeof(CoreWebView2).Assembly.FullName,
                controller = new { controller.Bounds.Width, controller.Bounds.Height, controller.RasterizationScale, controller.ZoomFactor, controller.IsVisible },
                hostedBy = "Repository StaDispatcher; visible CoreWebView2 controller, not the WinUI application.",
                profile
            };
            await File.WriteAllTextAsync(Path.Combine(output, "native-engine.json"), JsonSerializer.Serialize(engine, JsonOptions));
            var expression = await File.ReadAllTextAsync(expressionFile);
            for (var sample = 1; sample <= 2; sample++)
            {
                var raw = await core.CallDevToolsProtocolMethodAsync("Runtime.evaluate", JsonSerializer.Serialize(new
                {
                    expression, awaitPromise = true, returnByValue = true, timeout = 45000
                })).AsTask().WaitAsync(TimeSpan.FromSeconds(50));
                using var document = JsonDocument.Parse(raw);
                if (document.RootElement.TryGetProperty("exceptionDetails", out var exception))
                    throw new IOException($"Page evaluation failed: {exception.GetRawText()}");
                var value = document.RootElement.GetProperty("result").GetProperty("value");
                await File.WriteAllTextAsync(Path.Combine(output, $"geometry-{sample}.json"), JsonSerializer.Serialize(value, JsonOptions));
                using var stream = new InMemoryRandomAccessStream();
                await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
                using var reader = new DataReader(stream.GetInputStreamAt(0));
                var length = checked((uint)stream.Size);
                await reader.LoadAsync(length);
                var bytes = new byte[length];
                reader.ReadBytes(bytes);
                await File.WriteAllBytesAsync(Path.Combine(output, $"slide-{sample:000}.png"), bytes);
            }
            Console.WriteLine($"WebView2 {environment.BrowserVersionString}: measured and captured twice.");
            return 0;
        }
        finally
        {
            controller?.Close();
            if (browser is not null)
            {
                using (browser)
                {
                    if (!browser.HasExited) browser.Kill(entireProcessTree: true);
                    await browser.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10));
                }
            }
            for (var attempt = 0; ; attempt++)
            {
                try { if (Directory.Exists(profile)) Directory.Delete(profile, recursive: true); break; }
                catch (IOException) when (attempt < 50) { await Task.Delay(100); }
            }
        }
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetProcessDpiAwarenessContext(nint value);
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(nint window, nint insertAfter, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(nint window, int command);
}
