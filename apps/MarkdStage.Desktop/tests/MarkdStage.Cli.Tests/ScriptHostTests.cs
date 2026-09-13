using System.Diagnostics;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using MarkdStage.Cli;
using Microsoft.Web.WebView2.Core;

namespace MarkdStage.Cli.Tests;

public sealed class ScriptHostTests
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
        var root = Path.Combine(Path.GetTempPath(), "markdstage-script-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
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
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static Process GetBrowserProcess(ScriptHost host)
    {
        var controller = (CoreWebView2Controller)typeof(ScriptHost)
            .GetField("controller", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(host)!;
        return Process.GetProcessById(checked((int)controller.CoreWebView2.BrowserProcessId));
    }

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
