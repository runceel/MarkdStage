using System.ComponentModel;
using System.Diagnostics;
using System.Text.Json;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using Windows.Foundation;

namespace MarkdStageApp.Services;

/// <summary>
/// Applies the app's safe-browsing policy to a <see cref="WebView2"/> instance: same-origin
/// navigation only, controlled new-window handling, no DevTools, no context menu. Shared by the
/// preview panes in <c>MainPage</c> and the audience-facing <c>PresenterWindow</c> so the
/// policy is defined once instead of being duplicated (and risking drift) per host.
/// </summary>
/// <remarks>
/// An <c>http</c>/<c>https</c> link to another origin is handed off to the user's default browser
/// instead of navigating (or popping a window) inside the embedded <see cref="WebView2"/>.
/// <para>
/// The primary mechanism is a document-created script that intercepts the click on the
/// <c>&lt;a&gt;</c> element itself and calls <c>preventDefault()</c> before the browser ever
/// starts navigating, and posts the target back to the host via <c>chrome.webview.postMessage</c>.
/// This matters because cancelling a *main-frame* <see cref="CoreWebView2.NavigationStarting"/>
/// (the fallback below) makes WebView2 replace the current page with its own built-in "content is
/// blocked" placeholder — there is no supported way to cancel that navigation and simply stay on
/// the current page, so once that placeholder is shown the slide looks stuck until something
/// re-navigates away from it. Stopping the click before navigation begins avoids that placeholder
/// entirely for ordinary link clicks.
/// </para>
/// <para>
/// The <see cref="CoreWebView2.NavigationStarting"/> handler remains as a defense-in-depth
/// fallback for navigation that does not originate from an intercepted click (for example script-
/// driven <c>location.href</c> assignment). When it has to cancel a main-frame navigation it also
/// re-navigates back to the WebView2's current <c>Source</c> so the built-in placeholder above is
/// immediately replaced by the slide again instead of being left on screen.
/// </para>
/// <para>
/// The rendered slide content lives inside a same-origin iframe (the stage's own output frame),
/// not the top-level document. In principle a same-origin iframe's <c>chrome.webview.postMessage</c>
/// call should surface on the top-level <see cref="CoreWebView2.WebMessageReceived"/>, and a
/// cross-origin one on that frame's own <see cref="CoreWebView2Frame.WebMessageReceived"/>
/// (reached via <see cref="CoreWebView2.FrameCreated"/>) — but in practice a same-origin iframe's
/// message reached *neither* event, so relying on WebView2's own frame/message routing here is not
/// viable. Instead, the injected script only calls <c>chrome.webview.postMessage</c> directly when
/// it is running in the top-level window (<c>window === window.top</c>); from an iframe it instead
/// relays the click via the ordinary (non-WebView2-specific) <c>window.top.postMessage</c>, which
/// the top-level document's own copy of this script listens for and forwards to the host. This
/// sidesteps WebView2's unreliable per-frame message routing entirely by only ever talking to the
/// host from the top-level document.
/// </para>
/// <para>
/// Callers must call <see cref="WebView2.EnsureCoreWebView2Async(CoreWebView2Environment)"/>
/// themselves before invoking <see cref="Configure"/> — keeping that call in the host class lets
/// the WinUI analyzer verify each host's <c>CoreWebView2</c> usage instead of only seeing it here.
/// </para>
/// </remarks>
internal static class WebViewPolicy
{
    /// <summary>
    /// Runs in every document (main frame and any iframes) created in the WebView2. Intercepts a
    /// left-click on an anchor pointing at another origin before the browser acts on it — this
    /// covers both same-window navigation and <c>target="_blank"</c> popups, since both start from
    /// this same click — and reports the target URL to the native host. Only the top-level window
    /// talks to the host directly via <c>chrome.webview.postMessage</c>; an iframe relays through
    /// <c>window.top.postMessage</c> instead, because a same-origin iframe's own
    /// <c>chrome.webview.postMessage</c> call is not reliably observable from .NET — see the
    /// class remarks.
    /// </summary>
    private const string ExternalLinkInterceptScript =
        """
        (() => {
          const MESSAGE_KIND = "markdstage:shell-open-external";
          const report = (url) => {
            if (window === window.top) {
              window.chrome.webview.postMessage({ type: "shell:open-external", url });
            } else {
              window.top.postMessage({ [MESSAGE_KIND]: true, url }, "*");
            }
          };
          if (window === window.top) {
            window.addEventListener("message", (event) => {
              if (event.data && event.data[MESSAGE_KIND] && typeof event.data.url === "string") {
                window.chrome.webview.postMessage({ type: "shell:open-external", url: event.data.url });
              }
            });
          }
          document.addEventListener("click", (event) => {
            if (event.defaultPrevented || event.button !== 0 ||
                event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
            if (!anchor) return;
            let target;
            try { target = new URL(anchor.href, window.location.href); }
            catch { return; }
            if (target.origin === window.location.origin) return;
            if (target.protocol !== "http:" && target.protocol !== "https:") return;
            event.preventDefault();
            report(target.href);
          }, true);
        })();
        """;

