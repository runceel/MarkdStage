using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;

namespace MarkdStage.Cli;

internal sealed class NativeCliRoutes
{
    public ScriptHost? Runtime { get; set; }

    public void Configure(WebApplication application, string prefix)
    {
        application.Use(async (context, next) =>
        {
            if (!context.Request.Path.StartsWithSegments(prefix, out var remaining))
            { await next(); return; }
            var route = remaining.Value;
            var method = route switch
            {
                "/state" => "state", "/deck" => "deck", "/navigate" => "navigate",
                "/markdown-files" => "markdownFiles", "/import" => "import", "/source-mode" => "sourceMode",
                "/export-data" => "exportData", "/export-status" => "exportStatus",
                _ => null
            };
            if (method is null) { await next(); return; }
            var isPost = method is "navigate" or "import" or "sourceMode" or "exportStatus";
            if (context.Request.Method != (isPost ? "POST" : "GET"))
            { context.Response.StatusCode = 405; return; }
            if (Runtime is null) { context.Response.StatusCode = 503; return; }
            var limit = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (limit is { IsReadOnly: false }) limit.MaxRequestBodySize = 256 * 1024;
            if (context.Request.ContentLength > 256 * 1024)
            { context.Response.StatusCode = 413; return; }
            try
            {
                JsonElement? body = isPost
                    ? await JsonSerializer.DeserializeAsync<JsonElement>(context.Request.Body, cancellationToken: context.RequestAborted)
                    : null;
                var result = await Runtime.InvokeAsync(method, new
                {
                    body,
                    token = context.Request.Query["token"].ToString(),
                    offset = int.TryParse(context.Request.Query["offset"], out var offset) ? offset : 0
                });
                if (method == "exportStatus") context.Response.StatusCode = 204;
                else await context.Response.WriteAsJsonAsync(result, context.RequestAborted);
            }
            catch (JsonException) { context.Response.StatusCode = 400; }
            catch (CliException error)
            {
                context.Response.StatusCode = error.Code == "file_not_found" ? 404 : 400;
                await context.Response.WriteAsJsonAsync(new { ok = false, error = error.Code, message = error.Message }, context.RequestAborted);
            }
        });
    }
}
