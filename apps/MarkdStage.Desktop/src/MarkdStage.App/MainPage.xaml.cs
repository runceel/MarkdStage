using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using MarkdStage.Core;
using MarkdStage.Cli;
using MarkdStageApp.Services;
using MarkdStageApp.ViewModels;
using Windows.ApplicationModel.DataTransfer;
using Windows.Storage;
using System.Text.Json;

namespace MarkdStageApp;

public sealed partial class MainPage : Page
{
    private readonly PresenterWindowService _presenterWindowService;
    private readonly PresentationServer _server;
    private readonly NativeBrowserHost _browserHost = new();
    private CoreWebView2Environment? _webViewEnvironment;
    private bool _shutdownStarted;
    private readonly MainWindow _window;
    private readonly PresentationSession _session;
    private readonly TaskCompletionSource _ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private NativeRuntimeHost? _runtime;
    private WorkspaceIoService? _io;
    private readonly Microsoft.UI.Dispatching.DispatcherQueueTimer _workspaceTimer;
    private readonly List<ArchitectureEditorWindow> _architectureEditorWindows = [];
    private bool _recoveryOpen;
    private string _themePreference = App.StateStore.State.Theme;
    public string? WorkspaceRoot { get; private set; }

    public MainPageViewModel ViewModel { get; }

    public MainPage(MainWindow window)
    {
        _window = window;
        InitializeComponent();

        var session = _session = new PresentationSession();
        _presenterWindowService = new PresenterWindowService(delta =>
        {
            session.NavigateBy(delta);
        });
        _server = new PresentationServer(
            session,
            () => _presenterWindowService.IsRunning,
            mapAssets: true,
            openPresenter: OpenPresenterAsync,
            closePresenter: _presenterWindowService.StopAsync,
            reloadSource: ReloadAfterArchitectureSaveAsync,
            exportDeck: ExportDeckAsync,
            exportData: GetExportDataAsync,
            exportStatus: ReportExportStatusAsync);
        ViewModel = new MainPageViewModel(
            session,
            _server,
            LoadRuntimePathAsync,
            new DeckWatcher(),
            _presenterWindowService,
            new FilePickerService(),
            () => WinRT.Interop.WindowNative.GetWindowHandle(_window));
        ViewModel.OpenRequested = path => App.OpenAsync(file: path, requestingWindow: _window);
        ViewModel.WorkspaceUnavailable = () => _ = RecoverWorkspaceAsync();
        _presenterWindowService.StatusChanged += (_, _) => _session.NotifyChanged();
        Loaded += OnLoaded;
        _workspaceTimer = DispatcherQueue.CreateTimer();
        _workspaceTimer.Interval = TimeSpan.FromSeconds(3);
        _workspaceTimer.Tick += (_, _) =>
        {
            if (WorkspaceRoot is not null && !Directory.Exists(WorkspaceRoot))
                _ = RecoverWorkspaceAsync();
        };
        RefreshRecents();
    }

    public static Visibility InvertVisibility(bool value) =>
        value ? Visibility.Collapsed : Visibility.Visible;

    public static Visibility BoolToVisibility(bool value) =>
        value ? Visibility.Visible : Visibility.Collapsed;

    public static Visibility NextPlaceholderVisibility(bool deckLoaded, bool hasNext) =>
        deckLoaded && hasNext ? Visibility.Collapsed : Visibility.Visible;

    private async Task<bool> OpenPresenterAsync()
    {
        var alreadyRunning = _presenterWindowService.IsRunning;
        await _presenterWindowService.OpenAsync(
            _server.BaseUri ?? throw new InvalidOperationException("The presentation server is not ready."));
        return alreadyRunning;
    }

    private async Task ReloadAfterArchitectureSaveAsync()
    {
        var source = _session.GetSnapshot().SourcePath;
        if (!string.IsNullOrWhiteSpace(source))
            await ViewModel.LoadPathAsync(source, startWatching: false);
    }

    private Task<JsonElement> ExportDeckAsync(
        string format,
        bool mermaidImageFallback,
        CancellationToken cancellationToken) =>
        (_runtime ?? throw new DeckLoadException("The shared runtime is not ready.", "runtime_unavailable"))
            .ExportAsync(format, mermaidImageFallback, cancellationToken);

