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
    const names = ['task-worker.cjs', 'platform.cjs', 'durable-files.cjs', 'diagnostic-budget.cjs', 'task-output.cjs'];
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
  existing(input) {
    if(typeof input.idempotency_key!=='string')return undefined;
    const id=`task_${sha(JSON.stringify([input.project_path,input.idempotency_key]))}`;
    return fs.existsSync(path.join(this.directory,id)) ? this.start(input) : undefined;
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
    for (const key of Object.keys(env)) if (/^(CTH_GATEWAY_|NODE_TEST_)/i.test(key) || ['NODE_OPTIONS','NODE_CHANNEL_FD','NODE_UNIQUE_ID','ELECTRON_RUN_AS_NODE'].includes(key)) delete env[key];
    env.DO_NOT_TRACK = '1'; if (this.configHome) env.LOCALHARNESS_DC_HOME = this.configHome;
    const markLaunchFailure = () => {
      try {
        const file = path.join(directory, 'state.json');
        const saved = readJson(file);
        if (FINAL.has(saved.state) || saved.state !== 'queued') return;
        const finished = now();
        atomicJson(file, {...saved, state: 'failed', updated_at: finished, finished_at: finished,
          operation_executed: false, execution_state: 'not_started',
          error: {code: 'TASK_START_FAILED', message: 'The persistent worker could not start.'}});
      } catch {}
    };
    try {
      const worker = this.launch(this.nodePath, [path.join(this.workerDirectory, 'task-worker.cjs'), directory], {cwd: input.project_path, env, detached: true, windowsHide: true, stdio: 'ignore'});
      worker.once('error', markLaunchFailure);
      worker.unref();
    } catch (error) { markLaunchFailure(); }
    return {...this.status(taskId, input.project_path), reused: false};
  }
  status(id, project) {
    const {directory, request} = this.request(id, project); let saved;
    try { saved = readJson(path.join(directory, 'state.json')); }
    catch { throw fail('TASK_STATE_UNREADABLE', 'The saved task state cannot be read. Keep this task_id and inspect its artifacts and logs before deciding what to do next; the command will not be replayed.', {task_id: id, operation_executed: null, execution_state: 'unknown'}); }
    const stale = !FINAL.has(saved.state) && Date.now() - Date.parse(saved.updated_at) > 15000;
    const state = stale ? {...saved, state: 'interrupted', execution_state: saved.operation_executed !== false ? 'unknown' : 'not_started', next_action: 'Worker heartbeat is unavailable. Inspect artifacts and logs; this task will never be replayed automatically.'} : saved;
    return {summary: `${id}: ${state.state}.`, ...state, command_summary: request.command.slice(0, 200), artifact_paths: request.artifact_paths,
      cancel_requested: fs.existsSync(path.join(directory, 'cancel.request')), terminal: FINAL.has(state.state)};
  }
  list(project) {
    if (!fs.existsSync(this.directory)) return [];
    const values = [];
    for (const id of fs.readdirSync(this.directory)) if (/^task_[a-f0-9]{64}$/.test(id)) try { values.push(this.status(id, project)); } catch (error) { if (error.code !== 'TASK_SCOPE_MISMATCH') values.push({task_id: id, state: 'unreadable', error: {code: error.code || 'TASK_RECORD_UNREADABLE'}}); }
    return values.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }
  result(id, project) {
    const state=this.status(id,project),{directory}=this.request(id,project),expired=()=>fs.existsSync(path.join(directory,'output.expired'));
    const unavailable=code=>({...state,stdout:'',stderr:'',output_expired:code==='TASK_LOG_EXPIRED',output_error:{code,message:code==='TASK_LOG_EXPIRED'?'Saved task output expired under diagnostic retention.':'Saved task output could not be read safely.'},has_more:false,output_truncated:false});
    if(expired())return unavailable('TASK_LOG_EXPIRED');
    const file=path.join(directory,'output.jsonl');let buffer=Buffer.alloc(0),size=0,start=0;
    if(fs.existsSync(file)) {
      let fd;
      try {
        fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
        const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.nlink!==1)return unavailable('UNSAFE_STORAGE');
        size=stat.size;start=Math.max(0,size-65536);buffer=Buffer.alloc(size-start);
        const read=fs.readSync(fd,buffer,0,buffer.length,start);buffer=buffer.subarray(0,read);
      }catch{return unavailable('TASK_LOG_UNREADABLE');}finally{if(fd!==undefined)fs.closeSync(fd);}
    }
    let at=0,consumed=0,stdout='',stderr='',omitted=start>0;
    // When seeking into a tail, discard only the partial first JSONL entry.
    if(start>0){const first=buffer.indexOf(10);at=first<0?buffer.length:first+1;consumed=at;}
    for(;;) {
      const end=buffer.indexOf(10,at);if(end<0)break;
      let entry;try{entry=JSON.parse(buffer.subarray(at,end).toString('utf8'));}catch{return unavailable('TASK_LOG_UNREADABLE');}
      if(typeof entry.text==='string'&&(entry.stream==='stdout'||entry.stream==='stderr')) {
        const previous=entry.stream==='stdout'?stdout:stderr,combined=previous+entry.text;
        let tail=Buffer.from(combined);if(tail.length>4096){omitted=true;let offset=tail.length-4096;while(offset<tail.length&&(tail[offset]&0xc0)===0x80)offset++;tail=tail.subarray(offset);}
        if(entry.stream==='stdout')stdout=tail.toString('utf8');else stderr=tail.toString('utf8');
      }
      consumed=end+1;at=end+1;
    }
    if(expired())return unavailable('TASK_LOG_EXPIRED');
    const cursor=`${id}:${start+consumed}`,result={...state,stdout,stderr,output_expired:false,output_truncated:omitted||Boolean(state.log_truncated),
      // If old output was omitted, the log cursor starts at the beginning so it
      // can be recovered. next_cursor always follows the complete tail entries.
      log_cursor:omitted?`${id}:0`:cursor,next_cursor:cursor,has_more:omitted||start+consumed<size};
    while(Buffer.byteLength(JSON.stringify({content:[{type:'text',text:result.summary}],structuredContent:result}))>14*1024&&(result.stdout.length||result.stderr.length)) {
      result.stdout=result.stdout.slice(Math.ceil(result.stdout.length/2));result.stderr=result.stderr.slice(Math.ceil(result.stderr.length/2));
      result.output_truncated=true;result.has_more=true;result.log_cursor=`${id}:0`;
    }
    return result;
  }
  logs(id, project, args = {}) {
    const {directory} = this.request(id, project); let offset = 0;
    if (fs.existsSync(path.join(directory,'output.expired'))) throw fail('TASK_LOG_EXPIRED', 'Saved task output has expired under diagnostic retention.');
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
    if (fs.existsSync(path.join(directory,'output.expired'))) throw fail('TASK_LOG_EXPIRED', 'Saved task output has expired under diagnostic retention.');
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
