#!/usr/bin/env node
'use strict';
// Opt-in, macOS-only real GUI acceptance. Never included in default npm test:
// it opens a disposable native window and actually sends mouse/keyboard events.
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
if(process.platform!=='darwin'||process.argv[2]!=='--confirm-real-gui-input'){
 console.error('macOS GUI acceptance must be invoked explicitly with --confirm-real-gui-input');
 process.exit(2);
}
const output=[
 '/tmp/cth-computer-use-gui-fixture',
 '/tmp/cth-computer-use-esc-fixture'
];
function run(bin,args,ms) {
 const result=spawnSync(bin,args,{cwd:root,stdio:'inherit',timeout:ms});
 if(result.error||result.signal||result.status!==0)
  throw Error(bin+' failed: '+(result.error?.message||result.signal||result.status));
}
try {
 console.log('This test moves the mouse and sends keys ONLY to a new disposable local GUI window.');
 console.log('No business application is used; Esc is sent only after verifying the fixture PID is foreground.');
 run('swiftc',['-parse-as-library','tests/mac-computer-use-gui-fixture.swift','-o',output[0]],60000);
 run('swiftc',['-parse-as-library','tests/mac-computer-use-esc-fixture.swift','-o',output[1]],60000);
 // Run native input before synthetic Esc, and isolate each GUI session in
 // its own test process to prevent global event-state contamination.
 run(process.execPath,['--test','tests/mac-native-gui-interaction.acceptance.cjs'],60000);
 run(process.execPath,['--test','tests/mac-emergency-esc-real.acceptance.cjs'],60000);
 console.log('Interactive Mac acceptance: PASS. Modifier shortcuts and STOP button remain separate gates.');
} catch(error) {
 console.error('Interactive Mac acceptance: FAIL',error.message);
 process.exitCode=1;
} finally {
 for(const bin of output)try{fs.unlinkSync(bin)}catch{}
}
