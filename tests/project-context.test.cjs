'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProjectContexts, ContextError, MAX_BODY_BYTES } = require('../app/project-context.cjs');

function fixture(t) {
  const temporary = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'localharness-context-')));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, '中文 project with spaces');
  fs.mkdirSync(root);
  const put = (relative, content = '') => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
  };
  const contexts = new ProjectContexts({ defaultDirectory: root, allowedDirectories: [temporary] });
  return { temporary, root, put, contexts };
}

test('cancelling before subscribing to a shared read observes its eventual rejection', async (t) => {
  const f = fixture(t), file = f.put('AGENTS.md', 'Project guidance');
  const controller = new AbortController();
  f.contexts.readFresh = async () => {
    controller.abort();
    await new Promise(resolve => setImmediate(resolve));
    throw controller.signal.reason;
  };
  await assert.rejects(f.contexts.readRule(file, true, controller.signal), {name:'AbortError'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.contexts.pending.size, 0);
});

test('explicit directory wins over a parent Git root; file paths resolve their nearest Git root', async (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, '.git'));
  const file = f.put('packages/child/source.js');
  fs.mkdirSync(path.join(f.root, 'packages/child/.git'));
  f.put('packages/child/deep/AGENTS.md', 'Nested file-only policy');
  assert.equal((await f.contexts.getContext({ project_path: path.dirname(file) })).project_path, path.dirname(file));
  assert.equal((await f.contexts.getContext({ project_path: file })).project_path, path.dirname(file));
  assert.equal((await f.contexts.getContext({ project_path: path.join(path.dirname(file), 'new', 'created.js') })).project_path, path.dirname(file));
  assert.equal((await f.contexts.getContext({ project_path: path.join(path.dirname(file), 'deep', 'created.js') })).agents[0].content, 'Nested file-only policy');
  const external = path.join(f.temporary, 'loose.txt');
  fs.writeFileSync(external, '');
  await assert.rejects(f.contexts.getContext({ project_path: external }), { code: 'PROJECT_ROOT_AMBIGUOUS' });
  await assert.rejects(f.contexts.getContext({ project_path: path.join(f.temporary, 'new.txt') }), { code: 'PROJECT_ROOT_AMBIGUOUS' });
});

test('root and nested AGENTS are scoped and rules are indexed before selected bodies are delivered', async (t) => {
  const f = fixture(t);
  f.put('AGENTS.md', '# Root instructions\nUse the project convention. See [Conventions](docs/extra rules.md).');
  f.put('src/agents.md', '# Source instructions\nOnly for source files.');
  const file = f.put('src/deep/code.js');
  f.put('rules/a.md', '# Unit testing\nUse the required marker.');
  f.put('rules/nested/b.md', '# Architecture\nKeep dependencies local.');
  f.put('docs/extra rules.md', '# Extra instructions\nUse spaces.');
  const initial = await f.contexts.getContext({ project_path: f.root, target_paths: [file] });
  assert.deepEqual(initial.agents.map((item) => item.scope), [f.root, path.join(f.root, 'src')]);
  assert.deepEqual(initial.rules_index.map((item) => item.title).sort(), ['Architecture', 'Extra instructions', 'Unit testing']);
  assert.deepEqual(initial.loaded_rules, []);
  const selected = await f.contexts.getContext({ project_path: f.root, target_paths: [file], rule_paths: ['rules/a.md', 'docs/extra rules.md'] });
  assert.equal(selected.loaded_rules.length, 2);
  assert.match(selected.loaded_rules[0].content, /required marker/);
  assert.equal((await f.contexts.validate([selected.project_context_token], [file])).length, 1);
  // Only root-to-target instructions are delivered, not unrelated sibling ones.
  f.put('unrelated/AGENTS.md', 'Unrelated');
  await f.contexts.validate([selected.project_context_token], [file]);
});

test('first operations require context and entering a new directory refreshes applicable instructions', async (t) => {
  const f = fixture(t);
  const rootFile = f.put('new.txt');
  const nestedFile = f.put('src/code.js');
  f.put('src/AGENTS.md', 'Nested policy');
  await assert.rejects(f.contexts.validate([], [rootFile]), { code: 'PROJECT_CONTEXT_REQUIRED' });
  const rootContext = await f.contexts.getContext({ project_path: f.root });
  await f.contexts.validate([rootContext.project_context_token], [rootFile]);
  await assert.rejects(f.contexts.validate([rootContext.project_context_token], [nestedFile]), { code: 'PROJECT_CONTEXT_SCOPE_REQUIRED' });
  const nestedContext = await f.contexts.getContext({ project_path: f.root, target_paths: [nestedFile] });
  assert.equal(nestedContext.agents[0].content, 'Nested policy');
  await f.contexts.validate([nestedContext.project_context_token], [nestedFile]);
});

