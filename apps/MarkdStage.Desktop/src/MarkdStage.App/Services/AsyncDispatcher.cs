namespace MarkdStageApp.Services;

internal sealed class AsyncDispatcher(
    Func<bool> hasThreadAccess,
    Func<Action, bool> tryEnqueue)
{
    public Task InvokeAsync(Func<Task> action) =>
        InvokeAsync(async () =>
        {
            await action();
            return true;
        });

    public Task<T> InvokeAsync<T>(Func<Task<T>> action)
    {
        if (hasThreadAccess())
        {
            return action();
        }

        var completion = new TaskCompletionSource<T>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        if (!tryEnqueue(async () =>
            {
                try
                {
                    completion.TrySetResult(await action());
                }
                catch (Exception error)
                {
                    completion.TrySetException(error);
                }
            }))
        {
            completion.TrySetException(
                new InvalidOperationException("The application window is no longer available."));
        }

        return completion.Task;
    }
}
