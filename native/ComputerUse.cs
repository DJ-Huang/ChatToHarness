// Fixed Windows desktop operations. No command/script evaluation or clipboard use.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

class ComputerUse {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mouse; [FieldOffset(0)] public KEYBDINPUT key; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION data; }
    delegate bool EnumProc(IntPtr window, IntPtr state);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr state);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int length);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out RECT rect);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr window);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
    [DllImport("user32.dll")] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr window, int id);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024 };
    static IntPtr Target;
    static uint TargetPid;
    static long TargetStarted;
    static StopWindow Stop;
    static readonly DateTime Deadline = DateTime.UtcNow.AddMinutes(10);
    static volatile bool Closed;
    static void Error(string code) { throw new InvalidOperationException(code); }
    static void Write(object data) { Console.WriteLine(Json.Serialize(data)); Console.Out.Flush(); }
    class WindowItem {
        public IntPtr Handle; public string Title;
        public override string ToString() { return Title; }
    }
    class StopWindow : Form {
        protected override bool ShowWithoutActivation { get { return true; } }
        public bool HotkeyReady;
        public StopWindow() {
            Text = "ChatToHarness — Computer Use"; Width = 420; Height = 120; TopMost = true;
            StartPosition = FormStartPosition.Manual; Location = new Point(0, 0);
            var button = new Button { Text = "STOP / 停止   Ctrl+Alt+F12", Dock = DockStyle.Fill };
            button.Click += delegate { Close(); }; Controls.Add(button);
        }
        protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); HotkeyReady = RegisterHotKey(Handle, 1, 0x4003, 0x7B); }
        protected override void OnShown(EventArgs e) { base.OnShown(e); ShowWindow(Handle, 4); }
        protected override void WndProc(ref Message message) { if (message.Msg == 0x312) { Close(); return; } base.WndProc(ref message); }
        protected override void OnFormClosed(FormClosedEventArgs e) { ComputerUse.Closed = true; UnregisterHotKey(Handle, 1); base.OnFormClosed(e); Environment.Exit(0); }
    }
    static IntPtr Consent(IntPtr requested) {
        using (var dialog = new Form { Text = "ChatToHarness — Allow window control / 允许窗口控制", Width = 740, Height = 440, StartPosition = FormStartPosition.CenterScreen }) {
            var label = new Label { Dock = DockStyle.Top, Height = 100, Text = "Choose ONE window to allow screenshots, clicks and typing for up to 10 minutes.\n仅选择一个窗口，授权截图、点击和输入，最长 10 分钟。\nGUI operations can access files/network through this app; project folders do not sandbox them.\n窗口授权不是文件或网络沙箱。Ctrl+Alt+F12 或 STOP 可停止。" };
            var list = new ListBox { Dock = DockStyle.Fill };
            // The parent hides the console with STARTUPINFO; explicitly show the
            // consent form rather than inheriting that first-window hide flag.
            dialog.Shown += delegate { ShowWindow(dialog.Handle, 5); dialog.Activate(); };
            EnumWindows(delegate(IntPtr h, IntPtr unused) {
                var text = new StringBuilder(1024); GetWindowText(h, text, text.Capacity);
                uint pid; GetWindowThreadProcessId(h, out pid);
                if (IsWindowVisible(h) && !IsIconic(h) && text.Length > 0 && pid != Process.GetCurrentProcess().Id)
                    { int index=list.Items.Add(new WindowItem { Handle = h, Title = text.ToString() + " [PID " + pid + "]" }); if(h==requested)list.SelectedIndex=index; }
                return true;
            }, IntPtr.Zero);
            var allow = new Button { Text = "Allow selected window / 授权所选窗口", Dock = DockStyle.Bottom, Height = 42 };
            IntPtr selected = IntPtr.Zero;
            allow.Click += delegate { var item = list.SelectedItem as WindowItem; if (item != null) { selected = item.Handle; dialog.DialogResult = DialogResult.OK; dialog.Close(); } };
            dialog.Controls.Add(list); dialog.Controls.Add(label); dialog.Controls.Add(allow);
            dialog.ShowDialog(); return selected;
        }
    }
    static void CheckIdentity() {
        if (Closed || DateTime.UtcNow > Deadline) Error("CU_SESSION_EXPIRED");
        if (!IsWindow(Target) || !IsWindowVisible(Target)) Error("CU_WINDOW_UNAVAILABLE");
        uint pid; GetWindowThreadProcessId(Target, out pid);
        if (pid != TargetPid || Process.GetProcessById((int)pid).StartTime.ToUniversalTime().Ticks != TargetStarted) Error("CU_WINDOW_CHANGED");
    }
    static RECT Check(bool foreground) {
        CheckIdentity();
        if (IsIconic(Target)) Error("CU_WINDOW_UNAVAILABLE");
        if (foreground && GetForegroundWindow() != Target) Error("CU_WINDOW_NOT_FOREGROUND");
        RECT rect; if (!GetWindowRect(Target, out rect)) { Error("CU_WINDOW_UNAVAILABLE"); }
        int width = rect.Right - rect.Left, height = rect.Bottom - rect.Top;
        if (width < 1 || height < 1 || width > 4096 || height > 4096 || (long)width * height > 8388608) Error("CU_WINDOW_TOO_LARGE");
        return rect;
    }
    static object ActivateTarget() {
        CheckIdentity();
        foreach (int key in new int[] { 0x10, 0x11, 0x12, 0x5B, 0x5C, 1, 2 }) if ((GetAsyncKeyState(key) & 0x8000) != 0) Error("CU_USER_INPUT_ACTIVE");
        if (IsIconic(Target)) ShowWindowAsync(Target, 9);
        SetForegroundWindow(Target);
        for (int i = 0; i < 10 && (IsIconic(Target) || GetForegroundWindow() != Target); i++) Thread.Sleep(30);
        if (GetForegroundWindow() != Target) {
            // Run on our existing UI thread, whose input queue is initialized.
            // Always detach, and never inject fake Alt/clicks to gain focus.
            Stop.Invoke(new Action(delegate {
                CheckIdentity();
                uint unused, current = GetCurrentThreadId();
                uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), out unused);
                uint target = GetWindowThreadProcessId(Target, out unused);
                bool attachedForeground = false, attachedTarget = false;
                try {
                    if (foreground != 0 && foreground != current) attachedForeground = AttachThreadInput(current, foreground, true);
                    if (target != current && target != foreground) attachedTarget = AttachThreadInput(current, target, true);
                    BringWindowToTop(Target); SetForegroundWindow(Target);
                } finally {
                    if (attachedTarget) AttachThreadInput(current, target, false);
                    if (attachedForeground) AttachThreadInput(current, foreground, false);
                }
            }));
        }
        for (int i = 0; i < 10 && (IsIconic(Target) || GetForegroundWindow() != Target); i++) Thread.Sleep(30);
        CheckIdentity();
        if (IsIconic(Target) || GetForegroundWindow() != Target) Error("CU_ACTIVATION_FAILED");
        Check(true);
        return new { foreground = true };
    }
    static int Number(Dictionary<string, object> args, string name) { return Convert.ToInt32(args[name]); }
    static void Inject(INPUT[] inputs) {
        Check(true);
        // Do not merge automation with a user's held modifiers or mouse buttons.
        foreach (int key in new int[] { 0x10, 0x11, 0x12, 0x5B, 0x5C, 1, 2 }) if ((GetAsyncKeyState(key) & 0x8000) != 0) Error("CU_USER_INPUT_ACTIVE");
        if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) != inputs.Length) {
            // Release only the keys introduced by this batch if Windows accepted a prefix.
            var release = new List<INPUT>();
            foreach (var input in inputs) if (input.type == 1 && (input.data.key.flags & 2) == 0) { var up = input; up.data.key.flags |= 2; release.Add(up); }
            foreach (var input in inputs) if (input.type == 0 && (input.data.mouse.dwFlags & 10) != 0) { var up = input; up.data.mouse.dwFlags = (input.data.mouse.dwFlags & 2) != 0 ? 4u : 16u; release.Add(up); }
            if (release.Count > 0) SendInput((uint)release.Count, release.ToArray(), Marshal.SizeOf(typeof(INPUT)));
            Error("CU_INPUT_FAILED");
        }
    }
    static INPUT Key(ushort vk, ushort scan, uint flags) { return new INPUT { type = 1, data = new UNION { key = new KEYBDINPUT { vk = vk, scan = scan, flags = flags } } }; }
    static object Capture(RECT r) {
        using (var bitmap = new Bitmap(r.Right - r.Left, r.Bottom - r.Top)) {
            using (var graphics = Graphics.FromImage(bitmap)) {
                IntPtr dc = graphics.GetHdc(); bool success;
                try { success = PrintWindow(Target, dc, 2); } finally { graphics.ReleaseHdc(dc); }
                if (!success) Error("CU_CAPTURE_UNSUPPORTED");
            }
            using (var stream = new MemoryStream()) {
                bitmap.Save(stream, ImageFormat.Png);
                if (stream.Length > 40 * 1024 * 1024) Error("CU_CAPTURE_TOO_LARGE");
                RECT after = Check(false);
                if (after.Left != r.Left || after.Top != r.Top || after.Right != r.Right || after.Bottom != r.Bottom) Error("CU_WINDOW_MOVED");
                return new { width = bitmap.Width, height = bitmap.Height, geometry = new int[] {r.Left, r.Top, r.Right, r.Bottom}, png = Convert.ToBase64String(stream.ToArray()) };
            }
        }
    }
    static object Execute(Dictionary<string, object> args) {
        string action = (string)args["action"];
        if (action == "activate") return ActivateTarget();
        RECT rect = Check(action != "observe");
        if (action == "observe") return Capture(rect);
        var geometry = args["geometry"] as ArrayList;
        if (geometry == null || geometry.Count != 4 || Convert.ToInt32(geometry[0]) != rect.Left || Convert.ToInt32(geometry[1]) != rect.Top || Convert.ToInt32(geometry[2]) != rect.Right || Convert.ToInt32(geometry[3]) != rect.Bottom) Error("CU_WINDOW_MOVED");
        if (action == "click" || action == "scroll") {
            int x = Number(args, "x"), y = Number(args, "y");
            if (x < 0 || y < 0 || x >= rect.Right - rect.Left || y >= rect.Bottom - rect.Top) Error("CU_COORDINATE_OUTSIDE_WINDOW");
            var point = new Point(rect.Left + x, rect.Top + y);
            if (GetAncestor(WindowFromPoint(point), 2) != Target) Error("CU_TARGET_OCCLUDED");
            if (!SetCursorPos(point.X, point.Y)) Error("CU_INPUT_FAILED");
            if (GetAncestor(WindowFromPoint(point), 2) != Target) Error("CU_TARGET_OCCLUDED");
            if (action == "click") {
                bool right = args.ContainsKey("button") && (string)args["button"] == "right";
                Inject(new INPUT[] { new INPUT { data = new UNION { mouse = new MOUSEINPUT { dwFlags = right ? 8u : 2u } } }, new INPUT { data = new UNION { mouse = new MOUSEINPUT { dwFlags = right ? 16u : 4u } } } });
            } else {
                int delta = Number(args, "delta"); if (delta == 0 || Math.Abs(delta) > 10) Error("CU_INVALID_ARGUMENT");
                Inject(new INPUT[] { new INPUT { data = new UNION { mouse = new MOUSEINPUT { dwFlags = 0x800, mouseData = unchecked((uint)(delta * 120)) } } } });
            }
        } else if (action == "type_text") {
            string text = (string)args["text"]; if (text.Length < 1 || text.Length > 1000) Error("CU_INVALID_ARGUMENT");
            var inputs = new List<INPUT>();
            foreach (char ch in text) { if (char.IsControl(ch)) Error("CU_INVALID_ARGUMENT"); inputs.Add(Key(0, ch, 4)); inputs.Add(Key(0, ch, 6)); }
            Inject(inputs.ToArray());
        } else if (action == "key_press") {
            string key = (string)args["key"];
            var keys = new Dictionary<string, ushort> { {"ENTER",13},{"TAB",9},{"ESC",27},{"BACKSPACE",8},{"DELETE",46},{"LEFT",37},{"RIGHT",39},{"UP",38},{"DOWN",40},{"HOME",36},{"END",35},{"PAGEUP",33},{"PAGEDOWN",34} };
            var inputs = new List<INPUT>();
            if (key == "SHIFT+TAB") { inputs.Add(Key(16,0,0)); inputs.Add(Key(9,0,0)); inputs.Add(Key(9,0,2)); inputs.Add(Key(16,0,2)); }
            else if (key.StartsWith("CTRL+") && key.Length == 6 && "ACVZY".Contains(key.Substring(5))) { ushort vk = key[5]; inputs.Add(Key(17,0,0)); inputs.Add(Key(vk,0,0)); inputs.Add(Key(vk,0,2)); inputs.Add(Key(17,0,2)); }
            else { if (!keys.ContainsKey(key)) Error("CU_INVALID_ARGUMENT"); ushort vk = keys[key]; uint extended = vk >= 33 && vk <= 46 ? 1u : 0u; inputs.Add(Key(vk,0,extended)); inputs.Add(Key(vk,0,extended | 2)); }
            Inject(inputs.ToArray());
        } else Error("CU_INVALID_ARGUMENT");
        return new { ok = true };
    }
    static void ReadCommands() {
        try {
            string line;
            while (!Closed && (line = Console.ReadLine()) != null) {
                try {
                    if (line.Length > 20000) Error("CU_INVALID_ARGUMENT");
                    var args = Json.Deserialize<Dictionary<string, object>>(line);
                    Write(Execute(args));
                } catch (Exception e) { Write(new { error = e.Message.StartsWith("CU_") ? e.Message : "CU_NATIVE_ERROR" }); }
            }
        } finally { Environment.Exit(0); }
    }
    [STAThread] static void Main(string[] args) {
        Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
        try {
            // Exit even if the MCP owner dies while the consent picker is open.
            if (args.Length < 1 || args.Length > 3) Error("CU_OWNER_REQUIRED");
            var owner = Process.GetProcessById(int.Parse(args[0]));
            var watchdog = new Thread(delegate() { owner.WaitForExit(); Environment.Exit(0); }) { IsBackground = true }; watchdog.Start();
            try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { Error("CU_WINDOWS_VERSION_UNSUPPORTED"); }
            Application.EnableVisualStyles();
            string mode=args.Length>=2?args[1]:"per_window";
            IntPtr requested=args.Length>=3?new IntPtr(long.Parse(args[2])):IntPtr.Zero;
            if(mode=="list_windows") {
                var windows=new List<object>();
                EnumWindows(delegate(IntPtr h,IntPtr unused) { var text=new StringBuilder(1024); GetWindowText(h,text,text.Capacity); uint pid; GetWindowThreadProcessId(h,out pid);
                    if(windows.Count<256 && IsWindowVisible(h) && !IsIconic(h) && text.Length>0 && pid!=Process.GetCurrentProcess().Id)windows.Add(new {window_id=h.ToInt64().ToString(),title=text.ToString(),pid=pid}); return true;
                },IntPtr.Zero); Write(new {windows=windows}); return;
            }
            if(mode!="all_windows" && mode!="per_window")Error("CU_INVALID_AUTHORIZATION_MODE");
            Target = mode=="per_window"?Consent(requested):(requested==IntPtr.Zero?GetForegroundWindow():requested);
            if (Target == IntPtr.Zero) Error("CU_CONSENT_DENIED");
            if(GetAncestor(Target,2)!=Target)Error("CU_INVALID_WINDOW");
            GetWindowThreadProcessId(Target, out TargetPid);
            TargetStarted = Process.GetProcessById((int)TargetPid).StartTime.ToUniversalTime().Ticks;
            Check(false);
            Stop = new StopWindow(); var handle = Stop.Handle;
            if (!Stop.HotkeyReady) Error("CU_STOP_HOTKEY_UNAVAILABLE");
            SetForegroundWindow(Target);
            var timer = new System.Windows.Forms.Timer { Interval = 1000 };
            timer.Tick += delegate { if (DateTime.UtcNow > Deadline) Stop.Close(); }; timer.Start();
            Write(new { ready = true, window_id=Target.ToInt64().ToString() });
            var thread = new Thread(ReadCommands) { IsBackground = true }; thread.Start();
            Application.Run(Stop);
        } catch (Exception e) { Write(new { error = e.Message.StartsWith("CU_") ? e.Message : "CU_NATIVE_ERROR" }); }
    }
}
