'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {SafeEdits} = require('../app/safe-edits.cjs');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
function fixture(t) { const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cth-edits ')); const project = path.join(home, 'project'); fs.mkdirSync(project); t.after(() => fs.rmSync(home, {recursive: true, force: true})); return {home, project, edits: new SafeEdits(home), file: path.join(project, 'source.txt')}; }
test('safe edits preserve newer content, deduplicate retries and undo exactly once', t => {
  const f = fixture(t); fs.writeFileSync(f.file, 'original 中文');
  const input = {project_path: f.project, file_path: f.file, content: 'changed', expected_sha256: sha('original 中文'), idempotency_key: 'edit'};
  fs.appendFileSync(f.file, ' user change'); assert.throws(() => f.edits.apply(input), {code: 'EDIT_CONFLICT'}); assert.equal(fs.readFileSync(f.file, 'utf8'), 'original 中文 user change');
  input.expected_sha256 = sha('original 中文 user change'); const result = f.edits.apply(input); assert.equal(fs.readFileSync(f.file, 'utf8'), 'changed');
  assert.equal(new SafeEdits(f.home).apply(input).reused, true); assert.equal(f.edits.apply(input).undo_id, result.undo_id);
  assert.throws(() => f.edits.apply({...input, content: 'different'}), {code: 'IDEMPOTENCY_CONFLICT'});
  fs.writeFileSync(f.file, 'later user changes'); assert.throws(() => f.edits.undo(result.undo_id, f.project, result.after_sha256), {code: 'EDIT_CONFLICT'}); assert.equal(fs.readFileSync(f.file, 'utf8'), 'later user changes');
  fs.writeFileSync(f.file, 'changed'); const undo = f.edits.undo(result.undo_id, f.project, result.after_sha256); assert.equal(undo.state, 'undone'); assert.equal(fs.readFileSync(f.file, 'utf8'), 'original 中文 user change');
  assert.equal(f.edits.undo(result.undo_id, f.project, result.after_sha256).reused, true);
});
test('a new-file edit can be undone without deleting a later file or crossing project scope', t => {
  const f = fixture(t), input = {project_path: f.project, file_path: f.file, content: 'new text', expected_sha256: 'absent', idempotency_key: 'create'};
  const result = f.edits.apply(input); assert.throws(() => f.edits.undo(result.undo_id, f.home, result.after_sha256), {code: 'EDIT_SCOPE_MISMATCH'});
  f.edits.undo(result.undo_id, f.project, result.after_sha256); assert.equal(fs.existsSync(f.file), false);
  fs.writeFileSync(f.file, 'another file'); f.edits.undo(result.undo_id, f.project, result.after_sha256); assert.equal(fs.readFileSync(f.file, 'utf8'), 'another file');
});
test('a crash after replacing bytes recovers the existing edit instead of replaying it', t => {
  const f = fixture(t), input = {project_path: f.project, file_path: f.file, content: 'saved', expected_sha256: 'absent', idempotency_key: 'recover'};
  const result = f.edits.apply(input); fs.unlinkSync(path.join(f.home, 'edits', result.undo_id, 'result.json'));
  assert.equal(f.edits.apply(input).recovered, true); assert.equal(fs.readFileSync(f.file, 'utf8'), 'saved');
});
test('a failure recording a completed edit reports uncertainty and recovers without a second write', t => {
  const f = fixture(t), input = {project_path: f.project, file_path: f.file, content: 'saved once', expected_sha256: 'absent', idempotency_key: 'result-failure'};
  const rename = fs.renameSync; let fileWrites = 0;
  fs.renameSync = (source, destination) => {
    if (destination === f.file) fileWrites++;
    if (path.basename(destination) === 'result.json') throw Object.assign(new Error('Synthetic result storage failure'), {code: 'EIO'});
    return rename(source, destination);
  };
  try { assert.throws(() => f.edits.apply(input), error => error.code === 'EDIT_RESULT_UNCONFIRMED' && error.details.execution_state === 'unknown' && error.details.operation_executed === null); }
  finally { fs.renameSync = rename; }
  assert.equal(fileWrites, 1); assert.equal(fs.readFileSync(f.file, 'utf8'), 'saved once');
  const recovered = f.edits.existing(input); assert.equal(recovered.recovered, true); assert.equal(fileWrites, 1);
});
