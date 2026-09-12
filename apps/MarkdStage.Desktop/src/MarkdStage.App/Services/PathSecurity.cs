using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
using MarkdStage.Core;

namespace MarkdStageApp.Services;

internal static class PathSecurity
{
    private const uint FileFlagBackupSemantics = 0x02000000;

    public static string CanonicalizeExisting(string path)
    {
        WorkspaceResolver.RejectLinks(path);
        if (!OperatingSystem.IsWindows())
        {
            if (!File.Exists(path) && !Directory.Exists(path)) throw new IOException("The path is unavailable.");
            return Path.GetFullPath(path);
        }
        using var handle = CreateFile(
            Path.GetFullPath(path),
            0,
            FileShare.Read | FileShare.Write | FileShare.Delete,
            nint.Zero,
            FileMode.Open,
            FileFlagBackupSemantics,
            nint.Zero);

        if (handle.IsInvalid)
        {
            throw new IOException(
                $"Could not resolve path '{path}'.",
                Marshal.GetExceptionForHR(Marshal.GetHRForLastWin32Error()));
        }

        var capacity = 512u;
        while (true)
        {
            var builder = new StringBuilder((int)capacity);
            var length = GetFinalPathNameByHandle(handle, builder, capacity, 0);
            if (length == 0)
            {
                throw new IOException(
                    $"Could not resolve path '{path}'.",
                    Marshal.GetExceptionForHR(Marshal.GetHRForLastWin32Error()));
            }

            if (length < capacity)
            {
                return NormalizeDevicePath(builder.ToString());
            }

            capacity = length + 1;
        }
    }

    public static bool IsInside(string root, string candidate)
    {
        var canonicalRoot = CanonicalizeExisting(root).TrimEnd(Path.DirectorySeparatorChar);
        var canonicalCandidate = CanonicalizeExisting(candidate);
        return canonicalCandidate.Equals(canonicalRoot, StringComparison.OrdinalIgnoreCase) ||
               canonicalCandidate.StartsWith(
                   canonicalRoot + Path.DirectorySeparatorChar,
                   StringComparison.OrdinalIgnoreCase);
    }

    public static string? ResolveFileInside(string root, string relativePath)
    {
        try
        {
            var confined = WorkspaceResolver.ResolveRelative(root, relativePath.Replace(Path.DirectorySeparatorChar, '/'));
            return File.Exists(confined) ? CanonicalizeExisting(confined) : null;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
        {
            return null;
        }
    }

    private static string NormalizeDevicePath(string path)
    {
        const string uncPrefix = @"\\?\UNC\";
        const string devicePrefix = @"\\?\";

        if (path.StartsWith(uncPrefix, StringComparison.OrdinalIgnoreCase))
        {
            return @"\\" + path[uncPrefix.Length..];
        }

        return path.StartsWith(devicePrefix, StringComparison.OrdinalIgnoreCase)
            ? path[devicePrefix.Length..]
            : path;
    }

    [DllImport(
        "kernel32.dll",
        EntryPoint = "CreateFileW",
        SetLastError = true,
        CharSet = CharSet.Unicode)]
    private static extern SafeFileHandle CreateFile(
        string fileName,
        uint desiredAccess,
        FileShare shareMode,
        nint securityAttributes,
        FileMode creationDisposition,
        uint flagsAndAttributes,
        nint templateFile);

    [DllImport(
        "kernel32.dll",
        EntryPoint = "GetFinalPathNameByHandleW",
        SetLastError = true,
        CharSet = CharSet.Unicode)]
    private static extern uint GetFinalPathNameByHandle(
        SafeFileHandle file,
        [Out] StringBuilder filePath,
        uint filePathLength,
        uint flags);
}
