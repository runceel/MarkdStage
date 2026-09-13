namespace MarkdStage.Cli;

internal static class BrowserEndpointDiscovery
{
    public static async Task<Uri> DiscoverAsync(
        Func<bool> hasExited,
        string profile,
        CancellationToken cancellationToken,
        TimeSpan? timeout = null,
        TimeSpan? exitGracePeriod = null)
    {
        var expires = DateTime.UtcNow.Add(timeout ?? TimeSpan.FromSeconds(20));
        var gracePeriod = exitGracePeriod ?? TimeSpan.FromSeconds(5);
        DateTime? exitedAt = null;
        var path = Path.Combine(profile, "DevToolsActivePort");
        while (DateTime.UtcNow < expires)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var lines = await File.ReadAllLinesAsync(path, cancellationToken);
                if (lines.Length >= 2 && int.TryParse(lines[0], out var port) && port is > 0 and <= 65535)
                    return new Uri($"http://127.0.0.1:{port}/");
            }
            catch (IOException) { }
            if (hasExited())
            {
                exitedAt ??= DateTime.UtcNow;
                if (DateTime.UtcNow - exitedAt >= gracePeriod) break;
            }
            await Task.Delay(100, cancellationToken);
        }
        throw new CliException(
            "browser_automation_unavailable",
            "Chromium remote debugging is unavailable. Enterprise policy may disable it; this is a known limitation of inspect, capture, and export.",
            3);
    }
}
