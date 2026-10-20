'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const helper = path.join(root, 'resources/computer-use/ChatToHarness.MacComputerUse');
const script = path.join(root, 'scripts/mac-computer-use-permissions.cjs');
const swift = fs.readFileSync(path.join(root, 'native/MacComputerUse.swift'), 'utf8');
test('macOS permission preflight is read-only and reports each independent TCC grant', {skip:process.platform!=='darwin'},()=>{
  assert.ok(fs.existsSync(helper));
  const r=spawnSync(helper,['permission_status'],{encoding:'utf8',timeout:10000});
  assert.equal(r.status,0, r.stderr);
  const result=JSON.parse(r.stdout.trim());
  for(const name of ['screen_recording','accessibility','input_monitoring'])assert.equal(typeof result[name],'boolean');
  assert.equal(result.request_attempted,false);
});
test('CLI permission status remains non-interactive and includes required grants', {skip:process.platform!=='darwin'},()=>{
  const r=spawnSync(process.execPath,[script,'--status'],{cwd:root,encoding:'utf8',timeout:10000});
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/Screen Recording/);
  assert.match(r.stdout,/Accessibility/);
  assert.match(r.stdout,/Input Monitoring/);
  assert.match(r.stdout,/"request_attempted":false/);
});
test('permission request is explicit and not reachable from the computer_use MCP schema',()=>{
  assert.match(swift,/CommandLine.arguments\[1\] == "request_permissions"/);
  assert.match(swift,/request \? CGRequestScreenCaptureAccess\(\)/);
  assert.match(swift,/request \? CGRequestListenEventAccess\(\)/);
  assert.match(swift,/AXIsProcessTrustedWithOptions/);
  const {definition}=require('../app/macos-computer-use.cjs');
  assert.ok(!definition.inputSchema.properties.action.enum.includes('request_permissions'));
});
test('mouse motion verifies current target without a synchronous ScreenCaptureKit per-frame capture',()=>{
  assert.match(swift,/private func checkLivePointerTarget\(\) throws/);
  const move=swift.split('private func movePointer(')[1].split('private func isOccluded(')[0];
  assert.match(move,/try checkLivePointerTarget\(\)/);
  assert.doesNotMatch(move,/try await currentWindow\(requireForeground: true\)/);
  assert.match(move,/CGEvent\(mouseEventSource: source, mouseType: \.mouseMoved/);
  assert.match(swift.split('private func checkLivePointerTarget() throws')[1].split('private func movePointer(')[0],/CGEvent\.tapIsEnabled/);
});
