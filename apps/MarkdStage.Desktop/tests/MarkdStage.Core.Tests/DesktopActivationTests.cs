using MarkdStage.Cli;

namespace MarkdStage.Core.Tests;

public sealed class DesktopActivationTests : IDisposable
{
    private readonly string _root = Path.Combine(Directory.GetCurrentDirectory(), ".activation-tests-" + Guid.NewGuid().ToString("N"));
    private readonly string _workspace;
    private readonly string _file;

    public DesktopActivationTests()
    {
        _workspace = Path.Combine(_root, "workspace");
        Directory.CreateDirectory(Path.Combine(_workspace, "nested"));
        File.WriteAllText(Path.Combine(_workspace, ".git"), "gitdir: unused");
        _file = Path.Combine(_workspace, "nested", "\u65e5\u672c\u8a9e deck.markdown");
        File.WriteAllText(_file, "# Deck");
    }

    public void Dispose() => Directory.Delete(_root, true);

    [Fact]
    public void BareInvocationUsesCallerDirectoryWithoutSelectingAFile()
    {
        var caller = Path.GetDirectoryName(_file)!;
        var request = CliArguments.Parse([]).CreateActivationRequest(caller);
        Assert.Equal(caller, request.Workspace);
        Assert.Null(request.File);
        Assert.Equal("preview", request.Mode);
    }

    [Theory]
    [InlineData("")]
    [InlineData("preview")]
    [InlineData("present")]
    public void ResolvesRelativeFileAndPreservesUnicodeAndMode(string command)
    {
        var argv = command == "" ? new[] { Path.GetFileName(_file) } : [command, Path.GetFileName(_file)];
        var request = CliArguments.Parse(argv).CreateActivationRequest(Path.GetDirectoryName(_file)!);
        Assert.Equal(_workspace, request.Workspace);
        Assert.Equal(_file, request.File);
        Assert.Equal(command == "present" ? "present" : "preview", request.Mode);
        Assert.Equal(request, DesktopActivationRequest.Parse(request.ToArguments()).Validate());
    }

    [Fact]
    public void ExplicitRelativeWorkspaceIsResolvedAgainstCallerNotFile()
    {
        var request = CliArguments.Parse([Path.GetRelativePath(_root, _file), "--workspace", "workspace"])
            .CreateActivationRequest(_root);
        Assert.Equal(_workspace, request.Workspace);
        Assert.Equal(_file, request.File);
        var empty = CliArguments.Parse(["--workspace", "workspace"]).CreateActivationRequest(_root);
        Assert.Equal(_workspace, empty.Workspace);
        Assert.Null(empty.File);
    }

    [Fact]
    public void CanonicalizesFilesBeyondTheLegacyWindowsPathLimit()
    {
        var directory = Path.Combine(_workspace, new string('a', 100), new string('b', 100));
        Directory.CreateDirectory(directory);
        var file = Path.Combine(directory, "long deck.md");
        File.WriteAllText(file, "# Long path");
        Assert.True(file.Length > 260);
        var request = CliArguments.Parse([file]).CreateActivationRequest(_root);
        Assert.Equal(file, request.File);
        Assert.Equal(_workspace, request.Workspace);
        Assert.Equal(request, DesktopActivationRequest.Parse(request.ToArguments()).Validate());
    }

    [Theory]
    [InlineData("help")]
    [InlineData("guide")]
    [InlineData("skill")]
    [InlineData("--help")]
    [InlineData("--version")]
    [InlineData("--no-open")]
    public void ConsoleCommandsDoNotActivateTheApp(string command) =>
        Assert.False(CliArguments.Parse([command]).IsAppActivation);

    [Theory]
    [InlineData("validate")]
    [InlineData("inspect")]
    [InlineData("capture")]
    [InlineData("export")]
    public void FileConsoleCommandsDoNotActivateTheApp(string command) =>
        Assert.False(CliArguments.Parse([command, _file]).IsAppActivation);

    [Theory]
    [InlineData("preview")]
    [InlineData("present")]
    public void NoOpenRetainsConsoleOptions(string command)
    {
        var args = CliArguments.Parse([command, _file, "--no-open", "--theme", "light", "--theme-file", "theme.css", "--watch"]);
        Assert.False(args.IsAppActivation);
        Assert.True(args.Has("watch"));
        Assert.Equal("light", args.Get("theme"));
        Assert.Equal("theme.css", args.Get("theme-file"));
    }

    [Theory]
    [InlineData("--theme", "light")]
    [InlineData("--theme-file", "theme.css")]
    public void AppActivationExplicitlyRejectsThemeOverrides(string option, string value)
    {
        var args = CliArguments.Parse([_file, option, value]);
        var error = Assert.Throws<CliException>(() => args.CreateActivationRequest(_root));
        Assert.Equal("usage_error", error.Code);
        Assert.Contains("--no-open", error.Message);
    }

