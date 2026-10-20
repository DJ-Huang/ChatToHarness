'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {DiagnosticWriter, MAX_QUEUE, MAX_BYTES} = require('../app/diagnostic-writer.cjs');
const {ExecutionHistory} = require('../app/execution-history.cjs');
const {HARD, AGE, inventory} = require('../app/diagnostic-budget.cjs');

async function fixture(t, options = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cth-diagnostic-worker-'));
  const writer = new DiagnosticWriter(home, options);
  let history;
  t.after(async () => { await history?.close(); await writer.close({timeoutMs: 1000}); fs.rmSync(home, {recursive: true, force: true}); });
  await writer.ready;
  history = new ExecutionHistory(home, {writer, clock: options.clock});
  await history.ready;
  return {home, writer, history};
}
const ok = {structuredContent: {message: 'complete'}};

test('worker-mode history is instant in memory and flush persists the coalesced final state off the caller thread', async t => {
  const {home, writer, history} = await fixture(t);
  const original = {readdirSync: fs.readdirSync, readFileSync: fs.readFileSync, writeFileSync: fs.writeFileSync};
  let scans = 0, reads = 0, writes = 0;
  fs.readdirSync = (...args) => { scans++; return original.readdirSync(...args); };
  fs.readFileSync = (...args) => { reads++; return original.readFileSync(...args); };
  fs.writeFileSync = (...args) => { writes++; return original.writeFileSync(...args); };
  let id;
  try {
    id = history.begin('search_project', {project_path: '/project', pattern: 'private query'});
    history.update(id, {state: 'running'}); history.complete(id, ok);
    assert.equal(history.get(id).state, 'succeeded');
    assert.equal(history.rows().length, 1); assert.equal(history.list().total, 1); assert.equal(history.export([id]).length, 1);
    assert.equal((await history.flush()).flushed, true);
    assert.equal(scans, 0); assert.equal(reads, 0); assert.equal(writes, 0);
  } finally { Object.assign(fs, original); }
  const persisted = JSON.parse(fs.readFileSync(history.file(id), 'utf8'));
  assert.equal(persisted.state, 'succeeded');
  assert.ok(!JSON.stringify(persisted).includes('private query'));
  assert.ok(writer.usage > 0);
  writer.log('execution', {state: 'received', delivery: 'unknown', error_code: undefined, token: 'private-token'});
  await writer.flush();
  const text = fs.readFileSync(path.join(home, 'logs', 'app.log'), 'utf8');
  assert.ok(!text.includes('private-token')); assert.ok(!text.includes('[omitted]'));
});

test('queue is bounded, snapshots coalesce before startup and shutdown drains accepted writes', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cth-diagnostic-queue-'));
  const writer = new DiagnosticWriter(home, {maxQueue: 3, maxBytes: 4096});
  t.after(async () => { await writer.close({timeoutMs: 1000}); fs.rmSync(home, {recursive: true, force: true}); });
  const id = 'exec_' + randomUUID(), row = {request_id: id, state: 'received', received_at: new Date().toISOString()};
  writer.saveRow(row); writer.saveRow({...row, state: 'running'}); writer.saveRow({...row, state: 'succeeded'});
  assert.equal(writer.queue.size, 1);
  for (let n = 0; n < 40; n++) writer.log('fixture-' + n, {summary: 'q'.repeat(512)});
  assert.ok(writer.status().pending <= 3); assert.ok(writer.status().bytes <= 4096); assert.ok(writer.status().dropped > 0);
  assert.ok(MAX_QUEUE <= 512); assert.ok(MAX_BYTES <= 12 * 1024 * 1024);
  // Preserve a latest snapshot after queue pressure.
  writer.saveRow({...row, state: 'succeeded'});
  const result = await writer.close(); assert.equal(result.flushed, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'executions', id + '.json'), 'utf8')).state, 'succeeded');
});

test('shared lock contention retains latest snapshots and flush has a bounded wait', async t => {
  const {home, writer, history} = await fixture(t);
  const lock = path.join(home, 'diagnostic-budget.lock'); fs.writeFileSync(lock, String(process.pid), {flag: 'wx'});
  let id;
  try {
    id = history.begin('mutation', {project_path: '/project'}); history.update(id, {state: 'running'}); history.complete(id, ok);
    const result = await writer.flush({timeoutMs: 150});
    assert.equal(result.flushed, false); assert.ok(result.pending > 0); assert.equal(history.get(id).state, 'succeeded');
    assert.equal(fs.existsSync(history.file(id)), false);
  } finally { fs.unlinkSync(lock); }
  assert.equal((await writer.flush()).flushed, true);
  assert.equal(JSON.parse(fs.readFileSync(history.file(id), 'utf8')).state, 'succeeded');
});

