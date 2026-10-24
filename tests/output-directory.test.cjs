'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {outputDirectory}=require('../scripts/output-directory.cjs');
const root=path.resolve(__dirname,'..');
test('default installer layout remains backward compatible',()=>{
  assert.equal(outputDirectory(root,{}),path.join(root,'dist'));
});
test('release build can use isolated output without mutating running dist/mac-arm64',()=>{
  assert.equal(outputDirectory(root,{CTH_DIST_SUBDIR:'0.7.2'}),path.join(root,'dist','0.7.2'));
});
test('build output subdir never escapes dist',()=>{
  for(const name of ['..','.', '../outside','nested/name','a\\b','','__']) {
    if(!name)continue;
    assert.throws(()=>outputDirectory(root,{CTH_DIST_SUBDIR:name}),/CTH_DIST_SUBDIR/);
  }
});
