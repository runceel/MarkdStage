using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Channels;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using MarkdStage.Core;

namespace MarkdStageApp.Services;

internal sealed class PresentationServer(
    PresentationSession session,
    Func<bool> presenterRunning,
    Action<WebApplication, string>? configureRoutes = null,
    bool mapAssets = false,
    Func<Task<bool>>? openPresenter = null,
    Func<Task>? closePresenter = null,
    Func<Task>? reloadSource = null,
    Func<string, bool, CancellationToken, Task<JsonElement>>? exportDeck = null,
    Func<string, CancellationToken, Task<JsonElement>>? exportData = null,
    Func<string, JsonElement, CancellationToken, Task>? exportStatus = null) : IAsyncDisposable
{
    private static readonly TimeSpan ShutdownTimeout = TimeSpan.FromSeconds(2);

    private readonly string _token = Guid.NewGuid().ToString("N");
    private readonly CancellationTokenSource _shutdown = new();
    private readonly SemaphoreSlim _lifecycleGate = new(1, 1);
    private WebApplication? _application;
    private string _webRoot = string.Empty;
    private VendorAssetProvider? _vendorAssets;
    private readonly Dictionary<string, ArchitectureEditorSession> _architectureEditors = [];
    private readonly Dictionary<string, ArchitectureEditorSession> _architectureEditorsById = [];

    public Uri? BaseUri { get; private set; }

    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        using var startup = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken,
            _shutdown.Token);
        await _lifecycleGate.WaitAsync(startup.Token);
        WebApplication? application = null;
        try
        {
            if (_application is not null)
            {
                return;
            }

            _webRoot = Path.Combine(AppContext.BaseDirectory, "Web");
            if (!File.Exists(Path.Combine(_webRoot, "index.html")))
            {
                throw new InvalidOperationException("Presentation renderer assets are missing.");
            }

            _vendorAssets = new VendorAssetProvider(_webRoot);
            _ = await _vendorAssets.GetMermaidAsync(startup.Token);

            var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions
            {
                ApplicationName = typeof(PresentationServer).Assembly.FullName,
                ContentRootPath = AppContext.BaseDirectory,
            });
            builder.Logging.ClearProviders();
            builder.WebHost.ConfigureKestrel(options => options.Listen(IPAddress.Loopback, 0));

            application = builder.Build();
            MapRoutes(application);
            await application.StartAsync(startup.Token);

            var addresses = application.Services
                .GetRequiredService<IServer>()
                .Features
                .Get<IServerAddressesFeature>()?
                .Addresses;
            var address = addresses?.SingleOrDefault()
                ?? throw new InvalidOperationException("Presentation server did not expose an address.");

            startup.Token.ThrowIfCancellationRequested();
            BaseUri = new Uri($"{address.TrimEnd('/')}/{_token}/", UriKind.Absolute);
            _application = application;
            application = null;
        }
        finally
        {
            if (application is not null)
            {
                await application.DisposeAsync();
            }
            _lifecycleGate.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        _shutdown.Cancel();
        await _lifecycleGate.WaitAsync();
        WebApplication? application;
        try
        {
            application = _application;
            _application = null;
            BaseUri = null;
        }
        finally
        {
            _lifecycleGate.Release();
        }

        if (application is null)
        {
            return;
        }

        using var timeout = new CancellationTokenSource(ShutdownTimeout);
        try
        {
            await application.StopAsync(timeout.Token);
            await application.DisposeAsync().AsTask().WaitAsync(timeout.Token);
        }
        catch (OperationCanceledException) when (timeout.IsCancellationRequested)
        {
        }
    }

    private void MapRoutes(WebApplication application)
    {
        application.Use(async (context, next) =>
        {
            if (!context.Request.Host.Host.Equals("127.0.0.1", StringComparison.Ordinal) ||
                BaseUri is not null && context.Request.Host.Port != BaseUri.Port)
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                return;
            }

            var origin = context.Request.Headers.Origin.ToString();
            if (HttpMethods.IsPost(context.Request.Method) &&
                origin.Length > 0 &&
                !origin.Equals(
                    $"{context.Request.Scheme}://{context.Request.Host}",
                    StringComparison.OrdinalIgnoreCase))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                return;
            }

            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers.ContentSecurityPolicy =
                "default-src 'self'; img-src 'self' data: https://workspace.markdstage.invalid https://web.markdstage.invalid; " +
                "style-src 'self' 'unsafe-inline' https://web.markdstage.invalid https://workspace.markdstage.invalid; " +
                "font-src 'self' https://workspace.markdstage.invalid https://web.markdstage.invalid; " +
                "media-src 'self' https://workspace.markdstage.invalid; " +
                "script-src 'self' https://web.markdstage.invalid; connect-src 'self'; object-src 'none'; base-uri 'none'";
            context.Response.Headers.XContentTypeOptions = "nosniff";
            await next();
        });

        var prefix = $"/{_token}";
        application.MapGet($"{prefix}/", context => SendFileAsync(
            context,
            Path.Combine(_webRoot, "index.html"),
            "text/html; charset=utf-8"));
        application.MapGet($"{prefix}/index.html", context => SendFileAsync(
            context,
            Path.Combine(_webRoot, "index.html"),
            "text/html; charset=utf-8"));
        application.MapGet($"{prefix}/renderer/{{**path}}", (
            HttpContext context,
            string path) => SendStaticAsync(context, Path.Combine(_webRoot, "renderer"), path));
        application.MapGet($"{prefix}/vendor/mermaid.min.js", async context =>
        {
            var bytes = await _vendorAssets!.GetMermaidAsync(context.RequestAborted);
            context.Response.ContentType = "text/javascript; charset=utf-8";
            context.Response.ContentLength = bytes.Length;
            await context.Response.Body.WriteAsync(bytes, context.RequestAborted);
        });
        application.MapGet($"{prefix}/vendor/{{**path}}", (
            HttpContext context,
            string path) => SendStaticAsync(context, Path.Combine(_webRoot, "vendor"), path));

        application.MapGet($"{prefix}/state", (HttpContext context) =>
        {
            var snapshot = session.GetSnapshot();
            var offset = int.TryParse(context.Request.Query["offset"], out var parsedOffset)
                ? Math.Clamp(parsedOffset, -1, 1)
                : 0;
            var targetIndex = snapshot.Total == 0
                ? 0
                : Math.Clamp(snapshot.Index + offset, 0, snapshot.Total - 1);
            var markdown = snapshot.Total == 0 ? string.Empty : snapshot.Slides[targetIndex];
            var customThemeMetadata = string.IsNullOrWhiteSpace(snapshot.Theme.MetadataJson)
                ? null
                : JsonNode.Parse(snapshot.Theme.MetadataJson);

            return Results.Json(new
            {
                version = snapshot.Version,
                deckVersion = snapshot.DeckVersion,
                markdown,
                index = targetIndex,
                total = snapshot.Total,
                theme = snapshot.Theme.Name,
                themeLocked = false,
                customThemeCss = snapshot.Theme.Css,
                customThemeMeta = customThemeMetadata,
                mode = "deck",
                sourceBacked = !string.IsNullOrWhiteSpace(snapshot.SourcePath),
                sourceMode = "live",
                sourceWatchStatus = "watching",
                sourceWatchError = "",
                presenterRunning = presenterRunning(),
                presenterWindowAvailable = openPresenter is not null && closePresenter is not null,
                presenterViewAvailable = true,
                pdfExportAvailable = exportDeck is not null &&
                    !string.IsNullOrWhiteSpace(snapshot.SourcePath),
                pptxExportAvailable = exportDeck is not null &&
                    !string.IsNullOrWhiteSpace(snapshot.SourcePath),
                markdownImportAvailable = false,
                sourceModeAvailable = false,
                architectureEditAvailable = !string.IsNullOrWhiteSpace(snapshot.SourcePath),
                architectureEdit = false,
                architectureDetailedEdit = !string.IsNullOrWhiteSpace(snapshot.SourcePath),
                architectureDetailedEditTarget = !string.IsNullOrWhiteSpace(snapshot.SourcePath)
                    ? "window"
                    : "",
            });
        });

        application.MapGet($"{prefix}/deck", () =>
        {
            var snapshot = session.GetSnapshot();
            return Results.Json(new
            {
                deckVersion = snapshot.DeckVersion,
                slides = snapshot.Slides,
            });
        });

        application.MapPost($"{prefix}/navigate", async (HttpContext context) =>
        {
            var request = await context.Request.ReadFromJsonAsync<NavigationRequest>(
                cancellationToken: context.RequestAborted);
            if (request is null || (request.Index.HasValue == request.Delta.HasValue))
            {
                return Results.BadRequest(new
                {
                    ok = false,
                    error = "exactly one of index or delta is required",
                });
            }

            var snapshot = session.GetSnapshot();
            if (snapshot.Total == 0)
            {
                return Results.Conflict(new { ok = false, error = "no_deck" });
            }

            var changed = request.Index.HasValue
                ? await session.NavigateToAsync(request.Index.Value)
                : await session.NavigateByAsync(request.Delta!.Value);
            snapshot = session.GetSnapshot();

            return Results.Json(new
            {
                ok = true,
                changed,
                version = snapshot.Version,
                index = snapshot.Index,
                total = snapshot.Total,
                mode = "deck",
            });
        });

        application.MapPost($"{prefix}/present", async () =>
        {
            if (openPresenter is null)
                return Results.Json(new { ok = false, error = "not_available" }, statusCode: 501);
            if (session.GetSnapshot().Total == 0)
                return Results.Json(new { ok = false, error = "no_deck" }, statusCode: 409);
            try
            {
                var alreadyRunning = await openPresenter();
                return Results.Json(new { ok = true, alreadyRunning });
            }
            catch (Exception error) when (error is InvalidOperationException or IOException)
            {
                return Results.Json(new
                {
                    ok = false,
                    error = "presenter_launch_failed",
                    message = error.Message,
                }, statusCode: 500);
            }
        });

        application.MapDelete($"{prefix}/present", async () =>
        {
            if (closePresenter is null)
                return Results.Json(new { ok = false, error = "not_available" }, statusCode: 501);
            await closePresenter();
            return Results.Json(new { ok = true });
        });

        application.MapGet(
            $"{prefix}/export-data",
            async Task<IResult> (HttpContext context) =>
            {
                if (exportData is null)
                    return Results.Json(new { ok = false, error = "not_available" }, statusCode: 501);
                var token = context.Request.Query["token"].ToString();
                if (string.IsNullOrWhiteSpace(token))
                    return Results.Json(new { ok = false, error = "invalid_token" }, statusCode: 400);
                try
                {
                    return Results.Json(await exportData(token, context.RequestAborted));
                }
                catch (DeckLoadException error)
                {
                    return Results.Json(new
                    {
                        ok = false,
                        error = error.Code,
                        message = error.Message,
                    }, statusCode: 400);
                }
            });

        application.MapPost(
            $"{prefix}/export-status",
            async Task<IResult> (HttpContext context) =>
            {
                if (exportStatus is null)
                    return Results.Json(new { ok = false, error = "not_available" }, statusCode: 501);
                var token = context.Request.Query["token"].ToString();
                var body = await ReadJsonElementAsync(context, 256 * 1024);
                if (string.IsNullOrWhiteSpace(token) || body is null)
                    return Results.Json(new { ok = false, error = "bad_request" }, statusCode: 400);
                try
                {
                    await exportStatus(token, body.Value, context.RequestAborted);
                    return Results.NoContent();
                }
                catch (DeckLoadException error)
                {
                    return Results.Json(new
                    {
                        ok = false,
                        error = error.Code,
                        message = error.Message,
                    }, statusCode: 400);
                }
            });

        application.MapPost(
            $"{prefix}/export",
            async Task<IResult> (HttpContext context) =>
                await ExportAsync(context, "pdf", mermaidImageFallback: false));

        application.MapPost(
            $"{prefix}/export-pptx",
            async Task<IResult> (HttpContext context) =>
            {
                var request = context.Request.ContentLength == 0
                    ? new PptxExportRequest(false)
                    : await ReadJsonAsync<PptxExportRequest>(context, 4096);
                if (request is null)
                    return Results.Json(new { ok = false, error = "bad_request" }, statusCode: 400);
                return await ExportAsync(context, "pptx", request.MermaidImageFallback);
            });

        application.MapPost($"{prefix}/architecture-editor/open", async (HttpContext context) =>
        {
            var request = await context.Request.ReadFromJsonAsync<ArchitectureOpenRequest>(
                cancellationToken: context.RequestAborted);
            var snapshot = session.GetSnapshot();
            if (request is null || snapshot.Total == 0 || string.IsNullOrWhiteSpace(snapshot.SourcePath))
                return Results.Json(new { ok = false, error = "source_not_available" }, statusCode: 409);
            var slideIndex = request.Index ?? snapshot.Index;
            var blockIndex = request.Block ?? 0;
            var globalBlock = ArchitectureEditorSession.ImportedBlockIndex(
                snapshot.Slides, slideIndex, blockIndex);
            if (globalBlock is null)
                return Results.Json(new { ok = false, error = "block_not_found" }, statusCode: 404);

            var key = $"{snapshot.SourcePath}\0{globalBlock.Value}";
            try
            {
                if (!_architectureEditors.TryGetValue(key, out var editor))
                {
                    editor = await ArchitectureEditorSession.CreateAsync(
                        snapshot, globalBlock.Value, reloadSource);
                    _architectureEditors[key] = editor;
                    _architectureEditorsById[editor.Id] = editor;
                }
                else
                {
                    editor.SetTheme(snapshot.Theme.Name);
                    if (!editor.Dirty)
                    {
                        var reloaded = await editor.ReloadAsync(discard: true);
                        if (reloaded.StatusCode >= 400)
                            return Results.Json(reloaded.Body, statusCode: reloaded.StatusCode);
                    }
                }
                return Results.Json(new
                {
                    ok = true,
                    url = new Uri(BaseUri!, $"architecture-editor/{editor.Id}/").AbsoluteUri,
                });
            }
            catch (ArchitectureEditorException error)
            {
                return Results.Json(new { ok = false, error = error.Code, message = error.Message }, statusCode: 409);
            }
        });

        application.MapMethods(
            $"{prefix}/architecture-editor/{{editorId}}/{{**route}}",
            new[] { "GET", "POST" },
            (HttpContext context, string editorId, string? route) =>
                HandleArchitectureEditorAsync(context, editorId, route ?? string.Empty));

        application.MapGet($"{prefix}/events", async context =>
        {
            context.Response.ContentType = "text/event-stream";
            context.Response.Headers.CacheControl = "no-cache";
            context.Response.Headers.Connection = "keep-alive";

            var channel = Channel.CreateBounded<long>(new BoundedChannelOptions(1)
            {
                SingleReader = true,
                SingleWriter = false,
                FullMode = BoundedChannelFullMode.DropOldest,
            });
            EventHandler<PresentationSnapshot> handler = (_, snapshot) =>
                channel.Writer.TryWrite(snapshot.Version);
            session.Changed += handler;
            using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(
                context.RequestAborted,
                _shutdown.Token);

            try
            {
                await foreach (var version in channel.Reader.ReadAllAsync(lifetime.Token))
                {
                    await context.Response.WriteAsync(
                        $"data: {version}\n\n",
                        lifetime.Token);
                    await context.Response.Body.FlushAsync(lifetime.Token);
                }
            }
            catch (OperationCanceledException) when (lifetime.IsCancellationRequested)
            {
            }
            finally
            {
                session.Changed -= handler;
                channel.Writer.TryComplete();
            }
        });

        application.MapGet($"{prefix}/assets/{{**path}}", (
            HttpContext context,
            string path) => SendDeckAssetAsync(context, path));
        application.MapGet($"{prefix}/background-assets/{{**path}}", (
            HttpContext context,
            string path) => SendBackgroundAssetAsync(context, path));
        application.MapGet($"{prefix}/theme-assets/{{**path}}", (
            HttpContext context,
            string path) => SendThemeAssetAsync(context, path));
        configureRoutes?.Invoke(application, prefix);
    }

    private async Task<IResult> ExportAsync(
        HttpContext context,
        string format,
        bool mermaidImageFallback)
    {
        if (exportDeck is null)
            return Results.Json(new { ok = false, error = "not_available" }, statusCode: 501);
        var snapshot = session.GetSnapshot();
        if (snapshot.Total == 0 ||
            string.IsNullOrWhiteSpace(snapshot.SourcePath) ||
            string.IsNullOrWhiteSpace(snapshot.WorkspaceRoot))
            return Results.Json(new { ok = false, error = "no_deck" }, statusCode: 409);

        try
        {
            var result = await exportDeck(format, mermaidImageFallback, context.RequestAborted);
            return Results.Json(result);
        }
        catch (DeckLoadException error)
        {
            var statusCode = error.Code switch
            {
                "no_deck" or "export_in_progress" => StatusCodes.Status409Conflict,
                _ => StatusCodes.Status500InternalServerError,
            };
            return Results.Json(new
            {
                ok = false,
                error = error.Code,
                message = error.Message,
            }, statusCode: statusCode);
        }
    }

    private async Task<IResult> HandleArchitectureEditorAsync(
        HttpContext context,
        string editorId,
        string route)
    {
        if (!_architectureEditorsById.TryGetValue(editorId, out var editor))
            return Results.NotFound();
        route = route.Trim('/');
        if (route.Length == 0 || route == "index.html")
            return FileResult(Path.Combine(_webRoot, "architecture-editor", "index.html"), "text/html; charset=utf-8");
        if (route == "state" && HttpMethods.IsGet(context.Request.Method))
            return Results.Json(editor.GetState());
        if (route == "events" && HttpMethods.IsGet(context.Request.Method))
        {
            await SendEditorEventsAsync(context, editor);
            return Results.Empty;
        }
        if (route == "asset-library" && HttpMethods.IsGet(context.Request.Method))
            return Results.Json(new { ok = true, assets = editor.ListAssets() });
        if (route.StartsWith("assets/", StringComparison.Ordinal) && HttpMethods.IsGet(context.Request.Method))
        {
            var asset = editor.ResolveAsset(route["assets/".Length..]);
            return asset is null
                ? Results.NotFound()
                : FileResult(asset, MimeFor(asset));
        }
        if (route == "asset-upload" && HttpMethods.IsPost(context.Request.Method))
        {
            var result = await editor.ImportAssetAsync(
                context.Request.Query["name"].ToString(),
                context.Request.ContentType,
                context.Request.Body,
                context.Request.ContentLength);
            return Results.Json(result.Body, statusCode: result.StatusCode);
        }
        if (route == "draft" && HttpMethods.IsPost(context.Request.Method))
        {
            var request = await ReadJsonAsync<ArchitectureDraftRequest>(
                context, ArchitectureEditorSession.MaxDraftBytes);
            if (request is null)
                return Results.Json(new { ok = false, error = "invalid_draft" }, statusCode: 400);
            var result = await editor.UpdateDraftAsync(
                request.Source ?? string.Empty, request.Generation, request.Revision);
            return Results.Json(result.Body, statusCode: result.StatusCode);
        }
        if (route == "save" && HttpMethods.IsPost(context.Request.Method))
        {
            var request = await ReadJsonAsync<ArchitectureSaveRequest>(context, 4096);
            if (request is null)
                return Results.Json(new { ok = false, error = "bad_request" }, statusCode: 400);
            var result = await editor.SaveAsync(request.Generation, request.Revision);
            return Results.Json(result.Body, statusCode: result.StatusCode);
        }
        if (route == "reload" && HttpMethods.IsPost(context.Request.Method))
        {
            var request = await ReadJsonAsync<ArchitectureReloadRequest>(context, 4096);
            if (request is null)
                return Results.Json(new { ok = false, error = "invalid_reload" }, statusCode: 400);
            var result = await editor.ReloadAsync(request.Discard);
            return Results.Json(result.Body, statusCode: result.StatusCode);
        }
        if (route == "editor/editor.js")
            return FileResult(Path.Combine(_webRoot, "architecture-editor", "editor.js"), "text/javascript; charset=utf-8");
        if (route == "editor/editor.css")
            return FileResult(Path.Combine(_webRoot, "architecture-editor", "editor.css"), "text/css; charset=utf-8");
        if (route.StartsWith("renderer/", StringComparison.Ordinal))
        {
            var file = PathSecurity.ResolveFileInside(
                Path.Combine(_webRoot, "renderer"), route["renderer/".Length..]);
            return file is null ? Results.NotFound() : FileResult(file, MimeFor(file));
        }
        return Results.NotFound();
    }

    private async Task SendEditorEventsAsync(HttpContext context, ArchitectureEditorSession editor)
    {
        context.Response.ContentType = "text/event-stream";
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers.Connection = "keep-alive";
        var channel = Channel.CreateBounded<long>(new BoundedChannelOptions(1)
        {
            SingleReader = true,
            SingleWriter = false,
            FullMode = BoundedChannelFullMode.DropOldest,
        });
        EventHandler<long> handler = (_, version) => channel.Writer.TryWrite(version);
        editor.Changed += handler;
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(
            context.RequestAborted, _shutdown.Token);
        try
        {
            await context.Response.WriteAsync($"data: {editor.Version}\n\n", lifetime.Token);
            await context.Response.Body.FlushAsync(lifetime.Token);
            await foreach (var version in channel.Reader.ReadAllAsync(lifetime.Token))
            {
                await context.Response.WriteAsync($"data: {version}\n\n", lifetime.Token);
                await context.Response.Body.FlushAsync(lifetime.Token);
            }
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested)
        {
        }
        finally
        {
            editor.Changed -= handler;
            channel.Writer.TryComplete();
        }
    }

    private static IResult FileResult(string path, string contentType) =>
        File.Exists(path)
            ? Results.File(path, contentType, enableRangeProcessing: false)
            : Results.NotFound();

    private static async Task<JsonElement?> ReadJsonElementAsync(
        HttpContext context,
        int maxBytes)
    {
        if (context.Request.ContentLength is > 0 &&
            context.Request.ContentLength > maxBytes)
            return null;
        using var memory = new MemoryStream();
        await context.Request.Body.CopyToAsync(memory, context.RequestAborted);
        if (memory.Length == 0 || memory.Length > maxBytes) return null;
        try
        {
            using var document = JsonDocument.Parse(memory.ToArray());
            return document.RootElement.Clone();
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static async Task<T?> ReadJsonAsync<T>(HttpContext context, int maxBytes)
    {
        if (context.Request.ContentLength is > 0 &&
            context.Request.ContentLength > maxBytes)
            return default;
        using var memory = new MemoryStream();
        await context.Request.Body.CopyToAsync(memory, context.RequestAborted);
        if (memory.Length > maxBytes) return default;
        try
        {
            return JsonSerializer.Deserialize<T>(memory.ToArray(), new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            });
        }
        catch (JsonException)
        {
            return default;
        }
    }

    private async Task SendDeckAssetAsync(HttpContext context, string relativePath)
    {
        var snapshot = session.GetSnapshot();
        if (string.IsNullOrWhiteSpace(snapshot.SourcePath) ||
            string.IsNullOrWhiteSpace(snapshot.WorkspaceRoot))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        var resolved = DeckAssetResolver.Resolve(snapshot.SourcePath, snapshot.WorkspaceRoot, relativePath);
        if (resolved is not null)
        {
            if (mapAssets) { RedirectWorkspaceAsset(context, snapshot.WorkspaceRoot, resolved); return; }
            await SendFileAsync(context, resolved, MimeFor(resolved), 10 * 1024 * 1024);
            return;
        }

        context.Response.StatusCode = StatusCodes.Status404NotFound;
    }

    private async Task SendBackgroundAssetAsync(HttpContext context, string relativePath)
    {
        var snapshot = session.GetSnapshot();
        try
        {
            var resolved = SlideBackgrounds.Resolve(
                snapshot.SourcePath, snapshot.WorkspaceRoot, "/assets/" + relativePath);
            if (mapAssets) { RedirectWorkspaceAsset(context, snapshot.WorkspaceRoot, resolved); return; }
            await SendFileAsync(context, resolved, MimeFor(resolved), SlideBackgrounds.MaxBytes);
        }
        catch (Exception error) when (error is DeckLoadException or IOException or UnauthorizedAccessException)
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
        }
    }

    private async Task SendThemeAssetAsync(HttpContext context, string relativePath)
    {
        var root = session.GetSnapshot().Theme.AssetRoot;
        if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        try
        {
            var resolved = ThemeService.ResolveAsset(root, relativePath);
            if (mapAssets) { RedirectWorkspaceAsset(context, session.GetSnapshot().WorkspaceRoot, resolved); return; }
            await SendFileAsync(context, resolved, MimeFor(resolved), 2 * 1024 * 1024);
        }
        catch (Exception error) when (error is DeckLoadException or IOException or UnauthorizedAccessException)
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
        }
    }

    private Task SendStaticAsync(
        HttpContext context,
        string root,
        string relativePath)
    {
        var resolved = PathSecurity.ResolveFileInside(root, relativePath);
        if (resolved is null)
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return Task.CompletedTask;
        }

        return SendFileAsync(context, resolved, MimeFor(resolved));
    }

    private static void RedirectWorkspaceAsset(HttpContext context, string root, string path) =>
        context.Response.Redirect(MappedUrl("workspace.markdstage.invalid", Path.GetRelativePath(root, path)));

    private static string MappedUrl(string host, string relative) =>
        $"https://{host}/" + string.Join('/', relative.Replace('\\', '/').Split('/').Select(Uri.EscapeDataString));

    private static async Task SendFileAsync(
        HttpContext context,
        string path,
        string contentType,
        long maxBytes = long.MaxValue)
    {
        try
        {
            using var lease = WorkspacePathLease.Acquire(path, includeFile: true);
            await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read,
                65536, FileOptions.Asynchronous | FileOptions.SequentialScan);
            if (stream.Length > maxBytes)
            {
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
            }
            context.Response.ContentType = contentType;
            context.Response.ContentLength = stream.Length;
            await stream.CopyToAsync(context.Response.Body, context.RequestAborted);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            if (!context.Response.HasStarted) context.Response.StatusCode = StatusCodes.Status404NotFound;
        }
    }

    private static string MimeFor(string path) =>
        Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".html" => "text/html; charset=utf-8",
            ".css" => "text/css; charset=utf-8",
            ".js" or ".mjs" => "text/javascript; charset=utf-8",
            ".json" => "application/json; charset=utf-8",
            ".svg" => "image/svg+xml",
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".gif" => "image/gif",
            ".webp" => "image/webp",
            ".avif" => "image/avif",
            ".ico" => "image/x-icon",
            ".woff" => "font/woff",
            ".woff2" => "font/woff2",
            ".mp4" => "video/mp4",
            ".webm" => "video/webm",
            _ => "application/octet-stream",
        };

    private sealed record NavigationRequest(int? Index, int? Delta);
    private sealed record ArchitectureOpenRequest(int? Index, int? Block);
    private sealed record ArchitectureDraftRequest(string? Source, int Generation, int Revision);
    private sealed record ArchitectureSaveRequest(int Generation, int Revision);
    private sealed record ArchitectureReloadRequest(bool Discard);
    private sealed record PptxExportRequest(bool MermaidImageFallback);
}
