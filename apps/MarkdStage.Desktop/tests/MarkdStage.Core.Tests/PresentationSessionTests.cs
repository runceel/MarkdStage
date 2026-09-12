using MarkdStage.Core;

namespace MarkdStage.Core.Tests;

public sealed class PresentationSessionTests
{
    [Fact]
    public void ApplySnapshot_PreservesRuntimeOwnedIndexAndVersions()
    {
        var session = new PresentationSession();
        var snapshot = new PresentationSnapshot(["x", "y"], 1, 42, 9, "a.md", "C:\\deck", new ThemeState("light"));
        session.ApplySnapshot(snapshot);

        Assert.Equal(1, snapshot.Index);
        Assert.Equal("y", snapshot.CurrentMarkdown);
        Assert.Equal(9, snapshot.DeckVersion);
        Assert.Equal(42, snapshot.Version);
        Assert.Same(snapshot, session.GetSnapshot());
    }

    [Fact]
    public async Task Navigate_ForwardsIntentWithoutMutatingSnapshot()
    {
        var session = new PresentationSession();
        var snapshot = new PresentationSnapshot(["a", "b"], 0, 1, 1, "a.md", "C:\\deck", new ThemeState("dark"));
        session.ApplySnapshot(snapshot);
        int? requestedIndex = null;
        int? requestedDelta = null;
        session.Navigate = (index, delta) =>
        {
            requestedIndex = index;
            requestedDelta = delta;
            return Task.FromResult(true);
        };
        Assert.True(await session.NavigateByAsync(1));
        Assert.Null(requestedIndex);
        Assert.Equal(1, requestedDelta);
        Assert.True(await session.NavigateToAsync(20));
        Assert.Equal(20, requestedIndex);
        Assert.Null(requestedDelta);
        Assert.Same(snapshot, session.GetSnapshot());
    }
}
