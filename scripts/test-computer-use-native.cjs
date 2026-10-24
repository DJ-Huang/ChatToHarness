'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {buildComputerUse} = require('./build-computer-use.cjs');
if (process.platform !== 'win32') throw new Error('Windows interactive desktop required.');
const helper = process.argv[2] ? path.resolve(process.argv[2]) : buildComputerUse();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cth-computer-use-acceptance-'));
try {
  const executable = path.join(directory, 'Fixture.exe');
  const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Web.Extensions.dll', '/out:' + executable, path.resolve(__dirname, '../tests/fixtures/computer-use-window.cs')], {windowsHide: true, stdio: 'pipe'});
  console.log(execFileSync(executable, [helper], {windowsHide: true, timeout: 45000, encoding: 'utf8'}).trim());
} catch (error) {
  console.error(error.stdout?.toString() || '', error.stderr?.toString() || error.message); process.exitCode = error.status === 2 ? 2 : 1;
} finally {
  // Only the exact freshly created temporary fixture directory is removed.
  if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('cth-computer-use-acceptance-')) fs.rmSync(directory, {recursive: true, force: true});
}
