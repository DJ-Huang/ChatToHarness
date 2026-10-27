'use strict';
const fs = require('node:fs');
const path = require('node:path');

// NTFS junctions exercise real directory traversal without requiring Developer
// Mode or administrator privileges. File symlinks still use the real OS when
// available; otherwise only their lstat metadata is simulated, explicitly.
function directoryLink(target, alias) {
  fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
}
function fileLink(t, target, alias) {
  try {
    fs.symlinkSync(target, alias, 'file');
    return () => fs.unlinkSync(alias);
  } catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(error.code)) throw error;
  }
  t.diagnostic('File symlink privilege unavailable: testing simulated lstat link metadata; directory junctions and hardlinks remain native.');
  fs.copyFileSync(target, alias);
  const lstat = fs.lstatSync;
  const mocked = t.mock.method(fs, 'lstatSync', function(file, ...args) {
    const stat = lstat.call(fs, file, ...args);
    if (path.resolve(String(file)) === path.resolve(alias)) stat.isSymbolicLink = () => true;
    return stat;
  });
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    mocked.mock.restore();
    fs.unlinkSync(alias);
  };
  t.after(() => { if (!removed) { mocked.mock.restore(); removed = true; } });
  return remove;
}
module.exports = {directoryLink, fileLink};