    private Task<JsonElement> GetExportDataAsync(
        string token,
        CancellationToken cancellationToken) =>
        (_runtime ?? throw new DeckLoadException("The shared runtime is not ready.", "runtime_unavailable"))
            .GetExportDataAsync(token, cancellationToken);

    private Task ReportExportStatusAsync(
        string token,
        JsonElement body,
        CancellationToken cancellationToken) =>
        (_runtime ?? throw new DeckLoadException("The shared runtime is not ready.", "runtime_unavailable"))
            .ReportExportStatusAsync(token, body, cancellationToken);

    public async ValueTask ShutdownAsync()
    {
        if (_shutdownStarted)
        {
            return;
        }

        _shutdownStarted = true;
        _workspaceTimer.Stop();
        _ready.TrySetCanceled();
        Loaded -= OnLoaded;
        StageWebView.Close();
        foreach (var editor in _architectureEditorWindows.ToArray()) editor.Close();
        _architectureEditorWindows.Clear();
        if (_runtime is not null) await _runtime.DisposeAsync();
        RuntimeWebView.Close();
        if (_io is not null) await _io.DisposeAsync();
        await _browserHost.DisposeAsync();
        await ViewModel.DisposeAsync();
    }

    private async void OnLoaded(object sender, RoutedEventArgs args)
    {
        Loaded -= OnLoaded;
        await InitializeRuntimeAsync();
    }

    private async Task InitializeRuntimeAsync()
    {
        try
        {
            _ = CoreWebView2Environment.GetAvailableBrowserVersionString();
            var userDataFolder = Path.Combine(AppStorage.LocalRoot, "WebView2");
            Directory.CreateDirectory(userDataFolder);
            _webViewEnvironment = await CoreWebView2Environment.CreateWithOptionsAsync(null, userDataFolder, null);
            if (_shutdownStarted)
            {
                return;
            }

            RuntimeMissingScreen.Visibility = Visibility.Collapsed;
            await ViewModel.InitializeAsync();
            _presenterWindowService.SetEnvironment(_webViewEnvironment);
            await InitializeWebViewAsync(
                StageWebView,
                _server.BaseUri,
                _webViewEnvironment);
            _browserHost.AllowedBaseUri = _server.BaseUri;
            _runtime = new NativeRuntimeHost(RuntimeWebView, _session, _browserHost);
            await _runtime.InitializeAsync(
                _webViewEnvironment,
                _server.BaseUri ?? throw new InvalidOperationException("The presentation server is not ready."));
            _ready.TrySetResult();
            Focus(FocusState.Programmatic);
        }
        catch (Exception error) when (
            error is InvalidOperationException or COMException or IOException or UnauthorizedAccessException or TimeoutException)
        {
            if (_shutdownStarted)
            {
                return;
            }

            if (_webViewEnvironment is null)
                RuntimeMissingScreen.Visibility = Visibility.Visible;
            else
            {
                _ready.TrySetException(new IOException("The shared presentation runtime could not be initialized."));
                ShowOpenError("Microsoft Edge WebView2 Runtime couldn't be initialized. Check the Runtime installation and permissions for its data folder.");
            }
        }
        catch (OperationCanceledException) when (_shutdownStarted)
        {
        }
    }

    private async void OnRetryRuntimeClick(object sender, RoutedEventArgs args) => await InitializeRuntimeAsync();

    public void ShowOpenError(string message)
    {
        ViewModel.IsErrorOpen = true;
        ViewModel.ErrorMessage = message;
    }

