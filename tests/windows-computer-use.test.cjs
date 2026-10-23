'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {WindowsComputerUse, validate, definition} = require('../app/windows-computer-use.cjs');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAGQAAABQCAIAAABga0e4AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAuUlEQVR4nO3QoQEAAAiAMP9/Wl+QvmUSs7zNP8WswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArP07lnpntGu1Yc0AAAAASUVORK5CYII=';
function fixture(options = {}) {
  const commands = [];
  const native = {ready: Promise.resolve({ready: true}), closed: false, stop() { this.closed = true; },
    async request(args) { if(args.action!=='set_session_title'||options.captureTitle)commands.push(args); return args.action === 'observe' ? {width: 100, height: 80, geometry: [10, 20, 110, 100], displays: [{x:-1920,y:0,width:1920,height:1080},{x:0,y:0,width:2560,height:1440}], png: PNG} : {ok: true, foreground: true}; }};
  const service = new WindowsComputerUse({platform: 'win32', authorizationMode: 'per_window', connect: () => native, ...options});
  return {service, native, commands};
}
async function open(service) { const id=(await service.call({action: 'open_session',session_title:'Computer Use 测试会话'})).structuredContent.session_id; await new Promise(resolve=>setImmediate(resolve)); return id; }
async function observe(service, id) { return (await service.call({action: 'observe', session_id: id})).structuredContent.observation_id; }

test('lossless compression compares formats and preserves exact pixels and dimensions', async () => {
  const sharp = require('sharp');
  const {compressCapture} = require('../app/computer-use-images.cjs');
  const input = Buffer.from(PNG, 'base64');
  const auto = await compressCapture(input, 100, 80);
  assert.ok(auto.bytes.length <= input.length);
  assert.equal(auto.bytes.length, Math.min(...auto.candidates.map(c => c.byte_length)));
  const original = await sharp(input).ensureAlpha().raw().toBuffer();
  assert.deepEqual(await sharp(auto.bytes).ensureAlpha().raw().toBuffer(), original);
  for (const format of ['png', 'webp']) {
    const encoded = await compressCapture(input, 100, 80, format);
    assert.equal(encoded.mime_type, 'image/' + format);
    assert.deepEqual(await sharp(encoded.bytes).ensureAlpha().raw().toBuffer(), original);
  }
  await assert.rejects(compressCapture(input, 99, 80), /CU_INVALID_CAPTURE/);
});

test('large compressed images use bounded repeatable chunks and invalidate on input, refresh, expiry and close', async () => {
  const sharp = require('sharp'); const crypto = require('node:crypto');
  const {service, native} = fixture(); const id = await open(service);
  const pixels = crypto.randomBytes(1100 * 900 * 3);
  const source = await sharp(pixels, {raw: {width: 1100, height: 900, channels: 3}}).png().toBuffer();
  native.request = async () => ({width: 1100, height: 900, geometry: [0, 0, 1100, 900], png: source.toString('base64')});
  const result = await service.call({action: 'observe', session_id: id});
  assert.equal(result.isError, undefined);
  const meta = result.structuredContent.screenshot;
  assert.ok(meta.byte_length > 2 * 1024 * 1024);
  assert.equal(meta.delivery, 'chunked'); assert.equal(meta.data, undefined);
  assert.equal(result.content.some(c => c.type === 'image'), false);
  const read = (offset, length) => service.call({action: 'read_screenshot', session_id: id, screenshot_id: meta.screenshot_id, offset, length});
  const first = await read(0, 100003);
  assert.deepEqual((await read(0, 100003)).structuredContent, first.structuredContent);
  const parts = []; let offset = 0;
  while (offset < meta.byte_length) {
    const value = await read(offset, 100003);
    assert.ok(Buffer.byteLength(JSON.stringify(value)) < 8 * 1024 * 1024);
    const chunk = value.structuredContent.screenshot;
    const part = Buffer.from(chunk.data, 'base64');
    assert.equal(crypto.createHash('sha256').update(part).digest('hex'), chunk.chunk_sha256);
    parts.push(part); offset = chunk.next_offset;
    assert.equal(chunk.eof, offset === meta.byte_length);
  }
  const assembled = Buffer.concat(parts);
  assert.equal(crypto.createHash('sha256').update(assembled).digest('hex'), meta.sha256);
  assert.deepEqual(await sharp(assembled).raw().toBuffer(), pixels);
  assert.equal((await read(meta.byte_length + 1)).structuredContent.code, 'CU_INVALID_ARGUMENT');
  assert.equal((await read(-1)).structuredContent.code, 'CU_INVALID_ARGUMENT');
  assert.equal((await read(0, 524289)).structuredContent.code, 'CU_INVALID_ARGUMENT');
  assert.equal((await service.call({action:'read_screenshot',session_id:'foreign',screenshot_id:meta.screenshot_id})).structuredContent.code,'CU_SESSION_CLOSED');
  service.session.observation.at -= 31000;
  assert.equal((await service.call({action:'key_press',session_id:id,observation_id:result.structuredContent.observation_id,key:'ENTER'})).structuredContent.code,'CU_STALE_OBSERVATION');
  assert.equal((await read(0)).isError, undefined); // Reading never refreshes input authority.
  service.session.capture.expiresAt = Date.now() - 1;
  assert.equal((await read(0)).structuredContent.code, 'CU_SCREENSHOT_EXPIRED');
  await observe(service, id);
  assert.equal((await read(0)).structuredContent.code, 'CU_SCREENSHOT_EXPIRED');
  native.request = async () => ({foreground: true});
  await service.call({action:'activate',session_id:id}); assert.equal(service.session.capture,null);
  service.stop(); assert.equal((await read(0)).structuredContent.code,'CU_SESSION_CLOSED');
});

