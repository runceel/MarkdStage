using MarkdStage.Core;

namespace MarkdStageApp.Services;

internal static class LegacyBackgroundValidation
{
    public static void Validate(DeckDocument document, string sourcePath, string workspaceRoot)
    {
        for (var index = 0; index < document.Slides.Count; index++)
        {
            var metadata = MarkdownDeckParser.GetFragmentMetadata(document.Slides[index]);
            if (!metadata.TryGetValue("background-image", out var value)) continue;
            try { SlideBackgrounds.Resolve(sourcePath, workspaceRoot, value); }
            catch (DeckLoadException error) { throw new DeckLoadException($"Slide {index + 1}: {error.Message}", error); }
        }
    }
}
