'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { McpSettings, McpSettingsError } = require('../app/mcp-settings.cjs');

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chattoharness-mcp-settings-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const key = crypto.randomBytes(32);
  const safeStorage = {
    available: true,
    isEncryptionAvailable() { return this.available; },
    encryptString(value) {
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
      const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), data]);
    },
    decryptString(value) {
      const cipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      cipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8');
    },
  };
  const directory = path.join(root, 'config');
  const file = path.join(directory, 'mcp-settings.json');
  const make = () => new McpSettings(directory, safeStorage);
  return { root, directory, file, safeStorage, make };
}

const config = (extra = {}) => ({ id: 'unity', name: 'Unity tools', transport: 'stdio', command: 'node', args: ['server.cjs'], ...extra });

test('MCP config is independent, encrypted, redacted and round-trips without replacing secret references', t => {
  const f = fixture(t);
  const settings = f.make();
  fs.writeFileSync(path.join(f.directory, 'settings.json'), 'existing application identity');
  const publicServer = settings.save(config({ env: { MCP_TOKEN: 'env-private-value' }, headers: { Authorization: 'Bearer header-private-value' } }));
  const raw = fs.readFileSync(f.file, 'utf8');
  for (const secret of ['env-private-value', 'header-private-value']) {
    assert.equal(raw.includes(secret), false);
    assert.equal(JSON.stringify(settings.list()).includes(secret), false);
    assert.equal(settings.export().includes(secret), false);
  }
  assert.equal(JSON.stringify(settings.list()).includes('ciphertext'), false);
  assert.equal(settings.export().includes('ciphertext'), false);
  assert.equal(settings.resolve('unity').env.MCP_TOKEN, 'env-private-value');
  assert.deepEqual(settings.resolve('unity').headers, publicServer.headers);
  settings.save({ ...publicServer, name: 'Renamed' });
  assert.deepEqual(settings.get('unity').env, publicServer.env);
  assert.deepEqual(f.make().resolve('unity').headers, publicServer.headers);
  assert.equal(fs.readFileSync(path.join(f.directory, 'settings.json'), 'utf8'), 'existing application identity');
  publicServer.args.push('mutated');
  assert.deepEqual(settings.get('unity').args, ['server.cjs']);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(f.directory).mode & 0o777, 0o700);
  }
});

test('trust and tool grants bind to configuration and tool revisions; display and enabled changes retain trust', t => {
  const f = fixture(t);
  const settings = f.make();
  settings.save(config());
  assert.equal(settings.isTrusted('unity'), false);
  settings.trust('unity');
  settings.setToolPolicy('unity', 'get_scene', 'allow', 'revision-one');
  settings.setToolPolicy('unity', '__proto__', 'ask', 'special-revision');
  assert.equal(settings.getToolPolicy('unity', 'get_scene', 'revision-one'), 'allow');
  assert.equal(settings.getToolPolicy('unity', 'get_scene', 'revision-two'), 'deny');
  assert.equal(settings.getToolPolicy('unity', 'missing', 'revision-one'), 'deny');
  assert.equal(settings.getToolPolicy('unity', '__proto__', 'special-revision'), 'ask');
  settings.save({ id: 'unity', name: 'New label', enabled: true });
  assert.equal(settings.isTrusted('unity'), true);
  assert.equal(f.make().getToolPolicy('unity', 'get_scene', 'revision-one'), 'allow');
  settings.save({ id: 'unity', args: ['changed.cjs'] });
  assert.equal(settings.isTrusted('unity'), false);
  assert.equal(settings.getToolPolicy('unity', 'get_scene', 'revision-one'), 'deny');
  assert.deepEqual(settings.listToolPolicies('unity'), {});
  settings.trust('unity');
  settings.setToolPolicy('unity', 'get_scene', 'ask', 'revision-one');
  settings.save({ id: 'unity', env: { MCP_TOKEN: 'new-secret' } });
  assert.equal(settings.isTrusted('unity'), false);
  assert.equal(settings.getToolPolicy('unity', 'get_scene', 'revision-one'), 'deny');
});