test('forced chunk delivery works for small snapshots and reads preserve observation', async () => {
  const {service} = fixture(); const id = await open(service);
  const result = await service.call({action:'observe',session_id:id,format:'png',delivery:'chunked'});
  const capture = service.session.capture;
  assert.equal(result.structuredContent.screenshot.delivery,'chunked');
  const observation = service.session.observation;
  const read = await service.call({action:'read_screenshot',session_id:id,screenshot_id:capture.metadata.screenshot_id});
  assert.equal(read.structuredContent.screenshot.eof,true);
  assert.equal(service.session.observation,observation);
  await service.call({action:'key_press',session_id:id,observation_id:observation.id,key:'ENTER'});
  assert.equal(service.session.capture,null); service.stop();
});

test('computer use validates action-specific fields and literal bounded input', () => {
  for (const args of [null, [], {action: 'eval'}, {action: 'open_session',session_title:'Computer Use 测试会话', command: 'cmd'},
    {action: 'click', session_id: 'x', observation_id: 'y', x: NaN, y: 2},
    {action: 'type_text', session_id: 'x', observation_id: 'y', text: 'hello\ncommand'},
    {action: 'type_text', session_id: 'x', observation_id: 'y', text: 'a'.repeat(1001)},
    {action: 'key_press', session_id: 'x', observation_id: 'y', key: 'WIN+R'},
    {action: 'scroll', session_id: 'x', observation_id: 'y', x: 1, y: 2, delta: 11}]) assert.throws(() => validate(args), /CU_INVALID_ARGUMENT/);
  assert.equal(validate({action: 'type_text', session_id: 'x', observation_id: 'y', text: '中文 {ENTER} ; $()'}).text, '中文 {ENTER} ; $()');
  assert.equal(definition.annotations.idempotentHint, false);
});
test('computer use refuses other platforms and stale or foreign sessions', async () => {
  const unsupported = fixture({platform: 'darwin'});
  assert.equal((await unsupported.service.call({action: 'open_session',session_title:'Computer Use 测试会话'})).structuredContent.code, 'CU_WINDOWS_REQUIRED');
  const {service, commands} = fixture(); const id = await open(service);
  assert.equal((await service.call({action: 'observe', session_id: 'foreign'})).isError, true);
  assert.equal((await service.call({action: 'click', session_id: id, observation_id: 'old', x: 1, y: 1})).structuredContent.code, 'CU_STALE_OBSERVATION');
  assert.deepEqual(commands, [{action:'activate'}]); service.stop();
});
test('computer use returns native image, rejects bounds and consumes each observation once', async () => {
  const {service, commands} = fixture(); const id = await open(service);
  const capture = await service.call({action: 'observe', session_id: id});
  assert.equal(capture.content[1].type, 'image'); assert.equal(capture.content[1].data, capture.structuredContent.screenshot.data);
  assert.ok(['image/png','image/webp'].includes(capture.structuredContent.screenshot.mime_type));
  assert.equal(capture.structuredContent.screenshot.byte_length, Buffer.from(capture.structuredContent.screenshot.data, 'base64').length);
  assert.equal(capture.structuredContent.screenshot.sha256, require('node:crypto').createHash('sha256').update(Buffer.from(capture.structuredContent.screenshot.data, 'base64')).digest('hex'));
  assert.equal(JSON.parse(capture.content[0].text).screenshot.data, undefined);
  const obs = capture.structuredContent.observation_id;
  assert.equal((await service.call({action: 'click', session_id: id, observation_id: obs, x: 100, y: 0})).structuredContent.code, 'CU_COORDINATE_OUTSIDE_WINDOW');
  assert.equal((await service.call({action: 'click', session_id: id, observation_id: obs, x: 99, y: 79})).isError, undefined);
  assert.deepEqual(commands.find(c=>c.action==='click').geometry, [10, 20, 110, 100]);
  assert.equal((await service.call({action: 'click', session_id: id, observation_id: obs, x: 1, y: 1})).structuredContent.code, 'CU_STALE_OBSERVATION');
  const fresh = await observe(service, id); service.session.observation.at -= 31000;
  assert.equal((await service.call({action: 'key_press', session_id: id, observation_id: fresh, key: 'ENTER'})).structuredContent.code, 'CU_STALE_OBSERVATION');
  service.stop();
});

