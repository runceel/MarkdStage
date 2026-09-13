using System.Net;
using MarkdStageApp.Services;

namespace MarkdStage.Core.Tests;

public sealed class NativeMappedAssetRoutesTests
{
    // Every workspace asset route must answer with bytes, because the export browser is an external
    // Chromium without the WebView2 virtual-host mapping that a redirect target would depend on.
    [Fact]
    public async Task WorkspaceAssetRoutesServeBytesForEveryBrowser()
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
            await using var server = new PresentationServer(session, () => false);
            await server.StartAsync();
            using var client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { BaseAddress = server.BaseUri };
            foreach (var route in new[] { "assets/photo%20space.png", "background-assets/photo%20space.png" })
            {
                using var response = await client.GetAsync(route);
                Assert.Equal(HttpStatusCode.OK, response.StatusCode);
                Assert.Equal("image/png", response.Content.Headers.ContentType?.MediaType);
                Assert.Equal("image", await response.Content.ReadAsStringAsync());
            }
            await File.WriteAllTextAsync(Path.Combine(root, "assets/photo.png"), "theme image");
            using (var response = await client.GetAsync("theme-assets/assets/photo.png"))
            {
                Assert.Equal(HttpStatusCode.OK, response.StatusCode);
                Assert.Equal("image/png", response.Content.Headers.ContentType?.MediaType);
                Assert.Equal("theme image", await response.Content.ReadAsStringAsync());
            }
            using (var response = await client.GetAsync("vendor/vendor-assets.lock.json"))
            {
                Assert.Equal(HttpStatusCode.OK, response.StatusCode);
                Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
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

    // Fonts and audio used to fall through to application/octet-stream once assets stopped being
    // redirected, so the HTTP media types must cover the same extensions the WebView2 mapping did.
    [Theory]
    [InlineData("brand.woff2", "font/woff2")]
    [InlineData("brand.ttf", "font/ttf")]
    [InlineData("brand.otf", "font/otf")]
    [InlineData("clip.mp3", "audio/mpeg")]
    [InlineData("clip.wav", "audio/wav")]
    [InlineData("clip.mp4", "video/mp4")]
    [InlineData("art.svg", "image/svg+xml")]
    [InlineData("art.avif", "image/avif")]
    [InlineData("art.webp", "image/webp")]
    [InlineData("art.gif", "image/gif")]
    public async Task WorkspaceAssetRoutesAnnounceTheMediaTypeOfEverySupportedAsset(string name, string expected)
    {
        var root = Path.Combine(Directory.GetCurrentDirectory(), ".mapped-types-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root, "assets"));
        try
        {
            await File.WriteAllTextAsync(Path.Combine(root, "assets", name), "asset");
            var session = new PresentationSession();
            session.ApplySnapshot(new PresentationSnapshot(["# Slide"], 0, 1, 1,
                Path.Combine(root, "slides.md"), root, new ThemeState("custom", AssetRoot: root)));
            await using var server = new PresentationServer(session, () => false);
            await server.StartAsync();
            using var client = new HttpClient { BaseAddress = server.BaseUri };
            using var response = await client.GetAsync("assets/" + name);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal(expected, response.Content.Headers.ContentType?.MediaType);
        }
        finally { Directory.Delete(root, true); }
    }
}
