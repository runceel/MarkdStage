using System.Text.Json;
using MarkdStage.Core;

namespace MarkdStage.Core.Tests;

public sealed class SkillInstallerTests : IDisposable
{
    private readonly string root =
        Path.Combine(AppContext.BaseDirectory, ".skill-installer-test-" + Guid.NewGuid().ToString("N"));

    public SkillInstallerTests() => Directory.CreateDirectory(root);

    [Fact]
    public async Task InstallsOnlySelectedTargets()
    {
        using var manifest = CreateManifest();

        var result = await SkillInstaller.RunAsync(
            root,
            manifest.RootElement,
            ["codex", "copilot"]);

        Assert.Equal(2, result.Changed);
        Assert.True(File.Exists(Path.Combine(root, ".agents", "skills", "markdstage", "SKILL.md")));
        Assert.False(File.Exists(Path.Combine(root, ".claude", "skills", "markdstage", "SKILL.md")));
        Assert.True(File.Exists(Path.Combine(root, ".github", "skills", "markdstage", "SKILL.md")));
    }

    [Fact]
    public async Task RepeatedInstallReportsUnchangedFiles()
    {
        using var manifest = CreateManifest();
        await SkillInstaller.RunAsync(root, manifest.RootElement, ["codex"]);

        var result = await SkillInstaller.RunAsync(root, manifest.RootElement, ["codex"]);

        Assert.Equal(0, result.Changed);
        Assert.Equal(SkillFileStatus.Unchanged, Assert.Single(result.Files).Status);
    }

    [Fact]
    public async Task InstallPreservesModifiedFiles()
    {
        using var manifest = CreateManifest();
        await SkillInstaller.RunAsync(root, manifest.RootElement, ["codex"]);
        var path = Path.Combine(root, ".agents", "skills", "markdstage", "SKILL.md");
        await File.WriteAllTextAsync(path, "local edits");

        var result = await SkillInstaller.RunAsync(root, manifest.RootElement, ["codex"]);

        Assert.Equal(1, result.Conflicts);
        Assert.Equal("local edits", await File.ReadAllTextAsync(path));
    }

    [Fact]
    public async Task ForceInstallOverwritesModifiedFiles()
    {
        using var manifest = CreateManifest();
        await SkillInstaller.RunAsync(root, manifest.RootElement, ["codex"]);
        var path = Path.Combine(root, ".agents", "skills", "markdstage", "SKILL.md");
        await File.WriteAllTextAsync(path, "local edits");

        var result = await SkillInstaller.RunAsync(
            root,
            manifest.RootElement,
            ["codex"],
            force: true);

        Assert.Equal(0, result.Conflicts);
        Assert.Equal(1, result.Changed);
        Assert.Equal("# Codex\n", await File.ReadAllTextAsync(path));
    }

    [Fact]
    public async Task RejectsLinkedTargetParent()
    {
        var destination = Path.Combine(root, "linked");
        Directory.CreateDirectory(destination);
        try
        {
            Directory.CreateSymbolicLink(Path.Combine(root, ".agents"), destination);
        }
        catch (UnauthorizedAccessException)
        {
            return;
        }
        catch (PlatformNotSupportedException)
        {
            return;
        }
        using var manifest = CreateManifest();

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            SkillInstaller.RunAsync(root, manifest.RootElement, ["codex"]));
        Assert.Empty(Directory.EnumerateFileSystemEntries(destination));
    }

    private static JsonDocument CreateManifest() => JsonDocument.Parse(
        """
        {
          "codex": { "SKILL.md": "# Codex\n" },
          "claude": { "SKILL.md": "# Claude\n" },
          "copilot": { "SKILL.md": "# Copilot\n" }
        }
        """);

    public void Dispose() => Directory.Delete(root, recursive: true);
}
