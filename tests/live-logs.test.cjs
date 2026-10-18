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
