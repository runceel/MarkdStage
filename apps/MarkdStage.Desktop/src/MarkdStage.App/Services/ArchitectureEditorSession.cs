using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using MarkdStage.Core;

namespace MarkdStageApp.Services;

internal sealed partial class ArchitectureEditorSession
{
    public const int MaxDraftBytes = 256 * 1024;
    public const int MaxArchitectureSourceCharacters = 64 * 1024;
    public const int MaxMarkdownBytes = 2 * 1024 * 1024;
    public const int MaxAssetBytes = 10 * 1024 * 1024;

    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Func<Task>? _onSaved;
    private string _baseMarkdown = string.Empty;
    private string _savedSource = string.Empty;

    private ArchitectureEditorSession(
        string workspaceRoot,
        string sourceFile,
        string relativeSourcePath,
        int blockIndex,
        string theme,
        Func<Task>? onSaved)
    {
        WorkspaceRoot = workspaceRoot;
        SourceFile = sourceFile;
        SourcePath = relativeSourcePath.Replace('\\', '/');
        BlockIndex = blockIndex;
        Theme = NormalizeTheme(theme);
        _onSaved = onSaved;
    }

    public string Id { get; } = Guid.NewGuid().ToString("N");
    public string WorkspaceRoot { get; }
    public string SourceFile { get; }
    public string SourcePath { get; }
    public int BlockIndex { get; }
    public string Source { get; private set; } = string.Empty;
    public int Generation { get; private set; }
    public int DraftRevision { get; private set; }
    public bool Dirty => Source != _savedSource;
    public long Version { get; private set; }
    public string Theme { get; private set; }
    public event EventHandler<long>? Changed;

    public static async Task<ArchitectureEditorSession> CreateAsync(
        PresentationSnapshot snapshot,
        int blockIndex,
        Func<Task>? onSaved = null)
    {
        var (root, source, relative) = ResolveTarget(snapshot);
        var editor = new ArchitectureEditorSession(
            root, source, relative, blockIndex, snapshot.Theme.Name, onSaved);
        var loaded = await editor.ReloadAsync(discard: true);
        if (loaded.StatusCode >= 400)
            throw new ArchitectureEditorException(
                loaded.Error ?? "editor_open_failed",
                loaded.Message ?? "Architecture Editor could not be opened.");
        return editor;
    }

    public object GetState() => new
    {
        version = Version,
        sourcePath = SourcePath,
        blockIndex = BlockIndex,
        source = Source,
        generation = Generation,
        draftRevision = DraftRevision,
        dirty = Dirty,
        theme = Theme,
    };

    public void SetTheme(string theme) => Theme = NormalizeTheme(theme);

