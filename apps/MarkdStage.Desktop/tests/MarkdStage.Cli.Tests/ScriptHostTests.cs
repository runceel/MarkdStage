using System.Diagnostics;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using MarkdStage.Cli;
using MarkdStage.Core;
using Microsoft.Web.WebView2.Core;
using Xunit.Abstractions;

namespace MarkdStage.Cli.Tests;

public sealed class ScriptHostTests(ITestOutputHelper output)
{
    [Fact]
    public void NativeMessageMatchesWindows64BitAbi()
    {
        Assert.Contains(RuntimeInformation.ProcessArchitecture, new[] { Architecture.X64, Architecture.Arm64 });
        var message = typeof(StaDispatcher).GetNestedType("Message", BindingFlags.NonPublic)!;
        Assert.Equal(48, Marshal.SizeOf(message));
        foreach (var (field, offset) in new[] {
            ("Window", 0), ("Id", 8), ("WParam", 16), ("LParam", 24),
            ("Time", 32), ("X", 36), ("Y", 40), ("Private", 44)
        })
            Assert.Equal(offset, Marshal.OffsetOf(message, field).ToInt32());
    }

    [Fact]
    public async Task DispatcherPumpsNativeMessagesAndRestoresContextAfterFailure()
    {
        var failure = new IOException("Dispatcher test failure.");
        await RunStaAsync(() =>
        {
            var previous = SynchronizationContext.Current;
            var caught = Assert.Throws<IOException>(() => StaDispatcher.Run(async dispatcher =>
            {
                var thread = Environment.CurrentManagedThreadId;
                Assert.True(PostMessageW(dispatcher.Window, 0, 0, 0));
                await Task.Delay(50);
                Assert.Equal(thread, Environment.CurrentManagedThreadId);
                Assert.Equal(ApartmentState.STA, Thread.CurrentThread.GetApartmentState());
                Assert.Same(dispatcher, SynchronizationContext.Current);
                throw failure;
            }));
            Assert.Same(failure, caught);
            Assert.Same(previous, SynchronizationContext.Current);
        });
    }

    [Fact]
    public async Task WebMessagesSurviveCollectionBetweenCommands()
    {
        var root = CreateTestRoot("script-test");
        Process? browser = null;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        try
        {
            Directory.CreateDirectory(Path.Combine(root, "CliData"));
            await File.WriteAllTextAsync(Path.Combine(root, "CliData", "host.html"),
                """<!doctype html><script src="host.mjs" type="module"></script>""");
            await File.WriteAllTextAsync(Path.Combine(root, "CliData", "host.mjs"), """
                window.markdstageInvoke = (id, method, args) =>
                    chrome.webview.postMessage({ type: "result", id, value: { method, ...args } });
                chrome.webview.postMessage({ type: "ready" });
                """);
            await RunStaAsync(() => Assert.Equal(0, StaDispatcher.Run(async dispatcher =>
            {
                await using var host = new ScriptHost(
                    (_, _) => throw new InvalidOperationException("Unexpected I/O request."),
                    timeout.Token);
                await host.InitializeAsync(dispatcher.Window, Path.Combine(root, "webview"), root);
                browser = GetBrowserProcess(host);

                for (var iteration = 0; iteration < 3; iteration++)
                {
                    // Collect completed initialization locals while the STA continues pumping COM messages.
                    await Task.Run(() =>
                    {
                        GC.Collect();
                        GC.WaitForPendingFinalizers();
                        GC.Collect();
                    });
                    var result = await host.InvokeAsync("echo", new { iteration });
                    Assert.Equal("echo", result.GetProperty("method").GetString());
                    Assert.Equal(iteration, result.GetProperty("iteration").GetInt32());
                }
                return 0;
            })));
        }
        finally
        {
            await CleanUpAsync(root, browser);
        }
    }

