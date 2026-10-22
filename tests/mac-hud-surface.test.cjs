'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const os=require('node:os');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
test('macOS HUD has WCAG AAA contrast and a continuously orbiting cyan rounded border', {
  skip:process.platform!=='darwin',timeout:60000
},()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cth-hud-acceptance-'));
  try{
    const bin=path.join(temp,'check-hud');
    const compilation=spawnSync('swiftc',['-parse-as-library',
      path.join(root,'native/MacHUDSurface.swift'),
      path.join(root,'tests/mac-hud-surface-acceptance.swift'),
      '-o',bin],{encoding:'utf8',timeout:45000});
    assert.equal(compilation.status,0,compilation.stderr||String(compilation.error));
    const result=spawnSync(bin,[],{encoding:'utf8',timeout:10000});
    assert.equal(result.status,0,result.stderr||String(result.error));
    const report=JSON.parse(result.stdout.trim());
    assert.equal(report.pass,true);
    assert.equal(report.border_animation,'lineDashPhase');
    assert.equal(report.orbit_seconds_per_lap,3.5);
    assert.equal(report.resizes_with_hud,true);
    for(const item of ['title','session','activity'])
      assert.ok(report.contrast_worst_case_light_desktop[item]>=7,item+' must exceed WCAG AAA');
  }finally{fs.rmSync(temp,{recursive:true,force:true})}
});
