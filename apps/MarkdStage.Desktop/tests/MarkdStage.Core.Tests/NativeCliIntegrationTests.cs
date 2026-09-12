using System.Net;
using System.Text.Json;
using MarkdStageApp.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace MarkdStage.Core.Tests;

public sealed class NativeCliIntegrationTests
{
    [Fact]
    public async Task CliRoutesRemainBehindNativeHostAndOriginChecks()
    {
        await using var server = new PresentationServer(new PresentationSession(), () => false,
            (application, prefix) =>
            {
                application.MapMethods(prefix + "/cli-probe", ["GET", "POST"], () => Results.Json(new { ok = true }));
                application.Use(async (context, next) =>
                {
                    if (context.Request.Path == prefix + "/state")
                        await context.Response.WriteAsJsonAsync(new { nativeCli = true });
                    else await next();
                });
            });
        await server.StartAsync();
        using var client = new HttpClient(new HttpClientHandler { UseProxy = false });
        var url = new Uri(server.BaseUri!, "cli-probe");
        using var good = await client.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, good.StatusCode);
        using var state = JsonDocument.Parse(await client.GetStringAsync(new Uri(server.BaseUri!, "state")));
        Assert.True(state.RootElement.GetProperty("nativeCli").GetBoolean());
        using var badHost = new HttpRequestMessage(HttpMethod.Get, url);
        badHost.Headers.Host = "attacker.invalid";
        using var hostResponse = await client.SendAsync(badHost);
        Assert.Equal(HttpStatusCode.Forbidden, hostResponse.StatusCode);
        using var badOrigin = new HttpRequestMessage(HttpMethod.Post, url);
        badOrigin.Headers.Add("Origin", "https://attacker.invalid");
        using var originResponse = await client.SendAsync(badOrigin);
        Assert.Equal(HttpStatusCode.Forbidden, originResponse.StatusCode);
    }

    [Fact]
    public async Task ScriptProfilesUseOnlyHostOwnedTransientHandles()
    {
        var root = Path.Combine(AppContext.BaseDirectory, ".cli-profile-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            await using var io = new WorkspaceIoService(root, Path.Combine(root, "transients"));
            var result = await io.ExecuteAsync("createTransientDirectory", JsonSerializer.SerializeToElement(new[] { "inspect" }));
            Assert.True(result.Ok);
            var handle = Assert.IsType<string>(result.Value);
            var path = io.GetTransientDirectory(handle);
            Assert.True(Directory.Exists(path));
            Assert.StartsWith(Path.Combine(root, "transients", "markdstage-inspect-"), path);
            Assert.Throws<UnauthorizedAccessException>(() => io.GetTransientDirectory("../outside"));
            await io.ExecuteAsync("removeTransientDirectory", JsonSerializer.SerializeToElement(new[] { handle }));
            Assert.False(Directory.Exists(path));
            Assert.Throws<UnauthorizedAccessException>(() => io.GetTransientDirectory(handle));
        }
        finally { Directory.Delete(root, true); }
    }
}
