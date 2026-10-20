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
  async function call(args) { return client.callTool({name: 'windows-computer__computer_use', arguments: args}); }
  const tools = await client.listTools(); assert.ok(tools.tools[0].inputSchema.properties.action.enum.includes('get_session'));
  report.realMcp = true;
  report.localHarnessGateway=true; report.tool='windows-computer__computer_use';
  const targetInfo=await command({action:'report'});
  const listed=await call({action:'list_windows'});
  if(perWindow)assert.equal(listed.structuredContent.code,'CU_WINDOW_LIST_NOT_AUTHORIZED');
  else {assert.ok(listed.structuredContent.windows.some(w=>w.window_id===targetInfo.window_id));report.defaultAllWindows=true;}
  const opened = await call({action: 'open_session',window_id:targetInfo.window_id}); assert.ok(opened.structuredContent.session_id); assert.equal(opened.structuredContent.state,perWindow?'awaiting_consent':'initializing');
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
  fs.mkdirSync(output,{recursive:true}); fs.writeFileSync(path.join(output,perWindow?'per-window-recovery-result.json':'session-recovery-result.json'),JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify(report));
  if(path.dirname(directory)===path.resolve(os.tmpdir()) && path.basename(directory).startsWith('cth-mcp-recovery-')) fs.rmSync(directory,{recursive:true,force:true,maxRetries:4,retryDelay:300});
});
