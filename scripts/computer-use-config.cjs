'use strict';
// Staged inside resources/computer-use. Native helpers remain platform-specific.
const path = require('node:path');
const fs = require('node:fs');
function configuration(directory = __dirname, platform = process.platform) {
  if (!['win32', 'darwin'].includes(platform)) throw new Error('Computer Use is not supported on this platform.');
  const windows = platform === 'win32';
  const command = path.resolve(directory, windows ? '../node/node.exe' : '../node/bin/node');
  const entry = path.join(directory, 'app', windows ? 'windows-computer-use-stdio.cjs' : 'macos-computer-use-stdio.cjs');
  const helper = path.join(directory, windows ? 'ChatToHarness.ComputerUse.exe' : 'ChatToHarness.MacComputerUse');
  if (![command, entry, helper].every(file => fs.existsSync(file)))
    throw new Error('Bundled computer-use resources are missing.');
  return {mcpServers: {
    [windows ? 'windows-computer' : 'macos-computer']: {command, args: [entry],
      env: {CTH_COMPUTER_USE_AUTHORIZATION_MODE: 'all_windows'}}
  }};
}
if (require.main === module) console.log(JSON.stringify(configuration(), null, 2));
module.exports = {configuration};
