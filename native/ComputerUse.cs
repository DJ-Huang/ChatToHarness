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
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CURSORINFO info);
    [DllImport("user32.dll")] static extern bool GetIconInfo(IntPtr cursor, out ICONINFO info);
    [DllImport("user32.dll")] static extern bool DrawIconEx(IntPtr dc, int x, int y, IntPtr icon, int width, int height, uint step, IntPtr brush, uint flags);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
    [DllImport("user32.dll")] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr window, int id);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct CURSORINFO { public int Size; public int Flags; public IntPtr Cursor; public POINT Position; }
    [StructLayout(LayoutKind.Sequential)] struct ICONINFO { [MarshalAs(UnmanagedType.Bool)] public bool IsIcon; public uint HotspotX, HotspotY; public IntPtr Mask, Color; }
    [StructLayout(LayoutKind.Sequential)] struct SIZE { public int Width, Height; }
    [StructLayout(LayoutKind.Sequential)] struct BLENDFUNCTION { public byte BlendOp, BlendFlags, SourceConstantAlpha, AlphaFormat; }
    [StructLayout(LayoutKind.Sequential)] struct BITMAPINFOHEADER {
        public uint Size; public int Width, Height; public ushort Planes, BitCount; public uint Compression, SizeImage;
        public int XPelsPerMeter, YPelsPerMeter; public uint ClrUsed, ClrImportant;
    }
    [StructLayout(LayoutKind.Sequential)] struct BITMAPINFO { public BITMAPINFOHEADER Header; public uint Color; }
    [StructLayout(LayoutKind.Sequential)] struct GDI_BITMAP { public int Type, Width, Height, WidthBytes; public ushort Planes, BitsPixel; public IntPtr Bits; }
    [DllImport("gdi32.dll", EntryPoint="GetObjectW")] static extern int GetGdiObject(IntPtr handle, int size, out GDI_BITMAP bitmap);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);
    [DllImport("user32.dll", SetLastError=true)] static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr dstDC, ref POINT dst, ref SIZE size, IntPtr srcDC, ref POINT src, uint key, ref BLENDFUNCTION blend, uint flags);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr dc, ref BITMAPINFO info, uint usage, out IntPtr bits, IntPtr section, uint offset);
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024 };
    static IntPtr Target;
    static uint TargetPid;
    static long TargetStarted;
    static StopWindow Stop;
    static readonly DateTime Deadline = DateTime.UtcNow.AddMinutes(10);
    static volatile bool Closed;
    static bool LeftHeld;
    static DateTime HeldSince;
    static object LastOcclusion;
    static void SetHudAction(string action) {
        var panel = Stop;
        if (panel != null && !panel.IsDisposed && panel.IsHandleCreated)
            try { panel.BeginInvoke(new Action(() => panel.SetActivity(action))); } catch (InvalidOperationException) { }
    }
    static bool WithinDisplay(Point point) {
        foreach (var display in Screen.AllScreens) if (display.Bounds.Contains(point)) return true;
        return false;
    }
    static object OccluderAt(Point point) {
        // WindowFromPoint resolves the real pointer receiver, unlike raw
        // rectangle intersections. Do not infer click-through from opacity.
        IntPtr hit = WindowFromPoint(point);
        if (hit == IntPtr.Zero) return new {reason="hit_test_unavailable"};
        IntPtr ownerWindow = GetAncestor(hit, 2);
        if (ownerWindow == Target) return null;
        uint pid = 0;
        GetWindowThreadProcessId(ownerWindow, out pid);
        string processName = "";
        if (pid != 0) try { processName = Process.GetProcessById((int)pid).ProcessName; }
                      catch { /* A protected process may deny name access. */ }
        RECT bounds = new RECT();
        bool hasBounds = ownerWindow != IntPtr.Zero && GetWindowRect(ownerWindow, out bounds);
        return new {reason="window_above_target", window_id=ownerWindow.ToInt64().ToString(),
            owner_pid=pid, owner=processName, bounds=hasBounds ? new int[]{bounds.Left,bounds.Top,
                bounds.Right-bounds.Left,bounds.Bottom-bounds.Top} : new int[0],
            hit_test="window_from_point"};
    }
    static void RequireUnoccluded(Point point) {
        LastOcclusion = OccluderAt(point);
        if (LastOcclusion != null) Error("CU_TARGET_OCCLUDED");
    }
    static object DragWindowAtomic(Dictionary<string,object> args, RECT rect) {
        int x=Number(args,"x"), y=Number(args,"y");
        int width=rect.Right-rect.Left, height=rect.Bottom-rect.Top;
        if (x<72 || x>=width-16 || y<8 || y>Math.Min(48,height-1))
            Error("CU_INVALID_ARGUMENT");
        var requested=new Point(Number(args,"screen_x"),Number(args,"screen_y"));
        if (!WithinDisplay(requested)) Error("CU_COORDINATE_OUTSIDE_DISPLAY");
        // Probe only before injecting left-down, never replay uncertain input.
        int[] candidates={x,Math.Min(width-17,85),Math.Max(72,Math.Min(width-17,width/2))};
        var seen=new HashSet<int>();
        var blocked=new List<object>();
        int grip=-1;
        foreach (int candidate in candidates) {
            if (candidate<72 || candidate>=width-16 || !seen.Add(candidate)) continue;
            var check=new Point(rect.Left+candidate,rect.Top+y);
            object blocker=OccluderAt(check);
            if (blocker==null) { grip=candidate; break; }
            blocked.Add(new {candidate_x=candidate, blocker=blocker});
        }
        if (grip<0) {
            LastOcclusion=new {reason="all_titlebar_candidates_blocked",candidates=blocked};
            Error("CU_TARGET_OCCLUDED");
        }
        var source=new Point(rect.Left+grip,rect.Top+y);
        // Preserve requested resulting window placement when grip changes.
        var destination=new Point(requested.X+grip-x,requested.Y);
        if (!WithinDisplay(destination)) Error("CU_COORDINATE_OUTSIDE_DISPLAY");
        SetHudAction("mouse_move");
        MoveCursorVisible(source);
        RECT current=Check(true);
        if (current.Left!=rect.Left || current.Top!=rect.Top ||
            current.Right!=rect.Right || current.Bottom!=rect.Bottom)
            Error("CU_WINDOW_MOVED");
        RequireUnoccluded(source);
        SetHudAction("mouse_down");
        Inject(new INPUT[]{new INPUT{data=new UNION{mouse=new MOUSEINPUT{dwFlags=2u}}}});
        LeftHeld=true;
        HeldSince=DateTime.UtcNow;
        try {
            SetHudAction("mouse_drag");
            MoveCursorVisibleDuringDrag(destination,true);
        } finally {
            SetHudAction("mouse_up");
            ReleaseHeldMouse();
        }
        return new {ok=true};
    }
    static void ReleaseHeldMouse() {
        if (!LeftHeld) return;
        // Release without foreground/geometry checks: STOP and errors must always work.
        SendInput(1, new[] { new INPUT { data = new UNION { mouse = new MOUSEINPUT { dwFlags = 4u } } } }, Marshal.SizeOf(typeof(INPUT)));
        LeftHeld = false;
    }
    static void Error(string code) { throw new InvalidOperationException(code); }
    static void Write(object data) { Console.WriteLine(Json.Serialize(data)); Console.Out.Flush(); }
    class WindowItem {
        public IntPtr Handle; public string Title;
        public override string ToString() { return Title; }
    }
    // Per-pixel alpha avoids blending translucent blue with a magenta color key.
    // The overlay does not activate, take clicks, or change the controlled window.
    class ControlOutline : Form {
        protected override bool ShowWithoutActivation { get { return true; } }
        protected override CreateParams CreateParams {
            get {
                var p = base.CreateParams;
                p.ExStyle |= 0x00080000 | 0x00000020 | 0x00000080 | 0x08000000; // LAYERED, TRANSPARENT, TOOLWINDOW, NOACTIVATE
                return p;
            }
        }
        public ControlOutline() {
            FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true;
            StartPosition = FormStartPosition.Manual;
        }
        public void FollowTarget() {
            if (!IsWindow(Target) || IsIconic(Target)) { Hide(); return; }
            RECT r;
            if (!GetWindowRect(Target, out r)) { Hide(); return; }
            var bounds = new Rectangle(r.Left - 10, r.Top - 10, r.Right - r.Left + 20, r.Bottom - r.Top + 20);
            bool changed = Bounds != bounds;
            if (changed) Bounds = bounds;
            if (!Visible) { Show(); changed = true; }
            if (changed) DrawGradient();
        }
        void DrawGradient() {
            int width = Width, height = Height;
            if (width < 20 || height < 20) return;
            using (var bitmap = new Bitmap(width, height, PixelFormat.Format32bppPArgb)) {
                using (var graphics = Graphics.FromImage(bitmap)) {
                    graphics.Clear(Color.Transparent);
                    graphics.CompositingMode = System.Drawing.Drawing2D.CompositingMode.SourceCopy;
                    for (int i = 0; i < 10; i++) {
                        int alpha = 25 + i * 17; // 25/255 outer glow -> 178/255 inner edge
                        using (var pen = new Pen(Color.FromArgb(alpha, 126, 202, 255), 1f))
                            graphics.DrawRectangle(pen, i, i, width - 2 * i - 1, height - 2 * i - 1);
                    }
                }
                var data = bitmap.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.ReadOnly, PixelFormat.Format32bppPArgb);
                IntPtr screen = IntPtr.Zero, memory = IntPtr.Zero, dib = IntPtr.Zero, previous = IntPtr.Zero;
                try {
                    // A top-down 32-bit DIB preserves premultiplied alpha for UpdateLayeredWindow.
                    screen = GetDC(IntPtr.Zero);
                    memory = CreateCompatibleDC(screen);
                    var info = new BITMAPINFO { Header = new BITMAPINFOHEADER {
                        Size = (uint)Marshal.SizeOf(typeof(BITMAPINFOHEADER)), Width = width, Height = -height,
                        Planes = 1, BitCount = 32, Compression = 0
                    }};
                    IntPtr bits;
                    dib = CreateDIBSection(screen, ref info, 0, out bits, IntPtr.Zero, 0);
                    if (screen == IntPtr.Zero || memory == IntPtr.Zero || dib == IntPtr.Zero || bits == IntPtr.Zero)
                        throw new InvalidOperationException("CU_OUTLINE_FAILED");
                    int stride = width * 4;
                    var row = new byte[stride];
                    for (int y = 0; y < height; y++) {
                        Marshal.Copy(IntPtr.Add(data.Scan0, y * data.Stride), row, 0, stride);
                        Marshal.Copy(row, 0, IntPtr.Add(bits, y * stride), stride);
                    }
                    previous = SelectObject(memory, dib);
                    var dst = new POINT { X = Left, Y = Top };
                    var src = new POINT();
                    var size = new SIZE { Width = width, Height = height };
                    var blend = new BLENDFUNCTION { SourceConstantAlpha = 255, AlphaFormat = 1 };
                    if (!UpdateLayeredWindow(Handle, screen, ref dst, ref size, memory, ref src, 0, ref blend, 2))
                        throw new InvalidOperationException("CU_OUTLINE_FAILED");
                } finally {
                    if (previous != IntPtr.Zero && memory != IntPtr.Zero) SelectObject(memory, previous);
                    if (dib != IntPtr.Zero) DeleteObject(dib);
                    if (memory != IntPtr.Zero) DeleteDC(memory);
                    if (screen != IntPtr.Zero) ReleaseDC(IntPtr.Zero, screen);
                    bitmap.UnlockBits(data);
                }
            }
        }
    }
    // Cursor-shaped halo: derive the actual Windows cursor silhouette instead of
    // assuming a circle centered on its hotspot. The real OS cursor stays visible.
    static Bitmap MakeCursorGlow(IntPtr cursor, out Point origin) {
        origin = Point.Empty;
        ICONINFO icon;
        if (cursor == IntPtr.Zero || !GetIconInfo(cursor, out icon)) return null;
        try {
            GDI_BITMAP native;
            IntPtr imageBitmap = icon.Color != IntPtr.Zero ? icon.Color : icon.Mask;
            if (imageBitmap == IntPtr.Zero || GetGdiObject(imageBitmap, Marshal.SizeOf(typeof(GDI_BITMAP)), out native) == 0)
                return null;
            int width = native.Width, height = icon.Color != IntPtr.Zero ? native.Height : native.Height / 2;
            if (width < 1 || width > 128 || height < 1 || height > 128) return null;
            const int glow = 14;
            // Black/white background comparison also supports monochrome AND/XOR cursors.
            // Transparent pixels retain their background; opaque pixels converge.
            using (var black = new Bitmap(width, height, PixelFormat.Format32bppArgb))
            using (var white = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
                foreach (var pair in new[] { new { Bitmap = black, Background = Color.Black },
                                              new { Bitmap = white, Background = Color.White } }) {
                    using (var g = Graphics.FromImage(pair.Bitmap)) {
                        g.Clear(pair.Background);
                        IntPtr dc = g.GetHdc();
                        try { if (!DrawIconEx(dc, 0, 0, cursor, width, height, 0, IntPtr.Zero, 3)) return null; }
                        finally { g.ReleaseHdc(dc); }
                    }
                }
                var solid = new bool[width * height];
                int count = 0;
                for (int y = 0; y < height; y++) for (int x = 0; x < width; x++) {
                    var a = black.GetPixel(x, y); var b = white.GetPixel(x, y);
                    int separation = (Math.Abs(b.R - a.R) + Math.Abs(b.G - a.G) + Math.Abs(b.B - a.B)) / 3;
                    bool visible = separation < 210;
                    solid[y * width + x] = visible;
                    if (visible) count++;
                }
                if (count == 0) return null;
                int fullWidth = width + glow * 2, fullHeight = height + glow * 2;
                var opacity = new byte[fullWidth * fullHeight];
                for (int y = 0; y < height; y++) for (int x = 0; x < width; x++) {
                    if (!solid[y * width + x]) continue;
                    for (int dy = -glow; dy <= glow; dy++) for (int dx = -glow; dx <= glow; dx++) {
                        int xx = x + glow + dx, yy = y + glow + dy;
                        if (xx < 0 || yy < 0 || xx >= fullWidth || yy >= fullHeight) continue;
                        double distance = Math.Sqrt(dx * dx + dy * dy);
                        if (distance > glow) continue;
                        double fade = 1 - distance / glow;
                        byte alpha = (byte)Math.Round(155 * fade * fade);
                        int idx = yy * fullWidth + xx;
                        if (alpha > opacity[idx]) opacity[idx] = alpha;
                    }
                }
                var result = new Bitmap(fullWidth, fullHeight, PixelFormat.Format32bppPArgb);
                for (int y = 0; y < fullHeight; y++) for (int x = 0; x < fullWidth; x++) {
                    int iconX = x - glow, iconY = y - glow;
                    if (iconX >= 0 && iconY >= 0 && iconX < width && iconY < height
                        && solid[iconY * width + iconX]) continue;
                    byte alpha = opacity[y * fullWidth + x];
                    if (alpha > 0) result.SetPixel(x, y, Color.FromArgb(alpha, 126, 202, 255));
                }
                origin = new Point(-(int)icon.HotspotX - glow, -(int)icon.HotspotY - glow);
                return result;
            }
        } finally {
            if (icon.Color != IntPtr.Zero) DeleteObject(icon.Color);
            if (icon.Mask != IntPtr.Zero) DeleteObject(icon.Mask);
        }
    }
    class CursorHighlight : Form {
        bool painted;
        IntPtr paintedCursor;
        Bitmap glowImage;
        Point glowOrigin;
        protected override bool ShowWithoutActivation { get { return true; } }
        protected override CreateParams CreateParams {
            get {
                var p = base.CreateParams;
                p.ExStyle |= 0x00080000 | 0x00000020 | 0x00000080 | 0x08000000;
                return p;
            }
        }
        public CursorHighlight() {
            FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true;
            StartPosition = FormStartPosition.Manual; Size = new Size(32, 32);
        }
        protected override void OnFormClosed(FormClosedEventArgs e) {
            if (glowImage != null) { glowImage.Dispose(); glowImage = null; }
            base.OnFormClosed(e);
        }
        public void FollowRealCursor() {
            if (GetForegroundWindow() != Target || !IsWindow(Target) || IsIconic(Target)) { Hide(); return; }
            RECT r;
            POINT pos;
            var info = new CURSORINFO { Size = Marshal.SizeOf(typeof(CURSORINFO)) };
            if (!GetWindowRect(Target, out r) || !GetCursorInfo(ref info) || (info.Flags & 1) == 0 ||
                !GetCursorPos(out pos) || pos.X < r.Left || pos.Y < r.Top || pos.X >= r.Right || pos.Y >= r.Bottom) {
                Hide(); return;
            }
            if (paintedCursor != info.Cursor || glowImage == null) {
                var next = MakeCursorGlow(info.Cursor, out glowOrigin);
                if (glowImage != null) glowImage.Dispose();
                glowImage = next; paintedCursor = info.Cursor; painted = false;
            }
            if (glowImage == null) { Hide(); return; }
            if (Size != glowImage.Size) Size = glowImage.Size;
            Point topLeft = new Point(pos.X + glowOrigin.X, pos.Y + glowOrigin.Y);
            if (Location != topLeft) Location = topLeft;
            if (!Visible) { Show(); painted = false; }
            if (!painted) {
                var glow = glowImage;
                    var bits = glow.LockBits(new Rectangle(0, 0, glow.Width, glow.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppPArgb);
                    IntPtr screen = IntPtr.Zero, memory = IntPtr.Zero, dib = IntPtr.Zero, previous = IntPtr.Zero;
                    try {
                        screen = GetDC(IntPtr.Zero); memory = CreateCompatibleDC(screen);
                        var bmi = new BITMAPINFO { Header = new BITMAPINFOHEADER {
                            Size = (uint)Marshal.SizeOf(typeof(BITMAPINFOHEADER)), Width = glow.Width,
                            Height = -glow.Height, Planes = 1, BitCount = 32
                        }};
                        IntPtr pixels;
                        dib = CreateDIBSection(screen, ref bmi, 0, out pixels, IntPtr.Zero, 0);
                        if (screen == IntPtr.Zero || memory == IntPtr.Zero || dib == IntPtr.Zero || pixels == IntPtr.Zero)
                            throw new InvalidOperationException("CU_CURSOR_GLOW_FAILED");
                        byte[] row = new byte[glow.Width * 4];
                        for (int y = 0; y < glow.Height; y++) {
                            Marshal.Copy(IntPtr.Add(bits.Scan0, y * bits.Stride), row, 0, row.Length);
                            Marshal.Copy(row, 0, IntPtr.Add(pixels, y * row.Length), row.Length);
                        }
                        previous = SelectObject(memory, dib);
                        var dst = new POINT { X = Left, Y = Top };
                        var src = new POINT();
                        var size = new SIZE { Width = glow.Width, Height = glow.Height };
                        var blend = new BLENDFUNCTION { SourceConstantAlpha = 255, AlphaFormat = 1 };
                        if (!UpdateLayeredWindow(Handle, screen, ref dst, ref size, memory, ref src, 0, ref blend, 2))
                            throw new InvalidOperationException("CU_CURSOR_GLOW_FAILED");
                        painted = true;
                    } finally {
                        if (previous != IntPtr.Zero && memory != IntPtr.Zero) SelectObject(memory, previous);
                        if (dib != IntPtr.Zero) DeleteObject(dib);
                        if (memory != IntPtr.Zero) DeleteDC(memory);
                        if (screen != IntPtr.Zero) ReleaseDC(IntPtr.Zero, screen);
                        glow.UnlockBits(bits);
                    }
            }
        }
    }
    // Native Windows equivalent of MacHUDSurface: no blocking focus, no
    // rectangular system shadow, no fake cursor, and a human-accessible STOP.
    class StopWindow : Form {
        protected override bool ShowWithoutActivation { get { return true; } }
        public bool HotkeyReady;
        public ControlOutline Outline;
        public CursorHighlight CursorHighlight;
        readonly Label sessionLabel;
        readonly Label currentLabel;
        readonly Label previousLabel;
        double orbit;
        public StopWindow() {
            Text = "ChatToHarness — Computer Use";
            Width = 530; Height = 140; TopMost = true;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false; StartPosition = FormStartPosition.Manual;
            BackColor = Color.FromArgb(9,17,31);
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer, true);
            var title = new Label {Text = "● ChatToHarness · Computer Use",
                ForeColor = Color.FromArgb(122,240,255),
                BackColor = BackColor, Font = new Font("Segoe UI",10,FontStyle.Bold),
                Location = new Point(18,13), Size = new Size(365,21),
                AutoEllipsis = true, Anchor=AnchorStyles.Top|AnchorStyles.Left|AnchorStyles.Right};
            sessionLabel = new Label {Text = "会话：名称未提供",
                ForeColor=Color.FromArgb(217,232,247), BackColor=BackColor,
                Font=new Font("Consolas",9),
                Location=new Point(18,39),Size=new Size(365,19),
                AutoEllipsis=true, Anchor=AnchorStyles.Top|AnchorStyles.Left|AnchorStyles.Right};
            currentLabel = new Label {Text = "当前：等待下一步操作",
                ForeColor=Color.White, BackColor=BackColor,
                Font=new Font("Segoe UI",10,FontStyle.Bold),
                Location=new Point(18,70),Size=new Size(365,22),
                AutoEllipsis=true, Anchor=AnchorStyles.Top|AnchorStyles.Left|AnchorStyles.Right};
            previousLabel = new Label {Text = "上一步：暂无",
                ForeColor=Color.FromArgb(217,232,247), BackColor=BackColor,
                Font=new Font("Segoe UI",9),
                Location=new Point(18,100),Size=new Size(365,20),
                AutoEllipsis=true, Anchor=AnchorStyles.Top|AnchorStyles.Left|AnchorStyles.Right};
            var stopButton = new Button {Text="STOP  ·  Esc", Location=new Point(398,48),
                Size=new Size(115,44), FlatStyle=FlatStyle.Flat,
                Font=new Font("Segoe UI",10,FontStyle.Bold),
                ForeColor=Color.White, BackColor=Color.FromArgb(232,48,64),
                Anchor=AnchorStyles.Right|AnchorStyles.Top, TabStop=false};
            stopButton.FlatAppearance.BorderSize=0;
            stopButton.Click += delegate { Close(); };
            Controls.Add(title); Controls.Add(sessionLabel); Controls.Add(currentLabel);
            Controls.Add(previousLabel); Controls.Add(stopButton);
            using (var shape=RoundedFrame(new Rectangle(0,0,Width,Height),14))
                Region=new Region(shape);
            FollowTargetDisplay();
        }
        static System.Drawing.Drawing2D.GraphicsPath RoundedFrame(Rectangle b,int r) {
            var p=new System.Drawing.Drawing2D.GraphicsPath();
            int d=2*r;
            p.AddArc(b.Left,b.Top,d,d,180,90);
            p.AddArc(b.Right-d,b.Top,d,d,270,90);
            p.AddArc(b.Right-d,b.Bottom-d,d,d,0,90);
            p.AddArc(b.Left,b.Bottom-d,d,d,90,90);
            p.CloseFigure();
            return p;
        }
        public void FollowTargetDisplay() {
            if (!IsWindow(Target)) return;
            Rectangle work=Screen.FromHandle(Target).WorkingArea;
            int width=Math.Min(530,Math.Max(280,work.Width-20));
            if (Width!=width) {
                Width=width;
                using (var shape=RoundedFrame(new Rectangle(0,0,Width,Height),14))
                    Region=new Region(shape);
            }
            var next=new Point(work.Left+(work.Width-width)/2,work.Top+10);
            // The topmost HUD must not become its own title-bar occluder.
            // Prefer the top edge, but park at the bottom if it overlaps the
            // draggable title bar of the authorized window. STOP remains clickable.
            RECT targetRect;
            if (GetWindowRect(Target,out targetRect)) {
                var titleBar=Rectangle.FromLTRB(targetRect.Left+72,targetRect.Top+8,
                    Math.Max(targetRect.Left+72,targetRect.Right-16),
                    Math.Min(targetRect.Bottom,targetRect.Top+50));
                var proposed=new Rectangle(next,new Size(width,Height));
                if (proposed.IntersectsWith(titleBar))
                    next=new Point(next.X,work.Bottom-Height-10);
            }
            if (Location!=next) Location=next;
            // Advance the cyan perimeter orbit once per 40ms UI tick.
            orbit=(orbit+40.0/3500.0)%1.0;
            Invalidate();
        }
        static string ActionLabel(string action) {
            switch(action) {
                case "observe": return "截取窗口截图";
                case "activate": return "激活目标窗口";
                case "mouse_move": return "移动鼠标";
                case "mouse_down": return "按住鼠标";
                case "mouse_drag": return "拖动鼠标";
                case "drag_window": return "拖动窗口";
                case "mouse_up": return "松开鼠标";
                case "click": return "点击鼠标";
                case "scroll": return "滚动";
                case "type_text": return "输入文字";
                case "key_press": return "发送按键";
                default: return "等待下一步操作";
            }
        }
        public void SetActivity(string action) {
            currentLabel.Text=action=="idle" ? "当前：等待下一步操作" :
                "当前：正在"+ActionLabel(action);
        }
        public void CompleteActivity(string action,string error) {
            previousLabel.Text="上一步："+ActionLabel(action)+" · "+
                (error==null ? "完成" : "失败")+" · "+DateTime.Now.ToString("HH:mm");
            previousLabel.Tag=error;
            SetActivity("idle");
        }
        public void SetSessionTitle(string title) {
            sessionLabel.Text="会话："+title;
            sessionLabel.Tag=title;
        }
        protected override void OnPaint(PaintEventArgs e) {
            base.OnPaint(e);
            e.Graphics.SmoothingMode=System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using(var shape=RoundedFrame(new Rectangle(3,3,Width-7,Height-7),11)) {
                float perimeter=2f*(Width+Height-4*11)+2f*(float)Math.PI*11;
                using(var basePen=new Pen(Color.FromArgb(190,44,197,243),2.5f))
                    e.Graphics.DrawPath(basePen,shape);
                using(var trail=new Pen(Color.FromArgb(138,32,205,255),5.5f)) {
                    trail.DashStyle=System.Drawing.Drawing2D.DashStyle.Custom;
                    trail.DashPattern=new float[]{Math.Min(155,perimeter*0.19f)/trail.Width,
                        (perimeter-Math.Min(155,perimeter*0.19f))/trail.Width};
                    trail.DashOffset=-(float)(orbit*perimeter/trail.Width);
                    e.Graphics.DrawPath(trail,shape);
                }
                using(var head=new Pen(Color.FromArgb(255,170,255,255),3.8f)) {
                    head.DashStyle=System.Drawing.Drawing2D.DashStyle.Custom;
                    head.DashPattern=new float[]{Math.Min(64,perimeter*0.08f)/head.Width,
                        (perimeter-Math.Min(64,perimeter*0.08f))/head.Width};
                    head.DashOffset=-(float)(orbit*perimeter/head.Width);
                    e.Graphics.DrawPath(head,shape);
                }
            }
        }
        protected override void OnHandleCreated(EventArgs e) {
            base.OnHandleCreated(e);
            HotkeyReady = RegisterHotKey(Handle,1,0,0x1B);
        }
        protected override void OnShown(EventArgs e) { base.OnShown(e); ShowWindow(Handle,4); }
        protected override void WndProc(ref Message m) {
            if(m.Msg==0x312) {Close(); return;}
            base.WndProc(ref m);
        }
        protected override void OnFormClosed(FormClosedEventArgs e) {
            ComputerUse.Closed=true;
            ComputerUse.ReleaseHeldMouse();
            if(Outline!=null) {Outline.Close();Outline.Dispose();Outline=null;}
            if(CursorHighlight!=null) {CursorHighlight.Close();CursorHighlight.Dispose();CursorHighlight=null;}
            UnregisterHotKey(Handle,1);
            base.OnFormClosed(e); Environment.Exit(0);
        }
    }
    static IntPtr Consent(IntPtr requested) {
        using (var dialog = new Form { Text = "ChatToHarness — Allow window control / 允许窗口控制", Width = 740, Height = 440, StartPosition = FormStartPosition.CenterScreen }) {
            var label = new Label { Dock = DockStyle.Top, Height = 100, Text = "Choose ONE window to allow screenshots, clicks and typing for up to 10 minutes.\n仅选择一个窗口，授权截图、点击和输入，最长 10 分钟。\nGUI operations can access files/network through this app; project folders do not sandbox them.\n窗口授权不是文件或网络沙箱。按 Esc 或 STOP 可立即停止控制。" };
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
    static void Inject(INPUT[] inputs, bool allowHeld = false) {
        Check(true);
        // Do not merge automation with a user's held modifiers or mouse buttons.
        foreach (int key in new int[] { 0x10, 0x11, 0x12, 0x5B, 0x5C, 1, 2 }) if ((key != 1 || !allowHeld) && (GetAsyncKeyState(key) & 0x8000) != 0) Error("CU_USER_INPUT_ACTIVE");
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
    static void DrawVisibleCursor(Graphics graphics, RECT r) {
        var info = new CURSORINFO { Size = Marshal.SizeOf(typeof(CURSORINFO)) };
        if (!GetCursorInfo(ref info) || (info.Flags & 1) == 0 || info.Cursor == IntPtr.Zero) return;
        if (info.Position.X < r.Left || info.Position.X >= r.Right ||
            info.Position.Y < r.Top || info.Position.Y >= r.Bottom) return;
        ICONINFO icon;
        if (!GetIconInfo(info.Cursor, out icon)) return;
        try {
            Point glowOrigin;
            using (var glow = MakeCursorGlow(info.Cursor, out glowOrigin)) {
                if (glow != null)
                    graphics.DrawImage(glow, info.Position.X - r.Left + glowOrigin.X, info.Position.Y - r.Top + glowOrigin.Y);
            }
            // Draw the actual Windows cursor with its hotspot at its physical screen coordinates.
            IntPtr dc = graphics.GetHdc();
            try { DrawIconEx(dc, info.Position.X - r.Left - (int)icon.HotspotX,
                info.Position.Y - r.Top - (int)icon.HotspotY, info.Cursor, 0, 0, 0, IntPtr.Zero, 3); }
            finally { graphics.ReleaseHdc(dc); }
        } finally {
            if (icon.Mask != IntPtr.Zero) DeleteObject(icon.Mask);
            if (icon.Color != IntPtr.Zero) DeleteObject(icon.Color);
        }
    }
    static object Capture(RECT r) {
        using (var bitmap = new Bitmap(r.Right - r.Left, r.Bottom - r.Top)) {
            using (var graphics = Graphics.FromImage(bitmap)) {
                IntPtr dc = graphics.GetHdc(); bool success;
                try { success = PrintWindow(Target, dc, 2); } finally { graphics.ReleaseHdc(dc); }
                if (!success) Error("CU_CAPTURE_UNSUPPORTED");
                // PrintWindow omits the OS cursor; composite the real cursor for visual review.
                DrawVisibleCursor(graphics, r);
            }
            using (var stream = new MemoryStream()) {
                bitmap.Save(stream, ImageFormat.Png);
                if (stream.Length > 40 * 1024 * 1024) Error("CU_CAPTURE_TOO_LARGE");
                RECT after = Check(false);
                if (after.Left != r.Left || after.Top != r.Top || after.Right != r.Right || after.Bottom != r.Bottom) Error("CU_WINDOW_MOVED");
                var displays = new List<object>();
                foreach (var screen in Screen.AllScreens)
                    displays.Add(new { x = screen.Bounds.Left, y = screen.Bounds.Top,
                                       width = screen.Bounds.Width, height = screen.Bounds.Height });
                return new { width = bitmap.Width, height = bitmap.Height, geometry = new int[] {r.Left, r.Top, r.Right, r.Bottom},
                             displays = displays, png = Convert.ToBase64String(stream.ToArray()) };
            }
        }
    }
    // A route between physical monitor rectangles avoids OS pointer clamping
    // in the empty coordinate gaps of non-rectangular multi-monitor layouts.
    static bool CursorScreenContains(Rectangle r, Point p) {
        return p.X >= r.Left - 1 && p.X <= r.Right + 1 &&
               p.Y >= r.Top - 1 && p.Y <= r.Bottom + 1;
    }
    static bool CursorScreenBridge(Rectangle a, Rectangle b, Point destination,
                                   out PointF before, out PointF after) {
        before = after = new PointF();
        int x0 = Math.Max(a.Left, b.Left), x1 = Math.Min(a.Right, b.Right);
        int y0 = Math.Max(a.Top, b.Top), y1 = Math.Min(a.Bottom, b.Bottom);
        if (x1 - x0 >= 6) {
            float x = Math.Max(x0 + 3, Math.Min(x1 - 3, destination.X));
            if (a.Bottom == b.Top) {
                before = new PointF(x, a.Bottom - 2); after = new PointF(x, b.Top + 2); return true;
            }
            if (a.Top == b.Bottom) {
                before = new PointF(x, a.Top + 2); after = new PointF(x, b.Bottom - 2); return true;
            }
        }
        if (y1 - y0 >= 6) {
            float y = Math.Max(y0 + 3, Math.Min(y1 - 3, destination.Y));
            if (a.Right == b.Left) {
                before = new PointF(a.Right - 2, y); after = new PointF(b.Left + 2, y); return true;
            }
            if (a.Left == b.Right) {
                before = new PointF(a.Left + 2, y); after = new PointF(b.Right - 2, y); return true;
            }
        }
        if (x1 - x0 >= 6 && y1 - y0 >= 6) {
            float x = Math.Max(x0 + 3, Math.Min(x1 - 3, destination.X));
            float y = Math.Max(y0 + 3, Math.Min(y1 - 3, destination.Y));
            before = after = new PointF(x, y);
            return true;
        }
        return false;
    }
    static List<PointF> CursorScreenRoute(Point start, Point destination, out Rectangle? sameScreen) {
        Rectangle[] screens = new List<Rectangle>(Array.ConvertAll(Screen.AllScreens, screen => screen.Bounds)).ToArray();
        int source = -1, target = -1;
        for (int i = 0; i < screens.Length; ++i) {
            if (source < 0 && CursorScreenContains(screens[i], start)) source = i;
            if (target < 0 && CursorScreenContains(screens[i], destination)) target = i;
        }
        if (source < 0 || target < 0) Error("CU_INPUT_FAILED");
        sameScreen = source == target ? (Rectangle?)screens[source] : null;
        var points = new List<PointF> { new PointF(start.X, start.Y) };
        if (source != target) {
            int[] previous = new int[screens.Length];
            for (int i = 0; i < previous.Length; ++i) previous[i] = -1;
            var queue = new Queue<int>();
            previous[source] = source;
            queue.Enqueue(source);
            while (queue.Count > 0 && previous[target] < 0) {
                int i = queue.Dequeue();
                for (int j = 0; j < screens.Length; ++j) {
                    PointF before, after;
                    if (previous[j] < 0 && CursorScreenBridge(screens[i], screens[j], destination,
                                                              out before, out after)) {
                        previous[j] = i;
                        queue.Enqueue(j);
                    }
                }
            }
            if (previous[target] < 0) Error("CU_INPUT_FAILED");
            var order = new List<int> { target };
            while (order[order.Count - 1] != source)
                order.Add(previous[order[order.Count - 1]]);
            order.Reverse();
            for (int i = 0; i + 1 < order.Count; ++i) {
                PointF before, after;
                if (!CursorScreenBridge(screens[order[i]], screens[order[i+1]], destination,
                                        out before, out after)) Error("CU_INPUT_FAILED");
                points.Add(before); points.Add(after);
            }
        }
        points.Add(new PointF(destination.X, destination.Y));
        return points;
    }
    static double CursorRouteLength(List<PointF> path) {
        double total = 0;
        for (int i = 1; i < path.Count; ++i) {
            double dx = path[i].X - path[i-1].X, dy = path[i].Y - path[i-1].Y;
            total += Math.Sqrt(dx * dx + dy * dy);
        }
        return total;
    }
    static PointF CursorRoutePoint(List<PointF> path, double fraction, Rectangle? sameScreen) {
        if (fraction <= 0) return path[0];
        if (fraction >= 1) return path[path.Count - 1];
        double remaining = CursorRouteLength(path) * fraction;
        for (int i = 1; i < path.Count; ++i) {
            double dx = path[i].X - path[i-1].X, dy = path[i].Y - path[i-1].Y;
            double segment = Math.Sqrt(dx * dx + dy * dy);
            if (segment > 0 && remaining <= segment) {
                double t = remaining / segment;
                double x = path[i-1].X + dx * t, y = path[i-1].Y + dy * t;
                if (path.Count == 2 && sameScreen.HasValue) {
                    var safe = sameScreen.Value;
                    safe.Inflate(-25, -25);
                    if (safe.Contains(Point.Round(path[0])) && safe.Contains(Point.Round(path[1]))) {
                        double bend = Math.Min(18.0, segment * 0.035);
                        double offset = 4.0 * t * (1.0 - t) * bend * (dx >= 0 ? 1.0 : -1.0);
                        x += (-dy / segment) * offset;
                        y += (dx / segment) * offset;
                    }
                }
                return new PointF((float)x, (float)y);
            }
            remaining -= segment;
        }
        return path[path.Count - 1];
    }

    // Human-paced motion of the REAL OS pointer. A monotonic clock (not a
    // fixed 32-frame cap) sets duration; 60 Hz gives the glow time to follow.
    static void MoveCursorVisible(Point destination) { MoveCursorVisibleDuringDrag(destination, false); }
    static void MoveCursorVisibleDuringDrag(Point destination, bool dragging) {
        POINT origin;
        if (!GetCursorPos(out origin)) Error("CU_INPUT_FAILED");
        Rectangle? sameScreen;
        var path = CursorScreenRoute(new Point(origin.X, origin.Y), destination, out sameScreen);
        double distance = CursorRouteLength(path);
        double durationMs = Math.Min(3600.0, Math.Max(240.0, 170.0 + distance * 1000.0 / 850.0));
        int lastX = origin.X, lastY = origin.Y;
        var clock = System.Diagnostics.Stopwatch.StartNew();
        while (true) {
            Check(true);
            if (Closed) Error("CU_SESSION_CLOSED");
            foreach (int key in new int[] { 0x10, 0x11, 0x12, 0x5B, 0x5C, 1, 2 })
                if ((key != 1 || !dragging) && (GetAsyncKeyState(key) & 0x8000) != 0) Error("CU_USER_INPUT_ACTIVE");
            POINT current;
            if (!GetCursorPos(out current)) Error("CU_INPUT_FAILED");
            if (Math.Abs(current.X - lastX) > 6 || Math.Abs(current.Y - lastY) > 6)
                Error("CU_USER_INPUT_ACTIVE");

            double t = Math.Min(1.0, Math.Max(0.0, clock.Elapsed.TotalMilliseconds / durationMs));
            double eased = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
            PointF next = CursorRoutePoint(path, eased, sameScreen);
            int px = (int)Math.Round(next.X), py = (int)Math.Round(next.Y);
            if (!SetCursorPos(px, py)) Error("CU_INPUT_FAILED");
            lastX = px; lastY = py;
            if (t >= 1.0) break;
            Thread.Sleep(16);
        }
    }
    static object Execute(Dictionary<string, object> args) {
        string action = (string)args["action"];
        if (action == "mouse_up") {
            if (!LeftHeld) Error("CU_MOUSE_NOT_HELD");
            ReleaseHeldMouse();
            return new { ok = true };
        }
        if (LeftHeld && action != "mouse_drag" && action != "observe") Error("CU_MOUSE_BUTTON_HELD");
        if (action == "mouse_drag" && !LeftHeld) Error("CU_MOUSE_NOT_HELD");
        if (action == "activate") return ActivateTarget();
        RECT rect = Check(action != "observe");
        if (action == "observe") return Capture(rect);
        var geometry = args["geometry"] as ArrayList;
        if (geometry == null || geometry.Count != 4 || Convert.ToInt32(geometry[0]) != rect.Left || Convert.ToInt32(geometry[1]) != rect.Top || Convert.ToInt32(geometry[2]) != rect.Right || Convert.ToInt32(geometry[3]) != rect.Bottom) Error("CU_WINDOW_MOVED");
        if (action == "drag_window") return DragWindowAtomic(args,rect);
        if (action == "mouse_drag") {
            int x = Number(args, "screen_x"), y = Number(args, "screen_y");
            var destination = new Point(x, y);
            bool within = false;
            foreach (var screen in Screen.AllScreens) if (screen.Bounds.Contains(destination)) within = true;
            if (!within) Error("CU_COORDINATE_OUTSIDE_DISPLAY");
            MoveCursorVisibleDuringDrag(destination, true);
            HeldSince = DateTime.UtcNow;
        } else if (action == "click" || action == "scroll" || action == "mouse_move" || action == "mouse_down") {
            int x = Number(args, "x"), y = Number(args, "y");
            if (x < 0 || y < 0 || x >= rect.Right - rect.Left || y >= rect.Bottom - rect.Top) Error("CU_COORDINATE_OUTSIDE_WINDOW");
            var point = new Point(rect.Left + x, rect.Top + y);
            RequireUnoccluded(point);
            MoveCursorVisible(point);
            RequireUnoccluded(point);
            if (action == "mouse_down") {
                Inject(new INPUT[] { new INPUT { data = new UNION { mouse = new MOUSEINPUT { dwFlags = 2u } } } });
                LeftHeld = true;
                HeldSince = DateTime.UtcNow;
            } else if (action == "click") {
                bool right = args.ContainsKey("button") && (string)args["button"] == "right";
                Inject(new INPUT[] { new INPUT { data = new UNION { mouse = new MOUSEINPUT { dwFlags = right ? 8u : 2u } } }, new INPUT { data = new UNION { mouse = new MOUSEINPUT { dwFlags = right ? 16u : 4u } } } });
            } else if (action == "scroll") {
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
            var keys = new Dictionary<string, ushort> { {"ENTER",13},{"TAB",9},{"BACKSPACE",8},{"DELETE",46},{"LEFT",37},{"RIGHT",39},{"UP",38},{"DOWN",40},{"HOME",36},{"END",35},{"PAGEUP",33},{"PAGEDOWN",34} };
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
                    string action = (string)args["action"];
                    if (action == "set_session_title") {
                        string name = args.ContainsKey("title") ? args["title"] as string : null;
                        if (name == null || name.Trim().Length == 0 || name.Length > 80)
                            Error("CU_INVALID_ARGUMENT");
                        foreach (char ch in name) if (char.IsControl(ch)) Error("CU_INVALID_ARGUMENT");
                        Stop.BeginInvoke(new Action(() => Stop.SetSessionTitle(name.Trim())));
                        Write(new {ok=true});
                        continue;
                    }
                    LastOcclusion = null;
                    SetHudAction(action);
                    try {
                        Write(Execute(args));
                        Stop.BeginInvoke(new Action(() => Stop.CompleteActivity(action,null)));
                    } catch (Exception e) {
                        SetHudAction("idle");
                        Stop.BeginInvoke(new Action(() => Stop.CompleteActivity(action,e.Message)));
                        throw;
                    }
                } catch (Exception e) {
                    ReleaseHeldMouse();
                    if (e.Message == "CU_TARGET_OCCLUDED" && LastOcclusion != null)
                        Write(new { error=e.Message, occlusion=LastOcclusion });
                    else Write(new { error = e.Message.StartsWith("CU_") ? e.Message : "CU_NATIVE_ERROR" });
                }
            }
        } finally { ReleaseHeldMouse(); Environment.Exit(0); }
    }
    [STAThread] static void Main(string[] args) {
        Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
        try {
            // Exit even if the MCP owner dies while the consent picker is open.
            if (args.Length < 1 || args.Length > 4) Error("CU_OWNER_REQUIRED");
            var owner = Process.GetProcessById(int.Parse(args[0]));
            var watchdog = new Thread(delegate() { owner.WaitForExit(); ReleaseHeldMouse(); Environment.Exit(0); }) { IsBackground = true }; watchdog.Start();
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
            Stop.Outline = new ControlOutline(); Stop.Outline.FollowTarget();
            Stop.CursorHighlight = new CursorHighlight();
            if (!Stop.HotkeyReady) Error("CU_STOP_HOTKEY_UNAVAILABLE");
            SetForegroundWindow(Target);
            var timer = new System.Windows.Forms.Timer { Interval = 40 };
            timer.Tick += delegate {
                if (DateTime.UtcNow > Deadline || !IsWindow(Target)) { Stop.Close(); return; }
                if (LeftHeld && (DateTime.UtcNow - HeldSince).TotalSeconds > 30) ReleaseHeldMouse();
                Stop.FollowTargetDisplay();
                if (Stop.Outline != null) Stop.Outline.FollowTarget();
                if (Stop.CursorHighlight != null) Stop.CursorHighlight.FollowRealCursor();
            }; timer.Start();
            Write(new { ready = true, window_id=Target.ToInt64().ToString() });
            var thread = new Thread(ReadCommands) { IsBackground = true }; thread.Start();
            Application.Run(Stop);
        } catch (Exception e) { Write(new { error = e.Message.StartsWith("CU_") ? e.Message : "CU_NATIVE_ERROR" }); }
    }
}
