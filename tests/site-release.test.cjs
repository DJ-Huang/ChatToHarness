'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {releaseInfo,build}=require('../scripts/build-site.cjs');
const {version,requireDraft,assets}=require('../scripts/release.cjs');
function release(tag='v0.3.0',extra={}){return {tag_name:tag,draft:false,prerelease:false,assets:[`ChatToHarness-${tag.slice(1)}-windows-x64-setup.exe`,`ChatToHarness-${tag.slice(1)}-macos-arm64.dmg`,'SHA256SUMS.txt'].map(name=>({name,size:12345,browser_download_url:`https://github.com/DJ-Huang/ChatToHarness/releases/download/${tag}/${name}`})),...extra};}
test('site ignores draft and prerelease assets and handles an unpublished first version',()=>{assert.equal(releaseInfo([]).windows,null);assert.equal(releaseInfo([release('v9.0.0',{draft:true}),release('v8.0.0',{prerelease:true}),release()]).version,'0.3.0');});
test('site chooses newest stable semver and never invents unavailable platform files',()=>{assert.equal(releaseInfo([release('v0.9.0'),release('v0.10.0')]).version,'0.10.0');const info=releaseInfo([release('v0.3.0',{assets:[]})]);assert.equal(info.macos,null);assert.equal(info.checksum,null);});
test('release assets must come from the exact repository and release',()=>{const bad=release();bad.assets[0].browser_download_url='https://example.com/setup.exe';assert.throws(()=>releaseInfo([bad]),/Invalid/);});
test('public releases are immutable and version tags must match locks',()=>{assert.throws(()=>requireDraft({draft:false}),/published/);requireDraft({draft:true});const current=require('../package.json').version;assert.equal(version('v'+current),current);assert.throws(()=>version('v9999.0.0'),/tag/);});
test('draft assembly requires exactly both real nonempty native installers',t=>{const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cth-release-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));assert.throws(()=>assets(tmp,'0.3.0'));for(const suffix of ['windows-x64-setup.exe','macos-arm64.dmg'])fs.writeFileSync(path.join(tmp,'ChatToHarness-0.3.0-'+suffix),'fixture');assert.equal(assets(tmp,'0.3.0').length,2);fs.writeFileSync(path.join(tmp,'extra.exe'),'unexpected');assert.throws(()=>assets(tmp,'0.3.0'));});
test('site builds repository subpath links and disabled unpublished downloads',t=>{const output=fs.mkdtempSync(path.join(os.tmpdir(),'cth-site-'));t.after(()=>fs.rmSync(output,{recursive:true,force:true}));build([],output);const html=fs.readFileSync(path.join(output,'index.html'),'utf8');assert.match(html,/\/ChatToHarness\/assets\/console-en.png/);assert.match(html,/Not yet released/);assert.doesNotMatch(html,/releases\/download/);assert.doesNotMatch(html,/\{\{\w+\}\}/);assert.ok(fs.existsSync(path.join(output,'sitemap.xml')));});

test('all website languages have matching screenshots, docs, download states and canonical routes',t=>{
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'cth-site-languages-'));t.after(()=>fs.rmSync(output,{recursive:true,force:true}));
  for(const published of [false,true]){
    build(published?[release()]:[],output);
    for(const locale of ['zh-CN','en','ja']){
      const folder=locale==='en'?'':locale+'/';
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


test('English is the static default, old English links work, and locale discovery is consistent',t=>{
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'cth-site-default-'));
  t.after(()=>fs.rmSync(output,{recursive:true,force:true}));
  build([],output);
  const html=fs.readFileSync(path.join(output,'index.html'),'utf8');
  assert.match(html,/<html lang="en">/);
  assert.match(html,/Not yet released/);
  assert.doesNotMatch(html,/暂未发布/);
  assert.equal(fs.readFileSync(path.join(output,'en/index.html'),'utf8'),html);
  const sitemap=fs.readFileSync(path.join(output,'sitemap.xml'),'utf8');
  for(const [locale,folder] of [['en',''],['zh-CN','zh-CN/'],['ja','ja/']]){
    const page=fs.readFileSync(path.join(output,folder,'index.html'),'utf8');
    assert.ok(page.includes(`<html lang="${locale}">`));
    assert.ok(page.includes(`data-language="${locale}" aria-current="page"`));
    assert.ok(html.includes(`href="/ChatToHarness/${folder}" lang="${locale}"`));
    assert.ok(html.includes(`hreflang="${locale}" href="https://dj-huang.github.io/ChatToHarness/${folder}"`));
    assert.ok(sitemap.includes(`<loc>https://dj-huang.github.io/ChatToHarness/${folder}</loc>`));
  }
  assert.doesNotMatch(sitemap,/<loc>https:\/\/dj-huang\.github\.io\/ChatToHarness\/en\/<\/loc>/);
});

function runLanguagePage({saved=null,pathname='/ChatToHarness/',lang='en',storageBlocked=false}={}){
  const redirects=[],writes=[];
  const links=['en','zh-CN','ja'].map(language=>({
    dataset:{language},hash:'',listeners:{},
    addEventListener(event,callback){this.listeners[event]=callback;}
  }));
  require('node:vm').runInNewContext(fs.readFileSync(path.join(__dirname,'../site/language.js'),'utf8'),{
    navigator:{language:'zh-CN',languages:['zh-CN','en']},
    location:{pathname,search:'?source=test',hash:'#download',replace(url){redirects.push(url);}},
    document:{documentElement:{lang},querySelectorAll(){return links;}},
    localStorage:{
      getItem(key){assert.equal(key,'chatharness-language');if(storageBlocked)throw new Error('Storage blocked');return saved;},
      setItem(key,value){if(storageBlocked)throw new Error('Storage blocked');writes.push([key,value]);}
    }
  });
  return {redirects,writes,links};
}

test('first visits default to English, saved choices restore, and explicit locale URLs win',()=>{
  for(const saved of [null,'','en','fr','__proto__','constructor']){
    const result=runLanguagePage({saved});
    assert.deepEqual(result.redirects,[],`Unexpected redirect for ${saved}`);
    assert.deepEqual(result.writes,[]);
  }
  for(const locale of ['zh-CN','ja']){
    for(const pathname of ['/ChatToHarness/','/ChatToHarness/index.html']){
      assert.deepEqual(runLanguagePage({saved:locale,pathname}).redirects,[`/ChatToHarness/${locale}/?source=test#download`]);
    }
  }
  for(const [pathname,lang] of [['/ChatToHarness/en/','en'],['/ChatToHarness/zh-CN/','zh-CN'],['/ChatToHarness/ja/','ja']]){
    const result=runLanguagePage({pathname,lang,saved:lang==='ja'?'zh-CN':'ja'});
    assert.deepEqual(result.redirects,[]);
    assert.deepEqual(result.writes,[['chatharness-language',lang]]);
  }
});

test('language links save explicit choices and keep sections even when storage is blocked',()=>{
  for(const storageBlocked of [false,true]){
    const result=runLanguagePage({storageBlocked});
    assert.deepEqual(result.redirects,[]);
    for(const link of result.links){
      link.listeners.click();
      assert.equal(link.hash,'#download');
    }
    assert.deepEqual(result.writes,storageBlocked?[]:['en','zh-CN','ja'].map(locale=>['chatharness-language',locale]));
  }
});
