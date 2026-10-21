'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {MacComputerUse}=require('../app/macos-computer-use.cjs');
const {NativeConnection}=require('../app/base-computer-use.cjs');

test('session shown in Mac native HUD is exactly the MCP open_session ID',async()=>{
 const options=[];
 const fake={closed:false,ready:Promise.resolve({window_id:'123',input_enabled:true}),
   stop(){this.closed=true},request(){return Promise.resolve({ok:true})}};
 const service=new MacComputerUse({platform:'darwin',connect:args=>{options.push(args);return fake;}});
 const opened=await service.call({action:'open_session',window_id:'123'});
 const session=opened.structuredContent.session_id;
 assert.match(session,/^[a-f0-9-]{36}$/);
 assert.equal(options[0].session_id,session);
 assert.equal(options[0].mode,'all_windows');
 await Promise.resolve();
 assert.equal((await service.call({action:'get_session'})).structuredContent.session_id,session);
 assert.equal((await service.call({action:'close_session'})).structuredContent.closed,true);
 assert.equal(fake.closed,true);
});
test('macOS native helper CLI accepts the real session ID as optional arg without breaking legacy',()=>{
 const file=fs.readFileSync(path.join(__dirname,'../native/MacComputerUse.swift'),'utf8');
 assert.match(file,/CommandLine\.arguments\.count == 4 \|\| CommandLine\.arguments\.count == 5/);
 assert.match(file,/UUID\(uuidString: id\) == nil/);
 assert.match(file,/MacComputerUse\(ownerPID: parent, sessionID: sessionID\)/);
 const js=fs.readFileSync(path.join(__dirname,'../app/base-computer-use.cjs'),'utf8');
 assert.match(js,/process\.platform === 'darwin' && session_id && operation !== 'list_windows'/);
 assert.match(js,/this\.connect\(\{mode:this\.authorizationMode,window_id:args\.window_id,session_id:sessionID\}\)/);
});
test('HUD is top centered in the target monitor, translucent, with visible border and STOP',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../native/MacComputerUse.swift'),'utf8');
 assert.match(code,/visible\.midX - panelWidth \/ 2/);
 assert.match(code,/visible\.maxY - height - 10/);
 assert.match(code,/NSScreen\.screens/);
 assert.match(code,/hudTargetFrame = window\.frame/);
 assert.match(code,/hudTargetFrame = CGRect\(x: x\.doubleValue/);
 assert.match(code,/NSVisualEffectView/);
 assert.match(code,/\.hudWindow/);
 assert.match(code,/alpha: 0\.69/);
 assert.match(code,/borderWidth = 3/);
 assert.match(code,/borderColor = NSColor/);
 assert.match(code,/NSButton\(title: "STOP  ·  Esc"/);
 assert.match(code,/@objc private func stopPressed\(\) \{ stopNow\(\) \}/);
 assert.match(code,/installLocalEsc\(\)/);
 assert.match(code,/sessionID \?\? "external"/);
 assert.ok(code.includes(String.raw`Session \(visibleSession)`));
});
test('native action labels reflect active phases, not text content or keyboard contents',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../native/MacComputerUse.swift'),'utf8');
 for(const action of ['idle','observe','activate','moving','click','scroll','type_text','key_press'])
   assert.ok(code.includes('"' + action + '": ('),'missing HUD action '+action);
 assert.match(code,/updateHUD\(action\)/);
 assert.match(code,/updateHUD\("moving"\)/);
 assert.match(code,/try await movePointer\(to: position\)\s+updateHUD\(action\)/);
 assert.match(code,/defer \{ updateHUD\("idle"\) \}/);
 assert.doesNotMatch(code,/updateHUD\((?:text|keyName|args\["text"\])\)/);
});
test('Mac session-id transfer leaves Windows native CLI unchanged',()=>{
 const content=fs.readFileSync(path.join(__dirname,'../app/base-computer-use.cjs'),'utf8');
 assert.match(content,/const nativeArguments=\[String\(process\.pid\)/);
 assert.match(content,/nativeArguments\.push\(session_id\)/);
 assert.match(content,/operation !== 'list_windows'/);
 assert.equal(typeof NativeConnection,'function');
});