    [Theory]
    [InlineData("valid.md", null, null, true)]
    [InlineData("invalid-property.md", "invalid-property", "$.body[0].text", false)]
    [InlineData("unsupported-version.md", "unsupported-version", "$.version", false)]
    [InlineData("blocked-image.md", "blocked-image", "$.body[0].url", true)]
    [InlineData("quoted-invalid-property.md", "invalid-property", "$.body[0].text", false)]
    [InlineData("list-unsupported-version.md", "unsupported-version", "$.version", false)]
    [InlineData("unclosed.md", "unclosed-adaptive-card-fence", "$", false)]
    public async Task PackagedRuntimeValidatesCardsWithoutTheSdkOrAnExternalBrowser(
        string fixture, string? expectedCode, string? expectedPath, bool valid)
    {
        await WithPackagedHostAsync(async (host, core, root, operations) =>
        {
            File.Copy(Path.Combine(AppContext.BaseDirectory, "Fixtures", "adaptive-cards", fixture),
                Path.Combine(root, "cards.md"));
            await host.InvokeAsync("initialize", new { workspace = root });
            await host.InvokeAsync("load", new { path = "cards.md" });
            var result = await host.InvokeAsync("validate", new { file = "cards.md" });
            var report = result.GetProperty("report");
            Assert.Equal(valid, report.GetProperty("ok").GetBoolean());
            Assert.Equal(valid, report.GetProperty("valid").GetBoolean());
            Assert.True(report.GetProperty("complete").GetBoolean());
            Assert.Equal(valid ? 0 : 2, result.GetProperty("exitCode").GetInt32());
            var diagnostics = report.GetProperty("diagnostics").EnumerateArray()
                .Where(item => item.GetProperty("category").GetString() == "adaptive-card").ToArray();
            if (expectedCode is null)
                Assert.Empty(diagnostics);
            else
            {
                var diagnostic = Assert.Single(diagnostics);
                Assert.Equal(expectedCode, diagnostic.GetProperty("code").GetString());
                Assert.Equal(expectedPath, diagnostic.GetProperty("path").GetString());
                Assert.Equal("cards.md", diagnostic.GetProperty("file").GetString());
                Assert.Equal($"adaptive-card[0]{expectedPath}", diagnostic.GetProperty("sourcePath").GetString());
                Assert.Equal("content", diagnostic.GetProperty("impact").GetString());
                Assert.Equal(valid ? "warning" : "error", diagnostic.GetProperty("severity").GetString());
                Assert.Contains($"adaptive-card[0]{expectedPath}", result.GetProperty("text").GetString());
                Assert.Contains(expectedCode, result.GetProperty("text").GetString());
            }

            var resources = await EvaluateAsync(core, """
                ({
                  sdkLoaded: typeof globalThis.AdaptiveCards !== "undefined",
                  urls: performance.getEntriesByType("resource").map(entry => entry.name)
                })
                """);
            Assert.False(resources.GetProperty("sdkLoaded").GetBoolean());
            var urls = resources.GetProperty("urls").EnumerateArray().Select(value => value.GetString()!).ToArray();
            Assert.Contains(urls, url => url.EndsWith("/Shared/renderer/adaptive-card-validation.mjs", StringComparison.Ordinal));
            Assert.All(urls, url => Assert.Equal("markdstage.internal", new Uri(url).Host));
            Assert.DoesNotContain(urls, url => url.Contains("/vendor/adaptivecards", StringComparison.Ordinal) ||
                url.Contains("/vendor/mermaid", StringComparison.Ordinal));
            Assert.DoesNotContain(urls, url => url.EndsWith("/adaptive-card.mjs", StringComparison.Ordinal));
            Assert.DoesNotContain(operations, operation => operation is "launchBrowser" or "closeBrowser" or "cdp");
            Assert.Contains("readText", operations);
            output.WriteLine(report.GetRawText());
        });
    }

