'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { ProjectContexts } = require('../app/project-context.cjs');
const { ProjectSearch, argumentsFor, MAX_MATCHES, PAGE_BYTES, CURSOR_TTL } = require('../app/project-search.cjs');
const binary = (process.env.PATH || '').split(path.delimiter).map(folder => path.join(folder, process.platform === 'win32' ? 'rg.exe' : 'rg')).find(file => fs.existsSync(file));

function fixture(t, options = {}) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cth-search 中文 ')));
  fs.mkdirSync(path.join(root, '.git'));
  const contexts = new ProjectContexts({ defaultDirectory: root, allowedDirectories: [root] });
  const search = new ProjectSearch({ contexts, binary, ...options });
  t.after(() => { search.dispose(); contexts.dispose(); fs.rmSync(root, { recursive: true, force: true }); });
  const put = (name, text) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
  return { root, contexts, search, put };
}

test('native literal searches return paths, 1-based lines and surrounding context', { skip: !binary }, async t => {
  const f = fixture(t); const file = f.put('src/代码 file.txt', 'before\ncall(x.y)\nafter\n');
  f.put('ignored/hidden.txt', 'call(x.y)'); f.put('.gitignore', 'ignored/\n');
  const result = await f.search.search({ project_path: f.root, pattern: 'call(x.y)' });
  assert.equal(result.reason, 'completed'); assert.equal(result.results.length, 1);
  assert.equal(result.results[0].path, file); assert.equal(result.results[0].line, 2);
  assert.deepEqual(result.results[0].context.map(line => line.text), ['before', 'call(x.y)', 'after']);
  f.put('src/upper.txt','CALL(X.Y)');
  assert.equal((await f.search.search({project_path:f.root,pattern:'call(x.y)',ignore_case:true})).results.length,2);
  const none = await f.search.search({ project_path: f.root, pattern: 'nonexistent-token' });
  assert.equal(none.complete, true); assert.equal(none.reason, 'no_matches');
  await assert.rejects(f.search.search({ project_path: f.root, pattern: '[', regex: true }), { code: 'SEARCH_FAILED' });
});

test('file query and include/exclude filters intersect, with bounded stored pagination', { skip: !binary }, async t => {
  let clock = 1000; const f = fixture(t, { now: () => clock });
  for (const name of ['src/a.js', 'src/b.js', 'src/c.ts', 'other/d.js']) f.put(name, 'data');
  const first = await f.search.search({ project_path: f.root, pattern: '*.js', search_type: 'files', include_globs: ['src/**'], limit: 1 });
  assert.equal(first.results.length, 1); assert.ok(first.next_cursor); assert.ok(first.results[0].relative_path.startsWith('src'+path.sep));
  const next = await f.search.search({ project_path: f.root, cursor: first.next_cursor, limit: 1 });
  assert.equal(next.results.length, 1); assert.equal(next.has_more, false);
  assert.notEqual(next.results[0].path, first.results[0].path);
  await assert.rejects(f.search.search({ project_path: f.root, cursor: first.next_cursor, pattern: '*.ts', search_type: 'files' }), { code: 'SEARCH_CURSOR_MISMATCH' });
  clock += CURSOR_TTL;
  await assert.rejects(f.search.search({ project_path: f.root, cursor: first.next_cursor }), { code: 'SEARCH_CURSOR_EXPIRED' });
});

test('global match, snippet, and page budgets are explicit', { skip: !binary }, async t => {
  const f = fixture(t); f.put('many.txt', Array.from({ length: MAX_MATCHES + 10 }, () => 'match token').join('\n'));
  const result = await f.search.search({ project_path: f.root, pattern: 'match', context_lines: 0, limit: 200 });
  assert.equal(result.reason, 'max_results'); assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= PAGE_BYTES);
  f.put('wide.txt', '中文'.repeat(5000)+' match\n');
  const wide = await f.search.search({ project_path: f.root, pattern: '中文', include_globs: ['wide.txt'], context_lines: 10 });
  assert.equal(wide.truncated, true); assert.equal(wide.results[0].truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(wide)) <= PAGE_BYTES);
});

test('page budget counts multibyte paths, metadata and individually oversized rows', t => {
  const f=fixture(t);
  const snapshot={root:f.root,complete:true,reason:'completed',truncated:false,searched_at:'2026-10-17T00:00:00.000Z',diagnostics:[{code:'PARTIAL',message:'d'.repeat(4000)}],results:[
    {path:'中'.repeat(24000),relative_path:'oversized'},
    ...Array.from({length:100},(_,index)=>({path:f.root+'/'+index,relative_path:String(index),text:'中'.repeat(2048)}))
  ]};
  const result=f.search.page('x'.repeat(32),snapshot,0,100);
  assert.ok(Buffer.byteLength(JSON.stringify(result))<=PAGE_BYTES);
  assert.equal(result.truncated,true);assert.equal(result.reason,'byte_limit');assert.ok(result.has_more);
  assert.equal(result.diagnostics.at(-1).code,'SEARCH_PAGE_ROW_TOO_LARGE');
  assert.equal(result.results[0].relative_path,'0');
});

function slowSpawner(onSpawn = () => {}) {
  return () => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const keepAlive=setInterval(()=>{},1000);
    child.kill = () => { clearInterval(keepAlive);setImmediate(() => child.emit('close', null)); return true; };
    onSpawn(child); return child;
  };
}
test('timeout returns partial state while cancellation kills the owned search', async t => {
  const f = fixture(t, { binary: 'fixture', spawnProcess: slowSpawner() });
  const result = await f.search.search({ project_path: f.root, pattern: 'x', timeout_ms: 5 });
  assert.equal(result.reason, 'timeout'); assert.equal(result.complete, false);
  let spawned; const ready = new Promise(resolve => { spawned = resolve; });
  const g = fixture(t, { binary: 'fixture', spawnProcess: slowSpawner(spawned) });
  const controller = new AbortController();
  const running = g.search.search({ project_path: g.root, pattern: 'x' }, { signal: controller.signal });
  await ready; controller.abort(new Error('cancelled search'));
  await assert.rejects(running, /cancelled search/); assert.equal(g.search.active.size, 0);
});

test('only four new searches run concurrently and dispose reclaims all of them', async t => {
  const waiters = []; const f = fixture(t, { binary: 'fixture', spawnProcess: slowSpawner(() => waiters.shift()?.()) });
  const running = [];
  for (let index = 0; index < 4; index++) {
    const ready = new Promise(resolve => waiters.push(resolve));
    const task = f.search.search({ project_path: f.root, pattern: 'x' }); task.catch(() => {}); running.push(task); await ready;
  }
  await assert.rejects(f.search.search({ project_path: f.root, pattern: 'x' }), { code: 'SEARCH_BUSY' });
  f.search.dispose(); await Promise.allSettled(running); assert.equal(f.search.active.size, 0);
});

test('search arguments cannot inject options or shell commands', () => {
  const args = argumentsFor({ type: 'content', pattern: '--files; echo injected', regex: false, context: 2, includes: [], excludes: [], hidden: false });
  assert.equal(args.at(-2), '--files; echo injected'); assert.equal(args.at(-3), '--'); assert.ok(args.includes('-F'));
});
