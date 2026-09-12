using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace MarkdStage.Cli;

internal sealed class CdpConnection : IAsyncDisposable
{
    private readonly ClientWebSocket socket = new();
    private readonly ConcurrentDictionary<int, TaskCompletionSource<JsonElement>> pending = new();
    private readonly SemaphoreSlim sendLock = new(1);
    private readonly CancellationTokenSource lifetime = new();
    private Task? receiver;
    private int nextId;

    public async Task ConnectAsync(Uri endpoint, CancellationToken cancellationToken)
    {
        if (endpoint.Scheme != "ws" || endpoint.Host != "127.0.0.1")
            throw new InvalidDataException("The browser returned a non-loopback debugger endpoint.");
        await socket.ConnectAsync(endpoint, cancellationToken);
        receiver = ReceiveAsync();
    }

    public async Task<JsonElement> CallAsync(string method, object? parameters, CancellationToken cancellationToken)
    {
        var id = Interlocked.Increment(ref nextId);
        var completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        pending[id] = completion;
        try
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(new { id, method, @params = parameters ?? new { } });
            await sendLock.WaitAsync(cancellationToken);
            try { await socket.SendAsync(bytes.AsMemory(), WebSocketMessageType.Text, true, cancellationToken); }
            finally { sendLock.Release(); }
            return await completion.Task.WaitAsync(TimeSpan.FromSeconds(90), cancellationToken);
        }
        finally { pending.TryRemove(id, out _); }
    }

    private async Task ReceiveAsync()
    {
        var buffer = new byte[64 * 1024];
        try
        {
            while (!lifetime.IsCancellationRequested)
            {
                using var message = new MemoryStream();
                ValueWebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(buffer.AsMemory(), lifetime.Token);
                    if (result.MessageType == WebSocketMessageType.Close) throw new IOException("The browser closed its automation connection.");
                    if (message.Length + result.Count > 256L * 1024 * 1024)
                        throw new IOException("The browser automation response exceeds the size limit.");
                    message.Write(buffer, 0, result.Count);
                } while (!result.EndOfMessage);
                using var json = JsonDocument.Parse(message.ToArray());
                var root = json.RootElement;
                if (!root.TryGetProperty("id", out var id) || !pending.TryGetValue(id.GetInt32(), out var completion)) continue;
                if (root.TryGetProperty("error", out var error))
                    completion.TrySetException(new IOException(error.GetProperty("message").GetString() ?? "Browser automation failed."));
                else completion.TrySetResult(root.GetProperty("result").Clone());
            }
        }
        catch (Exception error)
        {
            foreach (var completion in pending.Values) completion.TrySetException(error);
        }
    }

    public async ValueTask DisposeAsync()
    {
        lifetime.Cancel();
        socket.Abort();
        if (receiver is not null) await receiver;
        socket.Dispose();
        lifetime.Dispose();
        sendLock.Dispose();
    }
}
