'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Settings, SettingsError } = require('../app/settings.cjs');

const originalTunnel = 'tunnel_' + 'a'.repeat(32);
const replacementTunnel = 'tunnel_' + 'b'.repeat(32);

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'localharness-settings-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const folder = path.join(root, '中文 notes with spaces');
  fs.mkdirSync(folder);
  const key = crypto.randomBytes(32);
  const safeStorage = {
    available: true,
    isEncryptionAvailable() { return this.available; },
    encryptString(value) {
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
      const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), body]);
    },
    decryptString(value) {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
  const directory = path.join(root, 'config');
  const make = () => new Settings(directory, safeStorage, { defaultDirectory: folder });
  return { root, folder, directory, file: path.join(directory, 'settings.json'), safeStorage, make };
}

test('credentials are encrypted, preserved, replaced and cleared without entering public state', (t) => {
  const f = fixture(t);
  const settings = f.make();
  assert.deepEqual(settings.public(), { tunnelId: '', directories: [f.folder], autoConnect: true, autoProjectContext: true, keySaved: false });
  assert.equal(settings.getKey(), '');
  const publicState = settings.save({ tunnelId: originalTunnel, apiKey: 'runtime-first-secret' });
  assert.deepEqual(Object.keys(publicState).sort(), ['autoConnect', 'autoProjectContext', 'directories', 'keySaved', 'tunnelId']);
  assert.equal(publicState.keySaved, true);
  assert.equal(settings.getKey(), 'runtime-first-secret');
  assert.equal(fs.readFileSync(f.file, 'utf8').includes('runtime-first-secret'), false);
  assert.equal(JSON.stringify(publicState).includes('runtime-first-secret'), false);
  settings.save({ tunnelId: originalTunnel, apiKey: '   ', autoConnect: false });
  assert.equal(f.make().getKey(), 'runtime-first-secret');
  settings.save({ tunnelId: originalTunnel, apiKey: 'runtime-second-secret' });
  assert.equal(f.make().getKey(), 'runtime-second-secret');
  const publicDirectories = settings.public().directories;
  publicDirectories.push('/');
  assert.deepEqual(settings.public().directories, [f.folder]);
  assert.deepEqual(settings.clearCredentials(), { tunnelId: '', directories: [f.folder], autoConnect: false, autoProjectContext: true, keySaved: false });
  assert.equal(f.make().getKey(), '');
  assert.equal(JSON.stringify(settings.public()).includes('encryptedKey'), false);
});

test('failed encryption and unavailable keychain preserve the old file and safe errors', (t) => {
  const f = fixture(t);
  const settings = f.make();
  settings.save({ tunnelId: originalTunnel, apiKey: 'keep-this-secret' });
  const original = fs.readFileSync(f.file);
  f.safeStorage.encryptString = () => { throw new Error('accidental-secret-from-platform'); };
  assert.throws(() => settings.save({ tunnelId: replacementTunnel, apiKey: 'replacement-secret' }), (error) => {
    assert.equal(error.code, 'ENCRYPTION_FAILED');
    assert.equal(String(error).includes('secret'), false);
    return true;
  });
  assert.deepEqual(fs.readFileSync(f.file), original);
  assert.equal(settings.public().tunnelId, originalTunnel);
  f.safeStorage.available = false;
  assert.throws(() => settings.save({ autoConnect: false }), { code: 'ENCRYPTION_UNAVAILABLE' });
  assert.throws(() => settings.getKey(), { code: 'ENCRYPTION_UNAVAILABLE' });
  assert.deepEqual(fs.readFileSync(f.file), original);
  assert.equal(settings.clearCredentials().keySaved, false);
});

test('malformed configuration is visible and its original bytes are preserved', (t) => {
  const f = fixture(t);
  f.make();
  const damaged = '{"schema":1,"secret":"do-not-echo-this"';
  fs.writeFileSync(f.file, damaged);
  assert.throws(f.make, (error) => {
    assert.ok(error instanceof SettingsError);
    assert.equal(error.code, 'INVALID_CONFIG');
    assert.equal(String(error).includes('do-not-echo-this'), false);
    return true;
  });
  assert.equal(fs.readFileSync(f.file, 'utf8'), damaged);
});

test('invalid settings are rejected before writes, directories canonicalize and deduplicate', (t) => {
  const f = fixture(t);
  const settings = f.make();
  const alias = path.join(f.root, 'folder alias');
  fs.symlinkSync(f.folder, alias, 'dir');
  assert.deepEqual(settings.save({ directories: [f.folder, alias, path.join(f.folder, '..', path.basename(f.folder))] }).directories, [f.folder]);
  const original = fs.readFileSync(f.file);
  for (const input of [
    { directories: [] }, { directories: ['relative'] }, { directories: [path.join(f.root, 'missing')] },
    { directories: [f.file] }, { tunnelId: 'not-tunnel' }, { tunnelId: 'tunnel_' },
    { tunnelId: 'tunnel_' + 'A'.repeat(32) }, { tunnelId: 'tunnel_' + 'a'.repeat(31) + '-' },
    { tunnelId: 'tunnel_' + 'a'.repeat(31) }, { tunnelId: 'tunnel_' + '1'.repeat(33) },
    { apiKey: 'secret\nsecond-line' }, { apiKey: 'secret\r' }, { apiKey: 'secret\0' },
    { apiKey: 's'.repeat(4097) }, { apiKey: null }, { autoConnect: 'yes' }, { autoProjectContext: 'yes' },
  ]) {
    assert.throws(() => settings.save(input), SettingsError);
    assert.deepEqual(fs.readFileSync(f.file), original);
  }
});

