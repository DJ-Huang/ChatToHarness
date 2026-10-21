'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const sharp = require('sharp');
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
      requests.push(cmd);
      if (cmd.action === 'observe') return {width: 64, height: 48,
        geometry: [10, 20, 74, 68], displays: [{x:-1640,y:-1440,width:2560,height:1440},{x:0,y:0,width:2056,height:1329}], png: pixels.toString('base64')};
      return {foreground: true, ok: true};
    }
  };
  const service = new MacComputerUse({platform: 'darwin', authorizationMode: 'all_windows',
    connect: () => native, ...opts});
  const start = await service.call({action: 'open_session', window_id: '123'});
  await Promise.resolve();
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
  assert.ok(observed.structuredContent.screenshot.sha256);
  assert.equal(observed.content[1].type,'image');
  const obs=observed.structuredContent.observation_id;
  const click=await service.call({action:'click',session_id:session,observation_id:obs,x:22,y:33});
  assert.equal(click.structuredContent.execution_state,'complete');
  assert.deepEqual(requests[1].geometry,[10,20,74,68]);
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
  assert.ok(entry.inputSchema.required.includes('target_device_id'));
  const rejected=await client.callTool({name:'computer_use',arguments:{action:'get_session'}});
  assert.equal(rejected.structuredContent.code,'CU_DEVICE_SELECTION_REQUIRED');
  const status=await client.callTool({name:'computer_use',arguments:{action:'get_session',target_device_id:device.id}});
  assert.equal(status.structuredContent.state,'none');
  const list=await client.callTool({name:'computer_use',arguments:{action:'list_windows',target_device_id:device.id}});
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
  const state=await client.callTool({name:'computer_use',arguments:{action:'get_session',target_device_id:id}});
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
