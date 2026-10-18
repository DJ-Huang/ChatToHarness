'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {HarnessServices, DC_TOOLS} = require('../app/harness-services.cjs');
const {ProjectInspector, gitEnvironment} = require('../app/project-inspect.cjs');
const {ProjectContexts} = require('../app/project-context.cjs');
const {sourceIdentity, writeBuildInfo, captureBuild} = require('../app/build-identity.cjs');
const {McpManager} = require('../app/mcp-manager.cjs');

function fixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cth-inspect 中文 ')));
  const project = path.join(directory, 'project space'); fs.mkdirSync(project);
  const contexts = new ProjectContexts({allowedDirectories: [directory], defaultDirectory: project});
  const inspector = new ProjectInspector(contexts);
  const services = new HarnessServices({home: path.join(directory, 'app'), versions: {app: '0.5.0', desktopCommander: '0.3.0'}, build: {commit: 'captured'}, runtime: () => ({state: 'ready', localReady: true}), catalog: () => DC_TOOLS.map(name => ({name}))});
  services.configure({directories: [directory]});
  t.after(() => { inspector.dispose(); contexts.dispose(); services.dispose(); fs.rmSync(directory, {recursive: true, force: true}); });
  const git = (...args) => execFileSync('git', ['-C', project, ...args], {encoding: 'utf8', env: gitEnvironment(), stdio: ['ignore', 'pipe', 'pipe']});
  git('init'); git('config', 'user.name', 'Synthetic Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(project, 'hello 中文.txt'), 'first\nsecond\n'); git('add', '.'); git('commit', '-m', 'synthetic baseline');
  return {directory, project, inspector, contexts, services, git};
}
test('project overview and read-only Git cover unicode files, staged changes and immutable pages', async t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.project, 'AGENTS.md'), '# Project\nUse local project conventions.\n');
  fs.appendFileSync(path.join(f.project, 'hello 中文.txt'), 'third\nfourth\n');
  fs.writeFileSync(path.join(f.project, 'literal; echo injected.txt'), 'only a filename');
  let result = await f.services.call('get_project_overview', {project_path: f.project});
  assert.equal(result.isError, undefined); assert.match(result.structuredContent.summary, /project space/);
  assert.equal(result.structuredContent.guidance.agents.length, 1);
  assert.equal(result.structuredContent.git.clean, false);
  result = await f.inspector.git('diff', {project_path: f.project, limit: 2});
  assert.equal(result.has_more, true); const cursor = result.next_cursor;
  fs.writeFileSync(path.join(f.project, 'hello 中文.txt'), 'later working tree');
  const rest = []; do { result = await f.inspector.git('diff', {project_path: f.project, cursor: result.next_cursor, limit: 2}); rest.push(...result.items); } while (result.has_more);
  assert.ok(rest.some(row => row.text === '+third')); assert.ok(!rest.some(row => row.text.includes('later working tree')));
  assert.equal((await f.inspector.git('diff', {project_path: f.project, cursor, limit: 2})).items.length, 2);
  f.git('add', 'hello 中文.txt');
  const staged = await f.inspector.git('diff', {project_path: f.project, staged: true}); assert.ok(staged.items.some(row => row.text.includes('later working tree')));
  const log = await f.inspector.git('log', {project_path: f.project}); assert.equal(log.items[0].subject, 'synthetic baseline');
  const selected = await f.inspector.git('status', {project_path: f.project, paths: ['literal; echo injected.txt']});
  assert.equal(selected.items[0].path, 'literal; echo injected.txt');
  assert.equal(fs.existsSync(path.join(f.project, 'injected.txt')), false);
});
test('Git scope checks reject outside paths and cursors from another project', async t => {
  const f = fixture(t); fs.appendFileSync(path.join(f.project, 'hello 中文.txt'), 'changed');
  const first = await f.inspector.git('diff', {project_path: f.project, limit: 1});
  await assert.rejects(f.inspector.git('status', {project_path: f.project, paths: ['../outside']}), {code: 'TARGET_OUTSIDE_PROJECT'});
  await assert.rejects(f.inspector.git('diff', {project_path: f.directory, cursor: first.next_cursor}), {code: 'CURSOR_EXPIRED'});
  assert.equal(gitEnvironment({PATH: 'unchanged', GIT_DIR: '/other', GIT_CONFIG_COUNT: '1'}).GIT_DIR, undefined);
  assert.equal(gitEnvironment({PATH: 'unchanged'}).GIT_OPTIONAL_LOCKS, '0');
});
test('status reports captured build and paginates all 25 original engine names', async t => {
  const f = fixture(t), result = await f.services.call('get_harness_status', {limit: 10});
  assert.equal(result.structuredContent.app.build.commit, 'captured');
  assert.equal(result.structuredContent.desktop_commander.expected_tools, 25);
  assert.deepEqual(result.structuredContent.desktop_commander.missing_tools, []);
  assert.equal(result.structuredContent.tool_catalog.items.length, 10);
  assert.equal(result.structuredContent.connection.state, 'ready');
  const next = await f.services.call('get_harness_status', {cursor: result.structuredContent.tool_catalog.next_cursor});
  assert.equal(next.structuredContent.tool_catalog.items.length, 15);
});
test('artifact pages return exact bytes, checksum, and native image content', async t => {
  const f = fixture(t); const bytes = Buffer.from('中文 bytes 012345'); const file = path.join(f.project, 'result.txt'); fs.writeFileSync(file, bytes);
  const first = await f.services.call('get_file_result', {project_path: f.project, path: 'result.txt', length: 7});
  const second = await f.services.call('get_file_result', {project_path: f.project, path: file, offset: 7});
  assert.equal(first.structuredContent.text, '中文 ');
  assert.deepEqual(Buffer.concat([Buffer.from(first.structuredContent.data, 'base64'), Buffer.from(second.structuredContent.data, 'base64')]), bytes);
  assert.equal(first.structuredContent.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(path.join(f.project, 'pixel.png'), png);
  const image = await f.services.call('get_file_result', {project_path: f.project, path: 'pixel.png'});
  assert.equal(image.content[1].type, 'image'); assert.deepEqual(Buffer.from(image.content[1].data, 'base64'), png);
  const denied = await f.services.call('get_file_result', {project_path: f.project, path: '../outside'}); assert.equal(denied.isError, true); assert.ok(denied.structuredContent.next_action);
});
test('safe edits respect the explicitly disabled automatic-guidance setting', async t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.project, 'AGENTS.md'), 'Project guidance.');
  f.services.configure({directories: [f.project], autoProjectContext: false});
  const input = {project_path: f.project, file_path: 'new.txt', content: 'saved', expected_sha256: 'absent', idempotency_key: 'guidance-disabled'};
  const result = await f.services.call('apply_project_edit', input); assert.equal(result.isError, undefined);
  assert.equal(fs.readFileSync(path.join(f.project, 'new.txt'), 'utf8'), 'saved');
  const overview = await f.services.call('get_project_overview', {project_path: f.project}); assert.equal(overview.structuredContent.guidance.agents.length, 1);
});
test('build identity persists the source fingerprint and never invents absent packaged metadata', t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.project, 'app')); fs.writeFileSync(path.join(f.project, 'app', 'main.cjs'), 'module.exports = 1;'); fs.writeFileSync(path.join(f.project, 'package.json'), '{"version":"1.2.3"}');
  const identity = sourceIdentity(f.project); const resources = path.join(f.project, 'resources'); writeBuildInfo(f.project, resources);
  assert.equal(captureBuild({resources, packaged: true}).source_sha256, identity.source_sha256);
  fs.appendFileSync(path.join(f.project, 'app', 'main.cjs'), '\n// changed'); assert.notEqual(sourceIdentity(f.project).source_sha256, identity.source_sha256);
  fs.unlinkSync(path.join(resources, 'build-info.json')); assert.equal(captureBuild({resources, packaged: true}).identity_available, false);
});
test('application services participate in tool discovery and stop with the gateway manager', async t => {
  const f = fixture(t), settings = {list: () => [], getAllowAllTools: () => false};
  const manager = new McpManager({settings, services: f.services}); t.after(() => manager.close());
  await manager.start({directories: [f.project]});
  assert.ok(manager.listTools().tools.some(tool => tool.name === 'git_status'));
  assert.equal((await manager.call('git_status', {project_path: f.project})).structuredContent.clean, true);
  await manager.stop(); assert.equal((await manager.call('git_status', {project_path: f.project})).structuredContent.code, 'MCP_STOPPED');
});
