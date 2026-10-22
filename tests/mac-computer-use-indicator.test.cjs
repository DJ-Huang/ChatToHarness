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
 assert.doesNotMatch(code,/NSVisualEffectView/);
 assert.match(code,/panel\.hasShadow = false/);
 assert.match(code,/panel\.backgroundColor = \.clear/);
 assert.match(code,/panel\.contentView = surface/);
 const hud=fs.readFileSync(path.join(__dirname,'../native/MacHUDSurface.swift'),'utf8');
 assert.match(code,/let surface = MacHUDSurface\(frame: NSRect\(origin: \.zero, size: panel\.frame\.size\)\)/);
 assert.match(code,/surface\.autoresizingMask = \[\.width, \.height\]/);
 assert.match(code,/title\.textColor = MacHUDSurface\.titleColor/);
 assert.match(code,/session\.textColor = MacHUDSurface\.secondaryTextColor/);
 assert.match(code,/activity\.textColor = MacHUDSurface\.primaryTextColor/);
 assert.match(hud,/alpha: 0\.97/);
 assert.match(hud,/steadyBorder\.strokeColor/);
 assert.match(hud,/CABasicAnimation\(keyPath: "lineDashPhase"\)/);
 assert.match(hud,/travel\.repeatCount = \.infinity/);
 assert.match(hud,/movingHighlight\.shadowOpacity = 0\.85/);
 assert.match(code,/panel\.frame\.width - 133/);
 assert.match(code,/max\(110, panel\.frame\.width - 164\)/);
 assert.match(code,/autoresizingMask = \[\.width\]/);
 assert.match(code,/max\(280, visible\.width - 20\)/);
 assert.match(code,/NSButton\(title: "STOP  ·  Esc"/);
 assert.match(code,/@objc private func stopPressed\(\) \{ stopNow\(\) \}/);
 assert.match(code,/installLocalEsc\(\)/);
 assert.match(code,/Conversation: title unavailable/);
 assert.match(code,/会话：名称未提供/);
 assert.match(code,/sessionField\?\.toolTip|session\.toolTip = sessionID/);
 assert.match(code,/previousField\?\.stringValue/);
 assert.match(code,/activityField\?\.stringValue/);
});
test('native action labels reflect active phases, not text content or keyboard contents',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../native/MacComputerUse.swift'),'utf8');
 for(const action of ['idle','observe','activate','moving','click','scroll','type_text','key_press'])
   assert.ok(code.includes('"' + action + '": ('),'missing HUD action '+action);
 assert.match(code,/updateHUD\(action\)/);
 assert.match(code,/updateHUD\("moving"\)/);
 assert.match(code,/try await movePointer\(to: position\)\s+updateHUD\(action\)/);
 assert.match(code,/completeHUD\(action, error: result\["error"\] as\? String\)/);
 assert.match(code,/updateHUD\("idle"\)/);
 assert.match(code,/previousField\?\.stringValue/);
 assert.doesNotMatch(code,/updateHUD\((?:text|keyName|args\["text"\])\)/);
});
test('Mac session-id transfer leaves Windows native CLI unchanged',()=>{
 const content=fs.readFileSync(path.join(__dirname,'../app/base-computer-use.cjs'),'utf8');
 assert.match(content,/const nativeArguments=\[String\(process\.pid\)/);
 assert.match(content,/nativeArguments\.push\(session_id\)/);
 assert.match(content,/operation !== 'list_windows'/);
 assert.equal(typeof NativeConnection,'function');
});

test('HUD preserves last operation status and shows current action separately without displaying typed content',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../native/MacComputerUse.swift'),'utf8');
 assert.match(code,/let height: CGFloat = 140/);
 assert.match(code,/let previous = NSTextField\(labelWithString:/);
 assert.match(code,/completeHUD\(action, error: result\["error"\] as\? String\)/);
 assert.match(code,/let result = await executeAction\(args\)/);
 assert.match(code,/previousField\?\.stringValue/);
 assert.match(code,/let outcome = error == nil/);
 assert.match(code,/DateFormatter\.localizedString/);
 assert.match(code,/updateHUD\("moving"\)/);
 assert.match(code,/updateHUD\("idle"\)/);
 assert.doesNotMatch(code,/previousField\?\.stringValue\s*=.*args\["text"\]/);
 assert.doesNotMatch(code,/activityField\?\.stringValue\s*=.*args\["text"\]/);
 assert.match(code,/if action == "set_session_title"/);
 assert.match(code,/!title\.unicodeScalars\.contains/);
});
