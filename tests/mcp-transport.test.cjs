'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { once } = require('node:events');
const { windowsProcessHost } = require('./native-helper.cjs');
const { MAX_MESSAGE_BYTES, MAX_STARTUP_STDERR_BYTES, startupDiagnostic, toolEnvironment, boundedMessage, LineTransport, ManagedStdioTransport, boundedFetch, resolveLaunch } = require('../app/mcp-transport.cjs');

test('Windows bare Node commands use the bundled executable without changing literal arguments', () => {
  const node = 'C:\\Program Files\\ChatToHarness\\node.exe';
  for (const command of ['node', 'NODE.EXE']) {
    const config = { command, args: ['中文', '& calc.exe', '$HOME', '%PATH%'], env: { PATH: 'D:\\Untrusted' } };
    const resolved = resolveLaunch(config, node, 'win32', () => { throw Error('Node must not search PATH'); });
    assert.equal(resolved.command, node);
    assert.deepEqual(resolved.args, config.args);
    assert.equal(config.command, command);
  }
});

test('Windows npm and npx launch their CLI with bundled Node and literal argv without batch interpretation', () => {
  const node = 'C:\\App Folder\\node.exe';
  const args = ['--yes', '@example/server', '中文 project', '$(echo private)', '& calc.exe', '%TOKEN%'];
  for (const command of ['npm', 'npm.cmd', 'NPX', 'NPX.CMD', 'D:\\Node Tools\\npx.cmd']) {
    const cli = path.win32.join(command.includes('\\') ? 'D:\\Node Tools' : 'C:\\App Folder', 'node_modules', 'npm', 'bin', command.toLowerCase().includes('npx') ? 'npx-cli.js' : 'npm-cli.js');
    const config = { command, args, env: {} };
    const lookedUp = [];
    const resolved = resolveLaunch(config, node, 'win32', file => { lookedUp.push(file); return file === cli; });
    assert.deepEqual(lookedUp, [cli]);
    assert.equal(resolved.command, node);
    assert.deepEqual(resolved.args, [cli, ...args]);
    assert.deepEqual(config.args, args);
    assert.equal(resolved.args.some(value => /^cmd(?:\.exe)?$/i.test(value)), false);
  }
  assert.throws(() => resolveLaunch({ command: 'npx', args, env: {} }, node, 'win32', () => false), { code: 'MCP_FILE_NOT_FOUND' });
});

test('Windows generic executables resolve only exe or com files from fully absolute PATH entries', () => {
  const node = 'C:\\App\\node.exe';
  const searched = [];
  const config = { command: 'python', args: ['server.py', '--value=&literal'], env: { Path: 'relative;C:drive-relative;\\rooted;"C:\\Python Tools";D:\\Fallback' } };
  const resolved = resolveLaunch(config, node, 'win32', file => { searched.push(file); return file === 'D:\\Fallback\\python.com'; });
  assert.deepEqual(searched, ['C:\\Python Tools\\python.exe', 'C:\\Python Tools\\python.com', 'D:\\Fallback\\python.exe', 'D:\\Fallback\\python.com']);
  assert.equal(resolved.command, 'D:\\Fallback\\python.com');
  assert.deepEqual(resolved.args, config.args);
  const explicit = { command: 'C:\\Python Tools\\python.exe', args: ['server.py'], env: {} };
  assert.deepEqual(resolveLaunch(explicit, node, 'win32', () => true), explicit);
});

test('Windows executable resolution rejects missing binaries, relative paths and unsupported script launchers', () => {
  const node = 'C:\\App\\node.exe';
  const reject = (command, env = { PATH: 'C:\\Tools' }, exists = () => true, code = 'MCP_INVALID_CONFIG') => {
    assert.throws(() => resolveLaunch({ command, args: ['& should-never-be-shell'], env }, node, 'win32', exists), { code }, command);
  };
  reject('missing', { PATH: 'C:\\Tools' }, () => false, 'MCP_FILE_NOT_FOUND');
  reject('python', { PATH: 'relative;C:relative;\\rooted;/rooted' }, () => true, 'MCP_FILE_NOT_FOUND');
  for (const command of ['python.cmd', 'python.bat', 'python.ps1', 'C:\\Tools\\python.cmd', '.\\python.exe', '..\\python.com', '.\\npx.cmd']) reject(command);
});

test('non-Windows executable resolution preserves the original native launch configuration', () => {
  const config = { command: '/opt/bin/python', args: ['server.py'], env: { PATH: '/opt/bin' } };
  assert.equal(resolveLaunch(config, '/bundle/node', 'darwin', () => { throw Error('Unexpected Windows resolution'); }), config);
});