test('secret references cannot be copied across servers or keys and failed encryption is transactional', t => {
  const f = fixture(t);
  const settings = f.make();
  const first = settings.save(config({ env: { TOKEN: 'first-secret' } }));
  settings.save(config({ id: 'other' }));
  const original = fs.readFileSync(f.file);
  assert.throws(() => settings.save({ id: 'other', env: { TOKEN: first.env.TOKEN } }), { code: 'INVALID_SECRET_REFERENCE' });
  assert.throws(() => settings.save({ id: 'unity', env: { DIFFERENT_TOKEN: first.env.TOKEN } }), { code: 'INVALID_SECRET_REFERENCE' });
  f.safeStorage.encryptString = () => { throw Error('sensitive-platform-error'); };
  assert.throws(() => settings.save({ id: 'unity', env: { TOKEN: 'replacement-secret' } }), error => {
    assert.equal(error.code, 'ENCRYPTION_FAILED');
    assert.equal(String(error).includes('sensitive'), false);
    return true;
  });
  assert.deepEqual(fs.readFileSync(f.file), original);
  assert.equal(settings.resolve('unity').env.TOKEN, 'first-secret');
  f.safeStorage.available = false;
  assert.throws(() => settings.resolve('unity'), { code: 'ENCRYPTION_UNAVAILABLE' });
  assert.throws(() => settings.save(config({ id: 'third', env: { TOKEN: 'secret' } })), { code: 'ENCRYPTION_UNAVAILABLE' });
  assert.deepEqual(fs.readFileSync(f.file), original);
});

test('tool discovery permanently revokes changed and removed grants before a definition can reappear', t => {
  const f = fixture(t);
  const settings = f.make();
  settings.save(config());
  settings.trust('unity');
  settings.setToolPolicy('unity', 'changed_tool', 'allow', 'original-definition');
  settings.setToolPolicy('unity', 'removed_tool', 'ask', 'removed-definition');
  settings.setToolPolicy('unity', 'unchanged_tool', 'allow', 'unchanged-definition');
  settings.reconcileTools('unity', new Map([
    ['changed_tool', 'new-definition'], ['unchanged_tool', 'unchanged-definition'],
  ]));
  assert.deepEqual(settings.listToolPolicies('unity'), {
    unchanged_tool: { policy: 'allow', fingerprint: 'unchanged-definition' },
  });
  const restarted = f.make();
  restarted.reconcileTools('unity', {
    changed_tool: 'original-definition', removed_tool: 'removed-definition', unchanged_tool: 'unchanged-definition',
  });
  assert.equal(restarted.getToolPolicy('unity', 'changed_tool', 'original-definition'), 'deny');
  assert.equal(restarted.getToolPolicy('unity', 'removed_tool', 'removed-definition'), 'deny');
  assert.equal(restarted.getToolPolicy('unity', 'unchanged_tool', 'unchanged-definition'), 'allow');
  assert.equal(restarted.isTrusted('unity'), true);
  const original = fs.readFileSync(f.file);
  assert.throws(() => restarted.reconcileTools('unity', { invalid: '' }), { code: 'INVALID_TOOL_POLICY' });
  assert.deepEqual(fs.readFileSync(f.file), original);
});

test('platform overrides preserve tokenized arguments and resolve only appropriate absolute paths', t => {
  const settings = fixture(t).make();
  settings.save(config({ command: '/opt/bin/node', args: ['base.cjs'], cwd: '/projects/base', platforms: {
    darwin: { command: '/Applications/Unity Tools/node', args: ['中文 project.cjs', '--key=literal$(value)'] },
    win32: { command: 'C:\\Tools\\node.exe', args: ['C:\\Projects\\server.cjs'], cwd: 'D:\\Projects' },
  } }));
  assert.deepEqual(settings.resolve('unity', 'darwin').args, ['中文 project.cjs', '--key=literal$(value)']);
  assert.equal(settings.resolve('unity', 'win32').command, 'C:\\Tools\\node.exe');
  assert.equal(settings.resolve('unity', 'win32').cwd, 'D:\\Projects');
  settings.save(config({ id: 'mac-only', command: '/opt/bin/node' }));
  assert.throws(() => settings.resolve('mac-only', 'win32'), { code: 'PLATFORM_UNSUPPORTED' });
  for (const input of [
    config({ command: './node' }), config({ cwd: 'relative' }), config({ args: 'node server.cjs' }),
    config({ platforms: { win32: { command: '/usr/bin/node' } } }), config({ platforms: { linux: {} } }),
    config({ timeoutMs: 90001 }), config({ timeoutMs: 999 }), config({ id: 'builtin' }), config({ id: 'Bad ID' }),
  ]) assert.throws(() => settings.save(input), McpSettingsError);
});

