'use strict';
// End-to-end SDK -> real stdio service -> production native helper -> disposable
// WinForms window. No mock native connection and no reflection input shortcut.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn, execFileSync} = require('node:child_process');
const {createInterface} = require('node:readline');
const assert = require('node:assert/strict');
const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport} = require('@modelcontextprotocol/sdk/client/stdio.js');
const {McpSettings} = require('../app/mcp-settings.cjs');
const {McpManager} = require('../app/mcp-manager.cjs');
const {McpGateway} = require('../app/mcp-gateway.cjs');
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cth-mcp-recovery-'));
const output = path.join(root, '.cache/acceptance/computer-use');
const perWindow = process.argv.includes('--per-window');
const report = {realMcp: false, recoveredLostOpen: false, nativeScreenshot: false, nativeUnicodeInput: false, closeWithoutId: false};
let fixture, lines, client, manager;
async function main() {
  if (process.platform !== 'win32') throw new Error('Windows required');
  const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const executable = path.join(directory, 'Fixture.exe');
  execFileSync(compiler, ['/nologo','/target:exe','/platform:x64','/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll','/out:' + executable,path.join(root,'tests/fixtures/computer-use-window.cs')], {windowsHide: true, stdio: 'pipe'});
  fixture = spawn(executable, ['--server'], {windowsHide: true, stdio: ['pipe','pipe','pipe']});
  const pending = []; lines = createInterface({input: fixture.stdout});
  lines.on('line', line => { const p = pending.shift(); if (p) { try { const value = JSON.parse(line); value.error ? p.reject(Error(value.error)) : p.resolve(value); } catch (e) {p.reject(e);} } });
  fixture.on('exit', () => { for (const p of pending.splice(0)) p.reject(Error('Fixture exited')); });
  function read() { return new Promise((resolve,reject) => { const timer = setTimeout(() => reject(Error('Fixture timeout')), 12000); pending.push({resolve: v => {clearTimeout(timer); resolve(v);},reject: e => {clearTimeout(timer);reject(e);}}); }); }
  function command(args) { const result = read(); fixture.stdin.write(JSON.stringify(args) + '\n'); return result; }
  await read();
  const entryArgument=process.argv.slice(2).find(x=>!x.startsWith('--'));
  const entry = entryArgument ? path.resolve(entryArgument) : path.join(root,'app/windows-computer-use-stdio.cjs');
  const settings=new McpSettings(path.join(directory,'settings'));
  settings.save({id:'windows-computer',name:'Windows computer use acceptance',transport:'stdio',enabled:true,command:process.execPath,
    args:perWindow?[path.join(root,'tests/fixtures/computer-use-per-window.cjs'),entry]:[entry]});
  settings.trust('windows-computer');
  manager=new McpManager({settings,nodePath:process.execPath,processHost:path.join(root,'resources/managed-process/ChatToHarness.ProcessHost.exe')});
  manager.broker=new McpGateway(manager); await manager.connect('windows-computer');
  manager.setToolPolicy({serverId:'windows-computer',toolName:'computer_use',policy:'allow'});
  await manager.start({directories:[]});
  const transport = new StdioClientTransport({command:process.execPath,args:[path.join(root,'app/mcp-gateway-stdio.cjs')],env:manager.broker.environment(),stderr:'pipe'});
  client = new Client({name: 'real-computer-use-recovery-acceptance',version: '1'});
  await client.connect(transport);
  const tools = await client.listTools();
  const computer=tools.tools.find(t=>t.name==='windows-computer__computer_use');
  assert.ok(computer?.inputSchema?.properties?.action?.enum.includes('get_session'));
  const targetDeviceId=computer._meta?.['com.chattoharness/device']?.id;
  assert.ok(targetDeviceId,'Device-bound Computer Use registration is required');
  async function call(args) { return client.callTool({name: 'windows-computer__computer_use',
    arguments: args}); }
  report.realMcp = true;
  report.localHarnessGateway=true; report.tool='windows-computer__computer_use';
  const targetInfo=await command({action:'report'});
  const listed=await call({action:'list_windows'});
  if(perWindow)assert.equal(listed.structuredContent.code,'CU_WINDOW_LIST_NOT_AUTHORIZED');
  else {assert.ok(listed.structuredContent.windows.some(w=>w.window_id===targetInfo.window_id));report.defaultAllWindows=true;}
  const opened = await call({action: 'open_session',window_id:targetInfo.window_id,
    ...(process.argv.includes('--atomic-drag') ? {session_title:'Computer Use atomic drag fixture'} : {})});
  assert.ok(opened.structuredContent.session_id); assert.equal(opened.structuredContent.state,perWindow?'awaiting_consent':'initializing');
  const recovered = await call({action: 'get_session'}); const id = recovered.structuredContent.session_id;
  assert.equal(id,opened.structuredContent.session_id);
  assert.equal((await call({action:'open_session'})).structuredContent.session_id,id); report.recoveredLostOpen=true;
  if(perWindow)await command({action:'authorize',server_pid:manager.record('windows-computer').transport.child.pid});
  report.authorizationMode=perWindow?'per_window':'all_windows';
  let status;
  for (let i=0;i<50;i++) { status=(await call({action:'get_session'})).structuredContent; if(status.state==='ready')break; await new Promise(r=>setTimeout(r,100)); }
  assert.equal(status.state,'ready',JSON.stringify(status));
  assert.equal((await call({action:'activate',session_id:id})).structuredContent.foreground,true);
  let capture=await call({action:'observe',session_id:id,format:'png'}); assert.equal(capture.isError,undefined);
  const image=capture.content.find(x=>x.type==='image'); assert.equal(image.mimeType,'image/png');
  fs.mkdirSync(output,{recursive:true}); fs.writeFileSync(path.join(output,'session-recovery-fixture.png'),Buffer.from(image.data,'base64')); report.nativeScreenshot=true;
  if (process.argv.includes('--atomic-drag')) {
    const before=capture.structuredContent.window_bounds;
    const hud=await command({action:'hud_report'});
    assert.equal(hud.hud_found,true,'Expected native Windows HUD');
    assert.ok(hud.hud_labels.some(label=>label.includes('Computer Use atomic drag fixture')),
      'HUD must display exactly the caller-supplied title');
    assert.ok(hud.hud_labels.some(label=>label.startsWith('当前：')));
    assert.ok(hud.hud_labels.some(label=>label.startsWith('上一步：')));
    report.nativeHud=hud; report.nativeHudTitle=true;
    const dx=36,dy=32,originX=150,originY=16;
    const drag=await call({action:'drag_window',session_id:id,
      observation_id:capture.structuredContent.observation_id,
      x:originX,y:originY,
      screen_x:before.x+originX+dx,screen_y:before.y+originY+dy});
    assert.equal(drag.isError,undefined,JSON.stringify(drag.structuredContent));
    assert.equal(drag.structuredContent.mouse_button_held,false);
    const observed=await call({action:'observe',session_id:id,format:'png'});
    assert.equal(observed.isError,undefined,JSON.stringify(observed.structuredContent));
    const after=observed.structuredContent.window_bounds;
    const measured={x:after.x-before.x,y:after.y-before.y};
    report.dragDelta={expected:{x:dx,y:dy},measured,initial:before,final:after};
    assert.ok(Math.abs(measured.x-dx)<=3&&Math.abs(measured.y-dy)<=3,
      'Real native window move did not match requested translation');
    const fixtureState=await command({action:'report'});
    assert.equal(fixtureState.window_id,targetInfo.window_id);
    // A nonactivating, topmost window belonging exclusively to the disposable
    // fixture covers the first title-bar grip, without stealing foreground.
    const partial=await command({action:'overlay_one'});
    assert.equal(partial.covered,true,'Fixture first candidate was not covered');
    if (!partial.foreground) {
      const focus=await call({action:'activate',session_id:id});
      assert.equal(focus.structuredContent.foreground,true,
        'Production activate must recover focus without unsafe clicking');
    }
    let coveredShot=await call({action:'observe',session_id:id,format:'png'});
    assert.equal(coveredShot.isError,undefined,JSON.stringify(coveredShot.structuredContent));
    const b=coveredShot.structuredContent.window_bounds;
    const recovered=await call({action:'drag_window',session_id:id,
      observation_id:coveredShot.structuredContent.observation_id,
      x:originX,y:originY,screen_x:b.x+originX+dx,screen_y:b.y+originY+dy});
    assert.equal(recovered.isError,undefined,JSON.stringify(recovered.structuredContent));
    const recoveredShot=await call({action:'observe',session_id:id,format:'png'});
    assert.equal(recoveredShot.isError,undefined,JSON.stringify(recoveredShot.structuredContent));
    const a=recoveredShot.structuredContent.window_bounds;
    assert.ok(Math.abs(a.x-b.x-dx)<=3&&Math.abs(a.y-b.y-dy)<=3,
      'Alternate grip must preserve the requested final position');
    report.singleTitlebarOcclusionRecovery=true;
    await command({action:'overlay_off'});
    const all=await command({action:'overlay_all'});
    assert.equal(all.covered,true);
    if (!all.foreground) {
      const focus=await call({action:'activate',session_id:id});
      assert.equal(focus.structuredContent.foreground,true,
        'Production activate must recover focus before an occlusion check');
    }
    coveredShot=await call({action:'observe',session_id:id,format:'png'});
    assert.equal(coveredShot.isError,undefined,JSON.stringify(coveredShot.structuredContent));
    const c=coveredShot.structuredContent.window_bounds;
    const blocked=await call({action:'drag_window',session_id:id,
      observation_id:coveredShot.structuredContent.observation_id,
      x:originX,y:originY,screen_x:c.x+originX+dx,screen_y:c.y+originY+dy});
    assert.equal(blocked.structuredContent.code,'CU_TARGET_OCCLUDED',
      JSON.stringify(blocked.structuredContent));
    assert.equal(blocked.structuredContent.execution_state,'not_started');
    assert.equal(blocked.structuredContent.operation_executed,false);
    assert.equal(blocked.structuredContent.next_action,'observe');
    assert.equal(blocked.structuredContent.occlusion.reason,
      'all_titlebar_candidates_blocked');
    assert.ok(blocked.structuredContent.occlusion.candidates.length>=2);
    assert.equal((await call({action:'get_session'})).structuredContent.state,'ready');
    report.allTitlebarOcclusionFailClosed=true;
    await command({action:'overlay_off'});
    const restart=await call({action:'observe',session_id:id});
    assert.equal(restart.isError,undefined,JSON.stringify(restart.structuredContent));
    report.freshObservationAfterOcclusion=true;
    // Explicit geometry manipulation below is confined to our disposable
    // test fixture, to verify that the top-center HUD does not self-occlude.
    const positioned=await command({action:'position_top'});
    assert.equal(positioned.foreground,true);
    await new Promise(r=>setTimeout(r,250));
    const hudTop=await command({action:'hud_report'});
    const [left,top,right,bottom]=positioned.bounds;
    const [hLeft,hTop,hRight,hBottom]=hudTop.hud_bounds;
    const titleLeft=left+72,titleRight=right-16,titleTop=top+8,titleBottom=top+50;
    const overlaps=Math.max(titleLeft,hLeft)<Math.min(titleRight,hRight) &&
      Math.max(titleTop,hTop)<Math.min(titleBottom,hBottom);
    assert.equal(overlaps,false,'HUD must never cover the target title bar');
    report.nativeHudAvoidsTitlebar=true;
    const highShot=await call({action:'observe',session_id:id,format:'png'});
    assert.equal(highShot.isError,undefined,JSON.stringify(highShot.structuredContent));
    const highStart=highShot.structuredContent.window_bounds;
    const highDrag=await call({action:'drag_window',session_id:id,
      observation_id:highShot.structuredContent.observation_id,x:originX,y:originY,
      screen_x:highStart.x+originX+dx,screen_y:highStart.y+originY+dy});
    assert.equal(highDrag.isError,undefined,JSON.stringify(highDrag.structuredContent));
    const highAfter=await call({action:'observe',session_id:id,format:'png'});
    assert.equal(highAfter.isError,undefined,JSON.stringify(highAfter.structuredContent));
    const highEnd=highAfter.structuredContent.window_bounds;
    assert.ok(Math.abs(highEnd.x-highStart.x-dx)<=3&&
      Math.abs(highEnd.y-highStart.y-dy)<=3,
      'Top-edge real native drag must keep exact destination');
    report.realTopEdgeWindowDrag=true;
    const hudAfter=await command({action:'hud_report'});
    assert.ok(hudAfter.hud_labels.some(s=>s.includes('上一步：')));
    report.realAtomicWindowDrag=true; report.observedFinalGeometry=true;
    await command({action:'hud_stop'});
    let stopped=false;
    for(let i=0;i<20;i++) {
      const state=(await call({action:'get_session'})).structuredContent;
      if(state.state==='closed') { stopped=true; break; }
      await new Promise(r=>setTimeout(r,100));
    }
    assert.equal(stopped,true,'Native STOP button must terminate the owner-scoped helper');
    report.nativeStopButton=true;
    assert.equal((await call({action:'close_session'})).structuredContent.closed,true);
    report.closeWithoutId=true;
    return;
  }
  const away=await command({action:'defocus'}); assert.equal(away.foreground,false);
  const rejected=await call({action:'type_text',session_id:id,observation_id:capture.structuredContent.observation_id,text:'MUST NOT TYPE'});
  assert.equal(rejected.structuredContent.code,'CU_WINDOW_NOT_FOREGROUND');
  assert.equal(rejected.structuredContent.next_action,'activate');
  assert.equal((await command({action:'report'})).distractor_text,'');
  const activated=await call({action:'activate',session_id:id}); assert.equal(activated.isError,undefined,JSON.stringify(activated.structuredContent));
  assert.equal((await command({action:'report'})).foreground,true); report.focusRecovery=true;
  assert.equal((await call({action:'key_press',session_id:id,observation_id:capture.structuredContent.observation_id,key:'ENTER'})).structuredContent.code,'CU_STALE_OBSERVATION');
  assert.equal((await command({action:'minimize'})).minimized,true);
  assert.equal((await call({action:'activate',session_id:id})).structuredContent.foreground,true);
  const target=await command({action:'report'}); assert.equal(target.minimized,false); assert.equal(target.foreground,true); report.minimizedRestore=true;
  capture=await call({action:'observe',session_id:id});
  const click=await call({action:'click',session_id:id,observation_id:capture.structuredContent.observation_id,x:target.x,y:target.y}); assert.equal(click.isError,undefined,JSON.stringify(click.structuredContent));
  capture=await call({action:'observe',session_id:id});
  const text='会话恢复测试 PASS';
  const typed=await call({action:'type_text',session_id:id,observation_id:capture.structuredContent.observation_id,text}); assert.equal(typed.isError,undefined,JSON.stringify(typed.structuredContent));
  await new Promise(r=>setTimeout(r,150)); assert.equal((await command({action:'report'})).text,text); report.nativeUnicodeInput=true;
  const autoCapture=await call({action:'observe',session_id:id});
  report.compression=Object.fromEntries(Object.entries(autoCapture.structuredContent.screenshot).filter(([k])=>['mime_type','byte_length','source_byte_length','candidates','compression'].includes(k)));
  const finalCapture=await call({action:'observe',session_id:id,format:'png'});
  const screenshot=finalCapture.structuredContent.screenshot;
  assert.equal(screenshot.data,finalCapture.content.find(x=>x.type==='image').data);
  const png=Buffer.from(screenshot.data,'base64');
  assert.equal(require('node:crypto').createHash('sha256').update(png).digest('hex'),screenshot.sha256);
  assert.equal(png.length,screenshot.byte_length);
  fs.writeFileSync(path.join(output,'structured-screenshot-fallback.png'),png); report.structuredScreenshotFallback=true;
  fs.writeFileSync(path.join(output,'session-recovery-fixture-final.png'),Buffer.from(finalCapture.content.find(x=>x.type==='image').data,'base64'));
  assert.equal((await call({action:'open_session'})).structuredContent.session_id,id);
  assert.equal((await command({action:'report'})).text,text); report.noInputReplay=true;
  const forced=(await call({action:'observe',session_id:id,format:'png',delivery:'chunked'})).structuredContent.screenshot;
  assert.equal(forced.delivery,'chunked');
  assert.equal((await call({action:'read_screenshot',session_id:id,screenshot_id:forced.screenshot_id})).structuredContent.screenshot.eof,true);
  report.forcedChunkDelivery=true;
  await command({action:'noise'});
  const large=await call({action:'observe',session_id:id}); assert.equal(large.isError,undefined,JSON.stringify(large.structuredContent));
  const meta=large.structuredContent.screenshot;
  assert.ok(meta.source_byte_length>2*1024*1024);assert.ok(meta.byte_length>2*1024*1024);
  assert.equal(meta.delivery,'chunked');assert.equal(meta.data,undefined);assert.equal(large.content.some(c=>c.type==='image'),false);
  const chunks=[];let offset=0, maxResponseBytes=Buffer.byteLength(JSON.stringify(large));
  while(offset<meta.byte_length){
    const value=await call({action:'read_screenshot',session_id:id,screenshot_id:meta.screenshot_id,offset});
    assert.equal(value.isError,undefined,JSON.stringify(value.structuredContent));
    const chunk=value.structuredContent.screenshot;const bytes=Buffer.from(chunk.data,'base64');
    assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'),chunk.chunk_sha256);
    if(offset===0)assert.deepEqual((await call({action:'read_screenshot',session_id:id,screenshot_id:meta.screenshot_id,offset})).structuredContent,value.structuredContent);
    chunks.push(bytes);offset=chunk.next_offset;assert.equal(chunk.eof,offset===meta.byte_length);
    maxResponseBytes=Math.max(maxResponseBytes,Buffer.byteLength(JSON.stringify(value)));
  }
  const assembled=Buffer.concat(chunks);assert.equal(assembled.length,meta.byte_length);
  assert.equal(require('node:crypto').createHash('sha256').update(assembled).digest('hex'),meta.sha256);
  const decoded=await require('sharp')(assembled).metadata();assert.equal(decoded.width,large.structuredContent.width);assert.equal(decoded.height,large.structuredContent.height);
  fs.writeFileSync(path.join(output,'chunked-large-fixture.'+(meta.mime_type==='image/png'?'png':'webp')),assembled);
  assert.ok(maxResponseBytes<8*1024*1024);
  report.largeScreenshot={source_byte_length:meta.source_byte_length,byte_length:meta.byte_length,mime_type:meta.mime_type,chunks:chunks.length,maxResponseBytes,sha256:meta.sha256,reassembled:true};
  await call({action:'observe',session_id:id,format:'png',delivery:'chunked'});
  assert.equal((await call({action:'read_screenshot',session_id:id,screenshot_id:meta.screenshot_id})).structuredContent.code,'CU_SCREENSHOT_EXPIRED');
  assert.equal((await call({action:'close_session'})).structuredContent.closed,true); report.closeWithoutId=true;
  assert.equal((await call({action:'observe',session_id:id})).structuredContent.code,'CU_SESSION_CLOSED');
  const next=await call({action:'open_session',window_id:targetInfo.window_id}); assert.notEqual(next.structuredContent.session_id,id);
  assert.equal((await call({action:'close_session'})).structuredContent.closed,true);
  assert.equal((await call({action:'get_session'})).structuredContent.state,'closed'); report.pendingConsentCleanup=true;
  if(process.argv.includes('--control-app')) {
    // All following UI operations also go through the real Harness gateway and
    // namespaced computer-use tool, never an external computer-use provider.
    fixture.stdin.end();
    const windows=(await call({action:'list_windows'})).structuredContent.windows.filter(w=>w.title==='ChatToHarness');
    assert.equal(windows.length,1,'Expected one ChatToHarness app window');
    const appSession=(await call({action:'open_session',window_id:windows[0].window_id})).structuredContent.session_id;
    for(let i=0;i<50;i++){if((await call({action:'get_session'})).structuredContent.state==='ready')break;await new Promise(r=>setTimeout(r,100));}
    assert.equal((await call({action:'activate',session_id:appSession})).structuredContent.foreground,true);
    let observation;
    async function show() {
      const value=await call({action:'observe',session_id:appSession,format:'png'});
      if(value.isError)throw Error(JSON.stringify(value.structuredContent));
      observation=value.structuredContent.observation_id;
      const imagePath=path.join(output,'localharness-app-control.png');
      fs.writeFileSync(imagePath,Buffer.from(value.content.find(x=>x.type==='image').data,'base64'));
      const {screenshot,...metadata}=value.structuredContent;
      console.log(JSON.stringify({controlReady:true,tool:'windows-computer__computer_use',result:metadata,image_path:imagePath}));
    }
    await show();
    const controls=createInterface({input:process.stdin,terminal:false});
    for await(const line of controls){
      const args=JSON.parse(line);if(args.action==='quit')break;
      const result=await call({...args,session_id:appSession,...(['click','type_text','key_press','scroll'].includes(args.action)?{observation_id:observation}:{})});
      const {screenshot,...metadata}=result.structuredContent;
      console.log(JSON.stringify({operation:args.action,result:metadata,isError:result.isError||false}));
      await show();
    }
    controls.close(); process.stdin.pause();
    await call({action:'close_session'});
  }
}
main().catch(error => {report.error=error.stack || error.message; process.exitCode=1;}).finally(async () => {
  await client?.close().catch(()=>{}); await manager?.close().catch(()=>{});
  if (fixture && fixture.exitCode === null && fixture.signalCode === null) {
    const exited = new Promise(resolve => {fixture.once('exit',resolve);setTimeout(resolve,2500).unref();});
    fixture.stdin.end(); fixture.kill(); await exited;
  }
  lines?.close();
  fs.mkdirSync(output,{recursive:true});
  const reportFile=process.argv.includes('--atomic-drag')?'windows-atomic-drag-result.json':
    perWindow?'per-window-recovery-result.json':'session-recovery-result.json';
  fs.writeFileSync(path.join(output,reportFile),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  if(path.dirname(directory)===path.resolve(os.tmpdir()) && path.basename(directory).startsWith('cth-mcp-recovery-')) fs.rmSync(directory,{recursive:true,force:true,maxRetries:4,retryDelay:300});
});