    // WUI4001 flags any use of CoreWebView2 in a class that doesn't itself call
    // EnsureCoreWebView2Async — it can't see across the caller/helper boundary. Every caller of
    // Configure is required (and, in this codebase, verified) to await EnsureCoreWebView2Async
    // before calling this method, so the WebView2 is always initialized here.
#pragma warning disable WUI4001
    public static Task Configure(
        WebView2 webView,
        Func<Uri?> allowedOriginProvider,
        TypedEventHandler<CoreWebView2, CoreWebView2NewWindowRequestedEventArgs>? newWindowRequested = null) =>
        Configure(webView.CoreWebView2, allowedOriginProvider, newWindowRequested);

    public static async Task Configure(
        CoreWebView2 webView,
        Func<Uri?> allowedOriginProvider,
        TypedEventHandler<CoreWebView2, CoreWebView2NewWindowRequestedEventArgs>? newWindowRequested = null)
    {
        webView.Settings.AreDefaultContextMenusEnabled = false;
        webView.Settings.AreDevToolsEnabled = false;
        webView.Settings.IsZoomControlEnabled = false;
        webView.NavigationStarting += (sender, args) => EnforceSameOrigin(sender, args, allowedOriginProvider());

        // Only the top-level document ever calls chrome.webview.postMessage (see remarks and the
        // script above), so this is the only WebMessageReceived subscription needed.
        webView.WebMessageReceived += (_, args) => HandleExternalLinkMessage(args);

        await webView.AddScriptToExecuteOnDocumentCreatedAsync(ExternalLinkInterceptScript);
        if (newWindowRequested is null)
            webView.NewWindowRequested += (_, args) =>
            {
                if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var target))
                    TryOpenExternally(target);
                args.Handled = true;
            };
        else
            webView.NewWindowRequested += newWindowRequested;
    }
#pragma warning restore WUI4001

    private static void EnforceSameOrigin(
        CoreWebView2 sender,
        CoreWebView2NavigationStartingEventArgs args,
        Uri? allowedOrigin)
    {
        if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out var target))
        {
            args.Cancel = true;
            return;
        }

        if (allowedOrigin is null ||
            !target.GetLeftPart(UriPartial.Authority).Equals(
                allowedOrigin.GetLeftPart(UriPartial.Authority),
                StringComparison.OrdinalIgnoreCase))
        {
            args.Cancel = true;
            TryOpenExternally(target);

            // Cancelling a main-frame navigation leaves WebView2's built-in "content is blocked"
            // placeholder on screen with no supported way to suppress it. The click interceptor
            // above stops ordinary <a> clicks before we ever get here; this path only runs for
            // navigation it didn't catch, so recover by re-navigating back to where we were.
            if (!string.IsNullOrEmpty(sender.Source) &&
                Uri.TryCreate(sender.Source, UriKind.Absolute, out var current) &&
                !current.Equals(target))
            {
                sender.Navigate(sender.Source);
            }
        }
    }

    /// <summary>
    /// Handles <see cref="CoreWebView2.WebMessageReceived"/> from the top-level document — the
    /// only document that ever calls <c>chrome.webview.postMessage</c>; see the class remarks and
    /// <see cref="ExternalLinkInterceptScript"/> for why iframe clicks are relayed there first.
    /// </summary>
    private static void HandleExternalLinkMessage(CoreWebView2WebMessageReceivedEventArgs args)
    {
        try
        {
            using var document = JsonDocument.Parse(args.WebMessageAsJson);
            if (document.RootElement.ValueKind != JsonValueKind.Object) return;
            if (!document.RootElement.TryGetProperty("type", out var type) ||
                type.GetString() != "shell:open-external") return;
            if (!document.RootElement.TryGetProperty("url", out var url)) return;
            if (Uri.TryCreate(url.GetString(), UriKind.Absolute, out var target))
                TryOpenExternally(target);
        }
        catch (JsonException)
        {
            // Not our message shape; other WebMessageReceived subscribers may still handle it.
        }
    }

    /// <summary>
    /// Hands an external link off to the user's default browser via ShellExecute, matching
    /// <c>MainPage.OpenExportFileAsync</c>: <c>Windows.System.Launcher.LaunchUriAsync</c> requires
    /// an ASTA thread and silently reports failure on this app's unpackaged STA windows, so
    /// <see cref="Process.Start(ProcessStartInfo)"/> with <c>UseShellExecute</c> is used instead.
    /// Only <c>http</c>/<c>https</c> targets are launched; other schemes stay blocked.
    /// </summary>
    internal static void TryOpenExternally(Uri target)
    {
        if (target.Scheme is not ("http" or "https")) return;
        try
        {
            Process.Start(new ProcessStartInfo(target.AbsoluteUri) { UseShellExecute = true })?.Dispose();
        }
        catch (Exception error) when (error is Win32Exception or InvalidOperationException)
        {
            // Best-effort: if the shell can't launch a browser there is nothing more to do here.
        }
    }
}

