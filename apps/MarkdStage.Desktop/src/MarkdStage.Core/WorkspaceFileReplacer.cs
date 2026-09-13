namespace MarkdStage.Core;

// Replacing an output file fails while another application holds it open. Those
// locks are usually short lived (PowerPoint saving, a preview handler, a sync
// client), so the replacement is retried a bounded number of times before the
// port reports a distinguishable "locked" failure.
public static class WorkspaceFileReplacer
{
    public const int MaxAttempts = 5;
    private static readonly TimeSpan RetryDelay = TimeSpan.FromMilliseconds(60);

    public static bool IsSharingViolation(Exception error) => error is IOException failure &&
        (OperatingSystem.IsWindows()
            // ERROR_SHARING_VIOLATION (32) and ERROR_LOCK_VIOLATION (33).
            ? (failure.HResult & 0xFFFF) is 32 or 33
            // EBUSY (16) and ETXTBSY (26).
            : (failure.HResult & 0xFFFF) is 16 or 26);

    public static Task ReplaceAsync(string staging, string target, bool overwrite, CancellationToken cancellationToken) =>
        ReplaceAsync(() => File.Move(staging, target, overwrite), Task.Delay, cancellationToken);

    internal static async Task ReplaceAsync(
        Action move,
        Func<TimeSpan, CancellationToken, Task> delay,
        CancellationToken cancellationToken)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                move();
                return;
            }
            // The staged file is left in place for the caller to delete, so a
            // failed attempt never leaves the existing output truncated.
            catch (IOException error) when (IsSharingViolation(error) && attempt < MaxAttempts)
            {
                await delay(RetryDelay * attempt, cancellationToken);
            }
        }
    }
}
