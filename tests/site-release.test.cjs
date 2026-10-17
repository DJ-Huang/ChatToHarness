'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {releaseInfo,build}=require('../scripts/build-site.cjs');
const {version,requireDraft,assets}=require('../scripts/release.cjs');
function release(tag='v0.3.0',extra={}){return {tag_name:tag,draft:false,prerelease:false,assets:[`ChatToHarness-${tag.slice(1)}-windows-x64-setup.exe`,`ChatToHarness-${tag.slice(1)}-macos-arm64.dmg`,'SHA256SUMS.txt'].map(name=>({name,size:12345,browser_download_url:`https://github.com/DJ-Huang/ChatToHarness/releases/download/${tag}/${name}`})),...extra};}
test('site ignores draft and prerelease assets and handles an unpublished first version',()=>{assert.equal(releaseInfo([]).windows,null);assert.equal(releaseInfo([release('v9.0.0',{draft:true}),release('v8.0.0',{prerelease:true}),release()]).version,'0.3.0');});
test('site chooses newest stable semver and never invents unavailable platform files',()=>{assert.equal(releaseInfo([release('v0.9.0'),release('v0.10.0')]).version,'0.10.0');const info=releaseInfo([release('v0.3.0',{assets:[]})]);assert.equal(info.macos,null);assert.equal(info.checksum,null);});
test('release assets must come from the exact repository and release',()=>{const bad=release();bad.assets[0].browser_download_url='https://example.com/setup.exe';assert.throws(()=>releaseInfo([bad]),/Invalid/);});
test('public releases are immutable and version tags must match locks',()=>{assert.throws(()=>requireDraft({draft:false}),/published/);requireDraft({draft:true});assert.equal(version('v0.3.0'),'0.3.0');assert.throws(()=>version('v0.3.1'),/tag/);});
test('draft assembly requires exactly both real nonempty native installers',t=>{const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cth-release-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));assert.throws(()=>assets(tmp,'0.3.0'));for(const suffix of ['windows-x64-setup.exe','macos-arm64.dmg'])fs.writeFileSync(path.join(tmp,'ChatToHarness-0.3.0-'+suffix),'fixture');assert.equal(assets(tmp,'0.3.0').length,2);fs.writeFileSync(path.join(tmp,'extra.exe'),'unexpected');assert.throws(()=>assets(tmp,'0.3.0'));});
test('site builds repository subpath links and disabled unpublished downloads',t=>{const output=fs.mkdtempSync(path.join(os.tmpdir(),'cth-site-'));t.after(()=>fs.rmSync(output,{recursive:true,force:true}));build([],output);const html=fs.readFileSync(path.join(output,'index.html'),'utf8');assert.match(html,/\/ChatToHarness\/assets\/console-zh-CN.png/);assert.match(html,/暂未发布/);assert.doesNotMatch(html,/releases\/download/);assert.doesNotMatch(html,/\{\{\w+\}\}/);assert.ok(fs.existsSync(path.join(output,'sitemap.xml')));});

test('all website languages have matching screenshots, docs, download states and canonical routes',t=>{
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'cth-site-languages-'));t.after(()=>fs.rmSync(output,{recursive:true,force:true}));
  for(const published of [false,true]){
    build(published?[release()]:[],output);
    for(const locale of ['zh-CN','en','ja']){
      const folder=locale==='zh-CN'?'':locale+'/';
      const html=fs.readFileSync(path.join(output,folder,'index.html'),'utf8');
      assert.ok(html.includes(`<html lang="${locale}">`));
      assert.ok(html.includes(`assets/console-${locale}.png`));
      assert.ok(html.includes(`docs/${locale}/GUIDE.md`));
      assert.ok(html.includes(`rel="canonical" href="https://dj-huang.github.io/ChatToHarness/${folder}"`));
      assert.equal((html.match(/data-language=/g)||[]).length,3);
      assert.doesNotMatch(html,/\{\{\w+\}\}/);
      if(locale==='en')assert.ok(html.includes(published?'Download for Windows':'Not yet released'));
      if(locale==='ja')assert.ok(html.includes(published?'Windows 版をダウンロード':'未公開'));
      if(published)assert.match(html,/releases\/download\/v0.3.0/);
    }
  }
});
