'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const sharp = require('sharp');
const {setTimeout: sleep} = require('node:timers/promises');
const {MacComputerUse, definition} = require('../app/macos-computer-use.cjs');
const {configuration} = require('../scripts/computer-use-config.cjs');

async function fixture(opts = {}) {
  const pixels = await sharp({create: {width: 64, height: 48, channels: 3,
    background: {r: 80, g: 100, b: 130}}}).png().toBuffer();
  const requests = [];
  const native = {
    closed: false,
    ready: Promise.resolve({ready: true, window_id: '123'}),
    stop() {this.closed = true;},
    async request(cmd) {
      if(cmd.action!=='set_session_title')requests.push(cmd);
      if (cmd.action === 'observe') return {width: 64, height: 48,
        geometry: [10, 20, 74, 68], displays: [{x:-1640,y:-1440,width:2560,height:1440},{x:0,y:0,width:2056,height:1329}], png: pixels.toString('base64')};
      return {foreground: true, ok: true};
    }
  };
  const service = new MacComputerUse({platform: 'darwin', authorizationMode: 'all_windows',
    connect: () => native, ...opts});
  const start = await service.call({action: 'open_session',session_title:'Computer Use 测试会话', window_id: '123'});
  await new Promise(resolve=>setImmediate(resolve));
  return {native, service, requests, session: start.structuredContent.session_id};
}

test('Mac service advertises same bounded computer_use schema with Mac permissions', () => {
  assert.equal(definition.name, 'computer_use');
  assert.match(definition.description, /macOS Screen Recording and Accessibility/);
  assert.ok(definition.inputSchema.properties.action.enum.includes('read_screenshot'));
  assert.ok(definition.inputSchema.properties.action.enum.includes('close_session'));
  const service = new MacComputerUse({platform:'win32', connect:()=>{throw Error('should not connect');}});
  // A Mac-only service never silently dispatches on a Windows host.
  return service.call({action:'get_session'}).then(result =>
    assert.equal(result.structuredContent.code, 'CU_MACOS_REQUIRED'));
});

test('Mac MCP uses safe fresh screenshot geometry and consumes input observations', async () => {
  const {native,service,requests,session} = await fixture();
  assert.equal((await service.call({action:'get_session'})).structuredContent.state,'ready');
  const observed = await service.call({action:'observe',session_id:session,format:'png'});
  assert.equal(observed.isError, undefined);
  assert.equal(observed.structuredContent.coordinate_space,'window_pixels');
  assert.deepEqual(observed.structuredContent.window_bounds,{x:10,y:20,width:64,height:48});
  assert.ok(observed.structuredContent.screenshot.sha256);
  assert.equal(observed.content[1].type,'image');
  const obs=observed.structuredContent.observation_id;
  const click=await service.call({action:'click',session_id:session,observation_id:obs,x:22,y:33});
  assert.equal(click.structuredContent.execution_state,'complete');
  assert.deepEqual(requests.find(cmd=>cmd.action==='click').geometry,[10,20,74,68]);
  assert.equal((await service.call({action:'click',session_id:session,observation_id:obs,x:1,y:1})).structuredContent.code,'CU_STALE_OBSERVATION');
  assert.equal((await service.call({action:'close_session',session_id:session})).structuredContent.closed,true);
  assert.equal(native.closed,true);
});

test('Mac chunks are repeatable and do not renew observation authority', async () => {
  const {service,session} = await fixture();
  const observed=await service.call({action:'observe',session_id:session,delivery:'chunked'});
  assert.equal(observed.structuredContent.screenshot.delivery,'chunked');
  const meta=observed.structuredContent.screenshot;
  const part=await service.call({action:'read_screenshot',session_id:session,screenshot_id:meta.screenshot_id,offset:0,length:100});
  assert.equal(part.structuredContent.screenshot.offset,0);
  assert.equal((await service.call({action:'close_session'})).structuredContent.closed,true);
});