    public async Task OpenWorkspaceAsync(string root, string? file)
    {
        if (WorkspaceRoot is not null && !WorkspaceRoot.Equals(root, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("A window cannot change its workspace.");
        WorkspaceRoot = root;
        await _ready.Task;
        if (_io is null)
        {
            _io = new WorkspaceIoService(root, AppStorage.TransientRoot, _browserHost);
            _runtime!.BindWorkspace(_io);
            NativeAssetMappings.ConfigureWorkspace(StageWebView, root);
            _presenterWindowService.SetWorkspaceRoot(root);
            _workspaceTimer.Start();
        }
        _window.Title = $"MarkdStage — {Path.GetFileName(root)}";
        if (file is null)
        {
            if (!ViewModel.IsDeckLoaded) await RefreshWorkspaceFilesAsync();
        }
        else
        {
            await ViewModel.LoadPathAsync(file, startWatching: true);
            if (ViewModel.IsDeckLoaded) WorkspaceStartScreen.Visibility = Visibility.Collapsed;
        }
    }

    private async Task LoadRuntimePathAsync(string path, CancellationToken cancellationToken)
    {
        if (_runtime is null || WorkspaceRoot is null) throw new InvalidOperationException("Choose a workspace first.");
        var relative = Path.GetRelativePath(WorkspaceRoot, path).Replace('\\', '/');
        WorkspaceResolver.ResolveRelative(WorkspaceRoot, relative);
        await _runtime.LoadAsync(relative, _themePreference, cancellationToken);
    }

    private async void OnThemeClick(object sender, RoutedEventArgs args)
    {
        if (sender is not MenuFlyoutItem { Tag: string theme }) return;
        try
        {
            App.StateStore.SetTheme(theme);
            _themePreference = theme;
            if (ViewModel.IsDeckLoaded)
                await ViewModel.LoadPathAsync(_session.GetSnapshot().SourcePath, startWatching: false);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        { ShowOpenError("The theme preference could not be saved."); }
    }

    private void RefreshRecents()
    {
        WorkspaceItems.Items.Clear();
        foreach (var root in App.StateStore.State.RecentWorkspaces)
        {
            var available = Directory.Exists(root);
            WorkspaceItems.Items.Add(new ListViewItem
            {
                Tag = root,
                Content = $"{Path.GetFileName(root)}{(available ? "" : " — Unavailable")}\n{root}",
                Opacity = available ? 1 : 0.5,
            });
        }
    }

    private async Task RefreshWorkspaceFilesAsync()
    {
        if (_io is null) return;
        WorkspaceHeading.Text = WorkspaceRoot;
        RefreshWorkspaceButton.Visibility = Visibility.Visible;
        WorkspaceItems.Items.Clear();
        var result = await _io.ExecuteAsync("list", JsonSerializer.SerializeToElement(new object[]
        {
                "", new { extensions = new[] { ".md", ".markdown" }, maxEntries = 10000, recursive = true },
        }));
        if (!result.Ok) { ShowOpenError(result.Message!); return; }
        foreach (var item in JsonSerializer.SerializeToElement(result.Value).EnumerateArray())
        {
            if (item.GetProperty("kind").GetString() != "file") continue;
            var path = item.GetProperty("path").GetString()!;
            WorkspaceItems.Items.Add(new ListViewItem { Tag = path, Content = path });
        }
    }

    private async void OnRefreshWorkspaceClick(object sender, RoutedEventArgs args) => await RefreshWorkspaceFilesAsync();

    private async void OnOpenFolderClick(object sender, RoutedEventArgs args)
    {
        var root = await new FilePickerService().PickFolderAsync(WinRT.Interop.WindowNative.GetWindowHandle(_window));
        if (root is not null) await App.OpenAsync(workspace: root, requestingWindow: _window);
    }

    private async void OnWorkspaceItemClick(object sender, ItemClickEventArgs args)
    {
        if (args.ClickedItem is not ListViewItem { Tag: string path }) return;
        if (WorkspaceRoot is not null)
            await App.OpenAsync(workspace: WorkspaceRoot, file: Path.Combine(WorkspaceRoot, path), requestingWindow: _window);
        else if (Directory.Exists(path))
            await App.OpenAsync(workspace: path, requestingWindow: _window);
        else
            await RecoverWorkspaceAsync(path);
    }

    private async Task RecoverWorkspaceAsync(string? recent = null)
    {
        if (_recoveryOpen || _shutdownStarted) return;
        _recoveryOpen = true;
        var oldRoot = recent ?? WorkspaceRoot!;
        try
        {
            if (recent is null)
            {
                _workspaceTimer.Stop();
                await ViewModel.StopWatchingAsync();
            }
            var dialog = new ContentDialog
            {
                XamlRoot = XamlRoot,
                Title = "This folder isn't available",
                Content = new TextBlock
                {
                    Text = $"{oldRoot}\nIt may have been moved, renamed, or deleted, or it may be on a drive that isn't connected.",
                    TextWrapping = TextWrapping.Wrap,
                    IsTextSelectionEnabled = true,
                },
                PrimaryButtonText = "Locate folder…",
                SecondaryButtonText = "Remove from list",
                CloseButtonText = "Cancel",
            };
            var result = await dialog.ShowAsync();
            if (result == ContentDialogResult.Secondary) App.StateStore.Remove(oldRoot);
            else if (result == ContentDialogResult.Primary)
            {
                var root = await new FilePickerService().PickFolderAsync(WinRT.Interop.WindowNative.GetWindowHandle(_window));
                if (root is not null)
                {
                    root = WorkspaceResolver.Resolve(root);
                    App.StateStore.Repoint(oldRoot, root);
                    if (root.Equals(WorkspaceRoot, StringComparison.OrdinalIgnoreCase))
                    {
                        var source = _session.GetSnapshot().SourcePath;
                        if (File.Exists(source)) await ViewModel.LoadPathAsync(source, startWatching: true);
                        _workspaceTimer.Start();
                    }
                    // The audience keeps the last valid deck; a located replacement gets its own boundary.
                    await App.OpenAsync(workspace: root, requestingWindow: WorkspaceRoot is null ? _window : null, remember: false);
                }
            }
            if (WorkspaceRoot is null) RefreshRecents();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidOperationException)
        { ShowOpenError("The workspace could not be located."); }
        finally { _recoveryOpen = false; }
    }

    private void OnDragOver(object sender, DragEventArgs args)
    {
        if (args.DataView.Contains(StandardDataFormats.StorageItems)) args.AcceptedOperation = DataPackageOperation.Copy;
    }

    private async void OnDrop(object sender, DragEventArgs args)
    {
        if (!args.DataView.Contains(StandardDataFormats.StorageItems)) return;
        var file = (await args.DataView.GetStorageItemsAsync()).OfType<StorageFile>().FirstOrDefault(item => App.IsMarkdown(item.Path));
        if (file is not null) await App.OpenAsync(file: file.Path, requestingWindow: _window);
    }
    private async Task InitializeWebViewAsync(
        WebView2 webView,
        Uri? source,
        CoreWebView2Environment environment)
    {
        try
        {
            await webView.EnsureCoreWebView2Async(environment);
            if (_shutdownStarted)
            {
                webView.Close();
                return;
            }

            WebViewPolicy.Configure(webView, () => _server.BaseUri, OnNewWindowRequested);
            NativeAssetMappings.ConfigurePackage(webView);
            if (source is not null)
            {
                webView.Source = source;
            }
        }
        catch (Exception error) when (
            error is InvalidOperationException or COMException)
        {
            if (_shutdownStarted)
            {
                return;
            }

            ViewModel.IsErrorOpen = true;
            ViewModel.ErrorMessage =
                "Microsoft Edge WebView2 Runtime is required. Install the Runtime, then restart MarkdStage.";
        }
    }

    private async void OnNewWindowRequested(
        CoreWebView2 sender,
        CoreWebView2NewWindowRequestedEventArgs args)
    {
        var deferral = args.GetDeferral();
        try
        {
            if (_shutdownStarted || _webViewEnvironment is null)
            {
                args.Handled = true;
                return;
            }
            if (!string.IsNullOrWhiteSpace(args.Uri) &&
                !args.Uri.Equals("about:blank", StringComparison.OrdinalIgnoreCase) &&
                (!Uri.TryCreate(args.Uri, UriKind.Absolute, out var requested) ||
                 _server.BaseUri is null ||
                 !requested.GetLeftPart(UriPartial.Authority).Equals(
                     _server.BaseUri.GetLeftPart(UriPartial.Authority),
                     StringComparison.OrdinalIgnoreCase)))
            {
                args.Handled = true;
                return;
            }
            var editor = new ArchitectureEditorWindow(
                _webViewEnvironment, () => _server.BaseUri, WorkspaceRoot);
            await editor.InitializeAsync();
            if (editor.CoreWebView is null)
            {
                editor.Close();
                args.Handled = true;
                return;
            }
            editor.Closed += (_, _) => _architectureEditorWindows.Remove(editor);
            _architectureEditorWindows.Add(editor);
            args.NewWindow = editor.CoreWebView;
            args.Handled = true;
            editor.Activate();
        }
        catch (Exception error) when (error is InvalidOperationException or COMException)
        {
            args.Handled = true;
            ShowOpenError("The Architecture Editor window could not be opened.");
        }
        finally
        {
            deferral.Complete();
        }
    }

}
