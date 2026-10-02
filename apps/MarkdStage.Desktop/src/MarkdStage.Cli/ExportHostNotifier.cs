using System.Text.Json;
using System.Text.Json.Nodes;
using MarkdStage.Core;

namespace MarkdStage.Cli;

// The wrapping host owns opening the export; the page shows the location only.
internal static class ExportHostNotifier
{
    public static async Task<JsonElement> NotifyAsync(
        JsonElement report, string format, string root, Uri previewUri, TextWriter output, string version)
    {
        if (report.ValueKind != JsonValueKind.Object ||
            !report.TryGetProperty("ok", out var ok) || ok.ValueKind != JsonValueKind.True ||
            !report.TryGetProperty("path", out var pathElement) || pathElement.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(pathElement.GetString()))
            return report;
        var path = Path.GetFullPath(Path.Combine(root, pathElement.GetString()!));
        if (!WorkspaceResolver.IsInside(root, path)) return report;
        await output.WriteLineAsync(JsonSerializer.Serialize(new
        {
            type = "export",
            previewUrl = previewUri.AbsoluteUri,
            format,
            path,
            version,
        }));
        await output.FlushAsync();
        var updated = JsonNode.Parse(report.GetRawText())!.AsObject();
        updated["openedByHost"] = true;
        return JsonSerializer.SerializeToElement(updated);
    }
}