    public async Task<EditorResult> UpdateDraftAsync(string source, int generation, int revision)
    {
        await _gate.WaitAsync();
        try
        {
            if (Encoding.UTF8.GetByteCount(source) > MaxDraftBytes)
                return EditorResult.Fail(413, "source_file_too_large", "The diagram source is too large to edit.");
            if (generation != Generation)
                return EditorResult.Fail(409, "stale_generation", "The editor target was reloaded. Refresh before editing.");
            if (revision <= DraftRevision)
                return EditorResult.Fail(409, "stale_draft", "This draft revision is stale. Reload the editor state before editing.");
            var invalid = ValidateArchitecture(source);
            if (invalid is not null) return invalid;

            Source = source;
            DraftRevision = revision;
            Version++;
            Changed?.Invoke(this, Version);
            return EditorResult.Ok(new
            {
                ok = true,
                revision = DraftRevision,
                dirty = Dirty,
                version = Version,
            });
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<EditorResult> SaveAsync(int generation, int revision)
    {
        await _gate.WaitAsync();
        try
        {
            if (generation != Generation)
                return EditorResult.Fail(409, "stale_generation", "The editor target was reloaded. Refresh before saving.");
            if (revision != DraftRevision)
                return EditorResult.Fail(409, "stale_revision", "The draft changed before saving. Save again to use the latest revision.");
            var invalid = ValidateArchitecture(Source);
            if (invalid is not null) return invalid;

            var target = ResolveExistingTarget(WorkspaceRoot, SourceFile);
            byte[] currentBytes;
            using (var lockedSource = new FileStream(
                target, FileMode.Open, FileAccess.ReadWrite, FileShare.Read,
                65536, FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                if (lockedSource.Length > MaxMarkdownBytes)
                    return EditorResult.Fail(413, "source_file_too_large", "The Markdown file is too large to edit.");
                currentBytes = new byte[lockedSource.Length];
                await lockedSource.ReadExactlyAsync(currentBytes);
                var currentMarkdown = Encoding.UTF8.GetString(currentBytes);
                if (currentMarkdown != _baseMarkdown)
                    return EditorResult.Fail(409, "source_changed", "The source Markdown changed outside the editor. Reload before saving.");

                var next = ReplaceArchitectureBlock(currentMarkdown, BlockIndex, Source);
                if (next is null)
                    return EditorResult.Fail(404, "block_not_found", "The Architecture block no longer exists.");
                var nextBytes = Encoding.UTF8.GetBytes(next);
                if (nextBytes.Length > MaxMarkdownBytes)
                    return EditorResult.Fail(413, "source_file_too_large", "The Markdown file is too large to edit.");

                try
                {
                    lockedSource.Position = 0;
                    await lockedSource.WriteAsync(nextBytes);
                    lockedSource.SetLength(nextBytes.Length);
                    await lockedSource.FlushAsync();
                }
                catch
                {
                    lockedSource.Position = 0;
                    await lockedSource.WriteAsync(currentBytes);
                    lockedSource.SetLength(currentBytes.Length);
                    await lockedSource.FlushAsync();
                    throw;
                }
                _baseMarkdown = next;
            }

            _savedSource = Source;
            Version++;
            Changed?.Invoke(this, Version);
            if (_onSaved is not null) await _onSaved();
            return EditorResult.Ok(new
            {
                ok = true,
                sourcePath = SourcePath,
                blockIndex = BlockIndex,
                generation = Generation,
                savedRevision = DraftRevision,
                dirty = Dirty,
                version = Version,
            });
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return EditorResult.Fail(500, "source_write_failed", error.Message);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<EditorResult> ReloadAsync(bool discard)
    {
        await _gate.WaitAsync();
        try
        {
            if (Dirty && !discard)
                return EditorResult.Fail(409, "unsaved_changes", "The editor has unsaved changes. Save or explicitly discard them before reloading.");
            var target = ResolveExistingTarget(WorkspaceRoot, SourceFile);
            var info = new FileInfo(target);
            if (info.Length > MaxMarkdownBytes)
                return EditorResult.Fail(413, "source_file_too_large", "The Markdown file is too large to edit.");
            var markdown = Encoding.UTF8.GetString(await File.ReadAllBytesAsync(target));
            var block = FindArchitectureBlocks(markdown).ElementAtOrDefault(BlockIndex);
            if (block is null)
                return EditorResult.Fail(404, "block_not_found", "The Architecture block was not found.");
            var invalid = ValidateArchitecture(block.Body);
            if (invalid is not null) return invalid;

            _baseMarkdown = markdown;
            _savedSource = block.Body;
            Source = block.Body;
            DraftRevision = 0;
            Generation++;
            Version++;
            Changed?.Invoke(this, Version);
            return EditorResult.Ok(new
            {
                ok = true,
                version = Version,
                generation = Generation,
                dirty = Dirty,
            });
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return EditorResult.Fail(404, "source_file_not_found", error.Message);
        }
        finally
        {
            _gate.Release();
        }
    }

    public IReadOnlyList<object> ListAssets()
    {
        var assets = new List<object>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var root in AssetRoots())
        {
            if (!Directory.Exists(root)) continue;
            foreach (var file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)
                .OrderBy(path => path, StringComparer.OrdinalIgnoreCase))
            {
                if (assets.Count >= 1000) return assets;
                var extension = Path.GetExtension(file).ToLowerInvariant();
                if (!SupportedAssetExtensions.Contains(extension)) continue;
                var info = new FileInfo(file);
                if (info.Length > MaxAssetBytes || !PathSecurity.IsInside(root, file)) continue;
                var relative = Path.GetRelativePath(root, file).Replace('\\', '/');
                var path = $"assets/{relative}";
                if (seen.Add(path)) assets.Add(new { path, size = info.Length });
            }
        }
        return assets;
    }

    public string? ResolveAsset(string relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath) ||
            relativePath.Contains('\0') ||
            Path.IsPathRooted(relativePath))
            return null;
        var normalized = relativePath.Replace('/', Path.DirectorySeparatorChar);
        if (!SupportedAssetExtensions.Contains(Path.GetExtension(normalized).ToLowerInvariant()))
            return null;
        foreach (var root in AssetRoots())
        {
            var candidate = Path.Combine(root, normalized);
            if (File.Exists(candidate) && new FileInfo(candidate).Length <= MaxAssetBytes &&
                PathSecurity.IsInside(root, candidate))
                return PathSecurity.CanonicalizeExisting(candidate);
        }
        return null;
    }

    public async Task<EditorResult> ImportAssetAsync(string filename, string? contentType, Stream body, long? contentLength)
    {
        if (contentLength is > MaxAssetBytes)
            return EditorResult.Fail(413, "asset_too_large", "Images must be 10 MB or smaller.");
        using var memory = new MemoryStream();
        var buffer = new byte[65536];
        while (true)
        {
            var read = await body.ReadAsync(buffer);
            if (read == 0) break;
            if (memory.Length + read > MaxAssetBytes)
                return EditorResult.Fail(413, "asset_too_large", "Images must be 10 MB or smaller.");
            await memory.WriteAsync(buffer.AsMemory(0, read));
        }
        var bytes = memory.ToArray();
        if (bytes.Length == 0)
            return EditorResult.Fail(400, "empty_asset", "Choose a non-empty image file.");

        var normalized = NormalizeAssetName(filename);
        if (normalized is null)
            return EditorResult.Fail(415, "unsupported_asset_type", "Only SVG, PNG, WebP, JPG, and JPEG images can be imported.");
        var (stem, extension) = normalized.Value;
        if (!ContentTypeMatches(extension, contentType))
            return EditorResult.Fail(415, "asset_content_type_mismatch", "The image content type does not match its extension.");
        if (!SignatureMatches(extension, bytes))
            return EditorResult.Fail(415, "asset_signature_mismatch", $"The file contents do not match the {extension} image format.");

        var assetRoot = Path.Combine(WorkspaceRoot, "assets");
        Directory.CreateDirectory(assetRoot);
        if (!PathSecurity.IsInside(WorkspaceRoot, assetRoot))
            return EditorResult.Fail(403, "asset_root_outside_workspace", "The assets folder must resolve inside the workspace.");
        for (var index = 1; index < 10000; index++)
        {
            var suffix = index == 1 ? "" : $"-{index}";
            var name = $"{stem}{suffix}{extension}";
            var target = Path.Combine(assetRoot, name);
            try
            {
                await using var output = new FileStream(
                    target, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                    65536, FileOptions.Asynchronous | FileOptions.WriteThrough);
                await output.WriteAsync(bytes);
                await output.FlushAsync();
                return EditorResult.Ok(new
                {
                    ok = true,
                    asset = new { path = $"assets/{name}", size = bytes.Length },
                }, 201);
            }
            catch (IOException) when (File.Exists(target))
            {
            }
        }
        return EditorResult.Fail(500, "asset_name_exhausted", "A unique filename could not be allocated.");
    }

    public static int? ImportedBlockIndex(IReadOnlyList<string> slides, int slideIndex, int blockIndex)
    {
        if (slideIndex < 0 || slideIndex >= slides.Count || blockIndex < 0) return null;
        var local = FindArchitectureBlocks(slides[slideIndex]);
        if (blockIndex >= local.Count) return null;
        var result = blockIndex;
        for (var index = 0; index < slideIndex; index++)
            result += FindArchitectureBlocks(slides[index]).Count;
        return result;
    }

    private IEnumerable<string> AssetRoots()
    {
        var sourceDirectory = Path.GetDirectoryName(SourceFile)!;
        yield return Path.Combine(sourceDirectory, "assets");
        if (!sourceDirectory.Equals(WorkspaceRoot, StringComparison.OrdinalIgnoreCase))
            yield return Path.Combine(WorkspaceRoot, "assets");
    }

    private static (string Root, string Source, string Relative) ResolveTarget(PresentationSnapshot snapshot)
    {
        if (string.IsNullOrWhiteSpace(snapshot.WorkspaceRoot) ||
            string.IsNullOrWhiteSpace(snapshot.SourcePath))
            throw new ArchitectureEditorException("source_not_available", "A source-backed Markdown deck is required.");
        var root = PathSecurity.CanonicalizeExisting(snapshot.WorkspaceRoot);
        var source = ResolveExistingTarget(root, snapshot.SourcePath);
        var extension = Path.GetExtension(source);
        if (!extension.Equals(".md", StringComparison.OrdinalIgnoreCase) &&
            !extension.Equals(".markdown", StringComparison.OrdinalIgnoreCase))
            throw new ArchitectureEditorException("invalid_source_path", "The source must be a Markdown file.");
        return (root, source, Path.GetRelativePath(root, source));
    }

    private static string ResolveExistingTarget(string root, string source)
    {
        var target = PathSecurity.CanonicalizeExisting(source);
        if (!File.Exists(target) || !PathSecurity.IsInside(root, target))
            throw new ArchitectureEditorException("invalid_source_path", "The source must resolve directly to a Markdown file inside the workspace.");
        return target;
    }

    private static EditorResult? ValidateArchitecture(string source)
    {
        if (Encoding.UTF8.GetByteCount(source) > MaxDraftBytes)
            return EditorResult.Fail(413, "source_file_too_large", "The diagram source is too large to edit.");
        if (source.Length > MaxArchitectureSourceCharacters)
            return EditorResult.Fail(422, "invalid_architecture", "The diagram must be at most 65536 characters.");
        if (string.IsNullOrWhiteSpace(source)) return null;
        try
        {
            using var document = JsonDocument.Parse(source);
            if (document.RootElement.ValueKind != JsonValueKind.Object ||
                !document.RootElement.TryGetProperty("version", out var version) ||
                version.ValueKind != JsonValueKind.Number ||
                !version.TryGetInt32(out var versionNumber) ||
                versionNumber != 1 ||
                !document.RootElement.TryGetProperty("elements", out var elements) ||
                elements.ValueKind != JsonValueKind.Array)
                return EditorResult.Fail(422, "invalid_architecture", "Architecture DSL requires version 1 and an elements array.");
            return null;
        }
        catch (JsonException error)
        {
            return EditorResult.Fail(422, "invalid_architecture", error.Message);
        }
    }

    private static string NormalizeTheme(string theme) =>
        theme is "light" or "microsoft" ? theme : "dark";

    private static (string Stem, string Extension)? NormalizeAssetName(string filename)
    {
        var name = Path.GetFileName(filename);
        var extension = Path.GetExtension(name).ToLowerInvariant();
        if (!SupportedAssetExtensions.Contains(extension)) return null;
        var rawStem = Path.GetFileNameWithoutExtension(name).Normalize(NormalizationForm.FormD);
        var stem = Regex.Replace(rawStem, @"[\u0300-\u036f]", "");
        stem = Regex.Replace(stem, @"[^A-Za-z0-9._-]+", "-");
        stem = Regex.Replace(stem, @"^[^A-Za-z0-9]+|[-_.]+$", "");
        if (stem.Length > 160) stem = stem[..160];
        return (string.IsNullOrEmpty(stem) ? "image" : stem, extension);
    }

    private static bool ContentTypeMatches(string extension, string? contentType)
    {
        var value = (contentType ?? "").Split(';')[0].Trim().ToLowerInvariant();
        if (value is "" or "application/octet-stream") return true;
        return extension switch
        {
            ".svg" => value is "image/svg+xml" or "text/xml" or "application/xml",
            ".png" => value == "image/png",
            ".webp" => value == "image/webp",
            ".jpg" or ".jpeg" => value == "image/jpeg",
            _ => false,
        };
    }

    private static bool SignatureMatches(string extension, byte[] bytes) =>
        extension switch
        {
            ".png" => bytes.AsSpan().StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }),
            ".jpg" or ".jpeg" => bytes.AsSpan().StartsWith(new byte[] { 0xff, 0xd8, 0xff }),
            ".webp" => bytes.Length >= 12 &&
                       bytes.AsSpan(0, 4).SequenceEqual("RIFF"u8) &&
                       bytes.AsSpan(8, 4).SequenceEqual("WEBP"u8),
            ".svg" => SvgStart().IsMatch(Encoding.UTF8.GetString(bytes, 0, Math.Min(bytes.Length, 16 * 1024))),
            _ => false,
        };

    private static string? ReplaceArchitectureBlock(string markdown, int blockIndex, string source)
    {
        var blocks = FindArchitectureBlocks(markdown);
        if (blockIndex < 0 || blockIndex >= blocks.Count) return null;
        var block = blocks[blockIndex];
        var body = source.Replace("\r\n", "\n").Replace('\r', '\n').TrimEnd();
        var inserted = body.Length == 0
            ? string.Empty
            : string.Join(block.Eol, body.Split('\n').Select(line =>
                block.Indent.Length > 0 && line.Length > 0 ? block.Indent + line : line)) + block.Eol;
        return markdown[..block.BodyStart] + inserted + markdown[block.BodyEnd..];
    }

    private static List<ArchitectureBlock> FindArchitectureBlocks(string markdown)
    {
        var lines = SplitLines(markdown);
        var result = new List<ArchitectureBlock>();
        for (var index = 0; index < lines.Count; index++)
        {
            var open = FenceOpen().Match(lines[index].Text);
            if (!open.Success) continue;
            var marker = open.Groups["marker"].Value;
            var closePattern = new Regex(
                $@"^[ \t]{{0,3}}{Regex.Escape(marker[0].ToString())}{{{marker.Length},}}[ \t]*$",
                RegexOptions.CultureInvariant);
            var end = index + 1;
            while (end < lines.Count && !closePattern.IsMatch(lines[end].Text)) end++;
            if (open.Groups["info"].Value.Equals("architecture", StringComparison.OrdinalIgnoreCase))
            {
                var bodyStart = lines[index].Start + lines[index].Text.Length + lines[index].Eol.Length;
                var bodyEnd = end < lines.Count ? lines[end].Start : markdown.Length;
                var rawBody = markdown[bodyStart..bodyEnd];
                var body = rawBody.Replace("\r\n", "\n").Replace('\r', '\n').TrimEnd('\n');
                var indent = open.Groups["indent"].Value;
                if (indent.Length > 0)
                    body = string.Join("\n", body.Split('\n').Select(line =>
                        line.StartsWith(indent, StringComparison.Ordinal) ? line[indent.Length..] : line));
                result.Add(new ArchitectureBlock(
                    bodyStart, bodyEnd, indent,
                    lines[index].Eol.Length > 0 ? lines[index].Eol : DominantEol(lines),
                    body));
            }
            index = end;
        }
        return result;
    }

    private static List<MarkdownLine> SplitLines(string text)
    {
        var lines = new List<MarkdownLine>();
        var start = 0;
        for (var index = 0; index < text.Length; index++)
        {
            if (text[index] is not ('\r' or '\n')) continue;
            var eolLength = text[index] == '\r' && index + 1 < text.Length && text[index + 1] == '\n' ? 2 : 1;
            lines.Add(new MarkdownLine(start, text[start..index], text.Substring(index, eolLength)));
            index += eolLength - 1;
            start = index + 1;
        }
        lines.Add(new MarkdownLine(start, text[start..], ""));
        return lines;
    }

    private static string DominantEol(IEnumerable<MarkdownLine> lines) =>
        lines.Count(line => line.Eol == "\r\n") > lines.Count(line => line.Eol == "\n") ? "\r\n" : "\n";

    private static readonly HashSet<string> SupportedAssetExtensions =
        new(StringComparer.OrdinalIgnoreCase) { ".svg", ".png", ".webp", ".jpg", ".jpeg" };

    [GeneratedRegex(@"^(?<indent>[ \t]{0,3})(?<marker>`{3,}|~{3,})[ \t]*(?<info>[^\s`~]*)[ \t]*$", RegexOptions.CultureInvariant)]
    private static partial Regex FenceOpen();

    [GeneratedRegex(@"^\uFEFF?\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex SvgStart();

    private sealed record MarkdownLine(int Start, string Text, string Eol);
    private sealed record ArchitectureBlock(int BodyStart, int BodyEnd, string Indent, string Eol, string Body);
}

internal sealed record EditorResult(
    int StatusCode,
    object Body,
    string? Error = null,
    string? Message = null)
{
    public static EditorResult Ok(object body, int statusCode = 200) => new(statusCode, body);
    public static EditorResult Fail(int statusCode, string error, string message) =>
        new(statusCode, new { ok = false, error, message }, error, message);
}

internal sealed class ArchitectureEditorException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
