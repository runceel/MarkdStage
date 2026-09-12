namespace MarkdStageApp.Services;

internal sealed class DeckLoadException : Exception
{
    public DeckLoadException(string message) : base(message) { }
    public DeckLoadException(string message, Exception innerException) : base(message, innerException) { }
}