test('activation needs no old observation and invalidates it on success or failure', async () => {
  const {service, native, commands} = fixture(); const id = await open(service);
  const old = await observe(service, id);
  const activated = await service.call({action: 'activate', session_id: id});
  assert.equal(activated.structuredContent.foreground, true);
  assert.deepEqual(commands.filter(c=>c.action==='activate'), [{action:'activate'},{action:'activate'}]);
  assert.equal((await service.call({action: 'key_press', session_id: id, observation_id: old, key: 'ENTER'})).structuredContent.code, 'CU_STALE_OBSERVATION');
  await observe(service, id);
  native.request = async () => ({foreground: false});
  assert.equal((await service.call({action: 'activate', session_id: id})).structuredContent.code, 'CU_ACTIVATION_FAILED');
  assert.equal(service.session.observation, null);
  service.stop();
});

test('computer use blocks concurrent native work without unlocking the active request', async () => {
  const {service, native} = fixture(); const id = await open(service);
  let resolve; native.request = () => new Promise(r => { resolve = r; });
  const active = service.call({action: 'observe', session_id: id});
  for (let i = 0; i < 2; i++) assert.equal((await service.call({action: 'observe', session_id: id})).structuredContent.code, 'CU_BUSY');
  resolve({width: 100, height: 80, geometry: [0, 0, 100, 80], png: PNG});
  assert.equal((await active).isError, undefined); service.stop();
});
test('computer use uncertain native failure never replays input and consumes observation', async () => {
  const {service, native, commands} = fixture(); const id = await open(service); const obs = await observe(service, id);
  let count = 0; native.request = async () => { count++; throw Object.assign(new Error(), {code: 'CU_INPUT_FAILED'}); };
  const result = await service.call({action: 'type_text', session_id: id, observation_id: obs, text: '中文'});
  assert.equal(result.structuredContent.execution_state, 'unknown');
  assert.equal(count, 1); assert.deepEqual(commands.map(c=>c.action), ['activate','observe']);
  assert.equal((await service.call({action: 'key_press', session_id: id, observation_id: obs, key: 'ENTER'})).structuredContent.code, 'CU_STALE_OBSERVATION'); service.stop();
});
test('computer use cancellation closes helper and a closed session cannot be reused', async () => {
  const {service, native} = fixture(); const id = await open(service);
  const controller = new AbortController(); let reject;
  native.request = () => new Promise((_r, j) => { reject = j; });
  native.stop = () => { native.closed = true; reject(Object.assign(new Error(), {code: 'CU_SESSION_CLOSED'})); };
  const active = service.call({action: 'observe', session_id: id}, {signal: controller.signal});
  controller.abort(); assert.equal((await active).isError, true); assert.equal(native.closed, true);
  assert.equal((await service.call({action: 'observe', session_id: id})).structuredContent.code, 'CU_SESSION_CLOSED');
});
test('computer use local consent denial yields no session and no desktop input', async () => {
  const native = {closed: true, ready: Promise.reject(Object.assign(new Error(), {code: 'CU_CONSENT_DENIED'})), stop() {}};
  const service = new WindowsComputerUse({platform: 'win32', connect: () => native});
  const initial = await service.call({action: 'open_session',session_title:'Computer Use 测试会话'});
  assert.ok(initial.structuredContent.session_id);
  const result = await service.call({action: 'get_session'});
  assert.equal(result.structuredContent.code, 'CU_CONSENT_DENIED');
  assert.equal(result.structuredContent.state, 'closed');
});
test('computer use timeout kills native consent wait rather than leaving an orphan picker', async () => {
  let reject;
  const native = {closed: false, ready: new Promise((_r, j) => { reject = j; }), stop() { this.closed = true; reject(Object.assign(new Error(), {code: 'CU_SESSION_CLOSED'})); }};
  const service = new WindowsComputerUse({platform: 'win32', authorizationMode: 'per_window', connect: () => native, timeoutMs: 15});
  const result = await service.call({action: 'open_session',session_title:'Computer Use 测试会话'});
  assert.equal(result.structuredContent.state, 'awaiting_consent');
  await new Promise(r => setTimeout(r, 35));
  assert.equal((await service.call({action: 'get_session'})).structuredContent.code, 'CU_CONSENT_TIMEOUT');
  assert.equal(native.closed, true); assert.equal(service.busy, false);
});
test('computer use closes a live helper on explicit close and requires fresh consent', async () => {
  const {service, native} = fixture(); const id = await open(service);
  assert.equal((await service.call({action: 'open_session',session_title:'Computer Use 测试会话'})).structuredContent.session_id, id);
  assert.equal((await service.call({action: 'close_session', session_id: id})).structuredContent.closed, true);
  assert.equal(native.closed, true); assert.equal(service.session, null);
});
test('computer use recovers a lost open response and can close the current session without its ID', async () => {
  const {service, native} = fixture();
  await service.call({action: 'open_session',session_title:'Computer Use 测试会话'}); // Simulate discarding the delivered response.
  await new Promise(resolve=>setImmediate(resolve));
  const recovered = await service.call({action: 'get_session'});
  assert.equal(recovered.structuredContent.state, 'ready');
  assert.ok(recovered.structuredContent.session_id);
  assert.equal((await service.call({action: 'open_session',session_title:'Computer Use 测试会话'})).structuredContent.session_id, recovered.structuredContent.session_id);
  assert.equal((await service.call({action: 'observe', session_id: recovered.structuredContent.session_id})).content[1].type, 'image');
  assert.equal((await service.call({action: 'close_session'})).structuredContent.closed, true);
  assert.equal(native.closed, true);
});
test('computer use returns an ID before consent and cancelling the completed open does not destroy the session', async () => {
  let resolve; const native = {closed: false, ready: new Promise(r => { resolve = r; }), stop() { this.closed = true; }};
  let connections = 0;
  const service = new WindowsComputerUse({platform: 'win32', authorizationMode: 'per_window', connect: () => { connections++; return native; }});
  const controller = new AbortController();
  const first = await service.call({action: 'open_session',session_title:'Computer Use 测试会话'}, {signal: controller.signal});
  const id = first.structuredContent.session_id;
  assert.ok(id); assert.equal(JSON.parse(first.content[0].text).session_id, id);
  assert.equal(first.structuredContent.state, 'awaiting_consent');
  controller.abort();
  assert.equal((await service.call({action: 'get_session'})).structuredContent.session_id, id);
  assert.equal((await service.call({action: 'open_session',session_title:'Computer Use 测试会话'})).structuredContent.session_id, id);
  assert.equal(connections, 1);
  assert.equal((await service.call({action: 'observe', session_id: id})).structuredContent.code, 'CU_CONSENT_PENDING');
  native.request=async()=>({ok:true});
  resolve({ready: true}); await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await service.call({action: 'get_session'})).structuredContent.state, 'ready'); service.stop();
});
test('computer use refuses foreign close IDs and closes pending consent without an ID', async () => {
  const native = {closed: false, ready: new Promise(() => {}), stop() { this.closed = true; }};
  const service = new WindowsComputerUse({platform: 'win32', connect: () => native});
  await service.call({action: 'open_session',session_title:'Computer Use 测试会话'});
  assert.equal((await service.call({action: 'close_session', session_id: 'foreign'})).structuredContent.code, 'CU_SESSION_CLOSED');
  assert.equal(native.closed, false);
  assert.equal((await service.call({action: 'close_session'})).structuredContent.closed, true);
  assert.equal(native.closed, true);
  assert.equal((await service.call({action: 'get_session'})).structuredContent.state, 'closed');
});
test('computer use defaults to all-window configuration and refuses request-time policy changes', async () => {
  const {service} = fixture({authorizationMode: 'all_windows'});
  const opened = await service.call({action: 'open_session',session_title:'Computer Use 测试会话',window_id:'123'});
  assert.equal(opened.structuredContent.authorization_mode,'all_windows');
  assert.equal(opened.structuredContent.state,'initializing');
  assert.equal((await service.call({action:'open_session',session_title:'Computer Use 测试会话',window_id:'456'})).structuredContent.code,'CU_SESSION_TARGET_MISMATCH');
  assert.throws(()=>validate({action:'open_session',session_title:'Computer Use 测试会话',authorization_mode:'all_windows'}),/CU_INVALID_ARGUMENT/);
  service.stop();
  assert.throws(()=>new WindowsComputerUse({authorizationMode:'bad'}),/CU_INVALID_AUTHORIZATION_MODE/);
});
test('computer use only lists windows in globally authorized mode', async () => {
  const scoped=fixture(); assert.equal((await scoped.service.call({action:'list_windows'})).structuredContent.code,'CU_WINDOW_LIST_NOT_AUTHORIZED');
  let stopped=false;
  const service=new WindowsComputerUse({platform:'win32',authorizationMode:'all_windows',connect:options=>{
    assert.equal(options.operation,'list_windows');return {ready:Promise.resolve({windows:[{window_id:'123',title:'synthetic fixture'}]}),stop(){stopped=true;}};
  }});
  assert.equal((await service.call({action:'list_windows'})).structuredContent.windows[0].window_id,'123'); assert.equal(stopped,true);
});
test('computer use can close busy input and old completion cannot clear a newer session', async () => {
  let reject;
  const first={ready:Promise.resolve({ready:true}),closed:false,request:cmd=>['set_session_title','activate'].includes(cmd.action)?Promise.resolve({ok:true,foreground:true}):new Promise((_r,j)=>{reject=j;}),stop(){this.closed=true;reject?.(Object.assign(new Error(),{code:'CU_SESSION_CLOSED'}));}};
  const second={ready:Promise.resolve({ready:true}),closed:false,request:async()=>({ok:true}),stop(){this.closed=true;}};
  let count=0;const service=new WindowsComputerUse({platform:'win32',connect:()=>++count===1?first:second});
  const id=await open(service);service.session.observation={id:'obs',at:Date.now(),width:10,height:10,geometry:[0,0,10,10]};
  const active=service.call({action:'type_text',session_id:id,observation_id:'obs',text:'fixture'});
  assert.equal((await service.call({action:'get_session'})).structuredContent.session_id,id);
  await service.call({action:'close_session'});const next=await open(service);
  assert.equal((await active).structuredContent.execution_state,'unknown');
  assert.equal((await service.call({action:'get_session'})).structuredContent.session_id,next);
  assert.equal(second.closed,false);service.stop();
});
test('computer use stdio MCP discovers tool without opening native UI', {skip: process.platform !== 'win32'}, async t => {
  const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
  const {StdioClientTransport} = require('@modelcontextprotocol/sdk/client/stdio.js');
  const path = require('node:path');
  const client = new Client({name: 'computer-use-test', version: '1'});
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({command: process.execPath, args: [path.resolve(__dirname, '../app/windows-computer-use-stdio.cjs')], stderr: 'pipe'}));
  const tools = await client.listTools(); assert.equal(tools.tools.length, 1); assert.equal(tools.tools[0].name, 'computer_use');
  const {NEW_RE}=require('../app/computer-use-task-ids.cjs');
  assert.equal(tools.tools[0].inputSchema.properties.task_id.pattern,NEW_RE.source);
  const nextId='cu-20436e7e-24f0-4f0a-a37d-1d174c1efe69_9999999999999';
  assert.match(nextId,NEW_RE);
  const get=await client.callTool({name:'computer_use',arguments:{action:'get_task',task_id:nextId,session_id:'synthetic'}});
  assert.equal(get.structuredContent.code,'CU_TASK_NOT_FOUND');
  assert.ok(tools.tools[0].outputSchema.properties.session_id);
  const status = await client.callTool({name: 'computer_use', arguments: {action: 'get_session'}});
  assert.equal(status.structuredContent.state, 'none');
  const invalid = await client.callTool({name: 'computer_use', arguments: {action: 'eval'}});
  assert.equal(invalid.isError, true);
});