test('worker faults report unavailable and flush and close settle without a main-thread disk fallback', async t => {
  const errors = [], {writer, history} = await fixture(t, {onError: error => errors.push(error.code)});
  await writer.worker.terminate();
  assert.equal(writer.status().state, 'unavailable'); assert.equal(errors.length, 1);
  const id = history.begin('read_file', {project_path: '/project'}); history.complete(id, ok);
  assert.equal(history.get(id).state, 'succeeded');
  await assert.rejects(writer.flush(), {code: 'DIAGNOSTIC_WORKER_EXITED'});
  assert.equal((await history.close()).flushed, false);
  assert.equal((await writer.close()).flushed, false);
});

test('initialization failure permits empty in-memory history while tool services continue', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cth-diagnostic-start-'));
  const writer = new DiagnosticWriter(home, {workerFile: path.join(home, 'missing-worker.cjs')});
  t.after(async () => { await writer.close(); fs.rmSync(home, {recursive: true, force: true}); });
  await assert.rejects(writer.ready);
  const history = new ExecutionHistory(home, {writer}); t.after(() => history.close()); await history.ready;
  const id = history.begin('read_file', {}); history.complete(id, ok);
  assert.equal(history.get(id).state, 'succeeded'); assert.equal(history.list().total, 1);
});

test('worker retention marks expired task output, respects active output budget and preserves durable task guards', async t => {
  let now = Date.now();
  const {home, writer, history} = await fixture(t, {clock: () => now});
  const task = 'task_' + '9'.repeat(64), directory = path.join(home, 'tasks', task);
  fs.mkdirSync(directory, {recursive: true});
  fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify({state: 'succeeded', finished_at: new Date(now).toISOString()}));
  fs.writeFileSync(path.join(directory, 'request.json'), '{}'); fs.writeFileSync(path.join(directory, 'worker.claim'), 'keep');
  const output = path.join(directory, 'output.jsonl'); fs.writeFileSync(output, 'old output');
  const old = now - AGE - 1000; fs.utimesSync(output, old / 1000, old / 1000);
  await history.maintain();
  assert.equal(fs.existsSync(output), false); assert.equal(fs.existsSync(path.join(directory, 'output.expired')), true);
  assert.equal(fs.existsSync(path.join(directory, 'request.json')), true); assert.equal(fs.existsSync(path.join(directory, 'worker.claim')), true);
  const id = history.begin('start_task', {}); history.complete(id, {structuredContent: {task_id: task}});
  const detail = await history.detail(id); assert.equal(detail.task_output_expired, true);
  await writer.flush();
  const active = path.join(home, 'tasks', 'task_' + '8'.repeat(64)); fs.mkdirSync(active);
  fs.writeFileSync(path.join(active, 'state.json'), JSON.stringify({state: 'running'}));
  const file = path.join(active, 'output.jsonl'), fd = fs.openSync(file, 'w'); fs.ftruncateSync(fd, HARD); fs.closeSync(fd);
  writer.log('budget-fixture', {state: 'running'});
  assert.equal((await writer.flush({timeoutMs: 150})).flushed, false);
  assert.ok(inventory(home).reduce((sum, entry) => sum + entry.size, 0) >= HARD);
  fs.unlinkSync(file); assert.equal((await writer.flush()).flushed, true);
});

test('worker task synchronization replaces queued flags, captures failed exit and does not require a log-read round trip', async t => {
  const {home, history, writer} = await fixture(t), task = 'task_' + '6'.repeat(64), directory = path.join(home, 'tasks', task);
  fs.mkdirSync(directory, {recursive: true});
  const id = history.begin('start_task', {});
  history.complete(id, {structuredContent: {task_id: task, execution_state: 'not_started'}});
  fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify({state: 'failed', execution_state: 'completed', operation_executed: true, exit_code: 13, finished_at: history.now()}));
  await history.maintain();
  const row = history.get(id); assert.equal(row.state, 'failed'); assert.equal(row.execution_state, 'completed'); assert.equal(row.operation_executed, true); assert.equal(row.exit_code, 13);
  assert.equal(row.error_code,'TASK_EXIT_NONZERO');assert.match(row.error_summary,/13/);
  const rejected=history.begin('start_task',{});
  history.complete(rejected,{isError:true,structuredContent:{task_id:task,code:'IDEMPOTENCY_CONFLICT',message:'Inspect original task.',execution_state:'not_started'}});
  await history.maintain();await writer.flush();
  const persisted=JSON.parse(fs.readFileSync(path.join(home,'executions',rejected+'.json'),'utf8'));
  assert.equal(persisted.error_code,'IDEMPOTENCY_CONFLICT');assert.equal(persisted.execution_state,'not_started');assert.equal(persisted.task_accepted,false);
});
