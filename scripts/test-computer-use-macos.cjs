#!/usr/bin/env node
'use strict';
const {spawnSync} = require('node:child_process');
const path = require('node:path');
if (process.platform !== 'darwin') {
  console.error('macOS 14+ is required for this native acceptance script.');
  process.exit(2);
}
const root = path.resolve(__dirname, '..');
function run(command, args) {
  const result = spawnSync(command, args, {cwd: root, stdio: 'inherit', timeout: 120000});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('[Mac Computer Use] Compile native ScreenCaptureKit / Accessibility helper');
run(process.execPath, ['scripts/build-computer-use.cjs']);
console.log('[Mac Computer Use] MCP contract, screenshot chunking and TCC denial tests');
run(process.execPath, ['--test', '--test-concurrency=1', 'tests/macos-computer-use.test.cjs', 'tests/mac-permission-diagnostics.test.cjs', 'tests/mac-native-observe-glow.test.cjs', 'tests/mac-readonly-mcp-real.test.cjs']);
console.log('[Mac Computer Use] Automated acceptance: PASS');
console.log('Real GUI clicks, local STOP/Esc, Retina mapping and signed-app Screen Recording grants');
console.log('remain MANUAL acceptance gates. This script does not claim they passed.');