test('configuration and directory permissions are private and no temporary files remain', (t) => {
  const f = fixture(t);
  const settings = f.make();
  settings.save({ tunnelId: originalTunnel, apiKey: 'private-key' });
  if(process.platform!=='win32'){
    assert.equal(fs.statSync(f.directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
  }
  assert.deepEqual(fs.readdirSync(f.directory), ['settings.json']);
});

test('symbolic links and hard links cannot redirect configuration reads or writes', (t) => {
  const f = fixture(t);
  const settings = f.make();
  const outside = path.join(f.root, 'outside.json');
  fs.writeFileSync(outside, 'unchanged');
  fs.symlinkSync(outside, f.file);
  assert.throws(f.make, { code: 'UNSAFE_STORAGE' });
  assert.throws(() => settings.save({ directories: [f.folder] }), { code: 'UNSAFE_STORAGE' });
  assert.equal(fs.readFileSync(outside, 'utf8'), 'unchanged');
  fs.unlinkSync(f.file);
  fs.linkSync(outside, f.file);
  assert.throws(f.make, { code: 'UNSAFE_STORAGE' });
  fs.unlinkSync(f.file);
  fs.rmdirSync(f.directory);
  fs.symlinkSync(f.folder, f.directory, 'dir');
  assert.throws(f.make, { code: 'UNSAFE_STORAGE' });
});

test('ciphertext corruption is a safe decryption error without leaking platform errors', (t) => {
  const f = fixture(t);
  const settings = f.make();
  settings.save({ tunnelId: originalTunnel, apiKey: 'original-key' });
  const persisted = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  persisted.encryptedKey = Buffer.from('invalid ciphertext').toString('base64');
  fs.writeFileSync(f.file, JSON.stringify(persisted));
  const loaded = f.make();
  assert.equal(loaded.public().keySaved, true);
  assert.throws(() => loaded.getKey(), { code: 'DECRYPTION_FAILED' });
});

test('a saved folder that is moved or offline stays visible and editable at startup', (t) => {
  const f = fixture(t);
  f.make().save({ tunnelId: originalTunnel, apiKey: 'offline-folder-test-key' });
  const original = fs.readFileSync(f.file);
  fs.rmdirSync(f.folder);
  const settings = f.make();
  assert.deepEqual(settings.public().directories, [f.folder]);
  assert.equal(settings.getKey(), 'offline-folder-test-key');
  assert.throws(() => settings.save({ autoConnect: false }), { code: 'INVALID_DIRECTORY' });
  assert.deepEqual(fs.readFileSync(f.file), original);
  const replacement = path.join(f.root, 'replacement notes');
  fs.mkdirSync(replacement);
  assert.deepEqual(settings.save({ directories: [replacement] }).directories, [replacement]);
  assert.equal(settings.getKey(), 'offline-folder-test-key');
});

test('project guidance defaults on for old settings and survives saves and credential clearing', (t) => {
  const f = fixture(t);
  const settings = f.make();
  settings.save({ tunnelId: originalTunnel, apiKey: 'existing-synthetic-key' });
  const legacy = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  delete legacy.autoProjectContext;
  fs.writeFileSync(f.file, JSON.stringify(legacy));
  const migrated = f.make();
  assert.equal(migrated.public().autoProjectContext, true);
  assert.equal(migrated.getKey(), 'existing-synthetic-key');
  migrated.save({ autoProjectContext: false });
  assert.equal(f.make().public().autoProjectContext, false);
  assert.equal(migrated.getKey(), 'existing-synthetic-key');
  assert.deepEqual(migrated.public().directories, [f.folder]);
  assert.equal(migrated.clearCredentials().autoProjectContext, false);
  assert.equal(f.make().public().autoProjectContext, false);
  const invalid = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  invalid.autoProjectContext = 'invalid';
  fs.writeFileSync(f.file, JSON.stringify(invalid));
  assert.throws(f.make, { code: 'INVALID_CONFIG' });
});

test('new installations require a chosen work folder without hardcoded personal paths', (t) => {
  const f = fixture(t);
  const settings = new Settings(f.directory, f.safeStorage);
  assert.deepEqual(settings.public().directories, []);
  assert.throws(() => settings.save({ tunnelId: originalTunnel, apiKey: 'synthetic-key' }), {code:'INVALID_DIRECTORY'});
  settings.save({directories:[f.folder]});
  assert.deepEqual(new Settings(f.directory, f.safeStorage).public().directories, [f.folder]);
});
