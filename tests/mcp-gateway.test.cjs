'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { EventEmitter, once } = require('node:events');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { ToolListChangedNotificationSchema } = require('@modelcontextprotocol/sdk/types.js');
const { McpGateway } = require('../app/mcp-gateway.cjs');
const {McpResultPages,decorateTool} = require('../app/mcp-result-pages.cjs');
const deliveryTools = () => new McpResultPages().tools();

const TEST_TOOL = {
  name: 'unity__inspect', description: 'Test application tool',
  inputSchema: { type: 'object', properties: { label: { type: 'string' } }, additionalProperties: true },
  annotations: { readOnlyHint: false },
};
const relay = path.resolve(__dirname, '../app/mcp-gateway-stdio.cjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class StubManager extends EventEmitter {
  constructor() { super(); this.calls = []; this.tools = [structuredClone(TEST_TOOL)]; this.toolsVersion = 1; this.logs = []; }
  log(event, details) { this.logs.push({ event, ...details }); }
  listTools(cursor) { assert.equal(cursor, undefined); return { tools: structuredClone(this.tools) }; }
  async call(name, args, options) {
    const call = { name, args, ...options };
    this.calls.push(call);
    this.emit('call', call);
    return this.handleCall ? this.handleCall(call) : { content: [{ type: 'text', text: 'ok' }] };
  }
}

class RawPeer {
  constructor(endpoint) {
    this.socket = net.createConnection(endpoint);
    this.messages = [];
    this.waiters = [];
    this.buffer = '';
    this.closed = false;
    this.socket.on('error', () => {});
    this.socket.on('data', chunk => {
      this.buffer += chunk.toString('utf8');
      let end;
      while ((end = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        const index = this.waiters.findIndex(waiter => waiter.predicate(message));
        if (index === -1) this.messages.push(message);
        else { const [waiter] = this.waiters.splice(index, 1); clearTimeout(waiter.timer); waiter.resolve(message); }
      }
    });
    this.socket.once('close', () => {
      this.closed = true;
      for (const waiter of this.waiters.splice(0)) { clearTimeout(waiter.timer); waiter.reject(new Error('Peer closed')); }
    });
  }
  send(message) { this.socket.write(`${JSON.stringify(message)}\n`); }
  waitFor(predicate) {
    const index = this.messages.findIndex(predicate);
    if (index !== -1) return Promise.resolve(this.messages.splice(index, 1)[0]);
    if (this.closed) return Promise.reject(new Error('Peer closed'));
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject };
      waiter.timer = setTimeout(() => { this.waiters = this.waiters.filter(item => item !== waiter); reject(new Error('Gateway response timed out')); }, 5000);
      this.waiters.push(waiter);
    });
  }
  async authenticate(token) {
    if (this.socket.connecting) await once(this.socket, 'connect');
    this.send({ token });
    assert.deepEqual(await this.waitFor(message => message.ready !== undefined), { ready: true });
  }
  async initialize() {
    this.send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'gateway-test', version: '1.0.0' },
    } });
    const result = await this.waitFor(message => message.id === 0);
    assert.equal(result.result.protocolVersion, '2025-11-25');
    this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }
  async close() {
    if (this.closed) return;
    const closed = once(this.socket, 'close');
    this.socket.destroy();
    await closed;
  }
}

async function fixture(t) {
  const manager = new StubManager();
  const gateway = new McpGateway(manager);
  t.after(() => gateway.close());
  await gateway.start();
  return { manager, gateway, environment: gateway.environment() };
}

async function peer(t, environment) {
  const connection = new RawPeer(environment.CTH_GATEWAY_ENDPOINT);
  t.after(() => connection.close());
  await connection.authenticate(environment.CTH_GATEWAY_TOKEN);
  await connection.initialize();
  return connection;
}

test('private gateway authenticates before MCP parsing and never exposes management methods', { timeout: 15000 }, async t => {
  const { gateway, manager, environment } = await fixture(t);
  const unauthorized = new RawPeer(environment.CTH_GATEWAY_ENDPOINT);
  t.after(() => unauthorized.close());
  await once(unauthorized.socket, 'connect');
  const rejected = once(unauthorized.socket, 'close');
  unauthorized.send({ token: '0'.repeat(64) });
  unauthorized.send({ jsonrpc: '2.0', id: 9, method: 'tools/list' });
  await rejected;
  assert.deepEqual(unauthorized.messages, []);
  assert.equal(manager.calls.length, 0);

  const connection = await peer(t, environment);
  for (const [index, method] of ['mcp/servers/list', 'mcp/servers/save', 'mcp/servers/trust', 'mcp/approval/reply', 'resources/list', 'prompts/list'].entries()) {
    const id = 100 + index;
    connection.send({ jsonrpc: '2.0', id, method, params: {} });
    const result = await connection.waitFor(message => message.id === id);
    assert.equal(result.error.code, -32601, method);
    assert.equal(JSON.stringify(result).includes(environment.CTH_GATEWAY_TOKEN), false);
  }
  assert.equal(gateway.sessions.size, 1);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(gateway.directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(environment.CTH_GATEWAY_ENDPOINT).mode & 0o777, 0o600);
  }
});

