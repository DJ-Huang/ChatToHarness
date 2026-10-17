'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {privateDirectory, readJson, atomicJson, syncDirectory} = require('./durable-files.cjs');
const {developmentEnvironment} = require('./platform.cjs');
const {cleanEnvironment} = require('./runtime.cjs');
const {fail, integer} = require('./project-inspect.cjs');
const FINAL = new Set(['succeeded', 'failed', 'cancelled', 'timed_out', 'interrupted']);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
class TaskStore {
  constructor({home, nodePath = process.execPath, processHost, engineEntry, configHome, workerSource = __dirname, launch = spawn} = {}) {
    Object.assign(this, {home, nodePath, processHost, engineEntry, configHome, workerSource, launch});
    this.directory = path.join(home, 'tasks');
  }
  initialize() {
    privateDirectory(this.directory);
    const names = ['task-worker.cjs', 'platform.cjs', 'durable-files.cjs'];
    const revision = sha(names.map(name => fs.readFileSync(path.join(this.workerSource, name))).join('\n')).slice(0, 24);
    this.workerDirectory = path.join(this.home, 'task-runtime', revision); privateDirectory(this.workerDirectory);
    for (const name of names) { const file = path.join(this.workerDirectory, name); if (!fs.existsSync(file)) fs.writeFileSync(file, fs.readFileSync(path.join(this.workerSource, name)), {flag: 'wx', mode: 0o600}); }
  }
  taskPath(id) {
    if (typeof id !== 'string' || !/^task_[a-f0-9]{64}$/.test(id)) throw fail('INVALID_TASK_ID', 'Use the task_id returned by start_task.');
    const directory = path.join(this.directory, id);
    try { if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) throw new Error(); }
    catch { throw fail('TASK_NOT_FOUND', 'This task is not present in local task storage.'); }
    return directory;
  }
  request(id, project) {
    const directory = this.taskPath(id), request = readJson(path.join(directory, 'request.json'));
    if (request.task_id !== id || request.project_path !== project) throw fail('TASK_SCOPE_MISMATCH', 'This task belongs to a different project.');
    return {directory, request};
  }
  start(input) {
    this.initialize();
    if (typeof input.command !== 'string' || !input.command.trim() || input.command.length > 65536 || input.command.includes('\0')) throw fail('INVALID_ARGUMENT', 'command must be nonempty shell text up to 65536 characters.');
    if (typeof input.idempotency_key !== 'string' || !input.idempotency_key || input.idempotency_key.length > 128 || input.idempotency_key.includes('\0')) throw fail('IDEMPOTENCY_KEY_REQUIRED', 'Supply a stable idempotency_key for this intended task; reuse it after reconnecting.');
    const limit = integer(input.runtime_limit_ms, 24 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000);
    const payload = {project_path: input.project_path, command: input.command, runtime_limit_ms: limit, artifact_paths: input.artifact_paths || []};
    const taskId = `task_${sha(JSON.stringify([input.project_path, input.idempotency_key]))}`, directory = path.join(this.directory, taskId), fingerprint = sha(JSON.stringify(payload));
    if (fs.existsSync(directory)) {
      const {request} = this.request(taskId, input.project_path);
      if (request.fingerprint !== fingerprint) throw fail('IDEMPOTENCY_CONFLICT', 'This key already identifies a different command, timeout or artifact list. Inspect the original task; use a new key only for a new intended operation.', {task_id: taskId});
      return {...this.status(taskId, input.project_path), reused: true};
    }
    const stored = fs.readdirSync(this.directory).filter(name => /^task_[a-f0-9]{64}$/.test(name));
    if (stored.length >= 1024) throw fail('TASK_STORE_FULL', 'Task storage contains 1024 records. Archive completed task records before starting more.');
    const active = stored.filter(id => { try { const state = readJson(path.join(this.directory, id, 'state.json')); return !FINAL.has(state.state) && Date.now() - Date.parse(state.updated_at) < 15000; } catch { return false; } });
    if (active.length >= 4) throw fail('TASK_LIMIT', 'Four local tasks are active. Wait for one to finish or cancel it.');
    try { fs.mkdirSync(directory, {mode: 0o700}); }
    catch (error) { if (error.code === 'EEXIST') throw fail('TASK_START_PENDING', 'The same task is being recorded. Retry with the same key.', {task_id: taskId}); throw error; }
    const created = now(), request = {...payload, schema: 1, task_id: taskId, fingerprint, created_at: created, engine_entry: this.engineEntry, config_home: this.configHome, process_host: this.processHost};
    atomicJson(path.join(directory, 'request.json'), request);
    const state = {task_id: taskId, project_path: input.project_path, state: 'queued', created_at: created, updated_at: created, operation_executed: false, execution_state: 'not_started'};
    atomicJson(path.join(directory, 'state.json'), state); syncDirectory(this.directory);
    const env = developmentEnvironment(cleanEnvironment(), this.nodePath);
    for (const key of Object.keys(env)) if (/^CTH_GATEWAY_/i.test(key)) delete env[key];
    env.DO_NOT_TRACK = '1'; if (this.configHome) env.LOCALHARNESS_DC_HOME = this.configHome;
    try {
      const worker = this.launch(this.nodePath, [path.join(this.workerDirectory, 'task-worker.cjs'), directory], {cwd: input.project_path, env, detached: true, windowsHide: true, stdio: 'ignore'});
      worker.once('error', () => { try { atomicJson(path.join(directory, 'state.json'), {...state, state: 'failed', updated_at: now(), error: {code: 'TASK_START_FAILED', message: 'The persistent worker could not start.'}}); } catch {} });
      worker.unref();
    } catch (error) { atomicJson(path.join(directory, 'state.json'), {...state, state: 'failed', updated_at: now(), error: {code: 'TASK_START_FAILED', message: 'The persistent worker could not start.'}}); }
    return {...this.status(taskId, input.project_path), reused: false};
  }
  status(id, project) {
    const {directory, request} = this.request(id, project), saved = readJson(path.join(directory, 'state.json'));
    const stale = !FINAL.has(saved.state) && Date.now() - Date.parse(saved.updated_at) > 15000;
    const state = stale ? {...saved, state: 'interrupted', execution_state: saved.operation_executed ? 'unknown' : 'not_started', next_action: 'Worker heartbeat is unavailable. Inspect artifacts and logs; this task will never be replayed automatically.'} : saved;
    return {summary: `${id}: ${state.state}.`, ...state, command_summary: request.command.slice(0, 200), artifact_paths: request.artifact_paths,
      cancel_requested: fs.existsSync(path.join(directory, 'cancel.request')), terminal: FINAL.has(state.state)};
  }
  list(project) {
    if (!fs.existsSync(this.directory)) return [];
    const values = [];
    for (const id of fs.readdirSync(this.directory)) if (/^task_[a-f0-9]{64}$/.test(id)) try { values.push(this.status(id, project)); } catch (error) { if (error.code !== 'TASK_SCOPE_MISMATCH') values.push({task_id: id, state: 'unreadable', error: {code: error.code || 'TASK_RECORD_UNREADABLE'}}); }
    return values.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }
  logs(id, project, args = {}) {
    const {directory} = this.request(id, project); let offset = 0;
    if (args.cursor !== undefined) { const match = new RegExp(`^${id}:(\\d+)$`).exec(args.cursor); if (!match || !Number.isSafeInteger(Number(match[1]))) throw fail('INVALID_CURSOR', 'Use the log cursor returned for this task.'); offset = Number(match[1]); }
    const limit = integer(args.limit, 60, 200), file = path.join(directory, 'output.jsonl');
    let bytes = Buffer.alloc(0), size = 0;
    if (fs.existsSync(file)) {
      const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try { const stat = fs.fstatSync(fd); if (!stat.isFile() || stat.nlink !== 1) throw fail('UNSAFE_STORAGE', 'The task log is not a private regular file.'); size = stat.size;
        if (offset > size) throw fail('INVALID_CURSOR', 'The log cursor is beyond the stored output.'); const buffer = Buffer.alloc(Math.min(65536, size - offset)); const read = fs.readSync(fd, buffer, 0, buffer.length, offset); bytes = buffer.subarray(0, read);
      } finally { fs.closeSync(fd); }
    }
    const entries = []; let consumed = 0, start = 0;
    for (;;) { const end = bytes.indexOf(10, start); if (end < 0 || entries.length >= limit) break; entries.push(JSON.parse(bytes.subarray(start, end).toString('utf8'))); consumed = end + 1; start = end + 1; }
    return {summary: `${entries.length} saved log entries.`, task_id: id, entries, has_more: offset + consumed < size, next_cursor: `${id}:${offset + consumed}`, incomplete_tail: bytes.length > 0 && consumed === 0, task: this.status(id, project)};
  }
  cancel(id, project) {
    const {directory} = this.request(id, project), state = this.status(id, project);
    if (state.terminal) return state;
    try { const fd = fs.openSync(path.join(directory, 'cancel.request'), 'wx', 0o600); fs.writeFileSync(fd, now()); fs.fsyncSync(fd); fs.closeSync(fd); syncDirectory(directory); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return {...this.status(id, project), summary: 'Cancellation recorded; query task status until the worker reports a terminal state.'};
  }
}
module.exports = {TaskStore, FINAL};
