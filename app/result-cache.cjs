'use strict';

const fs = require('node:fs/promises');
const constants = require('node:fs').constants;
const path = require('node:path');
const crypto = require('node:crypto');
const RESULT = /^result_[a-f0-9]{32}$/;
const EXECUTION = /^exec_[a-f0-9-]{36}$/;
const MAX_RECORD = 8 * 1024 * 1024 + 65536;

async function readPrivate(file, maximum = MAX_RECORD) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > maximum) throw Error('UNSAFE_RESULT_STORAGE');
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}
async function atomic(file, value) {
  const temporary = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  let handle;
  try {
    handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(JSON.stringify(value)); await handle.sync(); await handle.close(); handle = null;
    const prior = await fs.lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (prior && (!prior.isFile() || prior.isSymbolicLink() || prior.nlink !== 1)) throw Error('UNSAFE_RESULT_STORAGE');
    await fs.rename(temporary, file);
    let directory;
    try { directory = await fs.open(path.dirname(file), 'r'); await directory.sync(); }
    catch (error) { if (process.platform !== 'win32' || !['EPERM','EISDIR','EINVAL','EACCES'].includes(error.code)) throw error; }
    finally { await directory?.close(); }
  } finally { await handle?.close(); await fs.unlink(temporary).catch(() => {}); }
}

