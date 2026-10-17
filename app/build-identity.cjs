'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
function sourceIdentity(root) {
  const hash = crypto.createHash('sha256');
  for (const name of ['package.json', ...fs.readdirSync(path.join(root, 'app')).filter(name => /\.(cjs|js|html|css)$/.test(name)).sort().map(name => `app/${name}`)]) {
    hash.update(name + '\0'); hash.update(fs.readFileSync(path.join(root, name))); hash.update('\0');
  }
  let commit = null, dirty = null;
  try {
    const env = {...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))), GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0'};
    const options = {encoding: 'utf8', env, timeout: 2000, stdio: ['ignore', 'pipe', 'ignore']};
    commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], options).trim();
    dirty = Boolean(execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', root, 'status', '--porcelain', '--untracked-files=normal'], options).trim());
  } catch { /* Source archives may have no Git metadata. */ }
  return {schema: 1, version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, commit, dirty, source_sha256: hash.digest('hex')};
}
function captureBuild({root, resources, packaged = false}) {
  if (!packaged) return {...sourceIdentity(root), mode: 'development', captured_at: new Date().toISOString()};
  try {
    const value = JSON.parse(fs.readFileSync(path.join(resources, 'build-info.json'), 'utf8'));
    if (value.schema !== 1 || !/^[a-f0-9]{64}$/.test(value.source_sha256)) throw new Error();
    return {...value, mode: 'packaged'};
  } catch { return {mode: 'packaged', identity_available: false, message: 'This build has no valid build-info receipt.'}; }
}
function writeBuildInfo(root, resources) {
  const value = {...sourceIdentity(root), built_at: new Date().toISOString()};
  fs.mkdirSync(resources, {recursive: true});
  const destination = path.join(resources, 'build-info.json'), temporary = `${destination}.${process.pid}.tmp`;
  try { fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'}); fs.renameSync(temporary, destination); }
  finally { try { fs.unlinkSync(temporary); } catch {} }
  return value;
}
module.exports = {captureBuild, sourceIdentity, writeBuildInfo};