    [Fact]
    public async Task NativeWebViewMappingServesPackagedValidationModulesAndLockedSdkChunks()
    {
        using var modules = JsonDocument.Parse(await File.ReadAllTextAsync(
            Path.Combine(AppContext.BaseDirectory, "CliData", "shared-modules.json")));
        var names = modules.RootElement.EnumerateArray().Select(value => value.GetString()).ToArray();
        Assert.Contains("renderer/adaptive-card-validation.mjs", names);
        Assert.Contains("renderer/fenced-blocks.mjs", names);
        Assert.Contains("renderer/image-source.mjs", names);
        Assert.Contains("renderer/marked-lexer.mjs", names);
        Assert.Contains("vendor/marked.min.js", names);
        Assert.DoesNotContain("renderer/adaptive-card.mjs", names);
        Assert.DoesNotContain(names, name => name!.StartsWith("vendor/adaptivecards", StringComparison.Ordinal) ||
            name.StartsWith("vendor/mermaid", StringComparison.Ordinal));

        await WithPackagedHostAsync(async (_, core, _, _) =>
        {
            var result = await EvaluateAsync(core, """
                (async () => {
                  const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
                    .map(value => value.toString(16).padStart(2, "0")).join("");
                  const read = async path => {
                    const response = await fetch(path);
                    if (!response.ok || response.redirected) throw new Error(`Unexpected native response: ${path} (${response.status})`);
                    const bytes = new Uint8Array(await response.arrayBuffer());
                    return { path, bytes, size: bytes.length, sha256: await digest(bytes) };
                  };
                  const paths = [
                    "/CliData/export-report.mjs",
                    "/Shared/renderer/adaptive-card-validation.mjs",
                    "/Shared/renderer/fenced-blocks.mjs",
                    "/Shared/renderer/image-source.mjs",
                    "/Shared/renderer/marked-lexer.mjs",
                    "/Shared/vendor/marked.min.js",
                    "/Web/renderer/adaptive-card-validation.mjs",
                    "/Web/renderer/fenced-blocks.mjs",
                    "/Web/renderer/image-source.mjs",
                    "/Web/renderer/marked-lexer.mjs",
                    "/Web/vendor/marked.min.js",
                    "/Web/vendor/vendor-assets.lock.json"
                  ];
                  const modules = await Promise.all(paths.map(async path => {
                    const { bytes, ...metadata } = await read(path);
                    return metadata;
                  }));
                  const manifest = await (await fetch("/Web/vendor/vendor-assets.lock.json")).json();
                  const asset = manifest.assets["adaptivecards.min.js"];
                  const chunks = [];
                  const combined = new Uint8Array(asset.size);
                  let offset = 0;
                  for (const chunk of asset.chunks) {
                    const { bytes, ...metadata } = await read(`/Web/vendor/${chunk.file}`);
                    combined.set(bytes, offset);
                    offset += bytes.length;
                    chunks.push(metadata);
                  }
                  return {
                    origin: location.origin, modules, chunks,
                    sdk: { version: asset.upstream.version, size: offset, sha256: await digest(combined) }
                  };
                })()
                """);
            Assert.Equal("https://markdstage.internal", result.GetProperty("origin").GetString());
            foreach (var module in result.GetProperty("modules").EnumerateArray()
                .Concat(result.GetProperty("chunks").EnumerateArray()))
            {
                var path = module.GetProperty("path").GetString()!.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
                var bytes = await File.ReadAllBytesAsync(Path.Combine(AppContext.BaseDirectory, path));
                Assert.Equal(bytes.Length, module.GetProperty("size").GetInt32());
                Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(bytes)), module.GetProperty("sha256").GetString());
            }
            var sdk = result.GetProperty("sdk");
            Assert.Equal("3.0.6", sdk.GetProperty("version").GetString());
            Assert.Equal(334964, sdk.GetProperty("size").GetInt32());
            Assert.Equal("5e7c13f3300ae7b89b34703501e08d709fbb6635f1c6755b92495577a77344f2",
                sdk.GetProperty("sha256").GetString());
            output.WriteLine(result.GetRawText());
        });
    }

    private async Task WithPackagedHostAsync(
        Func<ScriptHost, CoreWebView2, string, List<string>, Task> action)
    {
        var root = CreateTestRoot("card-host");
        Process? browser = null;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        try
        {
            await RunStaAsync(() => Assert.Equal(0, StaDispatcher.Run(async dispatcher =>
            {
                await using var io = new WorkspaceIoService(root, Path.Combine(root, "transients"));
                var operations = new List<string>();
                await using var host = new ScriptHost(async (operation, arguments) =>
                {
                    operations.Add(operation);
                    if (operation is "launchBrowser" or "closeBrowser" or "cdp")
                        throw new InvalidOperationException("Validation must not use an external browser.");
                    return await io.ExecuteAsync(operation, arguments, timeout.Token);
                }, timeout.Token);
                await host.InitializeAsync(dispatcher.Window, Path.Combine(root, "webview"), AppContext.BaseDirectory);
                browser = GetBrowserProcess(host);
                var executable = browser.MainModule?.FileName;
                Assert.Equal("msedgewebview2.exe", Path.GetFileName(executable), ignoreCase: true);
                output.WriteLine($"Native ScriptHost: WebView2 {GetCore(host).Environment.BrowserVersionString}; {executable}; {RuntimeInformation.ProcessArchitecture}.");
                await action(host, GetCore(host), root, operations);
                return 0;
            })));
        }
        finally
        {
            await CleanUpAsync(root, browser);
        }
    }

    private static async Task<JsonElement> EvaluateAsync(CoreWebView2 core, string expression)
    {
        using var result = JsonDocument.Parse(await core.CallDevToolsProtocolMethodAsync("Runtime.evaluate",
            JsonSerializer.Serialize(new { expression, awaitPromise = true, returnByValue = true, timeout = 30000 }))
            .AsTask().WaitAsync(TimeSpan.FromSeconds(35)));
        Assert.False(result.RootElement.TryGetProperty("exceptionDetails", out var exception), exception.ToString());
        return result.RootElement.GetProperty("result").GetProperty("value").Clone();
    }

    private static string CreateTestRoot(string name)
    {
        // WebView2 profiles need room for their own nested paths below the repository checkout.
        var parent = typeof(ScriptHostTests).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>()
            .Single(attribute => attribute.Key == "NativeTestRoot").Value!;
        var root = Path.Combine(parent, $"{name}-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        return root;
    }

    private static async Task CleanUpAsync(string root, Process? browser)
    {
        // WebView2 can keep its isolated profile open until the test host exits.
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
            try { Directory.Delete(root, recursive: true); break; }
            catch (IOException) when (attempt < 50) { await Task.Delay(100); }
        }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static CoreWebView2 GetCore(ScriptHost host)
    {
        var controller = (CoreWebView2Controller)typeof(ScriptHost)
            .GetField("controller", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(host)!;
        return controller.CoreWebView2;
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static Process GetBrowserProcess(ScriptHost host) =>
        Process.GetProcessById(checked((int)GetCore(host).BrowserProcessId));

    private static async Task RunStaAsync(Action action)
    {
        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            try { action(); completion.SetResult(); }
            catch (Exception error) { completion.SetException(error); }
        }) { IsBackground = true };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        await completion.Task.WaitAsync(TimeSpan.FromSeconds(90));
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostMessageW(nint window, uint message, nuint wParam, nint lParam);
}