    [Fact]
    public void WatchMapsToNativeLiveLoading()
    {
        var args = CliArguments.Parse(["preview", _file, "--watch"]);
        Assert.True(args.IsAppActivation);
        Assert.Equal(_file, args.CreateActivationRequest(_root).File);
    }

    [Fact]
    public void PresentRequiresFileOnlyForAppActivation()
    {
        Assert.Equal("usage_error", Assert.Throws<CliException>(() =>
            CliArguments.Parse(["present"]).CreateActivationRequest(_root)).Code);
        Assert.False(CliArguments.Parse(["present", "--no-open"]).IsAppActivation);
    }

    [Fact]
    public void RejectsMissingAndNonMarkdownFiles()
    {
        Assert.Equal("invalid_input", Assert.Throws<CliException>(() =>
            CliArguments.Parse(["missing.md"]).CreateActivationRequest(_workspace)).Code);
        Assert.Equal("invalid_markdown_path", Assert.Throws<CliException>(() =>
            CliArguments.Parse(["preview", "deck.txt"])).Code);
        Assert.Throws<ArgumentException>(() => new DesktopActivationRequest(
            _workspace, _file + ".txt", "preview", Guid.NewGuid().ToString("N")).Validate());
    }

    [Fact]
    public void RejectsFilesOutsideExplicitWorkspace()
    {
        Directory.CreateDirectory(Path.Combine(_workspace, "nested", "other"));
        Assert.Equal("path_outside_workspace", Assert.Throws<CliException>(() =>
            CliArguments.Parse([_file, "--workspace", Path.Combine(_workspace, "nested", "other")])
                .CreateActivationRequest(_root)).Code);
    }

    [Fact]
    public void RejectsLinksAndRechecksAfterHandoff()
    {
        var link = Path.Combine(_workspace, "linked.md");
        File.CreateSymbolicLink(link, _file);
        Assert.Equal("path_outside_workspace", Assert.Throws<CliException>(() =>
            CliArguments.Parse([link]).CreateActivationRequest(_root)).Code);
        var directoryLink = Path.Combine(_root, "linked-workspace");
        Directory.CreateSymbolicLink(directoryLink, _workspace);
        Assert.Equal("path_outside_workspace", Assert.Throws<CliException>(() =>
            CliArguments.Parse(["--workspace", directoryLink]).CreateActivationRequest(_root)).Code);
        var request = CliArguments.Parse([_file]).CreateActivationRequest(_root);
        File.Delete(_file);
        File.CreateSymbolicLink(_file, Path.Combine(_workspace, ".git"));
        Assert.Throws<UnauthorizedAccessException>(() => DesktopActivationRequest.Parse(request.ToArguments()).Validate());
    }

    [Theory]
    [InlineData("--markdstage-activation-v2 e30=")]
    [InlineData("--markdstage-activation-v1 !")]
    [InlineData("--markdstage-activation-v1 e30=")]
    public void RejectsMalformedContracts(string arguments) =>
        Assert.Throws<ArgumentException>(() => DesktopActivationRequest.Parse(arguments));

    [Fact]
    public void RejectsRelativePathsAndUnknownModesAtReceiver()
    {
        var request = CliArguments.Parse([_file]).CreateActivationRequest(_root);
        Assert.Throws<ArgumentException>(() => (request with { Workspace = "workspace" }).Validate());
        Assert.Throws<ArgumentException>(() => (request with { File = "deck.md" }).Validate());
        Assert.Throws<ArgumentException>(() => (request with { Mode = "export" }).Validate());
        Assert.Throws<ArgumentException>(() => (request with { RequestId = "../pipe" }).Validate());
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task HandoffWaitsForTheAppsAcceptanceOrRejection(bool accepted)
    {
        var request = CliArguments.Parse([_file]).CreateActivationRequest(_root);
        var response = new DesktopActivationResult(accepted, accepted ? null : "Unable to open deck.", 123, 456);
        Task reply = Task.CompletedTask;
        var result = await DesktopActivation.LaunchAsync(request, arguments =>
        {
            var received = DesktopActivationRequest.Parse(arguments).Validate();
            Assert.Equal(request, received);
            reply = DesktopActivation.ReplyAsync(received, response);
        }, CancellationToken.None);
        await reply;
        Assert.Equal(response, result);
    }

    [Fact]
    public async Task MissingAcknowledgmentIsNotReportedAsSuccess()
    {
        var request = CliArguments.Parse([]).CreateActivationRequest(_root);
        await Assert.ThrowsAsync<TimeoutException>(() =>
            DesktopActivation.LaunchAsync(request, _ => { }, CancellationToken.None, TimeSpan.FromMilliseconds(100)));
    }

    [Fact]
    public async Task ActivationFailureAndCancellationArePropagated()
    {
        var request = CliArguments.Parse([]).CreateActivationRequest(_root);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            DesktopActivation.LaunchAsync(request, _ => throw new InvalidOperationException("Activation unavailable."), CancellationToken.None));
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            DesktopActivation.LaunchAsync(request, _ => { }, cancelled.Token));
    }
}
