namespace MarkdStageApp.Services;

internal static class DeckAssetResolver
{
    public static string? Resolve(string sourcePath, string workspaceRoot, string relativePath)
    {
        if (string.IsNullOrWhiteSpace(sourcePath) ||
            string.IsNullOrWhiteSpace(workspaceRoot))
        {
            return null;
        }

        var relativeSource = Path.GetRelativePath(workspaceRoot, sourcePath);
        if (Path.IsPathRooted(relativeSource) ||
            relativeSource == ".." ||
            relativeSource.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal))
        {
            return null;
        }

        foreach (var root in new[]
                 {
                     Path.Combine(Path.GetDirectoryName(sourcePath)!, "assets"),
                     Path.Combine(workspaceRoot, "assets"),
                 }.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!Directory.Exists(root))
            {
                continue;
            }

            if (!PathSecurity.IsInside(workspaceRoot, root))
            {
                return null;
            }

            var resolved = PathSecurity.ResolveFileInside(root, relativePath);
            if (resolved is not null)
            {
                return resolved;
            }

            if (File.Exists(Path.Combine(root, relativePath)))
            {
                return null;
            }
        }

        return null;
    }
}
