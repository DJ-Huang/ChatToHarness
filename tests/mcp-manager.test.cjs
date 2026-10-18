'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { ErrorCode, LATEST_PROTOCOL_VERSION } = require('@modelcontextprotocol/sdk/types.js');
const { McpSettings } = require('../app/mcp-settings.cjs');
const { McpManager, alias } = require('../app/mcp-manager.cjs');
const { windowsProcessHost } = require('./native-helper.cjs');
const { createFixtureServer, SMALL_PNG } = require('./fixtures/mcp-server.cjs');

const fixturePath = path.join(__dirname, 'fixtures/mcp-server.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for MCP test state');
    await pause(10);
  }
}
function readCount(file) { try { return Number(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return 0; throw error; } }

function fixture(t, options = {}) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cth-mcp-manager-')));
  const encryptionKey = crypto.randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, nonce);
      const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), body]);
    },
    decryptString(value) {
      const cipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, value.subarray(0, 12));
      cipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8');
    },
  };
  const settings = new McpSettings(path.join(directory, 'settings'), safeStorage);
  const logs = [];
  const manager = new McpManager({ settings, nodePath: process.execPath, processHost: windowsProcessHost(), log: (event, details) => logs.push({ event, ...details }), ...options });
  t.after(async () => { try { await manager.close(); } finally { fs.rmSync(directory, { recursive: true, force: true }); } });
  const starts = id => path.join(directory, `${id}-starts`);
  const calls = id => path.join(directory, `${id}-calls`);
  function save(id, extra = {}) {
    settings.save({
      id, name: id, enabled: true, transport: 'stdio', command: process.execPath, args: [fixturePath],
      ...extra,
      env: { MCP_FIXTURE_NAME: id, MCP_FIXTURE_START_FILE: starts(id), MCP_FIXTURE_COUNT_FILE: calls(id), ...extra.env },
    });
    settings.trust(id);
  }
  async function connect(id, extra) { save(id, extra); await manager.connect(id); }
  const policy = (serverId, toolName, value = 'allow') => manager.setToolPolicy({ serverId, toolName, policy: value });
  return { directory, settings, manager, logs, save, connect, policy, starts, calls };
}

test('concurrent connections reuse one process, discover every page and default to denied', { timeout: 10000 }, async t => {
  const f = fixture(t);
  f.save('one');
  await Promise.all([f.manager.connect('one'), f.manager.connect('one'), f.manager.connect('one')]);
  await f.manager.connect('one');
  assert.equal(readCount(f.starts('one')), 1);
  const server = f.manager.status().servers[0];
  assert.equal(server.protocolVersion, LATEST_PROTOCOL_VERSION);
  assert.equal(server.phase, 'ready');
  assert.equal(server.tools.length, 8, 'fixture discovery is paginated, two tools per page');
  assert.ok(server.tools.every(tool => tool.policy === 'deny'));
  assert.deepEqual(f.manager.visibleTools(), []);
  assert.deepEqual(f.manager.listTools(), { tools: [] });
  const denied = await f.manager.call('one__echo', { test: true });
  assert.equal(denied.structuredContent.code, 'MCP_TOOL_DENIED');
  assert.equal(denied.structuredContent.execution_state, 'not_started');
  assert.equal(readCount(f.calls('one')), 0);
});

test('namespaces isolate identical tool names and preserve schemas, arguments, images and errors', { timeout: 10000 }, async t => {
  const f = fixture(t);
  await Promise.all([f.connect('one'), f.connect('two')]);
  f.policy('one', 'echo'); f.policy('two', 'echo');
  assert.deepEqual(f.manager.listTools().tools.map(tool => tool.name), ['one__echo', 'two__echo']);
  const exposed = f.manager.listTools().tools[0];
  assert.deepEqual(exposed.inputSchema, { type: 'object', properties: {}, additionalProperties: true });
  assert.deepEqual(exposed.outputSchema, { type: 'object', additionalProperties: true });
  const args = { project_path: '/中文/project', context_paths: ['/target'], project_context_tokens: ['opaque'], nested: { list: [true, 1, null] } };
  const [first, second] = await Promise.all([f.manager.call('one__echo', args), f.manager.call('two__echo', { other: true })]);
  assert.deepEqual(first.structuredContent.arguments, args);
  assert.equal(first.structuredContent.server, 'one');
  assert.equal(second.structuredContent.server, 'two');
  assert.deepEqual(first.content[1], { type: 'image', data: SMALL_PNG, mimeType: 'image/png' });
  f.policy('one', 'tool_error'); f.policy('one', 'protocol_error');
  const toolError = await f.manager.call('one__tool_error', {});
  assert.equal(toolError.isError, true);
  assert.equal(toolError.structuredContent.sentinel, 'fixture-tool-error');
  assert.deepEqual(JSON.parse(toolError.content[0].text), toolError.structuredContent);
  await assert.rejects(f.manager.call('one__protocol_error', {}), error => {
    assert.equal(error.code, ErrorCode.InvalidParams);
    assert.match(error.message, /Fixture protocol detail/);
    assert.deepEqual(error.data, { fixture: true });
    return true;
  });
  assert.equal(f.manager.status().servers[0].phase, 'ready');
});

