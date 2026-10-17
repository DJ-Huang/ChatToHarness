'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {deliver,sha}=require('../scripts/release.cjs');
function harness(t,mode='ok'){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cth-publish-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  for(const suffix of ['windows-x64-setup.exe','macos-arm64.dmg'])fs.writeFileSync(path.join(directory,'ChatToHarness-0.3.1-'+suffix),'synthetic '+suffix);
  const events=[],uploaded=[],bytes=new Map();let release,tagReads=0;
  if(mode==='published')release={id:1,tag_name:'v0.3.1',draft:false};
  if(mode==='existing-draft')release={id:1,tag_name:'v0.3.1',draft:true,body:'Maintainer-authored release notes.'};
  const route='repos/test/repo/releases/1';
  function request(url,body,method){
    if(url.includes('/commits/'))return {sha:mode==='moved-tag'&&++tagReads>1?'different':'commit'};
    if(url.endsWith('/generate-notes')){events.push('notes');return {body:'Generated commit changes'};}
    if(url==='repos/test/repo/releases'){
      assert.equal(body.draft,true,'initial release must stay private');events.push('create-draft');release={id:1,...body,html_url:'https://github.com/test/repo/releases/tag/v0.3.1'};return {...release};
    }
    assert.equal(url,route);
    if(method==='PATCH'){
      if(body.draft===false){assert.equal(uploaded.length,3);events.push('publish');release={...release,...body,published_at:'2026-10-17T00:00:00Z'};}
      else{events.push('update-notes');release={...release,...body};}
    }
    return {...release};
  }
  function run(args){
    if(args[0]==='release'){
      if(mode==='upload-fails')throw new Error('upload failed');
      const file=args[3],name=path.basename(file);events.push('upload:'+name);bytes.set(uploaded.length+1,fs.readFileSync(file));
      uploaded.push({id:uploaded.length+1,name,size:fs.statSync(file).size,digest:mode==='no-digests'?undefined:'sha256:'+sha(file)});return '';
    }
    if(args[1].includes('/assets?')){
      events.push('verify');const result=uploaded.map(a=>({...a}));
      if(mode==='bad-digest')result[0].digest='sha256:wrong';
      if(mode==='bad-size')result[0].size++;
      if(mode==='extra-asset')result.push({name:'unexpected.txt',size:1});
      return [result];
    }
    return [release?[release]:[]];
  }
  const options={repo:'test/repo',tag:'v0.3.1',appVersion:'0.3.1',directory,commitSha:'commit',runId:123,notes:'中文\nEnglish\n日本語',request,run,download:asset=>bytes.get(asset.id)};
  return {options,events,directory,current:()=>release};
}
test('publish only after both installers and checksums are verified, with release notes',t=>{
  const h=harness(t);const release=deliver(h.options);
  assert.equal(release.draft,false);assert.ok(release.published_at);
  assert.ok(h.events.indexOf('verify')<h.events.indexOf('publish'));
  assert.match(release.body,/中文\nEnglish\n日本語/);assert.match(release.body,/Generated commit changes/);
  assert.match(release.body,/Windows is unsigned/);assert.match(release.body,/Mac.*notarized/);
  assert.equal(fs.readFileSync(path.join(h.directory,'SHA256SUMS.txt'),'utf8').trim().split('\n').length,2);
});
test('failed upload, size, digest, unexpected assets, or moved tag never publish',async t=>{
  for(const mode of ['upload-fails','bad-size','bad-digest','extra-asset','moved-tag'])await t.test(mode,t=>{
    const h=harness(t,mode);assert.throws(()=>deliver(h.options));assert.equal(h.current().draft,true);assert.ok(!h.events.includes('publish'));
  });
});
test('published versions cannot be overwritten',t=>{
  const h=harness(t,'published');assert.throws(()=>deliver(h.options),/published/);assert.deepEqual(h.events,[]);
});
test('existing draft notes are retained and assets without server digests are downloaded and checked',t=>{
  const existing=harness(t,'existing-draft');assert.match(deliver(existing.options).body,/Maintainer-authored release notes/);
  const fallback=harness(t,'no-digests');assert.equal(deliver(fallback.options).draft,false);
});