test('Windows HUD title is passed through private stdio without exposing it in status',async () => {
  const {service,commands}=fixture({captureTitle:true});
  const opened=await service.call({action:'open_session',session_title:'移动窗口'});
  for(let i=0;i<5;i++) await new Promise(resolve=>setImmediate(resolve));
  assert.equal(commands.filter(x=>x.action==='set_session_title').length,1);
  assert.deepEqual(commands.find(x=>x.action==='set_session_title'),
    {action:'set_session_title',title:'移动窗口'});
  const status=await service.call({action:'get_session',session_id:opened.structuredContent.session_id});
  assert.equal(status.structuredContent.state,'ready');
  assert.equal(JSON.stringify(status.structuredContent).includes('移动窗口'),false);
  assert.equal((await service.call({action:'close_session'})).structuredContent.closed,true);
});

test('verified chat title remains separate from actual task label and stays private', async () => {
  const {service,commands}=fixture({captureTitle:true});
  const opened=await service.call({action:'open_session',
    session_title:'移动测试窗口',conversation_title:'Computer Use 修复验收'});
  for(let i=0;i<6;i++) await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(commands.filter(c=>c.action==='set_session_title'),
    [{action:'set_session_title',title:'移动测试窗口'}]);
  assert.deepEqual(commands.filter(c=>c.action==='set_conversation_title'),
    [{action:'set_conversation_title',title:'Computer Use 修复验收'}]);
  assert.equal(commands.filter(c=>c.action==='activate').length,1);
  assert.equal(JSON.stringify((await service.call({action:'get_session',
    session_id:opened.structuredContent.session_id})).structuredContent).includes('修复验收'),false);
  assert.throws(()=>validate({action:'open_session',session_title:'Task',
    conversation_title:'fake\nheader'}),/CU_INVALID_ARGUMENT/);
  await service.call({action:'close_session'});
});

