using System.ComponentModel;
using System.Diagnostics;
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
    private readonly AsyncDispatcher _dispatcher;
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
    private readonly Microsoft.UI.Dispatching.DispatcherQueueTimer _workspaceFilterTimer;
    private readonly List<ArchitectureEditorWindow> _architectureEditorWindows = [];
    private bool _recoveryOpen;
    private readonly List<WorkspaceEntry> _workspaceEntries = [];
    private string _themePreference = App.StateStore.State.Theme;
    public string? WorkspaceRoot { get; private set; }

    public MainPageViewModel ViewModel { get; }

    public MainPage(MainWindow window)
    {
        _window = window;
        InitializeComponent();

        var dispatcherQueue = DispatcherQueue;
        _dispatcher = new AsyncDispatcher(
            () => dispatcherQueue.HasThreadAccess,
            action => dispatcherQueue.TryEnqueue(() => action()));
        var session = _session = new PresentationSession();
        _presenterWindowService = new PresenterWindowService(delta =>
        {
            session.NavigateBy(delta);
        });
        _server = new PresentationServer(
            session,
            () => _presenterWindowService.IsRunning,
            openPresenter: OpenPresenterFromServerAsync,
            closePresenter: ClosePresenterFromServerAsync,
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
        ViewModel.PropertyChanged += OnViewModelPropertyChanged;
        _presenterWindowService.StatusChanged += (_, _) => _session.NotifyChanged();
        Loaded += OnLoaded;
        _workspaceTimer = DispatcherQueue.CreateTimer();
        _workspaceTimer.Interval = TimeSpan.FromSeconds(3);
        _workspaceTimer.Tick += (_, _) =>
        {
            if (WorkspaceRoot is not null && !Directory.Exists(WorkspaceRoot))
                _ = RecoverWorkspaceAsync();
        };
        _workspaceFilterTimer = DispatcherQueue.CreateTimer();
        _workspaceFilterTimer.Interval = TimeSpan.FromMilliseconds(250);
        _workspaceFilterTimer.Tick += (_, _) =>
        {
            _workspaceFilterTimer.Stop();
            RenderWorkspaceEntries();
        };
        RefreshRecents();
    }

    public static Visibility InvertVisibility(bool value) =>
        value ? Visibility.Collapsed : Visibility.Visible;

    public static Visibility BoolToVisibility(bool value) =>
        value ? Visibility.Visible : Visibility.Collapsed;

    public static Visibility NextPlaceholderVisibility(bool deckLoaded, bool hasNext) =>
        deckLoaded && hasNext ? Visibility.Collapsed : Visibility.Visible;

    private Task<bool> OpenPresenterFromServerAsync() =>
        _dispatcher.InvokeAsync(async () =>
        {
            var alreadyRunning = _presenterWindowService.IsRunning;
            await _presenterWindowService.OpenAsync(
                _server.BaseUri ?? throw new InvalidOperationException("The presentation server is not ready."));
            return alreadyRunning;
        });

    private Task ClosePresenterFromServerAsync() =>
        _dispatcher.InvokeAsync(_presenterWindowService.StopAsync);

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
        _workspaceFilterTimer.Stop();
        _ready.TrySetCanceled();
        Loaded -= OnLoaded;
        ViewModel.PropertyChanged -= OnViewModelPropertyChanged;
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

    public async Task OpenWorkspaceAsync(string root, string? file, bool throwOnError = false)
    {
        if (WorkspaceRoot is not null && !WorkspaceRoot.Equals(root, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("A window cannot change its workspace.");
        WorkspaceRoot = root;
        if (throwOnError) await _ready.Task.WaitAsync(TimeSpan.FromSeconds(30));
        else await _ready.Task;
        if (_io is null)
        {
            _io = new WorkspaceIoService(root, AppStorage.TransientRoot, _browserHost);
            _runtime!.BindWorkspace(_io);
            NativeAssetMappings.ConfigureWorkspace(StageWebView, root);
            _presenterWindowService.SetWorkspaceRoot(root);
            _workspaceTimer.Start();
        }
        _window.Title = $"MarkdStage — {Path.GetFileName(root)}";
        InstallSkillsButton.Visibility = Visibility.Visible;
        if (file is null)
        {
            if (!ViewModel.IsDeckLoaded) await RefreshWorkspaceFilesAsync(resetFilter: true);
        }
        else
        {
            await ViewModel.LoadPathAsync(file, startWatching: true, throwOnError: throwOnError);
            if (ViewModel.IsDeckLoaded) HideLibrary();
        }
    }

    public async Task ApplyActivationAsync(DesktopActivationRequest request)
    {
        if (request.Mode != "present") await _presenterWindowService.StopAsync();
        if (request.File is null)
        {
            WorkspaceStartScreen.Visibility = Visibility.Visible;
            _window.SetBackToFilesVisible(false);
            await RefreshWorkspaceFilesAsync(resetFilter: false);
            return;
        }
        var source = new UriBuilder(_server.BaseUri!)
        {
            Query = request.Mode == "present" ? "presenter=1" : ""
        }.Uri;
        var core = StageWebView.CoreWebView2;
        var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        ulong? navigationId = null;
        void Starting(CoreWebView2 sender, CoreWebView2NavigationStartingEventArgs args)
        {
            if (args.Uri == source.AbsoluteUri) navigationId = args.NavigationId;
        }
        void Completed(CoreWebView2 sender, CoreWebView2NavigationCompletedEventArgs args)
        {
            if (args.NavigationId != navigationId) return;
            if (args.IsSuccess) ready.TrySetResult();
            else ready.TrySetException(new IOException("The slide view could not be opened."));
        }
        core.NavigationStarting += Starting;
        core.NavigationCompleted += Completed;
        try
        {
            core.Navigate(source.AbsoluteUri);
            await ready.Task.WaitAsync(TimeSpan.FromSeconds(30));
            HideLibrary();
            if (request.Mode == "present")
            {
                await _presenterWindowService.OpenAsync(_server.BaseUri!);
                if (!_presenterWindowService.IsRunning)
                    throw new IOException("The audience window could not be opened.");
            }
        }
        finally
        {
            core.NavigationStarting -= Starting;
            core.NavigationCompleted -= Completed;
        }
    }

    /// <summary>
    /// The start screen doubles as the workspace file list, so hiding it on load used to leave the
    /// window with no way to reach another deck short of a drag and drop or a restart.
    /// </summary>
    public async void ShowLibrary()
    {
        if (!ViewModel.IsDeckLoaded || WorkspaceStartScreen.Visibility == Visibility.Visible) return;
        WorkspaceStartScreen.Visibility = Visibility.Visible;
        _window.SetBackToFilesVisible(false);
        // Focus has to leave the WebView, otherwise the Escape accelerator never fires.
        if (WorkspaceItems.Items.Count > 0) WorkspaceItems.Focus(FocusState.Programmatic);
        else OpenFolderButton.Focus(FocusState.Programmatic);
        // The folder may have gained or lost decks while the current one was on screen. The list the
        // user left is the list they come back to, so any filter they had applied is preserved.
        if (WorkspaceRoot is not null) await RefreshWorkspaceFilesAsync(resetFilter: false);
    }

    private void HideLibrary()
    {
        if (!ViewModel.IsDeckLoaded) return;
        WorkspaceStartScreen.Visibility = Visibility.Collapsed;
        _window.SetBackToFilesVisible(true);
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

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs args)
    {
        if (args.PropertyName == nameof(MainPageViewModel.IsBusy))
            LoadingOverlay.Visibility = ViewModel.IsBusy ? Visibility.Visible : Visibility.Collapsed;
    }

    private void RefreshRecents()
    {
        ResetWorkspaceFilter();
        EndWorkspaceListLoad();
        _workspaceEntries.Clear();
        foreach (var root in App.StateStore.State.RecentWorkspaces)
        {
            var available = Directory.Exists(root);
            _workspaceEntries.Add(new WorkspaceEntry(
                root,
                Path.GetFileName(root) is { Length: > 0 } name ? name : root,
                available ? root : $"{root} — Unavailable",
                available,
                "\uE8B7"));
        }

        WorkspaceFilterBox.PlaceholderText = "Filter workspaces";
        WorkspaceFilterBox.Visibility = _workspaceEntries.Count > 0
            ? Visibility.Visible
            : Visibility.Collapsed;
        WorkspaceListHeader.Text = "RECENT WORKSPACES";
        WorkspaceListHeader.Visibility = _workspaceEntries.Count > 0
            ? Visibility.Visible
            : Visibility.Collapsed;
        BrandHero.Visibility = Visibility.Visible;
        RenderWorkspaceEntries();
    }

    /// <summary>
    /// Two-line card so the list reads as a chooser rather than a dump of raw paths.
    /// The card is built here rather than in the item container style because
    /// ListViewItemPresenter owns its own state brushes and ignores a local Background.
    /// </summary>
    private static Border BuildEntryRow(string glyph, string title, string? subtitle)
    {
        var row = new Grid { ColumnSpacing = 12 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var icon = new FontIcon
        {
            FontSize = 16,
            Glyph = glyph,
            VerticalAlignment = VerticalAlignment.Center,
        };
        icon.SetValue(Grid.ColumnProperty, 0);
        icon.SetValue(Microsoft.UI.Xaml.Automation.AutomationProperties.AccessibilityViewProperty, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);
        row.Children.Add(icon);

        var text = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };
        text.SetValue(Grid.ColumnProperty, 1);
        text.Children.Add(new TextBlock
        {
            Text = title,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });
        if (!string.IsNullOrEmpty(subtitle))
        {
            text.Children.Add(new TextBlock
            {
                Text = subtitle,
                FontSize = 12,
                Opacity = 0.7,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            });
        }
        row.Children.Add(text);

        return new Border
        {
            Child = row,
            Style = (Style)Application.Current.Resources["BrandEntryCardStyle"],
        };
    }

    private async Task RefreshWorkspaceFilesAsync(bool resetFilter)
    {
        if (_io is null) return;
        BeginWorkspaceListLoad("Finding Markdown files…", resetFilter);
        WorkspaceHeading.Text = WorkspaceRoot;
        RefreshWorkspaceButton.Visibility = Visibility.Visible;
        try
        {
            var result = await _io.ExecuteAsync("list", JsonSerializer.SerializeToElement(new object[]
            {
                    "", new
                    {
                        extensions = new[] { ".md", ".markdown" },
                        excludeDirectories = new[] { ".agents/skills", ".claude/skills", ".github/skills" },
                        maxEntries = 10000,
                        recursive = true,
                    },
            }));
            if (!result.Ok) { ShowOpenError(result.Message!); return; }
            _workspaceEntries.Clear();
            foreach (var item in JsonSerializer.SerializeToElement(result.Value).EnumerateArray())
            {
                if (item.GetProperty("kind").GetString() != "file") continue;
                var path = item.GetProperty("path").GetString()!;
                var folder = Path.GetDirectoryName(path);
                _workspaceEntries.Add(new WorkspaceEntry(
                    path,
                    Path.GetFileName(path),
                    string.IsNullOrEmpty(folder) ? null : folder.Replace('\\', '/'),
                    true,
                    "\uE8A5"));
            }

            WorkspaceFilterBox.PlaceholderText = "Filter Markdown files";
            WorkspaceFilterBox.Visibility = _workspaceEntries.Count > 0
                ? Visibility.Visible
                : Visibility.Collapsed;
            WorkspaceListHeader.Text = _workspaceEntries.Count > 0
                ? "MARKDOWN FILES"
                : "NO MARKDOWN FILES IN THIS FOLDER";
            WorkspaceListHeader.Visibility = Visibility.Visible;
            // The lockup would push the file list below the fold once a workspace is open.
            BrandHero.Visibility = Visibility.Collapsed;
            RenderWorkspaceEntries();
        }
        finally
        {
            EndWorkspaceListLoad();
        }
    }

    /// <summary>
    /// A list load is a context switch: the entries on screen are about to be replaced wholesale, so
    /// the filter that selected them is cleared in the same frame the list empties. Clearing it once
    /// the new entries arrive would instead flash the incoming list filtered, then unfiltered. A plain
    /// refresh of the same list keeps the filter, because the user's context has not changed.
    /// </summary>
    private void BeginWorkspaceListLoad(string message, bool resetFilter)
    {
        if (resetFilter) ResetWorkspaceFilter();
        WorkspaceItems.Items.Clear();
        WorkspaceFilterBox.Visibility = Visibility.Collapsed;
        WorkspaceListHeader.Visibility = Visibility.Collapsed;
        WorkspaceListProgressText.Text = message;
        WorkspaceListProgress.Visibility = Visibility.Visible;
    }

    private void EndWorkspaceListLoad() =>
        WorkspaceListProgress.Visibility = Visibility.Collapsed;

    private void ResetWorkspaceFilter()
    {
        _workspaceFilterTimer.Stop();
        WorkspaceFilterBox.Text = string.Empty;
    }

    private async void OnRefreshWorkspaceClick(object sender, RoutedEventArgs args) =>
        await RefreshWorkspaceFilesAsync(resetFilter: false);

    private async void OnInstallSkillsClick(object sender, RoutedEventArgs args)
    {
        if (WorkspaceRoot is null) return;

        var targetChecks = new Dictionary<string, CheckBox>(StringComparer.Ordinal)
        {
            ["codex"] = new CheckBox { Content = "Codex (.agents/skills/markdstage)", IsChecked = true },
            ["claude"] = new CheckBox { Content = "Claude Code (.claude/skills/markdstage)", IsChecked = true },
            ["copilot"] = new CheckBox { Content = "GitHub Copilot (.github/skills/markdstage)", IsChecked = true },
        };
        var content = new StackPanel { Spacing = 8 };
        content.Children.Add(new TextBlock
        {
            Text = "Choose the Agent Skills to install in this workspace. Existing modified files will be left untouched.",
            TextWrapping = TextWrapping.Wrap,
        });
        foreach (var checkBox in targetChecks.Values) content.Children.Add(checkBox);
        var forceCheck = new CheckBox
        {
            Content = "Force overwrite modified skill files",
            IsChecked = false,
            Margin = new Thickness(0, 8, 0, 0),
        };
        content.Children.Add(forceCheck);
        content.Children.Add(new TextBlock
        {
            Text = "Force overwrite replaces local edits in the selected skill directories.",
            TextWrapping = TextWrapping.Wrap,
            Opacity = 0.7,
            FontSize = 12,
        });

        var dialog = new ContentDialog
        {
            XamlRoot = XamlRoot,
            Title = "Install MarkdStage skills",
            Content = content,
            PrimaryButtonText = "Install",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
        };
        void UpdatePrimaryButton(object? _, RoutedEventArgs __) =>
            dialog.IsPrimaryButtonEnabled = targetChecks.Values.Any(item => item.IsChecked == true);
        foreach (var checkBox in targetChecks.Values)
        {
            checkBox.Checked += UpdatePrimaryButton;
            checkBox.Unchecked += UpdatePrimaryButton;
        }

        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        var targets = targetChecks
            .Where(item => item.Value.IsChecked == true)
            .Select(item => item.Key)
            .ToArray();

        InstallSkillsButton.IsEnabled = false;
        ViewModel.BeginBusy("Installing Agent Skills…");
        try
        {
            using var data = JsonDocument.Parse(await File.ReadAllTextAsync(
                Path.Combine(AppContext.BaseDirectory, "CliData", "commands.json")));
            var result = await SkillInstaller.RunAsync(
                WorkspaceRoot,
                data.RootElement.GetProperty("skills"),
                targets,
                force: forceCheck.IsChecked == true);
            ViewModel.EndBusy();
            var unchanged = result.Files.Count(file => file.Status == SkillFileStatus.Unchanged);
            var title = result.Conflicts == 0 ? "Skills installed" : "Skills installed with conflicts";
            var message = $"{result.Changed} file(s) written; {unchanged} already up to date.";
            if (result.Conflicts > 0)
            {
                message += $"\n\n{result.Conflicts} modified file(s) were left untouched. " +
                    "Run the installer again with Force overwrite selected if you intend to replace them.";
            }
            await ShowMessageDialogAsync(title, message);
        }
        catch (Exception error) when (
            error is IOException or UnauthorizedAccessException or InvalidDataException or ArgumentException or JsonException)
        {
            ViewModel.EndBusy();
            await ShowMessageDialogAsync(
                "Skills couldn't be installed",
                error is UnauthorizedAccessException
                    ? "Skill installation does not follow symbolic links or junctions and must stay inside the workspace."
                    : $"The packaged skills could not be written to this workspace.\n\n{error.Message}");
        }
        finally
        {
            ViewModel.EndBusy();
            InstallSkillsButton.IsEnabled = true;
        }
    }

    private async Task ShowMessageDialogAsync(string title, string message)
    {
        var dialog = new ContentDialog
        {
            XamlRoot = XamlRoot,
            Title = title,
            Content = new TextBlock
            {
                Text = message,
                TextWrapping = TextWrapping.Wrap,
                IsTextSelectionEnabled = true,
            },
            CloseButtonText = "Close",
        };
        await dialog.ShowAsync();
    }

    private void OnWorkspaceFilterChanged(object sender, TextChangedEventArgs args)
    {
        _workspaceFilterTimer.Stop();
        _workspaceFilterTimer.Start();
    }

    private void RenderWorkspaceEntries()
    {
        var filter = WorkspaceFilterBox.Text.Trim();
        WorkspaceItems.Items.Clear();
        foreach (var entry in _workspaceEntries.Where(entry =>
                     filter.Length == 0 ||
                     entry.Title.Contains(filter, StringComparison.OrdinalIgnoreCase) ||
                     entry.Subtitle?.Contains(filter, StringComparison.OrdinalIgnoreCase) == true))
        {
            var card = BuildEntryRow(entry.Glyph, entry.Title, entry.Subtitle);
            card.Tag = entry.Path;
            card.Opacity = entry.Available ? 1 : 0.5;
            WorkspaceItems.Items.Add(card);
        }
    }

    private async void OnOpenFolderClick(object sender, RoutedEventArgs args)
    {
        var root = await new FilePickerService().PickFolderAsync(WinRT.Interop.WindowNative.GetWindowHandle(_window));
        if (root is null) return;
        if (WorkspaceRoot is not null)
        {
            await App.OpenAsync(workspace: root, requestingWindow: _window);
            return;
        }
        await EnterWorkspaceAsync(root);
    }

    private async void OnWorkspaceItemClick(object sender, ItemClickEventArgs args)
    {
        // Items are plain FrameworkElements, not ListViewItem containers: a ListView does not
        // raise ItemClick for containers that were added to Items already realized.
        if (args.ClickedItem is not FrameworkElement { Tag: string path }) return;
        if (WorkspaceRoot is not null)
            await App.OpenAsync(workspace: WorkspaceRoot, file: Path.Combine(WorkspaceRoot, path), requestingWindow: _window);
        else if (Directory.Exists(path))
            await EnterWorkspaceAsync(path);
        else
            await RecoverWorkspaceAsync(path);
    }

    /// <summary>
    /// Entering a workspace replaces the recents list with the folder's decks, so the click is
    /// acknowledged in this frame — before the folder walk starts — rather than after it finishes.
    /// </summary>
    private async Task EnterWorkspaceAsync(string path)
    {
        BeginWorkspaceListLoad("Opening folder…", resetFilter: true);
        await App.OpenAsync(workspace: path, requestingWindow: _window);
        // Another window may already own that workspace and take the request, which leaves this
        // window on the recents screen: restore it instead of stranding the progress row.
        if (WorkspaceRoot is null) RefreshRecents();
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
    /// <summary>
    /// The renderer owns Escape for its own overlays (import, overview, more controls) and calls
    /// preventDefault when it consumes one. Listening on window means this runs after that
    /// document-level handler, so only an Escape nothing else wanted reaches the shell.
    /// </summary>
    private const string StageEscapeScript = """
        window.addEventListener("keydown", (event) => {
          if (event.key !== "Escape" || event.defaultPrevented) return;
          if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
          const target = event.target;
          if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
          window.chrome.webview.postMessage({ type: "shell:escape" });
        });
        """;

    private void OnStageWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (_shutdownStarted) return;
        try
        {
            using var document = JsonDocument.Parse(args.WebMessageAsJson);
            if (document.RootElement.ValueKind != JsonValueKind.Object) return;
            if (!document.RootElement.TryGetProperty("type", out var type)) return;
            if (type.GetString() == "shell:open-file" &&
                document.RootElement.TryGetProperty("path", out var file) &&
                file.GetString() is { } path)
            {
                _ = OpenExportFileAsync(path);
                return;
            }
            if (type.GetString() != "shell:escape") return;
        }

        catch (JsonException) { return; }
        ShowLibrary();
    }

    /// <summary>
    /// Exports open through ShellExecute rather than <c>Windows.System.Launcher.LaunchFileAsync</c>.
    /// That WinRT API is documented to require an ASTA thread and to report refusal by returning
    /// false rather than throwing; an unpackaged WinUI 3 window runs on a plain STA, so every export
    /// silently came back as a failure. ShellExecute is the association contract a desktop app owns.
    /// </summary>
    private async Task OpenExportFileAsync(string path)
    {
        var name = Path.GetFileName(path);
        try
        {
            // The renderer is web content, so its path is untrusted.
            var file = PathSecurity.ResolveExport(
                WorkspaceRoot ?? throw new UnauthorizedAccessException("No workspace is open."),
                path);

            // ShellExecute blocks while the shell resolves the association and starts the app.
            await Task.Run(() => Process.Start(new ProcessStartInfo(file) { UseShellExecute = true })?.Dispose());
        }
        catch (Exception error) when (error is FileNotFoundException or UnauthorizedAccessException
            or IOException or Win32Exception or ArgumentException)
        {
            ShowOpenError($"{name} could not be opened. {error.Message}");
        }
    }

    private sealed record WorkspaceEntry(
        string Path,
        string Title,
        string? Subtitle,
        bool Available,
        string Glyph);

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
            if (webView == StageWebView)
            {
                await webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
                    "window.__markdstageNativeShell = true;\n" + StageEscapeScript);
                webView.CoreWebView2.WebMessageReceived += OnStageWebMessageReceived;
            }
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
