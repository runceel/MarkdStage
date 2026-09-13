using System.Runtime.InteropServices;
using System.Text.Json;
using MarkdStage.Core;
using Windows.ApplicationModel;

namespace MarkdStage.Cli;

internal static class PackagedAppLauncher
{
    public static async Task<int> RunAsync(CliArguments args, CancellationToken cancellationToken)
    {
        var request = args.CreateActivationRequest(Environment.CurrentDirectory);
        DesktopActivationResult result;
        try
        {
            result = await DesktopActivation.LaunchAsync(request, Activate, cancellationToken);
        }
        catch (Exception error) when (error is COMException or InvalidOperationException or IOException or
            UnauthorizedAccessException or TimeoutException or JsonException)
        {
            throw new CliException("activation_failed",
                $"The installed MarkdStage Windows app could not accept activation: {error.Message}", 3);
        }
        if (!result.Accepted)
            throw new CliException("activation_failed", result.Message ?? "The Windows app rejected activation.", 3);
        if (args.Has("json"))
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                ok = true, accepted = true, workspace = request.Workspace, file = request.File, mode = request.Mode,
                processId = result.ProcessId, windowId = result.WindowId
            }, HostCommands.JsonOptions));
        else Console.WriteLine($"Opened MarkdStage: {request.File ?? request.Workspace}");
        return 0;
    }

    private static void Activate(string arguments)
    {
        string family;
        try { family = Package.Current.Id.FamilyName; }
        catch (InvalidOperationException)
        {
            throw new InvalidOperationException(
                "Run the installed markdstage execution alias, or use --no-open for the local server.");
        }
        var type = Type.GetTypeFromCLSID(new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C"), throwOnError: true)!;
        var manager = (IApplicationActivationManager)Activator.CreateInstance(type)!;
        try
        {
            Marshal.ThrowExceptionForHR(manager.ActivateApplication(family + "!App", arguments, 0, out _));
        }
        finally { Marshal.ReleaseComObject(manager); }
    }

    [ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IApplicationActivationManager
    {
        [PreserveSig]
        int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
            [MarshalAs(UnmanagedType.LPWStr)] string arguments, uint options, out uint processId);
    }
}
