using System;
using System.IO;
using System.Threading;
using System.Web.Script.Serialization;
using System.Collections.Generic;

class ComputerUsePointerDiagnosticsFixture {
    static void Require(bool value,string message) {if(!value)throw new Exception(message);}
    static int Main(string[] args) {
        try {
            string folder=Path.Combine(args[0],"rotation");
            using(var first=new ComputerUse.PointerDiagnostics(folder,4096))
            using(var second=new ComputerUse.PointerDiagnostics(folder,4096)) {
                for(int i=0;i<150;i++) {
                    first.Record("move_step",new {frame=i,planned_x=i,actual_x=i});
                    second.Record("pointer_frame",new {x=i,outside_target=true});
                }
            }
            var json=new JavaScriptSerializer();int count=0;
            foreach(string file in Directory.GetFiles(folder)) {
                Require(new FileInfo(file).Length<=4096,"Rotation exceeded per-file byte limit");
                foreach(string line in File.ReadAllLines(file)) {
                    var entry=json.Deserialize<Dictionary<string,object>>(line);
                    Require(entry.ContainsKey("record"),"Concurrent writes produced malformed record");count++;
                }
            }
            Require(count>0,"No diagnostic records persisted");
            Require(Directory.GetFiles(folder).Length==2,"Rotation did not retain exactly current and previous files");
            string blocked=Path.Combine(args[0],"blocked");File.WriteAllText(blocked,"file");
            using(var failure=new ComputerUse.PointerDiagnostics(Path.Combine(blocked,"child"),4096)) {
                failure.Record("move_step",new {planned_x=1,actual_x=1});
                Thread.Sleep(50);
                Require(!failure.Enabled,"Unavailable log directory incorrectly reported enabled");
            }
            Console.WriteLine("POINTER_DIAGNOSTICS_PASS");return 0;
        } catch(Exception e) {Console.Error.WriteLine(e);return 1;}
    }
}
