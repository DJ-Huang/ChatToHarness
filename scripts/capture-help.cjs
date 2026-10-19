'use strict';
// Capture the real app HTML/renderer in a disposable Electron window. No real
// profile, keychain, server, tool or tunnel is opened. Every image discloses this.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const { _electron:electron }=require('playwright-core');
const root=path.resolve(__dirname,'..');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cth-help-capture-'));
const output=path.join(root,'docs/images/help');
const setup=path.join(directory,'main.cjs'),preload=path.join(directory,'preload.cjs');
const {translate}=require('../app/i18n.js');
const locale=process.argv[2]||'zh-CN';
if(!['en','zh-CN','ja'].includes(locale))throw new Error('Invalid locale');
fs.mkdirSync(path.join(output,locale),{recursive:true});
const state={settings:{tunnelId:'tunnel_demo_documentation',directories:['/Users/demo/ExampleProject'],keySaved:true,autoConnect:true,autoProjectContext:true},runtime:{state:'ready',localReady:true,toolsCount:45,error:''},system:{locale,platform:'darwin'},versions:{app:'0.6.0',node:'24.22.0',tunnel:'demo',desktopCommander:'demo'},updates:{current:'0.6.0',phase:'current',automatic:true},mcp:{servers:[{id:'example',name:'Example service',transport:'stdio',command:'/path/to/example-server',args:[],env:{},enabled:true,trusted:true,phase:'ready',protocolVersion:'2025-11-25',tools:[{name:'project_summary',description:'Read a project summary (demonstration)',policy:'ask',inputSchema:{type:'object',properties:{project_path:{type:'string'}}}},{name:'create_note',description:'Create a note (demonstration)',policy:'deny',inputSchema:{type:'object',properties:{text:{type:'string'}}}}]}],approvals:[],toolsVersion:1,allowAllTools:false},testMode:true};
const records=[{request_id:'demo-read-001',tool:'get_project_overview',operation:'read',project:'/Users/demo/ExampleProject',service:'built-in',state:'succeeded',delivery:'local_write_succeeded',duration_ms:42,received_at:'2026-10-19T02:00:00Z'},{request_id:'demo-task-002',tool:'start_task',operation:'task',project:'/Users/demo/ExampleProject',service:'built-in',state:'running',delivery:'local_write_succeeded',duration_ms:120,received_at:'2026-10-19T02:01:00Z'}];
fs.writeFileSync(preload,`const {contextBridge}=require('electron');let state=${JSON.stringify(state)},listener;const records=${JSON.stringify(records)};const api={getState:async()=>state,onState:fn=>{listener=fn;return()=>{};},onShowUpdates:()=>()=>{},setLanguage:async locale=>{state.system.locale=locale;listener?.(state);return state;},readLiveLogs:async()=>({entries:[{id:'demo-log-1',at:'2026-10-19T02:00:00Z',category:'connection',event:'connection.ready',message:'Demonstration connection ready',fields:{}},{id:'demo-log-2',at:'2026-10-19T02:01:00Z',category:'tool',event:'execution',message:'get_project_overview',fields:{tool:'get_project_overview',state:'succeeded',delivery:'local_write_succeeded'}}],cursor:'demo:2',more:false}),executionList:async()=>({records,total:records.length,usage:2048,diagnostics:{enabled:false}}),executionDetail:async id=>({...records.find(row=>row.request_id===id),notice:'Isolated demonstration record; no actual tool call',remote_acknowledgement:'unknown'}),executionDiagnostics:async()=>({}),mcpPreviewImport:async()=>({id:'demo-import',servers:[{id:'imported',name:'Imported example',transport:'stdio',command:'/path/to/example-server',enabled:false}],missingSecrets:[]}),mcpExport:async()=>({mcpServers:{example:{command:'/path/to/example-server',args:[]}}}),openExternal:async()=>{},openLogs:async()=>{},_demo:async kind=>{if(kind==='approval')state.mcp.approvals=[{id:'demo-approval',serverId:'example',serverName:'Example service',toolName:'project_summary',arguments:{project_path:'/Users/demo/ExampleProject'},projectPath:'/Users/demo/ExampleProject',expiresAt:Date.now()+3600000}];if(kind==='untrusted'){state.mcp.servers[0].trusted=false;state.mcp.servers[0].enabled=false;}listener?.(state);return state;}};contextBridge.exposeInMainWorld('localHarness',Object.freeze(api));`);
fs.writeFileSync(setup,`const {app,BrowserWindow}=require('electron');const path=require('node:path');app.setPath('userData',${JSON.stringify(path.join(directory,'profile'))});app.setName('ChatToHarness Documentation');app.whenReady().then(()=>{const window=new BrowserWindow({width:1160,height:1200,enableLargerThanScreen:true,show:false,webPreferences:{preload:${JSON.stringify(preload)},contextIsolation:true,nodeIntegration:false,sandbox:false}});window.loadFile(${JSON.stringify(path.join(root,'app/index.html'))});});app.on('window-all-closed',()=>app.quit());`);
async function main(){
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const instance=await electron.launch({executablePath:require('electron'),args:[setup],env});
  try{
    const page=await instance.firstWindow();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.waitForFunction(()=>document.body.dataset.initialized==='true');
    const disclosure={en:'INTERFACE DEMONSTRATION · ISOLATED DATA · NO LIVE TOOL CALL','zh-CN':'界面演示 · 隔离数据 · 未执行真实通道调用',ja:'画面の操作例 · 隔離データ · 実際のツール呼び出しなし'}[locale];
    async function capture(name,selectors=[]){
      await page.setViewportSize({width:1160,height:1200});
      if(name==='mcp-editor'||name==='mcp-http')await page.locator('#mcp-editor').evaluate(el=>el.scrollIntoView({block:'start'}));
      if(name==='mcp-import'||name==='mcp-export')await page.locator('#mcp-import-text').evaluate(el=>el.closest('section').scrollIntoView({block:'start'}));
      if(name==='history-detail')await page.locator('#history-detail').scrollIntoViewIfNeeded();
      await page.evaluate(({selectors,disclosure})=>{
        document.querySelectorAll('[data-doc-marker]').forEach(el=>el.remove());document.activeElement?.blur();
        const badge=document.createElement('div');badge.dataset.docMarker='disclosure';badge.textContent=disclosure;Object.assign(badge.style,{position:'fixed',bottom:'0',left:'0',right:'0',padding:'7px 16px',background:'#203e6e',color:'white',fontSize:'11px',letterSpacing:'.5px',zIndex:9999,textAlign:'center'});document.body.append(badge);
        selectors.forEach((selector,i)=>{const target=document.querySelector(selector);if(!target)return;const rect=target.getBoundingClientRect(),marker=document.createElement('span');const outline=document.createElement('div');outline.dataset.docMarker='outline';Object.assign(outline.style,{position:'fixed',left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px',border:'1px solid #7398df',borderRadius:'6px',pointerEvents:'none',zIndex:9997});document.body.append(outline);marker.dataset.docMarker='number';marker.textContent=String(i+1);Object.assign(marker.style,{position:'fixed',left:Math.max(1,rect.left-10)+'px',top:Math.max(1,rect.top-9)+'px',width:'23px',height:'23px',lineHeight:'23px',textAlign:'center',fontSize:'12px',fontWeight:'700',background:'#365fba',color:'white',border:'2px solid white',borderRadius:'50%',zIndex:9998,boxShadow:'0 1px 5px #0002'});document.body.append(marker);});
      },{selectors,disclosure});
      await page.screenshot({path:path.join(output,locale,name+'.png'),scale:'css'});
    }
    async function tab(name){await page.locator('#nav-'+name).click();}
    await capture('overview',['#status-badge','.navigation','#progress-title']);
    await tab('connection');await capture('connection',['#tunnel-id','#api-key','#save-connect']);
    await tab('directories');await capture('directories',['#add-directory','#auto-project-context','#save-workspace']);
    await tab('help');await capture('help',['.client-grid','#update-card']);await capture('updates',['#check-update','#auto-check-updates']);
    await tab('logs');await page.waitForFunction(()=>document.querySelector('#log-entries').textContent.length>0);await capture('logs',['.live-log-filters','#log-search','#logs-history-shortcut']);
    await page.locator('#logs-history-shortcut').click();await page.waitForSelector('#history-rows button');await capture('history',['#history-search','#history-rows','#history-export']);
    await page.locator('#history-rows button').first().click();await capture('history-detail',['#history-detail','#history-copy','#history-diagnostics']);
    await tab('mcp');await page.locator('.mcp-tools > summary').click();await capture('mcp-tools',['.mcp-tools','#mcp-allow-all-tools']);
    await page.locator('#mcp-add').click();await page.locator('#mcp-id').fill('my_tools');await page.locator('#mcp-name').fill('My tools');await page.locator('#mcp-command').fill('/path/to/your-server');await page.locator('#mcp-args').fill('[]');
    await page.locator('#mcp-editor').scrollIntoViewIfNeeded();await capture('mcp-editor',['#mcp-id','#mcp-command','#mcp-save']);
    await page.locator('#mcp-transport').selectOption('streamable-http');await page.locator('#mcp-url').fill('https://example.com/mcp');await capture('mcp-http',['#mcp-transport','#mcp-url','#mcp-headers']);await page.locator('#mcp-cancel').click();
    await page.locator('#mcp-import-text').fill('{"mcpServers":{"imported":{"command":"/path/to/example-server","args":[]}}}');await page.locator('#mcp-import-preview').click();await page.locator('#mcp-import-preview-panel').scrollIntoViewIfNeeded();await capture('mcp-import',['#mcp-import-text','#mcp-import-preview-panel']);
    await page.locator('#mcp-export').click();await page.locator('#mcp-export-panel').scrollIntoViewIfNeeded();await capture('mcp-export',['#mcp-export-text','#mcp-copy-export']);
    await page.evaluate(()=>window.localHarness._demo('untrusted'));await page.locator('.mcp-server .mcp-actions button').first().click();await page.locator('#mcp-trust').scrollIntoViewIfNeeded();await capture('mcp-trust',['#mcp-trust-target','#mcp-trust-confirm']);
    await page.locator('#mcp-trust-cancel').click();await page.evaluate(()=>window.localHarness._demo('approval'));await page.locator('#mcp-approvals').scrollIntoViewIfNeeded();await capture('mcp-approval',['#mcp-approval-list details','#mcp-approval-list select','#mcp-approval-list .mcp-actions']);
    if(errors.length)throw new Error(errors.join('\n'));
    console.log('Captured 15 isolated interface scenes: '+locale);
  }finally{await instance.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(directory,{recursive:true,force:true}));
