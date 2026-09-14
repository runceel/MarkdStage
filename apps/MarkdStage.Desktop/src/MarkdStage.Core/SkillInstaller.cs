using System.Text;
using System.Text.Json;

namespace MarkdStage.Core;

public enum SkillInstallMode
{
    Install,
    Check,
}

public enum SkillFileStatus
{
    Unchanged,
    Created,
    Updated,
    Conflict,
}

public sealed record SkillFileResult(string Target, string Path, SkillFileStatus Status);

public sealed record SkillInstallResult(
    SkillInstallMode Mode,
    IReadOnlyList<string> Targets,
    IReadOnlyList<SkillFileResult> Files)
{
    public int Changed => Files.Count(file => file.Status is SkillFileStatus.Created or SkillFileStatus.Updated);
    public int Conflicts => Files.Count(file => file.Status == SkillFileStatus.Conflict);
}

public static class SkillInstaller
{
    private static readonly IReadOnlyDictionary<string, string[]> TargetDirectories =
        new Dictionary<string, string[]>(StringComparer.Ordinal)
        {
            ["codex"] = [".agents", "skills", "markdstage"],
            ["claude"] = [".claude", "skills", "markdstage"],
            ["copilot"] = [".github", "skills", "markdstage"],
        };

    public static IReadOnlyList<string> AvailableTargets { get; } =
        Array.AsReadOnly(TargetDirectories.Keys.ToArray());

    public static async Task<SkillInstallResult> RunAsync(
        string root,
        JsonElement skills,
        IEnumerable<string> targets,
        SkillInstallMode mode = SkillInstallMode.Install,
        bool force = false,
        CancellationToken cancellationToken = default)
    {
        var selectedTargets = targets.Distinct(StringComparer.Ordinal).ToArray();
        if (selectedTargets.Length == 0 || selectedTargets.Any(target => !TargetDirectories.ContainsKey(target)))
            throw new ArgumentException("Skill targets: codex, claude, copilot.");

        root = WorkspaceResolver.Resolve(Path.GetFullPath(root));
        var files = new List<SkillFileResult>();

        foreach (var target in selectedTargets)
        {
            if (!skills.TryGetProperty(target, out var targetFiles) ||
                targetFiles.ValueKind != JsonValueKind.Object)
                throw new InvalidDataException($"Packaged skill data is missing target '{target}'.");

            var directory = Path.Combine([root, .. TargetDirectories[target]]);
            foreach (var entry in targetFiles.EnumerateObject())
            {
                cancellationToken.ThrowIfCancellationRequested();
                ValidateRelativePath(entry.Name);
                var path = Path.Combine(directory, entry.Name.Replace('/', Path.DirectorySeparatorChar));
                WorkspaceResolver.RejectLinks(path);
                var contents = entry.Value.GetString()
                    ?? throw new InvalidDataException($"Packaged skill file '{entry.Name}' is not text.");
                var existing = File.Exists(path)
                    ? await File.ReadAllTextAsync(path, cancellationToken)
                    : null;
                var status = existing == contents
                    ? SkillFileStatus.Unchanged
                    : existing is null
                        ? SkillFileStatus.Created
                        : force || mode == SkillInstallMode.Check
                            ? SkillFileStatus.Updated
                            : SkillFileStatus.Conflict;

                if (mode == SkillInstallMode.Install &&
                    status is SkillFileStatus.Created or SkillFileStatus.Updated)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                    WorkspaceResolver.RejectLinks(path);
                    var staging = path + "." + Guid.NewGuid().ToString("N") + ".new";
                    try
                    {
                        await File.WriteAllTextAsync(
                            staging,
                            contents,
                            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
                            cancellationToken);
                        WorkspaceResolver.RejectLinks(path);
                        File.Move(staging, path, overwrite: existing is not null);
                    }
                    finally
                    {
                        if (File.Exists(staging)) File.Delete(staging);
                    }
                }

                files.Add(new SkillFileResult(target, path, status));
            }
        }

        return new SkillInstallResult(mode, selectedTargets, files);
    }

    private static void ValidateRelativePath(string path)
    {
        if (Path.IsPathRooted(path) ||
            path.Split('/', '\\').Any(part => part is ".." or "." or "") ||
            path.Contains(':'))
            throw new InvalidDataException("Invalid packaged skill path.");
    }
}
