'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {configuration} = require('../scripts/computer-use-config.cjs');
const {FILES} = require('../scripts/prepare-computer-use.cjs');
test('packaged computer-use config relocates bundled Node and entry without auto-enabling trust', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cth-config-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const directory = path.join(root, 'computer-use');
  assert.throws(() => configuration(directory), /missing/);
  fs.mkdirSync(path.join(root, 'node'), {recursive: true}); fs.writeFileSync(path.join(root, 'node/node.exe'), 'fixture');
  fs.mkdirSync(path.join(directory, 'app'), {recursive: true}); fs.writeFileSync(path.join(directory, 'app/windows-computer-use-stdio.cjs'), 'fixture');
  const config = configuration(directory).mcpServers['windows-computer'];
  assert.equal(config.command, path.join(root, 'node/node.exe'));
  assert.deepEqual(config.args, [path.join(directory, 'app/windows-computer-use-stdio.cjs')]);
  assert.deepEqual(Object.keys(config).sort(), ['args', 'command','env']);
  assert.equal(config.env.CTH_COMPUTER_USE_AUTHORIZATION_MODE,'all_windows');
});
test('Windows packaging carries native and JS resources but excludes developer launch config', () => {
  assert.ok(FILES.includes('computer-use/ChatToHarness.ComputerUse.exe'));
  assert.ok(FILES.includes('computer-use/app/windows-computer-use-stdio.cjs'));
  if (process.platform === 'win32') {
    const extras = require('../electron-builder.config.cjs').extraResources;
    assert.ok(extras.some(x => x.to === 'computer-use/node_modules'));
    assert.ok(extras.find(x => x.to === 'computer-use').filter.includes('!mcp-config.json'));
  }
});