test('delivered instructions invalidate tokens while unrelated rule-index changes do not', async (t) => {
  const f = fixture(t);
  f.put('AGENTS.md', 'Root version one');
  const file = f.put('src/code.js');
  f.put('rules/selected.md', '# Selected\nVersion one');
  for (const [rule, body] of [
    ['AGENTS.md', 'Root version two'],
    ['rules/selected.md', '# Selected\nVersion two'],
    ['src/AGENTS.md', 'New nested policy'],
  ]) {
    const context = await f.contexts.getContext({ project_path: f.root, target_paths: [file], rule_paths: ['rules/selected.md'] });
    f.put(rule, body);
    await assert.rejects(f.contexts.validate([context.project_context_token], [file]), { code: 'PROJECT_CONTEXT_STALE' });
  }
  const stable = await f.contexts.getContext({project_path:f.root,target_paths:[file],rule_paths:['rules/selected.md']});
  f.put('rules/new.md', '# New rule');
  await f.contexts.validate([stable.project_context_token],[file]);
});

test('concurrent projects cannot satisfy each other or contaminate a previous context', async (t) => {
  const a = fixture(t);
  const other = path.join(a.temporary, 'other project');
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, 'AGENTS.md'), 'Project B');
  a.put('AGENTS.md', 'Project A');
  const [first, second] = await Promise.all([
    a.contexts.getContext({ project_path: a.root }),
    a.contexts.getContext({ project_path: other }),
  ]);
  assert.equal(first.agents[0].content, 'Project A');
  assert.equal(second.agents[0].content, 'Project B');
  await assert.rejects(a.contexts.validate([first.project_context_token], [path.join(other, 'new.txt')]), { code: 'PROJECT_CONTEXT_SCOPE_REQUIRED' });
  await a.contexts.validate([first.project_context_token, second.project_context_token], [path.join(a.root, 'a.txt'), path.join(other, 'b.txt')]);
  await a.contexts.validate([first.project_context_token], [path.join(a.root, 'a.txt')]);
});

test('missing rules work, lowercase is supported, and multiple AGENTS candidates report a conflict', async (t) => {
  const f = fixture(t);
  const empty = await f.contexts.getContext();
  assert.deepEqual(empty.agents, []);
  assert.deepEqual(empty.rules_index, []);
  f.put('agents.md', 'Lowercase instructions');
  const lower = await f.contexts.getContext({ project_path: f.root });
  assert.equal(lower.agents[0].content, 'Lowercase instructions');
  // macOS volumes may be case insensitive. Skip only the impossible fixture.
  f.put('AGENTS.md', 'Uppercase instructions');
  if (fs.readdirSync(f.root).includes('agents.md') && fs.readdirSync(f.root).includes('AGENTS.md')) {
    const conflict=await f.contexts.getContext({ project_path:f.root });
    assert.ok(conflict.diagnostics.some(item=>item.code==='AGENTS_CONFLICT'&&item.blocks_writes));
    await assert.rejects(f.contexts.validate([conflict.project_context_token],[f.root]),{code:'PROJECT_INSTRUCTIONS_UNAVAILABLE'});
  }
});

test('rule bodies enforce a 64 KiB aggregate budget without truncation; large indexed files remain on demand', async (t) => {
  const f = fixture(t);
  f.put('rules/large.md', '# Large\n' + 'a'.repeat(MAX_BODY_BYTES));
  const indexed = await f.contexts.getContext({ project_path: f.root });
  assert.equal(indexed.rules_index.length, 1);
  await assert.rejects(f.contexts.getContext({ project_path: f.root, rule_paths: ['rules/large.md'] }), { code: 'CONTEXT_TOO_LARGE' });
  f.put('AGENTS.md', 'a'.repeat(35 * 1024));
  f.put('rules/second.md', 'b'.repeat(35 * 1024));
  await assert.rejects(f.contexts.getContext({ project_path: f.root, rule_paths: ['rules/second.md'] }), { code: 'CONTEXT_TOO_LARGE' });
});

