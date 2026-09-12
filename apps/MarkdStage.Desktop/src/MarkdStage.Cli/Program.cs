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
        try
        {
            var arguments = CliArguments.Parse(argv);
            if (arguments.IsHostOnly)
                return HostCommands.RunAsync(arguments, AppContext.BaseDirectory, Console.Out, interrupted.Token).GetAwaiter().GetResult();
            return StaDispatcher.Run(dispatcher => RunAsync(arguments, dispatcher, interrupted.Token));
        }
        catch (OperationCanceledException) { return 130; }
        catch (Exception error)
        {
            var failure = error as CliException ?? new CliException("unexpected_error", error.Message, 4);
            if (json) Console.Out.WriteLine(JsonSerializer.Serialize(new { ok = false, error = failure.Code, message = failure.Message }, HostCommands.JsonOptions));
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
            root = WorkspaceResolver.Resolve(CliArguments.AbsoluteArgument(args.Get("workspace")), file);
        }
        catch (UnauthorizedAccessException) { throw new CliException("path_outside_workspace", "The file must stay inside the workspace and cannot traverse links.", 2); }
        catch (ArgumentException) { throw new CliException("invalid_input", "Specify a Markdown file or an existing --workspace <directory>.", 2); }
        catch (IOException) { throw new CliException("invalid_input", "The workspace is unavailable; specify an existing --workspace <directory>.", 2); }
        if (args.Command is "inspect" or "capture" or "export" || args.IsPresentation && !args.Has("no-open"))
            _ = BrowserAutomation.FindBrowser();

        var session = new PresentationSession();
        var routes = new NativeCliRoutes();
        await using var browsers = new NativeBrowserHost();
        await using var io = new WorkspaceIoService(root, AppStorage.TransientRoot, browsers);
        await using var server = new PresentationServer(session, () => false, routes.Configure);
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
            theme = args.Get("theme"), themeFile = NormalizePathOption(root, args.Get("theme-file"), "invalid_theme_file")
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
            if (file is not null && args.Has("watch")) await scripts.InvokeAsync("sourceMode", new { body = new { mode = "live" } });
            var url = server.BaseUri!.AbsoluteUri + (args.Command == "present" ? "?presenter=1" : "");
            if (!args.Has("no-open"))
            {
                var transient = await io.ExecuteAsync("createTransientDirectory", JsonSerializer.SerializeToElement(new[] { "present" }), cancellationToken);
                if (!transient.Ok) throw new CliException("browser_not_found", "The package temporary browser profile could not be created.", 3);
                var launch = await io.ExecuteAsync("launchBrowser", JsonSerializer.SerializeToElement(new[]
                {
                    new { url, profile = (string)transient.Value!, mode = "app", windowSize = new { width = 1280, height = 720 } }
                }), cancellationToken);
                if (!launch.Ok) throw browsers.LastEnvironmentError ?? new CliException("browser_not_found", "The presentation browser could not start.", 3);
            }
            if (args.Has("json")) Console.WriteLine(JsonSerializer.Serialize(new { ok = true, url, workspace = root }, HostCommands.JsonOptions));
            else Console.WriteLine($"MarkdStage: {url}\nPress Ctrl+C to stop.");
            if (args.Has("no-open")) await Task.Delay(Timeout.Infinite, cancellationToken);
            else while (browsers.HasRunningWindows) await Task.Delay(250, cancellationToken);
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