test('startup diagnostics retain only fixed bounded causes and leave unclassified exits transient', () => {
  const secret='private-access-token-and-path';
  const missing=startupDiagnostic(undefined,`Error: Cannot find module '${secret}'\ncode: 'MODULE_NOT_FOUND'`);
  assert.equal(missing.code,'MCP_MODULE_NOT_FOUND');
  assert.equal(JSON.stringify(missing).includes(secret),false);
  assert.equal(startupDiagnostic({code:'ENOENT',message:secret}).code,'MCP_FILE_NOT_FOUND');
  assert.equal(startupDiagnostic({code:'EACCES',message:secret}).code,'MCP_ACCESS_DENIED');
  assert.equal(startupDiagnostic({code:'ENFILE',message:secret}).code,'MCP_START_FAILED');
  assert.equal(startupDiagnostic(undefined,'peer exited while connecting'),undefined);
  assert.equal(startupDiagnostic(undefined,`Error: Cannot find module '${secret}'`+'x'.repeat(MAX_STARTUP_STDERR_BYTES)),undefined,'classification cannot retain or inspect an unbounded stderr history');
});

test('managed stdio reports a sanitized missing-module startup cause without retaining raw stderr', {timeout:10000}, async t => {
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mcp startup ')));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const missing=path.join(directory,'private-missing-entry.cjs');
  const transport=new ManagedStdioTransport({command:process.execPath,args:[missing],env:toolEnvironment()}, {processHost:windowsProcessHost()});
  t.after(()=>transport.close());
  let closed;
  const completion=new Promise(resolve=>{closed=resolve;});
  const errors=[];transport.onerror=error=>errors.push(error);transport.onclose=closed;
  await transport.start();await completion;
  assert.equal(transport.startupError.code,'MCP_MODULE_NOT_FOUND');
  assert.ok(errors.some(error=>error.code==='MCP_MODULE_NOT_FOUND'));
  assert.equal(JSON.stringify(transport.startupError).includes(directory),false);
  assert.equal(transport.startupStderr.length,0);
});

function chunkedResponse(chunks, contentType = 'application/json', onCancel = () => {}) {
  let offset = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset === chunks.length) { controller.close(); return; }
      const next = chunks[offset++];
      controller.enqueue(typeof next === 'string' ? Buffer.from(next) : next);
    },
    cancel: onCancel,
  }), { headers: { 'content-type': contentType } });
}

async function bytesIn(response) {
  const reader = response.body.getReader();
  let count = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) return count;
    count += next.value.byteLength;
  }
}

test('third-party environments inherit only basic runtime values and explicit service additions', () => {
  const source = {
    PATH: process.env.PATH || '/usr/bin', HOME: '/users/example', LANG: 'zh_CN.UTF-8',
    SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\example',
    TUNNEL_CLIENT_API_KEY: 'tunnel-private', CONTROL_PLANE_TOKEN: 'control-private',
    OPENAI_API_KEY: 'openai-private', OPENAI_ADMIN_KEY: 'admin-private',
    MCP_AUTH_TOKEN: 'other-service-private', NODE_OPTIONS: '--require evil.cjs',
    NODE_EXTRA_CA_CERTS: '/untrusted-ca.pem', AWS_SECRET_ACCESS_KEY: 'aws-private',
    SERVICE_A_SECRET: 'service-a-private', LOG_PRIVATE: 'log-private',
  };
  const first = toolEnvironment(source, { SERVICE_A_SECRET: 'first-explicit' });
  const second = toolEnvironment(source, { SERVICE_B_SECRET: 'second-explicit' });
  for (const key of ['TUNNEL_CLIENT_API_KEY', 'CONTROL_PLANE_TOKEN', 'OPENAI_API_KEY', 'OPENAI_ADMIN_KEY',
    'MCP_AUTH_TOKEN', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'AWS_SECRET_ACCESS_KEY', 'LOG_PRIVATE']) {
    assert.equal(first[key], undefined, key);
    assert.equal(second[key], undefined, key);
  }
  assert.equal(first.HOME, source.HOME);
  assert.equal(first.LANG, source.LANG);
  assert.equal(first.USERPROFILE, source.USERPROFILE);
  assert.equal(first.SERVICE_A_SECRET, 'first-explicit');
  assert.equal(first.SERVICE_B_SECRET, undefined);
  assert.equal(second.SERVICE_B_SECRET, 'second-explicit');
  assert.equal(second.SERVICE_A_SECRET, undefined);
  assert.equal(source.SERVICE_A_SECRET, 'service-a-private');
  assert.equal(JSON.stringify(second).includes('private'), false);
});

