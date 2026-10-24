'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const {prepareDevelopmentApp}=require('../scripts/dev-app.cjs');

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cth-dev-app 中文 '));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const bundle=path.join(root,'node_modules/electron/dist/Electron.app');
  const binary=path.join(bundle,'Contents/MacOS/Electron');
  const info=path.join(bundle,'Contents/Info.plist');
  fs.mkdirSync(path.dirname(binary),{recursive:true});
  fs.writeFileSync(binary,'fixture');fs.chmodSync(binary,0o755);
  const original='<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleName</key><string>Electron</string><key>CFBundleDisplayName</key><string>Electron</string></dict></plist>';
  fs.writeFileSync(info,original);
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({build:{productName:'ChatToHarness'},devDependencies:{electron:'44.7.2'}}));
  // Electron's framework symlinks must remain relative in the cached copy.
  fs.symlinkSync('MacOS/Electron',path.join(bundle,'Contents/link'));
  let signatures=0,fail=false;
  const run=(command,args,options)=>{
    if(command==='/usr/bin/codesign'){
      if(args[0]==='--verify')return;
      signatures++;if(fail)throw new Error('fixture signing failure');
      for(const key of ['CFBundleName','CFBundleDisplayName'])assert.equal(execFileSync('/usr/bin/plutil',['-extract',key,'raw',path.join(args.at(-1),'Contents/Info.plist')],{encoding:'utf8'}).trim(),'ChatToHarness');
      return;
    }
    return execFileSync(command,args,options);
  };
  return {root,binary,info,original,run,get signatures(){return signatures;},fail(){fail=true;}};
}

test('macOS development bundle is named, signed, cached and leaves Electron dependency unchanged',{skip:process.platform!=='darwin'},t=>{
  const f=fixture(t);const options={root:f.root,binary:f.binary,run:f.run};
  const binary=prepareDevelopmentApp(options);
  assert.match(binary,/ChatToHarness\.app\/Contents\/MacOS\/Electron$/);
  assert.equal(fs.readFileSync(binary,'utf8'),'fixture');
  assert.equal(execFileSync('/usr/bin/plutil',['-extract','CFBundleIdentifier','raw',path.resolve(binary,'../../Info.plist')],{encoding:'utf8'}).trim(),'local.chattoharness.dev');
  assert.equal(fs.readlinkSync(path.resolve(binary,'../../link')),'MacOS/Electron');
  assert.equal(fs.readFileSync(f.info,'utf8'),f.original);assert.equal(f.signatures,1);
  assert.equal(prepareDevelopmentApp(options),binary);assert.equal(f.signatures,1);
  // A source change invalidates the cached native bundle.
  fs.appendFileSync(f.info,'\n');
  assert.notEqual(prepareDevelopmentApp(options),binary);assert.equal(f.signatures,2);
});

test('failed macOS bundle signing leaves no reusable receipt or staging directory',{skip:process.platform!=='darwin'},t=>{
  const f=fixture(t);f.fail();
  assert.throws(()=>prepareDevelopmentApp({root:f.root,binary:f.binary,run:f.run}),/signing failure/);
  assert.deepEqual(fs.readdirSync(path.join(f.root,'.cache/dev-electron')),[]);
  assert.equal(fs.readFileSync(f.info,'utf8'),f.original);
});

test('other platforms use the original executable without preparing a macOS bundle',()=>{
  assert.equal(prepareDevelopmentApp({binary:'C:\\Electron.exe',platform:'win32'}),'C:\\Electron.exe');
});
