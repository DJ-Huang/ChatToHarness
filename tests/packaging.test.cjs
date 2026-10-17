'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const versions = require('../scripts/versions.cjs');
const { signingConfig, verifyResources } = require('../scripts/build.cjs');
const { envWithPath } = require('../scripts/prepare-resources.cjs');
const manifest = require('../package.json');

test('native downloads are pinned separately and unsupported architectures fail closed', () => {
  for (const platform of ['darwin-arm64', 'win32-x64']) {
    const pin = versions.forPlatform(platform);
    for (const item of [pin.node, pin.tunnel]) {
      assert.match(item.sha256, /^[a-f0-9]{64}$/);
      assert.ok(item.url.startsWith('https://'));
    }
    assert.match(pin.tunnel.licenseSha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(versions.forPlatform('win32-x64').node.binary, 'node.exe');
  assert.equal(versions.forPlatform('win32-x64').tunnel.binary, 'tunnel-client-runtime.exe');
  assert.throws(() => versions.forPlatform('darwin-x64'), /Unsupported/);
  assert.throws(() => versions.forPlatform('linux-x64'), /Unsupported/);
});

test('explicit signing requires credentials and default build ignores ambient signing credentials', () => {
  assert.throws(() => signingConfig('win32', { CTH_SIGNED: '1' }), /CSC_LINK/);
  assert.throws(() => signingConfig('darwin', { CTH_SIGNED: '1', CSC_LINK: 'cert', CSC_KEY_PASSWORD: 'pass' }), /APPLE_ID/);
  const unsigned = signingConfig('darwin', { CSC_LINK: 'ambient', APPLE_ID: 'ambient' });
  assert.equal(unsigned.env.CSC_LINK, undefined);
  assert.equal(unsigned.env.APPLE_ID, undefined);
  assert.ok(unsigned.overrides.includes('-c.mac.identity=-'));
  const signed = signingConfig('darwin', { CTH_SIGNED: '1', CSC_LINK: 'cert', CSC_KEY_PASSWORD: 'pass',
    APPLE_API_KEY: 'key', APPLE_API_KEY_ID: 'id', APPLE_API_ISSUER: 'issuer' });
  assert.ok(signed.overrides.includes('-c.forceCodeSigning=true'));
  assert.ok(signed.overrides.includes('-c.mac.notarize=true'));
});

test('package keeps legacy identity and user data while exposing branded native installers', () => {
  assert.equal(manifest.version, '0.3.0');
  assert.equal(manifest.build.appId, 'local.localharness.mac');
  assert.equal(manifest.build.productName, 'ChatToHarness');
  assert.equal(manifest.build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(manifest.build.nsis.allowElevation, false);
  assert.equal(manifest.build.nsis.perMachine, false);
  assert.equal(manifest.build.mac.minimumSystemVersion, '14.0');
  assert.equal(manifest.build.win.requestedExecutionLevel, 'asInvoker');
});

test('resource verification rejects payload changes and mismatched native platform', { skip: !versions.platforms[`${process.platform}-${process.arch}`] }, () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'cth bundle 中文 space '));
  try {
    const pin = versions.forPlatform();
    const files = {};
    for (const relative of [`node/${pin.node.binary}`, `tunnel/${pin.tunnel.binary}`, `node/${pin.node.npm}`,
      'desktop-commander/node_modules/@wonderwhy-er/desktop-commander/dist/index.js']) {
      const file = path.join(folder, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'fixture'); files[relative] = crypto.createHash('sha256').update('fixture').digest('hex');
    }
    const receipt = { platform: `${process.platform}-${process.arch}`, node: versions.node.version,
      tunnel: versions.tunnel.version, desktopCommander: versions.desktopCommander.version,
      nodeArchiveSha256: pin.node.sha256, tunnelArchiveSha256: pin.tunnel.sha256, files };
    const receiptFile = path.join(folder, 'bundle.json');
    fs.writeFileSync(receiptFile, JSON.stringify(receipt));
    verifyResources(folder);
    fs.writeFileSync(path.join(folder, `tunnel/${pin.tunnel.binary}`), 'changed');
    assert.throws(() => verifyResources(folder), /校验失败/);
    fs.writeFileSync(receiptFile, JSON.stringify({ ...receipt, platform: 'wrong-platform' }));
    assert.throws(() => verifyResources(folder), /平台不匹配/);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('native npm receives only one PATH variable', () => {
  const environment = envWithPath(path.join(os.tmpdir(), 'node runtime'));
  assert.equal(Object.keys(environment).filter(name => name.toLowerCase() === 'path').length, 1);
  assert.ok(environment.PATH.startsWith(path.join(os.tmpdir(), 'node runtime') + path.delimiter));
});
