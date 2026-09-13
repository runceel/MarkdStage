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
    private static readonly SemaphoreSlim OpenGate = new(1, 1);
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
        var dispatcher = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();
        instance.Activated += (_, eventArgs) =>
        {
            if (!dispatcher.TryEnqueue(() => _ = ActivateRequestAsync(eventArgs)))
                System.Diagnostics.Trace.TraceError("The app dispatcher could not accept activation.");
        };
        await ActivateRequestAsync(activation);
    }

    private static async Task ActivateRequestAsync(AppActivationArguments args)
    {
        if (args.Kind == ExtendedActivationKind.Launch && args.Data is ILaunchActivatedEventArgs cli &&
            cli.Arguments.StartsWith("--markdstage-activation", StringComparison.Ordinal))
        {
            DesktopActivationRequest? request = null;
            DesktopActivationResult result;
            try
            {
                request = DesktopActivationRequest.Parse(cli.Arguments);
                var validated = request.Validate();
                var window = await OpenWindowAsync(validated.Workspace, validated.File, activation: validated);
                result = new DesktopActivationResult(true, ProcessId: Environment.ProcessId,
                    WindowId: WinRT.Interop.WindowNative.GetWindowHandle(window).ToInt64());
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or
                InvalidOperationException or TimeoutException or OperationCanceledException or System.Runtime.InteropServices.COMException)
            {
                result = new DesktopActivationResult(false, error.Message);
                ShowOpenError(null, error.Message);
            }
            if (request is not null)
            {
                try { await DesktopActivation.ReplyAsync(request, result); }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException or OperationCanceledException)
                {
                    System.Diagnostics.Trace.TraceError($"Activation acknowledgment failed: {error.Message}");
                    ShowOpenError(null, "The CLI is no longer waiting for this activation.");
                }
            }
            return;
        }
        string? file = null;
        if (args.Kind == ExtendedActivationKind.File && args.Data is IFileActivatedEventArgs files)
            file = files.Files.OfType<StorageFile>().FirstOrDefault(item => IsMarkdown(item.Path))?.Path;
        else if (args.Kind == ExtendedActivationKind.Launch && args.Data is ILaunchActivatedEventArgs launch)
        {
            var argument = launch.Arguments.Trim().Trim('"');
            if (argument.Length > 0 && IsMarkdown(argument))
                file = Path.GetFullPath(argument);
        }
        await OpenAsync(file: file);
    }

    public static bool IsMarkdown(string path) =>
        Path.GetExtension(path).Equals(".md", StringComparison.OrdinalIgnoreCase) ||
        Path.GetExtension(path).Equals(".markdown", StringComparison.OrdinalIgnoreCase);

    public static async Task OpenAsync(string? workspace = null, string? file = null, MainWindow? requestingWindow = null, bool remember = true)
    {
        try
        {
            await OpenWindowAsync(workspace, file, requestingWindow, remember);
        }
        catch (OperationCanceledException) { }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or InvalidOperationException)
        {
            ShowOpenError(requestingWindow, "The workspace or Markdown file could not be opened.");
        }
    }

    private static async Task<MainWindow> OpenWindowAsync(
        string? workspace = null, string? file = null, MainWindow? requestingWindow = null,
        bool remember = true, DesktopActivationRequest? activation = null)
    {
        await OpenGate.WaitAsync();
        try
        {
            // Recheck after queueing: a workspace or file may have changed during another load.
            if (activation is not null)
            {
                activation = activation.Validate();
                workspace = activation.Workspace;
                file = activation.File;
            }
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
                await window.Page.OpenWorkspaceAsync(root, file, throwOnError: activation is not null);
                if (activation is not null) await window.Page.ApplyActivationAsync(activation);
                if (remember) StateStore.Remember(root);
            }
            return window;
        }
        finally { OpenGate.Release(); }
    }

    private static void ShowOpenError(MainWindow? requestingWindow, string message)
    {
        var window = requestingWindow ?? Windows.FirstOrDefault();
        if (window is null)
        {
            window = new MainWindow();
            Windows.Add(window);
            window.Closed += (_, _) => Windows.Remove(window);
            window.Activate();
        }
        window.Page.ShowOpenError(message);
    }
}
