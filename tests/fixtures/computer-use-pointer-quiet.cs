using System;
using System.Drawing;

class ComputerUsePointerQuietFixture {
    static void Require(bool value,string message) {if(!value)throw new Exception(message);}
    static int Main() {
        try {
            var slow=new ComputerUse.PointerQuietWindow(new Point(0,0),0);
            for(int t=25;t<=1800;t+=25)
                Require(!slow.Observe(new Point(t/25,0),t),"Slow sustained takeover was treated as quiet");
            Require(!slow.Observe(new Point(72,0),2119),"Resumed before continuous quiet interval");
            Require(slow.Observe(new Point(72,0),2120),"Did not resume after quiet interval");
            var oscillating=new ComputerUse.PointerQuietWindow(new Point(0,0),0);
            for(int t=25;t<=1800;t+=25)
                Require(!oscillating.Observe(new Point((t/25)%2,0),t),"Small oscillation was treated as quiet");
            var transient=new ComputerUse.PointerQuietWindow(new Point(0,0),0);
            Require(!transient.Observe(new Point(32,18),100),"Transient movement must reset quiet timer");
            Require(!transient.Observe(new Point(32,18),419),"Quiet interval was shortened");
            Require(transient.Observe(new Point(32,18),420),"Transient movement cannot recover");
            Console.WriteLine("POINTER_QUIET_PASS");return 0;
        } catch(Exception e) {Console.Error.WriteLine(e);return 1;}
    }
}
