'use strict';
// Real Electron IPC and authentication, with isolated settings and a local Tunnel fixture.
const {_electron:electron}=require('playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),net=require('node:net');
const {start}=require('../tests/fixtures/auth-proxies.cjs');
const root=path.resolve(__dirname,'..'),output=path.resolve(process.env.CTH_SMOKE_OUTPUT||path.join(root,'.cache/acceptance/proxy-auth-ui-20261025'));
const isolated=fs.mkdtempSync(path.join(os.tmpdir(),'cth-proxy-auth-ui-')),argsFile=path.join(isolated,'args.json');
const explicit=process.env.CTH_EXECUTABLE,development=process.argv.includes('--dev');
const executable=explicit||(development?require('electron'):process.platform==='win32'?path.join(root,'dist/win-unpacked/ChatToHarness.exe'):path.join(root,'dist/mac-arm64/ChatToHarness.app/Contents/MacOS/ChatToHarness'));
const launchArgs=development?[root]:[];
const env={...process.env,LOCALHARNESS_HOME:isolated,LOCALHARNESS_TEST_MODE:'1',LOCALHARNESS_TEST_LOCALE:'zh-CN',LOCALHARNESS_TEST_TUNNEL_SCRIPT:path.join(root,'tests/fixtures/proxy-ui-tunnel.cjs'),CTH_PROXY_UI_ARGS:argsFile};
if(launchArgs.length)env.LOCALHARNESS_RESOURCES=path.join(root,'resources');else delete env.LOCALHARNESS_RESOURCES;delete env.ELECTRON_RUN_AS_NODE;
let app,page;const errors=[],password='s@fe:/?#secret';let httpProxy,socksProxy,target;
const state=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('window.localHarness.getState()'));
async function launch(){app=await electron.launch({executablePath:executable,args:launchArgs,env,timeout:60000});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('body[data-initialized="true"]');assert.equal((await state()).testMode,true);}
async function open(){await page.locator('#nav-connection').click();await page.locator('#open-proxy-settings').click();}
async function testConnection(){await page.locator('#proxy-test').click();await page.waitForFunction(()=>!document.getElementById('proxy-test').disabled&&document.getElementById('proxy-test-result').textContent.length>0);return page.locator('#proxy-test-result').textContent();}
async function save(){await page.locator('#proxy-save').click();await page.waitForFunction(()=>!document.getElementById('proxy-save').disabled&&document.getElementById('action-message').textContent.includes('已保存'));}
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  try{
    httpProxy=await start('http');socksProxy=await start('socks5');target=http.createServer((req,res)=>{res.writeHead(200);res.end();});await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));
    await launch();await open();assert.equal(await page.locator('#proxy-mode-direct').isChecked(),true);
    assert.equal(await page.locator('#page-description').isVisible(),false);
    assert.equal(await page.locator('.page-header #back-to-connection').isVisible(),true);
    assert.equal(await page.locator('#panel-proxy h2').count(),0);assert.equal(await page.locator('#proxy-auth').count(),0);
    const modeBoxes=await Promise.all(['direct','system','manual'].map(mode=>page.locator('#proxy-mode-'+mode).boundingBox()));
    assert.ok(modeBoxes.every(box=>Math.abs(box.y-modeBoxes[0].y)<2),'proxy mode choices share one row');
    await page.locator('#proxy-mode-manual').check();assert.equal(await page.locator('#proxy-manual-fields').isVisible(),true);
    const userBox=await page.locator('#proxy-username').boundingBox(),passwordBox=await page.locator('#proxy-password').boundingBox();
    assert.ok(Math.abs(userBox.y-passwordBox.y)<2,'optional credentials share one row');
    assert.equal(await page.locator('#proxy-username').getAttribute('required'),null);assert.equal(await page.locator('#proxy-password').getAttribute('required'),null);
    const hintBox=await page.locator('#proxy-bypass-hint').boundingBox(),listBox=await page.locator('#proxy-bypass').boundingBox();assert.ok(hintBox.y+hintBox.height<=listBox.y);
    await save();assert.equal((await state()).settings.proxy.authEnabled,false,'blank optional credentials do not enable authentication');
    await page.locator('#proxy-host').fill('127.0.0.1');await page.locator('#proxy-port').fill(String(httpProxy.port));assert.equal(await page.locator('#proxy-auth-fields').isVisible(),true);
    await page.locator('#proxy-username').fill('proxy-user');await page.locator('#proxy-password').fill('wrong');await page.locator('#proxy-test-url').fill('http://destination.invalid/check');
    const before=JSON.stringify((await state()).settings);assert.match(await testConnection(),/认证失败/);assert.equal(JSON.stringify((await state()).settings),before);
    await page.locator('#proxy-password').fill(password);assert.match(await testConnection(),/连接成功/);
    await page.locator('#proxy-show-password').click();assert.equal(await page.locator('#proxy-password').getAttribute('type'),'text');assert.equal(await page.locator('#proxy-show-password').getAttribute('aria-pressed'),'true');await page.locator('#proxy-show-password').click();assert.equal(await page.locator('#proxy-password').getAttribute('type'),'password');
    await page.locator('#proxy-password').press('Enter');await page.waitForFunction(()=>!document.getElementById('proxy-save').disabled&&document.getElementById('action-message').textContent.includes('已保存'));
    assert.equal((await state()).settings.keySaved,false);assert.equal(fs.existsSync(argsFile),false,'Enter in proxy settings must save without connecting');
    assert.equal(await page.locator('#proxy-password').inputValue(),'');assert.equal((await state()).settings.proxy.passwordSaved,true);
    assert.ok(!JSON.stringify(await state()).includes(password));assert.ok(!fs.readFileSync(path.join(isolated,'settings.json'),'utf8').includes(password));
    assert.match(await testConnection(),/连接成功/);
    await page.locator('#proxy-password').fill('unsaved-password');await page.locator('#proxy-cancel').click();await open();assert.equal(await page.locator('#proxy-password').inputValue(),'');assert.match(await testConnection(),/连接成功/);
    await page.locator('#proxy-type').selectOption('socks5');await page.locator('#proxy-port').fill(String(socksProxy.port));await page.locator('#proxy-password').fill(password);assert.match(await testConnection(),/连接成功/);await save();
    await page.locator('#proxy-bypass-local').uncheck();assert.ok(!(await page.locator('#proxy-bypass').inputValue()).split('\n').includes('localhost'));
    await page.locator('#proxy-bypass-lan').uncheck();await page.locator('#proxy-bypass').fill('127.0.0.0/8');await page.locator('#proxy-test-url').fill('http://127.0.0.1:'+target.address().port);
    const accepted=socksProxy.accepted;assert.match(await testConnection(),/直连/);assert.equal(socksProxy.accepted,accepted);
    await page.locator('#proxy-cancel').click();await open();
    await page.screenshot({path:path.join(output,'proxy-auth-settings.png'),fullPage:true});
    for(const locale of ['en','ja','zh-CN']){await page.locator('#language-select').selectOption(locale);await page.waitForFunction(value=>document.documentElement.lang===value,locale);assert.equal(await page.locator('#proxy-auth-fields').isVisible(),true);}
    await page.locator('#back-to-connection').click();await page.locator('#tunnel-id').fill('tunnel_'+'a'.repeat(32));await page.locator('#api-key').fill('synthetic-runtime-key');await page.locator('#save-connect').click();
    await page.waitForFunction(()=>document.getElementById('status-label').textContent==='通道就绪',{},{timeout:30000});
    const report=JSON.parse(fs.readFileSync(argsFile,'utf8'));assert.ok(report.args.includes('env:CONTROL_PLANE_HTTP_PROXY'));assert.ok(!JSON.stringify(report).includes(password));assert.ok(report.proxyEndpoint.startsWith('127.0.0.1:'));
    await open();await page.locator('#proxy-password').fill(password+'-changed');await save();assert.equal((await state()).runtime.state,'stopped','password-only replacement must stop the old connection');
    const bridgeClosed=await new Promise(resolve=>{const socket=net.connect(Number(report.proxyEndpoint.split(':')[1]),'127.0.0.1');socket.once('connect',()=>{socket.destroy();resolve(false);});socket.once('error',()=>resolve(true));});assert.equal(bridgeClosed,true);
    await page.locator('#proxy-password').fill(password);await save();
    await app.close();app=null;await launch();await open();assert.equal(await page.locator('#proxy-password').inputValue(),'');assert.equal((await state()).settings.proxy.passwordSaved,true);
    await page.locator('#proxy-test-url').fill('http://destination.invalid/check');assert.match(await testConnection(),/连接成功/);
    await page.locator('#proxy-password').fill('temporary');await page.locator('#proxy-password').fill('');await save();assert.equal((await state()).settings.proxy.passwordSaved,false);await app.close();app=null;await launch();await open();assert.equal((await state()).settings.proxy.passwordSaved,false);assert.match(await testConnection(),/填写代理密码/);
    await page.locator('#proxy-password').fill(password);await page.locator('#proxy-cancel').click();await open();assert.equal(await page.locator('#proxy-password').inputValue(),'');assert.deepEqual(errors,[]);
    await app.close();app=null;
    const result={passed:true,packaged:launchArgs.length===0,executable,checks:['compact annotated layout','top return button','mode choices in one row','optional credentials without auth toggle','blank credentials disable auth','wrong password','test never saves','real HTTP and SOCKS5 auth','password show/hide','encrypted remember','Enter saves without connecting','cancel discards secrets','bypass checkboxes and direct route','three locales','runtime proxy environment reference','SOCKS bridge launch','password-only change stops old connection','bridge cleanup','restart remembered credentials','clearing saved password','no renderer errors','app closed'],remoteTunnel:'local fixture'};
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{if(app)await app.close();await httpProxy?.close();await socksProxy?.close();if(target){target.closeAllConnections();await new Promise(resolve=>target.close(resolve));}fs.rmSync(isolated,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
})().catch(e=>{console.error(e);process.exitCode=1;});
