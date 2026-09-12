using System.Net;
using System.Text.Json.Nodes;
using MarkdStageApp.Services;

namespace MarkdStage.Core.Tests;

public sealed class DesktopBackgroundTests
{
    [Theory]
    [InlineData("assets/photo (日本語).PNG", "/assets/photo (日本語).PNG")]
    [InlineData("/assets/.hidden/.photo.jpeg", "/assets/.hidden/.photo.jpeg")]
    [InlineData("/assets/100%.svg", "/assets/100%.svg")]
    [InlineData("/assets/%2e%2e/%2f.webp", "/assets/%2e%2e/%2f.webp")]
    public void Parse_PreservesLiteralFilenames(string value, string expected) =>
        Assert.Equal(expected, SlideBackgrounds.Parse(value));

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("data:image/png;base64,eA==")]
    [InlineData("https://example.com/image.png")]
    [InlineData("//example.com/image.png")]
    [InlineData("/assets/../image.png")]
    [InlineData("/assets/./image.png")]
    [InlineData("/assets//image.png")]
    [InlineData("/assets/image.png/")]
    [InlineData("/assets/folder\\image.png")]
    [InlineData("/assets/image:alternate.png")]
    [InlineData("/assets/image.png?query")]
    [InlineData("/assets/image.png#fragment")]
    [InlineData("/assets/im\0age.png")]
    [InlineData("/assets/im\tage.png")]
    [InlineData("/assets/im\u007fage.png")]
    [InlineData("/assets/image.gif")]
    [InlineData("/assets/image.avif")]
    public void Parse_RejectsInvalidDeclarations(string value) =>
        Assert.Throws<DeckLoadException>(() => SlideBackgrounds.Parse(value));

    [WindowsFact]
    public async Task Loader_ValidatesEveryLayoutAndThemeBeforeReplacingSession()
    {
        using var fixture = new AssetFixture();
        fixture.Write("assets/photo.png", "background");
        fixture.Write("theme.css", ":root { --bg: #fff; }");
        var loader = new DeckLoader(new MarkdownDeckParser(), new LegacyThemeService());
        var session = new PresentationSession();
        foreach (var theme in new[] { "dark", "light", "microsoft", "custom" })
        {
            foreach (var layout in new[] { "title", "section", "backcover", "default", "center" })
            {
                fixture.Write("slides.md",
                    $"---\ntheme: {theme}\ntheme-file: theme.css\nlayout: {layout}\nbackground-image: /assets/photo.png\n---\n# Slide");
                var loaded = await loader.LoadAsync(fixture.Source);
                var snapshot = session.ApplySnapshot(new PresentationSnapshot(
                    loaded.Document.Slides, 0, 1, 1, loaded.SourcePath, loaded.WorkspaceRoot, loaded.Theme));
                fixture.Write("slides.md",
                    $"---\ntheme: {theme}\nlayout: {layout}\nbackground-image:\n---\n# Invalid");
                var error = await Assert.ThrowsAsync<DeckLoadException>(() => loader.LoadAsync(fixture.Source));
                Assert.Contains("Slide 1:", error.Message);
                Assert.Same(snapshot, session.GetSnapshot());
            }
        }

        fixture.Write("slides.md", "# Valid first slide\n\n---\nbackground-image: /assets/missing.png\n---\n# Invalid");
        var laterError = await Assert.ThrowsAsync<DeckLoadException>(() => loader.LoadAsync(fixture.Source));
        Assert.Contains("Slide 2:", laterError.Message);
    }

    [WindowsFact]
    public void Resolve_UsesAdjacentAssetsThenWorkspaceAndEnforcesLimits()
    {
        using var fixture = new AssetFixture();
        var source = fixture.Write("nested/slides.md", "# Slides");
        var adjacent = fixture.Write("nested/assets/photo (日本語).PNG", "adjacent");
        var fallback = fixture.Write("assets/photo (日本語).PNG", "workspace");
        const string declaration = "assets/photo (日本語).PNG";
        Assert.Equal(adjacent, SlideBackgrounds.Resolve(source, fixture.Root, declaration));
        File.Delete(adjacent);
        Assert.Equal(fallback, SlideBackgrounds.Resolve(source, fixture.Root, declaration));
        File.Delete(source);
        Directory.Delete(Path.GetDirectoryName(source)!, recursive: true);
        Assert.Equal(fallback, SlideBackgrounds.Resolve(source, fixture.Root, declaration));

        using (var stream = File.OpenWrite(fallback))
        {
            stream.SetLength(SlideBackgrounds.MaxBytes);
        }
        Assert.Equal(fallback, SlideBackgrounds.Resolve(source, fixture.Root, declaration));
        using (var stream = File.OpenWrite(fallback))
        {
            stream.SetLength(SlideBackgrounds.MaxBytes + 1);
        }
        Assert.Throws<DeckLoadException>(() => SlideBackgrounds.Resolve(source, fixture.Root, declaration));
        Assert.Throws<DeckLoadException>(() => SlideBackgrounds.Resolve(source, fixture.Root, "/assets/missing.png"));
    }

    [WindowsFact]
    public void Resolve_RejectsSymlinkEscapes()
    {
        using var fixture = new AssetFixture();
        fixture.Write("assets/inside.png", "inside");
        fixture.Write("outside.png", "outside assets");
        var link = Path.Combine(fixture.Root, "assets", "escape.png");
        File.CreateSymbolicLink(link, Path.Combine(fixture.Root, "outside.png"));
        Assert.Throws<DeckLoadException>(() =>
            SlideBackgrounds.Resolve(fixture.Source, fixture.Root, "/assets/escape.png"));
        fixture.Write("assets/escape-fallback.png", "workspace");
        var nestedSource = fixture.Write("nested/slides.md", "# Slides");
        Directory.CreateDirectory(Path.Combine(fixture.Root, "nested", "assets"));
        File.CreateSymbolicLink(Path.Combine(fixture.Root, "nested", "assets", "escape-fallback.png"),
            Path.Combine(fixture.Root, "outside.png"));
        Assert.Throws<DeckLoadException>(() =>
            SlideBackgrounds.Resolve(nestedSource, fixture.Root, "/assets/escape-fallback.png"));
        Directory.Delete(Path.Combine(fixture.Root, "nested", "assets"), recursive: true);

        using var outside = new AssetFixture();
        outside.Write("photo.png", "outside workspace");
        var nested = fixture.Write("nested/slides.md", "# Slides");
        var directoryLink = Path.Combine(fixture.Root, "nested", "assets");
        Directory.CreateSymbolicLink(directoryLink, outside.Root);
        Assert.Throws<DeckLoadException>(() =>
            SlideBackgrounds.Resolve(nested, fixture.Root, "/assets/photo.png"));
    }

    [WindowsFact]
    public async Task Theme_MapsAllBackgroundsAndRejectsInvalidMetadataAndAssets()
    {
        using var fixture = new AssetFixture();
        fixture.Write("theme.css", "--bg: #fff;");
        fixture.Write("assets/image.png", "image");
        var document = new MarkdownDeckParser().Parse("---\ntheme: custom\ntheme-file: theme.css\n---\n# Slide");
        var service = new LegacyThemeService();
        const string image = """{"image":"assets/image.png"}""";
        fixture.Write("theme.json", """
            {"version":1,"background":IMAGE,"layouts":{"default":{"background":IMAGE},"center":{"background":IMAGE}},"cover":{"background":IMAGE,"logo":{"image":"assets/image.png","alt":"Brand"}},"backcover":{"logo":{"image":"assets/image.png","alt":"Brand"},"copyright":"Copyright"}}
            """.Replace("IMAGE", image));
        var loaded = await service.LoadAsync(document, fixture.Source, fixture.Root, default);
        var metadata = JsonNode.Parse(loaded.MetadataJson)!;
        Assert.Equal("theme-assets/assets/image.png", metadata["background"]!["image"]!.GetValue<string>());
        foreach (var layout in new[] { "default", "center" })
        {
            Assert.Equal("theme-assets/assets/image.png", metadata["layouts"]![layout]!["background"]!["image"]!.GetValue<string>());
        }
        Assert.Equal("theme-assets/assets/image.png", metadata["cover"]!["background"]!["image"]!.GetValue<string>());
        Assert.Equal("theme-assets/assets/image.png", metadata["backcover"]!["logo"]!["image"]!.GetValue<string>());

        foreach (var declaration in new[]
                 {
                     "\"background\":null",
                     "\"background\":{\"image\":\"assets/image.png\",\"alt\":{}}",
                     "\"background\":{\"image\":\"assets/image.png\",\"alt\":null}",
                     "\"background\":{\"image\":\"assets/image.png\",\"unknown\":true}",
                     "\"background\":{\"image\":\"assets/../image.png\"}",
                     "\"background\":{\"image\":\"assets/missing.png\"}",
                     "\"background\":{\"image\":\"assets/image.gif\"}",
                     "\"layouts\":null",
                     "\"layouts\":{\"title\":{}}",
                     "\"layouts\":{\"default\":null}",
                     "\"layouts\":{\"center\":{\"logo\":{}}}",
                     "\"layouts\":{\"center\":{\"background\":null}}",
                     "\"unknown\":{}",
                 })
        {
            fixture.Write("theme.json", "{\"version\":1," + declaration + "}");
            await Assert.ThrowsAsync<DeckLoadException>(() =>
                service.LoadAsync(document, fixture.Source, fixture.Root, default));
        }

        fixture.Write("theme.json", $$"""{"version":1,"background":{{image}}}""");
        using (var stream = File.OpenWrite(Path.Combine(fixture.Root, "assets", "image.png")))
        {
            stream.SetLength(SlideBackgrounds.MaxBytes + 1);
        }
        await Assert.ThrowsAsync<DeckLoadException>(() =>
            service.LoadAsync(document, fixture.Source, fixture.Root, default));
    }

    [WindowsFact]
    public async Task Server_ServesEncodedLiteralNamesAndRevalidatesAssets()
    {
        using var fixture = new AssetFixture();
        var session = new PresentationSession();
        session.ApplySnapshot(new PresentationSnapshot(new MarkdownDeckParser().Parse("# Slide").Slides, 0, 1, 1,
            fixture.Source, fixture.Root, new ThemeState("custom", AssetRoot: fixture.Root)));
        await using var server = new PresentationServer(session, () => false);
        await server.StartAsync();
        using var client = new HttpClient { BaseAddress = server.BaseUri };

        foreach (var name in new[] { "photo (日本語).PNG", ".hidden.jpeg", "100%.svg", "%2e%2e/%2f.webp", "%20.png", "%zz.png" })
        {
            fixture.Write("assets/" + name, name);
            var encoded = string.Join('/', name.Split('/').Select(Uri.EscapeDataString));
            using var response = await client.GetAsync("background-assets/" + encoded);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal(name, await response.Content.ReadAsStringAsync());
            Assert.StartsWith("image/", response.Content.Headers.ContentType!.MediaType);
        }

        var asset = fixture.Write("assets/image.png", "image");
        Assert.Equal("image", await client.GetStringAsync("background-assets/image.png"));
        Assert.Equal("image", await client.GetStringAsync("theme-assets/assets/image.png"));
        await ResizeAfterServingAsync(asset, SlideBackgrounds.MaxBytes + 1);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("background-assets/image.png")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("theme-assets/assets/image.png")).StatusCode);
        fixture.Write("assets/image.gif", "not a background");
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("background-assets/image.gif")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("theme-assets/assets/image.gif")).StatusCode);
        Assert.Equal("not a background", await client.GetStringAsync("assets/image.gif"));
        File.Delete(asset);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("background-assets/image.png")).StatusCode);
    }

    private static async Task ResizeAfterServingAsync(string path, long size)
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                using var stream = File.OpenWrite(path);
                stream.SetLength(size);
                return;
            }
            catch (IOException) when (attempt < 20)
            {
                // Kestrel can finish releasing its send-file handle after the client receives the response.
                await Task.Delay(25);
            }
        }
    }

    private sealed class AssetFixture : IDisposable
    {
        public string Root { get; } = Path.Combine(Directory.GetCurrentDirectory(), ".desktop-background-" + Guid.NewGuid().ToString("N"));
        public string Source => Path.Combine(Root, "slides.md");

        public AssetFixture()
        {
            Write(".git", string.Empty);
            Write("slides.md", "# Slides");
        }

        public string Write(string relative, string content)
        {
            var path = Path.Combine(Root, relative.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, content);
            return path;
        }

        public void Dispose() => Directory.Delete(Root, recursive: true);
    }
}

internal sealed class WindowsFactAttribute : FactAttribute
{
    public WindowsFactAttribute()
    {
        if (!OperatingSystem.IsWindows())
        {
            Skip = "Desktop asset confinement uses Windows file handles.";
        }
    }
}
