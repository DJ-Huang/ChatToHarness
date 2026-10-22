'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {resolveComputerUseDevice,registeredComputerUse,COMPUTER_USE_GUI_RULE}=require('../app/computer-use-devices.cjs');
const {McpManager}=require('../app/mcp-manager.cjs');

const mac={id:'cu-10000000-0000-4000-8000-000000000001',name:'unity.local',platform:'darwin'};
const win={id:'cu-20000000-0000-4000-8000-000000000002',name:'rocket',platform:'win32'};
const laptop={id:'cu-30000000-0000-4000-8000-000000000003',name:'MacBook',platform:'darwin'};
const devices=[win,laptop,mac];

test('explicit user target overrides bound chat-session device',()=>{
  const result=resolveComputerUseDevice({devices,explicitDeviceName:'rocket',sessionDeviceId:mac.id});
  assert.equal(result.status,'selected');
  assert.equal(result.device.id,win.id);
  assert.equal(result.source,'explicit');
  const byOS=resolveComputerUseDevice({devices,explicitDeviceName:'Windows',sessionDeviceId:mac.id});
  assert.equal(byOS.device.id,win.id);
  const byId=resolveComputerUseDevice({devices,explicitDeviceId:laptop.id,sessionDeviceId:win.id});
  assert.equal(byId.device.id,laptop.id);
});

test('multiple connected devices default to trusted current conversation device',()=>{
  const result=resolveComputerUseDevice({devices,sessionDeviceId:mac.id});
  assert.deepEqual({status:result.status,source:result.source,id:result.device.id},
    {status:'selected',source:'session',id:mac.id});
});

test('unbound multiple computers require numbered choices, never implicit first tool',()=>{
  const result=resolveComputerUseDevice({devices});
  assert.equal(result.status,'selection_required');
  assert.equal(result.reason,'unbound_multiple_devices');
  assert.deepEqual(result.options.map(x=>x.number),[1,2,3]);
  assert.deepEqual(result.options.map(x=>x.label),[
    '1. MacBook (macOS)','2. unity.local (macOS)','3. rocket (Windows)'
  ]);
  assert.ok(result.options.every(x=>!x.label.includes('cu-')));
  assert.deepEqual(resolveComputerUseDevice({devices:[win,mac,laptop]}).options,result.options);
});

test('single connected computer works without binding or UUID prompt',()=>{
  const result=resolveComputerUseDevice({devices:[win]});
  assert.equal(result.source,'single_device');
  assert.equal(result.device.id,win.id);
  assert.equal(resolveComputerUseDevice({devices:[{...win,available:false}]}).status,'unavailable');
});

test('unavailable or ambiguous explicit device never silently falls back to bound device',()=>{
  const unavailable=resolveComputerUseDevice({devices,sessionDeviceId:mac.id,explicitDeviceName:'Unknown'});
  assert.equal(unavailable.status,'selection_required');
  assert.equal(unavailable.reason,'explicit_target_unavailable');
  const ambiguous=resolveComputerUseDevice({devices,sessionDeviceId:win.id,explicitDeviceName:'Mac'});
  assert.equal(ambiguous.status,'selection_required');
  assert.equal(ambiguous.reason,'explicit_target_ambiguous');
});

test('lost conversation binding never silently fails over to a different computer',()=>{
  const result=resolveComputerUseDevice({devices:[win],sessionDeviceId:mac.id});
  assert.equal(result.status,'selection_required');
  assert.equal(result.reason,'session_device_unavailable');
  assert.equal(result.options[0].number,1);
});

test('routing handles deduplicated entries and rejects malformed source data',()=>{
  assert.equal(resolveComputerUseDevice({devices:[mac,mac]}).source,'single_device');
  assert.throws(()=>resolveComputerUseDevice({devices:{}}),/CU_INVALID_DEVICE_LIST/);
  assert.throws(()=>resolveComputerUseDevice({devices:[{...win,platform:'linux'}]}),/CU_INVALID_DEVICE_LIST/);
  assert.throws(()=>resolveComputerUseDevice({devices,sessionDeviceId:10}),/CU_INVALID_SESSION_BINDING/);
  assert.throws(()=>resolveComputerUseDevice({devices,explicitDeviceName:''}),/CU_INVALID_DEVICE_TARGET/);
});

test('computer_use metadata and tool description publish session-first and real-input rules on both OS variants',()=>{
  for(const device of [mac,win]){
    const tool=registeredComputerUse({
      name:'computer_use',description:'Native window control',inputSchema:{type:'object',properties:{},required:['action']}
    },device);
    assert.equal(tool._meta['com.chattoharness/device'].id,device.id);
    assert.deepEqual(tool._meta['com.chattoharness/computer-use-policy'].device_priority,
      ['explicit','current_chat_session','sole_device','numbered_selection']);
    assert.equal(tool._meta['com.chattoharness/computer-use-policy'].default_operation,'native_real_input');
    assert.ok(tool.description.includes('current ChatGPT conversation'));
    assert.ok(tool.description.includes('mouse_drag'));
    assert.ok(tool.description.includes('1/2/3'));
    assert.ok(!tool.inputSchema.required.includes('target_device_id'));
  }
});

test('MCP tool catalog also advises command tools not to silently bypass real GUI input',()=>{
  const services={tools:()=>[{name:'start_task',description:'Run durable shell task'}]};
  const records=new Map([['builtin',{id:'builtin',phase:'ready',tools:[{
    alias:'builtin__start_process',tool:{name:'start_process',description:'Run command'}
  },{
    alias:'builtin__read_file',tool:{name:'read_file',description:'Read file'}
  }]}]]);
  const manager={running:true,services,content:null,records,available:()=>true,policy:()=> 'allow'};
  const tools=McpManager.prototype.visibleTools.call(manager);
  for(const name of ['start_task','builtin__start_process']){
    const t=tools.find(x=>x.name===name);
    assert.ok(t.description.includes('silently replace visible dragging'));
    assert.ok(t.description.includes('docs/computer-use-policy.md'));
  }
  assert.equal(tools.find(x=>x.name==='builtin__read_file').description,'Read file');
  assert.ok(COMPUTER_USE_GUI_RULE.includes('mouse_up'));
  assert.ok(COMPUTER_USE_GUI_RULE.includes('close_session'));
});

test('repository AGENTS.md points to policy with numbered fallback and real drag prohibition',()=>{
  const root=path.resolve(__dirname,'..');
  const agents=fs.readFileSync(path.join(root,'AGENTS.md'),'utf8');
  const policy=fs.readFileSync(path.join(root,'docs/computer-use-policy.md'),'utf8');
  assert.match(agents,/docs\/computer-use-policy\.md/);
  assert.match(agents,/current ChatGPT session device association/);
  assert.match(policy,/1、2、3/);
  assert.match(policy,/AXUIElementSetAttributeValue/);
  assert.match(policy,/mouse_move/);
  assert.match(policy,/不得暗中/);
});
