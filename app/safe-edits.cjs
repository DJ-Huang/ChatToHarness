'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {atomicJson, readJson, privateDirectory, syncDirectory} = require('./durable-files.cjs');
const {fail} = require('./project-inspect.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const MAX_EDIT_BYTES = 1024 * 1024;
const VERIFICATION_TEXT_BYTES = 4096;
function current(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_EDIT_BYTES) throw fail('EDIT_UNSUPPORTED', 'Safe text edits require a single-link regular file of at most 1 MiB.');
    const bytes = fs.readFileSync(fd); if (bytes.includes(0)) throw fail('EDIT_BINARY_FILE', 'Use the native format tools for binary files.');
    new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    return {bytes, sha256: sha(bytes), mode: stat.mode & 0o777};
  } catch (error) { if (error.code === 'ENOENT') return {bytes: null, sha256: 'absent', mode: 0o644}; throw error; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function replaceChecked(file, bytes, expected, mode, beforeCommit = () => {}) {
  const temporary = `${file}.cth-${crypto.randomBytes(12).toString('hex')}.tmp`; let fd;
  try {
    if (bytes !== null) { fd = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, mode); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined; }
    const observed = current(file); if (observed.sha256 !== expected) throw fail('EDIT_CONFLICT', 'The file changed since it was read. Get its current SHA-256 and review the new content before editing.', {expected_sha256: expected, current_sha256: observed.sha256});
    beforeCommit();
    if (bytes === null) fs.unlinkSync(file); else fs.renameSync(temporary, file);
    syncDirectory(path.dirname(file));
  } finally { if (fd !== undefined) fs.closeSync(fd); try { fs.unlinkSync(temporary); } catch {} }
}
function verificationFor(file, expected) {
  const checked_at = new Date().toISOString();
  try {
    // Reopen the committed path. Never echo the input or assume a historical
    // idempotency result still describes the bytes currently on disk.
    const observed = current(file), bytes = observed.bytes || Buffer.alloc(0);
    let end = Math.min(bytes.length, VERIFICATION_TEXT_BYTES);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    return {status: observed.sha256 === expected ? 'matched' : 'changed', expected_sha256: expected,
      sha256: observed.sha256, bytes: bytes.length, text: bytes.subarray(0, end).toString('utf8'),
      complete: end === bytes.length, truncated: end < bytes.length, checked_at};
  } catch (error) {
    return {status: 'unavailable', expected_sha256: expected, sha256: null, bytes: null, complete: false, truncated: false,
      checked_at, error: {code: error.code || 'EDIT_READBACK_FAILED', message: 'The current file could not be safely reopened for verification.'}};
  }
}
function verifiedResult(result, verification, {reused = false} = {}) {
  const next = {...result, verification, current_sha256: verification.sha256};
  if (reused) {
    next.reused = true;
    if (verification.status === 'changed') next.summary = 'This operation was recorded earlier. The current file has changed; no write was repeated.';
    else if (verification.status === 'unavailable') next.summary = 'This operation was recorded earlier. Its current file could not be verified; no write was repeated.';
    else {
      next.summary = 'This operation was recorded earlier. Its expected file bytes were verified again; no write was repeated.';
      if (result.state === 'applied_but_unverified') Object.assign(next, {state: 'applied', operation_executed: true, execution_state: 'completed', recovered: true});
    }
  } else if (verification.status === 'matched') next.summary += ' The resulting file bytes were reopened and verified.';
  else {
    next.state = 'applied_but_unverified';
    next.summary = verification.status === 'changed' ? 'The operation completed, but the reopened file differs from the expected result.' : 'The write completed, but its resulting file bytes could not be verified.';
  }
  return next;
}
function requireVerified(result) {
  if (result.verification.status === 'matched') return result;
  const changed = result.verification.status === 'changed';
  throw fail(`EDIT_VERIFICATION_${changed ? 'FAILED' : 'UNAVAILABLE'}`,
    changed ? 'The file was reopened after the operation but does not match its expected checksum. Inspect the observed content; this operation will not be replayed.' : 'The resulting file could not be safely reopened. Inspect the file or retry this exact operation identity to verify it without replaying the write.', result);
}
class SafeEdits {
  constructor(home) { this.directory = path.join(home, 'edits'); }
  existing(input) {
    if (typeof input.idempotency_key !== 'string') return undefined;
    const id = `edit_${sha(JSON.stringify([input.project_path, input.idempotency_key]))}`;
    return fs.existsSync(path.join(this.directory, id)) ? this.apply(input) : undefined;
  }
  apply({project_path, file_path, content, expected_sha256, idempotency_key}) {
    if (typeof content !== 'string' || content.includes('\0') || Buffer.byteLength(content) > MAX_EDIT_BYTES) throw fail('EDIT_TOO_LARGE', 'content must be UTF-8 text of at most 1 MiB.');
    if (typeof expected_sha256 !== 'string' || !/^(absent|[a-f0-9]{64})$/.test(expected_sha256)) throw fail('EDIT_PRECONDITION_REQUIRED', 'Provide the SHA-256 returned by get_file_result, or absent to create a new file.');
    if (typeof idempotency_key !== 'string' || !idempotency_key || idempotency_key.length > 128) throw fail('IDEMPOTENCY_KEY_REQUIRED', 'Provide a stable key for this intended edit.');
    privateDirectory(this.directory);
    const id = `edit_${sha(JSON.stringify([project_path, idempotency_key]))}`, directory = path.join(this.directory, id), bytes = Buffer.from(content), after = sha(bytes);
    const fingerprint = sha(JSON.stringify([project_path, file_path, expected_sha256, after]));
    if (fs.existsSync(directory)) {
      if (fs.lstatSync(directory).isSymbolicLink()) throw fail('UNSAFE_STORAGE', 'Edit history must be a real directory.');
      const request = readJson(path.join(directory, 'request.json'));
      if (request.fingerprint !== fingerprint) throw fail('IDEMPOTENCY_CONFLICT', 'This key already identifies another edit.', {undo_id: id});
      let result; try { result = readJson(path.join(directory, 'result.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const verification = verificationFor(file_path, after);
      if (result) return verifiedResult(result, verification, {reused: true});
      if (verification.status === 'matched') { result = verifiedResult({...request.result, recovered: true}, verification); atomicJson(path.join(directory, 'result.json'), result); return result; }
      throw fail('EDIT_INTERRUPTED', 'An earlier edit with this key has no confirmed result. Inspect the file and saved backup; this request will not replay it.', {undo_id: id, operation_executed: null, execution_state: 'unknown', current_sha256: verification.sha256, verification});
    }
    const before = current(file_path);
    if (before.sha256 !== expected_sha256) throw fail('EDIT_CONFLICT', 'The file no longer matches the content you read.', {expected_sha256, current_sha256: before.sha256});
    if (fs.readdirSync(this.directory).length >= 1024) throw fail('EDIT_STORE_FULL', 'Archive old edit history before creating further undo records.');
    fs.mkdirSync(directory, {mode: 0o700});
    let result = {summary: `Saved ${path.basename(file_path)} with an undo record.`, state: 'applied', undo_id: id, project_path, path: file_path, before_sha256: before.sha256, after_sha256: after, operation_executed: true, execution_state: 'completed', completed_at: new Date().toISOString()};
    const request = {schema: 1, fingerprint, file_path, project_path, mode: before.mode, before_sha256: before.sha256, after_sha256: after, result};
    if (before.bytes !== null) { const fd = fs.openSync(path.join(directory, 'before.bin'), 'wx', 0o600); fs.writeFileSync(fd, before.bytes); fs.fsyncSync(fd); fs.closeSync(fd); }
    atomicJson(path.join(directory, 'request.json'), request); syncDirectory(this.directory);
    let commitAttempted = false;
    try {
      replaceChecked(file_path, bytes, expected_sha256, before.mode, () => { commitAttempted = true; });
      result = verifiedResult(result, verificationFor(file_path, after));
      atomicJson(path.join(directory, 'result.json'), result); requireVerified(result); return {...result, reused: false};
    } catch (error) {
      if (/^EDIT_VERIFICATION_(FAILED|UNAVAILABLE)$/.test(error.code || '')) throw error;
      if (commitAttempted) throw fail('EDIT_RESULT_UNCONFIRMED', 'The edit may have been written but its result could not be recorded. Inspect the file or retry this exact key to recover its result.', {undo_id: id, operation_executed: null, execution_state: 'unknown', ...(result.verification ? {verification: result.verification} : {})});
      throw error;
    }
  }
  entry(id, project) {
    if (typeof id !== 'string' || !/^edit_[a-f0-9]{64}$/.test(id)) throw fail('INVALID_UNDO_ID', 'Use the undo_id returned by apply_project_edit.');
    const directory = path.join(this.directory, id);
    let stat; try { stat = fs.lstatSync(directory); } catch (error) { if (error.code === 'ENOENT') throw fail('EDIT_NOT_FOUND', 'This undo record is not present in local edit history.'); throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('UNSAFE_STORAGE', 'Edit history must be a real directory.');
    const request = readJson(path.join(directory, 'request.json'));
    if (request.project_path !== project) throw fail('EDIT_SCOPE_MISMATCH', 'This edit belongs to another project.');
    return {directory, request};
  }
  undo(id, project, expected) {
    const {directory, request} = this.entry(id, project), record = path.join(directory, 'undo.json');
    if (fs.existsSync(record)) return {...readJson(record), reused: true};
    if (expected !== request.after_sha256) throw fail('EDIT_PRECONDITION_REQUIRED', 'Undo requires the after_sha256 returned for this edit.');
    let bytes = null;
    if (request.before_sha256 !== 'absent') { bytes = current(path.join(directory, 'before.bin')).bytes; if (!bytes || sha(bytes) !== request.before_sha256) throw fail('EDIT_BACKUP_CHANGED', 'The saved undo bytes failed their checksum.'); }
    const observed = current(request.file_path).sha256;
    const result = {summary: 'The saved edit was undone.', state: 'undone', undo_id: id, project_path: project, path: request.file_path, restored_sha256: request.before_sha256, execution_state: 'completed'};
    let commitAttempted = false;
    try {
      if (observed !== request.before_sha256) replaceChecked(request.file_path, bytes, expected, request.mode, () => { commitAttempted = true; });
      atomicJson(record, result); return result;
    } catch (error) {
      if (commitAttempted) throw fail('UNDO_RESULT_UNCONFIRMED', 'Undo may have completed but its result could not be recorded. Inspect the file and retry this undo_id to recover the result.', {undo_id: id, operation_executed: null, execution_state: 'unknown'});
      throw error;
    }
  }
}
module.exports = {SafeEdits, current, replaceChecked, VERIFICATION_TEXT_BYTES};
