'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {build}=require('../scripts/build-site.cjs');
const {expectedTag,prepareDeployment}=require('../scripts/site-deployment.cjs');
const {validatePage,verifySite}=require('../scripts/verify-site.cjs');
function release(version){return {tag_name:'v'+version,draft:false,prerelease:false,assets:[`ChatToHarness-${version}-windows-x64-setup.exe`,`ChatToHarness-${version}-macos-arm64.dmg`,'SHA256SUMS.txt'].map(name=>({name,size:12345,browser_download_url:`https://github.com/DJ-Huang/ChatToHarness/releases/download/v${version}/${name}`}))};}
const old=release('0.3.1'),current=release('0.4.0');

test('main content updates use the newest public stable metadata without requiring a new release',async()=>{
  const options={load:async()=>[old],eventName:'push',ref:'refs/heads/main'};
  assert.equal((await prepareDeployment(options)).info.version,'0.3.1');
  assert.equal((await prepareDeployment({...options,load:async()=>[current,old]})).info.version,'0.4.0');
  assert.equal((await prepareDeployment({...options,eventName:'workflow_dispatch'})).info.version,'0.3.1');
});

test('main build remains successful with public downloads when package version is ahead',t=>{
  const {spawnSync}=require('node:child_process');
  const root=path.resolve(__dirname,'..');
  assert.notEqual(require('../package.json').version,'0.3.1');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cth-main-site-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const fixture=path.join(directory,'releases.json'),event=path.join(directory,'event.json'),output=path.join(directory,'outputs');
  fs.writeFileSync(fixture,JSON.stringify([old]));fs.writeFileSync(event,'{}');
  const result=spawnSync(process.execPath,[path.join(root,'scripts/build-site.cjs'),'--fixture',fixture],{cwd:root,encoding:'utf8',env:{...process.env,GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_PATH:event,GITHUB_OUTPUT:output}});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/Website built: 0\.3\.1/);
  assert.equal(fs.readFileSync(output,'utf8'),'version=0.3.1\n');
  for(const route of ['','en','ja'])validatePage(fs.readFileSync(path.join(root,'dist/site',route,'index.html'),'utf8'),'0.3.1');
});

test('release caller waits for public installers and never silently deploys the old stable version',async()=>{
  const pending={...current,assets:current.assets.slice(0,1)};
  const responses=[[old],[{...current,draft:true},old],[pending,old],[current,old]];
  let loads=0,waits=0;
  const options={load:async()=>responses[loads++],eventName:'push',ref:'refs/tags/v0.4.0',wait:async()=>{waits++;}};
  assert.equal((await prepareDeployment(options)).info.version,'0.4.0');
  assert.equal(loads,4);assert.equal(waits,3);
  await assert.rejects(prepareDeployment({...options,load:async()=>[old],attempts:2}),/refusing to deploy older/);
  assert.equal(expectedTag('release','',{action:'published',release:current}),'v0.4.0');
  assert.equal(expectedTag('release','',{action:'deleted',release:current}),'');
  assert.equal(expectedTag('release','',{action:'published',release:{...current,prerelease:true}}),'');
});

test('an old release event cannot downgrade downloads when a newer stable release exists',async()=>{
  const result=await prepareDeployment({load:async()=>[current,old],eventName:'push',ref:'refs/tags/v0.3.1'});
  assert.equal(result.info.version,'0.4.0');
});

test('production smoke check catches stale locales, missing assets and stale displayed versions',async t=>{
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'cth-site-deployment-'));
  t.after(()=>fs.rmSync(output,{recursive:true,force:true}));
  build([current],output);
  const pages=['','en/','ja/'].map(route=>fs.readFileSync(path.join(output,route,'index.html'),'utf8'));
  for(const html of pages){
    validatePage(html,'0.4.0');
    assert.throws(()=>validatePage(html.replaceAll('0.4.0','0.3.1'),'0.4.0'),/stale/);
    assert.throws(()=>validatePage(html.replace('SHA256SUMS.txt','missing.txt'),'0.4.0'),/stale/);
    assert.throws(()=>validatePage(html.replaceAll('<span>v0.4.0 ','<span>v0.3.1 '),'0.4.0'),/displayed/);
    assert.throws(()=>validatePage(html.replace('<span>v0.4.0 ','<span>v0.3.1 '),'0.4.0'),/displayed/);
  }
  let requests=0,waits=0;const seen=new Set();
  const request=async url=>{
    const parsed=new URL(url);seen.add(parsed.searchParams.has('release-check'));
    const index=parsed.pathname.endsWith('/en/')?1:parsed.pathname.endsWith('/ja/')?2:0;
    requests++;
    const html=waits===0&&index===1?pages[index].replaceAll('0.4.0','0.3.1'):pages[index];
    return {ok:true,text:async()=>html};
  };
  await verifySite('0.4.0',{request,attempts:2,wait:async()=>{waits++;},report:()=>{}});
  assert.equal(waits,1);assert.equal(requests,11);assert.equal(seen.size,2);
  await assert.rejects(verifySite('0.4.0',{request:async()=>({ok:false,status:503}),attempts:1,report:()=>{}}),/production is inconsistent/);
});
