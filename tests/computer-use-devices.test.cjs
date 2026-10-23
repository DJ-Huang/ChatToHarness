'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {localComputerIdentity,deviceSelection}=require('../app/computer-use-devices.cjs');
const {ComputerUseSwitch}=require('../app/builtin-computer-use.cjs');
const {McpManager}=require('../app/mcp-manager.cjs');
const mac={id:'cu-10000000-0000-4000-8000-000000000001',platform:'darwin',name:'Mac Studio'};
const win={id:'cu-20000000-0000-4000-8000-000000000002',platform:'win32',name:'Windows Rocket'};

test('Computer Use device identity remains stable across app restarts and host renames',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cth-device-routing-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const first=localComputerIdentity(path.join(root,'mac'),'darwin','mac-host');
  const later=localComputerIdentity(path.join(root,'mac'),'darwin','renamed-mac');
  const other=localComputerIdentity(path.join(root,'win'),'win32','win-host');
  assert.match(first.id,/^cu-[a-f0-9-]{36}$/);
  assert.equal(first.id,later.id);
  assert.notEqual(first.id,other.id);
  assert.equal(later.name,'renamed-mac');
  fs.writeFileSync(path.join(root,'mac','computer-use-device-id'),'corrupt');
  assert.throws(()=>localComputerIdentity(path.join(root,'mac')),/CU_DEVICE_ID_INVALID/);
});

test('Chosen connector self-binds device; an explicit wrong ID still fails closed',()=>{
  assert.equal(deviceSelection(mac,undefined),null);
  assert.equal(deviceSelection(mac,'').code,'CU_INVALID_ARGUMENT');
  assert.equal(deviceSelection(mac,mac.id),null);
  assert.deepEqual(deviceSelection(mac,win.id),{code:'CU_TARGET_DEVICE_MISMATCH',device:mac});
  assert.equal(deviceSelection(mac,42).code,'CU_INVALID_ARGUMENT');
});

test('Two harnesses advertise distinct devices, route without UUID input and reject incorrect explicit IDs',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cth-device-gate-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'computer-use'));
  fs.writeFileSync(path.join(root,'computer-use','ChatToHarness.MacComputerUse'),'mock');
  fs.writeFileSync(path.join(root,'computer-use','ChatToHarness.ComputerUse.exe'),'mock');
  const starts={darwin:0,win32:0},inputs=[];
  const create=(platform)=>()=>{
    starts[platform]++;
    return {stop(){},async call(input){inputs.push({platform,input});return {structuredContent:{ok:true,session_id:input.action==='open_session'?'session-123':undefined}};}};
  };
  const devices=[mac,win], switches=devices.map(d=>new ComputerUseSwitch({
    platform:d.platform,resources:root,deviceIdentity:d,createMac:create('darwin'),createWindows:create('win32')
  }));
  t.after(()=>switches.forEach(c=>c.dispose()));
  switches.forEach(c=>c.setEnabled(true));
  const [macTool,winTool]=switches.map(c=>c.definition());
  for(const [tool,device] of [[macTool,mac],[winTool,win]]){
    assert.equal(tool.name,'computer_use');
    assert.match(tool.title,new RegExp(device.name));
    assert.match(tool.description,new RegExp(device.id));
    assert.deepEqual(tool._meta['com.chattoharness/device'],device);
    assert.equal(tool.inputSchema.required.includes('target_device_id'),false);
    assert.equal(tool.inputSchema.properties.target_device_id.const,device.id);
  }
  assert.notEqual(macTool.title,winTool.title);
  for(const [i,cu] of switches.entries()){
    assert.equal(cu.definition()._meta['com.chattoharness/device'].id,devices[i].id);
    assert.equal((await cu.call({action:'open_session',session_title:'Computer Use 测试会话',target_device_id:devices[1-i].id})).structuredContent.code,'CU_TARGET_DEVICE_MISMATCH');
  }
  assert.deepEqual(starts,{darwin:0,win32:0});
  const open=await switches[0].call({action:'open_session',session_title:'Computer Use 测试会话'});
  assert.equal(open.structuredContent.ok,true);
  assert.deepEqual(starts,{darwin:1,win32:0});
  const release=await switches[0].call({action:'mouse_up',session_id:'session-123'});
  assert.equal(release.structuredContent.ok,true);
  const closed=await switches[0].call({action:'close_session',session_id:'session-123'});
  assert.equal(closed.structuredContent.ok,true);
  assert.deepEqual(inputs.map(e=>e.input),[
    {action:'open_session',session_title:'Computer Use 测试会话'}, {action:'mouse_up',session_id:'session-123'},{action:'close_session',session_id:'session-123'}
  ]);
  const winCall=await switches[1].call({action:'list_windows'});
  assert.equal(winCall.structuredContent.ok,true);
  assert.deepEqual(starts,{darwin:1,win32:1});
});

test('A published device-bound computer_use schema survives MCP manager tool enumeration',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'cth-device-mcp-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  fs.mkdirSync(path.join(home,'computer-use'));
  fs.writeFileSync(path.join(home,'computer-use','ChatToHarness.MacComputerUse'),'mock');
  const cu=new ComputerUseSwitch({platform:'darwin',resources:home,deviceIdentity:mac,enabled:true});
  t.after(()=>cu.dispose());
  const services={tools:()=>[cu.definition()],configure(){},dispose(){}};
  const manager=new McpManager({settings:{list:()=>[],getAllowAllTools:()=>false},services});
  t.after(()=>manager.close());
  manager.running=true;manager.changed();
  const tools=manager.listTools().tools;
  assert.equal(tools.length,1);
  assert.equal(tools[0].inputSchema.properties.target_device_id.const,mac.id);
  assert.equal(tools[0].inputSchema.required.includes('target_device_id'),false);
  assert.deepEqual(tools[0]._meta['com.chattoharness/device'],mac);
});
