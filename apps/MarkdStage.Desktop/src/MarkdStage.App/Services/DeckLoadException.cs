namespace MarkdStageApp.Services;

internal sealed class DeckLoadException : Exception
{
    public DeckLoadException(string message, string code = "runtime_failed") : base(message)
    {
        Code = code;
    }

    public DeckLoadException(
        string message,
        Exception innerException,
        string code = "runtime_failed") : base(message, innerException)
    {
        Code = code;
    }

    public string Code { get; }
}
