using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MarkdStage.Core;

public sealed record PortResult(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("value")] object? Value = null,
    [property: JsonPropertyName("code")] string? Code = null,
    [property: JsonPropertyName("message")] string? Message = null);

public interface IBrowserHost
{
    Task<object> LaunchAsync(JsonElement options, string profileDirectory, CancellationToken cancellationToken);
    Task CloseAsync(string handle, CancellationToken cancellationToken);
}

public class BrowserHostException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

public sealed record WorkspaceChange(string Handle, string Path, string Kind);

public sealed class WorkspaceIoService : IAsyncDisposable
{
    private const int MaxReadBytes = 10 * 1024 * 1024;
    private const int MaxWriteBytes = 256 * 1024 * 1024;
    private const int AtomicReplaceAttempts = 5;
    private const int AtomicReplaceRetryDelayMilliseconds = 75;
    private const int TransientDeleteAttempts = 20;
    private const int TransientDeleteRetryDelayMilliseconds = 100;
    private const int ErrorSharingViolation = 32;
    private const int ErrorLockViolation = 33;
    private readonly string _transientRoot;
    private readonly IBrowserHost? _browser;
    private readonly ConcurrentDictionary<string, FileSystemWatcher> _watchers = new();
    private readonly ConcurrentDictionary<string, string> _transients = new();
    private readonly ConcurrentDictionary<string, FileStream> _transientLocks = new();
    private readonly ConcurrentDictionary<string, byte> _browsers = new();
    private readonly SemaphoreSlim _writes = new(1, 1);
    private readonly SemaphoreSlim _operations = new(1, 1);
    private bool _disposed;

    public WorkspaceIoService(string root, string transientRoot, IBrowserHost? browser = null)
    {
        Root = WorkspaceResolver.Resolve(root);
        if (!Path.IsPathFullyQualified(transientRoot))
            throw new ArgumentException("Transient storage must be absolute.");
        WorkspaceResolver.RejectLinks(transientRoot);
        _transientRoot = transientRoot;
        Directory.CreateDirectory(_transientRoot);
        _browser = browser;
        SweepTransientDirectories();
    }

    public string Root { get; }
    public event EventHandler<WorkspaceChange>? Changed;

