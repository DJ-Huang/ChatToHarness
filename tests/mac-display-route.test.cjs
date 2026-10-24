'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

test('Mac human-speed cursor routes never cross empty space between monitors', {skip:process.platform!=='darwin',timeout:60000}, ()=>{
 const root=path.resolve(__dirname,'..');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cth-physical-cursor-route-'));
 try {
  const exe=path.join(tmp,'route-acceptance');
  const compile=spawnSync('swiftc',['-parse-as-library','native/MacCursorTrajectory.swift',
    'tests/mac-cursor-route-model.swift','-o',exe],{cwd:root,encoding:'utf8',timeout:50000});
  assert.equal(compile.status,0,compile.stderr||String(compile.error));
  const r=spawnSync(exe,[],{cwd:root,encoding:'utf8',timeout:6000});
  assert.equal(r.status,0,r.stderr||String(r.error));
  assert.match(r.stdout,/CursorRoute acceptance PASS/);
  const cases=r.stdout.match(/all 301 samples on-screen/g)||[];
  assert.equal(cases.length,4);
 } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});
