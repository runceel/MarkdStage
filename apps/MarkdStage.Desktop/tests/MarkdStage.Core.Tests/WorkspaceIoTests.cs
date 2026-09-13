using System.Text.Json;

namespace MarkdStage.Core.Tests;

public sealed class WorkspaceIoTests : IAsyncLifetime
{
    private readonly string _directory = Path.Combine(Directory.GetCurrentDirectory(), ".native-tests-" + Guid.NewGuid().ToString("N"));
    private WorkspaceIoService _io = null!;
    private string Root => Path.Combine(_directory, "workspace");

    public Task InitializeAsync()
    {
        Directory.CreateDirectory(Root);
        _io = new WorkspaceIoService(Root, Path.Combine(_directory, "transient"));
        return Task.CompletedTask;
    }
    public async Task DisposeAsync()
    {
        await _io.DisposeAsync();
        Directory.Delete(_directory, true);
    }
    private Task<PortResult> Call(string method, params object[] args) =>
        _io.ExecuteAsync(method, JsonSerializer.SerializeToElement(args));

    [Theory]
    [InlineData("../outside.md")]
    [InlineData("/outside.md")]
    [InlineData("C:secret")]
    [InlineData("\\\\server\\file")]
    [InlineData("sub/../outside.md")]
    [InlineData("file:stream")]
    [InlineData("name. /file")]
    [InlineData("CON.md")]
    [InlineData("folder/LPT1")]
    [InlineData(".")]
    [InlineData("folder/./file.md")]
    [InlineData("folder//file.md")]
    [InlineData("folder/")]
    [InlineData("folder/\u007ffile.md")]
    [InlineData("folder/\tfile.md")]
    [InlineData("CLOCK$.md")]
    [InlineData("CON name.md")]
    [InlineData("COM¹.md")]
    [InlineData("name.")]
    public async Task RejectsNonRelativePathsWithoutDisclosingExistence(string path)
    {
        var result = await Call("readText", path, 100);
        Assert.Equal("denied", result.Code);
        Assert.DoesNotContain(_directory, result.Message!);
    }

    [Fact]
    public async Task ReadsUtf8AndAppliesHostCeiling()
    {
        await File.WriteAllTextAsync(Path.Combine(Root, "deck.md"), "\uFEFF# 日本語");
        Assert.Equal("# 日本語", (await Call("readText", "deck.md", 100)).Value);
        Assert.Equal("too_large", (await Call("readText", "deck.md", 2)).Code);
        using (var stream = File.Create(Path.Combine(Root, "large.md"))) stream.SetLength(2 * 1024 * 1024 + 1);
        Assert.Equal("too_large", (await Call("readText", "large.md", int.MaxValue)).Code);
    }

    [Fact]
    public async Task ReadTextStripsExactlyOneBom()
    {
        await File.WriteAllTextAsync(Path.Combine(Root, "deck.md"), "\uFEFF\uFEFF# A");
        Assert.Equal("\uFEFF# A", (await Call("readText", "deck.md", 100)).Value);
    }

    [Fact]
    public async Task AtomicWritesEnforceOverwriteAndOptimisticConcurrency()
    {
        Assert.True((await Call("writeBytes", "new/deck.md", new { base64 = "IyBB" }, new { overwrite = false })).Ok);
        Assert.Equal("exists", (await Call("writeBytes", "new/deck.md", new { base64 = "" }, new { overwrite = false })).Code);
        var stat = JsonSerializer.SerializeToElement((await Call("stat", "new/deck.md")).Value);
        var modified = stat.GetProperty("modifiedAt").GetDouble();
        Assert.Equal("conflict", (await Call("replaceText", "new/deck.md", "# B", new { expectedModifiedAt = modified - 1 })).Code);
        Assert.Equal("# A", await File.ReadAllTextAsync(Path.Combine(Root, "new/deck.md")));
        Assert.True((await Call("replaceText", "new/deck.md", "# B", new { expectedModifiedAt = modified })).Ok);
        Assert.Equal("# B", await File.ReadAllTextAsync(Path.Combine(Root, "new/deck.md")));
        Assert.Single(Directory.GetFiles(Path.Combine(Root, "new")));
    }

