'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {ProjectContexts} = require('../app/project-context.cjs');
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cth-guidance ')));
  const contexts = new ProjectContexts({defaultDirectory: root, allowedDirectories: [root]});
  const write = (name, content) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, content); return file; };
  t.after(() => { contexts.dispose(); fs.rmSync(root, {recursive: true, force: true}); }); return {root, contexts, write};
}
test('rules match paths, task keywords and alwaysApply while AGENTS retains nested ordering', async t => {
  const f = fixture(t); f.write('AGENTS.md', '# Root\nRoot instructions.'); f.write('src/AGENTS.md', '# Child\nChild instructions.');
  f.write('rules/source.md', '---\nglobs: ["src/**/*.cjs"]\n---\n# Source rule\nSOURCE_BODY');
  f.write('rules/build.md', '---\ntasks:\n  - build\n---\n# Build\nBUILD_BODY');
  f.write('rules/always.md', '---\nalwaysApply: true\n---\nALWAYS_BODY');
  f.write('rules/unrelated.md', '---\npaths: ["art/**"]\n---\nUNRELATED_BODY');
  const result = await f.contexts.getContext({project_path: f.root, target_paths: ['src/nested/main.cjs'], task: 'build the app'});
  assert.deepEqual(result.agents.map(item => path.relative(result.project_path, item.path)), ['AGENTS.md', path.join('src', 'AGENTS.md')]);
  assert.equal(result.loaded_rules.length, 3); assert.ok(result.loaded_rules.some(item => item.content.includes('BUILD_BODY')));
  assert.ok(!result.loaded_rules.some(item => item.content.includes('UNRELATED_BODY')));
  assert.equal(result.precedence.agents, 'outer_to_inner'); assert.ok(result.budget.body_bytes > 0);
});
test('skill indexes return metadata first and selected skill changes invalidate delivered tokens', async t => {
  const f = fixture(t), skill = f.write('.agents/skills/render/SKILL.md', '---\nname: Render\ndescription: Build renders\ntasks: [render]\n---\n# Render\nPRIVATE_FULL_SKILL_BODY');
  const index = await f.contexts.getContext({project_path: f.root, task: 'render'});
  assert.equal(index.skills_index[0].name, 'Render'); assert.equal(index.skills_index[0].match.task, true);
  assert.deepEqual(index.loaded_skills, []); assert.ok(!JSON.stringify(index).includes('PRIVATE_FULL_SKILL_BODY'));
  const loaded = await f.contexts.getContext({project_path: f.root, skill_paths: [skill]});
  assert.match(loaded.loaded_skills[0].content, /PRIVATE_FULL_SKILL_BODY/);
  f.write('skills/unused/SKILL.md', '# Unused\nNot selected');
  await f.contexts.validate([loaded.project_context_token], [f.root]);
  fs.appendFileSync(skill, '\nCHANGED');
  await assert.rejects(f.contexts.validate([loaded.project_context_token], [f.root]), {code: 'PROJECT_CONTEXT_STALE'});
  const refreshed = await f.contexts.prepare([loaded.project_context_token], [f.root], {projectPath: f.root, writing: true});
  assert.equal(refreshed.needsDelivery, true); assert.ok(refreshed.contexts[0].loaded_skills[0].content.includes('CHANGED'));
});
test('new matching rules refresh a write while unrelated rules remain index-only', async t => {
  const f = fixture(t); f.write('AGENTS.md', 'Project guidance');
  const first = await f.contexts.getContext({project_path: f.root, target_paths: ['file.txt']});
  f.write('rules/no.md', '---\nglobs: ["elsewhere/**"]\n---\nNot applicable');
  await f.contexts.validate([first.project_context_token], [path.join(f.root, 'file.txt')]);
  f.write('rules/yes.md', '---\nglobs: ["*.txt"]\n---\nAPPLICABLE');
  const next = await f.contexts.prepare([first.project_context_token], [path.join(f.root, 'file.txt')], {projectPath: f.root, writing: true});
  assert.equal(next.needsDelivery, true); assert.equal(next.contexts[0].loaded_rules.length, 1);
});
test('a token for another filename in the same directory cannot skip matching rules', async t => {
  const f = fixture(t); f.write('AGENTS.md', 'Project guidance');
  f.write('rules/code.md', '---\nglobs: ["*.cjs"]\n---\nCODE_RULE');
  const first = await f.contexts.getContext({project_path: f.root, target_paths: ['notes.txt']});
  assert.equal(first.loaded_rules.length, 0);
  await assert.rejects(f.contexts.validate([first.project_context_token], [path.join(f.root, 'main.cjs')]), {code: 'PROJECT_CONTEXT_SCOPE_REQUIRED'});
  const refreshed = await f.contexts.prepare([first.project_context_token], [path.join(f.root, 'main.cjs')], {projectPath: f.root, writing: true});
  assert.equal(refreshed.needsDelivery, true); assert.match(refreshed.contexts[0].loaded_rules[0].content, /CODE_RULE/);
  await f.contexts.validate([refreshed.contexts[0].project_context_token], [path.join(f.root, 'second.cjs')]);
});
test('combined skills and AGENTS bodies respect the shared budget and invalid task metadata is rejected', async t => {
  const f = fixture(t); f.write('AGENTS.md', 'a'.repeat(40000)); f.write('skills/large/SKILL.md', 'b'.repeat(40000));
  await assert.rejects(f.contexts.getContext({project_path: f.root, skill_paths: ['skills/large/SKILL.md']}), {code: 'CONTEXT_TOO_LARGE'});
  await assert.rejects(f.contexts.getContext({project_path: f.root, task: 12}), {code: 'INVALID_CONTEXT_TASK'});
});
