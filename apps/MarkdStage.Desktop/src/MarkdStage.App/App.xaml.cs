using Microsoft.UI.Xaml;
using MarkdStage.Core;
using MarkdStageApp.Services;
using Microsoft.Windows.AppLifecycle;
using Windows.ApplicationModel.Activation;
using Windows.Storage;

namespace MarkdStageApp;

public partial class App : Application
{
    private static readonly List<MainWindow> Windows = [];
    public static DesktopStateStore StateStore { get; } = new(AppStorage.LocalRoot);

    public App()
    {
        InitializeComponent();
    }

    protected override async void OnLaunched(Microsoft.UI.Xaml.LaunchActivatedEventArgs args)
    {
        var instance = AppInstance.FindOrRegisterForKey("MarkdStage.Desktop");
        var activation = AppInstance.GetCurrent().GetActivatedEventArgs();
        if (!instance.IsCurrent)
        {
            await instance.RedirectActivationToAsync(activation);
            Exit();
            return;
        }
        instance.Activated += (_, eventArgs) =>
        {
            var dispatcher = Windows.FirstOrDefault()?.DispatcherQueue;
            dispatcher?.TryEnqueue(() => ActivateRequest(eventArgs));
        };
        ActivateRequest(activation);
    }

    private static void ActivateRequest(AppActivationArguments args)
    {
        string? file = null;
        if (args.Kind == ExtendedActivationKind.File && args.Data is IFileActivatedEventArgs files)
            file = files.Files.OfType<StorageFile>().FirstOrDefault(item => IsMarkdown(item.Path))?.Path;
        else if (args.Kind == ExtendedActivationKind.Launch && args.Data is ILaunchActivatedEventArgs launch)
        {
            var argument = launch.Arguments.Trim().Trim('"');
            if (argument.Length > 0 && IsMarkdown(argument))
                file = Path.GetFullPath(argument);
        }
        _ = OpenAsync(file: file);
    }

    public static bool IsMarkdown(string path) =>
        Path.GetExtension(path).Equals(".md", StringComparison.OrdinalIgnoreCase) ||
        Path.GetExtension(path).Equals(".markdown", StringComparison.OrdinalIgnoreCase);

    public static async Task OpenAsync(string? workspace = null, string? file = null, MainWindow? requestingWindow = null, bool remember = true)
    {
        try
        {
            if (file is not null && File.Exists(file)) file = WorkspacePathLease.CanonicalizeExisting(file);
            if (workspace is null && file is not null && requestingWindow?.WorkspaceRoot is { } currentRoot &&
                WorkspaceResolver.IsInside(currentRoot, Path.GetFullPath(file)))
                workspace = currentRoot;
            var root = workspace is null && file is null ? null : WorkspaceResolver.Resolve(workspace, file);
            var window = root is null ? requestingWindow : Windows.FirstOrDefault(item =>
                item.WorkspaceRoot?.Equals(root, StringComparison.OrdinalIgnoreCase) == true);
            window ??= requestingWindow?.WorkspaceRoot is null ? requestingWindow : null;
            if (window is null)
            {
                window = new MainWindow();
                Windows.Add(window);
                window.Closed += (_, _) => Windows.Remove(window);
            }
            window.Activate();
            if (root is not null)
            {
                await window.OpenWorkspaceAsync(root, file);
                if (remember) StateStore.Remember(root);
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or InvalidOperationException)
        {
            var window = requestingWindow ?? Windows.FirstOrDefault();
            if (window is null)
            {
                window = new MainWindow();
                Windows.Add(window);
                window.Closed += (_, _) => Windows.Remove(window);
                window.Activate();
            }
            window.Page.ShowOpenError("The workspace or Markdown file could not be opened.");
        }
    }
}