test('list changes revoke changed definitions and leave new tools denied', { timeout: 10000 }, async t => {
  const f = fixture(t); await f.connect('one');
  f.policy('one', 'echo'); f.policy('one', 'count'); f.policy('one', 'change_tools');
  await f.manager.call('one__change_tools', {});
  await until(() => f.manager.status().servers[0].tools.some(tool => tool.name === 'added_tool'));
  const tools = f.manager.status().servers[0].tools;
  assert.equal(tools.find(tool => tool.name === 'echo').policy, 'deny');
  assert.equal(tools.find(tool => tool.name === 'added_tool').policy, 'deny');
  assert.equal(tools.find(tool => tool.name === 'count').policy, 'allow');
  assert.equal((await f.manager.call('one__echo', {})).structuredContent.execution_state, 'not_started');
  f.policy('one', 'echo');
  assert.equal((await f.manager.call('one__echo', { refreshed: true })).structuredContent.arguments.refreshed, true);
});

test('catalog reordering preserves active calls, pending confirmations and the published version', { timeout: 10000 }, async t => {
  const f = fixture(t); await f.connect('one');
  f.policy('one', 'hang'); f.policy('one', 'echo', 'ask'); f.policy('one', 'change_tools');
  const running = f.manager.call('one__hang', {});
  await until(() => readCount(f.calls('one')) === 1);
  const pending = f.manager.call('one__echo', { preserved: true });
  await until(() => f.manager.status().approvals.length === 1);
  const approval = f.manager.status().approvals[0];
  const version = f.manager.toolsVersion, catalog = f.manager.listTools();
  const active = [...f.manager.active];
  let notifications = 0;
  f.manager.on('toolsChanged', () => { notifications++; });
  const catalogLogs = f.logs.filter(entry => entry.event === 'mcp-catalog').length;
  await f.manager.call('one__change_tools', { action: 'reorder' });
  await until(() => f.manager.record('one').tools[0].tool.name === 'tool_error');
  assert.ok(active.every(operation => !operation.controller.signal.aborted));
  assert.deepEqual(f.manager.status().approvals, [approval]);
  assert.equal(f.manager.toolsVersion, version);
  assert.equal(notifications, 0);
  assert.deepEqual(f.manager.listTools(), catalog);
  assert.equal(f.logs.filter(entry => entry.event === 'mcp-catalog').length, catalogLogs);
  f.manager.approve({ id: approval.id, allow: true });
  assert.equal((await pending).structuredContent.arguments.preserved, true);
  // A later explicit policy change must still find the captured operation.
  f.policy('one', 'hang', 'deny');
  assert.equal((await running).structuredContent.code, 'MCP_POLICY_CHANGED');
});

test('an unrelated tool change preserves running calls and revokes only affected confirmations', { timeout: 10000 }, async t => {
  const f = fixture(t); await f.connect('one');
  f.policy('one', 'hang'); f.policy('one', 'echo', 'ask'); f.policy('one', 'change_tools');
  const running = f.manager.call('one__hang', {});
  await until(() => readCount(f.calls('one')) === 1);
  const operation = [...f.manager.active].find(item => item.item.tool.name === 'hang');
  const pending = f.manager.call('one__echo', {});
  await until(() => f.manager.status().approvals.length === 1);
  const approvalId = f.manager.status().approvals[0].id;
  await f.manager.call('one__change_tools', {});
  assert.equal((await pending).structuredContent.code, 'MCP_TOOLS_CHANGED');
  assert.equal(operation.controller.signal.aborted, false);
  assert.throws(() => f.manager.approve({ id: approvalId, allow: true }), { code: 'MCP_APPROVAL_EXPIRED' });
  const tools = f.manager.status().servers[0].tools;
  assert.equal(tools.find(item => item.name === 'echo').policy, 'deny');
  assert.equal(tools.find(item => item.name === 'added_tool').policy, 'deny');
  assert.equal(tools.find(item => item.name === 'hang').policy, 'allow');
  const catalog = f.logs.filter(entry => entry.event === 'mcp-catalog').at(-1);
  assert.equal(catalog.removed, 1);
  assert.equal(catalog.added, 0, 'new tools remain hidden until allowed');
  assert.match(catalog.fingerprint, /^[a-f0-9]{64}$/);
  f.policy('one', 'hang', 'deny');
  assert.equal((await running).structuredContent.code, 'MCP_POLICY_CHANGED');
});

