'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function privateDirectory(directory) {
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) throw Object.assign(new Error('Private storage must be a real directory.'), {code: 'UNSAFE_STORAGE'});
  fs.chmodSync(directory, 0o700);
}
function syncDirectory(directory) {
  let fd;
  try { fd = fs.openSync(directory, 'r'); fs.fsyncSync(fd); }
  catch (error) { if (process.platform !== 'win32' || !['EPERM', 'EISDIR', 'EINVAL', 'EACCES'].includes(error.code)) throw error; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function readJson(file, maxBytes = 512 * 1024) {
  for (let attempt = 0; ; attempt++) {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd);
      // An atomic writer can replace the path after open, unlinking this old
      // inode before fstat. Reopen the current record; never accept the stale
      // unlinked bytes or relax the symlink/hard-link checks.
      if (stat.isFile() && stat.nlink === 0 && attempt < 2) continue;
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes) throw Object.assign(new Error('Stored record is not a bounded private file.'), {code: 'UNSAFE_STORAGE'});
      return JSON.parse(fs.readFileSync(fd, 'utf8'));
    } finally { fs.closeSync(fd); }
  }
}
function atomicJson(file, value) {
  const temporary = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    for (let attempt = 0; ; attempt++) {
      if (fs.existsSync(file)) { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Object.assign(new Error('Stored record changed unexpectedly.'), {code: 'UNSAFE_STORAGE'}); }
      try { fs.renameSync(temporary, file); break; }
      catch (error) {
        // Windows can temporarily deny replacement while a reader holds the old
        // file open. Retry the same rename, never unlink the destination first.
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5 * (attempt + 1));
      }
    }
    syncDirectory(path.dirname(file));
  } finally { if (fd !== undefined) fs.closeSync(fd); try { fs.unlinkSync(temporary); } catch {} }
}
module.exports = {privateDirectory, readJson, atomicJson, syncDirectory};