test('HTTP only permits HTTPS and loopback HTTP, rejects credentials and header injection', t => {
  const settings = fixture(t).make();
  for (const url of ['https://example.com/mcp', 'http://localhost:3030/mcp', 'http://127.0.0.2/mcp', 'http://[::1]:3030/mcp']) {
    const saved = settings.save({ name: 'HTTP', transport: 'streamable-http', url });
    assert.equal(saved.transport, 'streamable-http');
  }
  for (const url of ['http://example.com/mcp', 'https://username:secret@example.com/mcp', 'file:///mcp', 'https://example.com/mcp#fragment']) {
    assert.throws(() => settings.save({ name: 'HTTP', transport: 'streamable-http', url }), { code: 'INVALID_URL' });
  }
  assert.throws(() => settings.save({ name: 'HTTP', transport: 'streamable-http', url: 'https://example.com', headers: { Authorization: 'secret\r\nInjected: yes' } }), McpSettingsError);
  assert.throws(() => settings.save({ name: 'HTTP', transport: 'streamable-http', url: 'https://example.com', headers: { Accept: 'one', accept: 'two' } }), McpSettingsError);
});

test('import preview is redacted, non-persistent and cannot enable, trust, authorize or execute imported services', t => {
  const f = fixture(t);
  const settings = f.make();
  const preview = settings.previewImport(JSON.stringify({ mcpServers: {
    Unity: { command: 'node', args: ['server.cjs'], env: { TOKEN: 'imported-private-token' }, enabled: true },
    Browser: { url: 'http://localhost:3333/mcp', headers: { Authorization: 'Bearer imported-private-header' } },
  } }));
  assert.equal(fs.existsSync(f.file), false);
  assert.deepEqual(settings.list(), []);
  assert.equal(JSON.stringify(preview).includes('imported-private'), false);
  assert.equal(JSON.stringify(preview).includes('ciphertext'), false);
  assert.deepEqual(preview.servers.map(server => server.enabled), [false, false]);
  const imported = settings.commitImport(preview.draftId);
  assert.deepEqual(imported.map(server => server.trusted), [false, false]);
  assert.equal(settings.resolve('unity').env.TOKEN, 'imported-private-token');
  assert.equal(settings.resolve('browser').headers.Authorization, 'Bearer imported-private-header');
  assert.equal(settings.getToolPolicy('unity', 'get_scene', 'anything'), 'deny');
  assert.throws(() => settings.commitImport(preview.draftId), { code: 'IMPORT_EXPIRED' });
  const again = settings.previewImport(JSON.stringify({ mcpServers: { Unity: { command: 'node' } } }));
  assert.equal(again.servers[0].id, 'unity-2');
});

test('export-import omits trust and grants and requires re-entry of exported secret references', t => {
  const settings = fixture(t).make();
  settings.save(config({ env: { TOKEN: 'keep-private' } }));
  settings.trust('unity');
  settings.setToolPolicy('unity', 'get_scene', 'allow', 'revision');
  const exported = settings.export();
  assert.equal(exported.includes('trusted'), false);
  assert.equal(exported.includes('grants'), false);
  assert.equal(exported.includes('keep-private'), false);
  const preview = settings.previewImport(exported);
  assert.deepEqual(preview.missingSecrets, [{ serverId: 'unity-2', field: 'env', key: 'TOKEN' }]);
  settings.commitImport(preview.draftId);
  assert.equal(settings.isTrusted('unity-2'), false);
  assert.deepEqual(settings.get('unity-2').missingSecrets, [{ field: 'env', key: 'TOKEN' }]);
  assert.deepEqual(settings.list().find(server => server.id === 'unity-2').missingSecrets, [{ field: 'env', key: 'TOKEN' }]);
  assert.throws(() => settings.resolve('unity-2'), { code: 'SECRET_MISSING' });
  settings.save({ id: 'unity-2', env: { TOKEN: 'reentered' } });
  assert.deepEqual(settings.get('unity-2').missingSecrets, []);
  assert.equal(settings.resolve('unity-2').env.TOKEN, 'reentered');
});