for (const action of ['change_hang', 'remove_hang']) {
  test(`a ${action} catalog update cancels that tool's running call`, { timeout: 10000 }, async t => {
    const f = fixture(t); await f.connect('one');
    f.policy('one', 'hang'); f.policy('one', 'change_tools');
    const running = f.manager.call('one__hang', {});
    await until(() => readCount(f.calls('one')) === 1);
    await f.manager.call('one__change_tools', { action });
    const result = await running;
    assert.equal(result.structuredContent.code, 'MCP_TOOLS_CHANGED');
    assert.equal(result.structuredContent.execution_state, 'unknown');
    assert.equal((await f.manager.call('one__hang', {})).structuredContent.code, 'MCP_TOOL_DENIED');
    assert.equal(readCount(f.calls('one')), 2, 'a changed call is never replayed');
  });
}

test('local approval binds immutable original arguments and accepts only its captured ID', { timeout: 10000 }, async t => {
  const f = fixture(t); await f.connect('one'); f.policy('one', 'echo', 'ask');
  const original = { nested: { value: 'original' } };
  const pending = f.manager.call('one__echo', original);
  await until(() => f.manager.status().approvals.length === 1);
  original.nested.value = 'changed after request';
  const approval = f.manager.status().approvals[0];
  assert.deepEqual(approval.arguments, { nested: { value: 'original' } });
  approval.arguments.nested.value = 'changed copy of approval';
  assert.throws(() => f.manager.approve({ id: 'unrelated', allow: true }), { code: 'MCP_APPROVAL_EXPIRED' });
  f.manager.approve({ id: approval.id, allow: true, arguments: { replace: true } });
  assert.deepEqual((await pending).structuredContent.arguments, { nested: { value: 'original' } });
  assert.equal(readCount(f.calls('one')), 1);
  assert.equal(f.manager.status().approvals.length, 0);
  assert.throws(() => f.manager.approve({ id: approval.id, allow: true }), { code: 'MCP_APPROVAL_EXPIRED' });
});

test('rejected and cancelled approvals never execute or resolve a different request', { timeout: 10000 }, async t => {
  const f = fixture(t); await f.connect('one'); f.policy('one', 'echo', 'ask');
  const first = f.manager.call('one__echo', { which: 'rejected' });
  await until(() => f.manager.status().approvals.length === 1);
  const firstId = f.manager.status().approvals[0].id;
  f.manager.approve({ id: firstId, allow: false });
  assert.equal((await first).structuredContent.execution_state, 'not_started');
  const controller = new AbortController();
  const second = f.manager.call('one__echo', { which: 'cancelled' }, { signal: controller.signal });
  await until(() => f.manager.status().approvals.length === 1);
  const secondId = f.manager.status().approvals[0].id;
  assert.notEqual(firstId, secondId);
  assert.throws(() => f.manager.approve({ id: firstId, allow: true }), { code: 'MCP_APPROVAL_EXPIRED' });
  controller.abort();
  assert.equal((await second).structuredContent.execution_state, 'not_started');
  assert.equal(f.manager.status().approvals.length, 0);
  assert.equal(readCount(f.calls('one')), 0);
});

test('the service deadline includes local approval waiting', { timeout: 10000 }, async t => {
  const f = fixture(t); await f.connect('one', { timeoutMs: 1000 }); f.policy('one', 'echo', 'ask');
  const started = Date.now();
  const pending = f.manager.call('one__echo', { deadline: true });
  await until(() => f.manager.status().approvals.length === 1);
  assert.ok(f.manager.status().approvals[0].expiresAt <= started + 1100);
  const result = await pending;
  assert.equal(result.structuredContent.execution_state, 'not_started');
  assert.ok(Date.now() - started >= 900);
  assert.ok(Date.now() - started < 3000);
  assert.equal(readCount(f.calls('one')), 0);
  assert.equal(f.manager.status().approvals.length, 0);
});

test('disconnect invalidates pending approval and reconnect never reuses it', { timeout: 10000 }, async t => {
  const f = fixture(t); await f.connect('one'); f.policy('one', 'echo', 'ask');
  const pending = f.manager.call('one__echo', { version: 1 });
  await until(() => f.manager.status().approvals.length === 1);
  const old = f.manager.status().approvals[0].id;
  await f.manager.disconnect(f.manager.records.get('one'));
  assert.equal((await pending).structuredContent.execution_state, 'not_started');
  await f.manager.connect('one');
  assert.throws(() => f.manager.approve({ id: old, allow: true }), { code: 'MCP_APPROVAL_EXPIRED' });
  assert.equal(readCount(f.calls('one')), 0);
  f.policy('one', 'echo');
  await f.manager.call('one__echo', { version: 2 });
  assert.equal(readCount(f.calls('one')), 1);
});

