'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const {MacComputerUse} = require('../app/macos-computer-use.cjs');
const helper = path.resolve(__dirname, '../resources/computer-use/ChatToHarness.MacComputerUse');
const fixture = '/tmp/cth-computer-use-gui-fixture';
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
function probe(...args) {
  const result = spawnSync(helper,args,{encoding:'utf8',timeout:8000});
  assert.equal(result.status,0,result.stderr || String(result.error || result.signal));
  return JSON.parse(result.stdout.trim());
}
async function eventually(read, predicate, timeout=4000) {
  const end=Date.now()+timeout;
  while(Date.now()<end) {try{const result=read();if(predicate(result))return result;}catch{}await delay(100);}
  throw new Error('Timed out awaiting fixture state');
}
test('Mac GUI: real native click, Unicode typing and scroll are confined to disposable window',
  {skip: process.platform!=='darwin',timeout:50000}, async t=>{
    const permissions=probe('permission_status');
    assert.equal(permissions.screen_recording,true,'Need Screen Recording');
    assert.equal(permissions.accessibility,true,'Need Accessibility');
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cth-cu-fixture-'));
    const file=path.join(directory,'state.json');
    const child=spawn(fixture,[file],{stdio:'ignore',detached:false});
    let svc;
    t.after(()=>{
      try {svc?.stop();}catch{}
      try {child.kill('SIGTERM');}catch{}
      try {fs.rmSync(directory,{recursive:true,force:true});}catch{}
    });
    const read=()=>JSON.parse(fs.readFileSync(file,'utf8'));
    const beginning=await eventually(read,state=>state.pid===child.pid);
    const windows=probe(String(process.pid),'list_windows','0').windows;
    const target=windows.find(w=>w.title==='CTH Computer Use Acceptance Fixture'&&w.pid===child.pid);
    assert.ok(target,'Fixture target window missing in ScreenCaptureKit');
    svc=new MacComputerUse({platform:'darwin',helperPath:helper,authorizationMode:'all_windows'});
    const opened=await svc.call({action:'open_session',window_id:target.window_id,session_title:'macOS disposable GUI input acceptance'});
    assert.equal(opened.isError,undefined,JSON.stringify(opened.structuredContent));
    const sessionId=opened.structuredContent.session_id;
    let status;
    for(let i=0;i<80;i++) {
      status=(await svc.call({action:'get_session',session_id:sessionId})).structuredContent;
      if(status.state==='ready'||status.state==='closed')break;
      await delay(100);
    }
    assert.equal(status.state,'ready',JSON.stringify(status));
    assert.equal(status.input_enabled,true,JSON.stringify(status));
    assert.equal(status.stop_hotkey,'Esc');
    const activation=await svc.call({action:'activate',session_id:sessionId});
    assert.equal(activation.isError,undefined,JSON.stringify(activation.structuredContent));
    await delay(220);
    async function observe(){
      const result=await svc.call({action:'observe',session_id:sessionId,format:'png',delivery:'chunked'});
      assert.equal(result.isError,undefined,JSON.stringify(result.structuredContent));
      assert.equal(result.structuredContent.coordinate_space,'window_pixels');
      const rect=svc.session?.observation?.geometry;
      assert.ok(rect&&rect.length===4,'Missing trusted native screenshot geometry');
      return {id:result.structuredContent.observation_id,w:result.structuredContent.width,
        h:result.structuredContent.height,rect};
    }
    function point(obs,position) {
      const x=Math.round((position.x-obs.rect[0])*obs.w/(obs.rect[2]-obs.rect[0]));
      const y=Math.round((position.y-obs.rect[1])*obs.h/(obs.rect[3]-obs.rect[1]));
      assert.ok(x>=0&&y>=0&&x<obs.w&&y<obs.h,'Fixture point outside current screenshot: '+JSON.stringify({x,y,obs,position}));
      return {x,y};
    }
    async function execute(action,args){
      const result=await svc.call({action,session_id:sessionId,...args});
      if(result.isError){
        const current=read();
        const trace=current.cursor_trace||[];
        t.diagnostic('input blocked; foreground '+current.frontmost_pid+' target '+child.pid+
          ', window key '+current.window_is_key+', flags '+current.modifier_flags+', left '+current.left_button+', right '+current.right_button+', pointer '+JSON.stringify(trace.slice(-5)));
      }
      assert.equal(result.isError,undefined,action+': '+JSON.stringify(result.structuredContent));
      assert.equal(result.structuredContent.execution_state,'complete');
    }
    let obs=await observe();
    t.diagnostic('native observation: '+JSON.stringify({size:[obs.w,obs.h],geometry:obs.rect}));
    await execute('click',{observation_id:obs.id,...point(obs,beginning.button),button:'left'});
    const clicked=await eventually(read,s=>s.clicks===1);
    t.diagnostic('real mouse click count: '+clicked.clicks);
    obs=await observe();
    await execute('click',{observation_id:obs.id,...point(obs,clicked.field),button:'left'});
    obs=await observe();
    await execute('type_text',{observation_id:obs.id,text:'MacCU-2026-OK'});
    const typed=await eventually(read,s=>s.text==='MacCU-2026-OK');
    t.diagnostic('real Unicode text: '+typed.text);
    // Single-key BACKSPACE tests native key-down/up without modifier effects.
    obs=await observe();
    await execute('key_press',{observation_id:obs.id,key:'BACKSPACE'});
    const shortened=await eventually(read,s=>s.text==='MacCU-2026-O');
    t.diagnostic('real BACKSPACE: '+shortened.text);
    // A consumed observation cannot authorize a second input.
    const replay=await svc.call({action:'type_text',session_id:sessionId,observation_id:obs.id,text:'replay'});
    assert.equal(replay.isError,true);
    assert.equal(replay.structuredContent.code,'CU_STALE_OBSERVATION');
    assert.equal(read().text,'MacCU-2026-O');
    t.diagnostic('observation anti-replay: '+replay.structuredContent.code);
    obs=await observe();
    const beforeMotion=(read().cursor_trace||[]).length;
    const movementStarted=process.hrtime.bigint();
    await execute('scroll',{observation_id:obs.id,...point(obs,shortened.scroll),delta:3});
    const motionDurationMs=Number(process.hrtime.bigint()-movementStarted)/1e6;
    const scrolled=await eventually(read,s=>s.scroll_events>=1 &&
      (s.cursor_trace||[]).length>beforeMotion+5);
    const trace=scrolled.cursor_trace.slice(beforeMotion);
    const uniquePositions=trace.filter((pt,i)=>i===0 ||
      Math.hypot(pt.x-trace[i-1].x,pt.y-trace[i-1].y)>=0.7).length;
    assert.ok(motionDurationMs>=240,'Cursor still teleports too quickly: '+motionDurationMs.toFixed(0)+'ms');
    assert.ok(uniquePositions>=8,'Expected at least 8 sampled real OS cursor positions, got '+uniquePositions);
    const observedDurationMs=1000*(trace.at(-1).time-trace[0].time);
    assert.ok(observedDurationMs>=120,'Cursor sampled movement should have visible time span');
    t.diagnostic('human-paced REAL cursor: '+motionDurationMs.toFixed(0)+'ms, '+uniquePositions+
      ' distinct OS pointer positions, '+observedDurationMs.toFixed(0)+'ms sampled span');
    t.diagnostic('scroll events: '+scrolled.scroll_events+', delta: '+scrolled.scroll_delta);
    // Exercise a *single native action* that moves the real pointer, holds left
    // button, drags and releases. Only this disposable fixture is affected.
    obs=await observe();
    const before=obs.rect;
    const origin={x:Math.round(before[0]+85*(before[2]-before[0])/obs.w),
                  y:Math.round(before[1]+20*(before[3]-before[1])/obs.h)};
    // Shift the physical pointer once during the native operation.
    // The algorithm must rebase the remaining path, not throw a fixed
    // off-path threshold or fight sustained human control.
    fs.writeFileSync(path.join(directory,'pointer-nudge-request'),'once');
    await execute('drag_window',{observation_id:obs.id,x:85,y:20,
      screen_x:origin.x+78,screen_y:origin.y+45});
    const after=await observe();
    assert.equal(read().pointer_nudges,1,'Fixture failed to inject transient cursor perturbation');
    t.diagnostic('physical pointer perturbation recovered without cancelling the drag');
    assert.ok(Math.abs((after.rect[0]-before[0])-78)<=18,
      'Atomic drag did not move fixture horizontally: '+JSON.stringify({before,after:after.rect}));
    assert.ok(Math.abs((after.rect[1]-before[1])-45)<=18,
      'Atomic drag did not move fixture vertically: '+JSON.stringify({before,after:after.rect}));
    assert.equal(read().left_button,false,'Native drag must release the button');
    t.diagnostic('atomic real window drag: '+JSON.stringify({from:before,to:after.rect}));
    // Cross-monitor real cursor routing is an independent acceptance check.
    // Test only the disposable fixture and close it afterwards.
    const displays=(await svc.call({action:'observe',session_id:sessionId,delivery:'chunked'}))
      .structuredContent.desktop_displays;
    const remote=displays.find(d=>d.x<0&&d.y<0&&d.width>=480&&d.height>=368);
    if(remote){
      const present=(await observe());
      const destLeft=remote.x+16;
      const destTop=remote.y+Math.round((remote.height-368)/2);
      await execute('drag_window',{observation_id:present.id,x:85,y:20,
        screen_x:destLeft+85,screen_y:destTop+20});
      const across=await observe();
      assert.ok(Math.abs(across.rect[0]-destLeft)<=35,
        'Cross-display left mismatch: '+JSON.stringify({across:across.rect,destLeft}));
      assert.ok(Math.abs(across.rect[1]-destTop)<=35,
        'Cross-display vertical mismatch: '+JSON.stringify({across:across.rect,destTop}));
      assert.equal(read().left_button,false);
      t.diagnostic('cross-monitor atomic drag: '+JSON.stringify({from:present.rect,to:across.rect,
        requested:[destLeft,destTop],display:remote}));
    } else t.diagnostic('cross-monitor drag skipped: no connected upper-left secondary display');
    const closed=await svc.call({action:'close_session',session_id:sessionId});
    assert.equal(closed.structuredContent.closed,true);
    t.diagnostic('safe close_session: PASS');
  });
