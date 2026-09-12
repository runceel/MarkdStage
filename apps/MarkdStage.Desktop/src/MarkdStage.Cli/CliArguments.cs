namespace MarkdStage.Cli;

internal sealed class CliException(string code, string message, int exitCode = 1) : Exception(message)
{
    public string Code { get; } = code;
    public int ExitCode { get; } = exitCode;
}

internal sealed record CliArguments(string Command, IReadOnlyList<string> Positionals, IReadOnlyDictionary<string, string?> Options)
{
    private static readonly HashSet<string> Commands =
        ["present", "preview", "validate", "inspect", "capture", "export", "guide", "skill", "help"];
    private static readonly HashSet<string> Values = ["workspace", "theme", "theme-file", "slide", "pages", "output", "target", "root"];
    private static readonly HashSet<string> Flags =
        ["help", "version", "json", "watch", "no-open", "all", "fail-on-issues", "mermaid-image-fallback", "force"];

    public bool Has(string option) => Options.ContainsKey(option);
    public string? Get(string option) => Options.GetValueOrDefault(option);
    public string? File => Command is "guide" or "skill" or "help" ? null : Positionals.FirstOrDefault();
    public bool IsHostOnly => Command is "guide" or "skill" or "help" || Has("help") || Has("version");
    public bool IsPresentation => Command is "present" or "preview";

    public static CliArguments Parse(string[] args)
    {
        var options = new Dictionary<string, string?>(StringComparer.Ordinal);
        var positionals = new List<string>();
        var command = "preview";
        var offset = 0;
        if (args.Length > 0 && Commands.Contains(args[0]))
        {
            command = args[0];
            offset = 1;
        }
        else if (args.Length > 0 && !args[0].StartsWith('-') && !IsMarkdown(args[0]))
            throw new CliException("usage_error", $"Unknown command: {args[0]}");

        var positionalOnly = false;
        for (var index = offset; index < args.Length; index++)
        {
            var argument = args[index];
            if (argument == "--" && !positionalOnly) { positionalOnly = true; continue; }
            if (positionalOnly || !argument.StartsWith('-')) { positionals.Add(argument); continue; }
            argument = argument switch { "-h" => "--help", "-v" => "--version", _ => argument };
            if (!argument.StartsWith("--")) throw new CliException("usage_error", $"Unknown option: {argument}");
            var parts = argument[2..].Split('=', 2);
            var name = parts[0];
            if (Flags.Contains(name))
            {
                if (parts.Length != 1) throw new CliException("usage_error", $"--{name} does not accept a value.");
                options[name] = null;
            }
            else if (Values.Contains(name))
            {
                var value = parts.Length == 2 ? parts[1] : ++index < args.Length ? args[index] : null;
                if (string.IsNullOrEmpty(value) || value.StartsWith("--"))
                    throw new CliException("usage_error", $"--{name} requires a value.");
                options[name] = value;
            }
            else throw new CliException("usage_error", $"Unknown option: --{name}");
        }
        if (offset == 0 && positionals.Count != 0) options["watch"] = null;
        var result = new CliArguments(command, positionals, options);
        if (positionals.Count > 1) throw new CliException("usage_error", $"{command} accepts at most one positional argument.");
        if (!result.IsHostOnly && !result.IsPresentation && result.File is null)
            throw new CliException("usage_error", $"{command} requires a Markdown file.");
        if (result.File is not null && !IsMarkdown(result.File))
            throw new CliException("invalid_markdown_path", "Use a .md or .markdown file.", 2);
        var allowed = command switch
        {
            "present" or "preview" => new[] { "watch", "no-open" },
            "inspect" => ["slide", "all", "fail-on-issues"],
            "capture" => ["pages", "output"],
            "export" => ["output", "mermaid-image-fallback"],
            "skill" => ["target", "root", "force"],
            _ => []
        };
        foreach (var name in options.Keys)
            if (name is not ("workspace" or "theme" or "theme-file" or "help" or "version" or "json") && !allowed.Contains(name))
                throw new CliException("usage_error", $"--{name} is not valid for {command}.");
        if (result.Get("slide") is string slide && (!int.TryParse(slide, out var page) || page < 1))
            throw new CliException("usage_error", "--slide expects a 1-based page number.");
        return result;
    }

    public static string? AbsoluteArgument(string? value) => value is null ? null : Path.GetFullPath(value);
    private static bool IsMarkdown(string value) =>
        Path.GetExtension(value).Equals(".md", StringComparison.OrdinalIgnoreCase) ||
        Path.GetExtension(value).Equals(".markdown", StringComparison.OrdinalIgnoreCase);
}