test('environment secrets stay per service and are masked in approval state and logs', { timeout: 10000 }, async t => {
  const oldTunnel = process.env.CONTROL_PLANE_API_KEY, oldOpenAI = process.env.OPENAI_API_KEY;
  process.env.CONTROL_PLANE_API_KEY = 'synthetic-tunnel-secret'; process.env.OPENAI_API_KEY = 'synthetic-openai-secret';
  t.after(() => {
    if (oldTunnel === undefined) delete process.env.CONTROL_PLANE_API_KEY; else process.env.CONTROL_PLANE_API_KEY = oldTunnel;
    if (oldOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldOpenAI;
  });
  const f = fixture(t); const secret = 'service-one-private-secret';
  await Promise.all([f.connect('one', { env: { ONE_SECRET: secret } }), f.connect('two', { env: { TWO_SECRET: 'service-two-private-secret' } })]);
  f.policy('one', 'inspect_environment'); f.policy('two', 'inspect_environment');
  const names = ['CONTROL_PLANE_API_KEY', 'OPENAI_API_KEY', 'ONE_SECRET', 'TWO_SECRET'];
  const first = (await f.manager.call('one__inspect_environment', { names })).structuredContent.environment;
  const second = (await f.manager.call('two__inspect_environment', { names })).structuredContent.environment;
  assert.deepEqual(first, { CONTROL_PLANE_API_KEY: null, OPENAI_API_KEY: null, ONE_SECRET: secret, TWO_SECRET: null });
  assert.deepEqual(second, { CONTROL_PLANE_API_KEY: null, OPENAI_API_KEY: null, ONE_SECRET: null, TWO_SECRET: 'service-two-private-secret' });
  f.policy('one', 'echo', 'ask');
  const pending = f.manager.call('one__echo', { token: secret, nested: [`prefix:${secret}`] });
  await until(() => f.manager.status().approvals.length === 1);
  const approval = f.manager.status().approvals[0];
  assert.deepEqual(approval.arguments, { token: '[redacted]', nested: ['prefix:[redacted]'] });
  assert.equal(JSON.stringify(f.manager.status()).includes(secret), false);
  f.manager.approve({ id: approval.id, allow: true });
  assert.equal((await pending).structuredContent.arguments.token, secret, 'masking must not modify downstream arguments');
  const log = JSON.stringify(f.logs);
  for (const value of [secret, 'service-two-private-secret', 'synthetic-tunnel-secret', 'synthetic-openai-secret', 'prefix:']) assert.equal(log.includes(value), false);
  const diagnostics = f.logs.filter(entry => entry.event === 'mcp-connection' || entry.event === 'mcp-catalog');
  assert.ok(diagnostics.some(entry => entry.event === 'mcp-catalog'));
  for (const entry of diagnostics) {
    const allowed = entry.event === 'mcp-connection'
      ? ['event', 'server', 'phase', 'generation', 'count', 'code', 'attempt', 'delayMs']
      : ['event', 'version', 'count', 'fingerprint', 'added', 'removed', 'changed'];
    assert.ok(Object.keys(entry).every(key => allowed.includes(key)), 'diagnostics contain only connection state and catalog summaries');
  }
  assert.equal(JSON.stringify(diagnostics).includes(f.directory), false);
  assert.equal(JSON.stringify(diagnostics).includes('Return the supplied arguments'), false);
});

test('enabled connection tests retain retries and one failed service never replays its call', { timeout: 15000 }, async t => {
  const f = fixture(t); f.manager.running = true;
  f.save('fragile'); await f.manager.test('fragile'); await f.connect('healthy');
  assert.equal(f.manager.records.get('fragile').testing, false);
  f.policy('fragile', 'exit'); f.policy('healthy', 'echo');
  const result = await f.manager.call('fragile__exit', {});
  assert.equal(result.structuredContent.execution_state, 'unknown');
  assert.equal((await f.manager.call('healthy__echo', { still: 'available' })).structuredContent.arguments.still, 'available');
  await until(() => readCount(f.starts('fragile')) >= 2 && f.manager.records.get('fragile').phase === 'ready', 6000);
  assert.equal(readCount(f.calls('fragile')), 1, 'reconnection must not repeat the exit call');
  assert.equal(readCount(f.starts('healthy')), 1);
  const phases = f.logs.filter(entry => entry.event === 'mcp-connection' && entry.server === 'fragile').map(entry => entry.phase);
  assert.deepEqual(phases, ['connecting', 'ready', 'closed', 'retry', 'connecting', 'ready']);
  const retry = f.logs.find(entry => entry.event === 'mcp-connection' && entry.server === 'fragile' && entry.phase === 'retry');
  assert.equal(retry.delayMs, 1000);
  assert.equal(retry.attempt, 1);
  await f.manager.stop();
  assert.ok(f.manager.status().servers.every(server => server.phase === 'stopped'));
  assert.equal(f.manager.running, false);
  assert.equal(f.logs.filter(entry => entry.event === 'mcp-connection' && entry.server === 'fragile').at(-1).phase, 'stopped');
});

test('cross-service aliases that collide fail discovery without exposing duplicates', { timeout: 10000 }, async t => {
  const f = fixture(t);
  const colliding = alias('foo', 'bar__echo');
  assert.equal(colliding, alias('foo__bar', 'echo'));
  f.manager.record('foo').tools = [{ tool: { name: 'bar__echo' }, alias: colliding, fingerprint: 'fake-peer-definition' }];
  f.save('foo__bar');
  await assert.rejects(f.manager.connect('foo__bar'), { code: 'MCP_TOOL_NAME_CONFLICT' });
  assert.deepEqual(f.manager.visibleTools(), []);
  assert.equal(f.manager.records.get('foo__bar').retryTimer, undefined);
});

test('cancellation after forwarding reports unknown and never repeats a call', { timeout: 10000 }, async t => {
  const f = fixture(t); await f.connect('one'); f.policy('one', 'hang');
  const controller = new AbortController();
  const pending = f.manager.call('one__hang', {}, { signal: controller.signal });
  await until(() => readCount(f.calls('one')) === 1);
  controller.abort();
  const result = await pending;
  assert.equal(result.structuredContent.execution_state, 'unknown');
  assert.equal(result.structuredContent.code, 'MCP_CANCELLED');
  assert.equal(readCount(f.calls('one')), 1);
  assert.equal(f.manager.active.size, 0);
});

test('a forwarded deadline returns unknown execution state without a replay', { timeout: 10000 }, async t => {
  const f = fixture(t); await f.connect('one', { timeoutMs: 1000 }); f.policy('one', 'hang');
  const result = await f.manager.call('one__hang', {});
  assert.equal(result.structuredContent.execution_state, 'unknown');
  assert.equal(result.structuredContent.code, 'MCP_TIMEOUT');
  assert.equal(readCount(f.calls('one')), 1);
});

test('Stop while a connection is being prepared prevents process startup or retry', { timeout: 10000 }, async t => {
  let release;
  const prepared = new Promise(resolve => { release = resolve; });
  const f = fixture(t, { builtinFactory: () => prepared });
  const start = f.manager.start({ directories: [f.directory] });
  const settledStart = assert.rejects(start, { code: 'MCP_STOPPED' });
  await until(() => f.manager.records.get('builtin')?.phase === 'connecting');
  const stopping = f.manager.stop();
  release({ transport: 'stdio', command: process.execPath, args: [fixturePath], env: { MCP_FIXTURE_START_FILE: f.starts('builtin') } });
  await Promise.all([stopping, settledStart]);
  assert.equal(readCount(f.starts('builtin')), 0);
  assert.equal(f.manager.running, false);
  assert.equal(f.manager.records.get('builtin').phase, 'stopped');
  assert.equal(f.manager.records.get('builtin').retryTimer, undefined);
});

test('Streamable HTTP uses static headers and leaves authentication errors for local correction', { timeout: 15000 }, async t => {
  const f = fixture(t); const expected = 'Bearer synthetic-http-secret';
  const peer = createFixtureServer({ name: 'http-fixture' });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID(), enableJsonResponse: true });
  await peer.connect(transport);
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization });
    if (request.url !== '/mcp') { response.writeHead(404).end(); return; }
    if (request.headers.authorization !== expected) { response.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"unauthorized"}'); return; }
    void transport.handleRequest(request, response).catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); });
  });
  t.after(async () => {
    await f.manager.close(); await peer.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  f.settings.save({ id: 'http', name: 'HTTP fixture', enabled: true, transport: 'streamable-http', url, headers: { Authorization: expected } });
  f.settings.trust('http'); await f.manager.connect('http'); f.policy('http', 'echo');
  assert.equal((await f.manager.call('http__echo', { network: 'local' })).structuredContent.arguments.network, 'local');
  assert.equal(f.manager.status().servers.find(value => value.id === 'http').protocolVersion, LATEST_PROTOCOL_VERSION);
  f.settings.save({ id: 'unauthorized', enabled: true, transport: 'streamable-http', url, headers: { Authorization: 'Bearer wrong-secret' } });
  f.settings.trust('unauthorized'); f.manager.running = true;
  await assert.rejects(f.manager.connect('unauthorized'), { code: 'MCP_AUTH_REQUIRED' });
  assert.equal(f.manager.records.get('unauthorized').retryTimer, undefined);
  assert.equal(f.manager.status().servers.find(value => value.id === 'http').phase, 'ready');
  assert.ok(requests.every(request => request.url === '/mcp' && [expected, 'Bearer wrong-secret'].includes(request.authorization)), 'no OAuth or uncredentialed fallback requests');
  assert.equal(JSON.stringify(f.manager.status()).includes(expected), false);
});