test('real SDK client preserves arguments and defers native files without rerunning the source tool', { timeout: 15000 }, async t => {
  const { manager, environment } = await fixture(t);
  const expected = {
    content: [
      { type: 'text', text: '中文 result' },
      { type: 'image', mimeType: 'image/png', data: Buffer.from('test-image-bytes').toString('base64') },
      { type: 'resource_link', uri: 'https://example.test/asset', name: 'asset' },
    ],
    structuredContent: { nested: { preserved: true }, values: [null, false, 0] },
    isError: true,
    _meta: { thirdParty: 'retained' },
  };
  manager.handleCall = () => structuredClone(expected);
  const transport = new StdioClientTransport({ command: process.execPath, args: [relay], env: environment, stderr: 'pipe' });
  const stderr = [];
  transport.stderr.on('data', chunk => stderr.push(chunk.toString()));
  const client = new Client({ name: 'upstream-test', version: '1.0.0' }, { capabilities: {} });
  t.after(() => client.close());
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools, [TEST_TOOL,...deliveryTools()]);
  const args = { label: '中文', unchangedPath: '../literal/$HOME', nested: { project_context: false, newline: 'a\nb' }, zero: 0 };
  const result = await client.callTool({ name: TEST_TOOL.name, arguments: args });
  assert.deepEqual(manager.calls[0].args, args);
  assert.equal(manager.calls[0].name, TEST_TOOL.name);
  assert.equal(result.structuredContent.kind,'harness_result_page');
  assert.equal(result.isError,true);
  assert.deepEqual(result._meta,expected._meta);
  const projected=JSON.parse(result.structuredContent.text);
  assert.deepEqual(projected.structuredContent,expected.structuredContent);
  assert.deepEqual(projected.content[0],expected.content[0]);
  for(const [index,block] of expected.content.slice(1).entries()){
    const file=await client.callTool({name:'get_tool_result_file',arguments:{result_id:result.structuredContent.result_id,file_index:index}});
    assert.deepEqual(file.content,[block]);
  }
  assert.equal(manager.calls.length,1);
  const changed = deferred();
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => changed.resolve());
  manager.emit('toolsChanged');
  await changed.promise;
  await client.close();
  assert.equal(stderr.join('').includes(environment.CTH_GATEWAY_TOKEN), false);
  assert.equal(stderr.join(''), '');
});

