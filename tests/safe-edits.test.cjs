'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {SafeEdits, VERIFICATION_TEXT_BYTES} = require('../app/safe-edits.cjs');
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

test('a safe edit reopens the written path and returns its actual checksum and complete small text', t => {
  const f = fixture(t), content = 'saved 中文\nsecond line 😀\n';
  const result = f.edits.apply({project_path:f.project,file_path:f.file,content,expected_sha256:'absent',idempotency_key:'verified-create'});
  assert.equal(result.verification.status,'matched');assert.equal(result.verification.expected_sha256,sha(content));
  assert.equal(result.verification.sha256,sha(fs.readFileSync(f.file)));assert.equal(result.current_sha256,result.after_sha256);
  assert.equal(result.verification.text,fs.readFileSync(f.file,'utf8'));assert.equal(result.verification.bytes,Buffer.byteLength(content));
  assert.equal(result.verification.complete,true);assert.equal(result.verification.truncated,false);
  assert.ok(Number.isFinite(Date.parse(result.verification.checked_at)));
});

test('readback previews stay within 4 KiB without splitting a UTF-8 character', t => {
  const f=fixture(t),content='中'.repeat(1365)+'😀尾';
  const result=f.edits.apply({project_path:f.project,file_path:f.file,content,expected_sha256:'absent',idempotency_key:'unicode-preview'});
  assert.equal(result.verification.status,'matched');assert.equal(result.verification.sha256,sha(content));
  assert.equal(result.verification.text,'中'.repeat(1365));assert.ok(Buffer.byteLength(result.verification.text)<=VERIFICATION_TEXT_BYTES);
  assert.equal(result.verification.bytes,Buffer.byteLength(content));assert.equal(result.verification.complete,false);assert.equal(result.verification.truncated,true);
  assert.doesNotMatch(result.verification.text,/\uFFFD/);
});

test('postcommit checksum mismatch reports actual changed bytes and never retries the write', t => {
  const f=fixture(t),input={project_path:f.project,file_path:f.file,content:'intended bytes',expected_sha256:'absent',idempotency_key:'verification-race'};
  const rename=fs.renameSync;let writes=0,error;
  fs.renameSync=(source,destination)=>{const result=rename(source,destination);if(destination===f.file){writes++;fs.writeFileSync(f.file,'concurrent replacement');}return result;};
  try {try{f.edits.apply(input);}catch(failure){error=failure;}}finally{fs.renameSync=rename;}
  assert.equal(error?.code,'EDIT_VERIFICATION_FAILED');assert.equal(error.details.state,'applied_but_unverified');
  assert.equal(error.details.operation_executed,true);assert.equal(error.details.execution_state,'completed');
  assert.equal(error.details.verification.status,'changed');assert.equal(error.details.verification.text,'concurrent replacement');assert.equal(error.details.verification.sha256,sha('concurrent replacement'));
  const result=f.edits.apply(input);assert.equal(result.reused,true);assert.equal(result.verification.status,'changed');assert.equal(writes,1);
  assert.equal(fs.readFileSync(f.file,'utf8'),'concurrent replacement');assert.match(result.summary,/current file has changed/);
});

test('unavailable readback preserves completed write state and verifies later without replay', t => {
  const f=fixture(t),input={project_path:f.project,file_path:f.file,content:'written once',expected_sha256:'absent',idempotency_key:'readback-unavailable'};
  const rename=fs.renameSync,open=fs.openSync;let committed=false,writes=0,error;
  fs.renameSync=(source,destination)=>{const result=rename(source,destination);if(destination===f.file){committed=true;writes++;}return result;};
  fs.openSync=(file,...args)=>{if(file===f.file&&committed)throw Object.assign(new Error('Synthetic readback denied'),{code:'EACCES'});return open(file,...args);};
  try {try{f.edits.apply(input);}catch(failure){error=failure;}}finally{fs.renameSync=rename;fs.openSync=open;}
  assert.equal(error?.code,'EDIT_VERIFICATION_UNAVAILABLE');assert.equal(error.details.state,'applied_but_unverified');
  assert.equal(error.details.operation_executed,true);assert.equal(error.details.execution_state,'completed');assert.equal(error.details.verification.status,'unavailable');
  assert.equal(Object.hasOwn(error.details.verification,'text'),false);assert.equal(fs.readFileSync(f.file,'utf8'),'written once');
  const recovered=f.edits.apply(input);assert.equal(recovered.reused,true);assert.equal(recovered.recovered,true);assert.equal(recovered.verification.status,'matched');
  assert.equal(recovered.state,'applied');assert.equal(recovered.verification.text,'written once');assert.equal(writes,1);
});

test('legacy idempotency results are checked again and never imply an older checksum still matches', t => {
  const f=fixture(t),input={project_path:f.project,file_path:f.file,content:'original edit',expected_sha256:'absent',idempotency_key:'legacy-result'};
  const first=f.edits.apply(input),record=path.join(f.home,'edits',first.undo_id,'result.json'),legacy=JSON.parse(fs.readFileSync(record,'utf8'));
  delete legacy.verification;delete legacy.current_sha256;fs.writeFileSync(record,JSON.stringify(legacy));const saved=fs.readFileSync(record,'utf8');
  fs.writeFileSync(f.file,'later user update');const result=f.edits.existing(input);
  assert.equal(result.reused,true);assert.equal(result.verification.status,'changed');assert.equal(result.verification.text,'later user update');
  assert.equal(result.current_sha256,sha('later user update'));assert.equal(result.after_sha256,sha('original edit'));
  assert.equal(fs.readFileSync(record,'utf8'),saved,'a historical result remains an immutable record');
});
