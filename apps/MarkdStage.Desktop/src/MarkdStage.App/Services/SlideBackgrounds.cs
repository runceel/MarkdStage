using MarkdStage.Core;

namespace MarkdStageApp.Services;

internal static class SlideBackgrounds
{
    internal const long MaxBytes = 2 * 1024 * 1024;

    public static string Parse(string value)
    {
        var path = value.Trim();
        if (path.StartsWith("assets/", StringComparison.Ordinal))
        {
            path = "/" + path;
        }

        if (!path.StartsWith("/assets/", StringComparison.Ordinal) ||
            path.Any(character => character < ' ' || character == '\u007f' ||
                character is '\\' or ':' or '?' or '#') ||
            path["/assets/".Length..].Split('/').Any(segment =>
                segment.Length == 0 || segment is "." or "..") ||
            !IsSupportedImage(path))
        {
            throw new DeckLoadException(
                "Invalid background-image: use a local /assets/... SVG, PNG, WebP, JPG, or JPEG path.");
        }

        // Percent sequences are literal filename characters, not URL escapes.
        return path;
    }

    public static bool IsSupportedImage(string path) =>
        Path.GetExtension(path).ToLowerInvariant() is ".svg" or ".png" or ".webp" or ".jpg" or ".jpeg";

    public static string Resolve(string sourcePath, string workspaceRoot, string value)
    {
        var path = Parse(value);
        try
        {
            var resolved = DeckAssetResolver.Resolve(sourcePath, workspaceRoot, path["/assets/".Length..])
                ?? throw new DeckLoadException($"Background image was not found: {path}");
            if (!IsSupportedImage(resolved) || new FileInfo(resolved).Length > MaxBytes)
            {
                throw new DeckLoadException(
                    $"Background image must use a supported image format and be 2 MiB or smaller: {path}");
            }

            return resolved;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
        {
            throw new DeckLoadException($"Background image could not be read: {path}", error);
        }
    }

    public static void Validate(DeckDocument document, string sourcePath, string workspaceRoot)
    {
        for (var index = 0; index < document.Slides.Count; index++)
        {
            var metadata = MarkdownDeckParser.GetFragmentMetadata(document.Slides[index]);
            if (!metadata.TryGetValue("background-image", out var value))
            {
                continue;
            }

            try
            {
                Resolve(sourcePath, workspaceRoot, value);
            }
            catch (DeckLoadException error)
            {
                throw new DeckLoadException($"Slide {index + 1}: {error.Message}", error);
            }
        }
    }
}
