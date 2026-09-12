using System.Text.Json;
using MarkdStage.Cli;

namespace MarkdStage.Core.Tests;

public sealed class HostCommandsTests : IDisposable
{
    private readonly string root = Path.Combine(AppContext.BaseDirectory, ".cli-test-" + Guid.NewGuid().ToString("N"));
    public HostCommandsTests()
    {
        Directory.CreateDirectory(Path.Combine(root, "CliData"));
        File.WriteAllText(Path.Combine(root, "CliData", "commands.json"), JsonSerializer.Serialize(new
        {
            version = "4.0.0",
            guides = new Dictionary<string, string> { ["overview"] = "日本語 — Markdown" },
            skills = new Dictionary<string, Dictionary<string, string>>
            {
                ["codex"] = new() { ["SKILL.md"] = "# MarkdStage\n", ["references/overview.md"] = "Guide\n" }
            }
        }));
    }

    [Fact]
    public async Task HelpWorksWithoutPackageData()
    {
        var writer = new StringWriter();
        Assert.Equal(0, await HostCommands.RunAsync(CliArguments.Parse(["help"]), "missing-package", writer, CancellationToken.None));
        Assert.Contains("--workspace", writer.ToString());
    }

    [Fact]
    public async Task GuidePreservesUnicodeWithoutJavaScript()
    {
        var writer = new StringWriter();
        await HostCommands.RunAsync(CliArguments.Parse(["guide", "--json"]), root, writer, CancellationToken.None);
        using var report = JsonDocument.Parse(writer.ToString());
        Assert.Equal("日本語 — Markdown", report.RootElement.GetProperty("content").GetString());
    }

    [Fact]
    public async Task SkillNeverUsesAnImplicitWorkingDirectory()
    {
        var error = await Assert.ThrowsAsync<CliException>(() => HostCommands.RunAsync(
            CliArguments.Parse(["skill", "install", "--target", "codex"]), root, new StringWriter(), CancellationToken.None));
        Assert.Equal("invalid_input", error.Code);
    }

    [Fact]
    public async Task SkillCheckDoesNotWriteAndInstallPreservesLocalEdits()
    {
        async Task<int> Run(params string[] arguments) => await HostCommands.RunAsync(
            CliArguments.Parse(["skill", .. arguments, "--target", "codex", "--root", root]),
            root, new StringWriter(), CancellationToken.None);
        Assert.Equal(5, await Run("check"));
        var path = Path.Combine(root, ".agents", "skills", "markdstage", "SKILL.md");
        Assert.False(File.Exists(path));
        Assert.Equal(0, await Run("install"));
        Assert.Equal(0, await Run("check"));
        File.WriteAllText(path, "local edits");
        Assert.Equal(5, await Run("install"));
        Assert.Equal("local edits", File.ReadAllText(path));
        Assert.Equal(0, await Run("install", "--force"));
        Assert.Equal("# MarkdStage\n", File.ReadAllText(path));
    }

    [Fact]
    public async Task SkillRejectsLinkedParent()
    {
        var link = Path.Combine(root, ".agents");
        var destination = Path.Combine(root, "linked");
        Directory.CreateDirectory(destination);
        try { Directory.CreateSymbolicLink(link, destination); }
        catch (UnauthorizedAccessException) { return; }
        catch (PlatformNotSupportedException) { return; }
        var error = await Assert.ThrowsAsync<CliException>(() => HostCommands.RunAsync(
            CliArguments.Parse(["skill", "install", "--target", "codex", "--root", root]),
            root, new StringWriter(), CancellationToken.None));
        Assert.Equal("path_outside_workspace", error.Code);
        Assert.Empty(Directory.EnumerateFileSystemEntries(destination));
    }

    public void Dispose() => Directory.Delete(root, true);
}