test('shared references use authorized folders without expanding project target scope', async (t) => {
  const f = fixture(t);
  const outside = path.join(f.temporary, 'outside.md');
  fs.writeFileSync(outside, '# Outside');
  f.put('AGENTS.md', 'Follow [Outside](../outside.md).');
  assert.equal((await f.contexts.getContext({project_path:f.root})).rules_index[0].path,outside);
  f.put('AGENTS.md', 'Local only');
  assert.equal((await f.contexts.getContext({project_path:f.root,rule_paths:[outside]})).loaded_rules[0].content,'# Outside');
  fs.symlinkSync(outside, path.join(f.root, 'linked.md'));
  assert.equal((await f.contexts.getContext({project_path:f.root,rule_paths:['linked.md']})).loaded_rules[0].path,outside);
  await assert.rejects(f.contexts.getContext({ project_path: f.root, target_paths: ['linked.md'] }), { code: 'TARGET_OUTSIDE_PROJECT' });
});

test('reference errors are soft, invalid AGENTS blocks only writes, and tokens remain local', async (t) => {
  const f = fixture(t);
  f.put('AGENTS.md', 'See `rules/missing.md`.');
  const missing=await f.contexts.getContext({project_path:f.root});
  assert.ok(missing.diagnostics.some(item=>item.code==='CONTEXT_PATH_MISSING'&&!item.blocks_writes));
  await assert.rejects(f.contexts.getContext({project_path:f.root,rule_paths:['rules/missing.md']}),ContextError);
  f.put('AGENTS.md', Buffer.from([0xff, 0xfe]));
  assert.ok((await f.contexts.getContext({project_path:f.root})).diagnostics.some(item=>item.code==='RULE_UNREADABLE'&&item.blocks_writes));
  f.put('AGENTS.md', 'Invalid\0text');
  assert.ok((await f.contexts.prepare([], [f.root])).contexts[0].diagnostics.some(item=>item.blocks_writes));
  await assert.rejects(f.contexts.prepare([], [f.root],{writing:true}),{code:'PROJECT_INSTRUCTIONS_UNAVAILABLE'});
  f.put('AGENTS.md', 'Valid');
  const context = await f.contexts.getContext({ project_path: f.root });
  const independent = new ProjectContexts({ defaultDirectory: f.root });
  await assert.rejects(independent.validate([context.project_context_token], [f.root]), { code: 'INVALID_PROJECT_CONTEXT' });
});

test('explicit local text rules work without adopting editor rule directories automatically', async (t) => {
  const f = fixture(t);
  f.put('AGENTS.md', 'Follow `docs/team.txt` and [Build config](docs/build.yaml).');
  f.put('docs/team.txt', 'Team convention');
  f.put('docs/build.yaml', 'build: local');
  f.put('rules/readme.markdown', '# Markdown convention');
  f.put('rules/not-automatic.json', '{"unused": true}');
  f.put('.cursor/rules/private.mdc', 'Not inherited');
  const initial = await f.contexts.getContext({ project_path: f.root });
  assert.deepEqual(initial.rules_index.map((entry) => path.basename(entry.path)).sort(), ['build.yaml', 'readme.markdown', 'team.txt']);
  const selected = await f.contexts.getContext({ project_path: f.root, rule_paths: ['docs/team.txt', 'rules/not-automatic.json'] });
  assert.equal(selected.loaded_rules[0].content, 'Team convention');
  assert.equal(selected.loaded_rules[1].content, '{"unused": true}');
  f.put('binary.rule', Buffer.from([0x61, 0x00, 0x62]));
  await assert.rejects(f.contexts.getContext({ project_path: f.root, rule_paths: ['binary.rule'] }), { code: 'RULE_UNREADABLE' });
  const outside = path.join(f.temporary, 'outside.txt');
  fs.writeFileSync(outside, 'Outside rule');
  f.put('AGENTS.md', 'Follow `../outside.txt`.');
  const indexed = await f.contexts.getContext({project_path:f.root});
  assert.deepEqual(indexed.rules_index.map(entry => entry.path).sort(), [outside, path.join(f.root, 'rules/readme.markdown')].sort());
});

