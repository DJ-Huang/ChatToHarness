'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');

const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function put(root,name,body,executable=false) {
  const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);
  if(executable)fs.chmodSync(file,0o755);return file;
}

test('POSIX development bootstrap verifies and reuses Node while releasing its preparation lock before runtime',
  {skip:process.platform==='win32',timeout:15000},t=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'cth-bootstrap 中文 '));
    t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const payload=path.join(root,'payload'),archiveName='node-v24.22.0-darwin-arm64.tar.gz';
    const fakeNode=put(payload,'node-v24.22.0-darwin-arm64/bin/node',String.raw`#!/bin/bash
set -euo pipefail
if [[ "$*" == "scripts/dev.cjs --prepare-only" ]]; then
  [[ -d "$PWD/.cache/start.lock" ]] || exit 71
  [[ -f "$PWD/resources/node/.chatharness-node.json" ]] || exit 72
  printf 'prepare:locked\n' >> "$BOOTSTRAP_TEST_LOG"
elif [[ "$*" == "scripts/dev.cjs" ]]; then
  [[ ! -e "$PWD/.cache/start.lock" ]] || exit 73
  printf 'runtime:unlocked\n' >> "$BOOTSTRAP_TEST_LOG"
else
  printf 'unexpected-node-command:%s\n' "$*" >> "$BOOTSTRAP_TEST_LOG"
  exit 74
fi
`,true);
    const archive=path.join(root,'.cache','downloads',archiveName);fs.mkdirSync(path.dirname(archive),{recursive:true});
    execFileSync('/usr/bin/tar',['-czf',archive,'-C',payload,'node-v24.22.0-darwin-arm64']);
    const digest=sha(archive),nodeDigest=sha(fakeNode);
    const source=fs.readFileSync(path.resolve(__dirname,'../Start.sh'),'utf8');
    assert.match(source,/^NODE_SHA="[a-f0-9]{64}"$/m);
    const launcher=put(root,'Start.sh',source.replace(/^NODE_SHA="[a-f0-9]{64}"$/m,`NODE_SHA="${digest}"`),true);
    put(root,'package-lock.json','fixture dependencies\n');put(root,'node_modules/.localharness-lock','fixture dependencies\n');
    put(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron','#!/bin/sh\nexit 0\n',true);
    const tools=path.join(root,'fake-tools');
    put(tools,'uname','#!/bin/sh\ncase "$1" in -s) echo Darwin;; -m) echo arm64;; *) exit 1;; esac\n',true);
    put(tools,'sw_vers','#!/bin/sh\necho 14.0\n',true);
    for(const name of ['curl','npm','open'])put(tools,name,`#!/bin/sh\nprintf 'unexpected-${name}\\n' >> "$BOOTSTRAP_TEST_LOG"\nexit 88\n`,true);
    const log=path.join(root,'invocations.log');
    const env={...process.env,PATH:tools+path.delimiter+(process.env.PATH || '/usr/bin:/bin'),BOOTSTRAP_TEST_LOG:log};
    const start=()=>execFileSync('/bin/bash',[launcher,'--dev'],{cwd:root,env,encoding:'utf8',timeout:10000});
    const first=start();assert.match(first,/首次启动：正在准备经过校验的 Node/);
    const receiptFile=path.join(root,'resources','node','.chatharness-node.json');
    const receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
    assert.deepEqual(receipt,{platform:'darwin-arm64',archiveSha256:digest,binarySha256:nodeDigest});
    const binary=path.join(root,'resources','node','bin','node');const identity=fs.statSync(binary);
    // With no archive and a failing download shim, a second successful launch
    // proves that the verified bootstrap receipt reuses the installed runtime.
    fs.unlinkSync(archive);
    const second=start();assert.doesNotMatch(second,/首次启动：正在准备经过校验的 Node/);
    assert.equal(fs.statSync(binary).ino,identity.ino);assert.equal(sha(binary),nodeDigest);
    assert.equal(fs.existsSync(path.join(root,'.cache','start.lock')),false);
    assert.deepEqual(fs.readFileSync(log,'utf8').trim().split('\n'),[
      'prepare:locked','runtime:unlocked','prepare:locked','runtime:unlocked'
    ]);
    assert.equal(fs.existsSync(path.join(root,'dist')),false);
  });
