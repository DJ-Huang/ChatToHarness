'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {McpSettings} = require('../app/mcp-settings.cjs');
const {McpManager} = require('../app/mcp-manager.cjs');
const {ProjectGrants, approvalProject} = require('../app/project-grants.cjs');
const {windowsProcessHost} = require('./native-helper.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) { for (let i = 0; i < 500; i++) { const value = predicate(); if (value) return value; await pause(10); } throw new Error('Expected local approval did not appear.'); }
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cth-grants '))), project = path.join(root, 'project'); fs.mkdirSync(project);
  const settings = new McpSettings(path.join(root, 'settings'), {isEncryptionAvailable: () => false});
  const manager = new McpManager({settings, enableProjectGrants: true, nodePath: process.execPath, processHost: windowsProcessHost()});
  t.after(async () => { await manager.close(); fs.rmSync(root, {recursive: true, force: true, maxRetries: 10, retryDelay: 100}); });
  return {root, project, settings, manager};
}
test('project grants bind tool/config revisions and canonical project paths', async t => {
  const f = fixture(t), grants = new ProjectGrants(path.join(f.root, 'private'));
  const record = {id: 'one', configFingerprint: 'config'}, item = {tool: {name: 'echo', inputSchema: {properties: {project_path: {type: 'string'}}}}, fingerprint: 'definition'};
  const project = await approvalProject({project_path: f.project, path: 'new.txt'}, item, [f.root]); assert.equal(project, f.project);
  assert.equal(await approvalProject({project_path: f.project, path: '../outside.txt'}, item, [f.root]), undefined);
  grants.remember(record, item, project); const reopened = new ProjectGrants(path.join(f.root, 'private'));
  assert.equal(reopened.matches(record, item, project), true); assert.equal(reopened.matches(record, item, f.root), false);
  reopened.reconcile(record, new Map([['echo', 'changed']])); assert.equal(reopened.matches(record, item, project), false);
});
test('local approval can remember a tool, reuse it and revoke it without reconnecting', {timeout: 15000}, async t => {
  const f = fixture(t); f.settings.save({id: 'one', name: 'One', enabled: true, transport: 'stdio', command: process.execPath, args: [path.join(__dirname, 'fixtures/mcp-server.cjs')]}); f.settings.trust('one');
  await f.manager.connect('one'); f.manager.setToolPolicy({serverId: 'one', toolName: 'echo', policy: 'ask'}); await f.manager.start({directories: [f.root]});
  const pending = f.manager.call('one__echo', {value: 'first'}); const approval = await until(() => f.manager.status().approvals[0]);
  f.manager.approve({id: approval.id, allow: true, remember: 'tool'}); assert.equal((await pending).isError, undefined);
  const again = await f.manager.call('one__echo', {value: 'second'}); assert.equal(again.structuredContent.arguments.value, 'second'); assert.equal(f.manager.status().approvals.length, 0);
  assert.equal(f.settings.getAllowAllTools(), false); f.manager.setToolPolicy({serverId: 'one', toolName: 'echo', policy: 'deny'}); assert.equal((await f.manager.call('one__echo', {})).structuredContent.code, 'MCP_TOOL_DENIED');
});
test('remembered project approvals skip only the matching declared project', {timeout: 15000}, async t => {
  const f = fixture(t); f.settings.save({id: 'one', name: 'One', enabled: true, transport: 'stdio', command: process.execPath, args: [path.join(__dirname, 'fixtures/mcp-server.cjs'), '--project-aware']}); f.settings.trust('one');
  await f.manager.connect('one');
  f.manager.setToolPolicy({serverId: 'one', toolName: 'echo', policy: 'ask'});
  await f.manager.start({directories: [f.root]});
  const call = f.manager.call('one__echo', {project_path: f.project}); const approval = await until(() => f.manager.status().approvals[0]); assert.equal(approval.projectPath, f.project);
  f.manager.approve({id: approval.id, allow: true, remember: 'project'}); await call;
  assert.equal((await f.manager.call('one__echo', {project_path: f.project})).isError, undefined); assert.equal(f.manager.status().approvals.length, 0);
  const outside = f.manager.call('one__echo', {project_path: f.root}); const other = await until(() => f.manager.status().approvals[0]);
  f.manager.approve({id: other.id, allow: false}); assert.equal((await outside).structuredContent.code, 'MCP_APPROVAL_DENIED');
  f.manager.setToolPolicy({serverId: 'one', toolName: 'echo', policy: 'ask'}); assert.equal(f.manager.status().servers[0].tools.find(tool => tool.name === 'echo').projectGrants.length, 0);
});