test('nonexistent write paths retain realpath confinement and new child directories require refreshed context', async (t) => {
  const f = fixture(t);
  const file = path.join(f.root, 'new child', 'created.txt');
  const loaded = await f.contexts.getContext({ project_path: f.root, target_paths: [file] });
  await f.contexts.validate([loaded.project_context_token], [file]);
  fs.mkdirSync(path.dirname(file));
  await f.contexts.validate([loaded.project_context_token], [file]);
  f.put('new child/AGENTS.md', 'New child rules');
  await assert.rejects(f.contexts.validate([loaded.project_context_token], [file]), { code: 'PROJECT_CONTEXT_STALE' });
  const outside = path.join(f.temporary, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(f.root, 'escape'));
  await assert.rejects(f.contexts.getContext({ project_path: f.root, target_paths: ['escape/new-file.txt'] }), { code: 'TARGET_OUTSIDE_PROJECT' });
});

test('no instructions allow first writes and warm reads reuse cached bodies', async t => {
  const f=fixture(t), file=f.put('source.txt','text');
  assert.equal((await f.contexts.prepare([], [file], {projectPath:f.root,writing:true})).needsDelivery,false);
  f.put('AGENTS.md','Root policy. See `docs/{en,zh-CN,ja}/GUIDE.md` and `Design/project-spec.json`.');
  const first=await f.contexts.prepare([], [file], {projectPath:f.root,writing:true});
  assert.equal(first.needsDelivery,true);
  assert.ok(first.contexts[0].diagnostics.some(item=>item.code==='RULE_REFERENCE_PATTERN'));
  assert.ok(first.contexts[0].diagnostics.every(item=>!item.blocks_writes));
  const token=first.contexts[0].project_context_token, reads=f.contexts.cacheStats.bodyReads;
  const next=await f.contexts.prepare([token],[file],{projectPath:f.root});
  assert.equal(next.contexts[0].reused,true);
  assert.equal(next.contexts[0].agents.length,0);
  await f.contexts.prepare([token],[file],{projectPath:f.root,writing:true});
  assert.equal(f.contexts.cacheStats.bodyReads,reads);
});

test('context and file authorization reject folders outside app settings, including symlinks', async t => {
  const f=fixture(t), shared=f.put('../shared.md','# Shared');
  const narrow=new ProjectContexts({defaultDirectory:f.root,allowedDirectories:[f.root]});
  f.put('AGENTS.md','Shared rule: [Shared](../shared.md).');
  const context=await narrow.getContext({project_path:f.root});
  assert.ok(context.diagnostics.some(item=>item.code==='PATH_NOT_ALLOWED'&&!item.blocks_writes));
  await assert.rejects(narrow.getContext({project_path:f.temporary}),{code:'PATH_NOT_ALLOWED'});
  await assert.rejects(narrow.getContext({project_path:f.root,rule_paths:[shared]}),{code:'PATH_NOT_ALLOWED'});
  fs.symlinkSync(shared,path.join(f.root,'escape.md'));
  await assert.rejects(narrow.authorizePaths([path.join(f.root,'escape.md')]),{code:'PATH_NOT_ALLOWED'});
});

test('concurrent loads share body reads and deleted AGENTS changes are detected', async t => {
  const f=fixture(t);f.put('AGENTS.md','Shared body');const file=f.put('source.txt');
  const [a,b]=await Promise.all([f.contexts.getContext({project_path:f.root}),f.contexts.getContext({project_path:f.root})]);
  assert.equal(f.contexts.cacheStats.bodyReads,1);assert.notEqual(a.project_context_token,b.project_context_token);
  fs.unlinkSync(path.join(f.root,'AGENTS.md'));
  await assert.rejects(f.contexts.validate([a.project_context_token],[file]),{code:'PROJECT_CONTEXT_STALE'});
  const refreshed=await f.contexts.prepare([a.project_context_token],[file],{projectPath:f.root,writing:true});
  assert.equal(refreshed.needsDelivery,true);
  assert.equal((await f.contexts.prepare([refreshed.contexts[0].project_context_token],[file],{projectPath:f.root,writing:true})).needsDelivery,false);
});

test('diagnostic output stays bounded without turning reference errors into write blockers',async t=>{
  const f=fixture(t);f.put('AGENTS.md',Array.from({length:150},(_,index)=>`See \`missing-${index}.md\`.`).join('\n'));
  const context=await f.contexts.getContext({project_path:f.root});
  assert.equal(context.diagnostics.length,128);assert.ok(context.diagnostics.at(-1).omitted>0);
  assert.ok(context.diagnostics.every(item=>!item.blocks_writes));
  await f.contexts.validate([context.project_context_token],[f.root]);
});
