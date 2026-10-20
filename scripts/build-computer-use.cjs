'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
function buildComputerUse(root = path.resolve(__dirname, '..')) {
  if (process.platform !== 'win32') throw new Error('Computer use currently requires Windows.');
  const output = path.join(root, 'resources', 'computer-use', 'ChatToHarness.ComputerUse.exe');
  fs.mkdirSync(path.dirname(output), {recursive: true});
  const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/optimize+',
    '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Web.Extensions.dll',
    '/out:' + output, path.join(root, 'native', 'ComputerUse.cs')], {windowsHide: true, stdio: 'pipe'});
  fs.writeFileSync(path.join(path.dirname(output), 'mcp-config.json'), JSON.stringify({mcpServers: {
    'windows-computer': {command: process.execPath, args: [path.join(root, 'app', 'windows-computer-use-stdio.cjs')],env:{CTH_COMPUTER_USE_AUTHORIZATION_MODE:'all_windows'}}
  }}, null, 2) + '\n');
  return output;
}
if (require.main === module) { try { console.log(buildComputerUse()); } catch (error) { console.error(error.stdout?.toString() || error.message); process.exitCode = 1; } }
module.exports = {buildComputerUse};
