'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const {MacComputerUse}=require('../app/macos-computer-use.cjs');
const helper=path.resolve(__dirname,'../resources/computer-use/ChatToHarness.MacComputerUse');
const gui='/tmp/cth-computer-use-gui-fixture';
const esc='/tmp/cth-computer-use-esc-fixture';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function native(...args){
 const x=spawnSync(helper,args,{encoding:'utf8',timeout:10000});
 assert.equal(x.status,0,x.stderr||String(x.error||x.signal));
 return JSON.parse(x.stdout.trim());
}
test('macOS local Esc event tap closes a real input-enabled session and leaves target fixture intact',
 {skip:process.platform!=='darwin',timeout:18000},async t=>{
  const permission=native('permission_status');
  if(!permission.accessibility||!permission.screen_recording)return t.skip('TCC is not enabled');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cth-esc-fixture-'));
  const file=path.join(directory,'state.json');
  const app=spawn(gui,[file],{stdio:'ignore'});
  let service;
  t.after(()=>{
   try{service?.stop()}catch{}
   try{app.kill('SIGTERM')}catch{}
   try{fs.rmSync(directory,{recursive:true,force:true})}catch{}
  });
  for(let i=0;i<50&&!fs.existsSync(file);i++)await delay(100);
  assert.ok(fs.existsSync(file),'Native GUI fixture did not start');
  const target=native(String(process.pid),'list_windows','0').windows.find(w=>w.pid===app.pid&&w.title==='CTH Computer Use Acceptance Fixture');
  assert.ok(target,'Fixture not visible');
  service=new MacComputerUse({platform:'darwin',helperPath:helper,authorizationMode:'all_windows'});
  const open=await service.call({action:'open_session',window_id:target.window_id});
  assert.equal(open.isError,undefined,JSON.stringify(open.structuredContent));
  const sessionId=open.structuredContent.session_id;
  let status;
  for(let i=0;i<60;i++){
    status=(await service.call({action:'get_session',session_id:sessionId})).structuredContent;
    if(status.state==='ready'||status.state==='closed')break;
    await delay(100);
  }
  assert.equal(status.state,'ready',JSON.stringify(status));
  assert.equal(status.input_enabled,true);
  assert.equal(status.stop_hotkey,'Esc');
  const activated=await service.call({action:'activate',session_id:sessionId});
  assert.equal(activated.isError,undefined,JSON.stringify(activated.structuredContent));
  await delay(120);
  const observe=await service.call({action:'observe',session_id:sessionId,format:'png',delivery:'chunked'});
  assert.equal(observe.isError,undefined);
  const sent=spawnSync(esc,[String(app.pid)],{encoding:'utf8',timeout:5000});
  if(sent.status!==0)return t.skip('Esc emitter refused injection because the fixture lost foreground focus: '+String(sent.stderr).trim());
  t.diagnostic(sent.stdout.trim());
  let closed;
  for(let i=0;i<50;i++){
    closed=(await service.call({action:'get_session',session_id:sessionId})).structuredContent;
    if(closed.state==='closed'||closed.state==='none')break;
    await delay(100);
  }
  assert.equal(closed.state,'closed',JSON.stringify(closed));
  assert.equal(app.exitCode,null,'Esc must stop automation without killing the target app');
  t.diagnostic('Global Esc shut down native helper; target fixture remained open');
});
