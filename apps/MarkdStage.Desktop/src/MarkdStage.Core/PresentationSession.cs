namespace MarkdStage.Core;

public sealed class PresentationSession
{
    private readonly object _gate = new();
    private PresentationSnapshot _snapshot =
        new([], 0, 0, 0, string.Empty, string.Empty, new ThemeState("dark"));

    public event EventHandler<PresentationSnapshot>? Changed;

    public PresentationSnapshot GetSnapshot()
    {
        lock (_gate)
        {
            return _snapshot;
        }
    }

    public Func<int?, int?, Task<bool>>? Navigate { get; set; }

    public PresentationSnapshot ApplySnapshot(PresentationSnapshot snapshot)
    {
        lock (_gate)
        {
            if (snapshot.Version < _snapshot.Version) return _snapshot;
            _snapshot = snapshot;
        }
        Changed?.Invoke(this, snapshot);
        return snapshot;
    }

    public Task<bool> NavigateByAsync(int delta) => Navigate?.Invoke(null, delta) ?? Task.FromResult(false);
    public Task<bool> NavigateToAsync(int index) => Navigate?.Invoke(index, null) ?? Task.FromResult(false);
    public void NavigateBy(int delta) => _ = NavigateByAsync(delta);
    public void NavigateTo(int index) => _ = NavigateToAsync(index);
}
