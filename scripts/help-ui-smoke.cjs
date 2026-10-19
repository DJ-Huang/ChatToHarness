'use strict';
// Visual/interaction check against the local static preview, in a disposable window.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const { _electron:electron }=require('playwright-core');
const root=path.resolve(__dirname,'..'),home=fs.mkdtempSync(path.join(os.tmpdir(),'cth-help-ui-'));
const output=path.join(root,'.cache/help-acceptance');fs.mkdirSync(output,{recursive:true});
const address=process.env.CTH_HELP_URL||'http://127.0.0.1:4173/ChatToHarness/';
const entry=path.join(home,'main.cjs');
fs.writeFileSync(entry,`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(home,'profile'))});app.setName('ChatToHarness Help Check');app.whenReady().then(()=>{const win=new BrowserWindow({width:1440,height:1100,enableLargerThanScreen:true,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});win.loadURL(${JSON.stringify(address+'docs/zh-CN/')});});app.on('window-all-closed',()=>app.quit());`);
async function main(){
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({executablePath:require('electron'),args:[entry],env});
  try{
    const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setViewportSize({width:1440,height:1100});
    for(const locale of ['zh-CN','en','ja']){
      await page.goto(address+'docs/'+locale+'/');await page.waitForSelector('.topic');
      assert.equal(await page.locator('.topic').count(),38);
      assert.equal(await page.locator('html').getAttribute('lang'),locale);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:path.join(output,`home-fold-${locale}.png`),scale:'css'});
      await page.screenshot({path:path.join(output,`home-${locale}.png`),fullPage:true,scale:'css'});
    }
    await page.goto(address+'docs/zh-CN/');await page.locator('#help-search').fill('后台任务');
    await page.waitForSelector('#search-results a');assert.ok(await page.locator('#search-results').textContent().then(text=>text.includes('启动、查看和取消后台任务')));
    await page.locator('#search-results a[href$="/background-tasks/"]').click();await page.waitForURL('**/background-tasks/');
    assert.equal(await page.locator('.prose h2').count(),6);
    await page.locator('.toc a[href="#steps"]').click();
    await page.locator('.languages a[lang="en"]').click();await page.waitForURL('**/docs/en/background-tasks/#steps');
    assert.ok((await page.locator('.prose h1').textContent()).includes('background tasks'));
    assert.ok((await page.locator('.source-link').getAttribute('href')).endsWith('/docs/en/background-tasks.md'));
    await page.locator('[data-zoom]').click();await page.waitForSelector('#image-dialog[open]');await page.keyboard.press('Escape');assert.equal(await page.locator('#image-dialog').isVisible(),false);
    await page.evaluate(()=>{navigator.clipboard.writeText=async text=>{window.__copiedExample=text;};});
    await page.locator('.copy-example').click();assert.ok(await page.evaluate(()=>window.__copiedExample.includes('persistent background task')));
    await page.screenshot({path:path.join(output,'article-en.png'),fullPage:true,scale:'css'});
    await page.setViewportSize({width:390,height:844});
    for(const locale of ['zh-CN','en','ja']){
      await page.goto(address+`docs/${locale}/first-connection/`);await page.waitForSelector('.prose h1');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,locale+' overflows on mobile');
      assert.equal(await page.locator('#topics-nav').isVisible(),false);
      await page.locator('#topics-toggle').click();assert.equal(await page.locator('#topics-nav').isVisible(),true);
      await page.locator('#topics-toggle').click();
      await page.screenshot({path:path.join(output,`mobile-${locale}.png`),fullPage:true,scale:'css'});
    }
    await page.route('**/search.json',route=>route.abort());await page.goto(address+'docs/ja/');await page.locator('#help-search').fill('test');await page.waitForFunction(()=>document.querySelector('#search-results').textContent.includes('検索を利用できません'));
    assert.equal(await page.locator('.topic').count(),38);
    assert.equal(errors.length,0,errors.join('\n'));
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({checked_at:new Date().toISOString(),articles_per_language:38,languages:['en','zh-CN','ja'],checks:['desktop and mobile layout','search','article-preserving language switch and section','image zoom and Escape','copy example without touching system clipboard','search failure leaves topic navigation available'],real_tunnel_call:false,errors},null,2)+'\n');
    console.log('Help UI checks passed: desktop, mobile, search, language, zoom, copy and offline navigation.');
  }finally{await app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(home,{recursive:true,force:true}));
