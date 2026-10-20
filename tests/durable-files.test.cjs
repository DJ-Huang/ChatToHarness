'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {atomicJson, readJson} = require('../app/durable-files.cjs');

test('a record replaced between open and fstat is reopened without accepting unlinked bytes', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cth-record-race-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const file = path.join(directory, 'state.json');
  atomicJson(file, {revision: 1});
  const fstat = fs.fstatSync, handles = [];
  t.mock.method(fs, 'fstatSync', (fd, ...args) => {
    handles.push(fd);
    if (handles.length === 1) atomicJson(file, {revision: 2});
    return fstat(fd, ...args);
  });
  assert.deepEqual(readJson(file), {revision: 2});
  for (const fd of handles) assert.throws(() => fstat(fd), {code: 'EBADF'});
});

test('replacement retries are bounded and still reject hard links and oversized records', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cth-record-guards-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const file = path.join(directory, 'state.json');
  atomicJson(file, {revision: 1});
  fs.linkSync(file, path.join(directory, 'alias.json'));
  assert.throws(() => readJson(file), {code: 'UNSAFE_STORAGE'});
  fs.unlinkSync(path.join(directory, 'alias.json'));
  assert.throws(() => readJson(file, 1), {code: 'UNSAFE_STORAGE'});
  const fstat = fs.fstatSync;
  let attempts = 0;
  t.mock.method(fs, 'fstatSync', (fd, ...args) => {
    atomicJson(file, {revision: ++attempts});
    return fstat(fd, ...args);
  });
  assert.throws(() => readJson(file), {code: 'UNSAFE_STORAGE'});
  assert.equal(attempts, 3);
});
