using MarkdStageApp.Services;

namespace MarkdStage.Core.Tests;

/// <summary>
/// The export notification hands a save location back from the renderer, which is web content. The
/// desktop runtime reports that location workspace-relative, so the shell must only ever be given a
/// real export resolved against the workspace the user has open.
/// </summary>
public sealed class ExportLaunchTests : IDisposable
{
    private readonly string _directory = Path.Combine(Directory.GetCurrentDirectory(), ".export-tests-" + Guid.NewGuid().ToString("N"));
    private string Root => Path.Combine(_directory, "workspace");

    public ExportLaunchTests() => Directory.CreateDirectory(Root);
    public void Dispose() => Directory.Delete(_directory, true);

    private string Write(string relative)
    {
        var file = Path.Combine(Root, relative.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        File.WriteAllBytes(file, []);
        return file;
    }

    [Theory]
    [InlineData("slides.pdf")]
    [InlineData("slides.pptx")]
    [InlineData("out/slides.pptx")]
    public void ResolvesWorkspaceRelativeExports(string relative) =>
        Assert.Equal(Write(relative), PathSecurity.ResolveExport(Root, relative), ignoreCase: true);

    [Theory]
    [InlineData("../slides.pdf")]
    [InlineData("out/../../slides.pdf")]
    public void RejectsPathsThatLeaveTheWorkspace(string relative)
    {
        Write("outside.pdf");
        Assert.Throws<UnauthorizedAccessException>(() => PathSecurity.ResolveExport(Root, relative));
    }

    [Fact]
    public void RejectsAbsolutePathsBecauseTheRuntimeNeverReportsThem()
    {
        var file = Write("slides.pdf");
        Assert.Throws<UnauthorizedAccessException>(() => PathSecurity.ResolveExport(Root, file));
    }

    [Theory]
    [InlineData("payload.exe")]
    [InlineData("notes.md")]
    public void RejectsAnythingThatIsNotAnExport(string relative)
    {
        Write(relative);
        Assert.Throws<UnauthorizedAccessException>(() => PathSecurity.ResolveExport(Root, relative));
    }

    [Fact]
    public void RejectsExportsThatHaveBeenDeleted() =>
        Assert.Throws<FileNotFoundException>(() => PathSecurity.ResolveExport(Root, "slides.pptx"));
}
