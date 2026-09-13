using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace MarkdStage.Core;

public sealed record DesktopActivationRequest(string Workspace, string? File, string Mode, string RequestId)
{
    public const string ArgumentPrefix = "--markdstage-activation-v1 ";
    public string PipeName => "MarkdStage.Activation." + RequestId;

    public DesktopActivationRequest Validate()
    {
        if (!Guid.TryParseExact(RequestId, "N", out _) || Mode is not ("preview" or "present") ||
            string.IsNullOrWhiteSpace(Workspace) || !Path.IsPathFullyQualified(Workspace) ||
            File is not null && (!Path.IsPathFullyQualified(File) || !IsMarkdown(File)) ||
            Mode == "present" && File is null)
            throw new ArgumentException("Invalid desktop activation request.");
        var root = WorkspaceResolver.Resolve(Workspace, File);
        if (File is null) return this with { Workspace = root };
        var path = WorkspaceResolver.ResolveRelative(root, Path.GetRelativePath(root, File).Replace('\\', '/'));
        if (!System.IO.File.Exists(path)) throw new FileNotFoundException("The Markdown file does not exist.");
        return this with { Workspace = root, File = WorkspacePathLease.CanonicalizeExisting(path) };
    }

    public string ToArguments() =>
        ArgumentPrefix + Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(this)));

    public static DesktopActivationRequest Parse(string arguments)
    {
        if (!arguments.StartsWith(ArgumentPrefix, StringComparison.Ordinal) || arguments.Length > 32768)
            throw new ArgumentException("Unsupported desktop activation contract.");
        try
        {
            var request = JsonSerializer.Deserialize<DesktopActivationRequest>(
                Convert.FromBase64String(arguments[ArgumentPrefix.Length..]))
                ?? throw new ArgumentException("Invalid desktop activation request.");
            if (!Guid.TryParseExact(request.RequestId, "N", out _))
                throw new ArgumentException("Invalid desktop activation request ID.");
            return request;
        }
        catch (Exception error) when (error is FormatException or JsonException)
        {
            throw new ArgumentException("Invalid desktop activation request.", error);
        }
    }

    private static bool IsMarkdown(string path) =>
        Path.GetExtension(path).Equals(".md", StringComparison.OrdinalIgnoreCase) ||
        Path.GetExtension(path).Equals(".markdown", StringComparison.OrdinalIgnoreCase);
}

public sealed record DesktopActivationResult(bool Accepted, string? Message = null, int ProcessId = 0, long WindowId = 0);

public static class DesktopActivation
{
    public static async Task<DesktopActivationResult> LaunchAsync(
        DesktopActivationRequest request,
        Action<string> activate,
        CancellationToken cancellationToken,
        TimeSpan? timeout = null)
    {
        cancellationToken.ThrowIfCancellationRequested();
        request = request.Validate();
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(timeout ?? TimeSpan.FromSeconds(90));
        await using var pipe = new NamedPipeServerStream(request.PipeName, PipeDirection.In, 1,
            PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
        cancellationToken.ThrowIfCancellationRequested();
        activate(request.ToArguments());
        try
        {
            await pipe.WaitForConnectionAsync(deadline.Token);
            // A response is small and bounded even if another local process connects.
            var bytes = new byte[8192];
            var length = 0;
            while (length < bytes.Length)
            {
                var read = await pipe.ReadAsync(bytes.AsMemory(length), deadline.Token);
                if (read == 0)
                    return JsonSerializer.Deserialize<DesktopActivationResult>(bytes.AsSpan(0, length))
                        ?? throw new IOException("The Windows app returned an empty activation response.");
                length += read;
            }
            throw new IOException("The Windows app returned an oversized activation response.");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new TimeoutException("The Windows app did not accept activation before the timeout.");
        }
    }

    public static async Task ReplyAsync(DesktopActivationRequest request, DesktopActivationResult result)
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        await using var pipe = new NamedPipeClientStream(".", request.PipeName, PipeDirection.Out,
            PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
        await pipe.ConnectAsync(deadline.Token);
        await JsonSerializer.SerializeAsync(pipe, result, cancellationToken: deadline.Token);
        await pipe.FlushAsync(deadline.Token);
    }
}