test('Windows mouse actions preserve screen coordinates, transitions and fresh observations', async () => {
  const {service, commands} = fixture(); const id = await open(service);
  for (const action of ['mouse_move', 'mouse_down', 'mouse_drag', 'mouse_up'])
    assert.ok(definition.inputSchema.properties.action.enum.includes(action));
  const first = await service.call({action:'observe',session_id:id});
  assert.deepEqual(first.structuredContent.desktop_displays[0], {x:-1920,y:0,width:1920,height:1080});
  assert.equal(first.structuredContent.desktop_coordinate_space,'virtual_screen_pixels');
  const move = await service.call({action:'mouse_move',session_id:id,observation_id:first.structuredContent.observation_id,x:12,y:8});
  assert.equal(move.structuredContent.mouse_button_held,false);
  const second = await observe(service,id);
  const down = await service.call({action:'mouse_down',session_id:id,observation_id:second,x:12,y:8});
  assert.equal(down.structuredContent.mouse_button_held,true);
  assert.equal((await service.call({action:'get_session',session_id:id})).structuredContent.mouse_button_held,true);
  assert.equal((await service.call({action:'click',session_id:id,observation_id:second,x:12,y:8})).structuredContent.code,'CU_MOUSE_BUTTON_HELD');
  const third = await observe(service,id);
  assert.equal((await service.call({action:'mouse_drag',session_id:id,observation_id:third,screen_x:-1921,screen_y:200})).structuredContent.code,'CU_COORDINATE_OUTSIDE_DISPLAY');
  const fourth = await observe(service,id);
  const drag = await service.call({action:'mouse_drag',session_id:id,observation_id:fourth,screen_x:-900,screen_y:150});
  assert.equal(drag.structuredContent.mouse_button_held,true);
  assert.equal(commands.at(-1).screen_x,-900);
  assert.deepEqual(commands.at(-1).geometry,[10,20,110,100]);
  assert.equal((await service.call({action:'mouse_drag',session_id:id,observation_id:fourth,screen_x:100,screen_y:100})).structuredContent.code,'CU_STALE_OBSERVATION');
  const release = await service.call({action:'mouse_up',session_id:id});
  assert.equal(release.structuredContent.mouse_button_held,false);
  assert.equal(commands.at(-1).action,'mouse_up');
  assert.equal(commands.at(-1).geometry,undefined);
  assert.equal((await service.call({action:'mouse_up',session_id:id})).structuredContent.code,'CU_MOUSE_NOT_HELD');
  service.stop();
});

