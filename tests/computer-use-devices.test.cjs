'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {localComputerIdentity,verifiedDevices,deviceSelection}=require('../app/computer-use-devices.cjs');
const {ComputerUseSwitch}=require('../app/builtin-computer-use.cjs');
const mac={id:'cu-10000000-0000-4000-8000-000000000001',platform:'darwin',name:'Mac Studio'};
const win={id:'cu-20000000-0000-4000-8000-000000000002',platform:'win32',name:'Windows Rocket'};
const fresh=()=>({verified:true,observed_at:Date.now(),devices:[mac,win]});
test('Device identity is stable, durable and different across local app homes',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cth-device-routing-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const a=localComputerIdentity(path.join(root,'mac'),'darwin','mac-host');
  const again=localComputerIdentity(path.join(root,'mac'),'darwin','renamed-mac');
  const b=localComputerIdentity(path.join(root,'win'),'win32','win-host');
  assert.match(a.id,/^cu-[a-f0-9-]{36}$/);
  assert.equal(a.id,again.id);
  assert.notEqual(a.id,b.id);
  assert.equal(again.name,'renamed-mac');
  fs.writeFileSync(path.join(root,'mac','computer-use-device-id'),'corrupt');
  assert.throws(()=>localComputerIdentity(path.join(root,'mac')),/CU_DEVICE_ID_INVALID/);
});
test('Verified fresh online roster requires explicit target only for multiple devices',()=>{
  assert.equal(verifiedDevices(fresh()).length,2);
  assert.deepEqual(deviceSelection(mac,undefined,fresh()),{code:'CU_DEVICE_SELECTION_REQUIRED',devices:[mac,win]});
  assert.equal(deviceSelection(mac,mac.id,fresh()),null);
  assert.equal(deviceSelection(mac,undefined,{...fresh(),devices:[mac]}),null);
  assert.equal(deviceSelection(mac,win.id,fresh()).code,'CU_TARGET_DEVICE_MISMATCH');
  assert.equal(deviceSelection(mac,undefined,{...fresh(),verified:false}).code,'CU_DEVICE_ROSTER_UNAVAILABLE');
  assert.equal(deviceSelection(mac,undefined,{...fresh(),observed_at:Date.now()-90000}).code,'CU_DEVICE_ROSTER_UNAVAILABLE');
  assert.equal(deviceSelection(mac,undefined,null),null); // standalone harness cannot assert other machines are online
});
test('Mac Computer Use does not start native helper on ambiguous or wrong device',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cth-device-gate-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'computer-use'));
  fs.writeFileSync(path.join(root,'computer-use','ChatToHarness.MacComputerUse'),'dummy');
  let starts=0,inputs=[];
  const cu=new ComputerUseSwitch({platform:'darwin',resources:root,deviceIdentity:mac,
    connectedDevices:()=>fresh(),createMac:()=>{starts++;return{
      stop(){},async call(input){inputs.push(input);return{structuredContent:{ok:true,session_id:input.action==='open_session'?'session-123':undefined}}}
    }}});
  t.after(()=>cu.dispose());cu.setEnabled(true);
  const desc=cu.definition();
  assert.equal(desc.inputSchema.properties.target_device_id.maxLength,100);
  assert.match(desc.description,/Mac Studio/);
  assert.match(desc.description,/ask the user to select a device in ChatGPT/);
  const pending=await cu.call({action:'open_session'});
  assert.equal(pending.structuredContent.code,'CU_DEVICE_SELECTION_REQUIRED');
  assert.equal(pending.structuredContent.operation_executed,false);
  assert.equal(starts,0);
  assert.equal((await cu.call({action:'open_session',target_device_id:win.id})).structuredContent.code,'CU_TARGET_DEVICE_MISMATCH');
  assert.equal(starts,0);
  const accepted=await cu.call({action:'open_session',target_device_id:mac.id});
  assert.equal(accepted.structuredContent.ok,true);
  assert.equal(starts,1);
  assert.deepEqual(inputs,[{action:'open_session'}]);
  // No repeated device dialog mid-drag; cleanup must succeed despite lost roster.
  cu.connectedDevices=()=>{throw Error('broker unavailable');};
  const release=await cu.call({action:'mouse_up',session_id:'session-123'});
  assert.equal(release.structuredContent.ok,true);
  assert.deepEqual(inputs.at(-1),{action:'mouse_up',session_id:'session-123'});
  await cu.call({action:'close_session',session_id:'session-123'});
  const next=await cu.call({action:'open_session'});
  assert.equal(next.structuredContent.code,'CU_DEVICE_ROSTER_UNAVAILABLE');
  assert.equal(starts,1);
});
