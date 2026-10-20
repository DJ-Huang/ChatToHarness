'use strict';
// Staged beside the helper, with bundled Node in the sibling resources/node.
const path = require('node:path');
const fs = require('node:fs');
function configuration(directory = __dirname) {
  const command = path.resolve(directory, '../node/node.exe');
  const entry = path.join(directory, 'app/windows-computer-use-stdio.cjs');
  if (!fs.existsSync(command) || !fs.existsSync(entry)) throw new Error('Bundled computer-use resources are missing.');
  return {mcpServers: {'windows-computer': {command, args: [entry],env:{CTH_COMPUTER_USE_AUTHORIZATION_MODE:'all_windows'}}}};
}
if (require.main === module) console.log(JSON.stringify(configuration(), null, 2));
module.exports = {configuration};