test('managed stdio preserves literal argv and confines each real child to its own environment', { timeout: 15000 }, async t => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp transport 中文 ')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const entry = path.join(directory, "server O'Brien.cjs");
  fs.writeFileSync(entry, `
const readline = require('node:readline');
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', line => {
  const request = JSON.parse(line);
  process.stderr.write('stderr-private-message');
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {
    args: process.argv.slice(2), env: Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:SERVICE_|TUNNEL_CLIENT_|OPENAI_|NODE_OPTIONS)/.test(key))),
  } }) + '\\n');
});
`);
  const literalArgs = ['中文 folder', '$HOME $(echo should-not-run)', 'literal "quote" & %PATH%', "O'Brien", 'C:\\A Folder\\last\\', ';touch unsafe'];
  const inherited = { ...process.env, OPENAI_API_KEY: 'ambient-api-secret', TUNNEL_CLIENT_API_KEY: 'ambient-tunnel-secret', SERVICE_A: 'ambient-other-service' };
  for (const service of ['A', 'B']) {
    const transport = new ManagedStdioTransport({ command: process.execPath, args: [entry, ...literalArgs], cwd: directory,
      env: toolEnvironment(inherited, { [`SERVICE_${service}`]: `explicit-${service}` }) }, { processHost: windowsProcessHost() });
    t.after(() => transport.close());
    let resolveResponse;
    let rejectResponse;
    const response = new Promise((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; });
    transport.onmessage = resolveResponse;
    transport.onerror = rejectResponse;
    await transport.start();
    await transport.send({ jsonrpc: '2.0', id: service, method: 'echo', params: {} });
    const message = await response;
    assert.deepEqual(message.result.args, literalArgs);
    assert.deepEqual(message.result.env, { [`SERVICE_${service}`]: `explicit-${service}` });
    await transport.close();
    assert.notEqual(transport.child.exitCode ?? transport.child.signalCode, null);
  }
  assert.equal(fs.existsSync(path.join(directory, 'unsafe')), false);
});

test('line transport reconstructs split UTF-8 and multiple standard JSON-RPC messages', async t => {
  const input = new PassThrough();
  const output = new PassThrough();
  const messages = [], frames = [];
  const transport = new LineTransport(input, output, {observeTiming:true,onMessage:(_message,frame)=>frames.push(frame)});
  t.after(() => transport.close());
  transport.onmessage = message => messages.push(message);
  await transport.start();
  const first = { jsonrpc: '2.0', id: 1, result: { label: '中文' } };
  const second = { jsonrpc: '2.0', method: 'notifications/tools/list_changed' };
  const wire = Buffer.from(`${JSON.stringify(first)}\r\n${JSON.stringify(second)}\n`);
  const multibyte = wire.indexOf(Buffer.from('中'));
  input.write(wire.subarray(0, multibyte + 1));
  input.write(wire.subarray(multibyte + 1));
  assert.deepEqual(messages, [first, second]);
  assert.equal(frames.length, 2);
  assert.deepEqual(frames.map(frame=>frame.bytes), [Buffer.byteLength(JSON.stringify(first))+2, Buffer.byteLength(JSON.stringify(second))+1]);
  for(const frame of frames){
    assert.ok(Number.isFinite(frame.frameMs)&&frame.frameMs>=0);
    assert.ok(Number.isFinite(frame.parseMs)&&frame.parseMs>=0&&frame.parseMs<=frame.frameMs);
    assert.deepEqual(Object.keys(frame).sort(),['bytes','frameMs','parseMs']);
  }
  const outgoing = once(output, 'data');
  await transport.send({ jsonrpc: '2.0', id: 2, method: 'ping' });
  const [line] = await outgoing;
  assert.equal(line.toString(), '{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
});

test('invalid JSON and invalid protocol fail closed with safe diagnostics', async () => {
  for (const wire of ['{"secret":"do-not-log-this"\n', '{"unrelated":"do-not-log-this"}\n']) {
    const input = new PassThrough();
    const transport = new LineTransport(input, new PassThrough());
    const errors = [];
    let messageCount = 0;
    transport.onerror = error => errors.push(error);
    transport.onmessage = () => messageCount++;
    await transport.start();
    input.write(wire);
    await transport.close();
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'MCP_PROTOCOL_INVALID');
    assert.equal(String(errors[0]).includes('do-not-log-this'), false);
    assert.equal(messageCount, 0);
    assert.equal(transport.closed, true);
  }
});