test('Windows atomic drag uses a fresh observation and never leaves a held button',async () => {
  const {service,commands}=fixture();
  const id=await open(service);
  const first=await observe(service,id);
  const moved=await service.call({action:'drag_window',session_id:id,
    observation_id:first,x:80,y:20,screen_x:-800,screen_y:160});
  assert.equal(moved.structuredContent.mouse_button_held,false);
  assert.equal(commands.at(-1).action,'drag_window');
  assert.equal(commands.at(-1).screen_x,-800);
  assert.equal((await service.call({action:'get_session'})).structuredContent.mouse_button_held,false);
  const replay=await service.call({action:'drag_window',session_id:id,
    observation_id:first,x:80,y:20,screen_x:-800,screen_y:160});
  assert.equal(replay.structuredContent.code,'CU_STALE_OBSERVATION');
  assert.equal((await service.call({action:'close_session'})).structuredContent.closed,true);
});

test('Windows atomic drag occlusion is recoverable, unknown input failure aborts',async () => {
  const {service,native,commands}=fixture();
  const id=await open(service);
  const real=native.request;
  native.request=async command => {
    if(command.action==='drag_window') throw Object.assign(
      new Error('CU_TARGET_OCCLUDED'),{code:'CU_TARGET_OCCLUDED',
        occlusion:{reason:'all_titlebar_candidates_blocked',
          candidates:[{candidate_x:80,blocker:{window_id:'5',owner_pid:100}}]}});
    return real(command);
  };
  const first=await observe(service,id);
  const blocked=await service.call({action:'drag_window',session_id:id,
    observation_id:first,x:80,y:20,screen_x:100,screen_y:160});
  assert.equal(blocked.structuredContent.code,'CU_TARGET_OCCLUDED');
  assert.equal(blocked.structuredContent.execution_state,'not_started');
  assert.equal(blocked.structuredContent.operation_executed,false);
  assert.equal(blocked.structuredContent.next_action,'observe');
  assert.equal(blocked.structuredContent.occlusion.candidates[0].blocker.window_id,'5');
  assert.equal((await service.call({action:'get_session'})).structuredContent.state,'ready');
  assert.equal(commands.filter(x=>x.action==='drag_window').length,0);
  native.request=async command => {
    if(command.action==='drag_window') throw Object.assign(new Error('CU_INPUT_FAILED'),{code:'CU_INPUT_FAILED'});
    return real(command);
  };
  const second=await observe(service,id);
  const failed=await service.call({action:'drag_window',session_id:id,
    observation_id:second,x:80,y:20,screen_x:100,screen_y:160});
  assert.equal(failed.structuredContent.code,'CU_INPUT_FAILED');
  assert.equal(native.closed,true);
  assert.equal(service.session,null);
});

