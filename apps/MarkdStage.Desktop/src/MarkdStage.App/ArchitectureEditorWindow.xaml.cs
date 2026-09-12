using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;
using MarkdStageApp.Services;

namespace MarkdStageApp;

public sealed partial class ArchitectureEditorWindow : Window
{
    private readonly CoreWebView2Environment _environment;
    private readonly Func<Uri?> _allowedOrigin;
    private readonly string? _workspaceRoot;
    private bool _closed;

    public ArchitectureEditorWindow(
        CoreWebView2Environment environment,
        Func<Uri?> allowedOrigin,
        string? workspaceRoot)
    {
        InitializeComponent();
        _environment = environment;
        _allowedOrigin = allowedOrigin;
        _workspaceRoot = workspaceRoot;
        AppWindow.SetIcon("Assets/AppIcon.ico");
        WindowSizing.ResizeToDips(AppWindow, 1440, 900);
        Closed += OnClosed;
    }

    public CoreWebView2? CoreWebView => EditorWebView.CoreWebView2;

    public async Task InitializeAsync()
    {
        await EditorWebView.EnsureCoreWebView2Async(_environment);
        if (_closed)
        {
            EditorWebView.Close();
            return;
        }
        WebViewPolicy.Configure(EditorWebView, _allowedOrigin);
        NativeAssetMappings.ConfigurePackage(EditorWebView);
        if (_workspaceRoot is not null)
            NativeAssetMappings.ConfigureWorkspace(EditorWebView, _workspaceRoot);
    }

    private void OnClosed(object sender, WindowEventArgs args)
    {
        _closed = true;
        Closed -= OnClosed;
        EditorWebView.Close();
    }
}
