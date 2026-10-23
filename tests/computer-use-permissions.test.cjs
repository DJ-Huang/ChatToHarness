'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {ComputerUsePermissions,permissionCode}=require('../app/computer-use-permissions.cjs');
const {ComputerUseSwitch}=require('../app/builtin-computer-use.cjs');

function helper(t) {
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'cu-permission-test-'));
 const dir=path.join(home,'computer-use');fs.mkdirSync(dir);
 fs.writeFileSync(path.join(dir,'ChatToHarness.MacComputerUse'),'fixture');
 fs.writeFileSync(path.join(dir,'ChatToHarness.ComputerUse.exe'),'fixture');
 t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 return home;
}
test('macOS preflight is read-only, prompts only after explicit request and validates TCC JSON',async t=>{
 const home=helper(t),native=path.join(home,'computer-use/ChatToHarness.MacComputerUse');
 const modes=[],permissions=new ComputerUsePermissions({platform:'darwin',helper:native,
 execute(file,args,options,cb){
   assert.equal(file,native);assert.equal(options.shell,undefined);assert.equal(options.timeout,12000);
   modes.push(args[0]);
   cb(null,JSON.stringify({screen_recording:true,accessibility:args[0]==='request_permissions'}));
 }});
 const status=await permissions.check();
 assert.deepEqual(status.missing,['accessibility']);
 assert.equal(status.granted,false);
 assert.equal(status.request_attempted,false);
 const allowed=await permissions.check({request:true});
 assert.equal(allowed.granted,true);
 assert.deepEqual(modes,['permission_status','request_permissions']);
});
test('macOS missing helper, command failure or malformed output fails closed',async t=>{
 const home=helper(t),native=path.join(home,'computer-use/ChatToHarness.MacComputerUse');
 fs.rmSync(native);
 await assert.rejects(()=>new ComputerUsePermissions({platform:'darwin',helper:native}).check(),/CU_HELPER_UNAVAILABLE/);
 fs.writeFileSync(native,'fixture');
 await assert.rejects(()=>new ComputerUsePermissions({platform:'darwin',helper:native,execute(_f,_a,_o,cb){cb(null,'malformed');}}).check(),/CU_PERMISSION_CHECK_FAILED/);
 await assert.rejects(()=>new ComputerUsePermissions({platform:'darwin',helper:native,execute(_f,_a,_o,cb){cb(new Error('timeout'));}}).check(),/CU_PERMISSION_CHECK_FAILED/);
});
test('Windows does not use macOS TCC or launch any macOS helper',async()=>{
 const permission=new ComputerUsePermissions({platform:'win32',helper:'/does/not/exist',
 execute(){throw Error('macOS helper launched from Windows')}});
 const answer=await permission.check({request:true});
 assert.deepEqual(answer.missing,[]);
 assert.equal(answer.granted,true);
 assert.equal(answer.authorization,'per_window');
 await assert.rejects(()=>new ComputerUsePermissions({platform:'linux'}).check(),/CU_HELPER_UNAVAILABLE/);
});
test('permission codes include native denial and input_blocked_reason but not unrelated errors',()=>{
 for(const code of ['CU_ACCESSIBILITY_REQUIRED','CU_SCREEN_RECORDING_REQUIRED','CU_CONSENT_DENIED']){
   assert.equal(permissionCode({structuredContent:{code}}),code);
   assert.equal(permissionCode({structuredContent:{input_enabled:false,input_blocked_reason:code}}),code);
 }
 assert.equal(permissionCode({structuredContent:{code:'CU_STALE_OBSERVATION'}}),null);
 assert.equal(permissionCode({structuredContent:{input_enabled:true,input_blocked_reason:'CU_ACCESSIBILITY_REQUIRED'}}),null);
});
test('permission loss during a tool call stops the native controller, hides tool and surfaces exact denial',async t=>{
 const home=helper(t);
 let stopped=0,requested=0,popup=null;
 const cu=new ComputerUseSwitch({platform:'darwin',resources:home,
   permissions:{check:async()=>({platform:'darwin',granted:true,missing:[]})},
   createMac:()=>({stop(){stopped++},async call(){return {isError:true,structuredContent:{code:'CU_ACCESSIBILITY_REQUIRED'}};}}),
   onPermissionRequired:p=>{requested++;popup=p}});
 assert.equal((await cu.checkPermissions()).granted,true);
 cu.setEnabled(true);
 const answer=await cu.call({action:'click',session_id:'x'});
 assert.equal(answer.structuredContent.code,'CU_ACCESSIBILITY_REQUIRED');
 assert.equal(stopped,1);
 assert.equal(cu.status().registered,false);
 assert.deepEqual(popup.missing,['accessibility']);
 assert.equal(requested,1);
 assert.equal((await cu.call({action:'list_windows'})).structuredContent.code,'CU_DISABLED');
 cu.dispose();
});
test('revoked consent is not treated as macOS TCC and Windows never asks for Mac permissions',async t=>{
 const home=helper(t);let required;
 const cu=new ComputerUseSwitch({platform:'win32',resources:home,
   createWindows:()=>({stop(){},async call(){return{structuredContent:{code:'CU_CONSENT_DENIED'}};}}),
   onPermissionRequired:p=>{required=p}});
 cu.setEnabled(true);
 const r=await cu.call({action:'open_session',session_title:'Computer Use 测试会话'});
 assert.equal(r.structuredContent.code,'CU_CONSENT_DENIED');
 assert.equal(cu.definition(),null);
 assert.equal(required.platform,'win32');
 assert.deepEqual(required.missing,[]);
});
test('native pending-session permission denial surfaces before any MCP polling or input',async()=>{
 const {MacComputerUse}=require('../app/macos-computer-use.cjs');
 const codes=[], native={
   closed:false,
   ready:Promise.reject(Object.assign(new Error('CU_SCREEN_RECORDING_REQUIRED'),{code:'CU_SCREEN_RECORDING_REQUIRED'})),
   stop(){this.closed=true},
   request(){throw new Error('No input may be sent');}
 };
 const controller=new MacComputerUse({platform:'darwin',connect:()=>native,
   onPermissionDenied:code=>codes.push(code)});
 const result=await controller.call({action:'open_session',session_title:'Computer Use 测试会话'});
 assert.equal(result.structuredContent.state,'initializing');
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(codes,['CU_SCREEN_RECORDING_REQUIRED']);
 assert.equal(native.closed,true);
 assert.equal(controller.status().code,'CU_SCREEN_RECORDING_REQUIRED');
});
