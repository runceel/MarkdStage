namespace MarkdStage.Core.Tests;

public sealed class WorkspaceFileReplacerTests
{
    private static IOException SharingViolation() =>
        // ERROR_SHARING_VIOLATION on Windows, EBUSY elsewhere.
        new("The process cannot access the file.") { HResult = OperatingSystem.IsWindows() ? unchecked((int)0x80070020) : 16 };

    private static IOException UnrelatedFailure() =>
        new("The device is not ready.") { HResult = OperatingSystem.IsWindows() ? unchecked((int)0x80070015) : 5 };

    [Fact]
    public void ClassifiesSharingViolationsWithoutSwallowingOtherFailures()
    {
        Assert.True(WorkspaceFileReplacer.IsSharingViolation(SharingViolation()));
        Assert.False(WorkspaceFileReplacer.IsSharingViolation(UnrelatedFailure()));
        Assert.False(WorkspaceFileReplacer.IsSharingViolation(new UnauthorizedAccessException()));
    }

    [Fact]
    public async Task RetriesShortLivedSharingViolationsUntilTheLockIsReleased()
    {
        var attempts = 0;
        var delays = 0;
        await WorkspaceFileReplacer.ReplaceAsync(
            () => { if (++attempts < 3) throw SharingViolation(); },
            (_, _) => { delays++; return Task.CompletedTask; },
            CancellationToken.None);
        Assert.Equal(3, attempts);
        Assert.Equal(2, delays);
    }

    [Fact]
    public async Task StopsRetryingAPersistentLockAndSurfacesTheSharingViolation()
    {
        var attempts = 0;
        var error = await Assert.ThrowsAsync<IOException>(() => WorkspaceFileReplacer.ReplaceAsync(
            () => { attempts++; throw SharingViolation(); },
            (_, _) => Task.CompletedTask,
            CancellationToken.None));
        Assert.Equal(WorkspaceFileReplacer.MaxAttempts, attempts);
        Assert.True(WorkspaceFileReplacer.IsSharingViolation(error));
    }

    [Fact]
    public async Task DoesNotRetryFailuresThatAreNotSharingViolations()
    {
        var attempts = 0;
        await Assert.ThrowsAsync<IOException>(() => WorkspaceFileReplacer.ReplaceAsync(
            () => { attempts++; throw UnrelatedFailure(); },
            (_, _) => Task.CompletedTask,
            CancellationToken.None));
        Assert.Equal(1, attempts);
    }
}
