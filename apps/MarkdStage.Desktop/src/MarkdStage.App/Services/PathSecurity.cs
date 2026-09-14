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
            ToExtendedPath(Path.GetFullPath(path)),
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

    /// <summary>
    /// The export the renderer offers to open arrives from web content, so it is untrusted. The
    /// desktop runtime reports save locations workspace-relative with forward slashes, never
    /// absolute, so resolve it against the workspace rather than the process working directory.
    /// </summary>
    public static string ResolveExport(string root, string relativePath)
    {
        var extension = Path.GetExtension(relativePath);
        if (!extension.Equals(".pdf", StringComparison.OrdinalIgnoreCase) &&
            !extension.Equals(".pptx", StringComparison.OrdinalIgnoreCase))
            throw new UnauthorizedAccessException("Only PDF and PowerPoint exports can be opened.");
        var file = WorkspaceResolver.ResolveRelative(root, relativePath.Replace('\\', '/'));
        if (!File.Exists(file))
            throw new FileNotFoundException("It is no longer on disk.", file);
        return CanonicalizeExisting(file);
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

    private static string ToExtendedPath(string path)
    {
        if (path.StartsWith(@"\\?\", StringComparison.Ordinal))
        {
            return path;
        }

        return path.StartsWith(@"\\", StringComparison.Ordinal)
            ? @"\\?\UNC\" + path[2..]
            : @"\\?\" + path;
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
