'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {EventEmitter} = require('node:events');
const {TaskStore} = require('../app/task-store.cjs');
const {readJson, atomicJson} = require('../app/durable-files.cjs');
const {defaultShell} = require('../app/platform.cjs');
const {windowsProcessHost} = require('./native-helper.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, timeout = 10000) { const deadline = Date.now() + timeout; for (;;) { const value = predicate(); if (value) return value; if (Date.now() > deadline) throw new Error('Task did not reach the expected state.'); await pause(50); } }
function fixture(t, options = {}) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cth-tasks 中文 '))), project = path.join(home, 'project'); fs.mkdirSync(project);
  const engine = path.join(home, 'engine'); fs.mkdirSync(engine);
  fs.writeFileSync(path.join(engine, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(engine, 'command-manager.js'), 'export const commandManager={validateCommand:async command=>!command.includes("blocked-marker")};');
  const configHome = path.join(home, 'config'); fs.mkdirSync(configHome); atomicJson(path.join(configHome, 'config.json'), {defaultShell: process.platform === 'linux' ? '/bin/sh' : defaultShell()});
  const config = {home, engineEntry: path.join(engine, 'index.js'), configHome, nodePath: process.execPath, processHost: windowsProcessHost(), ...options};
  const store = new TaskStore(config), ids = [];
  t.after(async () => { for (const id of ids) try { store.cancel(id, project); } catch {} await until(() => ids.every(id => { try { return store.status(id, project).terminal; } catch { return true; } }), 12000); fs.rmSync(home, {recursive: true, force: true, maxRetries: 10, retryDelay: 100}); });
  const command = code => process.platform === 'win32' ? `& '${process.execPath.replace(/'/g, "''")}' -e '${code.replace(/'/g, "''")}'` : `'${process.execPath.replace(/'/g, "'\\''")}' -e '${code.replace(/'/g, "'\\''")}'`;
  const start = (code, key, extra = {}) => { const value = store.start({project_path: project, idempotency_key: key, command: command(code), runtime_limit_ms: 10000, ...extra}); if (!ids.includes(value.task_id)) ids.push(value.task_id); return value; };
  return {home, project, store, config, command, start, ids};
}
test('persistent task returns immediately, survives a new store and executes each idempotency key once', {timeout: 15000}, async t => {
  const f = fixture(t); const code = 'require("fs").appendFileSync("once.txt","1");console.log("中文 start");setTimeout(()=>console.log("complete"),900)';
  const started = Date.now(), first = f.start(code, 'stable-request'); assert.ok(Date.now() - started < 1000); assert.equal(first.reused, false);
  const second = f.start(code, 'stable-request'); assert.equal(second.task_id, first.task_id); assert.equal(second.reused, true);
  await until(() => f.store.status(first.task_id, f.project).state === 'running');
  const restored = new TaskStore(f.config); assert.equal(restored.status(first.task_id, f.project).state, 'running');
  await until(() => restored.status(first.task_id, f.project).terminal);
  assert.equal(restored.status(first.task_id, f.project).state, 'succeeded'); assert.equal(fs.readFileSync(path.join(f.project, 'once.txt'), 'utf8'), '1');
  assert.equal(restored.start({project_path: f.project, idempotency_key: 'stable-request', command: f.command(code), runtime_limit_ms: 10000}).reused, true);
  assert.throws(() => f.start('console.log("different")', 'stable-request'), {code: 'IDEMPOTENCY_CONFLICT'});
  assert.equal(fs.readFileSync(path.join(f.project, 'once.txt'), 'utf8'), '1');
  const page = restored.logs(first.task_id, f.project, {limit: 1}), next = restored.logs(first.task_id, f.project, {cursor: page.next_cursor});
  assert.match([...page.entries, ...next.entries].map(item => item.text).join(''), /中文 start[\s\S]*complete/);
  assert.deepEqual(restored.logs(first.task_id, f.project, {cursor: page.next_cursor}).entries, next.entries);
});
test('cancel uses an owned task record and preserves output and terminal state', {timeout: 15000}, async t => {
  const f = fixture(t), job = f.start('console.log("before cancellation");setInterval(()=>{},1000)', 'cancel');
  await until(() => f.store.status(job.task_id, f.project).state === 'running');
  f.store.cancel(job.task_id, f.project); f.store.cancel(job.task_id, f.project);
  await until(() => f.store.status(job.task_id, f.project).terminal);
  assert.equal(f.store.status(job.task_id, f.project).state, 'cancelled');
  assert.equal(f.store.cancel(job.task_id, f.project).state, 'cancelled');
  assert.throws(() => f.store.status(job.task_id, f.home), {code: 'TASK_SCOPE_MISMATCH'});
  assert.throws(() => f.store.cancel('1234', f.project), {code: 'INVALID_TASK_ID'});
});
test('the worker applies the configured command validator before executing', {timeout: 15000}, async t => {
  const f = fixture(t), job = f.start('require("fs").writeFileSync("blocked-marker","bad")', 'blocked');
  await until(() => f.store.status(job.task_id, f.project).terminal);
  const result = f.store.status(job.task_id, f.project); assert.equal(result.error.code, 'COMMAND_BLOCKED'); assert.equal(result.operation_executed, false);
  assert.equal(fs.existsSync(path.join(f.project, 'blocked-marker')), false);
});
test('expired worker heartbeats are reported as interrupted and never trigger automatic replay', t => {
  let launches = 0;
  const f = fixture(t, {launch: () => { launches++; const worker = new EventEmitter(); worker.unref = () => {}; return worker; }});
  const job = f.start('console.log("one attempt")', 'orphan');
  const file = path.join(f.store.taskPath(job.task_id), 'state.json');
  atomicJson(file, {...readJson(file), operation_executed: true, execution_state: 'running', state: 'running', updated_at: new Date(Date.now() - 60000).toISOString()});
  const result = f.store.status(job.task_id, f.project); assert.equal(result.state, 'interrupted'); assert.equal(result.execution_state, 'unknown');
  assert.equal(f.start('console.log("one attempt")', 'orphan').reused, true); assert.equal(launches, 1);
});
test('runtime deadline terminates a task and reports a saved timeout', {timeout: 15000}, async t => {
  const f = fixture(t), job = f.start('setInterval(()=>{},1000)', 'deadline', {runtime_limit_ms: 300});
  await until(() => f.store.status(job.task_id, f.project).terminal);
  assert.equal(f.store.status(job.task_id, f.project).state, 'timed_out');
});
