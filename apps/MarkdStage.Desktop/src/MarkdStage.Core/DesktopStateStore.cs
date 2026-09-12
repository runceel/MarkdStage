using System.Text.Json;

namespace MarkdStage.Core;

public sealed record WindowPlacement(int X, int Y, int Width, int Height);
public sealed record DesktopState(IReadOnlyList<string> RecentWorkspaces, string Theme, WindowPlacement? Window);

public sealed class DesktopStateStore
{
    private readonly string _path;
    private readonly object _gate = new();
    private DesktopState _state = new([], "", null);

    public DesktopStateStore(string storageDirectory)
    {
        _path = Path.Combine(storageDirectory, "desktop-state.json");
        try
        {
            Directory.CreateDirectory(storageDirectory);
            if (File.Exists(_path) && new FileInfo(_path).Length <= 64 * 1024)
            {
                var state = JsonSerializer.Deserialize<DesktopState>(File.ReadAllText(_path));
                if (state?.RecentWorkspaces is not null)
                    _state = new(state.RecentWorkspaces.Where(Path.IsPathFullyQualified)
                        .Distinct(StringComparer.OrdinalIgnoreCase).Take(10).ToArray(),
                        state.Theme is "dark" or "light" or "microsoft" or "custom" ? state.Theme : "",
                        state.Window);
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or ArgumentException) { }
    }

    public DesktopState State { get { lock (_gate) return _state; } }

    public void Remember(string root) => Update(state => state with
    {
        RecentWorkspaces = new[] { root }.Concat(state.RecentWorkspaces)
            .Distinct(StringComparer.OrdinalIgnoreCase).Take(10).ToArray(),
    });

    public void Remove(string root) => Update(state => state with
    {
        RecentWorkspaces = state.RecentWorkspaces.Where(item => !item.Equals(root, StringComparison.OrdinalIgnoreCase)).ToArray(),
    });

    public void Repoint(string oldRoot, string newRoot) => Update(state => state with
    {
        RecentWorkspaces = state.RecentWorkspaces.Select(item => item.Equals(oldRoot, StringComparison.OrdinalIgnoreCase) ? newRoot : item)
            .Distinct(StringComparer.OrdinalIgnoreCase).Take(10).ToArray(),
    });

    public void SetTheme(string theme) => Update(state => state with { Theme = theme });
    public void SetWindow(WindowPlacement window) => Update(state => state with { Window = window });

    private void Update(Func<DesktopState, DesktopState> update)
    {
        lock (_gate)
        {
            _state = update(_state);
            var staging = _path + $".{Guid.NewGuid():N}";
            try
            {
                using (var stream = new FileStream(staging, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    JsonSerializer.Serialize(stream, _state);
                    stream.Flush(true);
                }
                File.Move(staging, _path, true);
            }
            finally { if (File.Exists(staging)) File.Delete(staging); }
        }
    }
}