test('repeated upstream initialize reuses the session and stable tools without logging call data', { timeout: 15000 }, async t => {
  const { manager, gateway, environment } = await fixture(t);
  const connection = await peer(t, environment);
  connection.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const before = (await connection.waitFor(message => message.id === 1)).result;
  await connection.initialize();
  const responseWritten = deferred(), recordLog = manager.log.bind(manager);
  manager.log = (event, details) => { recordLog(event,details);if(event==='mcp-timing'&&details.phase==='response-written'&&details.method==='tools/call')responseWritten.resolve(); };
  connection.send({ jsonrpc: '2.0', id: 'private-json-rpc-id', method: 'tools/call', params: { name: TEST_TOOL.name, arguments: { label: 'private-call-contents' } } });
  await Promise.all([connection.waitFor(message => message.id === 'private-json-rpc-id'), responseWritten.promise]);
  connection.send({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  const after = (await connection.waitFor(message => message.id === 3)).result;
  assert.deepEqual(after, before);
  assert.equal(gateway.sessions.size, 1);
  const initialized = manager.logs.filter(entry => entry.event === 'mcp-session' && entry.phase === 'initialized');
  assert.deepEqual(initialized.map(entry => entry.initializations), [1, 2]);
  assert.equal(initialized[0].session, initialized[1].session);
  for(const entry of initialized){
    assert.ok(Number.isSafeInteger(entry.initializeRequest));
    assert.ok(Number.isFinite(entry.responseToNotificationMs)&&entry.responseToNotificationMs>=0);
  }
  assert.equal(manager.logs.filter(entry => entry.phase === 'opened').length, 1);
  assert.equal(manager.logs.filter(entry => entry.phase === 'transport-ready').length, 1);
  assert.equal(manager.logs.filter(entry => entry.event === 'mcp-list-notification').length, 0);
  const callTiming=manager.logs.filter(entry=>entry.event==='mcp-timing'&&entry.method==='tools/call');
  assert.deepEqual(callTiming.map(entry=>entry.phase),['request-received','tool-dispatched','response-written']);
  assert.equal(new Set(callTiming.map(entry=>entry.request)).size,1);
  assert.equal(new Set(callTiming.map(entry=>entry.session)).size,1);
  assert.ok(callTiming[1].durationMs>=0&&callTiming[2].durationMs>=callTiming[1].durationMs);
  assert.ok(callTiming[2].writeMs>=0);
  assert.ok(callTiming[0].frameMs>=callTiming[0].parseMs&&callTiming[0].parseMs>=0);
  assert.ok(callTiming[0].sinceInitializedMs>=0);
  assert.equal(manager.calls.length,1);
  const serverClosed = deferred();
  const logEntry = manager.log.bind(manager);
  manager.log = (event, details) => { logEntry(event, details); if (event === 'mcp-session' && details.phase === 'closed') serverClosed.resolve(); };
  await connection.close();
  await serverClosed.promise;
  assert.equal(manager.logs.filter(entry => entry.phase === 'closed').length, 1);
  const log = JSON.stringify(manager.logs);
  assert.equal(log.includes(environment.CTH_GATEWAY_TOKEN), false);
  assert.equal(log.includes(environment.CTH_GATEWAY_ENDPOINT), false);
  assert.equal(log.includes('private-call-contents'), false);
  assert.equal(log.includes('private-json-rpc-id'), false);
});

test('SDK output validation accepts original strict schemas and complete saved pages without replay', {timeout:15000}, async t=>{
  const {manager,gateway,environment}=await fixture(t);
  const strict={...TEST_TOOL,outputSchema:{type:'object',$defs:{text:{type:'string'}},properties:{body:{$ref:'#/$defs/text'}},required:['body'],additionalProperties:false}};
  manager.tools=[strict];
  const original={content:[{type:'text',text:'preview'}],structuredContent:{body:'完整😀输出\n'.repeat(6000)}};
  manager.handleCall=()=>structuredClone(original);
  const client=new Client({name:'paged-schema-test',version:'1'},{capabilities:{}});
  t.after(()=>client.close());
  await client.connect(new StdioClientTransport({command:process.execPath,args:[relay],env:environment,stderr:'pipe'}));
  assert.deepEqual((await client.listTools()).tools,[decorateTool(strict),...deliveryTools()]);
  let result=await client.callTool({name:strict.name,arguments:{unchanged:true}});
  const first=result,text=[];
  for(;;){
    const page=result.structuredContent;text.push(page.text);
    if(!page.has_more)break;
    result=await client.callTool({name:'get_tool_result_page',arguments:{result_id:page.result_id,offset:page.next_offset}});
  }
  assert.deepEqual(JSON.parse(text.join('')),original);
  assert.equal(manager.calls.length,1);
  // Gateway stop/restart closes sessions but not saved result delivery storage.
  await client.close();await gateway.stop();await gateway.start();
  assert.deepEqual(await gateway.toolCall('get_tool_result_page',{result_id:first.structuredContent.result_id}),first);
  manager.handleCall=()=>({content:[{type:'text',text:'small'}],structuredContent:{body:'small'}});
  assert.deepEqual((await gateway.toolCall(strict.name,{})).structuredContent,{body:'small'});
});

test('saved reads obey tool and folder revocation, and UI tool contracts remain unchanged',async t=>{
  const {manager,gateway}=await fixture(t);
  const original={content:[{type:'text',text:'original '.repeat(6000)}],structuredContent:{widgetData:'kept'}};
  manager.handleCall=()=>original;
  const first=await gateway.toolCall(TEST_TOOL.name,{}),result_id=first.structuredContent.result_id;
  manager.tools=[];
  assert.equal((await gateway.toolCall('get_tool_result_page',{result_id})).structuredContent.code,'MCP_RESULT_DENIED');
  manager.tools=[structuredClone(TEST_TOOL)];manager.desktopSettings={directories:['changed-folder']};
  assert.equal((await gateway.toolCall('get_tool_result_page',{result_id})).structuredContent.code,'MCP_RESULT_DENIED');
  manager.tools=[{...TEST_TOOL,_meta:{ui:{resourceUri:'ui://fixture/widget'}}}];
  assert.equal(await gateway.toolCall(TEST_TOOL.name,{}),original);
  assert.equal(manager.calls.length,2,'paging and permission failures never execute the source again');
});

test('identical request IDs in separate sessions cancel independently', { timeout: 15000 }, async t => {
  const { manager, environment } = await fixture(t);
  const pending = new Map();
  const bothStarted = deferred();
  manager.handleCall = call => {
    const result = deferred();
    pending.set(call.args.session, { ...result, call });
    call.signal.addEventListener('abort', () => result.resolve({ content: [{ type: 'text', text: 'cancelled' }], isError: true }), { once: true });
    if (pending.size === 2) bothStarted.resolve();
    return result.promise;
  };
  const first = await peer(t, environment);
  const second = await peer(t, environment);
  for (const [connection, session] of [[first, 'A'], [second, 'B']]) connection.send({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: TEST_TOOL.name, arguments: { session } } });
  await bothStarted.promise;
  const firstAborted = once(pending.get('A').call.signal, 'abort');
  first.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7, reason: 'User cancelled A' } });
  await firstAborted;
  assert.equal(pending.get('A').call.signal.aborted, true);
  assert.equal(pending.get('B').call.signal.aborted, false);
  const expected = { content: [{ type: 'text', text: 'B completed' }], structuredContent: { session: 'B' } };
  pending.get('B').resolve(expected);
  assert.deepEqual((await second.waitFor(message => message.id === 7)).result, expected);
  assert.equal(pending.get('B').call.signal.aborted, false);
});

