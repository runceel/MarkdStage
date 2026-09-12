using MarkdStage.Core;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using Windows.Storage.Streams;

namespace MarkdStageApp.Services;

internal static class NativeAssetMappings
{
    internal const string WebHost = "web.markdstage.invalid";
    internal const string WorkspaceHost = "workspace.markdstage.invalid";

    public static void ConfigurePackage(WebView2 view) =>
        view.CoreWebView2.SetVirtualHostNameToFolderMapping(WebHost,
            Path.Combine(AppContext.BaseDirectory, "Web"), CoreWebView2HostResourceAccessKind.Allow);

    public static void ConfigureWorkspace(WebView2 view, string root)
    {
        var core = view.CoreWebView2;
        core.SetVirtualHostNameToFolderMapping(WorkspaceHost, root, CoreWebView2HostResourceAccessKind.Allow);
        core.AddWebResourceRequestedFilter($"https://{WorkspaceHost}/*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += async (_, args) =>
        {
            if (!Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out var uri) || uri.Host != WorkspaceHost) return;
            var deferral = args.GetDeferral();
            try
            {
                var path = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/'));
                var type = MediaType(path);
                if (type is null || args.Request.Method is not ("GET" or "HEAD"))
                {
                    args.Response = core.Environment.CreateWebResourceResponse(null, 404, "Not Found", "");
                    return;
                }
                var bytes = await Task.Run(() =>
                {
                    var resolved = WorkspaceResolver.ResolveRelative(root, path);
                    using var lease = WorkspacePathLease.Acquire(resolved, includeFile: true);
                    using var file = new FileStream(resolved, FileMode.Open, FileAccess.Read, FileShare.Read);
                    var limit = Path.GetExtension(path).ToLowerInvariant() switch
                    {
                        ".css" => 64 * 1024,
                        ".mp4" or ".webm" or ".mp3" or ".wav" => 10 * 1024 * 1024,
                        _ => 2 * 1024 * 1024,
                    };
                    if (file.Length > limit) throw new IOException("The asset exceeds its size limit.");
                    var content = new byte[(int)file.Length];
                    file.ReadExactly(content);
                    return content;
                });
                var content = new InMemoryRandomAccessStream();
                using (var writer = new DataWriter(content.GetOutputStreamAt(0)))
                {
                    writer.WriteBytes(bytes);
                    await writer.StoreAsync();
                    writer.DetachStream();
                }
                content.Seek(0);
                args.Response = core.Environment.CreateWebResourceResponse(content, 200, "OK",
                    $"Content-Type: {type}\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\n" +
                    "X-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox\r\n");
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
            {
                try { args.Response = core.Environment.CreateWebResourceResponse(null, 404, "Not Found", ""); }
                catch (Exception closed) when (closed is InvalidOperationException or System.Runtime.InteropServices.COMException) { }
            }
            catch (Exception error) when (error is InvalidOperationException or System.Runtime.InteropServices.COMException) { }
            finally
            {
                try { deferral.Complete(); }
                catch (Exception error) when (error is InvalidOperationException or System.Runtime.InteropServices.COMException) { }
            }
        };
    }

    private static string? MediaType(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".svg" => "image/svg+xml", ".png" => "image/png", ".jpg" or ".jpeg" => "image/jpeg",
        ".webp" => "image/webp", ".gif" => "image/gif", ".avif" => "image/avif", ".ico" => "image/x-icon",
        ".css" => "text/css; charset=utf-8", ".woff" => "font/woff", ".woff2" => "font/woff2",
        ".ttf" => "font/ttf", ".otf" => "font/otf", ".mp4" => "video/mp4", ".webm" => "video/webm",
        ".mp3" => "audio/mpeg", ".wav" => "audio/wav", _ => null,
    };
}
