'use strict';

const {parentPort, workerData} = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const {privateDirectory, atomicJson} = require('./durable-files.cjs');
const {writeBudgeted, cleanup, locked, inventory, regular, sanitize} = require('./diagnostic-budget.cjs');
const {readRows, taskPatch, taskDetail} = require('./diagnostic-storage.cjs');
const home = workerData.home;
let knownIds = new Set();

function snapshot() {
  const files = inventory(home);
  const ids = new Set(files.filter(file => file.kind === 'executions').map(file => path.basename(file.file, '.json')));
  const removed_ids = [...knownIds].filter(id => !ids.has(id));
  knownIds = ids;
  return {usage: files.reduce((sum, file) => sum + file.size, 0), removed_ids};
}
function saveRow(row) {
  const file = path.join(home, 'executions', row.request_id + '.json');
  atomicJson(file, row); knownIds.add(row.request_id);
}
function saveLog(line) {
  const file = path.join(home, 'logs', 'app.log');
  if (regular(file)?.size > 1024 * 1024) fs.renameSync(file, file + '.previous');
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW, 0o600);
  try { if (fs.fstatSync(fd).nlink !== 1) throw Error('UNSAFE_STORAGE'); fs.writeSync(fd, line); }
  finally { fs.closeSync(fd); }
}
function saveBatch(items, now) {
  const saved = [];
  let incoming = 0, recordSlot = 0, detailed = false;
  for (const item of items) {
    if (item.kind === 'row') {
      if (!/^exec_[a-f0-9-]{36}$/.test(item.row?.request_id || '') || Buffer.byteLength(JSON.stringify(item.row)) + 1 > 24576) throw Error('INVALID_DIAGNOSTIC_RECORD');
      incoming += (Buffer.byteLength(JSON.stringify(item.row)) + 1) * 2;
      if (!regular(path.join(home, 'executions', item.row.request_id + '.json'))) recordSlot++;
      detailed ||= Boolean(item.row.stdout);
    } else incoming += Buffer.byteLength(item.line);
  }
  // One shared-budget scan per bounded batch, rather than one scan per state
  // transition. The detached task worker still competes for the same lock.
  writeBudgeted(home, incoming, () => {
    for (const item of items) {
      try { if (item.kind === 'row') saveRow(item.row); else saveLog(item.line); saved.push(item.key); } catch {}
    }
  }, {now, recordSlot, detailed});
  return saved;
}

try {
  privateDirectory(home);
  privateDirectory(path.join(home, 'executions'));
  privateDirectory(path.join(home, 'logs'));
  locked(home, () => cleanup(home, {now: workerData.now}));
  const rows = readRows(home), status = snapshot();
  parentPort.postMessage({type: 'ready', rows, ...status});
  parentPort.on('message', message => {
    try {
      let result;
      if (message.type === 'batch') {
        result = {saved: saveBatch(message.items, message.now), ...snapshot()};
      } else if (message.type === 'maintain') {
        const patches = message.tasks.map(row => ({request_id: row.request_id, task_id: row.task_id, patch: taskPatch(home, row, message.now)}));
        locked(home, () => cleanup(home, {now: message.now}));
        result = {patches, ...snapshot()};
      } else if (message.type === 'detail') result = taskDetail(home, message.row);
      else throw Object.assign(Error('Unknown diagnostic operation'), {code: 'DIAGNOSTIC_OPERATION_INVALID'});
      parentPort.postMessage({type: 'response', id: message.id, result});
    } catch (error) {
      parentPort.postMessage({type: 'response', id: message.id, error: {code: error.code || 'DIAGNOSTIC_WRITE_FAILED', message: sanitize(error.message, 512)}});
    }
  });
} catch (error) {
  parentPort.postMessage({type: 'fatal', error: {code: error.code || 'DIAGNOSTIC_INITIALIZATION_FAILED', message: sanitize(error.message, 512)}});
}
