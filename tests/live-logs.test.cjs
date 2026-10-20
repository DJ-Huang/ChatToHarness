'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {LiveLogs, MAX_BYTES, MAX_LINES} = require('../app/live-logs.cjs');
const {ExecutionHistory} = require('../app/execution-history.cjs');

function home(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cth-live-logs-'));
  fs.mkdirSync(path.join(directory, 'logs'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  return directory;
}
const row = (event, extra = {}) =>
  JSON.stringify({time: new Date().toISOString(), event, ...extra}) + '\n';
function append(home, text, name = 'app.log') {
  fs.appendFileSync(path.join(home, 'logs', name), text, {mode: 0o600});
}

test('live log feed is empty before startup, then tails and incrementally follows complete JSONL lines', t => {
  const dir = home(t), feed = new LiveLogs(dir);
  assert.deepEqual(feed.read().entries, []);
  append(dir, row('runtime', {state: 'ready'}));
  append(dir, row('mcp-call', {tool: 'read_file', result: 'complete'}));
  const first = feed.read();
  assert.equal(first.entries.length, 2);
  assert.equal(first.entries[0].category, 'connection');
  assert.equal(first.entries[1].category, 'tool');
  assert.equal(feed.read({cursor: first.cursor}).entries.length, 0);
  const line = row('execution', {tool: 'write_file', state: 'succeeded'});
  append(dir, line.slice(0, 14));
  const incomplete = feed.read({cursor: first.cursor});
  assert.equal(incomplete.entries.length, 0);
  assert.equal(incomplete.cursor.offset, first.cursor.offset);
  append(dir, line.slice(14));
  const next = feed.read({cursor: incomplete.cursor});
  assert.equal(next.entries.length, 1);
  assert.match(next.entries[0].message, /write_file.*succeeded/);
  assert.equal(feed.read({cursor: next.cursor}).entries.length, 0);
});

test('rotation consumes the remainder of the old file before the replacement and deduplicates via stable IDs', t => {
  const dir = home(t), feed = new LiveLogs(dir);
  append(dir, row('runtime', {state: 'starting'}));
  const before = feed.read();
  fs.renameSync(path.join(dir, 'logs', 'app.log'), path.join(dir, 'logs', 'app.log.previous'));
  append(dir, row('mcp-call', {tool: 'old-tail'}), 'app.log.previous');
  append(dir, row('mcp-call', {tool: 'new-file'}));
  const after = feed.read({cursor: before.cursor});
  assert.equal(after.reset, false);
  assert.equal(after.entries.length, 2);
  assert.match(after.entries[0].message, /old-tail/);
  assert.match(after.entries[1].message, /new-file/);
  assert.notEqual(after.entries[0].id, after.entries[1].id);
  assert.equal(feed.read({cursor: after.cursor}).entries.length, 0);
  assert.equal(feed.read({cursor: {file: 'app.log', identity: 'invalid', offset: 0}}).reset, true);
});

test('old/invalid records cannot expose sensitive keys, and errors have a separate severity from category', t => {
  const dir = home(t), feed = new LiveLogs(dir);
  append(dir, row('execution', {tool: '<img src=x onerror=alert(1)>', state: 'failed',
    authorization: 'Bearer original-secret-42', apiKey: 'original-secret-42',
    nested: {secret: 'original-secret-42'}}));
  append(dir, 'not-json\n');
  append(dir, row('runtime', {state: 'reconnecting'}));
  const result = feed.read();
  assert.equal(result.entries.length, 2);
  const first = result.entries[0];
  assert.equal(first.category, 'tool');
  assert.equal(first.severity, 'error');
  assert.ok(first.message.includes('<img'));
  assert.ok(!JSON.stringify(result).includes('original-secret-42'));
  assert.equal(result.entries[1].category, 'connection');
});

test('only known built-in pre-execution recovery is informational and transport failures remain errors',t=>{
  const dir=home(t),feed=new LiveLogs(dir);
  const base={request_id:'exec_fixture',tool:'start_process',service:'builtin',state:'failed',error_code:'PROJECT_CONTEXT_REFRESH_REQUIRED'};
  append(dir,row('execution',base));
  append(dir,row('execution',{...base,execution_state:'not_started',delivery:'local_write_succeeded'}));
  append(dir,row('execution',{...base,error_code:'context_paths_required'}));
  for(const patch of [
    {error_code:'PATH_NOT_ALLOWED'},{error_code:'invalid_context_paths'},
    {execution_state:'unknown'},{service:'external',recovery_kind:'needs_context'},
    {delivery:'local_write_failed'},{state:'succeeded',error_code:'',delivery:'local_write_failed'},
  ])append(dir,row('execution',{...base,...patch}));
  const entries=feed.read().entries;
  assert.equal(entries[0].recovery_kind,'needs_context','legacy errors infer their pre-execution meaning');
  assert.equal(entries[0].severity,'info');
  assert.equal(entries[1].severity,'info');assert.equal(entries[1].delivery,'local_write_succeeded');
  assert.equal(entries[1].request_id,base.request_id);
  assert.equal(entries[2].recovery_kind,'needs_arguments');
  for(const entry of entries.slice(3)){assert.equal(entry.severity,'error');assert.equal(entry.recovery_kind,undefined);}
  assert.equal(entries.length,9,'raw event feed retains both execution and transport updates');
});

test('max bytes, count and file safety bound reads even with large or redirected logs', t => {
  const dir = home(t), feed = new LiveLogs(dir);
  for (let i = 0; i < 700; ++i) append(dir, row('mcp-call', {tool: 'tool_'+i}));
  const recent = feed.read({limit: 15});
  assert.equal(recent.entries.length, 15);
  assert.match(recent.entries.at(-1).message, /tool_699/);
  assert.equal(recent.more, false);
  assert.equal(feed.read({limit: 999}).entries.length <= MAX_LINES, true);
  assert.ok(MAX_BYTES <= 128 * 1024);
  const external = path.join(dir, 'secret.txt'); fs.writeFileSync(external, 'dont-read');
  fs.unlinkSync(path.join(dir, 'logs', 'app.log'));
  fs.symlinkSync(external, path.join(dir, 'logs', 'app.log'));
  assert.deepEqual(feed.read().entries, []);
  fs.unlinkSync(path.join(dir, 'logs', 'app.log'));
  fs.linkSync(external, path.join(dir, 'logs', 'app.log'));
  assert.deepEqual(feed.read().entries, []);
});

test('execution transitions are observable without reading raw MCP response content', t => {
  const dir = home(t), transitions = [];
  const history = new ExecutionHistory(dir, {onChange: entry => transitions.push(entry)});
  t.after(() => history.close());
  const id = history.begin('write_file', {path: '/safe/project.txt', content: 'sensitive-content'});
  history.update(id, {state: 'running', started_at: history.now()});
  history.complete(id, {content: [{type: 'text', text: 'sensitive-content'}]});
  assert.deepEqual(transitions.map(entry => entry.state), ['received', 'running', 'succeeded']);
  assert.equal(transitions.every(entry => entry.request_id === id), true);
  assert.ok(!JSON.stringify(transitions).includes('sensitive-content'));
});

test('incremental pages never skip events across a rotated log', t => {
  const dir = home(t), feed = new LiveLogs(dir);
  append(dir, row('runtime', {tool: 'seed'}));
  const first = feed.read();
  for (let i=0;i<37;i++) append(dir,row('mcp-call',{tool:'old_'+i}));
  fs.renameSync(path.join(dir,'logs','app.log'),path.join(dir,'logs','app.log.previous'));
  for (let i=0;i<41;i++) append(dir,row('mcp-call',{tool:'new_'+i}));
  let cursor=first.cursor, collected=[];
  for(let page=0;page<100;page++){
    const result=feed.read({cursor,limit:5});
    assert.ok(result.entries.length<=5);
    collected.push(...result.entries.map(e=>e.message));
    cursor=result.cursor;
    if(!result.more)break;
  }
  assert.equal(collected.length,78);
  assert.equal(collected.filter(s=>s.includes('old_')).length,37);
  assert.equal(collected.filter(s=>s.includes('new_')).length,41);
  assert.equal(new Set(collected).size,78);
});

test('unknown delivery is normal while executing; terminal unknown and actual write failures remain errors',t=>{
  const dir=home(t),feed=new LiveLogs(dir);
  for(const state of ['received','waiting_approval','submitted','running','cancelling'])append(dir,row('execution',{state,delivery:'unknown',tool:'read_file',error_code:undefined}));
  append(dir,row('execution',{state:'succeeded',delivery:'unknown',tool:'read_file'}));
  append(dir,row('execution',{state:'unknown',delivery:'local_write_succeeded',tool:'read_file'}));
  append(dir,row('execution',{state:'running',delivery:'local_write_failed',tool:'read_file'}));
  const entries=feed.read().entries;
  for(const entry of entries.slice(0,5)){assert.equal(entry.severity,'info');assert.ok(!entry.message.includes('[omitted]'));}
  for(const entry of entries.slice(5))assert.equal(entry.severity,'error');
});

test('legacy omitted optional execution fields are absent, and undefined fields are not serialized',t=>{
  const {safeFields}=require('../app/diagnostic-budget.cjs');
  assert.deepEqual(safeFields({error_code:undefined,execution_state:undefined,nested:{optional:undefined},state:'received'}),{nested:{},state:'received'});
  const dir=home(t),feed=new LiveLogs(dir);
  append(dir,row('execution',{state:'running',delivery:'unknown',error_code:'[omitted]',execution_state:'[omitted]',tool:'read_file',service:'Harness'}));
  const entry=feed.read().entries[0];
  assert.equal(entry.message,'Harness · read_file · running');
  assert.equal(entry.error_code,'');
  assert.equal(entry.severity,'info');
});
