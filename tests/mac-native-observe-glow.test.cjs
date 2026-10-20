'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const helper = path.join(root, 'resources/computer-use/ChatToHarness.MacComputerUse');
const sources = ['native/MacComputerUse.swift','native/MacCursorGlow.swift'].map(file =>
  fs.readFileSync(path.join(root,file),'utf8'));
function invoke(...args) {
  const p = spawnSync(helper,args,{encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
  assert.equal(p.status,0,p.stderr || String(p.error || p.signal));
  return JSON.parse(p.stdout.trim());
}
test('real macOS app-window screenshot returns bounded PNG dimensions without disk persistence',{skip:process.platform!=='darwin'}, t => {
  const permissions = invoke('permission_status');
  if (!permissions.screen_recording) return t.skip('Screen Recording TCC permission not granted');
  const listed = invoke(String(process.pid),'list_windows','0');
  assert.ok(Array.isArray(listed.windows));
  // Avoid capturing unrelated user documents; observe only our own harness window.
  const own = listed.windows.find(w=>w.title==='ChatToHarness');
  if (!own) return t.skip('No ChatToHarness window currently visible');
  const checked = invoke(String(process.pid),'probe_window',own.window_id);
  assert.equal(checked.ok,true);
  assert.equal(checked.window_id,own.window_id);
  assert.ok(checked.width>0 && checked.width<=4096);
  assert.ok(checked.height>0 && checked.height<=4096);
  assert.ok(checked.png_bytes>128 && checked.png_bytes<40*1024*1024);
  assert.equal(checked.geometry.length,4);
  assert.ok(checked.geometry[2]>checked.geometry[0]);
  assert.ok(checked.geometry[3]>checked.geometry[1]);
});
test('macOS glow derives transparency mask from true cursor image and does not fabricate cursor rings',()=>{
  assert.match(sources[1],/NSCursor\.currentSystem/);
  assert.match(sources[1],/cursor\.hotSpot/);
  assert.match(sources[1],/mask\[y \* width \+ x\]/);
  assert.match(sources[1],/window\.ignoresMouseEvents = true/);
  assert.doesNotMatch(sources[1],/DrawIconEx|clickRing|locatorCircle/);
  assert.match(sources[0],/private let cursorGlow = MacCursorGlow\(\)/);
  assert.match(sources[0],/Timer\.scheduledTimer\(withTimeInterval: 0\.033/);
  assert.match(sources[0],/cursorGlow\.stop\(\)/);
});
