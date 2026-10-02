using System.Diagnostics;
using System.Reflection;
using System.Text;
using System.Text.Json;
using MarkdStage.Core;
using MarkdStageApp.Services;

namespace MarkdStage.Cli;

internal static class Program
{
    [STAThread]
    public static int Main(string[] argv)
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        using var interrupted = new CancellationTokenSource();
        ConsoleCancelEventHandler cancel = (_, args) => { args.Cancel = true; interrupted.Cancel(); };
        Console.CancelKeyPress += cancel;
        var json = argv.Contains("--json", StringComparer.Ordinal);
        var jsonLines = argv.Contains("--json-lines", StringComparer.Ordinal);
        try
        {
            var arguments = CliArguments.Parse(argv);
            if (arguments.IsHostOnly)
                return HostCommands.RunAsync(arguments, AppContext.BaseDirectory, Console.Out, interrupted.Token).GetAwaiter().GetResult();
            if (arguments.IsAppActivation)
                return PackagedAppLauncher.RunAsync(arguments, interrupted.Token).GetAwaiter().GetResult();
            return StaDispatcher.Run(dispatcher => RunAsync(arguments, dispatcher, interrupted.Token));
        }
        catch (OperationCanceledException) { return 130; }
        catch (Exception error)
        {
            var failure = error as CliException ?? new CliException("unexpected_error", error.Message, 4);
            if (json) Console.Out.WriteLine(JsonSerializer.Serialize(new { ok = false, error = failure.Code, message = failure.Message }, HostCommands.JsonOptions));
            else if (jsonLines) Console.Out.WriteLine(JsonSerializer.Serialize(new { ok = false, error = failure.Code, message = failure.Message }));
            else Console.Error.WriteLine(failure.Message);
            return failure.ExitCode;
        }
        finally { Console.CancelKeyPress -= cancel; }
    }

    private static async Task<int> RunAsync(CliArguments args, StaDispatcher dispatcher, CancellationToken cancellationToken)
    {
        string root;
        string? file;
        try
        {
            file = CliArguments.AbsoluteArgument(args.File);
            var workspace = CliArguments.WorkspaceArgument(args.Get("workspace"), file, Environment.CurrentDirectory);
            root = WorkspaceResolver.Resolve(CliArguments.AbsoluteArgument(workspace), file);
        }
        catch (UnauthorizedAccessException) { throw new CliException("path_outside_workspace", "The file must stay inside the workspace and cannot traverse links.", 2); }
        catch (ArgumentException) { throw new CliException("invalid_input", "Specify a Markdown file or an existing workspace directory.", 2); }
        catch (IOException) { throw new CliException("invalid_input", "The workspace is unavailable; specify an existing --workspace <directory>.", 2); }
        if (args.Command is "inspect" or "capture" or "export")
            _ = BrowserAutomation.FindBrowser();

        var session = new PresentationSession();
        var routes = new NativeCliRoutes();
        await using var browsers = new NativeBrowserHost();
        await using var io = new WorkspaceIoService(root, AppStorage.TransientRoot, browsers);
        var architectureEditorTarget = args.Get("architecture-editor-target") ?? "window";
        var notifyHostOfExport = args.Get("export-open-target") == "host" && args.Has("json-lines");
        PresentationServer? serverReference = null;
        await using var audience = new AudienceWindow(io, () => serverReference?.BaseUri);
        routes.PresenterRunning = () => audience.IsRunning;
        await using var server = new PresentationServer(session, () => audience.IsRunning, routes.Configure,
            openPresenter: args.IsPresentation ? audience.OpenAsync : null,
            closePresenter: args.IsPresentation ? audience.CloseAsync : null,
            exportDeck: args.IsPresentation
                ? async (format, mermaidImageFallback, _) =>
                {
                    var report = await ExportDeckAsync(routes.Runtime, session, format, mermaidImageFallback);
                    return notifyHostOfExport && serverReference?.BaseUri is { } previewUri
                        ? await ExportHostNotifier.NotifyAsync(report, format, root, previewUri, Console.Out, ProductVersion(), Console.Error)
                        : report;
                }
                : null,
            openExternal: args.IsPresentation ? OpenExternalAsync : null,
            openExportFile: args.IsPresentation ? OpenExportFileAsync : null,
            architectureEditorTarget: architectureEditorTarget,
            openArchitectureEditor:
                architectureEditorTarget == "host" && args.Has("json-lines")
                    ? async (previewUri, editorUri) =>
                    {
                        await Console.Out.WriteLineAsync(JsonSerializer.Serialize(new
                        {
                            type = "architecture-editor",
                            previewUrl = previewUri.AbsoluteUri,
                            url = editorUri.AbsoluteUri,
                            version = ProductVersion(),
                        }));
                        await Console.Out.FlushAsync();
                    }
                    : null);
        serverReference = server;
        if (args.Command != "validate") await server.StartAsync(cancellationToken);
        browsers.AllowedBaseUri = server.BaseUri;
        var profileResult = await io.ExecuteAsync("createTransientDirectory", JsonSerializer.SerializeToElement(new[] { "inspect" }), cancellationToken);
        if (!profileResult.Ok) throw new CliException("webview2_unavailable", "The package temporary data folder is inaccessible.", 3);
        var profile = io.GetTransientDirectory((string)profileResult.Value!);
        await using var scripts = new ScriptHost(async (operation, parameters) =>
        {
            if (operation == "cdp")
            {
                try
                {
                    return new { ok = true, value = await browsers.CommandAsync(parameters[0].GetString()!,
                        parameters[1].GetString()!, parameters[2], cancellationToken) };
                }
                catch (Exception error) { return new { ok = false, code = "rendering_failed", message = error.Message }; }
            }
            return await io.ExecuteAsync(operation, parameters, cancellationToken);
        }, cancellationToken);
        routes.Runtime = scripts;
        io.Changed += (_, change) => scripts.NotifyWatch(change);
        scripts.SnapshotChanged += value => ApplySnapshot(session, root, value);
        await scripts.InitializeAsync(dispatcher.Window, profile, AppContext.BaseDirectory);
        await scripts.InvokeAsync("initialize", new
        {
            workspace = root, baseUrl = server.BaseUri?.AbsoluteUri,
            theme = args.Get("theme"),
            themeFile = NormalizePathOption(root, args.Get("theme-file"), "invalid_theme_file"),
            architectureEditorTarget,
            presenterWindowAvailable = args.IsPresentation,
            exportAvailable = args.IsPresentation,
        });
        if (file is not null)
            await scripts.InvokeAsync("load", new { path = Path.GetRelativePath(root, file).Replace('\\', '/') });
        session.Navigate = async (index, delta) =>
        {
            var previous = session.GetSnapshot().Version;
            await scripts.InvokeAsync("navigate", new { body = index.HasValue ? (object)new { index = index.Value } : new { delta = delta!.Value } });
            return previous != session.GetSnapshot().Version;
        };
        if (args.IsPresentation)
        {
            var sourceMode = file is not null && args.Has("watch") ? "live" : "snapshot";
            if (sourceMode == "live") await scripts.InvokeAsync("sourceMode", new { body = new { mode = sourceMode } });
            var url = server.BaseUri!.AbsoluteUri + (args.Command == "present" ? "?presenter=1" : "");
            if (args.Has("json-lines"))
            {
                Console.WriteLine(JsonSerializer.Serialize(new
                {
                    type = "ready",
                    url,
                    operation = args.Command,
                    workspace = root,
                    sourceMode,
                    version = ProductVersion()
                }));
            }
            else if (args.Has("json")) Console.WriteLine(JsonSerializer.Serialize(new { ok = true, url, workspace = root }, HostCommands.JsonOptions));
            else Console.WriteLine($"MarkdStage: {url}\nPress Ctrl+C to stop.");
            await Task.Delay(Timeout.Infinite, cancellationToken);
            return 0;
        }

        JsonElement result;
        try
        {
            result = await scripts.InvokeAsync(args.Command, new
            {
                file = file is null ? null : Path.GetRelativePath(root, file).Replace('\\', '/'),
                slide = args.Get("slide"), all = args.Has("all"), failOnIssues = args.Has("fail-on-issues"),
                pages = args.Get("pages"), output = NormalizePathOption(root, args.Get("output"), "invalid_output_path"),
                mermaidImageFallback = args.Has("mermaid-image-fallback")
            });
        }
        catch when (browsers.LastEnvironmentError is not null) { throw browsers.LastEnvironmentError; }
        var report = result.GetProperty("report");
        if (args.Has("json")) Console.WriteLine(JsonSerializer.Serialize(report, HostCommands.JsonOptions));
        else Console.WriteLine(result.GetProperty("text").GetString());
        return result.GetProperty("exitCode").GetInt32();
    }

    // UI exports save beside the source Markdown file, matching the npm CLI and Desktop.
    internal static async Task<JsonElement> ExportDeckAsync(
        ScriptHost? runtime, PresentationSession session, string format, bool mermaidImageFallback)
    {
        if (runtime is null) throw new DeckLoadException("The shared runtime is not ready.", "runtime_unavailable");
        if (format is not ("pdf" or "pptx")) throw new ArgumentOutOfRangeException(nameof(format));
        var snapshot = session.GetSnapshot();
        if (string.IsNullOrWhiteSpace(snapshot.SourcePath) || string.IsNullOrWhiteSpace(snapshot.WorkspaceRoot))
            throw new DeckLoadException("A source-backed deck is required.", "no_deck");
        var output = Path.GetRelativePath(snapshot.WorkspaceRoot,
            Path.ChangeExtension(snapshot.SourcePath, format == "pptx" ? ".pptx" : ".pdf")).Replace('\\', '/');
        try
        {
            var result = await runtime.InvokeAsync("export", new
            {
                output,
                mermaidImageFallback = format == "pptx" && mermaidImageFallback,
            });
            return result.GetProperty("report").Clone();
        }
        catch (CliException error) { throw new DeckLoadException(error.Message, error.Code); }
    }

    private static Task OpenExternalAsync(Uri uri)
    {
        using var browser = Process.Start(new ProcessStartInfo(uri.AbsoluteUri)
        {
            UseShellExecute = true,
        }) ?? throw new InvalidOperationException("The default browser could not be started.");
        return Task.CompletedTask;
    }

    // ShellExecute blocks while the shell resolves the file association and starts the app.
    private static Task OpenExportFileAsync(string file) => Task.Run(() =>
    {
        using var opened = Process.Start(new ProcessStartInfo(file) { UseShellExecute = true });
    });

    private static string ProductVersion()
    {
        var commandsPath = Path.Combine(AppContext.BaseDirectory, "CliData", "commands.json");
        if (File.Exists(commandsPath))
        {
            try
            {
                using var commands = JsonDocument.Parse(File.ReadAllText(commandsPath));
                var version = commands.RootElement.GetProperty("version").GetString();
                if (!string.IsNullOrWhiteSpace(version)) return version;
            }
            catch (JsonException) { }
        }
        var informational = Assembly.GetEntryAssembly()?
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion;
        return string.IsNullOrWhiteSpace(informational)
            ? Assembly.GetEntryAssembly()?.GetName().Version?.ToString(3) ?? "unknown"
            : informational.Split('+', 2)[0];
    }

    private static string? NormalizePathOption(string root, string? path, string errorCode)
    {
        if (path is null) return null;
        if (!Path.IsPathRooted(path)) return path.Replace('\\', '/');
        var absolute = Path.GetFullPath(path);
        if (!WorkspaceResolver.IsInside(root, absolute))
            throw new CliException(errorCode, "The requested path must stay inside the workspace.", 2);
        return Path.GetRelativePath(root, absolute).Replace('\\', '/');
    }

    private static void ApplySnapshot(PresentationSession session, string root, JsonElement value)
    {
        var snapshot = value.Deserialize<PresentationSnapshot>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new IOException("The shared runtime returned an invalid snapshot.");
        var sourcePath = string.IsNullOrEmpty(snapshot.SourcePath) ? "" : WorkspaceResolver.ResolveRelative(root, snapshot.SourcePath);
        var assetRoot = string.IsNullOrEmpty(snapshot.Theme.AssetRoot) ? "" : WorkspaceResolver.ResolveRelative(root, snapshot.Theme.AssetRoot, true);
        session.ApplySnapshot(snapshot with { SourcePath = sourcePath, WorkspaceRoot = root, Theme = snapshot.Theme with { AssetRoot = assetRoot } });
    }
}
