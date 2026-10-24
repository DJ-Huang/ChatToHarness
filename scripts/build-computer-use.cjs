'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
function buildComputerUse(root = path.resolve(__dirname, '..')) {
  const directory = path.join(root, 'resources', 'computer-use');
  fs.mkdirSync(directory, {recursive: true});
  if (process.platform === 'win32') {
    const output = path.join(directory, 'ChatToHarness.ComputerUse.exe');
    const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/optimize+',
      '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Web.Extensions.dll',
      '/out:' + output, path.join(root, 'native', 'ComputerUse.cs')], {windowsHide: true, stdio: 'pipe'});
    fs.writeFileSync(path.join(directory, 'mcp-config.json'), JSON.stringify({mcpServers: {
      'windows-computer': {command: process.execPath, args: [path.join(root, 'app', 'windows-computer-use-stdio.cjs')],
        env: {CTH_COMPUTER_USE_AUTHORIZATION_MODE: 'all_windows'}}
    }}, null, 2) + '\n');
    return output;
  }
  if (process.platform === 'darwin') {
    const output = path.join(directory, 'ChatToHarness.MacComputerUse');
    execFileSync('xcrun', ['swiftc', '-parse-as-library', '-O',
      path.join(root, 'native', 'MacComputerUse.swift'),
      path.join(root, 'native', 'MacHUDSurface.swift'),
      path.join(root, 'native', 'MacCursorGlow.swift'),
      path.join(root, 'native', 'MacCursorTrajectory.swift'), '-o', output], {stdio: 'pipe'});
    fs.chmodSync(output, 0o755);
    fs.writeFileSync(path.join(directory, 'mcp-config.json'), JSON.stringify({mcpServers: {
      'macos-computer': {command: process.execPath, args: [path.join(root, 'app', 'macos-computer-use-stdio.cjs')],
        env: {CTH_COMPUTER_USE_AUTHORIZATION_MODE: 'all_windows'}}
    }}, null, 2) + '\n');
    return output;
  }
  throw new Error('Computer Use currently supports Windows and macOS only.');
}
if (require.main === module) {
  try { console.log(buildComputerUse()); }
  catch (error) { console.error(error.stderr?.toString() || error.stdout?.toString() || error.message); process.exitCode = 1; }
}
module.exports = {buildComputerUse};
