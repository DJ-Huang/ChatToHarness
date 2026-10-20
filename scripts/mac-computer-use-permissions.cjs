#!/usr/bin/env node
'use strict';
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
if (process.platform !== 'darwin') {
  console.error('macOS 14+ is required.');
  process.exit(2);
}
const option = process.argv[2] || '--status';
if (!['--status', '--request'].includes(option) || process.argv.length > 3) {
  console.error('Usage: node scripts/mac-computer-use-permissions.cjs [--status|--request]');
  process.exit(2);
}
const helper = path.join(root, 'resources/computer-use/ChatToHarness.MacComputerUse');
if (!fs.existsSync(helper)) {
  console.error('Missing Mac helper. Run npm run build:computer-use first.');
  process.exit(2);
}
if (option === '--request') {
  console.log('macOS may display Screen Recording and Accessibility permission prompts.');
  console.log('Permissions require the local user to approve them. Do not grant access to unknown applications.');
}
const run = spawnSync(helper, [option === '--request' ? 'request_permissions' : 'permission_status'], {
  cwd: root, encoding: 'utf8', timeout: option === '--request' ? 120000 : 10000
});
if (run.error || run.signal || run.status !== 0) {
  console.error('Native permissions helper failed:', run.error?.message || run.signal || run.stderr || run.status);
  process.exit(1);
}
let status;
try { status = JSON.parse(run.stdout.trim()); }
catch { console.error('Unexpected native permission response'); process.exit(1); }
if (typeof status.screen_recording !== 'boolean' ||
    typeof status.accessibility !== 'boolean') {
  console.error('Unexpected permissions schema'); process.exit(1);
}
console.log('macOS Computer Use permissions for this helper process:');
console.log('  Screen Recording: ', status.screen_recording ? 'GRANTED' : 'MISSING');
console.log('  Accessibility:    ', status.accessibility ? 'GRANTED' : 'MISSING');
if (!status.screen_recording || !status.accessibility) {
  console.log('Open System Settings > Privacy & Security.');
  console.log('For Screen Recording (or Screen & System Audio Recording) and Accessibility,');
  console.log('enable the entry for the actual app/helper/terminal running Computer Use.');
  console.log('Close and restart the service after granting permissions; TCC follows application identity.');
}
console.log(JSON.stringify(status));
