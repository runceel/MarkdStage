using System.Text.Json;
using MarkdStage.Core;

namespace MarkdStage.Cli;

internal static class HostCommands
{
    internal static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public static async Task<int> RunAsync(
        CliArguments args,
        string packageDirectory,
        TextWriter output,
        CancellationToken cancellationToken,
        string? currentDirectory = null)
    {
        if (args.Has("help") || args.Command == "help")
        {
            var topic = args.Command == "help" ? args.Positionals.FirstOrDefault() : args.Command;
            await output.WriteLineAsync(Help(topic));
            return 0;
        }
        using var data = JsonDocument.Parse(await File.ReadAllTextAsync(
            Path.Combine(packageDirectory, "CliData", "commands.json"), cancellationToken));
        if (args.Has("version"))
        {
            await output.WriteLineAsync(data.RootElement.GetProperty("version").GetString());
            return 0;
        }
        if (args.Command == "guide")
        {
            var topic = args.Positionals.FirstOrDefault() ?? "overview";
            if (!data.RootElement.GetProperty("guides").TryGetProperty(topic, out var guide))
                throw new CliException("usage_error", $"Unknown guide topic: {topic}.");
            var content = guide.GetString();
            await output.WriteLineAsync(args.Has("json") ? JsonSerializer.Serialize(new { topic, content }, JsonOptions) : content);
            return 0;
        }
        return await SkillAsync(
            args,
            data.RootElement.GetProperty("skills"),
            output,
            cancellationToken,
            currentDirectory ?? Environment.CurrentDirectory);
    }

    private static async Task<int> SkillAsync(
        CliArguments args,
        JsonElement skills,
        TextWriter output,
        CancellationToken cancellationToken,
        string currentDirectory)
    {
        var action = args.Positionals.FirstOrDefault() ?? "install";
        if (action is not ("install" or "check")) throw new CliException("usage_error", "Use skill install or skill check.");
        var requested = args.Get("target") ?? "all";
        var targets = requested == "all"
            ? SkillInstaller.AvailableTargets
            : requested.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (targets.Count == 0 || targets.Any(target => !SkillInstaller.AvailableTargets.Contains(target)))
            throw new CliException("usage_error", "Skill targets: codex, claude, copilot, all.");
        var rootArgument = args.Get("root") ?? args.Get("workspace") ?? currentDirectory;
        string root;
        try
        {
            root = WorkspaceResolver.Resolve(Path.GetFullPath(rootArgument));
        }
        catch (UnauthorizedAccessException)
        {
            throw new CliException(
                "path_outside_workspace",
                "Skill installation does not follow symbolic links or junctions.",
                2);
        }
        catch (IOException)
        {
            throw new CliException("invalid_input", "The skill root must be an existing directory.", 2);
        }

        SkillInstallResult result;
        try
        {
            result = await SkillInstaller.RunAsync(
                root,
                skills,
                targets,
                action == "check" ? SkillInstallMode.Check : SkillInstallMode.Install,
                args.Has("force"),
                cancellationToken);
        }
        catch (UnauthorizedAccessException)
        {
            throw new CliException(
                "path_outside_workspace",
                "Skill installation does not follow symbolic links or junctions.",
                2);
        }
        catch (ArgumentException error)
        {
            throw new CliException("usage_error", error.Message);
        }

        var files = result.Files.Select(file => new
        {
            target = file.Target,
            path = file.Path,
            status = file.Status.ToString().ToLowerInvariant(),
        });
        var report = new
        {
            action,
            targets = result.Targets,
            files,
            changed = result.Changed,
            conflicts = result.Conflicts,
        };
        await output.WriteLineAsync(args.Has("json") ? JsonSerializer.Serialize(report, JsonOptions) :
            action == "check" ? $"Generated skills: {result.Changed} file(s) differ; {result.Conflicts} conflict(s)." :
            $"Installed skills: {result.Changed} file(s) written; {result.Conflicts} modified file(s) left untouched.");
        return result.Conflicts > 0 || action == "check" && result.Changed > 0 ? 5 : 0;
    }

    public static string Help(string? command)
    {
        var specific = command switch
        {
            null or "help" => """
                markdstage <file.md> [options]
                markdstage [--workspace <folder>] [--no-open]
                markdstage <present|preview|validate|inspect|capture|export> <file.md> [options]
                markdstage guide [overview|slide-format|themes|custom-themes|theme-schema|architecture-dsl|architecture-schema]
                markdstage skill <install|check> [--root <folder>] [--target codex,claude,copilot|all] [--force]
                """,
            "guide" => "markdstage guide [overview|slide-format|themes|custom-themes|theme-schema|architecture-dsl|architecture-schema] [--json]",
            "skill" => "markdstage skill <install|check> [--root <folder>] [--target codex,claude,copilot|all] [--force] [--json]",
            "present" or "preview" => $"markdstage {command} <file.md> [--watch] [--no-open]",
            "validate" => "markdstage validate <file.md> [--json]",
            "inspect" => "markdstage inspect <file.md> [--slide <n>] [--all] [--fail-on-issues] [--json]",
            "capture" => "markdstage capture <file.md> [--pages 2,4-6] [--output <folder>] [--json]",
            "export" => "markdstage export <file.md> [--output <file.pdf|file.pptx>] [--mermaid-image-fallback] [--json]",
            _ => throw new CliException("usage_error", $"Unknown command: {command}")
        };
        return $"""
            MarkdStage — Markdown, ready for the stage.
            {specific}

            --workspace <folder>  Explicit workspace; otherwise use the file's nearest .git ancestor or parent.
            --theme <name>        Console/server only: dark, light, microsoft, or custom
            --theme-file <path>   Console/server only: custom theme CSS
            --json               Machine-readable output
            -h, --help           Help
            -v, --version        Version

            With no file and no --workspace, the current directory is the workspace.
            Interactive commands activate the installed Windows app and reuse its workspace window.
            preview and direct Markdown open slide view; present opens presenter and native audience views.
            The app watches Markdown saves automatically (--watch is supported).
            Choose themes in the app; --theme and --theme-file require --no-open for present/preview.
            --no-open runs the local server until Ctrl+C without activating the app.
            Activation --json reports accepted, resolved workspace/file, mode, processId, and windowId.
            Skill commands also use the current directory when --root and --workspace are omitted.
            help, guide, and skill need no browser or JavaScript engine.
            Interactive app commands require WebView2, not an external Chromium browser.
            validate uses WebView2 for scripts only, not an installed browser.
            inspect, capture, and export require installed Edge, Chrome, or Chromium with remote debugging permitted.
            No browser or language runtime is downloaded.
            Exit codes: 0 success/accepted activation; 1 usage; 2 deck/input; 3 environment/activation; 4 rendering/output; 5 issues; 130 interrupted.
            """;
    }
}
