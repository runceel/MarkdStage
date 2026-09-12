using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using MarkdStageApp.Services;
using MarkdStage.Core;
using Windows.Graphics;

namespace MarkdStageApp;

public sealed partial class MainWindow : Window
{
    private bool _shutdownStarted;
    private bool _shutdownComplete;
    public MainPage Page { get; }
    public string? WorkspaceRoot => Page.WorkspaceRoot;

    public MainWindow()
    {
        InitializeComponent();

        ExtendsContentIntoTitleBar = true;
        SetTitleBar(AppTitleBar);
        AppWindow.SetIcon("Assets/AppIcon.ico");
        WindowSizing.ResizeToDips(AppWindow, 1400, 860);
        Page = new MainPage(this);
        RootFrame.Content = Page;
        if (App.StateStore.State.Window is { Width: >= 640, Height: >= 480 } placement)
        {
            var rectangle = new RectInt32(placement.X, placement.Y, Math.Min(placement.Width, 7680), Math.Min(placement.Height, 4320));
            var display = DisplayArea.GetFromRect(rectangle, DisplayAreaFallback.Nearest);
            var work = display.WorkArea;
            rectangle.X = Math.Clamp(rectangle.X, work.X, Math.Max(work.X, work.X + work.Width - 200));
            rectangle.Y = Math.Clamp(rectangle.Y, work.Y, Math.Max(work.Y, work.Y + work.Height - 100));
            AppWindow.MoveAndResize(rectangle);
        }
        AppWindow.Closing += OnClosing;
    }

    public Task OpenWorkspaceAsync(string root, string? file) => Page.OpenWorkspaceAsync(root, file);

    /// <summary>
    /// Shown only once a deck is on screen, because until then the start screen is the window.
    /// </summary>
    public void SetBackToFilesVisible(bool visible) =>
        BackToFilesButton.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;

    private void OnBackToFilesClick(object sender, RoutedEventArgs args) => Page.ShowLibrary();

    private void OnEscapeAccelerator(
        Microsoft.UI.Xaml.Input.KeyboardAccelerator sender,
        Microsoft.UI.Xaml.Input.KeyboardAcceleratorInvokedEventArgs args)
    {
        args.Handled = true;
        Page.ShowLibrary();
    }

    private async void OnClosing(AppWindow sender, AppWindowClosingEventArgs args)
    {
        if (_shutdownComplete)
        {
            return;
        }

        args.Cancel = true;
        if (_shutdownStarted)
        {
            return;
        }

        _shutdownStarted = true;
        var position = AppWindow.Position;
        var size = AppWindow.Size;
        try { App.StateStore.SetWindow(new WindowPlacement(position.X, position.Y, size.Width, size.Height)); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
        AppWindow.Hide();
        try
        {
            if (RootFrame.Content is MainPage page)
            {
                await page.ShutdownAsync();
            }
        }
        finally
        {
            _shutdownComplete = true;
            AppWindow.Closing -= OnClosing;
            Close();
        }
    }
}
