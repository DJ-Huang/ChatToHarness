// Windows process containment for ChatToHarness. No network, credential storage,
// shell interpretation or stdout logging. Build with the inbox .NET Framework csc.
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class ManagedProcess
{
    const uint CREATE_SUSPENDED = 0x00000004, CREATE_NO_WINDOW = 0x08000000;
    const uint STARTF_USESTDHANDLES = 0x00000100, HANDLE_FLAG_INHERIT = 1;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    const uint WAIT_TIMEOUT = 258, INFINITE = 0xffffffff;
    [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT { public BASIC_LIMIT BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct STARTUPINFO { public uint cb; public string lpReserved, lpDesktop, lpTitle; public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public ushort wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref EXTENDED_LIMIT info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcess(string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string currentDirectory, ref STARTUPINFO startup, out PROCESS_INFORMATION info);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int id);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
    [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    // CommandLineToArgvW / CRT quoting. Values are argv, never a shell command.
    static string Quote(string value)
    {
        StringBuilder result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') result.Append('\\', slashes * 2 + 1).Append('"');
            else result.Append('\\', slashes).Append(c);
            slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }

    public static int Main(string[] args)
    {
        IntPtr job = IntPtr.Zero;
        PROCESS_INFORMATION child = new PROCESS_INFORMATION();
        try {
            int ownerId;
            if (args.Length < 2 || !Int32.TryParse(args[0], out ownerId) || ownerId < 2 || !System.IO.Path.IsPathRooted(args[1])) throw new InvalidOperationException();
            using (Process owner = Process.GetProcessById(ownerId)) {
                // Resolve the owner handle before creating the child to avoid a
                // recycled PID becoming its owner after the original exits.
                IntPtr ownerHandle = owner.Handle;
                job = CreateJobObject(IntPtr.Zero, null);
                if (job == IntPtr.Zero) throw new Win32Exception();
                EXTENDED_LIMIT limits = new EXTENDED_LIMIT();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT)))) throw new Win32Exception();
                STARTUPINFO startup = new STARTUPINFO();
                startup.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFO));
                startup.dwFlags = STARTF_USESTDHANDLES;
                startup.hStdInput = GetStdHandle(-10); startup.hStdOutput = GetStdHandle(-11); startup.hStdError = GetStdHandle(-12);
                foreach (IntPtr handle in new IntPtr[] {startup.hStdInput, startup.hStdOutput, startup.hStdError})
                    if (handle != IntPtr.Zero && handle != new IntPtr(-1) && !SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT)) throw new Win32Exception();
                StringBuilder command = new StringBuilder();
                for (int i = 1; i < args.Length; i++) { if (i > 1) command.Append(' '); command.Append(Quote(args[i])); }
                if (!CreateProcess(args[1], command, IntPtr.Zero, IntPtr.Zero, true, CREATE_SUSPENDED | CREATE_NO_WINDOW, IntPtr.Zero, null, ref startup, out child)) throw new Win32Exception();
                if (!AssignProcessToJobObject(job, child.hProcess)) throw new Win32Exception();
                if (ResumeThread(child.hThread) == 0xffffffff) throw new Win32Exception();
                CloseHandle(child.hThread); child.hThread = IntPtr.Zero;
                while (WaitForSingleObject(child.hProcess, 100) == WAIT_TIMEOUT) {
                    if (WaitForSingleObject(ownerHandle, 0) != WAIT_TIMEOUT) return 1;
                }
                uint exitCode;
                return GetExitCodeProcess(child.hProcess, out exitCode) ? unchecked((int)exitCode) : 1;
            }
        } catch {
            // Never print argv, environment, paths, or Win32 platform errors.
            Console.Error.WriteLine("ChatToHarness: managed process could not start.");
            return 1;
        } finally {
            // If assignment failed, the suspended process is outside the job.
            if (child.hProcess != IntPtr.Zero) { TerminateProcess(child.hProcess, 1); CloseHandle(child.hProcess); }
            if (child.hThread != IntPtr.Zero) CloseHandle(child.hThread);
            if (job != IntPtr.Zero) CloseHandle(job);
        }
    }
}
