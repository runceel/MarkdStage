using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using System.Text;

namespace MarkdStage.Core;

// Keep ancestors open without delete/write sharing while a Windows filesystem operation is in flight.
// Validation alone would allow a junction to be swapped between checking a path and opening it.
public sealed class WorkspacePathLease : IDisposable
{
    private readonly List<SafeFileHandle> _handles = [];

    public static string CanonicalizeExisting(string path)
    {
        using var lease = Acquire(path, includeFile: true);
        if (!OperatingSystem.IsWindows()) return Path.GetFullPath(path);
        using var handle = CreateFile(path, 0, FileShare.Read, nint.Zero, FileMode.Open,
            0x02000000 | 0x00200000, nint.Zero);
        if (handle.IsInvalid) throw new IOException("The workspace path could not be resolved.");
        var capacity = 512u;
        while (true)
        {
            var buffer = new StringBuilder((int)capacity);
            var length = GetFinalPathNameByHandle(handle, buffer, capacity, 0);
            if (length == 0) throw new IOException("The workspace path could not be resolved.");
            if (length >= capacity) { capacity = length + 1; continue; }
            var result = buffer.ToString();
            return result.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase) ? @"\\" + result[8..] :
                result.StartsWith(@"\\?\", StringComparison.Ordinal) ? result[4..] : result;
        }
    }

    public static WorkspacePathLease Acquire(string path, bool includeFile = false)
    {
        var lease = new WorkspacePathLease();
        try
        {
            WorkspaceResolver.RejectLinks(path);
            if (!OperatingSystem.IsWindows()) return lease;
            var fullPath = Path.GetFullPath(path);
            var current = Path.GetPathRoot(fullPath)!;
            var segments = fullPath[current.Length..].Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries);
            foreach (var segment in segments)
            {
                current = Path.Combine(current, segment);
                if (!Directory.Exists(current) && !(includeFile && File.Exists(current)))
                {
                    if (includeFile) throw new FileNotFoundException("The workspace path is unavailable.");
                    break;
                }
                var handle = CreateFile(current, 0, FileShare.Read, nint.Zero, FileMode.Open,
                    0x02000000 | 0x00200000, nint.Zero);
                if (handle.IsInvalid)
                {
                    handle.Dispose();
                    throw new IOException("The workspace path could not be locked.");
                }
                lease._handles.Add(handle);
                if (!GetFileInformationByHandle(handle, out var information) ||
                    (information.FileAttributes & (uint)FileAttributes.ReparsePoint) != 0)
                    throw new UnauthorizedAccessException("Links are not allowed in workspace paths.");
            }
            return lease;
        }
        catch { lease.Dispose(); throw; }
    }

    public void Dispose()
    {
        for (var index = _handles.Count - 1; index >= 0; index--) _handles[index].Dispose();
        _handles.Clear();
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileInformation
    {
        public uint FileAttributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
        public uint VolumeSerialNumber, FileSizeHigh, FileSizeLow, NumberOfLinks, FileIndexHigh, FileIndexLow;
    }

    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string name, uint access, FileShare sharing,
        nint security, FileMode creation, uint flags, nint template);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation information);

    [DllImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint capacity, uint flags);
}
