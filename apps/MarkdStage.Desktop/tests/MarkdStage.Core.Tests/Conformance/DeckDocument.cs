namespace MarkdStage.Core;

public sealed record DeckDocument(
    IReadOnlyList<string> Slides,
    IReadOnlyDictionary<string, string> Metadata,
    string Theme,
    string ThemeFile);