    public string GetTransientDirectory(string handle)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (!_transients.TryGetValue(handle, out var directory))
            throw new UnauthorizedAccessException("Unknown transient directory.");
        WorkspaceResolver.RejectLinks(directory);
        return directory;
    }

    public async Task<PortResult> ExecuteAsync(string method, JsonElement args, CancellationToken cancellationToken = default)
    {
        try { await _operations.WaitAsync(cancellationToken); }
        catch (OperationCanceledException) { return Failure("io_failed"); }
        try { return await ExecuteCoreAsync(method, args, cancellationToken); }
        finally { _operations.Release(); }
    }

    private async Task<PortResult> ExecuteCoreAsync(string method, JsonElement args, CancellationToken cancellationToken)
    {
        try
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (args.ValueKind != JsonValueKind.Array) return Failure("denied");
            var path = args.GetArrayLength() > 0 && args[0].ValueKind == JsonValueKind.String ? args[0].GetString()! : "";
            object? value;
            switch (method)
            {
                case "readText":
                case "readBytes":
                {
                    var target = WorkspaceResolver.ResolveRelative(Root, path);
                    var ceiling = ReadCeiling(path);
                    var requested = args.GetArrayLength() > 1 && args[1].ValueKind != JsonValueKind.Null ? args[1].GetInt64() : ceiling;
                    if (requested < 0) return Failure("too_large");
                    var limit = Math.Min(ceiling, requested);
                    using var lease = WorkspacePathLease.Acquire(target, includeFile: true);
                    await using var stream = new FileStream(target, FileMode.Open, FileAccess.Read,
                        FileShare.Read, 65536, FileOptions.Asynchronous | FileOptions.SequentialScan);
                    WorkspaceResolver.RejectLinks(target);
                    if (stream.Length > limit) return Failure("too_large");
                    var bytes = new byte[(int)stream.Length];
                    await stream.ReadExactlyAsync(bytes, cancellationToken);
                    if (stream.ReadByte() != -1) return Failure("too_large");
                    if (method == "readBytes") value = new { base64 = Convert.ToBase64String(bytes) };
                    else
                    {
                        var text = Encoding.UTF8.GetString(bytes);
                        value = text.StartsWith('\uFEFF') ? text[1..] : text;
                    }
                    break;
                }
                case "stat":
                {
                    var target = WorkspaceResolver.ResolveRelative(Root, path, true);
                    using var lease = WorkspacePathLease.Acquire(target, includeFile: true);
                    value = Describe(path, target, false);
                    break;
                }
                case "list":
                    value = List(path, args.GetArrayLength() > 1 ? args[1] : default);
                    break;
                case "writeBytes":
                case "replaceText":
                {
                    var target = WorkspaceResolver.ResolveRelative(Root, path);
                    var options = args.GetArrayLength() > 2 ? args[2] : default;
                    if (method == "replaceText" && Path.GetExtension(path).ToLowerInvariant() is not (".md" or ".markdown"))
                        return Failure("unsupported");
                    byte[] bytes;
                    if (method == "replaceText")
                    {
                        if (Encoding.UTF8.GetByteCount(args[1].GetString()!) > 2 * 1024 * 1024) return Failure("too_large");
                        bytes = Encoding.UTF8.GetBytes(args[1].GetString()!);
                    }
                    else if (args[1].ValueKind == JsonValueKind.Object)
                    {
                        var encoded = args[1].GetProperty("base64").GetString()!;
                        if (encoded.Length > (long)MaxWriteBytes * 4 / 3 + 4) return Failure("too_large");
                        bytes = Convert.FromBase64String(encoded);
                    }
                    else
                    {
                        if (args[1].GetArrayLength() > MaxWriteBytes) return Failure("too_large");
                        bytes = args[1].EnumerateArray().Select(item => item.GetByte()).ToArray();
                    }
                    if (bytes.Length > MaxWriteBytes) return Failure("too_large");
                    await _writes.WaitAsync(cancellationToken);
                    try
                    {
                        if (_disposed) return Failure("io_failed");
                        using var parentLease = WorkspacePathLease.Acquire(Path.GetDirectoryName(target)!);
                        var overwrite = method == "replaceText" || Bool(options, "overwrite");
                        if (File.Exists(target) && !overwrite) return Failure("exists");
                        if (method == "replaceText" && !File.Exists(target)) return Failure("missing");
                        double? expected = options.ValueKind == JsonValueKind.Object &&
                            options.TryGetProperty("expectedModifiedAt", out var timestamp) && timestamp.ValueKind != JsonValueKind.Null
                            ? timestamp.GetDouble() : null;
                        if (expected.HasValue && (!double.IsFinite(expected.Value) || expected.Value < 0)) return Failure("denied");
                        if (expected.HasValue && ModifiedAt(target) != expected.Value) return Failure("conflict");
                        CreateParents(Path.GetDirectoryName(target)!);
                        using var createdParentLease = WorkspacePathLease.Acquire(Path.GetDirectoryName(target)!);
                        var staging = Path.Combine(Path.GetDirectoryName(target)!, $".markdstage-{Guid.NewGuid():N}");
                        try
                        {
                            await using (var stream = new FileStream(staging, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                                65536, FileOptions.Asynchronous | FileOptions.WriteThrough))
                            {
                                await stream.WriteAsync(bytes, cancellationToken);
                                stream.Flush(flushToDisk: true);
                            }
                            WorkspaceResolver.RejectLinks(target);
                            if (expected.HasValue && (!File.Exists(target) || ModifiedAt(target) != expected.Value))
                                return Failure("conflict");
                            if (!await CommitStagingAsync(staging, target, overwrite, cancellationToken))
                                return Failure("destination_locked");
                        }
                        finally { if (File.Exists(staging)) File.Delete(staging); }
                        value = path;
                    }
                    finally { _writes.Release(); }
                    break;
                }
                case "makeDirectory":
                {
                    var target = WorkspaceResolver.ResolveRelative(Root, path);
                    using var lease = WorkspacePathLease.Acquire(target);
                    CreateParents(target);
                    value = path;
                    break;
                }
                case "watch":
                    value = Watch(path, args.GetArrayLength() > 1 ? args[1] : default);
                    break;
                case "unwatch":
                    if (_watchers.TryRemove(path, out var watcher)) watcher.Dispose();
                    value = null;
                    break;
                case "createTransientDirectory":
                    if (path is not ("inspect" or "capture" or "pdf" or "pptx" or "present")) return Failure("denied");
                    value = CreateTransient(path);
                    break;
                case "removeTransientDirectory":
                    await RemoveTransientAsync(path, cancellationToken);
                    value = null;
                    break;
                case "launchBrowser":
                    if (_browser is null) return Failure("unsupported");
                    var browserOptions = args[0];
                    if (!_transients.TryGetValue(browserOptions.GetProperty("profile").GetString()!, out var profile))
                        return Failure("denied");
                    var url = new Uri(browserOptions.GetProperty("url").GetString()!, UriKind.Absolute);
                    if (url.Scheme != "http" || url.Host != "127.0.0.1" || !string.IsNullOrEmpty(url.UserInfo))
                        return Failure("denied");
                    WorkspaceResolver.RejectLinks(profile);
                    value = await _browser.LaunchAsync(browserOptions, profile, cancellationToken);
                    var browserHandle = JsonSerializer.SerializeToElement(value).GetProperty("handle").GetString()!;
                    _browsers[browserHandle] = 0;
                    break;
                case "closeBrowser":
                    if (_browser is null || !_browsers.ContainsKey(path)) return Failure("denied");
                    await _browser.CloseAsync(path, cancellationToken);
                    _browsers.TryRemove(path, out _);
                    value = null;
                    break;
                default: return Failure("unsupported");
            }
            return new PortResult(true, value);
        }
        catch (UnauthorizedAccessException) { return Failure("denied"); }
        catch (FileNotFoundException) { return Failure("missing"); }
        catch (DirectoryNotFoundException) { return Failure("missing"); }
        catch (Exception error) when (error is ArgumentException or JsonException or InvalidOperationException or FormatException or OverflowException or IndexOutOfRangeException or KeyNotFoundException)
        { return Failure("denied"); }
        catch (BrowserHostException error)
        { return Failure(error.Code); }
        catch (Exception error) when (error is IOException or OperationCanceledException or System.ComponentModel.Win32Exception or NotSupportedException)
        { return Failure("io_failed"); }
        catch (Exception) { return Failure("io_failed"); }
    }

    private static async Task<bool> CommitStagingAsync(
        string staging,
        string target,
        bool overwrite,
        CancellationToken cancellationToken)
    {
        for (var attempt = 1; attempt <= AtomicReplaceAttempts; attempt++)
        {
            try
            {
                File.Move(staging, target, overwrite);
                return true;
            }
            catch (IOException error) when (
                overwrite &&
                IsSharingViolation(error) &&
                attempt < AtomicReplaceAttempts)
            {
                await Task.Delay(AtomicReplaceRetryDelayMilliseconds, cancellationToken);
            }
            catch (IOException error) when (overwrite && IsSharingViolation(error))
            {
                return false;
            }
            catch (UnauthorizedAccessException) when (
                overwrite &&
                IsDestinationLocked(target) &&
                attempt < AtomicReplaceAttempts)
            {
                await Task.Delay(AtomicReplaceRetryDelayMilliseconds, cancellationToken);
            }
            catch (UnauthorizedAccessException) when (overwrite && IsDestinationLocked(target))
            {
                return false;
            }
        }
        return false;
    }

    private static bool IsSharingViolation(IOException error) =>
        OperatingSystem.IsWindows() &&
        (error.HResult & 0xFFFF) is ErrorSharingViolation or ErrorLockViolation;

    private static bool IsDestinationLocked(string target)
    {
        if (!OperatingSystem.IsWindows() || !File.Exists(target)) return false;
        try
        {
            using var stream = new FileStream(target, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
            return false;
        }
        catch (IOException error) when (IsSharingViolation(error))
        {
            return true;
        }
        catch (UnauthorizedAccessException)
        {
            return false;
        }
    }

    private static PortResult Failure(string code) => new(false, Code: code, Message: code switch
    {
        "denied" => "The operation is not allowed inside this workspace.",
        "missing" => "The requested file or directory was not found.",
        "too_large" => "The file exceeds the allowed size.",
        "exists" => "The output file already exists.",
        "conflict" => "The source changed since it was read.",
        "destination_locked" => "The destination file is in use.",
        "browser_not_found" => "No installed Chromium-based browser was found.",
        "browser_automation_unavailable" => "Chromium automation could not start. Enterprise policy may disable remote debugging.",
        "unsupported" => "The operation or file type is not supported.",
        _ => "The workspace operation could not be completed.",
    });

    private static int ReadCeiling(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".md" or ".markdown" => 2 * 1024 * 1024,
        ".css" => 64 * 1024,
        ".json" when Path.GetFileName(path).Equals("theme.json", StringComparison.OrdinalIgnoreCase) => 64 * 1024,
        ".svg" or ".png" or ".jpg" or ".jpeg" or ".webp" or ".woff" or ".woff2" => 2 * 1024 * 1024,
        _ => MaxReadBytes,
    };

    private static double ModifiedAt(string path) =>
        (File.GetLastWriteTimeUtc(path).Ticks - DateTime.UnixEpoch.Ticks) / (double)TimeSpan.TicksPerMillisecond;

    private static object Describe(string path, string target, bool includePath)
    {
        var attributes = File.GetAttributes(target);
        var directory = (attributes & FileAttributes.Directory) != 0;
        var size = directory ? 0 : new FileInfo(target).Length;
        return includePath
            ? new { path, kind = directory ? "directory" : "file", size, modifiedAt = ModifiedAt(target) }
            : (object)new { kind = directory ? "directory" : "file", size, modifiedAt = ModifiedAt(target) };
    }

    private object List(string path, JsonElement options)
    {
        var directory = WorkspaceResolver.ResolveRelative(Root, path, true);
        var max = options.ValueKind == JsonValueKind.Object && options.TryGetProperty("maxEntries", out var count)
            ? Math.Clamp(count.GetInt32(), 0, 10000) : 1000;
        var extensions = Extensions(options);
        var pending = new Stack<string>();
        pending.Push(directory);
        var result = new List<object>();
        var visited = 0;
        while (pending.Count > 0 && result.Count < max && visited < 10000)
        {
            var current = pending.Pop();
            using var lease = WorkspacePathLease.Acquire(current);
            WorkspaceResolver.RejectLinks(current);
            foreach (var entry in Directory.EnumerateFileSystemEntries(current))
            {
                if (++visited > 10000 || result.Count >= max) break;
                WorkspaceResolver.RejectLinks(entry);
                using var entryLease = WorkspacePathLease.Acquire(entry, includeFile: true);
                var isDirectory = Directory.Exists(entry);
                if (isDirectory && Bool(options, "recursive")) pending.Push(entry);
                if (extensions.Count > 0 && (isDirectory || !extensions.Contains(Path.GetExtension(entry)))) continue;
                result.Add(Describe(Path.GetRelativePath(Root, entry).Replace('\\', '/'), entry, true));
            }
        }
        return result;
    }

    private string Watch(string path, JsonElement options)
    {
        if (_watchers.Count >= 32) throw new IOException("Watch limit reached.");
        var target = WorkspaceResolver.ResolveRelative(Root, path, true);
        var isDirectory = Directory.Exists(target);
        if (!isDirectory && !File.Exists(target)) throw new FileNotFoundException();
        var handle = Guid.NewGuid().ToString("N");
        var extensions = Extensions(options);
        var watcher = new FileSystemWatcher(isDirectory ? target : Path.GetDirectoryName(target)!)
        {
            Filter = isDirectory ? "*" : Path.GetFileName(target),
            IncludeSubdirectories = isDirectory,
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size,
        };
        void Emit(string changedPath, string kind)
        {
            try
            {
                if (!WorkspaceResolver.IsInside(Root, changedPath)) return;
                WorkspaceResolver.RejectLinks(changedPath);
                if (extensions.Count > 0 && !extensions.Contains(Path.GetExtension(changedPath))) return;
                Changed?.Invoke(this, new(handle, Path.GetRelativePath(Root, changedPath).Replace('\\', '/'), kind));
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
        }
        watcher.Changed += (_, e) => Emit(e.FullPath, "changed");
        watcher.Created += (_, e) => Emit(e.FullPath, "created");
        watcher.Deleted += (_, e) => Emit(e.FullPath, "deleted");
        watcher.Renamed += (_, e) => { Emit(e.OldFullPath, "deleted"); Emit(e.FullPath, "created"); };
        watcher.Error += (_, _) => Changed?.Invoke(this, new(handle, path, "changed"));
        _watchers[handle] = watcher;
        watcher.EnableRaisingEvents = true;
        return handle;
    }

    private static bool Bool(JsonElement options, string name) =>
        options.ValueKind == JsonValueKind.Object && options.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;

    private static HashSet<string> Extensions(JsonElement options) =>
        options.ValueKind == JsonValueKind.Object && options.TryGetProperty("extensions", out var value)
            ? value.EnumerateArray().Select(item => item.GetString()!).ToHashSet(StringComparer.OrdinalIgnoreCase)
            : [];

    private void CreateParents(string target)
    {
        if (!Directory.Exists(Root)) throw new DirectoryNotFoundException("Workspace is unavailable.");
        using var rootLease = WorkspacePathLease.Acquire(Root, includeFile: true);
        WorkspaceResolver.RejectLinks(Root);
        var current = Root;
        foreach (var segment in Path.GetRelativePath(Root, target).Split(Path.DirectorySeparatorChar))
        {
            using var lease = WorkspacePathLease.Acquire(current);
            current = Path.Combine(current, segment);
            WorkspaceResolver.RejectLinks(current);
            Directory.CreateDirectory(current);
            WorkspaceResolver.RejectLinks(current);
        }
    }

    private async Task RemoveTransientAsync(string handle, CancellationToken cancellationToken)
    {
        if (!_transients.TryGetValue(handle, out var directory)) return;
        WorkspaceResolver.RejectLinks(directory);
        for (var attempt = 1; Directory.Exists(directory); attempt++)
        {
            try
            {
                Directory.Delete(directory, true);
            }
            catch (Exception error) when (
                (error is IOException or UnauthorizedAccessException) &&
                attempt < TransientDeleteAttempts)
            {
                await Task.Delay(TransientDeleteRetryDelayMilliseconds, cancellationToken);
            }
        }
        _transients.TryRemove(handle, out _);
        if (_transientLocks.TryRemove(handle, out var ownership)) ownership.Dispose();
        TryDeleteOwnershipFile(OwnershipFile(directory));
    }

    private string CreateTransient(string purpose)
    {
        var handle = Guid.NewGuid().ToString("N");
        var directory = Path.Combine(_transientRoot, $"markdstage-{purpose}-{handle}");
        using var lease = WorkspacePathLease.Acquire(_transientRoot, includeFile: true);
        var ownershipPath = OwnershipFile(directory);
        var ownership = new FileStream(ownershipPath, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None);
        try
        {
            Directory.CreateDirectory(directory);
            _transientLocks[handle] = ownership;
            _transients[handle] = directory;
            return handle;
        }
        catch
        {
            ownership.Dispose();
            TryDeleteOwnershipFile(ownershipPath);
            throw;
        }
    }

    private string OwnershipFile(string directory) =>
        Path.Combine(_transientRoot, "." + Path.GetFileName(directory) + ".lock");

    private static void TryDeleteOwnershipFile(string path)
    {
        try { File.Delete(path); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
    }

    private void SweepTransientDirectories()
    {
        foreach (var directory in Directory.EnumerateDirectories(_transientRoot, "markdstage-*"))
        {
            var name = Path.GetFileName(directory);
            var separator = name.LastIndexOf('-');
            if (separator < 0 || !Guid.TryParseExact(name[(separator + 1)..], "N", out _) ||
                name[..separator] is not ("markdstage-inspect" or "markdstage-capture" or "markdstage-pdf" or "markdstage-pptx" or "markdstage-present"))
                continue;
            var ownershipPath = OwnershipFile(directory);
            try
            {
                WorkspaceResolver.RejectLinks(directory);
                if (Directory.GetLastWriteTimeUtc(directory) >= DateTime.UtcNow.AddHours(-24)) continue;
                using (var lease = WorkspacePathLease.Acquire(_transientRoot, includeFile: true))
                {
                    WorkspaceResolver.RejectLinks(ownershipPath);
                    // The owner holds this sidecar exclusively for the directory's entire lifetime.
                    using var ownership = new FileStream(ownershipPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
                    WorkspaceResolver.RejectLinks(directory);
                    if (Directory.Exists(directory) && Directory.GetLastWriteTimeUtc(directory) < DateTime.UtcNow.AddHours(-24))
                        Directory.Delete(directory, true);
                }
                TryDeleteOwnershipFile(ownershipPath);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        await _operations.WaitAsync();
        await _writes.WaitAsync();
        try
        {
            foreach (var watcher in _watchers.Values) watcher.Dispose();
            _watchers.Clear();
            if (_browser is not null)
                foreach (var handle in _browsers.Keys)
                    try { await _browser.CloseAsync(handle, CancellationToken.None); }
                    catch (Exception) { }
            foreach (var handle in _transients.Keys)
                try { await RemoveTransientAsync(handle, CancellationToken.None); }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
            foreach (var ownership in _transientLocks.Values) ownership.Dispose();
            _transientLocks.Clear();
        }
        finally { _writes.Release(); _operations.Release(); }
    }
}
