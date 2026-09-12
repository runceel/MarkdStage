using System.Text.RegularExpressions;

namespace MarkdStageApp.Services;

internal static partial class ThemeService
{
    internal static string ResolveAsset(string themeDirectory, string relative)
    {
        if (!ThemeAssetRegex().IsMatch(relative))
            throw new DeckLoadException($"Invalid custom theme asset path: {relative}");
        try
        {
            var asset = PathSecurity.ResolveFileInside(themeDirectory, relative)
                ?? throw new DeckLoadException($"Custom theme asset was not found: {relative}");
            if (!SlideBackgrounds.IsSupportedImage(asset) || new FileInfo(asset).Length > 2 * 1024 * 1024)
                throw new DeckLoadException($"Custom theme asset must use a supported image format and be 2 MiB or smaller: {relative}");
            return asset;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
        {
            throw new DeckLoadException($"Custom theme asset could not be read: {relative}", error);
        }
    }

    [GeneratedRegex(
        @"^assets/(?:[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*/)*[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*\.(?:svg|png|webp|jpg|jpeg)$",
        RegexOptions.IgnoreCase)]
    private static partial Regex ThemeAssetRegex();
}
