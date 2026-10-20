'use strict';
// One real 125-second synthetic command; tunnel-session and app-manager restart.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport} = require('@modelcontextprotocol/sdk/client/stdio.js');
const {RuntimeManager} = require('../app/runtime.cjs');
const {McpManager} = require('../app/mcp-manager.cjs');
const {McpGateway} = require('../app/mcp-gateway.cjs');
const {McpSettings} = require('../app/mcp-settings.cjs');
const {HarnessServices} = require('../app/harness-services.cjs');
const {patchEngine} = require('./engine-isolation.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const root = path.resolve(__dirname, '..'), resources = path.join(root, 'resources');
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cth-continuity 中文 '))), project = path.join(directory, 'project'), home = path.join(directory, 'app');
  fs.mkdirSync(project); fs.writeFileSync(path.join(project, 'AGENTS.md'), '# Synthetic project\nPreserve the fixture counter.\n');
  fs.writeFileSync(path.join(project, 'source.txt'), 'before\n');
  fs.writeFileSync(path.join(project, 'job.cjs'), 'const fs=require("node:fs");fs.appendFileSync("counter.txt","1");process.stdout.write("TASK_BEGIN 中文\\n");const heartbeat=setInterval(()=>process.stdout.write("HEARTBEAT\\n"),20000);setTimeout(()=>{clearInterval(heartbeat);fs.writeFileSync("artifact.json",JSON.stringify({passed:true,marker:"CTH_CONTINUITY"}));process.stdout.write("TASK_COMPLETE\\n")},125000);');
  let manager, runtime, services, client, taskId;
  const settings = new McpSettings(path.join(directory, 'mcp-settings'), {isEncryptionAvailable: () => false});
  const report = {platform: process.platform, arch: process.arch, started_at: new Date().toISOString(), failures: []};
  const startManager = async () => {
    runtime = new RuntimeManager({home, resources}); patchEngine(path.dirname(path.dirname(runtime.paths.desktopCommander)));
    services = new HarnessServices({home, nodePath: runtime.paths.node, processHost: runtime.paths.processHost, engineEntry: runtime.paths.desktopCommander, configHome: runtime.localHome, versions: {app: require('../package.json').version}, runtime: () => runtime.status(), catalog: () => manager.visibleTools(), mcp: () => manager.status()});
    manager = new McpManager({settings, services, enableContent: true, enableProjectGrants: true, nodePath: runtime.paths.node, processHost: runtime.paths.processHost,
      builtinFactory: async desktop => { runtime.prepare(desktop); return {transport: 'stdio', command: runtime.paths.node, args: [runtime.launcher, runtime.paths.desktopCommander, String(process.pid)], cwd: project, env: runtime.childEnvironment(desktop)}; }});
    manager.broker = new McpGateway(manager); await manager.start({directories: [directory], autoProjectContext: true});
  };
  const connect = async () => {
    const peer = new Client({name: 'Continuity acceptance', version: '1'}, {capabilities: {}});
    await peer.connect(new StdioClientTransport({command: runtime.paths.node, args: [path.join(root, 'app/mcp-gateway-stdio.cjs')], env: {...process.env, ...manager.environment()}, stderr: 'ignore'})); return peer;
  };
  const call = async (name, args) => { const result = await client.callTool({name, arguments: args}); assert.notEqual(result.isError, true, JSON.stringify(result)); return result.structuredContent; };
  try {
    await startManager(); client = await connect();
    const overview = await call('get_project_overview', {project_path: project}); assert.equal(overview.guidance.agents.length, 1);
    const source = await call('get_file_result', {project_path: project, path: 'source.txt'});
    const edit = await call('apply_project_edit', {project_path: project, file_path: 'source.txt', content: 'after\n', expected_sha256: source.sha256, idempotency_key: 'source-edit', project_context_tokens: [overview.guidance.project_context_token]});
    assert.equal(fs.readFileSync(path.join(project, 'source.txt'), 'utf8'), 'after\n'); report.project_read_edit = true;
    const quote = value => process.platform === 'win32' ? `'${value.replace(/'/g, "''")}'` : `'${value.replace(/'/g, "'\\''")}'`;
    const args = {project_path: project, command: `${process.platform === 'win32' ? '& ' : ''}${quote(runtime.paths.node)} ${quote(path.join(project, 'job.cjs'))}`, idempotency_key: 'one-long-task', runtime_limit_ms: 180000, artifact_paths: ['artifact.json'], project_context_tokens: [overview.guidance.project_context_token]};
    const began = Date.now(), started = await call('start_task', args); taskId = started.task_id; report.start_call_ms = Date.now() - began; assert.ok(report.start_call_ms < 5000);
    console.log(JSON.stringify({phase: 'started', task_id: taskId, initial_call_ms: report.start_call_ms}));
    await client.close(); client = await connect();
    const duplicate = await call('start_task', args); assert.equal(duplicate.task_id, taskId); assert.equal(duplicate.reused, true); report.session_reconnect = true;
    await pause(2000); await client.close(); await manager.close(); await runtime.close();
    await startManager(); client = await connect();
    const recovered = await call('get_task_status', {project_path: project, task_id: taskId}); report.recovered_state = recovered.state;
    assert.ok(['running', 'starting'].includes(recovered.state), JSON.stringify({state:recovered.state,execution_state:recovered.execution_state,exit_code:recovered.exit_code,error:recovered.error})); report.manager_restart = true;
    const replay = await call('start_task', args); assert.equal(replay.task_id, taskId); assert.equal(replay.reused, true);
    let status, polls = 0;
    do { await pause(2000); status = await call('get_task_status', {project_path: project, task_id: taskId}); if (++polls % 15 === 0) console.log(JSON.stringify({phase: status.state, elapsed_seconds: Math.round((Date.now() - began) / 1000)})); if (Date.now() - began > 170000) throw new Error('Long task exceeded acceptance deadline.'); } while (!status.terminal);
    assert.equal(status.state, 'succeeded'); assert.equal(status.exit_code, 0);
    report.duration_ms = Date.parse(status.finished_at) - Date.parse(status.started_at); assert.ok(report.duration_ms >= 120000);
    assert.equal(fs.readFileSync(path.join(project, 'counter.txt'), 'utf8'), '1'); report.single_execution = true;
    const artifact = await call('get_file_result', {project_path: project, path: 'artifact.json'}); assert.equal(JSON.parse(Buffer.from(artifact.data, 'base64').toString()).passed, true); report.artifact_sha256 = artifact.sha256;
    const logs = await call('get_task_logs', {project_path: project, task_id: taskId}); assert.match(logs.entries.map(entry => entry.text).join(''), /TASK_BEGIN 中文[\s\S]*TASK_COMPLETE/); report.saved_logs = true;
    const results = await call('list_tasks', {project_path: project}); assert.ok(results.items.some(item => item.task_id === taskId));
    const current = await call('get_project_overview', {project_path: project}); await call('undo_project_edit', {project_path: project, undo_id: edit.undo_id, expected_sha256: edit.after_sha256, project_context_tokens: [current.guidance.project_context_token]});
    assert.equal(fs.readFileSync(path.join(project, 'source.txt'), 'utf8'), 'before\n'); report.undo = true;
  } catch (error) {
    report.failures.push(error.message);
    if (taskId) try {
      const saved = services.tasks.result(taskId, project);
      report.task_diagnostics = {state:saved.state,execution_state:saved.execution_state,exit_code:saved.exit_code,error:saved.error,stdout:saved.stdout,stderr:saved.stderr};
      services.tasks.cancel(taskId, project); await pause(4000);
    } catch {}
  }
  finally {
    await client?.close().catch(() => {}); await manager?.close(); await runtime?.close();
    report.finished_at = new Date().toISOString(); const output = path.join(root, '.cache/acceptance'); fs.mkdirSync(output, {recursive: true}); fs.writeFileSync(path.join(output, `continuity-${process.platform}-${process.arch}.json`), JSON.stringify(report, null, 2) + '\n');
    fs.rmSync(directory, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
  }
  console.log(JSON.stringify(report, null, 2)); if (report.failures.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
module.exports = {main};
