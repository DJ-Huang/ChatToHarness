'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { McpProxy } = require('../app/mcp-proxy.cjs');
const project = path.resolve(path.sep, 'synthetic-project');
const guidance = [{ project_path: project, agents: [], project_context_token: 'delivered' }];
function fixture({ contexts = guidance, enabled = true } = {}) {
  const client = [], server = [];
  const service = {
    authorizePaths: async paths => paths,
    prepare: async () => ({ contexts, needsDelivery: false }),
  };
  const proxy = new McpProxy({ contexts: service, enabled, defaultDirectory: project,
    sendClient: async message => client.push(message), sendServer: async message => server.push(message) });
  return { proxy, client, server };
}
const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
async function relay(result, options) {
  const f = fixture(options);
  try {
    await f.proxy.client(call('read', 'read_file', { path: path.join(project, 'fixture.txt'), project_path: project }));
    assert.equal(f.server.length, 1);
    await f.proxy.server({ jsonrpc: '2.0', id: 'read', result });
    return f.client[0].result;
  } finally { f.proxy.dispose(); }
}
// Some chat adapters select structuredContent instead of exposing both MCP fields.
const modelResult = result => result.structuredContent ?? result;

test('structured-first clients receive file text rather than guidance alone', async () => {
  const content = [{ type: 'text', text: '真实正文\n中文 / 日本語 / 😀' }];
  const result = await relay({ content });
  assert.deepEqual(modelResult(result)._harness_result.content, content);
  assert.equal(modelResult(result)._harness_result.isError, false);
  assert.deepEqual(result.structuredContent.project_contexts, guidance);
  assert.deepEqual(result.content[0], content[0]);
});

test('mixed native image/audio/resource blocks survive both result representations', async () => {
  const content = [
    { type: 'text', text: 'artifact preview' },
    { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=', annotations: { audience: ['user'] } },
    { type: 'audio', mimeType: 'audio/wav', data: 'UklGRg==' },
    { type: 'resource', resource: { uri: 'fixture://result', mimeType: 'text/plain', text: '中文产物' } },
    { type: 'resource_link', uri: 'fixture://large', name: 'large result' },
  ];
  const result = await relay({ content });
  assert.deepEqual(result.content.slice(0, content.length), content);
  assert.deepEqual(modelResult(result)._harness_result.content, content);
});

test('upstream structured fields survive and client-only metadata is not promoted', async () => {
  const data = { content: 'domain-owned field', pid: 123, rows: [[1, true]] };
  const result = await relay({ content: [{ type: 'text', text: 'stdout' }], structuredContent: data,
    _meta: { 'fixture/client-only': 'not-model-data' } });
  assert.equal(result.structuredContent.content, data.content);
  assert.equal(result.structuredContent.pid, 123);
  assert.deepEqual(result.structuredContent.rows, data.rows);
  assert.equal(result._meta['fixture/client-only'], 'not-model-data');
  assert.doesNotMatch(JSON.stringify(modelResult(result)), /not-model-data/);
});

test('tool failure remains a failure with its original cause visible to structured-first clients', async () => {
  const content = [{ type: 'text', text: 'ENOENT: synthetic fixture does not exist; inspect the path before retry.' }];
  const result = await relay({ content, isError: true });
  assert.equal(result.isError, true);
  assert.equal(modelResult(result)._harness_result.isError, true);
  assert.deepEqual(modelResult(result)._harness_result.content, content);
  assert.equal(modelResult(result).operation_executed, undefined, 'do not infer whether a failed tool had side effects');
});

for (const enabled of [true, false]) {
  test(`empty guidance still returns the declared result shape (guidance enabled=${enabled})`, async () => {
    const content = [{ type: 'text', text: 'ordinary output' }];
    const result = await relay({ content }, { contexts: [], enabled });
    assert.deepEqual(modelResult(result)._harness_result.content, content);
    assert.deepEqual(result.content, content);
    assert.deepEqual(result.structuredContent.project_contexts, []);
  });
}

test('result wrapping preserves process handle tracking and does not replay the command', async () => {
  const f = fixture();
  try {
    const content = [{ type: 'text', text: 'Process started with PID 42\nInitial output:\nhello' }];
    await f.proxy.client(call('start', 'start_process', { command: 'synthetic-only', timeout_ms: 1000, context_paths: [project] }));
    await f.proxy.server({ jsonrpc: '2.0', id: 'start', result: { content } });
    assert.deepEqual(modelResult(f.client[0].result)._harness_result.content, content);
    await f.proxy.client(call('poll', 'read_process_output', { pid: 42 }));
    assert.equal(f.server[1].params.arguments.pid, 42);
    assert.equal(f.server.filter(item => item.params.name === 'start_process').length, 1);
    await f.proxy.server({ jsonrpc: '2.0', id: 'poll', result: { content: [{ type: 'text', text: 'done\n✅ Process completed with exit code 0' }] } });
    assert.ok(f.proxy.processes.get('42').finishedAt);
  } finally { f.proxy.dispose(); }
});

test('reserved-field collisions retain original upstream structured data', async () => {
  const data = { _harness_result: { vendor: true }, project_contexts: ['vendor'] };
  const result = await relay({ content: [], structuredContent: data });
  assert.deepEqual(result.structuredContent._harness_result.upstream_structured_content, data);
  assert.deepEqual(result.structuredContent.project_contexts, guidance);
});

test('wrapping does not mutate upstream content, result metadata, or schema', async () => {
  const content = Object.freeze([Object.freeze({ type: 'text', text: 'immutable' })]);
  const original = Object.freeze({ content, structuredContent: Object.freeze({ value: 1 }) });
  const result = await relay(original);
  assert.equal(original.content.length, 1);
  assert.deepEqual(original.structuredContent, { value: 1 });
  assert.deepEqual(result.structuredContent._harness_result.content, content);
  const f = fixture();
  try {
    const schema = Object.freeze({ type: 'object', properties: Object.freeze({ value: { type: 'number' } }), required: ['value'], additionalProperties: false });
    const decorated = f.proxy.decorateTool({ name: 'read_file', inputSchema: { type: 'object' }, outputSchema: schema });
    assert.equal(decorated.outputSchema.properties._harness_result.type, 'object');
    assert.equal(decorated.outputSchema.properties._harness_result.properties.content.type, 'array');
    assert.deepEqual(decorated.outputSchema.required, ['value']);
    assert.equal(decorated.outputSchema.additionalProperties, false);
    assert.deepEqual(Object.keys(schema.properties), ['value']);
  } finally { f.proxy.dispose(); }
});