test('session disconnect cancels pending approval and active execution through their request signals', { timeout: 15000 }, async t => {
  const { manager, environment } = await fixture(t);
  for (const phase of ['approval', 'execution']) {
    const started = deferred();
    const aborted = deferred();
    manager.handleCall = call => {
      started.resolve(call);
      return new Promise(resolve => call.signal.addEventListener('abort', () => {
        aborted.resolve(call);
        resolve({ content: [{ type: 'text', text: 'cancelled' }], isError: true });
      }, { once: true }));
    };
    const connection = await peer(t, environment);
    connection.send({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: TEST_TOOL.name, arguments: { phase } } });
    const call = await started.promise;
    assert.equal(call.signal.aborted, false);
    await connection.close();
    await aborted.promise;
    assert.equal(call.signal.aborted, true, phase);
  }
});

test('gateway immediate start-stop and subsequent restart leave no old listener or sessions', { timeout: 15000 }, async t => {
  const manager = new StubManager();
  const gateway = new McpGateway(manager);
  t.after(() => gateway.close());
  const starting = gateway.start();
  const stopping = gateway.stop();
  await Promise.all([starting, stopping]);
  assert.equal(gateway.server, null);
  assert.equal(gateway.sessions.size, 0);
  assert.equal(gateway.sockets.size, 0);
  assert.throws(() => gateway.environment(), { message: 'MCP_GATEWAY_UNAVAILABLE' });
  assert.equal(manager.listenerCount('toolsChanged'), 1);

  await gateway.start();
  const oldEnvironment = gateway.environment();
  const connection = await peer(t, oldEnvironment);
  connection.send({ jsonrpc: '2.0', id: 20, method: 'tools/list' });
  assert.deepEqual((await connection.waitFor(message => message.id === 20)).result.tools, [TEST_TOOL,...deliveryTools()]);
  await gateway.stop();
  assert.equal(gateway.sessions.size, 0);
  assert.equal(gateway.sockets.size, 0);
  if (process.platform !== 'win32') assert.equal(fs.existsSync(oldEnvironment.CTH_GATEWAY_ENDPOINT), false);
  const stale = net.createConnection(oldEnvironment.CTH_GATEWAY_ENDPOINT);
  const refused = await new Promise(resolve => {
    stale.once('error', resolve);
    stale.once('connect', () => resolve(null));
  });
  stale.destroy();
  assert.ok(refused, 'Stopped private endpoint must reject new connections');

  await gateway.start();
  const nextEnvironment = gateway.environment();
  assert.notEqual(nextEnvironment.CTH_GATEWAY_ENDPOINT, oldEnvironment.CTH_GATEWAY_ENDPOINT);
  assert.notEqual(nextEnvironment.CTH_GATEWAY_TOKEN, oldEnvironment.CTH_GATEWAY_TOKEN);
  await peer(t, nextEnvironment);
  await gateway.close();
  assert.equal(manager.listenerCount('toolsChanged'), 0);
});
