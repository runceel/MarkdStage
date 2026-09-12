using System.Net;
using MarkdStageApp.Services;

namespace MarkdStage.Core.Tests;

public sealed class NativeMappedAssetRoutesTests
{
    [Fact]
    public async Task MappedRoutesKeepResolutionAndLimitsBeforeRedirecting()
    {
        var root = Path.Combine(Directory.GetCurrentDirectory(), ".mapped-assets-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root, "assets"));
        try
        {
            var file = Path.Combine(root, "assets/photo space.png");
            await File.WriteAllTextAsync(file, "image");
            var session = new PresentationSession();
            session.ApplySnapshot(new PresentationSnapshot(["# Slide"], 0, 1, 1,
                Path.Combine(root, "slides.md"), root, new ThemeState("custom", AssetRoot: root)));
            await using var server = new PresentationServer(session, () => false, mapAssets: true);
            await server.StartAsync();
            using var client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { BaseAddress = server.BaseUri };
            foreach (var route in new[] { "assets/photo%20space.png", "background-assets/photo%20space.png" })
            {
                using var response = await client.GetAsync(route);
                Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
                Assert.Equal("https://workspace.markdstage.invalid/assets/photo%20space.png",
                    response.Headers.Location?.AbsoluteUri);
            }
            await File.WriteAllTextAsync(Path.Combine(root, "assets/photo.png"), "theme image");
            using (var response = await client.GetAsync("theme-assets/assets/photo.png"))
            {
                Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
                Assert.Equal("https://workspace.markdstage.invalid/assets/photo.png", response.Headers.Location?.AbsoluteUri);
            }
            using (var response = await client.GetAsync("vendor/vendor-assets.lock.json"))
            {
                Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
                Assert.Equal("web.markdstage.invalid", response.Headers.Location?.Host);
            }
            using (var oversized = File.OpenWrite(file)) oversized.SetLength(SlideBackgrounds.MaxBytes + 1);
            using (var response = await client.GetAsync("background-assets/photo%20space.png"))
                Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
            using (var request = new HttpRequestMessage(HttpMethod.Get, "state"))
            {
                request.Headers.Host = "127.0.0.1:1";
                using var response = await client.SendAsync(request);
                Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
            }
        }
        finally { Directory.Delete(root, true); }
    }
}
