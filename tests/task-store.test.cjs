'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
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
  const command = code => {
    const name = '.task-' + crypto.createHash('sha256').update(code).digest('hex').slice(0, 16) + '.cjs';
    const script = path.join(project, name);
    if (!fs.existsSync(script)) fs.writeFileSync(script, code);
    return process.platform === 'win32'
      ? `& '${process.execPath.replace(/'/g, "''")}' '${script.replace(/'/g, "''")}'`
      : `'${process.execPath.replace(/'/g, "'\\''")}' '${script.replace(/'/g, "'\\''")}'`;
  };
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
  const f = fixture(t);
  const job = f.store.start({project_path: f.project, idempotency_key: 'blocked', command: 'blocked-marker', runtime_limit_ms: 10000});
  f.ids.push(job.task_id);
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
test('an unreadable task state retains its identity and is never treated as a fresh command', t => {
  let launches = 0;
  const f = fixture(t, {launch: () => { launches++; const worker = new EventEmitter(); worker.unref = () => {}; return worker; }});
  const command = 'console.log("saved identity")', job = f.start(command, 'missing-state');
  fs.unlinkSync(path.join(f.store.taskPath(job.task_id), 'state.json'));
  assert.throws(() => f.start(command, 'missing-state'), error => error.code === 'TASK_STATE_UNREADABLE' && error.details.task_id === job.task_id && error.details.execution_state === 'unknown');
  assert.equal(launches, 1);
});
test('runtime deadline terminates a task and reports a saved timeout', {timeout: 15000}, async t => {
  const f = fixture(t), job = f.start('setInterval(()=>{},1000)', 'deadline', {runtime_limit_ms: 300});
  await until(() => f.store.status(job.task_id, f.project).terminal);
  assert.equal(f.store.status(job.task_id, f.project).state, 'timed_out');
});

test('worker launch failures are durable terminal not-started states', t => {
  const f=fixture(t,{launch:()=>{throw new Error('synthetic start failure')}});
  const job=f.start('console.log("not executed")','launch-error');
  assert.equal(job.state,'failed');
  assert.equal(job.error.code,'TASK_START_FAILED');
  assert.ok(job.finished_at);
  assert.equal(job.operation_executed,false);
  assert.equal(job.execution_state,'not_started');
});
test('asynchronous worker launch errors are terminal',t=>{
  let worker;
  const f=fixture(t,{launch:()=>{worker=new EventEmitter();worker.unref=()=>{};return worker;}});
  const job=f.start('console.log("not executed")','async-error');
  worker.emit('error',new Error('synthetic error'));
  const state=f.store.status(job.task_id,f.project);
  assert.equal(state.state,'failed');
  assert.ok(state.finished_at);
});

test('task results combine terminal state and bounded tails with recoverable log cursors',t=>{
  const f=fixture(t,{launch:()=>{throw new Error('synthetic launch failure');}}),job=f.start('console.log("unused")','tail-result');
  const directory=f.store.taskPath(job.task_id),stateFile=path.join(directory,'state.json');
  atomicJson(stateFile,{...readJson(stateFile),state:'failed',execution_state:'completed',operation_executed:true,exit_code:7});
  const entries=[...Array.from({length:100},(_,index)=>({stream:'stdout',text:`row ${index} ${'中文'.repeat(500)}\n`})),{stream:'stderr',text:'final failure marker'},{stream:'stdout',text:'final output marker'}];
  fs.writeFileSync(path.join(directory,'output.jsonl'),entries.map(item=>JSON.stringify(item)).join('\n')+'\n');
  const result=f.store.result(job.task_id,f.project);
  assert.equal(result.state,'failed');assert.equal(result.exit_code,7);assert.equal(result.execution_state,'completed');
  assert.match(result.stdout,/final output marker/);assert.match(result.stderr,/final failure marker/);
  assert.ok(Buffer.byteLength(result.stdout)<=4096);assert.equal(result.output_truncated,true);assert.equal(result.has_more,true);
  assert.equal(result.log_cursor,`${job.task_id}:0`);assert.ok(result.next_cursor!==result.log_cursor);
  assert.equal(f.store.logs(job.task_id,f.project,{cursor:result.log_cursor,limit:1}).entries[0].text,entries[0].text);
  assert.deepEqual(f.store.result(job.task_id,f.project),result,'result reads never consume logs or relaunch tasks');
  assert.throws(()=>f.store.result(job.task_id,f.home),{code:'TASK_SCOPE_MISMATCH'});
  fs.writeFileSync(path.join(directory,'output.expired'),'expired');
  const expired=f.store.result(job.task_id,f.project);
  assert.equal(expired.output_expired,true);assert.equal(expired.stdout,'');assert.equal(expired.state,'failed');assert.equal(expired.exit_code,7);
});

test('task result tails account for JSON escaping in the complete wire result',t=>{
  const f=fixture(t,{launch:()=>{throw new Error('synthetic launch failure');}}),job=f.start('console.log("unused")','escaped-result');
  const directory=f.store.taskPath(job.task_id);
  fs.writeFileSync(path.join(directory,'output.jsonl'),Array.from({length:8},()=>JSON.stringify({stream:'stdout',text:'\u0001'.repeat(2048)})).join('\n')+'\n');
  const result=f.store.result(job.task_id,f.project);
  assert.ok(Buffer.byteLength(JSON.stringify({content:[{type:'text',text:result.summary}],structuredContent:result}))<16*1024);
  assert.equal(result.output_truncated,true);
  assert.ok(result.stdout.length>0);
});
