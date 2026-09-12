namespace MarkdStage.Core;

public static class WorkspaceResolver
{
    public static string Resolve(string? workspace, string? file = null)
    {
        if (workspace is null && file is null)
            throw new ArgumentException("Choose a workspace with --workspace.");
        if (workspace is not null && !Path.IsPathFullyQualified(workspace) ||
            file is not null && !Path.IsPathFullyQualified(file))
            throw new ArgumentException("Workspace resolution requires absolute paths.");

        if (workspace is null)
        {
            var directory = new DirectoryInfo(Path.GetDirectoryName(file!)!);
            workspace = directory.FullName;
            for (var current = directory; current is not null; current = current.Parent)
            {
                var marker = Path.Combine(current.FullName, ".git");
                if (!Directory.Exists(marker) && !File.Exists(marker)) continue;
                workspace = current.FullName;
                break;
            }
        }
        var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(workspace));
        RejectLinks(root);
        if (!Directory.Exists(root)) throw new DirectoryNotFoundException("Workspace is unavailable.");
        root = Path.TrimEndingDirectorySeparator(WorkspacePathLease.CanonicalizeExisting(root));
        if (file is not null)
        {
            var candidate = Path.GetFullPath(file);
            if (Directory.Exists(Path.GetDirectoryName(candidate)))
                candidate = Path.Combine(WorkspacePathLease.CanonicalizeExisting(Path.GetDirectoryName(candidate)!), Path.GetFileName(candidate));
            if (!IsInside(root, candidate))
                throw new UnauthorizedAccessException("The file must stay inside the workspace.");
            RejectLinks(file);
        }
        return root;
    }

    public static bool IsInside(string root, string candidate)
    {
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        var prefix = Path.EndsInDirectorySeparator(root) ? root : root + Path.DirectorySeparatorChar;
        return candidate.Equals(root, comparison) ||
            candidate.StartsWith(prefix, comparison);
    }

    public static void RejectLinks(string path)
    {
        var fullPath = Path.GetFullPath(path);
        var current = Path.GetPathRoot(fullPath)!;
        foreach (var segment in fullPath[current.Length..].Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, segment);
            try
            {
                if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new UnauthorizedAccessException("Links are not allowed in workspace paths.");
            }
            catch (FileNotFoundException) { break; }
            catch (DirectoryNotFoundException) { break; }
        }
    }

    public static string ResolveRelative(string root, string path, bool allowRoot = false)
    {
        if (path is null || path.Contains('\\') || path.Contains(':') || path.Any(character => character < ' ' || character == '\u007f') ||
            Path.IsPathRooted(path) || path.Length > 0 && path.Split('/').Any(segment =>
                segment is "" or "." or ".." || segment.EndsWith(' ') || segment.EndsWith('.') ||
                IsDeviceName(segment) ||
                segment.IndexOfAny(['<', '>', '"', '|', '?', '*']) >= 0))
            throw new UnauthorizedAccessException("The path must stay inside the workspace.");
        if (string.IsNullOrEmpty(path) && !allowRoot)
            throw new UnauthorizedAccessException("A workspace-relative file path is required.");
        var result = Path.GetFullPath(Path.Combine(root, path));
        if (!IsInside(root, result) || !allowRoot && result == root)
            throw new UnauthorizedAccessException("The path must stay inside the workspace.");
        RejectLinks(result);
        return result;
    }

    private static bool IsDeviceName(string segment)
    {
        var name = segment.Split(['.', ' '], 2)[0].ToUpperInvariant();
        return name is "CON" or "PRN" or "AUX" or "NUL" or "CLOCK$" or "CONIN$" or "CONOUT$" ||
            name.Length == 4 && (name.StartsWith("COM") || name.StartsWith("LPT")) && "123456789¹²³".Contains(name[3]);
    }
}