test('Windows atomic pre-press input conflict and foreground loss do not end the session', async () => {
  const {service,native}=fixture();
  const id=await open(service);
  const original=native.request;
  for (const code of ['CU_USER_INPUT_ACTIVE','CU_WINDOW_NOT_FOREGROUND']) {
    native.request=async command => {
      if (command.action==='drag_window') throw Object.assign(new Error(code),{code,inputStarted:false});
      return original(command);
    };
    const fresh=await observe(service,id);
    const failed=await service.call({action:'drag_window',session_id:id,
      observation_id:fresh,x:80,y:20,screen_x:100,screen_y:160});
    assert.equal(failed.structuredContent.code,code);
    assert.equal(failed.structuredContent.execution_state,'not_started');
    assert.equal(failed.structuredContent.task_state,'recovering');
    assert.equal(failed.structuredContent.replay_same_input,false);
    assert.equal(failed.structuredContent.next_action,
      code==='CU_WINDOW_NOT_FOREGROUND' ? 'activate' : 'wait_for_input_release_then_observe');
    assert.equal((await service.call({action:'get_session'})).structuredContent.state,'ready');
  }
  native.request=original;
  const final=await observe(service,id);
  assert.equal((await service.call({action:'drag_window',session_id:id,
    observation_id:final,x:80,y:20,screen_x:100,screen_y:160})).structuredContent.execution_state,'complete');
  assert.equal((await service.call({action:'close_session'})).structuredContent.closed,true);
});

