'use strict';

// Shared synchronous storage primitives. In the application these run only in
// diagnostic-worker; the legacy standalone history API can still use them.
const fs = require('node:fs');
const path = require('node:path');
const {readJson} = require('./durable-files.cjs');
const {sanitize} = require('./diagnostic-budget.cjs');
const {presentExecution, taskError} = require('./tool-recovery.cjs');

function followsTask(row) {
  if (!row || row.tool !== 'start_task' || !/^task_[a-f0-9]{64}$/.test(row.task_id || '') || row.task_finished || row.task_accepted === false) return false;
  // Legacy rejected requests can reference an existing task without having
  // accepted it. Following that worker would erase the rejection's cause.
  return row.task_accepted === true || !(row.state === 'failed' && row.execution_state === 'not_started' && row.error_code);
}

function readRows(home) {
  const rows = new Map(), directory = path.join(home, 'executions');
  let names = [];
  try { names = fs.readdirSync(directory); } catch {}
  for (const name of names) if (/^exec_[a-f0-9-]{36}\.json$/.test(name)) {
    try {
      const row = readJson(path.join(directory, name), 24576);
      if (row?.request_id + '.json' === name) rows.set(row.request_id, presentExecution(row));
    } catch {}
  }
  return [...rows.values()];
}

function taskPatch(home, row, now = Date.now()) {
  if (!followsTask(row)) return {};
  try {
    const directory = path.join(home, 'tasks', row.task_id);
    for (const folder of [path.join(home, 'tasks'), directory]) {
      const stat = fs.lstatSync(folder);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('UNSAFE_STORAGE');
    }
    const task = readJson(path.join(directory, 'state.json'));
    const terminal = ['succeeded', 'failed', 'interrupted', 'cancelled', 'timed_out'].includes(task.state);
    const finishedAt = task.finished_at || (terminal ? task.updated_at || new Date(now).toISOString() : undefined);
    const stale = !terminal && now - Date.parse(task.updated_at) > 15000;
    const state = stale ? 'unknown' : finishedAt
      ? (['succeeded', 'failed', 'interrupted'].includes(task.state) ? task.state : task.state === 'cancelled' ? 'interrupted' : task.state === 'timed_out' ? 'failed' : 'unknown')
      : fs.existsSync(path.join(directory, 'cancel.request')) ? 'cancelling' : task.state === 'running' ? 'running' : 'submitted';
    // The worker owns the execution truth. A queued response's not_started
    // must never survive once the worker records spawn or process completion.
    const execution = ['not_started', 'unknown', 'running', 'completed'].includes(task.execution_state)
      ? task.execution_state : terminal && task.operation_executed === true ? 'completed' : task.state === 'running' ? 'running' : task.operation_executed === false ? 'not_started' : undefined;
    const failure = taskError(task);
    return {state,
      ...(execution ? {execution_state: stale && task.operation_executed !== false ? 'unknown' : execution} : {}),
      ...(Object.hasOwn(task, 'operation_executed') ? {operation_executed: task.operation_executed} : {}),
      ...(Object.hasOwn(task, 'exit_code') ? {exit_code: task.exit_code} : {}),
      ...(task.started_at ? {started_at: task.started_at} : {}),
      ...(finishedAt ? {finished_at: finishedAt, task_finished: true, error_code: sanitize(failure.code || '', 256), error_summary: sanitize(failure.message || '', 16384)}
        : stale ? {finished_at: new Date(now).toISOString(), error_code: 'TASK_HEARTBEAT_UNAVAILABLE'} : {finished_at: undefined, error_code: ''})};
  } catch { return {state: 'unknown', error_code: 'TASK_RECORD_UNAVAILABLE'}; }
}

function taskDetail(home, row) {
  if (!row || !/^task_[a-f0-9]{64}$/.test(row.task_id || '')) return row;
  row = {...row};
  const directory = path.join(home, 'tasks', row.task_id);
  let fd;
  try {
    for (const dir of [path.join(home, 'tasks'), directory]) {
      const stat = fs.lstatSync(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return row;
    }
    if (fs.existsSync(path.join(directory, 'output.expired'))) return {...row, task_output_expired: true};
    fd = fs.openSync(path.join(directory, 'output.jsonl'), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) return row;
    const buffer = Buffer.alloc(Math.min(16384, stat.size));
    fs.readSync(fd, buffer, 0, buffer.length, 0);
    const lines = buffer.toString('utf8').split('\n'); lines.pop();
    row.stdout = sanitize(lines.flatMap(line => { try { const entry = JSON.parse(line); return entry.stream === 'stdout' ? [entry.text] : []; } catch { return []; } }).join(''), 2048);
  } catch {} finally { if (fd !== undefined) fs.closeSync(fd); }
  return row;
}

module.exports = {readRows, taskPatch, taskDetail, followsTask};
