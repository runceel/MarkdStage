using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace MarkdStage.Cli;

internal sealed class BrowserProcess : IAsyncDisposable
{
    private const uint CreateNoWindow = 0x08000000;
    private const uint CreateSuspended = 0x00000004;
    private const uint ExtendedStartupInfoPresent = 0x00080000;
    private const nuint ProcThreadAttributeDesktopAppPolicy = 0x00020012;
    private const nuint ProcThreadAttributeHandleList = 0x00020002;
    private const int ProcessCreationDesktopAppBreakawayEnableProcessTree = 0x01;
    private readonly SafeFileHandle job;
    private readonly Process process;
    private readonly Task stdoutPump;
    private readonly Task stderrPump;
    private bool disposed;
    public bool HasExited => process.HasExited;

    private BrowserProcess(SafeFileHandle job, Process process, SafeFileHandle stdout, SafeFileHandle stderr)
    {
        this.job = job;
        this.process = process;
        stdoutPump = PumpAsync(stdout);
        stderrPump = PumpAsync(stderr);
    }

    private static Task PumpAsync(SafeFileHandle handle) => Task.Run(async () =>
    {
        using var stream = new FileStream(handle, FileAccess.Read);
        await stream.CopyToAsync(Stream.Null);
    });

    public static BrowserProcess Start(string executable, IEnumerable<string> arguments)
    {
        var job = Native.CreateJobObjectW(0, null);
        if (job.IsInvalid) throw new Win32Exception();
        var limits = new Native.ExtendedLimit { Basic = new Native.BasicLimit { LimitFlags = 0x2000 } };
        if (!Native.SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<Native.ExtendedLimit>()))
        { job.Dispose(); throw new Win32Exception(); }
        SafeFileHandle? stdoutRead = null, stdoutWrite = null, stderrRead = null, stderrWrite = null, input = null;
        nint attributeList = 0, handleList = 0, desktopAppPolicy = 0;
        var attributesInitialized = false;
        Native.ProcessInfo info = default;
        try
        {
            var security = new Native.SecurityAttributes { Length = Marshal.SizeOf<Native.SecurityAttributes>(), InheritHandle = 1 };
            if (!Native.CreatePipe(out stdoutRead, out stdoutWrite, ref security, 0) ||
                !Native.CreatePipe(out stderrRead, out stderrWrite, ref security, 0))
                throw new Win32Exception();
            if (!Native.SetHandleInformation(stdoutRead, 1, 0) || !Native.SetHandleInformation(stderrRead, 1, 0))
                throw new Win32Exception();
            input = Native.CreateFileW("NUL", 0x80000000, 3, ref security, 3, 0, 0);
            if (input.IsInvalid) throw new Win32Exception();
            var packaged = Native.IsCurrentProcessPackaged();
            nuint attributeSize = 0;
            Native.InitializeProcThreadAttributeList(0, packaged ? 2 : 1, 0, ref attributeSize);
            attributeList = Marshal.AllocHGlobal(checked((int)attributeSize));
            if (!Native.InitializeProcThreadAttributeList(attributeList, packaged ? 2 : 1, 0, ref attributeSize))
                throw new Win32Exception();
            attributesInitialized = true;
            handleList = Marshal.AllocHGlobal(3 * nint.Size);
            Marshal.WriteIntPtr(handleList, input.DangerousGetHandle());
            Marshal.WriteIntPtr(handleList, nint.Size, stdoutWrite.DangerousGetHandle());
            Marshal.WriteIntPtr(handleList, 2 * nint.Size, stderrWrite.DangerousGetHandle());
            if (!Native.UpdateProcThreadAttribute(
                    attributeList, 0, ProcThreadAttributeHandleList,
                    handleList, (nuint)(3 * nint.Size), 0, 0))
                throw new Win32Exception();
            if (packaged)
            {
                desktopAppPolicy = Marshal.AllocHGlobal(sizeof(int));
                Marshal.WriteInt32(desktopAppPolicy, ProcessCreationDesktopAppBreakawayEnableProcessTree);
                if (!Native.UpdateProcThreadAttribute(
                        attributeList, 0, ProcThreadAttributeDesktopAppPolicy,
                        desktopAppPolicy, (nuint)sizeof(int), 0, 0))
                    throw new Win32Exception();
            }
            var startup = new Native.StartupInfoEx
            {
                Startup = new Native.StartupInfo
                {
                    Size = Marshal.SizeOf<Native.StartupInfoEx>(), Flags = 0x100,
                    Input = input.DangerousGetHandle(), Output = stdoutWrite.DangerousGetHandle(), Error = stderrWrite.DangerousGetHandle()
                },
                Attributes = attributeList
            };
            var command = new StringBuilder(string.Join(" ", new[] { executable }.Concat(arguments).Select(Quote)));
            // Remove package identity from the browser process tree, then assign the suspended root
            // to our own kill-on-close job before Chromium can create subprocesses.
            var creationFlags = ExtendedStartupInfoPresent | CreateSuspended | CreateNoWindow;
            if (!Native.CreateProcessW(executable, command, 0, 0, true, creationFlags,
                    0, Path.GetDirectoryName(executable), ref startup, out info))
                throw new Win32Exception();
            if (!Native.AssignProcessToJobObject(job, info.Process)) throw new Win32Exception();
            var process = Process.GetProcessById((int)info.ProcessId);
            if (Native.ResumeThread(info.Thread) == uint.MaxValue) { process.Dispose(); throw new Win32Exception(); }
            var result = new BrowserProcess(job, process, stdoutRead, stderrRead);
            stdoutRead = stderrRead = null;
            return result;
        }
        catch
        {
            if (info.Process != 0) Native.TerminateProcess(info.Process, 1);
            job.Dispose();
            throw;
        }
        finally
        {
            if (info.Thread != 0) Native.CloseHandle(info.Thread);
            if (info.Process != 0) Native.CloseHandle(info.Process);
            if (attributesInitialized) Native.DeleteProcThreadAttributeList(attributeList);
            if (attributeList != 0) Marshal.FreeHGlobal(attributeList);
            if (handleList != 0) Marshal.FreeHGlobal(handleList);
            if (desktopAppPolicy != 0) Marshal.FreeHGlobal(desktopAppPolicy);
            input?.Dispose();
            stdoutWrite?.Dispose();
            stderrWrite?.Dispose();
            stdoutRead?.Dispose();
            stderrRead?.Dispose();
        }
    }

    internal static string Quote(string argument)
    {
        var result = new StringBuilder("\"");
        var slashes = 0;
        foreach (var character in argument)
        {
            if (character == '\\') { slashes++; continue; }
            result.Append('\\', character == '"' ? slashes * 2 + 1 : slashes);
            result.Append(character);
            slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }

    public async ValueTask DisposeAsync()
    {
        if (disposed) return;
        disposed = true;
        job.Dispose();
        try { await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10)); }
        catch (TimeoutException) { }
        try { await Task.WhenAll(stdoutPump, stderrPump).WaitAsync(TimeSpan.FromSeconds(10)); }
        catch (TimeoutException) { }
        catch (IOException) { }
        process.Dispose();
    }

    private static class Native
    {
        [StructLayout(LayoutKind.Sequential)] internal struct SecurityAttributes { public int Length; public nint Descriptor; public int InheritHandle; }
        [StructLayout(LayoutKind.Sequential)] internal struct BasicLimit
        {
            public long ProcessTime, JobTime; public uint LimitFlags; public nuint MinimumWorkingSet, MaximumWorkingSet;
            public uint ActiveProcessLimit; public nuint Affinity; public uint PriorityClass, SchedulingClass;
        }
        [StructLayout(LayoutKind.Sequential)] internal struct IoCounters { public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }
        [StructLayout(LayoutKind.Sequential)] internal struct ExtendedLimit
        { public BasicLimit Basic; public IoCounters Io; public nuint ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] internal struct StartupInfo
        {
            public int Size; public nint Reserved, Desktop, Title; public uint X, Y, Width, Height, XChars, YChars, Fill, Flags;
            public ushort ShowWindow, ReservedSize; public nint ReservedBytes, Input, Output, Error;
        }
        [StructLayout(LayoutKind.Sequential)] internal struct StartupInfoEx { public StartupInfo Startup; public nint Attributes; }
        [StructLayout(LayoutKind.Sequential)] internal struct ProcessInfo { public nint Process, Thread; public uint ProcessId, ThreadId; }
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] internal static extern SafeFileHandle CreateJobObjectW(nint attributes, string? name);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetInformationJobObject(SafeFileHandle job, int type, ref ExtendedLimit info, uint length);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool AssignProcessToJobObject(SafeFileHandle job, nint process);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool CreatePipe(out SafeFileHandle read, out SafeFileHandle write, ref SecurityAttributes attributes, uint size);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetHandleInformation(SafeFileHandle handle, uint mask, uint flags);
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] internal static extern SafeFileHandle CreateFileW(string name, uint access, uint share, ref SecurityAttributes attributes, uint creation, uint flags, nint template);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool InitializeProcThreadAttributeList(nint list, int count, int flags, ref nuint size);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool UpdateProcThreadAttribute(nint list, uint flags, nuint attribute, nint value, nuint size, nint previous, nint returnedSize);
        [DllImport("kernel32.dll")] internal static extern int GetCurrentPackageFullName(ref uint packageFullNameLength, StringBuilder? packageFullName);
        [DllImport("kernel32.dll")] internal static extern void DeleteProcThreadAttributeList(nint list);
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool CreateProcessW(string executable, StringBuilder command, nint processAttributes, nint threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint flags, nint environment, string? directory, ref StartupInfoEx startup, out ProcessInfo info);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint ResumeThread(nint thread);
        [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool CloseHandle(nint handle);
        [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool TerminateProcess(nint process, uint code);

        internal static bool IsCurrentProcessPackaged()
        {
            uint length = 0;
            return GetCurrentPackageFullName(ref length, null) == 122;
        }
    }
}
