'use strict';

// Test-only MCP peer. Every instance exposes the same names so aggregation
// tests can detect namespace collisions without special-purpose production code.
const fs = require('node:fs');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema, McpError, ErrorCode } = require('@modelcontextprotocol/sdk/types.js');

const SMALL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const resultSchema = { type: 'object', additionalProperties: true };

function incrementFile(file) {
  if (!file) return;
  let count = 0;
  try { count = Number(fs.readFileSync(file, 'utf8')) || 0; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  fs.writeFileSync(file, String(count + 1));
}

function createFixtureServer({
  name = process.env.MCP_FIXTURE_NAME || 'fixture',
  pageSize = Number(process.env.MCP_FIXTURE_PAGE_SIZE) || 2,
  countFile = process.env.MCP_FIXTURE_COUNT_FILE,
  startFile = process.env.MCP_FIXTURE_START_FILE,
} = {}) {
  let calls = 0;
  let revision = 1;
  let changed = false;
  let reversed = false;
  let hangRevision = 1;
  let hangRemoved = false;
  const server = new Server({ name, version: '1.0.0' }, { capabilities: { tools: { listChanged: true } } });
  const tool = (toolName, description, properties = {}) => ({
    name: toolName, description, inputSchema: { type: 'object', properties, additionalProperties: true }, outputSchema: resultSchema,
  });
  const tools = () => {
    const catalog = [
      tool('echo', `Return the supplied arguments (definition ${revision}).`),
      tool('count', 'Read this connection\'s call count.'),
      tool('change_tools', 'Change the tool catalog and send a list-changed notification.'),
      ...(hangRemoved ? [] : [tool('hang', hangRevision === 1 ? 'Wait until this request is cancelled.' : `Wait until this request is cancelled (definition ${hangRevision}).`)]),
      tool('exit', 'Exit this test server without responding.'),
      tool('inspect_environment', 'Read explicitly named environment variables for isolation tests.', { names: { type: 'array', items: { type: 'string' } } }),
      tool('protocol_error', 'Return a JSON-RPC error for error-preservation tests.'),
      tool('tool_error', 'Return a tool error result for error-preservation tests.'),
      ...(changed ? [tool('added_tool', 'A tool added after discovery.')] : []),
    ];
    return reversed ? catalog.reverse() : catalog;
  };
  const reply = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });

  server.setRequestHandler(ListToolsRequestSchema, async request => {
    const cursor = request.params?.cursor;
    if (cursor !== undefined && !/^page:\d+$/.test(cursor)) throw new McpError(ErrorCode.InvalidParams, 'Invalid test cursor');
    const offset = cursor === undefined ? 0 : Number(cursor.slice(5));
    const catalog = tools();
    const size = Math.max(1, Math.min(100, pageSize));
    const page = catalog.slice(offset, offset + size);
    return { tools: page, ...(offset + size < catalog.length ? { nextCursor: `page:${offset + size}` } : {}) };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const toolName = request.params.name;
    if (!tools().some(item => item.name === toolName)) throw new McpError(ErrorCode.InvalidParams, 'Unknown test tool');
    calls += 1;
    incrementFile(countFile);
    const args = request.params.arguments || {};
    if (toolName === 'echo') {
      const value = reply({ arguments: args, calls, server: name });
      value.content.push({ type: 'image', data: SMALL_PNG, mimeType: 'image/png' });
      return value;
    }
    if (toolName === 'count') return reply({ calls, server: name });
    if (toolName === 'protocol_error') throw new McpError(ErrorCode.InvalidParams, 'Fixture protocol detail', { fixture: true });
    if (toolName === 'tool_error') return { isError: true, ...reply({ fixture: true, sentinel: 'fixture-tool-error' }) };
    if (toolName === 'change_tools') {
      if (args.action === 'reorder') reversed = !reversed;
      else if (args.action === 'change_hang') hangRevision += 1;
      else if (args.action === 'remove_hang') hangRemoved = true;
      else { revision += 1; changed = true; }
      await server.sendToolListChanged();
      return reply({ revision, server: name });
    }
    if (toolName === 'added_tool') return reply({ added: true, calls });
    if (toolName === 'inspect_environment') {
      const environment = {};
      for (const key of Array.isArray(args.names) ? args.names : []) if (typeof key === 'string') environment[key] = process.env[key] ?? null;
      return reply({ environment });
    }
    if (toolName === 'exit') { setImmediate(() => process.exit(17)); return new Promise(() => {}); }
    return new Promise((resolve, reject) => {
      const abort = () => reject(new McpError(ErrorCode.InternalError, 'Test request cancelled'));
      if (extra.signal.aborted) abort();
      else extra.signal.addEventListener('abort', abort, { once: true });
    });
  });
  incrementFile(startFile);
  return server;
}

if (require.main === module) {
  const server = createFixtureServer();
  server.connect(new StdioServerTransport()).catch(() => { process.exitCode = 1; });
}

module.exports = { createFixtureServer, SMALL_PNG };
