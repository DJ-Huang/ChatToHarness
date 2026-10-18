'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport} = require('@modelcontextprotocol/sdk/client/stdio.js');
const {McpSettings} = require('../app/mcp-settings.cjs');
const {McpManager} = require('../app/mcp-manager.cjs');
const {McpGateway} = require('../app/mcp-gateway.cjs');
const {wrapUri} = require('../app/mcp-content.cjs');
const {windowsProcessHost} = require('./native-helper.cjs');

async function fixture(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cth-content '))), settings = new McpSettings(home, {isEncryptionAvailable: () => false});
  for (const id of ['one', 'two']) { settings.save({id, name: id, enabled: true, transport: 'stdio', command: process.execPath, args: [path.join(__dirname, 'fixtures/mcp-content-server.cjs')]}); settings.trust(id); }
  const manager = new McpManager({settings, enableContent: true, nodePath: process.execPath, processHost: windowsProcessHost()});
  manager.broker = new McpGateway(manager);
  t.after(async () => { await manager.close(); fs.rmSync(home, {recursive: true, force: true, maxRetries: 10, retryDelay: 100}); });
  await manager.start({directories: []}); return {home, settings, manager};
}
test('content-only services connect, namespace resources and support tool fallbacks', {timeout: 15000}, async t => {
  const f = await fixture(t), content = f.manager.content;
  const resources = await content.native('resources/list'); assert.equal(resources.resources.length, 4);
  assert.ok(resources.resources.some(item => item.uri === wrapUri('one', 'fixture://note'))); assert.ok(resources.resources.some(item => item.uri === wrapUri('two', 'fixture://note')));
  const templates = await content.native('resources/templates/list'); assert.equal(templates.resourceTemplates[0].uriTemplate, 'cth-resource://one/fixture://notes/{id}');
  const read = await f.manager.call('mcp_read_resource', {uri: wrapUri('one', 'fixture://notes/with%20space')});
  assert.equal(read.isError, undefined); assert.equal(read.content[1].type, 'resource'); assert.match(read.content[1].resource.text, /with%20space/);
  const prompts = await f.manager.call('mcp_list_prompts', {}); assert.deepEqual(prompts.structuredContent.prompts.map(item => item.name), ['one::inspect', 'two::inspect']);
  const prompt = await f.manager.call('mcp_get_prompt', {name: 'two::inspect', arguments: {subject: '中文 project'}});
  assert.equal(prompt.structuredContent.messages[0].content.text, 'Inspect 中文 project');
  assert.equal(prompt.structuredContent.messages[1].content.resource.uri, wrapUri('two', 'fixture://note'));
  const definition = content.decorateTool(f.manager.records.get('one'), {name: 'preview', _meta: {ui: {resourceUri: 'ui://preview'}, 'vendor/retained': true}});
  assert.equal(definition._meta.ui.resourceUri, wrapUri('one', 'ui://preview')); assert.equal(definition._meta['vendor/retained'], true);
  assert.match(definition._meta.ui.resourceUri, /^ui:\/\//);
  await f.manager.setEnabled('one', false);
  assert.equal((await f.manager.call('mcp_read_resource', {uri: wrapUri('one', 'fixture://note')})).structuredContent.code, 'MCP_CONTENT_UNAVAILABLE');
  assert.equal((await f.manager.call('mcp_read_resource', {uri: wrapUri('two', 'fixture://note')})).isError, undefined);
});
test('native resource and prompt methods pass through authenticated gateway sessions', {timeout: 15000}, async t => {
  const f = await fixture(t), client = new Client({name: 'Content acceptance', version: '1'}, {capabilities: {}});
  const transport = new StdioClientTransport({command: process.execPath, args: [path.join(__dirname, '../app/mcp-gateway-stdio.cjs')], env: {...process.env, ...f.manager.environment()}, stderr: 'ignore'});
  t.after(() => client.close()); await client.connect(transport);
  assert.ok(client.getServerCapabilities().resources); assert.ok(client.getServerCapabilities().prompts);
  const resources = await client.listResources(); assert.equal(resources.resources.length, 4);
  const resource = await client.readResource({uri: wrapUri('one', 'ui://preview')}); assert.match(resource.contents[0].text, /Synthetic resource preview/);
  assert.equal((await client.listPrompts()).prompts[0].name, 'one::inspect');
  const prompt = await client.getPrompt({name: 'one::inspect', arguments: {subject: 'from gateway'}}); assert.equal(prompt.messages[0].content.text, 'Inspect from gateway');
  assert.equal((await client.callTool({name: 'mcp_list_resources', arguments: {}})).isError, undefined);
});

test('forwarded resource_link is namespaced and routes back through the correct MCP server', {timeout:15000}, async t => {
  const f=await fixture(t);
  f.manager.setAllowAllTools(true);
  const result=await f.manager.call('one__link',{});
  assert.equal(result.isError,undefined);
  const link=result.content[0];
  assert.equal(link.type,'resource_link');
  assert.equal(link.uri,wrapUri('one','fixture://note'));
  const response=await f.manager.content.native('resources/read',{uri:link.uri});
  assert.match(response.contents[0].text,/SYNTHETIC_RESOURCE fixture:\/\/note/);
  assert.equal(response.contents[0].uri,link.uri);
});
test('content list notifications fire when enabled resource services change', {timeout:15000}, async t => {
  const f=await fixture(t);
  let resources=0,prompts=0;
  f.manager.on('resourcesChanged',()=>resources++);
  f.manager.on('promptsChanged',()=>prompts++);
  await f.manager.setEnabled('one',false);
  assert.ok(resources>=1);
  assert.ok(prompts>=1);
  assert.equal((await f.manager.content.native('resources/list')).resources.length,2);
});