// One app owns this store. Serialize mutations and use asynchronous I/O so a
// result-cache scan/fsync never blocks the desktop application's main thread.
class ResultCache {
  constructor({storage, clock = Date.now, maxBytes = 50 * 1024 * 1024, maxAge = 7 * 86400000, maxRecords = 10000}) {
    Object.assign(this, {storage, clock, maxBytes, maxAge, maxRecords});
    this.files = new Map(); this.refs = new Map(); this.bytes = 0; this.queue = Promise.resolve();
  }
  initialize() {
    if (!this.ready) this.ready = this.scan().then(()=>{
      if(!this.timer&&!this.closed){this.timer=setInterval(()=>{this.queue=this.queue.then(()=>this.prune()).catch(()=>{});},60000);this.timer.unref?.();}
    }).catch(error => { this.ready = null; throw error; });
    return this.ready;
  }
  async scan() {
    this.directory = await this.storage(); this.files.clear(); this.refs.clear(); this.bytes = 0;
    for (const name of await fs.readdir(this.directory)) {
      if (!/^(?:result_[a-f0-9]{32}\.json|exec_[a-f0-9-]{36}\.ref\.json)$/.test(name)) continue;
      const file = path.join(this.directory, name), stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) continue;
      this.bytes += stat.size;
      this.files.set(name, {size: stat.size, time: stat.mtimeMs});
      if (name.endsWith('.ref.json')) try {
        const ref = await readPrivate(file, 4096);
        if (EXECUTION.test(ref.request_id) && name === ref.request_id + '.ref.json' && RESULT.test(ref.result_id)) this.refs.set(ref.request_id, ref);
      } catch { /* Malformed cache metadata cannot authorize a read. */ }
    }
    await this.prune();
    // A crash can occur after saving the immutable result but before linking
    // execution history. Recover from provenance in the snapshot itself.
    for (const [name, stat] of this.files) if (/^result_/.test(name)) try {
      const record = await readPrivate(path.join(this.directory, name));
      const id = record.source?.execution_id;
      if (!EXECUTION.test(id) || record.result_id + '.json' !== name) continue;
      const ref = this.reference(record, stat.time), previous = this.refs.get(id);
      if (!previous || (previous.result_version||1) < ref.result_version || (previous.result_version||1) === ref.result_version && previous.saved_at < ref.saved_at){
        await this.prune(2048);
        await this.link({...ref,result_status:this.files.has(name)?'available':'expired'});
      }
    } catch { /* The actual read reports unavailable rather than replaying. */ }
    await this.prune();
  }
  reference(record, fallback = this.clock()) {
    const at = Number.isFinite(Date.parse(record.created_at)) ? Date.parse(record.created_at) : fallback;
    return {request_id: record.source.execution_id, result_id: record.result_id, result_status: 'available',result_version:record.source.execution_version||1,
      saved_at: new Date(at).toISOString(), result_expires_at: new Date(at + this.maxAge).toISOString()};
  }
  async write(name, value) {
    const bytes = Buffer.byteLength(JSON.stringify(value));
    await atomic(path.join(this.directory, name), value);
    this.bytes += bytes - (this.files.get(name)?.size || 0);
    this.files.set(name, {size: bytes, time: this.clock()});
  }
  async link(ref) { await this.write(ref.request_id + '.ref.json', ref); this.refs.set(ref.request_id, ref); }
  async remove(name) {
    await fs.unlink(path.join(this.directory, name));
    this.bytes -= this.files.get(name)?.size || 0; this.files.delete(name);
  }
  async prune(reserve = 0, slots = 0) {
    const snapshots = [...this.files].filter(([name]) => name.startsWith('result_')).sort((a,b) => a[1].time - b[1].time);
    const byResult=new Map([...this.refs.values()].map(ref=>[ref.result_id,ref]));
    let count = snapshots.length;
    for (const [name, stat] of snapshots) {
      const ref=byResult.get(name.slice(0,-5));
      if (this.clock() - stat.time < this.maxAge && !(Date.parse(ref?.result_expires_at)<=this.clock()) && this.bytes + reserve <= this.maxBytes && count + slots <= this.maxRecords) continue;
      await this.remove(name); count--;
      if(ref&&ref.result_status!=='expired')await this.link({...ref,result_status:'expired'});
    }
    // Tombstones are bounded too; task identities and edit guards live elsewhere.
    const refs = [...this.refs.values()].sort((a,b) => a.saved_at.localeCompare(b.saved_at));
    for (const ref of refs) {
      if (this.refs.size + slots <= this.maxRecords && this.bytes + reserve <= this.maxBytes) break;
      await this.remove(ref.request_id + '.ref.json'); this.refs.delete(ref.request_id);
    }
    if (this.bytes + reserve > this.maxBytes) throw Error('RESULT_CACHE_FULL');
  }
  save(record) {
    const job = this.queue.then(async () => {
      await this.initialize();
      const size = Buffer.byteLength(JSON.stringify(record));
      if (size > MAX_RECORD) throw Error('RESULT_TOO_LARGE');
      // Include atomic-write headroom and the small recovery reference.
      await this.prune(size * 2 + 2048, 1);
      await this.write(record.result_id + '.json', record);
      const ref = this.reference(record);
      if (EXECUTION.test(ref.request_id)) await this.link(ref);
      return ref;
    });
    this.queue = job.catch(() => {}); return job;
  }
  async info(row) {
    try {
      await this.queue; await this.initialize();
      const ref = this.refs.get(row.request_id) || row;
      if (ref.result_version && ref.result_version < (row.poll_count||1) || ref.saved_at && Date.parse(ref.saved_at) < Date.parse(row.last_received_at || row.received_at)) return {result_status:row.result_status||'not_recorded'};
      if (!RESULT.test(ref.result_id || '')) return {result_status: row.result_status || 'not_recorded'};
      const entry = this.files.get(ref.result_id + '.json');
      const expired = ref.result_status === 'expired' || Date.parse(ref.result_expires_at) <= this.clock() || entry && this.clock() - entry.time >= this.maxAge;
      return {result_id: ref.result_id, result_status: expired ? 'expired' : entry ? 'available' : 'unavailable',
        ...(ref.result_expires_at ? {result_expires_at: ref.result_expires_at} : {})};
    } catch { return {result_status: row.result_status === 'storage_failed' ? 'storage_failed' : 'unavailable'}; }
  }
  async read(id) {
    await this.queue; await this.initialize();
    const entry = this.files.get(id + '.json');
    if (entry && this.clock() - entry.time >= this.maxAge || [...this.refs.values()].some(ref => ref.result_id === id && ref.result_status === 'expired')) throw Object.assign(Error('The saved result expired. Inspect the original task or artifacts; do not replay the operation.'), {code:'MCP_RESULT_EXPIRED'});
    const record=await readPrivate(path.join(this.directory, id + '.json'));
    if(Number.isFinite(Date.parse(record.created_at))&&this.clock()-Date.parse(record.created_at)>=this.maxAge)throw Object.assign(Error('The saved result expired. Inspect the original task or artifacts; do not replay the operation.'),{code:'MCP_RESULT_EXPIRED'});
    return record;
  }
  async close(){this.closed=true;clearInterval(this.timer);await this.queue;await this.ready?.catch(()=>{});}
}
module.exports = {ResultCache};