    [WindowsFact]
    public async Task LockedDestinationPreservesExistingFileAndReturnsActionableCode()
    {
        var target = Path.Combine(Root, "deck.pptx");
        await File.WriteAllTextAsync(target, "existing");
        using (new FileStream(target, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            var result = await Call("writeBytes", "deck.pptx", new { base64 = "bmV3" }, new { overwrite = true });
            Assert.Equal("destination_locked", result.Code);
            Assert.Equal("The destination file is in use.", result.Message);
        }
        Assert.Equal("existing", await File.ReadAllTextAsync(target));
        Assert.Equal(["deck.pptx"], Directory.GetFiles(Root).Select(Path.GetFileName).ToArray());
    }

    [WindowsFact]
    public async Task ShortLivedDestinationLockRetriesThenAllowsRepeatedOverwrite()
    {
        var target = Path.Combine(Root, "deck.pptx");
        await File.WriteAllTextAsync(target, "existing");
        var locked = new FileStream(target, FileMode.Open, FileAccess.Read, FileShare.Read);
        try
        {
            var release = Task.Run(async () =>
            {
                await Task.Delay(125);
                locked.Dispose();
            });
            Assert.True((await Call(
                "writeBytes",
                "deck.pptx",
                new { base64 = "cmVjb3ZlcmVk" },
                new { overwrite = true })).Ok);
            await release;
        }
        finally
        {
            locked.Dispose();
        }
        Assert.Equal("recovered", await File.ReadAllTextAsync(target));
        Assert.True((await Call(
            "writeBytes",
            "deck.pptx",
            new { base64 = "cmVwZWF0ZWQ=" },
            new { overwrite = true })).Ok);
        Assert.Equal("repeated", await File.ReadAllTextAsync(target));
        Assert.Equal(["deck.pptx"], Directory.GetFiles(Root).Select(Path.GetFileName).ToArray());
    }

    [Fact]
    public async Task RejectsLinksEvenWhenTheyPointInsideWorkspace()
    {
        await File.WriteAllTextAsync(Path.Combine(Root, "deck.md"), "# A");
        File.CreateSymbolicLink(Path.Combine(Root, "link.md"), Path.Combine(Root, "deck.md"));
        Assert.Equal("denied", (await Call("readText", "link.md", 100)).Code);
        Directory.CreateSymbolicLink(Path.Combine(Root, "outside"), _directory);
        Assert.Equal("denied", (await Call("writeBytes", "outside/escape.md", new { base64 = "" }, new { overwrite = true })).Code);
    }

    [Fact]
    public async Task ListsRelativeEntriesAndKeepsTransientHandlesOpaque()
    {
        await Call("writeBytes", "deck.md", new { base64 = "" }, new { overwrite = false });
        await Call("writeBytes", "image.png", new { base64 = "" }, new { overwrite = false });
        var entries = JsonSerializer.SerializeToElement((await Call("list", "", new { extensions = new[] { ".md" }, maxEntries = 10, recursive = true })).Value);
        Assert.Single(entries.EnumerateArray());
        Assert.Equal("deck.md", entries[0].GetProperty("path").GetString());
        var handle = (string)(await Call("createTransientDirectory", "capture")).Value!;
        Assert.DoesNotContain("/", handle);
        Assert.Single(Directory.GetDirectories(Path.Combine(_directory, "transient")));
        Assert.True((await Call("removeTransientDirectory", handle)).Ok);
        Assert.Empty(Directory.GetDirectories(Path.Combine(_directory, "transient")));
        Assert.Equal("unsupported", (await Call("delete", "deck.md")).Code);
    }

    [Fact]
    public async Task WatchingEmitsRelativeEventsAndUnwatchStopsSubscription()
    {
        await File.WriteAllTextAsync(Path.Combine(Root, "deck.md"), "# A");
        var changed = new TaskCompletionSource<WorkspaceChange>(TaskCreationOptions.RunContinuationsAsynchronously);
        _io.Changed += (_, change) => changed.TrySetResult(change);
        var subscription = await Call("watch", "deck.md", new { extensions = new[] { ".md" } });
        Assert.True(subscription.Ok);
        await File.WriteAllTextAsync(Path.Combine(Root, "deck.md"), "# B");
        var observed = await changed.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal("deck.md", observed.Path);
        Assert.Equal(subscription.Value, observed.Handle);
        Assert.True((await Call("unwatch", subscription.Value!)).Ok);
    }

    [Fact]
    public async Task DisappearedWorkspaceIsNotRecreatedByWrites()
    {
        Directory.Delete(Root);
        Assert.Equal("missing", (await Call("makeDirectory", "new")).Code);
        Assert.Equal("missing", (await Call("writeBytes", "new/deck.md", new { base64 = "" }, new { overwrite = false })).Code);
        Assert.False(Directory.Exists(Root));
    }

    [Fact]
    public async Task MalformedRequestsAndUnavailableBrowserStayInsideResultBoundary()
    {
        Assert.False((await Call("readText")).Ok);
        Assert.False((await Call("replaceText", "deck.md", 42)).Ok);
        Assert.Equal("denied", (await _io.ExecuteAsync("readText", JsonSerializer.SerializeToElement(new { path = "deck.md" }))).Code);
        Assert.Equal("unsupported", (await Call("launchBrowser", new { url = "http://127.0.0.1/", profile = "unknown", mode = "app" })).Code);
    }

    [Fact]
    public async Task BrowserEnvironmentFailuresStayActionableAndPrivacySafe()
    {
        await using var io = new WorkspaceIoService(
            Root,
            Path.Combine(_directory, "browser-transient"),
            new FailingBrowserHost());
        var profile = (string)(await io.ExecuteAsync(
            "createTransientDirectory",
            JsonSerializer.SerializeToElement(new[] { "pptx" }))).Value!;
        var result = await io.ExecuteAsync(
            "launchBrowser",
            JsonSerializer.SerializeToElement(new[]
            {
                new
                {
                    url = "http://127.0.0.1/",
                    profile,
                    mode = "automation",
                    windowSize = new { width = 1280, height = 720 },
                },
            }));

        Assert.Equal("browser_automation_unavailable", result.Code);
        Assert.Contains("Chromium automation could not start", result.Message);
        Assert.DoesNotContain(_directory, result.Message);
    }

    [Fact]
    public async Task TransientSweepSkipsAnotherOwnersOldActiveProfile()
    {
        var activeHandle = (string)(await Call("createTransientDirectory", "present")).Value!;
        var active = _io.GetTransientDirectory(activeHandle);
        var transientRoot = Path.Combine(_directory, "transient");
        var orphan = Path.Combine(transientRoot, "markdstage-capture-" + Guid.NewGuid().ToString("N"));
        var unrelated = Path.Combine(transientRoot, "markdstage-user-files");
        Directory.CreateDirectory(orphan);
        Directory.CreateDirectory(unrelated);
        foreach (var directory in new[] { active, orphan, unrelated })
            Directory.SetLastWriteTimeUtc(directory, DateTime.UtcNow.AddDays(-2));
        await using (var anotherOwner = new WorkspaceIoService(Root, transientRoot))
        {
            Assert.True(Directory.Exists(active));
            Assert.False(Directory.Exists(orphan));
            Assert.True(Directory.Exists(unrelated));
        }
        Assert.True((await Call("removeTransientDirectory", activeHandle)).Ok);
        Assert.False(Directory.Exists(active));
        Assert.Empty(Directory.EnumerateFiles(transientRoot, "*.lock"));
    }

    [WindowsFact]
    public async Task TransientRemovalRetriesFilesReleasedByBrowserShutdown()
    {
        var handle = (string)(await Call("createTransientDirectory", "pptx")).Value!;
        var directory = _io.GetTransientDirectory(handle);
        var file = Path.Combine(directory, "locked");
        await File.WriteAllTextAsync(file, "temporary");
        var locked = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read);
        try
        {
            var release = Task.Run(async () =>
            {
                await Task.Delay(150);
                locked.Dispose();
            });
            Assert.True((await Call("removeTransientDirectory", handle)).Ok);
            await release;
        }
        finally
        {
            locked.Dispose();
        }
        Assert.False(Directory.Exists(directory));
    }

