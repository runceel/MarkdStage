using System.Text.Json;
using System.Text.Json.Nodes;
using MarkdStage.Core;

namespace MarkdStage.Cli;

// The wrapping host owns opening the export; the page shows the location only.
// Notification is best-effort: a broken or stalled host pipe must not fail an export that is already saved.
internal static class ExportHostNotifier
{
    private static readonly TimeSpan DefaultWriteTimeout = TimeSpan.FromSeconds(5);

    public static async Task<JsonElement> NotifyAsync(
        JsonElement report, string format, string root, Uri previewUri, TextWriter output, string version,
        TextWriter? diagnostics = null, TimeSpan? writeTimeout = null)
    {
        if (report.ValueKind != JsonValueKind.Object ||
            !report.TryGetProperty("ok", out var ok) || ok.ValueKind != JsonValueKind.True ||
            !report.TryGetProperty("path", out var pathElement) || pathElement.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(pathElement.GetString()))
            return report;
        var path = Path.GetFullPath(Path.Combine(root, pathElement.GetString()!));
        if (!WorkspaceResolver.IsInside(root, path)) return report;
        var line = JsonSerializer.Serialize(new
        {
            type = "export",
            previewUrl = previewUri.AbsoluteUri,
            format,
            path,
            version,
        });
        try
        {
            // Console.Out writes synchronously, so run it off the request thread to bound the wait.
            await Task.Run(async () =>
            {
                await output.WriteLineAsync(line);
                await output.FlushAsync();
            }).WaitAsync(writeTimeout ?? DefaultWriteTimeout);
        }
        catch (Exception error)
        {
            diagnostics?.WriteLine($"Failed to notify the host about the export: {error.Message}");
            return report;
        }
        var updated = JsonNode.Parse(report.GetRawText())!.AsObject();
        updated["openedByHost"] = true;
        return JsonSerializer.SerializeToElement(updated);
    }
}
