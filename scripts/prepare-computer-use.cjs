'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {buildComputerUse} = require('./build-computer-use.cjs');
const WINDOWS_FILES = ['computer-use/ChatToHarness.ComputerUse.exe',
  'computer-use/app/windows-computer-use.cjs', 'computer-use/app/computer-use-images.cjs',
  'computer-use/app/windows-computer-use-stdio.cjs', 'computer-use/configure.cjs',
  'computer-use/package.json', 'computer-use/package-lock.json'];
const MACOS_FILES = ['computer-use/ChatToHarness.MacComputerUse',
  'computer-use/app/windows-computer-use.cjs', 'computer-use/app/computer-use-images.cjs',
  'computer-use/app/macos-computer-use.cjs', 'computer-use/app/macos-computer-use-stdio.cjs',
  'computer-use/configure.cjs', 'computer-use/package.json', 'computer-use/package-lock.json'];
const FILES = process.platform === 'darwin' ? MACOS_FILES : WINDOWS_FILES;
function prepareComputerUse(root, node) {
  if (!['win32', 'darwin'].includes(process.platform)) return [];
  buildComputerUse(root);
  const directory = path.join(root, 'resources/computer-use');
  fs.mkdirSync(path.join(directory, 'app'), {recursive: true});
  const appFiles = process.platform === 'darwin'
    ? ['windows-computer-use.cjs', 'computer-use-images.cjs', 'macos-computer-use.cjs', 'macos-computer-use-stdio.cjs']
    : ['windows-computer-use.cjs', 'windows-computer-use-stdio.cjs', 'computer-use-images.cjs'];
  for (const name of appFiles) fs.copyFileSync(path.join(root, 'app', name), path.join(directory, 'app', name));
  fs.copyFileSync(path.join(root, 'scripts/computer-use-config.cjs'), path.join(directory, 'configure.cjs'));
  for (const name of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(root, name), path.join(directory, name));
  fs.copyFileSync(path.join(root, 'docs', process.platform === 'darwin' ? 'computer-use-macos-plan.md' : 'windows-computer-use.md'),
    path.join(directory, 'README.md'));
  const fingerprint = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'package-lock.json'))).digest('hex');
  const stamp = path.join(directory, '.dependencies');
  const sdk = path.join(directory, 'node_modules/@modelcontextprotocol/sdk/package.json');
  if (!fs.existsSync(sdk) || !fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== fingerprint) {
    const npm = process.platform === 'darwin'
      ? path.join(root, 'resources/node/lib/node_modules/npm/bin/npm-cli.js')
      : path.join(root, 'resources/node/node_modules/npm/bin/npm-cli.js');
    execFileSync(node, [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
      {cwd: directory, windowsHide: true, stdio: 'inherit'});
    fs.writeFileSync(stamp, fingerprint);
  }
  return FILES;
}
module.exports = {prepareComputerUse, FILES, WINDOWS_FILES, MACOS_FILES};
