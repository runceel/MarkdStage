using System.Collections.Concurrent;
using System.Runtime.InteropServices;

namespace MarkdStage.Cli;

internal sealed class StaDispatcher : SynchronizationContext, IDisposable
{
    private const uint DispatchMessageId = 0x8001;
    private readonly ConcurrentQueue<(SendOrPostCallback Callback, object? State)> callbacks = new();
    public nint Window { get; }
    private StaDispatcher()
    {
        // A hidden ordinary native window supports WebView2 script execution, never layout output.
        Window = CreateWindowExW(0, "STATIC", "MarkdStage script host", 0, 0, 0, 1, 1, 0, 0, 0, 0);
        if (Window == 0) throw new System.ComponentModel.Win32Exception();
    }

    public override void Post(SendOrPostCallback callback, object? state)
    {
        callbacks.Enqueue((callback, state));
        PostMessageW(Window, DispatchMessageId, 0, 0);
    }

    public static int Run(Func<StaDispatcher, Task<int>> action)
    {
        using var dispatcher = new StaDispatcher();
        var previous = Current;
        SetSynchronizationContext(dispatcher);
        var exitCode = 4;
        Exception? failure = null;
        dispatcher.Post(async _ =>
        {
            try { exitCode = await action(dispatcher); }
            catch (Exception error) { failure = error; }
            finally { PostQuitMessage(0); }
        }, null);
        try
        {
            int status;
            while ((status = GetMessageW(out var message, 0, 0, 0)) > 0)
            {
                if (message.Id == DispatchMessageId && message.Window == dispatcher.Window)
                {
                    while (dispatcher.callbacks.TryDequeue(out var item)) item.Callback(item.State);
                }
                else { TranslateMessage(ref message); DispatchMessageW(ref message); }
            }
            if (status == -1) throw new System.ComponentModel.Win32Exception();
            if (failure is not null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(failure).Throw();
            return exitCode;
        }
        finally { SetSynchronizationContext(previous); }
    }

    public void Dispose() => DestroyWindow(Window);
    [StructLayout(LayoutKind.Sequential)] private struct Message
    { public nint Window; public uint Id; public nuint WParam; public nint LParam; public uint Time; public int X, Y; public uint Private; }
    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern nint CreateWindowExW(uint extendedStyle, string className, string title, uint style, int x, int y, int width, int height, nint parent, nint menu, nint instance, nint parameter);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool DestroyWindow(nint window);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool PostMessageW(nint window, uint message, nuint wParam, nint lParam);
    [DllImport("user32.dll")] private static extern void PostQuitMessage(int exitCode);
    [DllImport("user32.dll", SetLastError = true)] private static extern int GetMessageW(out Message message, nint window, uint minimum, uint maximum);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool TranslateMessage(ref Message message);
    [DllImport("user32.dll")] private static extern nint DispatchMessageW(ref Message message);
}
