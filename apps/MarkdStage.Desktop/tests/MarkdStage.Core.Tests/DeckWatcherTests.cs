using MarkdStageApp.Services;

namespace MarkdStage.Core.Tests;

public sealed class DeckWatcherTests
{
    [Fact]
    public async Task RapidSavesCanBeReopenedWithoutDisposedCancellationErrors()
    {
        var directory = Path.Combine(Directory.GetCurrentDirectory(), ".watcher-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, "deck.md");
        File.WriteAllText(path, "# Original");
        try
        {
            await using var watcher = new DeckWatcher();
            for (var iteration = 0; iteration < 4; iteration++)
            {
                var reloaded = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                await watcher.WatchAsync(path, _ =>
                {
                    reloaded.TrySetResult();
                    return Task.CompletedTask;
                });
                for (var save = 0; save < 100; save++)
                    File.WriteAllText(path, $"# Save {save}");
                await reloaded.Task.WaitAsync(TimeSpan.FromSeconds(10));
                await watcher.StopAsync();
            }
        }
        finally { Directory.Delete(directory, true); }
    }
}
