// Test-only executable: reflection binds the native implementation exclusively to
// a window created by this fixture. The production consent path has no bypass.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;
class ComputerUseWindowFixture {
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Reserved1,Peb,Reserved2a,Reserved2b,Pid,Parent; }
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left,Top,Right,Bottom; }
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process,int kind,out ProcessInfo info,int size,out int length);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out Rect rect);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
    [DllImport("user32.dll")] static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h,uint flags);
    delegate bool EnumProc(IntPtr h, IntPtr state);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr state);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc callback, IntPtr state);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder value, int max);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder value, int max);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, uint message, IntPtr w, StringBuilder text);
    static Type Native;
    static void Set(string name, object value) { Native.GetField(name, BindingFlags.Static | BindingFlags.NonPublic).SetValue(null, value); }
    static object Execute(Dictionary<string,object> args) {
        try { return Native.GetMethod("Execute", BindingFlags.Static | BindingFlags.NonPublic).Invoke(null, new object[] {args}); }
        catch(TargetInvocationException e) { throw e.InnerException; }
    }
    static object Property(object value, string name) { return value.GetType().GetProperty(name).GetValue(value, null); }
    static void Pump() { for(int i=0;i<15;i++) { Application.DoEvents(); Thread.Sleep(20); } }
    static void FocusFixture(Form form) {
        form.TopMost=true; ShowWindow(form.Handle,5); form.Activate(); SetForegroundWindow(form.Handle); Pump();
        if(GetForegroundWindow()!=form.Handle) {
            // OS foreground rules sometimes reject background test activation.
            // A real click is permitted only on this disposable fixture's own
            // visible client area; never click another application's window.
            var point=form.PointToScreen(new Point(10,10));
            if(GetAncestor(WindowFromPoint(point),2)==form.Handle && SetCursorPos(point.X,point.Y))mouse_event(6,0,0,0,UIntPtr.Zero);
            Pump();
        }
        form.TopMost=false;
    }
    static IntPtr FindWindow(int pid, string title) {
        IntPtr result=IntPtr.Zero;
        EnumWindows(delegate(IntPtr h,IntPtr unused) { uint owner; GetWindowThreadProcessId(h,out owner); var text=new StringBuilder(1024); GetWindowText(h,text,text.Capacity); if(owner==pid && text.ToString()==title)result=h; return true; },IntPtr.Zero);
        return result;
    }
    static IntPtr Child(IntPtr parent,string name) {
        IntPtr result=IntPtr.Zero;
        EnumChildWindows(parent,delegate(IntPtr h,IntPtr unused) { var text=new StringBuilder(256); GetClassName(h,text,text.Capacity); if(text.ToString().StartsWith("WindowsForms10."+name+"."))result=h; return true; },IntPtr.Zero);
        return result;
    }
    static void ProductionLifecycle(string helper,Form target,bool hotkey) {
        using(var child=Process.Start(new ProcessStartInfo(helper,Process.GetCurrentProcess().Id.ToString()) { UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,StandardOutputEncoding=new UTF8Encoding(false) })) {
            try {
                IntPtr picker=IntPtr.Zero; var end=DateTime.UtcNow.AddSeconds(8);
                while(picker==IntPtr.Zero && DateTime.UtcNow<end) { Pump(); picker=FindWindow(child.Id,"ChatToHarness — Allow window control / 允许窗口控制"); }
                if(picker==IntPtr.Zero) throw new Exception("Production picker did not appear");
                var list=Child(picker,"LISTBOX"); var button=Child(picker,"BUTTON"); if(list==IntPtr.Zero||button==IntPtr.Zero)throw new Exception("Production consent controls missing");
                int count=SendMessage(list,0x18B,IntPtr.Zero,IntPtr.Zero).ToInt32(),selected=-1;
                for(int i=0;i<count && i<1000;i++) { var text=new StringBuilder(2048); SendMessage(list,0x189,new IntPtr(i),text); if(text.ToString()==target.Text+" [PID "+Process.GetCurrentProcess().Id+"]")selected=i; }
                if(selected<0)throw new Exception("Fixture not found in production picker");
                SendMessage(list,0x186,new IntPtr(selected),IntPtr.Zero); SendMessage(button,0xF5,IntPtr.Zero,IntPtr.Zero);
                var ready=child.StandardOutput.ReadLineAsync(); end=DateTime.UtcNow.AddSeconds(8);
                while(!ready.IsCompleted && DateTime.UtcNow<end)Pump();
                if(!ready.IsCompleted || ready.Result==null || !ready.Result.Contains("\"ready\":true"))throw new Exception("Production consent did not establish session");
                if(hotkey) {
                    FocusFixture(target);
                    var inputType=Native.GetNestedType("INPUT",BindingFlags.NonPublic); var batch=Array.CreateInstance(inputType,6);
                    var key=Native.GetMethod("Key",BindingFlags.Static|BindingFlags.NonPublic);
                    ushort[] codes={17,18,123,123,18,17};
                    for(int i=0;i<6;i++)batch.SetValue(key.Invoke(null,new object[]{codes[i],(ushort)0,i<3?0u:2u}),i);
                    Native.GetMethod("Inject",BindingFlags.Static|BindingFlags.NonPublic).Invoke(null,new object[]{batch});
                } else {
                    IntPtr stop=FindWindow(child.Id,"ChatToHarness — Computer Use"); var stopButton=Child(stop,"BUTTON"); if(stopButton==IntPtr.Zero)throw new Exception("Production STOP control missing");
                    SendMessage(stopButton,0xF5,IntPtr.Zero,IntPtr.Zero);
                }
                end=DateTime.UtcNow.AddSeconds(5); while(!child.HasExited && DateTime.UtcNow<end)Pump();
                if(!child.HasExited)throw new Exception("Production emergency stop did not exit helper");
            } finally { if(!child.HasExited)child.Kill(); }
        }
    }
    static Dictionary<string,object> Action(string action, int[] geometry) { return new Dictionary<string,object> { {"action",action}, {"geometry",new ArrayList(geometry)} }; }
    static void AuthorizeFixture(int serverPid,Form target) {
        var end=DateTime.UtcNow.AddSeconds(8); IntPtr picker=IntPtr.Zero;
        while(picker==IntPtr.Zero && DateTime.UtcNow<end) {
            EnumWindows(delegate(IntPtr h,IntPtr unused) {
                var text=new StringBuilder(256); GetWindowText(h,text,text.Capacity);
                if(text.ToString()!="ChatToHarness — Allow window control / 允许窗口控制")return true;
                uint pid; GetWindowThreadProcessId(h,out pid);
                using(var process=Process.GetProcessById((int)pid)) { ProcessInfo info; int length;
                    if(NtQueryInformationProcess(process.Handle,0,out info,Marshal.SizeOf(typeof(ProcessInfo)),out length)==0) {
                        bool owned=info.Parent.ToInt32()==serverPid;
                        if(!owned)using(var parent=Process.GetProcessById(info.Parent.ToInt32())) { ProcessInfo parentInfo;
                            owned=NtQueryInformationProcess(parent.Handle,0,out parentInfo,Marshal.SizeOf(typeof(ProcessInfo)),out length)==0 && parentInfo.Parent.ToInt32()==serverPid;
                        }
                        if(owned)picker=h;
                    }
                }
                return true;
            },IntPtr.Zero); Pump();
        }
        if(picker==IntPtr.Zero)throw new Exception("Owned MCP consent picker missing");
        var list=Child(picker,"LISTBOX"); var button=Child(picker,"BUTTON");
        if(list==IntPtr.Zero || button==IntPtr.Zero)throw new Exception("Owned picker controls missing");
        int count=SendMessage(list,0x18B,IntPtr.Zero,IntPtr.Zero).ToInt32(),selected=-1;
        for(int i=0;i<count && i<1000;i++) { var text=new StringBuilder(2048); SendMessage(list,0x189,new IntPtr(i),text); if(text.ToString()==target.Text+" [PID "+Process.GetCurrentProcess().Id+"]")selected=i; }
        if(selected<0)throw new Exception("Only the disposable fixture may be authorized");
        SendMessage(list,0x186,new IntPtr(selected),IntPtr.Zero); SendMessage(button,0xF5,IntPtr.Zero,IntPtr.Zero);
    }
    static int FixtureServer() {
        Console.InputEncoding=new UTF8Encoding(false); Console.OutputEncoding=new UTF8Encoding(false);
        SetProcessDpiAwarenessContext(new IntPtr(-4)); Application.EnableVisualStyles();
        var json=new JavaScriptSerializer();
        using(var form=new Form { Text="ChatToHarness MCP session recovery fixture",Width=620,Height=320,StartPosition=FormStartPosition.CenterScreen }) {
            var distractor=new Form {Text="ChatToHarness disposable focus distractor",Width=400,Height=200,StartPosition=FormStartPosition.Manual,Left=100,Top=150};
            var distractorInput=new RichTextBox {Dock=DockStyle.Fill}; distractor.Controls.Add(distractorInput);
            form.FormClosed+=delegate {distractor.Dispose();};
            var input=new RichTextBox {Left=30,Top=30,Width=500,Height=100};
            form.Controls.Add(input); form.Show(); FocusFixture(form);
            Console.WriteLine("{\"ready\":true}"); Console.Out.Flush();
            var thread=new Thread(delegate() {
                string line; while((line=Console.ReadLine())!=null) {
                    var command=json.Deserialize<Dictionary<string,object>>(line);
                    form.Invoke(new System.Action(delegate() {
                        try {
                            string action=(string)command["action"];
                            if(action=="authorize")AuthorizeFixture(Convert.ToInt32(command["server_pid"]),form);
                            if(action=="focus")FocusFixture(form);
                            if(action=="defocus") { distractor.Show(); FocusFixture(distractor); distractorInput.Focus(); }
                            if(action=="minimize") { form.WindowState=FormWindowState.Minimized; Pump(); }
                            if(action=="noise") {
                                form.MaximumSize=new Size(4096,4096);form.Size=new Size(2000,1500);
                                var bitmap=new Bitmap(2000,1500,System.Drawing.Imaging.PixelFormat.Format24bppRgb);
                                var data=bitmap.LockBits(new Rectangle(0,0,bitmap.Width,bitmap.Height),System.Drawing.Imaging.ImageLockMode.WriteOnly,bitmap.PixelFormat);
                                try {var bytes=new byte[data.Stride*bitmap.Height];new Random(314159).NextBytes(bytes);Marshal.Copy(bytes,0,data.Scan0,bytes.Length);} finally {bitmap.UnlockBits(data);}
                                var panel=new Panel {Dock=DockStyle.Fill,BackgroundImage=bitmap}; form.Controls.Add(panel);panel.BringToFront();
                                panel.Disposed+=delegate {bitmap.Dispose();}; Pump();
                            }
                            Rect rect; GetWindowRect(form.Handle,out rect); var point=input.PointToScreen(new Point(50,20));
                            Console.WriteLine(json.Serialize(new {ok=true,window_id=form.Handle.ToInt64().ToString(),text=input.Text,x=point.X-rect.Left,y=point.Y-rect.Top,foreground=GetForegroundWindow()==form.Handle,minimized=form.WindowState==FormWindowState.Minimized,distractor_text=distractorInput.Text})); Console.Out.Flush();
                        } catch(Exception e) { Console.WriteLine(json.Serialize(new {error=e.Message})); Console.Out.Flush(); }
                    }));
                }
                form.BeginInvoke(new System.Action(delegate {form.Close();}));
            }) {IsBackground=true}; thread.Start(); Application.Run(form);
        }
        return 0;
    }
    static void ExpectError(Dictionary<string,object> args, string code) {
        try { Execute(args); throw new Exception("Expected " + code); } catch(InvalidOperationException e) { if(e.Message != code) throw; }
    }
    [STAThread] static int Main(string[] args) {
        try {
            if(args.Length==1 && args[0]=="--server")return FixtureServer();
            Native = Assembly.LoadFrom(args[0]).GetType("ComputerUse");
            using(var form = new Form { Text="ChatToHarness isolated computer-use acceptance", Width=620, Height=320, StartPosition=FormStartPosition.CenterScreen }) {
                var input = new RichTextBox { Left=30, Top=30, Width=500, Height=100, Multiline=true };
                var button = new Button { Left=30, Top=170, Width=200, Text="Fixture click target" };
                bool clicked=false; button.Click += delegate { clicked=true; };
                form.Controls.Add(input); form.Controls.Add(button); form.Show(); FocusFixture(form);
                Set("Target",form.Handle); Set("TargetPid",(uint)Process.GetCurrentProcess().Id); Set("TargetStarted",Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks);
                var capture=Execute(new Dictionary<string,object>{{"action","observe"}});
                var geometry=(int[])Property(capture,"geometry");
                var png=Convert.FromBase64String((string)Property(capture,"png"));
                if(png.Length<100 || png[0]!=137 || png[1]!=80) throw new Exception("Missing native PNG");
                if(GetForegroundWindow()!=form.Handle) {
                    var denied=Action("type_text",geometry); denied["text"]="fixture only"; ExpectError(denied,"CU_WINDOW_NOT_FOREGROUND");
                    Console.WriteLine("NATIVE_ACCEPTANCE_PARTIAL: native PNG and foreground input rejection passed; OS denied fixture foreground, actual input acceptance unavailable"); return 2;
                }
                input.Focus(); Pump();
                var text=Action("type_text",geometry); text["text"]="中文 sample {ENTER}"; Execute(text); Pump();
                if(input.Text!="中文 sample {ENTER}") throw new Exception("Unicode literal input mismatch");
                var key=Action("key_press",geometry); key["key"]="CTRL+A"; Execute(key); Pump(); key["key"]="BACKSPACE"; Execute(key); Pump();
                if(input.Text!="") throw new Exception("Keyboard editing mismatch");
                Point point=button.PointToScreen(new Point(50,12));
                var click=Action("click",geometry); click["x"]=point.X-geometry[0]; click["y"]=point.Y-geometry[1]; Execute(click); Pump();
                if(!clicked) throw new Exception("Click did not reach fixture button");
                point=input.PointToScreen(new Point(50,12));
                var scroll=Action("scroll",geometry); scroll["x"]=point.X-geometry[0]; scroll["y"]=point.Y-geometry[1]; scroll["delta"]=-1; Execute(scroll); Pump();
                form.Left+=20; Pump(); ExpectError(click,"CU_WINDOW_MOVED");
                using(var other=new Form { Text="Fixture focus rejection",Width=200,Height=100 }) { other.Show(); other.Activate(); SetForegroundWindow(other.Handle); Pump(); ExpectError(text,"CU_WINDOW_NOT_FOREGROUND"); }
                ProductionLifecycle(args[0],form,false);
                ProductionLifecycle(args[0],form,true);
                Console.WriteLine("NATIVE_ACCEPTANCE_PASS: PNG, Unicode literal input, Ctrl+A/Backspace, button click, wheel submission, geometry rejection, foreground rejection, production consent picker, STOP button, Ctrl+Alt+F12");
            }
            return 0;
        } catch(Exception e) { Console.Error.WriteLine(e.ToString()); return 1; }
    }
}