test('line transport rejects over-budget inbound frames with or without trailing newline', async () => {
  for (const suffix of ['', '\n']) {
    const input = new PassThrough();
    const transport = new LineTransport(input, new PassThrough());
    const errors = [];
    transport.onerror = error => errors.push(error);
    await transport.start();
    input.write(Buffer.concat([Buffer.alloc(MAX_MESSAGE_BYTES + 1, 97), Buffer.from(suffix)]));
    await transport.close();
    assert.equal(errors[0]?.code, 'MCP_MESSAGE_TOO_LARGE');
    assert.equal(transport.buffer.length, 0);
    assert.equal(transport.closed, true);
  }
  const message = { jsonrpc: '2.0', id: 1, result: '界'.repeat(Math.ceil(MAX_MESSAGE_BYTES / 3)) };
  assert.throws(() => boundedMessage(message), { code: 'MCP_MESSAGE_TOO_LARGE' });
});

test('HTTP wrapper forbids redirects and ambient credentials while preserving explicit static authentication', async () => {
  const calls = [];
  const logs = [];
  const originals = { log: console.log, warn: console.warn, error: console.error };
  for (const method of Object.keys(originals)) console[method] = (...args) => logs.push(args);
  try {
    const fetcher = boundedFetch(async (input, init) => {
      calls.push({ input, init });
      return chunkedResponse(['{"ok":true}']);
    });
    const response = await fetcher('https://example.test/mcp', { method: 'POST', redirect: 'follow', credentials: 'include', headers: { Authorization: 'Bearer static-private-auth' } });
    assert.equal(await response.text(), '{"ok":true}');
  } finally {
    Object.assign(console, originals);
  }
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer static-private-auth');
  assert.deepEqual(logs, []);
});

test('HTTP JSON response budget counts cumulative bytes across arbitrary chunks and cancels on overflow', async () => {
  const exact = boundedFetch(async () => chunkedResponse([Buffer.alloc(MAX_MESSAGE_BYTES - 1, 32), Buffer.from('0')]));
  assert.equal(await bytesIn(await exact('https://example.test/mcp')), MAX_MESSAGE_BYTES);
  let cancelled = false;
  const oversized = boundedFetch(async () => chunkedResponse([
    Buffer.alloc(MAX_MESSAGE_BYTES - 1, 32), Buffer.from('界'), Buffer.from('unconsumed'),
  ], 'application/json', () => { cancelled = true; }));
  await assert.rejects(async () => bytesIn(await oversized('https://example.test/mcp')), { message: 'MCP_MESSAGE_TOO_LARGE' });
  assert.equal(cancelled, true);
});

test('SSE budget covers an entire multiline event and rejects an event over 8 MiB', async () => {
  let cancelled = false;
  const oversized = boundedFetch(async () => chunkedResponse([
    Buffer.from(`data: ${'x'.repeat(MAX_MESSAGE_BYTES / 2)}\r\n`),
    Buffer.from(`data: ${'y'.repeat(MAX_MESSAGE_BYTES / 2)}\r\n`),
    Buffer.from('\r\n'),
  ], 'text/event-stream', () => { cancelled = true; }));
  await assert.rejects(async () => bytesIn(await oversized('https://example.test/mcp')), { message: 'MCP_MESSAGE_TOO_LARGE' });
  assert.equal(cancelled, true);
});

test('SSE resets each event budget across CRLF separators split between chunks', async () => {
  const event = Buffer.from(`event: message\r\ndata: ${'x'.repeat(MAX_MESSAGE_BYTES - 128)}\r\ndata: tail`);
  const chunks = [event, '\r', '\n', '\r', '\n', event, '\r\n\r', '\n'];
  const fetcher = boundedFetch(async () => chunkedResponse(chunks, 'text/event-stream; charset=utf-8'));
  const bytes = await bytesIn(await fetcher('https://example.test/mcp'));
  assert.ok(bytes > MAX_MESSAGE_BYTES * 1.9);
});

test('many bounded SSE events may exceed 8 MiB in aggregate', async () => {
  const event = `data: ${'x'.repeat(4096)}\n\n`;
  const chunk = event.repeat(16);
  const chunks = Array(192).fill(chunk);
  const fetcher = boundedFetch(async () => chunkedResponse(chunks, 'text/event-stream'));
  const bytes = await bytesIn(await fetcher('https://example.test/mcp'));
  assert.equal(bytes, Buffer.byteLength(chunk) * chunks.length);
  assert.ok(bytes > MAX_MESSAGE_BYTES);
});