test('transport switches retain inactive references without decrypting or reporting missing inactive secrets', t => {
  const f = fixture(t);
  const settings = f.make();
  const saved = settings.save(config({ env: { TOKEN: 'stdio-private' }, headers: { Authorization: 'http-private' } }));
  settings.save({ id: 'unity', transport: 'streamable-http', url: 'https://example.test/mcp' });
  const http = settings.resolve('unity');
  assert.equal(http.headers.Authorization, 'http-private');
  assert.deepEqual(http.env, saved.env);
  settings.save({ id: 'unity', transport: 'stdio' });
  assert.equal(settings.resolve('unity').env.TOKEN, 'stdio-private');
  assert.deepEqual(settings.resolve('unity').headers, saved.headers);

  const exported = JSON.parse(settings.export());
  exported.servers[0].transport = 'streamable-http';
  exported.servers[0].url = 'https://example.test/mcp';
  exported.servers[0].headers = {};
  const preview = settings.previewImport(JSON.stringify(exported));
  assert.deepEqual(preview.missingSecrets, []);
  const imported = settings.commitImport(preview.draftId)[0];
  assert.deepEqual(imported.missingSecrets, []);
  f.safeStorage.available = false;
  f.safeStorage.decryptString = () => { throw Error('Inactive secret must not be read'); };
  const resolved = settings.resolve(imported.id);
  assert.deepEqual(resolved.env, imported.env);
  assert.deepEqual(resolved.headers, {});
  settings.save({ id: imported.id, transport: 'stdio' });
  assert.deepEqual(settings.get(imported.id).missingSecrets, [{ field: 'env', key: 'TOKEN' }]);
  assert.throws(() => settings.resolve(imported.id), { code: 'SECRET_MISSING' });
});

test('stdio accepts inactive missing HTTP header references without accessing secure storage', t => {
  const f = fixture(t);
  const settings = f.make();
  settings.save(config({ headers: { Authorization: 'inactive-http-secret' } }));
  const preview = settings.previewImport(settings.export());
  assert.deepEqual(preview.missingSecrets, []);
  const imported = settings.commitImport(preview.draftId)[0];
  assert.deepEqual(imported.missingSecrets, []);
  f.safeStorage.available = false;
  const resolved = settings.resolve(imported.id);
  assert.deepEqual(resolved.headers, imported.headers);
  assert.deepEqual(resolved.env, {});
});

test('configuration removal clears encrypted secrets and grants while preserving unrelated services', t => {
  const f = fixture(t);
  const settings = f.make();
  settings.save(config({ env: { TOKEN: 'erase-me' } }));
  settings.save(config({ id: 'other' }));
  settings.trust('unity');
  settings.setToolPolicy('unity', 'get_scene', 'allow', 'revision');
  settings.remove('unity');
  const stored = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  assert.deepEqual(stored.secrets, {});
  assert.deepEqual(stored.trust, {});
  assert.deepEqual(stored.grants, {});
  assert.deepEqual(settings.list().map(server => server.id), ['other']);
});

