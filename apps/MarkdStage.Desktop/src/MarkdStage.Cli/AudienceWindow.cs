using System.Text.Json;
using MarkdStage.Core;

namespace MarkdStage.Cli;

// Owns the single external audience window of a `--no-open` presentation server,
// mirroring the npm CLI's Chromium app window at `?present=1`.
internal sealed class AudienceWindow(
    WorkspaceIoService io,
    Func<Uri?> baseUri) : IAsyncDisposable
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private BrowserProcess? window;
    private string? profile;
    private bool disposed;

    public bool IsRunning => window is { HasExited: false };

    public async Task<bool> OpenAsync()
    {
        await gate.WaitAsync();
        try
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            if (IsRunning) return true;
            await CloseCoreAsync();
            var root = baseUri() ?? throw new InvalidOperationException("The presentation server is not ready.");
            var created = await io.ExecuteAsync("createTransientDirectory",
                JsonSerializer.SerializeToElement(new[] { "present" }), CancellationToken.None);
            if (!created.Ok) throw new IOException("The package temporary data folder is inaccessible.");
            profile = (string)created.Value!;
            try
            {
                window = BrowserAutomation.OpenWindow(new Uri(root, "?present=1").AbsoluteUri, io.GetTransientDirectory(profile));
            }
            catch (CliException error) when (error.Code == "browser_not_found")
            {
                await CloseCoreAsync();
                throw new InvalidOperationException(
                    "Opening the audience view requires Microsoft Edge, Google Chrome, or Chromium.");
            }
            catch (Exception error) when (error is not (InvalidOperationException or IOException))
            {
                await CloseCoreAsync();
                throw new InvalidOperationException("The audience window could not be started.", error);
            }
            return false;
        }
        finally { gate.Release(); }
    }

    public async Task CloseAsync()
    {
        await gate.WaitAsync();
        try { await CloseCoreAsync(); }
        finally { gate.Release(); }
    }

    private async Task CloseCoreAsync()
    {
        var current = window;
        var currentProfile = profile;
        window = null;
        profile = null;
        if (current is not null) await current.DisposeAsync();
        if (currentProfile is not null)
            await io.ExecuteAsync("removeTransientDirectory",
                JsonSerializer.SerializeToElement(new[] { currentProfile }), CancellationToken.None);
    }

    public async ValueTask DisposeAsync()
    {
        await gate.WaitAsync();
        try
        {
            if (disposed) return;
            disposed = true;
            await CloseCoreAsync();
        }
        finally { gate.Release(); }
    }
}