    [Fact]
    public void ResolutionAndStateDoNotDependOnWorkingDirectory()
    {
        Directory.CreateDirectory(Path.Combine(Root, ".git"));
        Directory.CreateDirectory(Path.Combine(Root, "nested"));
        Assert.Equal(Root, WorkspaceResolver.Resolve(null, Path.Combine(Root, "nested/deck.md")));
        Assert.Throws<ArgumentException>(() => WorkspaceResolver.Resolve(null, null));
        Assert.Throws<ArgumentException>(() => WorkspaceResolver.Resolve("relative"));
        var store = new DesktopStateStore(Path.Combine(_directory, "state"));
        for (var index = 0; index < 12; index++) store.Remember(Path.Combine(Root, index.ToString()));
        Assert.Equal(10, store.State.RecentWorkspaces.Count);
        var first = store.State.RecentWorkspaces[0];
        store.Repoint(first, Root);
        Assert.Equal(Root, store.State.RecentWorkspaces[0]);
        var restored = new DesktopStateStore(Path.Combine(_directory, "state")).State;
        Assert.Equal(store.State.RecentWorkspaces, restored.RecentWorkspaces);
        Assert.Equal(store.State.Theme, restored.Theme);
    }

    private sealed class FailingBrowserHost : IBrowserHost
    {
        public Task<object> LaunchAsync(
            JsonElement options,
            string profileDirectory,
            CancellationToken cancellationToken) =>
            throw new BrowserHostException(
                "browser_automation_unavailable",
                $"Sensitive profile: {profileDirectory}");

        public Task CloseAsync(string handle, CancellationToken cancellationToken) =>
            Task.CompletedTask;
    }
}
