'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {ComputerUseSwitch}=require('../app/builtin-computer-use.cjs');
const {Preferences}=require('../app/preferences.cjs');
const {McpManager}=require('../app/mcp-manager.cjs');

function fixture(t,platform) {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'cth-cu-toggle-'));
  const directory=path.join(home,'computer-use');
  fs.mkdirSync(directory);
  for(const name of ['ChatToHarness.MacComputerUse','ChatToHarness.ComputerUse.exe'])
    fs.writeFileSync(path.join(directory,name),'native mock');
  let macStarts=0,windowsStarts=0,stops=0,calls=0,closeWork;
  const adapter=()=>({
    stop(){stops++;closeWork?.()},
    async call(args) {
      calls++;
      if(args.action==='block')return new Promise(resolve=>closeWork=()=>resolve({structuredContent:{late:true}}));
      return {structuredContent:{action:args.action,passed:true}};
    }
  });
  const computerUse=new ComputerUseSwitch({resources:home,platform,
    createMac:()=>{macStarts++;return adapter()},
    createWindows:()=>{windowsStarts++;return adapter()}});
  t.after(()=>{computerUse.dispose();fs.rmSync(home,{recursive:true,force:true})});
  return {computerUse,home,get counts(){return{macStarts,windowsStarts,stops,calls}}};
}
test('Computer Use is invisible by default and dynamically selects ONLY the host OS helper',async t=>{
  for(const platform of ['darwin','win32']){
    const f=fixture(t,platform),cu=f.computerUse;
    assert.equal(cu.definition(),null);
    assert.equal(cu.status().registered,false);
    assert.equal((await cu.call({action:'list_windows'})).structuredContent.code,'CU_DISABLED');
    cu.setEnabled(true);
    assert.equal(cu.status().registered,true);
    assert.equal(cu.definition().name,'computer_use');
    assert.match(cu.definition().title,platform==='darwin'?/macOS/:/Windows/);
    const result=await cu.call({action:'list_windows'});
    assert.equal(result.structuredContent.passed,true);
    assert.equal(f.counts.macStarts,platform==='darwin'?1:0);
    assert.equal(f.counts.windowsStarts,platform==='win32'?1:0);
    cu.setEnabled(false);
    assert.equal(f.counts.stops,1);
    assert.equal(cu.definition(),null);
    assert.equal((await cu.call({action:'list_windows'})).structuredContent.code,'CU_DISABLED');
    cu.setEnabled(true);
    await cu.call({action:'list_windows'});
    assert.equal(f.counts.macStarts+f.counts.windowsStarts,2,'toggle on creates a fresh controller');
  }
});
test('Disable aborts a pending native operation and suppresses stale results', async t=>{
  const f=fixture(t,'darwin'),cu=f.computerUse;
  cu.setEnabled(true);
  const operation=cu.call({action:'block'});
  cu.setEnabled(false);
  const result=await operation;
  assert.equal(result.isError,true);
  assert.equal(result.structuredContent.code,'CU_DISABLED');
  assert.equal(result.structuredContent.execution_state,'unknown');
  assert.ok(f.counts.stops>=1);
});
test('Incorrect platform or missing packaged native helper always fail closed',async t=>{
  const f=fixture(t,'linux'),cu=f.computerUse;
  assert.equal(cu.status().available,false);
  assert.throws(()=>cu.setEnabled(true),/CU_HELPER_UNAVAILABLE/);
  assert.equal(cu.definition(),null);
  const mac=fixture(t,'darwin');
  fs.rmSync(mac.computerUse.helper);
  assert.throws(()=>mac.computerUse.setEnabled(true),/CU_HELPER_UNAVAILABLE/);
});
test('Device-local checkbox is persistent and defaults off independently of global MCP grants',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'cth-cu-preference-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const before=new Preferences(home,'en');
  assert.equal(before.computerUseEnabled,false);
  before.setComputerUseEnabled(true);
  const after=new Preferences(home,'ja-JP');
  assert.equal(after.computerUseEnabled,true);
  after.setComputerUseEnabled(false);
  assert.equal(new Preferences(home,'en').computerUseEnabled,false);
  assert.throws(()=>before.setComputerUseEnabled('true'));
});
test('App-owned MCP catalog announces enable/disable and never routes the wrong-platform controller',async t=>{
  for(const platform of ['darwin','win32']){
    const f=fixture(t,platform),cu=f.computerUse;
    const services={
      configure(){},
      tools(){return cu.definition()?[cu.definition()]:[]},
      has(name){return this.tools().some(x=>x.name===name)},
      call(name,args,opts){return cu.call(args,opts)},
      stopComputerUse(){cu.stop()},
      dispose(){cu.dispose()}
    };
    const settings={list:()=>[],getAllowAllTools:()=>false};
    const mgr=new McpManager({settings,services});
    t.after(async()=>mgr.close());
    // Unit-test the gateway catalog lifecycle without requiring an unrelated
    // built-in Desktop Commander MCP transport.
    mgr.running=true;
    mgr.changed();
    assert.equal(mgr.visibleTools().length,0);
    cu.setEnabled(true);
    mgr.changed();
    assert.equal(mgr.visibleTools().length,1);
    assert.equal(mgr.visibleTools()[0].name,'computer_use');
    const activeVersion=mgr.toolsVersion;
    const answer=await mgr.call('computer_use',{action:'list_windows'});
    assert.equal(answer.structuredContent.passed,true);
    assert.deepEqual([f.counts.macStarts,f.counts.windowsStarts],platform==='darwin'?[1,0]:[0,1]);
    cu.setEnabled(false);
    mgr.changed();
    assert.equal(mgr.visibleTools().length,0);
    assert.ok(mgr.toolsVersion>activeVersion);
    const denied=await mgr.call('computer_use',{action:'list_windows'});
    assert.equal(denied.isError,true);
    assert.equal(denied.structuredContent.code,'MCP_TOOL_DENIED');
  }
});
test('MCP Servers setting is wired through GUI, preload, main and tool catalog',()=>{
  const root=path.join(__dirname,'../app');
  for(const [file,needle] of [
    ['index.html','id="mcp-computer-use"'],
    ['renderer.js',"api.mcpSetComputerUse("],
    ['preload.cjs',"mcpSetComputerUse:enabled=>call('mcp-set-computer-use',enabled)"],
    ['main.cjs',"bind('mcp-set-computer-use'"],
    ['harness-services.cjs',"name === 'computer_use'"],
    ['mcp-manager.cjs','this.services?.stopComputerUse?.()']
  ]) assert.ok(fs.readFileSync(path.join(root,file),'utf8').includes(needle),file+' missing wiring');
});

test('MCP manager keeps a model Planner scoped to its single Computer Use start call',async t=>{
  const f=fixture(t,'win32'),cu=f.computerUse;
  const received=[];
  cu.createWindows=()=>({
    stop(){},
    async call(args,{planner}={}){
      received.push({action:args.action,planner});
      return {structuredContent:{action:args.action,planner:typeof planner==='function'}};
    }
  });
  const services={
    tools:()=>cu.definition()?[cu.definition()]:[],
    has:name=>name==='computer_use'&&Boolean(cu.definition()),
    call:(name,args,opts)=>cu.call(args,opts),
    dispose:()=>cu.dispose()
  };
  const mgr=new McpManager({settings:{list:()=>[],getAllowAllTools:()=>false},services});
  t.after(async()=>mgr.close());
  cu.setEnabled(true);mgr.running=true;mgr.changed();
  const planner=async()=>({done:true});
  const a=await mgr.call('computer_use',{action:'start_task'},{planner});
  assert.equal(a.structuredContent.planner,true);
  assert.equal(received[0].planner,planner);
  const b=await mgr.call('computer_use',{action:'get_session'});
  assert.equal(b.structuredContent.planner,false);
  assert.equal(received[1].planner,undefined);
});
