using MarkdStageApp.Services;

namespace MarkdStage.Core.Tests;

public sealed class AsyncDispatcherTests
{
    [Fact]
    public async Task InvokeAsyncRunsImmediatelyWhenThreadHasAccess()
    {
        var enqueued = false;
        var dispatcher = new AsyncDispatcher(
            () => true,
            _ =>
            {
                enqueued = true;
                return true;
            });

        var result = await dispatcher.InvokeAsync(() => Task.FromResult(42));

        Assert.Equal(42, result);
        Assert.False(enqueued);
    }

    [Fact]
    public async Task InvokeAsyncAwaitsEnqueuedOperation()
    {
        Action? queued = null;
        var operation = new TaskCompletionSource<int>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        var dispatcher = new AsyncDispatcher(
            () => false,
            action =>
            {
                queued = action;
                return true;
            });

        var result = dispatcher.InvokeAsync(() => operation.Task);
        Assert.NotNull(queued);
        Assert.False(result.IsCompleted);

        queued();
        operation.SetResult(42);

        Assert.Equal(42, await result);
    }

    [Fact]
    public async Task InvokeAsyncPropagatesEnqueuedOperationFailure()
    {
        Action? queued = null;
        var dispatcher = new AsyncDispatcher(
            () => false,
            action =>
            {
                queued = action;
                return true;
            });
        var failure = new IOException("Presenter failed.");

        var result = dispatcher.InvokeAsync<int>(() => Task.FromException<int>(failure));
        Assert.NotNull(queued);
        queued();

        Assert.Same(failure, await Assert.ThrowsAsync<IOException>(() => result));
    }

    [Fact]
    public async Task InvokeAsyncFailsWhenDispatcherRejectsWork()
    {
        var dispatcher = new AsyncDispatcher(() => false, _ => false);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(
            () => dispatcher.InvokeAsync(() => Task.CompletedTask));

        Assert.Equal("The application window is no longer available.", error.Message);
    }
}