test('Windows atomic input already started ends the unsafe session rather than replaying',async()=>{
  const {service,native}=fixture(); const id=await open(service);
  const original=native.request;
  native.request=async command => {
    if(command.action==='drag_window') throw Object.assign(new Error('CU_USER_INPUT_ACTIVE'),
      {code:'CU_USER_INPUT_ACTIVE',inputStarted:true});
    return original(command);
  };
  const obs=await observe(service,id);
  const failed=await service.call({action:'drag_window',session_id:id,
    observation_id:obs,x:80,y:20,screen_x:100,screen_y:160});
  assert.equal(failed.structuredContent.task_state,'session_terminated');
  assert.equal(native.closed,true);
  assert.equal((await service.call({action:'get_session'})).structuredContent.state,'closed');
});

test('verified left-button release permits safe observation after drag takeover',async()=>{
  const {service,native}=fixture();const id=await open(service);
  const original=native.request;
  native.request=async command=>{
    if(command.action==='drag_window')
      throw Object.assign(new Error('CU_USER_INPUT_ACTIVE'),{
        code:'CU_USER_INPUT_ACTIVE',inputStarted:true,mouseReleased:true,
        inputConflict:{reason:'sustained_pointer_takeover'}
      });
    return original(command);
  };
  const shot=await observe(service,id);
  const failed=await service.call({action:'drag_window',session_id:id,
    observation_id:shot,x:80,y:20,screen_x:100,screen_y:160});
  assert.equal(failed.structuredContent.code,'CU_USER_INPUT_ACTIVE');
  assert.equal(failed.structuredContent.execution_state,'unknown');
  assert.equal(failed.structuredContent.task_state,'recovering');
  assert.equal(failed.structuredContent.replay_same_input,false);
  assert.deepEqual(failed.structuredContent.input_conflict,
    {reason:'sustained_pointer_takeover'});
  assert.equal(native.closed,false);
  assert.equal((await service.call({action:'get_session'})).structuredContent.state,'ready');
  assert.equal((await service.call({action:'observe',session_id:id})).isError,undefined);
  assert.equal((await service.call({action:'close_session'})).structuredContent.closed,true);
});

test('Mouse drag cannot start without mouse_down and failure releases session', async () => {
  const {service,native} = fixture();const id = await open(service);
  const obs = await observe(service,id);
  assert.equal((await service.call({action:'mouse_drag',session_id:id,observation_id:obs,screen_x:0,screen_y:0})).structuredContent.code,'CU_MOUSE_NOT_HELD');
  const down = await service.call({action:'mouse_down',session_id:id,observation_id:obs,x:4,y:5});
  assert.equal(down.structuredContent.mouse_button_held,true);
  native.request = async () => {throw Object.assign(new Error('input failed'),{code:'CU_INPUT_FAILED'});};
  const obsResult = await service.call({action:'observe',session_id:id});
  assert.equal(obsResult.structuredContent.code,'CU_INPUT_FAILED');
  assert.equal(service.session !== null,true); // Observe failure must not silently clear a held state.
  const result = await service.call({action:'mouse_up',session_id:id});
  assert.equal(result.isError,true);
  assert.equal(native.closed,true);
  assert.equal(service.session,null);
});

test('Invalid desktop mouse coordinates and extra fields fail closed', () => {
  for (const value of [
    {action:'mouse_move',session_id:'s',observation_id:'o',x:-1,y:0},
    {action:'mouse_down',session_id:'s',observation_id:'o',x:0,y:0,button:'right'},
    {action:'mouse_drag',session_id:'s',observation_id:'o',screen_x:1,screen_y:32768},
    {action:'mouse_drag',session_id:'s',observation_id:'o',screen_x:1},
    {action:'mouse_up',session_id:'s',x:1}
  ]) assert.throws(()=>validate(value),/CU_INVALID_ARGUMENT/);
});
