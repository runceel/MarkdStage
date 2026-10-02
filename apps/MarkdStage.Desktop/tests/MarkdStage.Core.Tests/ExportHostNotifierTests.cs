using System.Text.Json;
using MarkdStage.Cli;

namespace MarkdStage.Core.Tests;

public sealed class ExportHostNotifierTests
{
    private static readonly Uri Preview = new("http://127.0.0.1:4100/token/");

    [Fact]
    public async Task EmitsAnExportEventAndMarksTheReport()
    {
        var root = Path.Combine(Path.GetTempPath(), "markdstage-notifier");
        using var output = new StringWriter();
        var report = JsonSerializer.SerializeToElement(new { ok = true, path = "deck.pdf" });

        var result = await ExportHostNotifier.NotifyAsync(report, "pdf", root, Preview, output, "4.5.0");

        Assert.True(result.GetProperty("openedByHost").GetBoolean());
        Assert.Equal("deck.pdf", result.GetProperty("path").GetString());
        using var line = JsonDocument.Parse(output.ToString());
        Assert.Equal("export", line.RootElement.GetProperty("type").GetString());
        Assert.Equal(Preview.AbsoluteUri, line.RootElement.GetProperty("previewUrl").GetString());
        Assert.Equal("pdf", line.RootElement.GetProperty("format").GetString());
        Assert.Equal(Path.Combine(root, "deck.pdf"), line.RootElement.GetProperty("path").GetString());
        Assert.Equal("4.5.0", line.RootElement.GetProperty("version").GetString());
    }

    [Theory]
    [InlineData("{\"ok\":false,\"error\":\"pdf_export_failed\"}")]
    [InlineData("{\"ok\":true}")]
    [InlineData("{\"ok\":true,\"path\":\"../outside.pdf\"}")]
    public async Task LeavesFailedOrUnsafeReportsUnchanged(string json)
    {
        var root = Path.Combine(Path.GetTempPath(), "markdstage-notifier");
        using var output = new StringWriter();
        var report = JsonDocument.Parse(json).RootElement;

        var result = await ExportHostNotifier.NotifyAsync(report, "pdf", root, Preview, output, "4.5.0");

        Assert.Equal(report.GetRawText(), result.GetRawText());
        Assert.Equal("", output.ToString());
    }

    [Fact]
    public async Task ReturnsTheOriginalReportWhenTheHostPipeFails()
    {
        var root = Path.Combine(Path.GetTempPath(), "markdstage-notifier");
        var output = new StringWriter();
        output.Dispose();
        using var diagnostics = new StringWriter();
        var report = JsonSerializer.SerializeToElement(new { ok = true, path = "deck.pdf" });

        var result = await ExportHostNotifier.NotifyAsync(report, "pdf", root, Preview, output, "4.5.0", diagnostics);

        Assert.Equal(report.GetRawText(), result.GetRawText());
        Assert.Contains("Failed to notify the host", diagnostics.ToString());
    }

    [Fact]
    public async Task ReturnsTheOriginalReportWhenTheHostPipeStalls()
    {
        var root = Path.Combine(Path.GetTempPath(), "markdstage-notifier");
        using var release = new ManualResetEventSlim();
        using var output = new BlockingWriter(release);
        var report = JsonSerializer.SerializeToElement(new { ok = true, path = "deck.pdf" });

        var result = await ExportHostNotifier.NotifyAsync(
            report, "pdf", root, Preview, output, "4.5.0", writeTimeout: TimeSpan.FromMilliseconds(50));
        release.Set();

        Assert.False(result.TryGetProperty("openedByHost", out _));
    }

    private sealed class BlockingWriter(ManualResetEventSlim release) : StringWriter
    {
        public override void WriteLine(string? value)
        {
            release.Wait();
            base.WriteLine(value);
        }

        public override Task WriteLineAsync(string? value)
        {
            WriteLine(value);
            return Task.CompletedTask;
        }
    }
}
