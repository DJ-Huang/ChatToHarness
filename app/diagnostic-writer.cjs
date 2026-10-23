'use strict';

const {Worker} = require('node:worker_threads');
const {EventEmitter} = require('node:events');
const path = require('node:path');
const {safeFields, sanitize, HARD} = require('./diagnostic-budget.cjs');
const MAX_QUEUE = 512, MAX_BYTES = 12 * 1024 * 1024;
const fault = (code, message) => Object.assign(new Error(message), {code});

// Only this small, bounded queue and live records live in the application
// thread. Directory scans, fsync, rotation and budget locking run in a worker.
class DiagnosticWriter extends EventEmitter {
  constructor(home, {clock = Date.now, onError = () => {}, maxQueue = MAX_QUEUE, maxBytes = MAX_BYTES, workerFile = path.join(__dirname, 'diagnostic-worker.cjs')} = {}) {
    super();
    Object.assign(this, {home, clock, onError, maxQueue: Math.min(MAX_QUEUE, Math.max(1, maxQueue)), maxBytes: Math.min(MAX_BYTES, Math.max(1024, maxBytes))});
    this.queue = new Map(); this.inFlight = new Map(); this.bytes = 0; this.dropped = 0;
    this.requests = new Map(); this.sequence = 0; this.logSequence = 0; this.recentLogs = new Map();
    this.rows = []; this.usage = 0; this.initialized = false; this.closed = false; this.closing = false; this.failure = null;
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.startupTimer = setTimeout(() => this.fail(fault('DIAGNOSTIC_WORKER_TIMEOUT', 'Diagnostic worker did not initialize.')), 5000);
    // A caller may intentionally tolerate unavailable diagnostics; never create
    // an unhandled rejection while it continues starting the actual tools.
    this.ready.catch(() => {});
    try {
      this.worker = new Worker(workerFile, {workerData: {home, now: clock()}});
      this.worker.on('message', message => this.receive(message));
      this.worker.on('error', error => this.fail(error));
      this.worker.on('exit', code => { if (!this.closed) this.fail(fault('DIAGNOSTIC_WORKER_EXITED', `Diagnostic worker exited (${code}).`)); });
    } catch (error) { this.fail(error); }
  }
  status() {
    return {state: this.failure ? 'unavailable' : this.closed ? 'closed' : this.initialized ? 'ready' : 'starting',
      pending: this.queue.size + this.inFlight.size, bytes: this.bytes, dropped: this.dropped, usage: this.usage, limit_bytes: HARD,
      ...(this.failure ? {error_code: this.failure.code || 'DIAGNOSTIC_WORKER_FAILED'} : {})};
  }
  fail(error) {
    if (this.failure || this.closed) return;
    this.failure = fault(error.code || 'DIAGNOSTIC_WORKER_FAILED', sanitize(error.message || 'Diagnostic worker unavailable.', 512));
    clearTimeout(this.retry); clearTimeout(this.startupTimer); this.rejectReady(this.failure);
    for (const request of this.requests.values()) { clearTimeout(request.timer); request.reject(this.failure); }
    this.requests.clear();
    try { this.onError(this.failure); } catch {}
    this.emit('status', this.status());
  }
  receive(message) {
    if (message.type === 'fatal') { this.fail(fault(message.error.code, message.error.message)); return; }
    if (message.type === 'ready') {
      clearTimeout(this.startupTimer);
      this.rows = message.rows || []; this.usage = message.usage || 0; this.initialized = true;
      this.resolveReady({rows: this.rows, usage: this.usage}); this.emit('status', this.status()); this.schedule(); return;
    }
    const request = this.requests.get(message.id);
    if (!request) return;
    this.requests.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(fault(message.error.code, message.error.message)); else request.resolve(message.result);
  }
  request(type, fields = {}, timeoutMs = 5000) {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed) return Promise.reject(fault('DIAGNOSTIC_WRITER_CLOSED', 'Diagnostic writer is closed.'));
    if (this.requests.size >= 8) return Promise.reject(fault('DIAGNOSTIC_QUEUE_BUSY', 'Diagnostic requests are busy.'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.requests.delete(id); reject(fault('DIAGNOSTIC_WORKER_TIMEOUT', 'Diagnostic worker did not respond.')); }, timeoutMs);
      this.requests.set(id, {resolve, reject, timer});
      try { this.worker.postMessage({id, type, now: this.clock(), ...fields}); }
      catch (error) { clearTimeout(timer); this.requests.delete(id); reject(error); this.fail(error); }
    });
  }
  enqueue(key, item) {
    if (this.closed || this.closing || this.failure) return false;
    const bytes = Buffer.byteLength(JSON.stringify(item));
    const prior = this.queue.get(key);
    if (prior) { this.bytes -= prior.bytes; this.queue.delete(key); }
    while ((this.queue.size + this.inFlight.size >= this.maxQueue || this.bytes + bytes > this.maxBytes) && this.queue.size) {
      // Logs are expendable before the latest state of an execution. An older
      // snapshot for the same request has already been coalesced above.
      const oldest = [...this.queue].find(([, value]) => value.kind === 'log') || this.queue.entries().next().value;
      this.queue.delete(oldest[0]); this.bytes -= oldest[1].bytes; this.dropped++;
    }
    if (this.queue.size + this.inFlight.size >= this.maxQueue || this.bytes + bytes > this.maxBytes) { this.dropped++; return false; }
    this.queue.set(key, {...item, key, bytes}); this.bytes += bytes; this.schedule(); return true;
  }
  saveRow(row) {
    if (!/^exec_[a-f0-9-]{36}$/.test(row?.request_id || '') || Buffer.byteLength(JSON.stringify(row)) + 1 > 24576) { this.dropped++; return false; }
    return this.enqueue('row:' + row.request_id, {kind: 'row', row: structuredClone(row)});
  }
  hasPending(id) { const key = 'row:' + id; return this.queue.has(key) || this.inFlight.has(key); }
  log(event, detail = {}) {
    let fields = safeFields(detail);
    if (Buffer.byteLength(JSON.stringify(fields)) > 2048) fields = {summary: sanitize(JSON.stringify(fields), 2048)};
    const name = sanitize(event, 256), signature = name + JSON.stringify(fields), previous = this.recentLogs.get(signature);
    if (previous !== undefined && this.clock() - previous < 60000) return true;
    this.recentLogs.set(signature, this.clock());
    if (this.recentLogs.size > 128) this.recentLogs.delete(this.recentLogs.keys().next().value);
    const line = JSON.stringify({time: new Date(this.clock()).toISOString(), event: name, ...fields}) + '\n';
    return this.enqueue('log:' + ++this.logSequence, {kind: 'log', line});
  }
  schedule(delay = 0) {
    if (this.scheduled || this.retry || this.inFlight.size || !this.initialized || this.failure || this.closed || !this.queue.size) return;
    if (delay) { this.retry = setTimeout(() => { this.retry = null; this.schedule(); }, delay); return; }
    this.scheduled = true;
    setImmediate(() => { this.scheduled = false; void this.drain(); });
  }
  async drain() {
    if (this.inFlight.size || this.failure || this.closed || !this.initialized || !this.queue.size) return;
    const items = [...this.queue.values()].slice(0, 16);
    for (const item of items) { this.queue.delete(item.key); this.inFlight.set(item.key, item); }
    let retry = false;
    try {
      const result = await this.request('batch', {items: items.map(({bytes, ...item}) => item)});
      const saved = new Set(result.saved);
      this.usage = result.usage;
      for (const item of items) {
        this.inFlight.delete(item.key); this.bytes -= item.bytes;
        if (!saved.has(item.key) && !this.queue.has(item.key)) { this.queue.set(item.key, item); this.bytes += item.bytes; retry = true; }
      }
      this.emit('maintenance', {removed_ids: result.removed_ids, usage: this.usage});
    } catch (error) {
      // A broken worker never falls back to synchronous main-thread I/O.
      for (const item of items) { this.inFlight.delete(item.key); if (!this.queue.has(item.key)) this.queue.set(item.key, item); else this.bytes -= item.bytes; }
      this.fail(error);
    }
    this.emit('settled'); this.schedule(retry ? 100 : 0);
  }
  async maintain(tasks = []) {
    await this.ready;
    const result = await this.request('maintain', {tasks: tasks.slice(0, 10000).map(({request_id, task_id, tool, task_accepted, task_finished, state, execution_state, error_code}) =>
      ({request_id, task_id, tool, task_accepted, task_finished, state, execution_state, error_code}))});
    this.usage = result.usage; this.emit('maintenance', result); return result;
  }
  async detail(row) { await this.ready; return this.request('detail', {row}); }
  async flush({timeoutMs = 5000} = {}) {
    await this.ready;
    if (this.failure) throw this.failure;
    if (!this.queue.size && !this.inFlight.size) return {...this.status(), flushed: true};
    this.schedule();
    return new Promise((resolve, reject) => {
      let timer;
      const finish = () => {
        if (!this.failure && (this.queue.size || this.inFlight.size)) return;
        clearTimeout(timer); this.off('settled', finish); this.off('status', finish);
        if (this.failure) reject(this.failure); else resolve({...this.status(), flushed: true});
      };
      timer = setTimeout(() => { this.off('settled', finish); this.off('status', finish); resolve({...this.status(), flushed: false}); }, timeoutMs);
      this.on('settled', finish); this.on('status', finish); finish();
    });
  }
  async close(options = {}) {
    if (this.closed) return {...this.status(), flushed: !this.queue.size && !this.inFlight.size};
    this.closing = true;
    let result;
    try { result = await this.flush(options); } catch { result = {...this.status(), flushed: false}; }
    this.closed = true; clearTimeout(this.retry); clearTimeout(this.startupTimer);
    for (const request of this.requests.values()) { clearTimeout(request.timer); request.reject(fault('DIAGNOSTIC_WRITER_CLOSED', 'Diagnostic writer is closed.')); }
    this.requests.clear();
    await this.worker?.terminate(); return result;
  }
}

module.exports = {DiagnosticWriter, MAX_QUEUE, MAX_BYTES};
