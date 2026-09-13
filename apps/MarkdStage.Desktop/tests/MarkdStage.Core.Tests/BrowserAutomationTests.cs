using MarkdStage.Cli;

namespace MarkdStage.Core.Tests;

public sealed class BrowserAutomationTests : IDisposable
{
    private readonly string _directory =
        Path.Combine(Directory.GetCurrentDirectory(), ".browser-tests-" + Guid.NewGuid().ToString("N"));

    public BrowserAutomationTests() => Directory.CreateDirectory(_directory);

    [Fact]
    public async Task EndpointDiscoveryAllowsChildBrowserToPublishAfterLauncherExit()
    {
        var publish = Task.Run(async () =>
        {
            await Task.Delay(150);
            await File.WriteAllLinesAsync(
                Path.Combine(_directory, "DevToolsActivePort"),
                ["54321", "/devtools/browser/test"]);
        });

        var endpoint = await BrowserEndpointDiscovery.DiscoverAsync(
            () => true,
            _directory,
            CancellationToken.None,
            TimeSpan.FromSeconds(2),
            TimeSpan.FromSeconds(1));

        await publish;
        Assert.Equal("http://127.0.0.1:54321/", endpoint.AbsoluteUri);
    }

    public void Dispose() => Directory.Delete(_directory, true);
}
