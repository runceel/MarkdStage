using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MarkdStage.Core;
using MarkdStageApp.Services;

namespace MarkdStage.Core.Tests;

public sealed class PresentationServerTests
{
    [WindowsFact]
    public async Task ApplicationStateUsesSharedRendererAndPresenterRoutes()
    {
        var session = new PresentationSession();
        session.ApplySnapshot(new PresentationSnapshot(
            ["# Slide"], 0, 1, 1, "slides.md", Directory.GetCurrentDirectory(), new ThemeState("dark")));
        var running = false;
        var opened = 0;
        var closed = 0;
        await using var server = new PresentationServer(
            session,
            () => running,
            openPresenter: () =>
            {
                var alreadyRunning = running;
                running = true;
                opened++;
                return Task.FromResult(alreadyRunning);
            },
            closePresenter: () =>
            {
                running = false;
                closed++;
                return Task.CompletedTask;
            },
            exportDeck: (_, _, _) => Task.FromResult(
                JsonSerializer.SerializeToElement(new { ok = true })));
        await server.StartAsync();
        using var client = new HttpClient { BaseAddress = server.BaseUri };

        using (var state = JsonDocument.Parse(await client.GetStringAsync("state")))
        {
            Assert.True(state.RootElement.GetProperty("presenterViewAvailable").GetBoolean());
            Assert.True(state.RootElement.GetProperty("presenterWindowAvailable").GetBoolean());
            Assert.False(state.RootElement.GetProperty("markdownImportAvailable").GetBoolean());
            Assert.True(state.RootElement.GetProperty("pdfExportAvailable").GetBoolean());
            Assert.True(state.RootElement.GetProperty("pptxExportAvailable").GetBoolean());
        }

        using var openedResponse = await client.PostAsync("present", null);
        Assert.Equal(HttpStatusCode.OK, openedResponse.StatusCode);
        Assert.False((await openedResponse.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("alreadyRunning").GetBoolean());
        Assert.Equal(1, opened);

        using var closedResponse = await client.DeleteAsync("present");
        Assert.Equal(HttpStatusCode.OK, closedResponse.StatusCode);
        Assert.Equal(1, closed);
    }

    [WindowsFact]
    public async Task ExportRoutesUseSourceBasedOutputs()
    {
        var root = CreateTestWorkspace();
        try
        {
            var sourcePath = Path.Combine(root, "quarterly.deck.md");
            await File.WriteAllTextAsync(sourcePath, "# Deck");
            var session = SourceBackedSession(sourcePath, root, "# Deck");
            var fallbackRequested = false;
            await using var server = new PresentationServer(
                session,
                () => false,
                exportDeck: (format, fallback, _) =>
                {
                    fallbackRequested = fallback;
                    return Task.FromResult(JsonSerializer.SerializeToElement(new
                    {
                        ok = true,
                        format,
                        path = Path.ChangeExtension(sourcePath, $".{format}"),
                        total = 1,
                        theme = "dark",
                        bytes = 4,
                    }));
                });
            await server.StartAsync();
            using var client = new HttpClient { BaseAddress = server.BaseUri };

            using var pdf = await client.PostAsync("export", null);
            Assert.Equal(HttpStatusCode.OK, pdf.StatusCode);
            var pdfBody = await pdf.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal("pdf", pdfBody.GetProperty("format").GetString());
            Assert.Equal(
                Path.Combine(root, "quarterly.deck.pdf"),
                pdfBody.GetProperty("path").GetString());

            using var pptx = await client.PostAsJsonAsync("export-pptx", new
            {
                mermaidImageFallback = true,
            });
            Assert.Equal(HttpStatusCode.OK, pptx.StatusCode);
            var pptxBody = await pptx.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal("pptx", pptxBody.GetProperty("format").GetString());
            Assert.True(fallbackRequested);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [WindowsFact]
    public async Task SourceBackedDeckOpensEditorAndSavesExistingFence()
    {
        var root = CreateTestWorkspace();
        try
        {
            const string originalSource =
                """
                {
                  "version": 1,
                  "title": "Before",
                  "canvas": { "width": 800, "height": 450 },
                  "elements": []
                }
                """;
            var markdown = $"# Diagram\r\n\r\n```architecture\r\n{originalSource.Replace("\n", "\r\n")}\r\n```\r\n";
            var sourcePath = Path.Combine(root, "slides.md");
            await File.WriteAllTextAsync(sourcePath, markdown);
            var session = SourceBackedSession(sourcePath, root, markdown);
            var reloaded = 0;
            await using var server = new PresentationServer(
                session, () => false, reloadSource: () =>
                {
                    reloaded++;
                    return Task.CompletedTask;
                });
            await server.StartAsync();
            using var client = new HttpClient { BaseAddress = server.BaseUri };

            using (var state = JsonDocument.Parse(await client.GetStringAsync("state")))
            {
                Assert.True(state.RootElement.GetProperty("architectureEditAvailable").GetBoolean());
                Assert.True(state.RootElement.GetProperty("architectureDetailedEdit").GetBoolean());
                Assert.Equal("window", state.RootElement.GetProperty("architectureDetailedEditTarget").GetString());
            }

            var editorUri = await OpenEditorAsync(client);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(editorUri)).StatusCode);
            Assert.Equal(
                "text/javascript",
                (await client.GetAsync(editorUri + "editor/editor.js")).Content.Headers.ContentType?.MediaType);
            using var editorState = JsonDocument.Parse(await client.GetStringAsync(editorUri + "state"));
            var generation = editorState.RootElement.GetProperty("generation").GetInt32();
            const string changedSource =
                """
                {
                  "version": 1,
                  "title": "After",
                  "canvas": { "width": 800, "height": 450 },
                  "elements": []
                }
                """;
            using var draft = await client.PostAsJsonAsync(editorUri + "draft", new
            {
                source = changedSource,
                generation,
                revision = 1,
            });
            Assert.Equal(HttpStatusCode.OK, draft.StatusCode);
            using var save = await client.PostAsJsonAsync(editorUri + "save", new
            {
                generation,
                revision = 1,
            });
            Assert.Equal(HttpStatusCode.OK, save.StatusCode);
            Assert.Equal(1, reloaded);

            var saved = await File.ReadAllTextAsync(sourcePath);
            Assert.Contains("\"title\": \"After\"", saved);
            Assert.DoesNotContain("\"title\": \"Before\"", saved);
            Assert.StartsWith("# Diagram\r\n\r\n```architecture\r\n", saved);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [WindowsFact]
    public async Task EditorSaveRejectsExternalSourceChange()
    {
        var root = CreateTestWorkspace();
        try
        {
            const string source =
                """
                {
                  "version": 1,
                  "title": "Original",
                  "canvas": { "width": 800, "height": 450 },
                  "elements": []
                }
                """;
            var markdown = $"# Diagram\n\n```architecture\n{source}\n```\n";
            var sourcePath = Path.Combine(root, "slides.md");
            await File.WriteAllTextAsync(sourcePath, markdown);
            var session = SourceBackedSession(sourcePath, root, markdown);
            await using var server = new PresentationServer(session, () => false);
            await server.StartAsync();
            using var client = new HttpClient { BaseAddress = server.BaseUri };

            var editorUri = await OpenEditorAsync(client);
            using var editorState = JsonDocument.Parse(await client.GetStringAsync(editorUri + "state"));
            var generation = editorState.RootElement.GetProperty("generation").GetInt32();
            var changedSource = source.Replace("Original", "Draft", StringComparison.Ordinal);
            using var draft = await client.PostAsJsonAsync(editorUri + "draft", new
            {
                source = changedSource,
                generation,
                revision = 1,
            });
            Assert.Equal(HttpStatusCode.OK, draft.StatusCode);

            var external = markdown.Replace("# Diagram", "# Externally changed", StringComparison.Ordinal);
            await File.WriteAllTextAsync(sourcePath, external);
            using var save = await client.PostAsJsonAsync(editorUri + "save", new
            {
                generation,
                revision = 1,
            });
            Assert.Equal(HttpStatusCode.Conflict, save.StatusCode);
            var body = await save.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal("source_changed", body.GetProperty("error").GetString());
            Assert.Equal(external, await File.ReadAllTextAsync(sourcePath));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    private static PresentationSession SourceBackedSession(string sourcePath, string root, string markdown)
    {
        var session = new PresentationSession();
        session.ApplySnapshot(new PresentationSnapshot(
            [markdown], 0, 1, 1, sourcePath, root, new ThemeState("dark")));
        return session;
    }

    private static async Task<string> OpenEditorAsync(HttpClient client)
    {
        using var response = await client.PostAsJsonAsync("architecture-editor/open", new
        {
            index = 0,
            block = 0,
        });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var url = new Uri(body.GetProperty("url").GetString()!);
        return url.PathAndQuery[(client.BaseAddress!.AbsolutePath.Length)..];
    }

    private static string CreateTestWorkspace()
    {
        var root = Path.Combine(
            AppContext.BaseDirectory, "ArchitectureEditorTests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        return root;
    }

}