// A real HTTP peer with controllable connection loss. Each initialization gets
// a new session so recovery proves a fresh handshake rather than call replay.
async function recoveryPeer(t, f, { get405 = false } = {}) {
  const state = { initializations: 0, getRequests: 0, calls: [], sessions: new Set(), streams: new Map(), failNextCall: '' };
  const tool = { name: 'echo', inputSchema: { type: 'object', additionalProperties: true } };
  const server = http.createServer((request, response) => {
    const json = (status, value, extra = {}) => response.writeHead(status, { 'content-type': 'application/json', ...extra }).end(JSON.stringify(value));
    if (request.method === 'GET') {
      state.getRequests++;
      if (get405) { response.writeHead(405).end(); return; }
      const session = request.headers['mcp-session-id'];
      if (!state.sessions.has(session)) { json(404, { error: 'Session expired' }); return; }
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      response.write(': connected\n\n');
      state.streams.set(session, response);
      response.once('close', () => state.streams.delete(session));
      return;
    }
    void (async () => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (message.method === 'initialize') {
        const session = `session-${++state.initializations}`;
        state.sessions.add(session);
        json(200, { jsonrpc: '2.0', id: message.id, result: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'recovery-peer', version: '1' } } }, { 'mcp-session-id': session });
        return;
      }
      const session = request.headers['mcp-session-id'];
      if (!state.sessions.has(session)) { json(404, { error: 'Session expired' }); return; }
      if (message.method === 'tools/list') { json(200, { jsonrpc: '2.0', id: message.id, result: { tools: [tool] } }); return; }
      if (message.method === 'tools/call') {
        state.calls.push({ session, arguments: message.params.arguments });
        const fault = state.failNextCall; state.failNextCall = '';
        if (fault === 'disconnect') { request.socket.destroy(); return; }
        if (fault === 'expired') { state.sessions.delete(session); json(404, { error: 'Session expired' }); return; }
        const result = { session, arguments: message.params.arguments };
        json(200, { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result } });
        return;
      }
      response.writeHead(202).end();
    })().catch(() => response.destroy());
  });
  t.after(async () => {
    await f.manager.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  f.settings.save({ id: 'http', enabled: true, transport: 'streamable-http', url: `http://127.0.0.1:${server.address().port}/mcp` });
  f.settings.trust('http'); f.manager.running = true;
  await f.manager.connect('http'); f.policy('http', 'echo');
  return state;
}

for (const abrupt of [false, true]) {
  test(`Streamable HTTP reinitializes after a ${abrupt ? 'broken' : 'closed'} SSE stream without replaying calls`, { timeout: 12000 }, async t => {
    const f = fixture(t); const peer = await recoveryPeer(t, f);
    await until(() => peer.streams.size === 1);
    const before = await f.manager.call('http__echo', { marker: 'before-stream-loss' });
    const phases = [];
    f.manager.on('state', () => phases.push(f.manager.records.get('http').phase));
    const stream = [...peer.streams.values()][0];
    if (abrupt) stream.destroy(); else stream.end();
    await until(() => peer.initializations === 2 && f.manager.records.get('http').phase === 'ready', 6000);
    assert.ok(phases.includes('reconnecting'));
    assert.equal(peer.calls.length, 1, 'a closed SSE channel cannot replay a completed call');
    const after = await f.manager.call('http__echo', { marker: 'after-stream-loss' });
    assert.notEqual(after.structuredContent.session, before.structuredContent.session);
    assert.equal(peer.calls.length, 2);
  });
}

for (const fault of ['disconnect', 'expired']) {
  test(`Streamable HTTP reinitializes after a tool POST ${fault} without replaying that call`, { timeout: 12000 }, async t => {
    const f = fixture(t); const peer = await recoveryPeer(t, f);
    const phases = [];
    f.manager.on('state', () => phases.push(f.manager.records.get('http').phase));
    peer.failNextCall = fault;
    const result = await f.manager.call('http__echo', { marker: 'interrupted-call' });
    assert.equal(result.structuredContent.execution_state, 'unknown');
    await until(() => peer.initializations === 2 && f.manager.records.get('http').phase === 'ready', 6000);
    assert.ok(phases.includes('reconnecting'));
    assert.equal(peer.calls.length, 1, 'the failed POST must not be retried');
    assert.deepEqual(peer.calls[0].arguments, { marker: 'interrupted-call' });
    const next = await f.manager.call('http__echo', { marker: 'new-explicit-call' });
    assert.equal(next.structuredContent.session, 'session-2');
    assert.equal(peer.calls.length, 2);
  });
}

test('Streamable HTTP optional SSE GET 405 keeps the working connection ready', { timeout: 10000 }, async t => {
  const f = fixture(t); const peer = await recoveryPeer(t, f, { get405: true });
  await until(() => peer.getRequests === 1);
  assert.equal(f.manager.records.get('http').phase, 'ready');
  assert.equal(f.manager.records.get('http').retryTimer, undefined);
  assert.equal((await f.manager.call('http__echo', { without: 'sse' })).structuredContent.arguments.without, 'sse');
  assert.equal(peer.initializations, 1);
});

test('a peer requiring only the newer unsupported protocol reports incompatibility', { timeout: 10000 }, async t => {
  const f = fixture(t);
  const peer = "require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const message=JSON.parse(line);if(message.method==='initialize')process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{protocolVersion:'2026-07-28',serverInfo:{name:'future-only',version:'1'},capabilities:{tools:{}}}})+'\\n');});";
  f.save('future', { args: ['-e', peer] }); f.manager.running = true;
  await assert.rejects(f.manager.connect('future'), { code: 'MCP_PROTOCOL_UNSUPPORTED' });
  assert.equal(f.manager.status().servers[0].protocolVersion, '2026-07-28');
  assert.equal(f.manager.records.get('future').retryTimer, undefined);
  assert.deepEqual(f.manager.visibleTools(), []);
});

test('allow-all exposes trusted enabled tools without changing definitions or reconnecting', { timeout: 15000 }, async t => {
  const f = fixture(t); await f.connect('one');
  f.policy('one', 'echo', 'ask'); f.policy('one', 'count');
  const original = f.manager.visibleTools(), grants = f.settings.listToolPolicies('one');
  const definitions = f.manager.record('one').tools.map(item => structuredClone(item.tool));
  const generation = f.manager.record('one').generation;
  let notifications = 0, approvals = 0;
  f.manager.on('toolsChanged', () => { notifications++; });
  f.manager.on('approval', () => { approvals++; });
  f.manager.setAllowAllTools(true);
  assert.equal(f.manager.status().allowAllTools, true);
  assert.equal(f.manager.visibleTools().length, 8);
  assert.equal(notifications, 1, 'previously denied tools become visible with one real directory change');
  assert.ok(f.manager.status().servers[0].tools.every(item => item.policy === 'allow'));
  assert.equal(f.manager.status().servers[0].tools.find(item => item.name === 'echo').savedPolicy, 'ask');
  assert.deepEqual(f.manager.record('one').tools.map(item => item.tool), definitions);
  for (const tool of original) assert.deepEqual(f.manager.visibleTools().find(item => item.name === tool.name), tool);
  assert.equal((await f.manager.call('one__echo', { direct: true })).structuredContent.arguments.direct, true);
  assert.equal(approvals, 0);
  assert.equal(f.manager.record('one').generation, generation);
  assert.equal(readCount(f.starts('one')), 1);
  f.manager.setAllowAllTools(false);
  assert.deepEqual(f.manager.visibleTools(), original);
  assert.deepEqual(f.settings.listToolPolicies('one'), grants);
  assert.equal(f.manager.record('one').generation, generation);
  f.manager.setAllowAllTools(true);
  await f.manager.setEnabled('one', false);
  assert.deepEqual(f.manager.visibleTools(), []);
  assert.equal((await f.manager.call('one__echo', {})).structuredContent.code, 'MCP_TOOL_DENIED');
  await f.manager.setEnabled('one', true);
  assert.equal(f.manager.visibleTools().length, 8);
  f.settings.save({ id: 'one', args: [fixturePath, 'changed-launch-target'] });
  assert.equal(f.settings.isTrusted('one'), false);
  assert.deepEqual(f.manager.visibleTools(), []);
  assert.equal((await f.manager.call('one__echo', {})).structuredContent.code, 'MCP_TOOL_DENIED');
});

test('allow-all covers new definitions while stale grants stay revoked when turned off', { timeout: 10000 }, async t => {
  const f = fixture(t); await f.connect('one');
  f.policy('one', 'echo', 'ask'); f.policy('one', 'change_tools');
  f.manager.setAllowAllTools(true);
  await f.manager.call('one__change_tools', {});
  await until(() => f.manager.record('one').tools.some(item => item.tool.name === 'added_tool'));
  assert.ok(f.manager.status().servers[0].tools.every(item => item.policy === 'allow'));
  assert.equal(f.manager.status().servers[0].tools.find(item => item.name === 'echo').savedPolicy, 'deny');
  assert.equal((await f.manager.call('one__added_tool', {})).structuredContent.added, true);
  f.manager.setAllowAllTools(false);
  assert.deepEqual(f.manager.visibleTools().map(item => item.name), ['one__change_tools']);
  assert.equal((await f.manager.call('one__echo', {})).structuredContent.code, 'MCP_TOOL_DENIED');
  assert.equal((await f.manager.call('one__added_tool', {})).structuredContent.code, 'MCP_TOOL_DENIED');
});

test('allow-all changes revoke affected calls transactionally without replaying or reconnecting', { timeout: 10000 }, async t => {
  const f = fixture(t); await f.connect('one'); f.policy('one', 'echo', 'ask');
  const pending = f.manager.call('one__echo', {});
  await until(() => f.manager.status().approvals.length === 1);
  f.manager.setAllowAllTools(true);
  assert.equal((await pending).structuredContent.code, 'MCP_POLICY_CHANGED');
  assert.equal(readCount(f.calls('one')), 0);
  const running = f.manager.call('one__hang', {});
  await until(() => readCount(f.calls('one')) === 1);
  const operation = [...f.manager.active][0];
  const version = f.manager.toolsVersion;
  f.manager.setAllowAllTools(true);
  assert.equal(f.manager.toolsVersion, version);
  assert.equal(operation.controller.signal.aborted, false);
  f.manager.setAllowAllTools(false);
  assert.equal((await running).structuredContent.code, 'MCP_POLICY_CHANGED');
  assert.equal(readCount(f.calls('one')), 1);
  const retry = f.manager.call('one__echo', {});
  await until(() => f.manager.status().approvals.length === 1);
  const approval = f.manager.status().approvals[0];
  const saved = fs.readFileSync(f.settings.file), catalog = f.manager.listTools(), before = f.manager.toolsVersion;
  const originalRename = fs.renameSync;
  fs.renameSync = () => { throw Error('Simulated persistence failure'); };
  try { assert.throws(() => f.manager.setAllowAllTools(true), { code: 'WRITE_FAILED' }); }
  finally { fs.renameSync = originalRename; }
  assert.equal(f.manager.status().allowAllTools, false);
  assert.equal(f.manager.toolsVersion, before);
  assert.deepEqual(f.manager.listTools(), catalog);
  assert.deepEqual(f.manager.status().approvals, [approval]);
  assert.deepEqual(fs.readFileSync(f.settings.file), saved);
  f.manager.approve({ id: approval.id, allow: true }); await retry;
  f.policy('one', 'hang');
  const controller = new AbortController();
  const unaffected = f.manager.call('one__hang', {}, { signal: controller.signal });
  await until(() => readCount(f.calls('one')) === 3);
  const unchanged = [...f.manager.active][0];
  f.manager.setAllowAllTools(true); f.manager.setAllowAllTools(false);
  assert.equal(unchanged.controller.signal.aborted, false, 'saved allow is independent of the override');
  assert.equal(readCount(f.starts('one')), 1);
  controller.abort(); await unaffected;
});

test('execution history includes policy/approval rejection, validation, success, upstream error and timeout in one stable record', {timeout:10000}, async t=>{
  const f=fixture(t);const {ExecutionHistory}=require('../app/execution-history.cjs');
  const history=new ExecutionHistory(path.join(f.directory,'history'));t.after(()=>history.close());f.manager.history=history;
  await f.connect('recorded');const tool=name=>alias('recorded',name);
  await f.manager.call(tool('echo'),{});
  assert.equal(history.rows()[0].state,'failed');
  f.policy('recorded','echo','ask');const denied=f.manager.call(tool('echo'),{label:'safe'});await until(()=>f.manager.approvals.size===1);
  assert.ok(history.rows().some(r=>r.state==='waiting_approval'));
  f.manager.approve({id:f.manager.status().approvals[0].id,allow:false});await denied;
  f.policy('recorded','echo');await f.manager.call(tool('echo'),null);await f.manager.call(tool('echo'),{label:'ok'});
  assert.equal(history.rows().length,4);assert.equal(history.rows().filter(r=>r.state==='succeeded').length,1);
  assert.ok(history.rows().every(r=>r.service==='[redacted]'&&r.delivery==='unknown'));
  f.policy('recorded','tool_error');await f.manager.call(tool('tool_error'),{});
  f.policy('recorded','protocol_error');await assert.rejects(f.manager.call(tool('protocol_error'),{}));
  f.policy('recorded','hang');f.manager.records.get('recorded').timeoutMs=20;await f.manager.call(tool('hang'),{});
  assert.equal(history.rows().length,7);assert.ok(history.rows().some(r=>r.tool.endsWith('__hang')&&r.state==='unknown'),JSON.stringify(history.rows().map(({tool,state,error_code})=>({tool,state,error_code}))));
  assert.ok(history.rows().some(r=>r.tool.endsWith('__tool_error')&&r.state==='failed'));

});
