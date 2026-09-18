using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using MarkdStageApp.Services;

namespace MarkdStage.Core.Tests;

public sealed class AdaptiveCardHostingTests
{
    [Theory]
    [InlineData("renderer", "adaptive-card.mjs")]
    [InlineData("renderer", "adaptive-card-validation.mjs")]
    [InlineData("renderer", "fenced-blocks.mjs")]
    [InlineData("renderer", "image-source.mjs")]
    [InlineData("renderer", "marked-lexer.mjs")]
    [InlineData("vendor", "marked.min.js")]
    public async Task NativeHttpRoutesServePackagedCardModulesWithoutChangingBytes(string directory, string module)
    {
        var expected = await File.ReadAllBytesAsync(Path.Combine(AppContext.BaseDirectory, "Web", directory, module));
        await using var server = new PresentationServer(new PresentationSession(), () => false);
        await server.StartAsync();
        using var client = new HttpClient(new HttpClientHandler { UseProxy = false, AllowAutoRedirect = false })
        {
            BaseAddress = server.BaseUri,
        };
        using var response = await client.GetAsync($"{directory}/{module}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/javascript", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("nosniff", Assert.Single(response.Headers.GetValues("X-Content-Type-Options")));
        var actual = await response.Content.ReadAsByteArrayAsync();
        Assert.Equal(expected.Length, actual.Length);
        Assert.Equal(SHA256.HashData(expected), SHA256.HashData(actual));
    }

    [Fact]
    public async Task NativeHttpRouteServesTheLockedAdaptiveCardsSdk()
    {
        const string sdkHash = "5e7c13f3300ae7b89b34703501e08d709fbb6635f1c6755b92495577a77344f2";
        await using var server = new PresentationServer(new PresentationSession(), () => false);
        await server.StartAsync();
        using var client = new HttpClient(new HttpClientHandler { UseProxy = false, AllowAutoRedirect = false })
        {
            BaseAddress = server.BaseUri,
        };
        using var manifestResponse = await client.GetAsync("vendor/vendor-assets.lock.json");
        Assert.Equal(HttpStatusCode.OK, manifestResponse.StatusCode);
        using var manifest = JsonDocument.Parse(await manifestResponse.Content.ReadAsStringAsync());
        var asset = manifest.RootElement.GetProperty("assets").GetProperty("adaptivecards.min.js");
        Assert.Equal("adaptivecards", asset.GetProperty("upstream").GetProperty("name").GetString());
        Assert.Equal("3.0.6", asset.GetProperty("upstream").GetProperty("version").GetString());
        Assert.Equal(sdkHash, asset.GetProperty("sha256").GetString());

        using var response = await client.GetAsync("vendor/adaptivecards.min.js");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/javascript", response.Content.Headers.ContentType?.MediaType);
        var bytes = await response.Content.ReadAsByteArrayAsync();
        Assert.Equal(asset.GetProperty("size").GetInt32(), bytes.Length);
        Assert.Equal((long)bytes.Length, response.Content.Headers.ContentLength);
        Assert.Equal(sdkHash, Convert.ToHexStringLower(SHA256.HashData(bytes)));
    }
}
