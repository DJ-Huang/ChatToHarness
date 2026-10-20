'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {MacComputerUse}=require('../app/macos-computer-use.cjs');
const helper=path.resolve(__dirname,'../resources/computer-use/ChatToHarness.MacComputerUse');
function native(...args){
 const out=spawnSync(helper,args,{timeout:10000,encoding:'utf8'});
 assert.equal(out.status,0,out.stderr||String(out.error||out.signal));
 return JSON.parse(out.stdout.trim());
}
test('real Mac MCP read-only session captures authorized app while rejecting input without Accessibility', {skip:process.platform!=='darwin',timeout:20000}, async t=>{
 const permissions=native('permission_status');
 if(!permissions.screen_recording) return t.skip('Screen Recording is not granted');
 if(permissions.accessibility) return t.skip('Accessibility already granted; do not run read-only denial fixture');
 const windows=native(String(process.pid),'list_windows','0').windows;
 const target=windows?.find(w=>w.title==='ChatToHarness');
 if(!target) return t.skip('The ChatToHarness app window is not visible');
 const svc=new MacComputerUse({platform:'darwin',authorizationMode:'all_windows',helperPath:helper});
 t.after(()=>svc.stop());
 const opening=await svc.call({action:'open_session',window_id:target.window_id});
 assert.equal(opening.isError,undefined,JSON.stringify(opening.structuredContent));
 const session=opening.structuredContent.session_id;
 let state;
 for(let i=0;i<80;i++){
   state=(await svc.call({action:'get_session',session_id:session})).structuredContent;
   if(state.state==='ready'||state.state==='closed') break;
   await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.equal(state.state,'ready',JSON.stringify(state));
 assert.equal(state.input_enabled,false);
 assert.equal(state.input_blocked_reason,'CU_ACCESSIBILITY_REQUIRED');
 assert.equal(state.stop_hotkey,null);
 const observed=await svc.call({action:'observe',session_id:session,format:'png',delivery:'chunked'});
 assert.equal(observed.isError,undefined,JSON.stringify(observed.structuredContent));
 assert.ok(observed.structuredContent.width>0);
 assert.ok(observed.structuredContent.height>0);
 assert.equal(observed.structuredContent.coordinate_space,'window_pixels');
 assert.ok(observed.structuredContent.screenshot.sha256);
 assert.equal(observed.structuredContent.screenshot.delivery,'chunked');
 // Input must be denied before a CGEvent is posted. This test only runs
 // on a host that has explicitly reported Accessibility=false.
 const denied=await svc.call({action:'type_text',session_id:session,
   observation_id:observed.structuredContent.observation_id,text:'x'});
 assert.equal(denied.isError,true);
 assert.equal(denied.structuredContent.code,'CU_ACCESSIBILITY_REQUIRED');
 const closed=await svc.call({action:'close_session',session_id:session});
 assert.equal(closed.structuredContent.closed,true);
});
