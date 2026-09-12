using System.Text;
using System.Text.Json;
using MarkdStage.Core;

namespace MarkdStage.Cli;

internal static class HostCommands
{
    private static readonly Dictionary<string, string[]> Targets = new(StringComparer.Ordinal)
    {
        ["codex"] = [".agents", "skills", "markdstage"],
        ["claude"] = [".claude", "skills", "markdstage"],
        ["copilot"] = [".github", "skills", "markdstage"]
    };
    internal static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public static async Task<int> RunAsync(CliArguments args, string packageDirectory, TextWriter output, CancellationToken cancellationToken)
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
        return await SkillAsync(args, data.RootElement.GetProperty("skills"), output, cancellationToken);
    }

    private static async Task<int> SkillAsync(CliArguments args, JsonElement skills, TextWriter output, CancellationToken cancellationToken)
    {
        var action = args.Positionals.FirstOrDefault() ?? "install";
        if (action is not ("install" or "check")) throw new CliException("usage_error", "Use skill install or skill check.");
        var requested = args.Get("target") ?? "all";
        var targets = requested == "all" ? Targets.Keys.ToArray() : requested.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Distinct().ToArray();
        if (targets.Length == 0 || targets.Any(target => !Targets.ContainsKey(target)))
            throw new CliException("usage_error", "Skill targets: codex, claude, copilot, all.");
        var rootArgument = args.Get("root") ?? args.Get("workspace");
        if (rootArgument is null)
            throw new CliException("invalid_input", "Skill commands require --root <directory> or --workspace <directory>.", 2);
        string root;
        try { root = WorkspaceResolver.Resolve(Path.GetFullPath(rootArgument)); }
        catch (UnauthorizedAccessException) { throw new CliException("path_outside_workspace", "Skill installation does not follow symbolic links or junctions.", 2); }
        catch (IOException) { throw new CliException("invalid_input", "The skill root must be an existing directory.", 2); }
        var files = new List<object>();
        var changed = 0;
        var conflicts = 0;
        foreach (var target in targets)
        {
            var directory = Path.Combine([root, .. Targets[target]]);
            foreach (var entry in skills.GetProperty(target).EnumerateObject())
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (Path.IsPathRooted(entry.Name) || entry.Name.Split('/', '\\').Any(part => part is ".." or "." or "") || entry.Name.Contains(':'))
                    throw new InvalidDataException("Invalid packaged skill path.");
                var path = Path.Combine(directory, entry.Name.Replace('/', Path.DirectorySeparatorChar));
                RejectLinks(path);
                var contents = entry.Value.GetString() ?? "";
                var existing = File.Exists(path) ? await File.ReadAllTextAsync(path, cancellationToken) : null;
                var status = existing == contents ? "unchanged" : existing is null ? "created" :
                    args.Has("force") || action == "check" ? "updated" : "conflict";
                if (status == "conflict") conflicts++;
                if (status is "created" or "updated")
                {
                    changed++;
                    if (action == "install")
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                        RejectLinks(path);
                        var staging = path + "." + Guid.NewGuid().ToString("N") + ".new";
                        try
                        {
                            await File.WriteAllTextAsync(staging, contents, new UTF8Encoding(false), cancellationToken);
                            RejectLinks(path);
                            File.Move(staging, path, overwrite: existing is not null);
                        }
                        finally { if (File.Exists(staging)) File.Delete(staging); }
                    }
                }
                files.Add(new { target, path, status });
            }
        }
        var report = new { action, targets, files, changed, conflicts };
        await output.WriteLineAsync(args.Has("json") ? JsonSerializer.Serialize(report, JsonOptions) :
            action == "check" ? $"Generated skills: {changed} file(s) differ; {conflicts} conflict(s)." :
            $"Installed skills: {changed} file(s) written; {conflicts} modified file(s) left untouched.");
        return conflicts > 0 || action == "check" && changed > 0 ? 5 : 0;
    }

    private static void RejectLinks(string path)
    {
        try { WorkspaceResolver.RejectLinks(path); }
        catch (UnauthorizedAccessException) { throw new CliException("path_outside_workspace", "Skill installation does not follow symbolic links or junctions.", 2); }
    }

    public static string Help(string? command)
    {
        var specific = command switch
        {
            null or "help" => """
                markdstage <file.md> [options]
                markdstage --workspace <folder> [--no-open]
                markdstage <present|preview|validate|inspect|capture|export> <file.md> [options]
                markdstage guide [overview|slide-format|themes|custom-themes|theme-schema|architecture-dsl|architecture-schema]
                markdstage skill <install|check> --root <folder> [--target codex,claude,copilot|all] [--force]
                """,
            "guide" => "markdstage guide [overview|slide-format|themes|custom-themes|theme-schema|architecture-dsl|architecture-schema] [--json]",
            "skill" => "markdstage skill <install|check> --root <folder> [--target codex,claude,copilot|all] [--force] [--json]",
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
            --theme <name>        dark, light, microsoft, or custom
            --theme-file <path>   Custom theme CSS
            --json               Machine-readable output
            -h, --help           Help
            -v, --version        Version

            No file and no --workspace is an error; the working directory is never an implicit workspace.
            help, guide, and skill need no browser or JavaScript engine.
            validate uses WebView2 for scripts only, not an installed browser.
            inspect, capture, and export require installed Edge, Chrome, or Chromium with remote debugging permitted.
            No browser or language runtime is downloaded.
            Exit codes: 0 success; 1 usage; 2 deck/input; 3 environment; 4 rendering/output; 5 issues; 130 interrupted.
            """;
    }
}