test('malformed files are preserved and symlinks or hardlinks cannot redirect reads or writes', t => {
  const f = fixture(t);
  const settings = f.make();
  const target = path.join(f.root, 'outside');
  fs.writeFileSync(target, 'outside-original');
  fs.symlinkSync(target, f.file);
  assert.throws(f.make, { code: 'UNSAFE_STORAGE' });
  assert.throws(() => settings.save(config()), { code: 'UNSAFE_STORAGE' });
  assert.equal(fs.readFileSync(target, 'utf8'), 'outside-original');
  fs.unlinkSync(f.file);
  fs.linkSync(target, f.file);
  assert.throws(f.make, { code: 'UNSAFE_STORAGE' });
  assert.throws(() => settings.save(config()), { code: 'UNSAFE_STORAGE' });
  fs.unlinkSync(f.file);
  fs.writeFileSync(f.file, '{"private":"do-not-echo-secret"');
  assert.throws(f.make, error => error.code === 'INVALID_CONFIG' && !String(error).includes('do-not-echo-secret'));
  assert.equal(fs.readFileSync(f.file, 'utf8'), '{"private":"do-not-echo-secret"');
});

test('invalid imports and failed writes expose safe errors without partial configuration', t => {
  const f = fixture(t);
  const settings = f.make();
  assert.throws(() => settings.previewImport('{"private":"secret"'), error => error.code === 'INVALID_IMPORT' && !String(error).includes('secret'));
  assert.throws(() => settings.previewImport(JSON.stringify({ mcpServers: { Unsafe: { type: 'sse', url: 'https://example.com' } } })), { code: 'INVALID_TRANSPORT' });
  const preview = settings.previewImport(JSON.stringify({ mcpServers: { Imported: { command: 'node' } } }));
  settings.save(config({ id: 'imported' }));
  assert.throws(() => settings.commitImport(preview.draftId), { code: 'IMPORT_CONFLICT' });
  assert.deepEqual(settings.list().map(server => server.id), ['imported']);
  const previous = fs.readFileSync(f.file);
  const originalRename = fs.renameSync;
  fs.renameSync = () => { throw Error('unsafe underlying platform error'); };
  try { assert.throws(() => settings.save({ id: 'imported', name: 'Failed edit' }), { code: 'WRITE_FAILED' }); }
  finally { fs.renameSync = originalRename; }
  assert.deepEqual(fs.readFileSync(f.file), previous);
  assert.equal(settings.get('imported').name, 'Unity tools');
  assert.deepEqual(fs.readdirSync(f.directory), ['mcp-settings.json']);
});

test('allow-all is off by default, persists locally and preserves grants and trust', t => {
  const f = fixture(t), settings = f.make();
  assert.equal(settings.getAllowAllTools(), false);
  settings.save(config()); settings.trust('unity');
  settings.setToolPolicy('unity', 'inspect', 'ask', 'definition');
  const grants = settings.listToolPolicies('unity');
  const servers = settings.list();
  settings.setAllowAllTools(true);
  assert.equal(f.make().getAllowAllTools(), true);
  assert.deepEqual(settings.list(), servers);
  assert.deepEqual(settings.listToolPolicies('unity'), grants);
  assert.equal(settings.isTrusted('unity'), true);
  assert.equal(settings.export().includes('allowAllTools'), false, 'imports cannot inherit this local permission');
  for (const input of ['true', 1, null, undefined]) assert.throws(() => settings.setAllowAllTools(input), { code: 'INVALID_INPUT' });
  const saved = fs.readFileSync(f.file);
  const originalRename = fs.renameSync;
  fs.renameSync = () => { throw Error('Simulated persistence failure'); };
  try { assert.throws(() => settings.setAllowAllTools(false), { code: 'WRITE_FAILED' }); }
  finally { fs.renameSync = originalRename; }
  assert.equal(settings.getAllowAllTools(), true);
  assert.deepEqual(fs.readFileSync(f.file), saved);
  settings.setAllowAllTools(false);
  assert.equal(f.make().getAllowAllTools(), false);
  const legacy = JSON.parse(fs.readFileSync(f.file));
  delete legacy.allowAllTools;
  fs.writeFileSync(f.file, JSON.stringify(legacy));
  assert.equal(f.make().getAllowAllTools(), false, 'older settings remain compatible');
  fs.writeFileSync(f.file, JSON.stringify({ ...legacy, allowAllTools: 'true' }));
  assert.throws(f.make, { code: 'INVALID_CONFIG' });
});
