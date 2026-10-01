using MarkdStage.Cli;

namespace MarkdStage.Core.Tests;

public sealed class CliArgumentsTests
{
    [Fact]
    public void NoArgumentsRemainPresentationMode()
    {
        var args = CliArguments.Parse([]);
        Assert.Null(args.Get("workspace"));
        Assert.Null(args.File);
        Assert.True(args.IsPresentation);
    }

    [Fact]
    public void InvocationUsesCurrentDirectoryWhenFileAndWorkspaceAreMissing()
    {
        var currentDirectory = Path.GetFullPath("current");
        Assert.Equal(currentDirectory, CliArguments.WorkspaceArgument(null, null, currentDirectory));
        Assert.Null(CliArguments.WorkspaceArgument(null, "slides.md", currentDirectory));
        Assert.Equal("explicit", CliArguments.WorkspaceArgument("explicit", null, currentDirectory));
    }

    [Theory]
    [InlineData("slides.md")]
    [InlineData("日本語のスライド.markdown")]
    public void BareMarkdownEnablesLivePreview(string file)
    {
        var args = CliArguments.Parse([file, "--workspace", "decks"]);
        Assert.Equal("preview", args.Command);
        Assert.Equal(file, args.File);
        Assert.True(args.Has("watch"));
        Assert.Equal("decks", args.Get("workspace"));
    }

    [Theory]
    [InlineData("help")]
    [InlineData("guide")]
    [InlineData("skill")]
    public void InformationalCommandsDoNotInitializeJavaScript(string command) =>
        Assert.True(CliArguments.Parse([command]).IsHostOnly);

    [Fact]
    public void ExplicitPreviewIsNotAutomaticallyWatched() =>
        Assert.False(CliArguments.Parse(["preview", "deck.md"]).Has("watch"));

    [Theory]
    [InlineData("--workspace")]
    [InlineData("--json=true")]
    [InlineData("--unknown")]
    public void RejectsMalformedOptions(string option) =>
        Assert.Equal(1, Assert.Throws<CliException>(() => CliArguments.Parse([option])).ExitCode);

    [Fact]
    public void AllowsDashPrefixedPathsAfterSeparator()
    {
        var args = CliArguments.Parse(["validate", "--", "-slides.md"]);
        Assert.Equal("-slides.md", args.File);
    }

    [Fact]
    public void RejectsUnknownCommandOptions() =>
        Assert.Throws<CliException>(() => CliArguments.Parse(["validate", "deck.md", "--pages", "1"]));

    [Theory]
    [InlineData("preview")]
    [InlineData("present")]
    public void JsonLinesIsAcceptedForServedPresentationCommands(string command)
    {
        var args = CliArguments.Parse([
            command,
            "deck.md",
            "--no-open",
            "--json-lines",
            "--architecture-editor-target",
            "host",
        ]);
        Assert.True(args.Has("json-lines"));
        Assert.Equal("host", args.Get("architecture-editor-target"));
        Assert.False(args.IsAppActivation);
    }

    [Fact]
    public void RejectsInvalidArchitectureEditorTarget() =>
        Assert.Throws<CliException>(() => CliArguments.Parse([
            "preview",
            "deck.md",
            "--architecture-editor-target",
            "popup",
        ]));

    [Theory]
    [InlineData("validate", "deck.md", "--json-lines")]
    [InlineData("guide", "--json-lines")]
    [InlineData("skill", "check", "--json-lines")]
    [InlineData("preview", "deck.md", "--json-lines")]
    [InlineData("preview", "deck.md", "--no-open", "--json", "--json-lines")]
    public void RejectsInvalidJsonLinesUsage(params string[] arguments) =>
        Assert.Equal(1, Assert.Throws<CliException>(() => CliArguments.Parse(arguments)).ExitCode);

    [Theory]
    [InlineData("0")]
    [InlineData("1abc")]
    [InlineData("-2")]
    public void SlideMustBePositiveInteger(string value) =>
        Assert.Throws<CliException>(() => CliArguments.Parse(["inspect", "deck.md", "--slide", value]));

    [Fact]
    public void HelpDoesNotRequireAFile() =>
        Assert.True(CliArguments.Parse(["validate", "--help"]).IsHostOnly);

    [Theory]
    [InlineData("", "\"\"")]
    [InlineData("a b", "\"a b\"")]
    [InlineData("日本語", "\"日本語\"")]
    [InlineData("a\"b", "\"a\\\"b\"")]
    [InlineData("folder\\", "\"folder\\\\\"")]
    [InlineData("folder\\\"name", "\"folder\\\\\\\"name\"")]
    public void BrowserCommandLinePreservesArgumentBoundaries(string input, string expected) =>
        Assert.Equal(expected, BrowserProcess.Quote(input));
}
