using MarkdStage.Cli;

namespace MarkdStage.Core.Tests;

public sealed class CliArgumentsTests
{
    [Fact]
    public void NoArgumentsNeverDeriveAWorkspace()
    {
        var args = CliArguments.Parse([]);
        Assert.Null(args.Get("workspace"));
        Assert.Null(args.File);
        Assert.True(args.IsPresentation);
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