test('Mac helper compiles into a native executable that fails closed without TCC', {skip: process.platform!=='darwin'}, () => {
  const helper = path.resolve(__dirname,'../resources/computer-use/ChatToHarness.MacComputerUse');
  const run=spawnSync(helper,[String(process.pid),'list_windows','0'],{encoding:'utf8',timeout:5000});
  assert.equal(run.status,0);
  const result=JSON.parse(run.stdout.trim());
  assert.ok(Array.isArray(result.windows) ||
    ['CU_SCREEN_RECORDING_REQUIRED','CU_NATIVE_ERROR'].includes(result.error));
  assert.ok(!('png' in result));
});

test('macOS packaged MCP configuration references dedicated native files', {skip: process.platform!=='darwin'}, () => {
  // Validate the emitted configuration without requiring the full installer payload.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatharness-cu-config-'));
  try {
    const directory = path.join(root, 'computer-use');
    fs.mkdirSync(path.join(root,'node','bin'), {recursive:true});
    fs.mkdirSync(path.join(directory,'app'), {recursive:true});
    for (const file of [path.join(root,'node','bin','node'),
      path.join(directory,'app','macos-computer-use-stdio.cjs'),
      path.join(directory,'ChatToHarness.MacComputerUse')]) fs.writeFileSync(file, '');
    const config=configuration(directory,'darwin');
    assert.ok(config.mcpServers['macos-computer']);
    assert.match(config.mcpServers['macos-computer'].command,/node$/);
    assert.match(config.mcpServers['macos-computer'].args[0],/macos-computer-use-stdio\.cjs$/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('macOS MCP stdio discovers tool and reports helper permission denial safely', {skip: process.platform!=='darwin'}, async t => {
  const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
  const {StdioClientTransport} = require('@modelcontextprotocol/sdk/client/stdio.js');
  const client = new Client({name:'cu-mac-fixture',version:'1'});
  t.after(()=>client.close());
  await client.connect(new StdioClientTransport({command:process.execPath,
    args:[path.resolve(__dirname,'../app/macos-computer-use-stdio.cjs')],stderr:'pipe'}));
  const tools=await client.listTools();
  assert.equal(tools.tools.length,1);
  const entry=tools.tools[0];
  assert.equal(entry.name,'computer_use');
  const device=entry._meta?.['com.chattoharness/device'];
  assert.ok(device?.id && device?.name);
  assert.equal(device.platform,'darwin');
  assert.equal(entry.inputSchema.properties.target_device_id.const,device.id);
  assert.equal(entry.inputSchema.required.includes('target_device_id'),false);
  const rejected=await client.callTool({name:'computer_use',arguments:{action:'get_session',target_device_id:'cu-00000000-0000-4000-8000-000000000000'}});
  assert.equal(rejected.structuredContent.code,'CU_TARGET_DEVICE_MISMATCH');
  const status=await client.callTool({name:'computer_use',arguments:{action:'get_session'}});
  assert.equal(status.structuredContent.state,'none');
  const list=await client.callTool({name:'computer_use',arguments:{action:'list_windows'}});
  assert.ok(Array.isArray(list.structuredContent.windows) ||
    ['CU_SCREEN_RECORDING_REQUIRED','CU_HELPER_UNAVAILABLE','CU_SESSION_CLOSED'].includes(list.structuredContent.code));
});

test('staged Mac bundle exposes MCP tool with bundled Node and isolated dependencies', {skip: process.platform!=='darwin'}, async t => {
  const root=path.resolve(__dirname,'..');
  const bundledNode=path.join(root,'resources/node/bin/node');
  const stagedEntry=path.join(root,'resources/computer-use/app/macos-computer-use-stdio.cjs');
  if (!fs.existsSync(bundledNode) || !fs.existsSync(stagedEntry)) {
    t.skip('resources not prepared; run npm run prepare:resources');
    return;
  }
  const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
  const {StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
  const client=new Client({name:'mac-bundle-smoke',version:'1'});
  t.after(()=>client.close());
  await client.connect(new StdioClientTransport({command:bundledNode,args:[stagedEntry],stderr:'pipe'}));
  const tools=await client.listTools();
  assert.equal(tools.tools.length,1);
  assert.equal(tools.tools[0].name,'computer_use');
  const id=tools.tools[0]._meta?.['com.chattoharness/device']?.id;
  assert.ok(id);
  assert.equal(tools.tools[0].inputSchema.properties.target_device_id.const,id);
  const state=await client.callTool({name:'computer_use',arguments:{action:'get_session'}});
  assert.equal(state.structuredContent.state,'none');
});

test('Mac drag reports Quartz coordinates, holds across observations and releases without one', async () => {
  const {service,requests,session} = await fixture();
  const observed = (await service.call({action:'observe',session_id:session})).structuredContent;
  assert.equal(observed.desktop_coordinate_space,'quartz_points');
  const down=await service.call({action:'mouse_down',session_id:session,observation_id:observed.observation_id,x:25,y:15});
  assert.equal(down.structuredContent.mouse_button_held,true);
  const next=(await service.call({action:'observe',session_id:session})).structuredContent;
  const moved=await service.call({action:'mouse_drag',session_id:session,observation_id:next.observation_id,screen_x:-1200,screen_y:-800});
  assert.equal(moved.structuredContent.mouse_button_held,true);
  assert.deepEqual(requests.at(-1),{action:'mouse_drag',screen_x:-1200,screen_y:-800,geometry:[10,20,74,68]});
  const up=await service.call({action:'mouse_up',session_id:session});
  assert.equal(up.structuredContent.mouse_button_held,false);
  assert.deepEqual(requests.at(-1),{action:'mouse_up'});
  service.stop();
});

test('explicit left button is accepted for native drag begin/release and never sent as an extra helper parameter', async () => {
  const {service, requests, session} = await fixture();
  const observed=(await service.call({action:'observe',session_id:session})).structuredContent;
  const down=await service.call({action:'mouse_down',session_id:session,observation_id:observed.observation_id,x:15,y:12,button:'left'});
  assert.equal(down.structuredContent.execution_state,'complete');
  assert.equal(down.structuredContent.mouse_button_held,true);
  assert.deepEqual(requests.at(-1),{action:'mouse_down',x:15,y:12,geometry:[10,20,74,68]});
  const up=await service.call({action:'mouse_up',session_id:session,button:'left'});
  assert.equal(up.structuredContent.execution_state,'complete');
  assert.equal(up.structuredContent.mouse_button_held,false);
  assert.deepEqual(requests.at(-1),{action:'mouse_up'});
  assert.equal((await service.call({action:'close_session',session_id:session})).structuredContent.closed,true);
});

test('drag right button alias is rejected before touching the native service', async () => {
  const {service,requests,session} = await fixture();
  const observed=(await service.call({action:'observe',session_id:session})).structuredContent;
  const down=await service.call({action:'mouse_down',session_id:session,observation_id:observed.observation_id,x:15,y:12,button:'right'});
  assert.equal(down.structuredContent.code,'CU_INVALID_ARGUMENT');
  assert.equal(down.structuredContent.operation_executed,false);
  assert.deepEqual(requests.map(c=>c.action),['activate','observe']);
  const release=await service.call({action:'mouse_up',session_id:session,button:'right'});
  assert.equal(release.structuredContent.code,'CU_INVALID_ARGUMENT');
  assert.equal(release.structuredContent.operation_executed,false);
  assert.deepEqual(requests.map(c=>c.action),['activate','observe']);
  await service.call({action:'close_session',session_id:session});
});

test('idle session automatically closes its native helper without a subsequent MCP call', async () => {
  const {native,service,session}=await fixture({idleTimeoutMs:80});
  assert.equal(native.closed,false);
  await sleep(175);
  assert.equal(native.closed,true);
  const result=(await service.call({action:'get_session',session_id:session})).structuredContent;
  assert.equal(result.state,'closed');
  assert.equal(result.code,'CU_SESSION_IDLE');
});

test('macOS only accepts a genuinely supplied bounded session title via private native handshake', async () => {
  const requests=[];
  const native={closed:false,ready:Promise.resolve({window_id:'123',input_enabled:true}),
    stop(){this.closed=true;},async request(command){requests.push(command);return {ok:true};}};
  const service=new MacComputerUse({platform:'darwin',connect:()=>native});
  const result=await service.call({action:'open_session',window_id:'123',session_title:'移动窗口'});
  assert.match(result.structuredContent.session_id,/^[0-9a-f-]{36}$/);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(requests,[{action:'set_session_title',title:'移动窗口'},{action:'activate'}]);
  assert.equal((await service.call({action:'get_session'})).structuredContent.state,'ready');
  const closed=await service.call({action:'close_session'});
  assert.equal(closed.structuredContent.closed,true);
  assert.equal(native.closed,true);
  assert.ok(definition.inputSchema.properties.session_title);
  assert.equal(definition.inputSchema.properties.session_title.maxLength,80);
  assert.ok(!definition.inputSchema.properties.action.enum.includes('set_session_title'));
});

test('missing title cannot be fabricated; unsafe or oversized titles are rejected before opening', async () => {
  const {validate,baseDefinition}=require('../app/base-computer-use.cjs');
  assert.doesNotThrow(()=>validate({action:'open_session',session_title:'Computer Use 测试会话',window_id:'123'}));
  assert.equal(Object.hasOwn(baseDefinition.inputSchema.properties,'session_title'),true);
  assert.throws(()=>validate({action:'open_session',window_id:'123'}),/CU_SESSION_TITLE_REQUIRED/);
  for(const name of ['', '  ', 'text\nsecret', 'a'.repeat(81), 123, null]){
    assert.throws(()=>validate({action:'open_session',window_id:'123',session_title:name}),/CU_INVALID_ARGUMENT/);
  }
  assert.throws(()=>validate({action:'observe',session_id:'x',session_title:'not allowed'}),/CU_INVALID_ARGUMENT/);
  const {service,requests,session}=await fixture();
  assert.deepEqual(requests.map(c=>c.action),['activate']);
  assert.equal((await service.call({action:'get_session'})).structuredContent.state,'ready');
  await service.call({action:'close_session',session_id:session});
});

test('title is not echoed into arbitrary mouse, screenshot, status or tool results', async () => {
 const {service,session}=await fixture();
 const state=await service.call({action:'get_session'});
 assert.equal(JSON.stringify(state).includes('session_title'),false);
 await service.call({action:'close_session',session_id:session});
});

test('Mac atomic window drag consumes one observation and never persists a held button', async () => {
  const {service,requests,session} = await fixture();
  assert.ok(definition.inputSchema.properties.action.enum.includes('drag_window'));
  const first=(await service.call({action:'observe',session_id:session})).structuredContent;
  const result=await service.call({action:'drag_window',session_id:session,
    observation_id:first.observation_id,x:30,y:12,screen_x:-1100,screen_y:-900});
  assert.equal(result.structuredContent.execution_state,'complete');
  assert.equal(result.structuredContent.mouse_button_held,false);
  assert.deepEqual(requests.at(-1),{action:'drag_window',x:30,y:12,
    screen_x:-1100,screen_y:-900,geometry:[10,20,74,68]});
  assert.equal((await service.call({action:'drag_window',session_id:session,
    observation_id:first.observation_id,x:30,y:12,screen_x:-1100,screen_y:-900}))
    .structuredContent.code,'CU_STALE_OBSERVATION');
  const second=(await service.call({action:'observe',session_id:session})).structuredContent;
  const offscreen=await service.call({action:'drag_window',session_id:session,
    observation_id:second.observation_id,x:30,y:12,screen_x:-9999,screen_y:-9999});
  assert.equal(offscreen.structuredContent.code,'CU_COORDINATE_OUTSIDE_DISPLAY');
  assert.equal(offscreen.structuredContent.operation_executed,false);
  assert.equal((await service.call({action:'close_session'})).structuredContent.closed,true);
});

test('Mac native occlusion error includes safe bounded blocker identity, without an automatic replay', async () => {
  const {service,native,requests,session} = await fixture();
  const original=native.request.bind(native);
  native.request = async cmd => {
    if(cmd.action==='drag_window') {
      const error=Object.assign(new Error('CU_TARGET_OCCLUDED'), {
        code:'CU_TARGET_OCCLUDED',
        occlusion:{reason:'window_above_target',window_id:'22',owner_pid:77,layer:0,alpha:1}
      });
      throw error;
    }
    return original(cmd);
  };
  const obs=(await service.call({action:'observe',session_id:session})).structuredContent;
  const outcome=await service.call({action:'drag_window',session_id:session,
    observation_id:obs.observation_id,x:30,y:12,screen_x:-1100,screen_y:-900});
  assert.equal(outcome.isError,true);
  assert.equal(outcome.structuredContent.code,'CU_TARGET_OCCLUDED');
  assert.equal(outcome.structuredContent.occlusion.window_id,'22');
  assert.equal(outcome.structuredContent.mouse_button_held,undefined);
  assert.equal(requests.filter(x=>x.action==='drag_window').length,0);
  assert.equal((await service.call({action:'get_session'})).structuredContent.state,'ready');
  assert.equal((await service.call({action:'close_session'})).structuredContent.closed,true);
});

test('macOS recoverable input collision does not cancel an authorized task',async()=>{
  const {native,service,session}=await fixture();
  const original=native.request;
  native.request=async cmd=>{
    if(cmd.action==='mouse_move') throw Object.assign(new Error('CU_USER_INPUT_ACTIVE'),{code:'CU_USER_INPUT_ACTIVE'});
    return original(cmd);
  };
  const obs=(await service.call({action:'observe',session_id:session})).structuredContent;
  const failed=await service.call({action:'mouse_move',session_id:session,
    observation_id:obs.observation_id,x:20,y:10});
  assert.equal(failed.structuredContent.task_state,'recovering');
  assert.equal(failed.structuredContent.next_action,'wait_for_input_release_then_observe');
  assert.equal((await service.call({action:'get_session'})).structuredContent.state,'ready');
  native.request=original;
  const fresh=(await service.call({action:'observe',session_id:session})).structuredContent;
  assert.equal((await service.call({action:'mouse_move',session_id:session,
    observation_id:fresh.observation_id,x:20,y:10})).structuredContent.execution_state,'complete');
  assert.equal((await service.call({action:'close_session'})).structuredContent.closed,true);
});

test('macOS atomic pre-press input conflict keeps the original authorized session',async()=>{
  const {native,service,session}=await fixture();
  const original=native.request;
  native.request=async cmd=>{
    if(cmd.action==='drag_window') throw Object.assign(new Error('CU_USER_INPUT_ACTIVE'),
      {code:'CU_USER_INPUT_ACTIVE',inputStarted:false});
    return original(cmd);
  };
  const before=(await service.call({action:'observe',session_id:session})).structuredContent;
  const outcome=await service.call({action:'drag_window',session_id:session,
    observation_id:before.observation_id,x:30,y:12,screen_x:-1100,screen_y:-900});
  assert.equal(outcome.structuredContent.execution_state,'not_started');
  assert.equal(outcome.structuredContent.task_state,'recovering');
  assert.equal(outcome.structuredContent.recovery_action,'wait_for_input_release_then_observe');
  assert.equal((await service.call({action:'get_session'})).structuredContent.state,'ready');
  native.request=original;
  const fresh=(await service.call({action:'observe',session_id:session})).structuredContent;
  assert.equal((await service.call({action:'drag_window',session_id:session,
    observation_id:fresh.observation_id,x:30,y:12,screen_x:-1100,screen_y:-900})).structuredContent.execution_state,'complete');
  await service.call({action:'close_session'});
});

test('macOS native atomic drag publishes pre-press and post-press state for safe recovery',()=>{
  const swift=fs.readFileSync(path.join(__dirname,'../native/MacComputerUse.swift'),'utf8');
  assert.match(swift,/var atomicInputStarted = false/);
  assert.match(swift,/atomicInputStarted = true\s+try mouse\(\.leftMouseDown/);
  assert.match(swift,/"input_started": atomicInputStarted/);
});

test('Windows exposes the shared atomic window dragging action', () => {
  const {definition:windowsDefinition}=require('../app/windows-computer-use.cjs');
  assert.equal(windowsDefinition.inputSchema.properties.action.enum.includes('drag_window'),true);
  assert.equal(windowsDefinition.inputSchema.properties.session_title.maxLength,80);
});
