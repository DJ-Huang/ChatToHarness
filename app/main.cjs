'use strict';
const {app,BrowserWindow,ipcMain,Menu,Tray,nativeImage,dialog,shell,safeStorage,net}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {Settings}=require('./settings.cjs');
const {RuntimeManager}=require('./runtime.cjs');
const {storageDirectory}=require('./platform.cjs');
const platform=process.platform||'darwin';
const product='ChatToHarness';
const {Preferences}=require('./preferences.cjs');
const {Updater}=require('./updater.cjs');
const {acquireInstance,installExitHandlers}=require('./dev-lifecycle.cjs');
const {desktopEntry,revealWindow,closeToBackground}=require('./window-access.cjs');
const {translate,normalize}=require('./i18n.js');
let preferences,locale='en';
const t=(message,values)=>translate(locale,message,values);
// Electron safeStorage uses the application name for its macOS keychain item.
// Production keeps its legacy identity. Disposable acceptance profiles own
// separate test keys, stable across that profile's restart, so a new ad-hoc
// build does not request access to a previous test application's keychain item.
const testMode=process.env.LOCALHARNESS_TEST_MODE==='1'&&Boolean(process.env.LOCALHARNESS_HOME)&&path.isAbsolute(process.env.LOCALHARNESS_HOME);
const home=storageDirectory({platform,userHome:os.homedir(),appData:process.env.APPDATA,override:process.env.LOCALHARNESS_HOME});
app.setName(testMode?'ChatToHarness Acceptance '+require('node:crypto').createHash('sha256').update(home).digest('hex').slice(0,12):platform==='darwin'?'LocalHarness':product);
app.setPath('userData',home);
let window,tray,trayMenu,settings,runtime,updater,mcpSettings,mcpManager,fatal='',quitting=false,installing=false,quitReady=false,queue=Promise.resolve(),actionEpoch=0;
const indexURL=pathToFileURL(path.join(__dirname,'index.html')).href;
const resources=(testMode&&process.env.LOCALHARNESS_RESOURCES)|| (app.isPackaged?process.resourcesPath:(process.env.LOCALHARNESS_RESOURCES||path.join(__dirname,'..','resources')));
const links=Object.freeze({
  platform:'https://platform.openai.com/settings/organization/tunnels',
  chatgpt:'https://chatgpt.com/',
  codex:'https://developers.openai.com/codex/',
  responses:'https://developers.openai.com/api/docs/guides/secure-mcp-tunnels#connect-from-the-responses-api',
  agentkit:'https://developers.openai.com/api/docs/guides/secure-mcp-tunnels',
  guide:'https://developers.openai.com/api/docs/guides/secure-mcp-tunnels',
  repository:'https://github.com/DJ-Huang/ChatToHarness',
});
let versions={app:app.getVersion(),node:'—',tunnel:'—',desktopCommander:'—'};
function log(event,detail={}){
  try{
    const directory=path.join(home,'logs');fs.mkdirSync(directory,{recursive:true,mode:0o700});
    const file=path.join(directory,'app.log');if(fs.existsSync(file)&&fs.statSync(file).size>1024*1024)fs.renameSync(file,file+'.previous');
    fs.appendFileSync(file,JSON.stringify({time:new Date().toISOString(),event,...detail})+'\n',{mode:0o600});
  }catch{}
}
function state(){return {settings:settings?settings.public():{tunnelId:'',directories:[],autoConnect:true,autoProjectContext:true,keySaved:false},runtime:fatal?{state:'failed',error:fatal,localReady:false,toolsCount:0}:runtime?.status()||{state:'unconfigured',error:'',localReady:false,toolsCount:0},mcp:mcpManager?.status()||{servers:[],approvals:[],toolsVersion:0,allowAllTools:false},versions,updates:updater?.status()||{current:versions.app,phase:'idle',automatic:preferences?.autoCheckUpdates!==false},actionEpoch,system:{platform,locale},testMode};}
function publish(){const value=state();if(window&&!window.isDestroyed())window.webContents.send('localharness:state',value);refreshTray();}
function show(){if(quitting)return;if(!window||window.isDestroyed())createWindow();revealWindow({app,window,platform});}
function createWindow(){
  window=new BrowserWindow({width:1160,height:850,minWidth:920,minHeight:690,show:false,title:product,minimizable:true,skipTaskbar:false,backgroundColor:'#f4f6f8',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(url!==indexURL)event.preventDefault();});
  window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  window.webContents.session.setPermissionCheckHandler(()=>false);
  window.on('close',event=>{if(!quitting)closeToBackground({event,window,tray});});
  window.once('ready-to-show',show);void window.loadURL(indexURL);
}
function refreshTray(){
  if(!tray)return;const labels={unconfigured:'尚未配置',stopped:'已停止',authorizing:'等待系统授权',checking:'正在检查',starting:'正在连接',ready:'通道就绪',reconnecting:'正在重连',failed:'需要处理'};
  const current=state().runtime;tray.setToolTip(product+' · '+t(labels[current.state]||'尚未配置'));
  const active=['authorizing','checking','starting','ready','reconnecting'].includes(current.state);
  trayMenu=Menu.buildFromTemplate([{label:product+' · '+t(labels[current.state]||'尚未配置'),enabled:false},{label:t('打开窗口'),click:show},{type:'separator'},{label:t(active?'重新连接':'连接'),enabled:Boolean(settings?.public().keySaved)&&!fatal&&!quitting&&!installing&&!['authorizing','checking','starting'].includes(current.state),click:()=>void connect().catch(()=>show())},{label:t('停止连接'),enabled:active||Boolean(runtime?.desired)||Boolean(mcpManager&&[...mcpManager.records.values()].some(record=>['connecting','ready','reconnecting'].includes(record.phase))),click:()=>void stopConnection().catch(()=>show())},{type:'separator'},{label:t('检查更新'),enabled:Boolean(updater)&&!updater.busy&&!quitting,click:()=>{show();window?.webContents.send('localharness:show-updates');void checkUpdate();}},{label:t('查看日志'),click:()=>void openLogs().catch(()=>show())},{label:t('退出 {product}',{product}),accelerator:'CommandOrControl+Q',click:()=>app.quit()}]);
  tray.setContextMenu(trayMenu);
}
function createTray(){
  let icon;
  if(platform==='darwin'){
    icon=nativeImage.createEmpty();
    for(const [scaleFactor,file] of [[1,'tray.png'],[2,'tray@2x.png']]){
      const representation=nativeImage.createFromBuffer(fs.readFileSync(path.join(__dirname,file))).resize({width:18*scaleFactor,height:18*scaleFactor});
      if(representation.isEmpty())throw new Error('后台图标无法读取。');
      icon.addRepresentation({scaleFactor,buffer:representation.toPNG()});
    }
    icon.setTemplateImage(true);
  }else{
    // The colored app mark remains visible on light and dark Windows taskbars.
    icon=nativeImage.createFromPath(path.join(__dirname,'tray-color.png'));
    if(icon.isEmpty())throw new Error('后台图标无法读取。');
  }
  tray=new Tray(icon);
  tray.on('click',show);tray.on('double-click',show);refreshTray();
}
async function action(fn){
  const epoch=actionEpoch;
  const checkpoint=()=>{if(quitting||installing)throw new Error('应用正在退出。');if(epoch!==actionEpoch)throw new Error('操作已停止。');};
  const execute=async()=>{checkpoint();if(fatal||!settings||!runtime)throw new Error(fatal||'应用配置无法读取。');try{await fn(checkpoint);return state();}finally{publish();}};
  const result=queue.then(execute,execute);queue=result.catch(()=>{});return result;
}
function connect(){return action(async checkpoint=>{
  runtime.update({state:'authorizing',error:''});
  // Let the renderer present its complete window and authorization guidance
  // before the legacy macOS synchronous keychain API can show a system prompt.
  await new Promise(resolve=>setTimeout(resolve,100));checkpoint();
  let key;
  try{key=settings.getKey();}catch(error){runtime.update({state:'failed',error:error.message});throw error;}
  checkpoint();
  try{return await runtime.connect(settings.public(),key);}
  catch(error){checkpoint();runtime.update({state:'failed',error:error.message});throw error;}
});}
async function stopConnection(){
  ++actionEpoch;
  const stopping=runtime?.disconnect();publish();
  try{await stopping;}finally{publish();}
  return state();
}
async function openLogs(){const directory=path.join(home,'logs');fs.mkdirSync(directory,{recursive:true,mode:0o700});const error=await shell.openPath(directory);if(error)throw new Error('日志文件夹暂时无法打开。');}
async function checkUpdate(){if(!quitting&&updater)await updater.check();return state();}
async function installUpdate(){
  if(quitting||installing||!updater)return state();
  installing=true;
  try{
    const file=await updater.installer();
    if(quitting)return state();
    // Stop queued connection actions and all managed tools before the installer
    // opens. A failed handoff leaves a usable, stopped runtime for manual retry.
    ++actionEpoch;publish();await runtime?.disconnect();
    if(quitting)return state();
    const error=await shell.openPath(file);if(error)throw new Error();
    app.quit();
  }catch{
    if(!quitting&&updater.status().phase==='installing')updater.installFailed();
  }finally{installing=false;publish();}
  return state();
}
function registerIPC(){
  const bind=(name,handler)=>ipcMain.handle('localharness:'+name,async(event,...args)=>{
    if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame.url!==indexURL)throw new Error('请求来源无效。');
    return handler(...args);
  });
  bind('get-state',()=>state());
  bind('set-language',value=>{
    preferences.setLocale(value);locale=preferences.locale;
    Menu.setApplicationMenu(applicationMenu());publish();return state();
  });
  bind('update-check',checkUpdate);
  bind('update-automatic',enabled=>{
    preferences.setAutoCheckUpdates(enabled);
    if(updater){if(!testMode)updater.setAutomatic(enabled);else updater.update({automatic:enabled});}
    return state();
  });
  bind('update-download',()=>{
    if(!quitting&&updater)void updater.download().then(ok=>{if(ok&&!quitting)return installUpdate();}).catch(error=>updater.fail(error));
    return state();
  });
  bind('update-install',installUpdate);
  bind('update-release',async()=>{const url=updater?.status().releaseUrl;if(url)await shell.openExternal(url);});
  bind('save-settings',input=>action(async()=>{const before=JSON.stringify(settings.public());settings.save(input);if(before!==JSON.stringify(settings.public())||input?.apiKey?.trim())await runtime.disconnect();}));
  bind('connect',connect);
  bind('disconnect',stopConnection);
  bind('check',()=>action(()=>runtime.check(settings.public())));
  bind('clear-credentials',()=>action(async checkpoint=>{await runtime.disconnect();checkpoint();settings.clearCredentials();}));
  bind('choose-directories',async()=>{const result=await dialog.showOpenDialog(window,{title:t('选择允许文件工具访问的目录'),properties:['openDirectory','multiSelections']});return result.canceled?[]:result.filePaths;});
  const mcp=handler=>async(...args)=>{
    if(quitting||installing||!mcpManager||!mcpSettings)throw new Error('MCP_STOPPED');
    try{return await handler(...args);}catch(error){throw new Error(typeof error.code==='string'?error.code:/^MCP_[A-Z_]+$/.test(error.message)?error.message:'MCP_ACTION_FAILED');}
  };
  bind('mcp-save-server',mcp(input=>action(async()=>{const server=mcpSettings.save(input);await mcpManager.syncServer(server.id);})));
  bind('mcp-remove-server',mcp(id=>action(()=>mcpManager.remove(id))));
  bind('mcp-set-enabled',mcp((id,enabled)=>action(()=>mcpManager.setEnabled(id,enabled))));
  bind('mcp-trust-server',mcp(id=>action(()=>{mcpSettings.trust(id);mcpManager.changed();})));
  bind('mcp-test-server',mcp(id=>action(()=>mcpManager.test(id))));
  bind('mcp-set-tool-policy',mcp(input=>action(()=>mcpManager.setToolPolicy(input))));
  bind('mcp-set-allow-all-tools',mcp(enabled=>action(()=>mcpManager.setAllowAllTools(enabled))));
  bind('mcp-preview-import',mcp(text=>mcpSettings.previewImport(text)));
  bind('mcp-commit-import',mcp(id=>action(()=>{mcpSettings.commitImport(id);mcpManager.changed();})));
  bind('mcp-export',mcp(()=>mcpSettings.export()));
  // Confirmations must not queue behind a connection check or another pending
  // management action. They can only resolve an already captured request ID.
  bind('mcp-resolve-approval',mcp(input=>{mcpManager.approve(input);return state();}));
  bind('open-logs',openLogs);
  bind('open-external',async id=>{if(typeof id!=='string'||!Object.hasOwn(links,id))throw new Error('链接无效。');await shell.openExternal(links[id]);});
}
function applicationMenu(){
  if(platform==='darwin')app.dock.setMenu(Menu.buildFromTemplate([{label:t('打开窗口'),click:show}]));
  const edit={label:t('编辑'),submenu:[{role:'undo',label:t('撤销')},{role:'redo',label:t('重做')},{type:'separator'},{role:'cut',label:t('剪切')},{role:'copy',label:t('复制')},{role:'paste',label:t('粘贴')},{role:'selectAll',label:t('全选')}]};
  const updateItem={label:t('检查更新'),click:()=>{show();window?.webContents.send('localharness:show-updates');void checkUpdate();}};
  const common=[{label:t('打开窗口'),click:show},{type:'separator'},{label:t('退出 {product}',{product}),role:'quit',accelerator:'CommandOrControl+Q'}];
  return Menu.buildFromTemplate(platform==='darwin'?[{label:product,submenu:[{label:t('关于 {product}',{product}),role:'about'},common[0],updateItem,{type:'separator'},{role:'hide',label:t('隐藏 {product}',{product})},{role:'hideOthers',label:t('隐藏其他应用')},{role:'unhide',label:t('显示全部')},{type:'separator'},common[2]]},edit]:[{label:product,submenu:[common[0],updateItem,...common.slice(1)]},edit]);
}
if(!acquireInstance({app,show,host:process})){}
else{
  app.on('activate',show);app.on('window-all-closed',()=>{});
  app.on('before-quit',event=>{
    if(quitReady)return;event.preventDefault();if(quitting)return;quitting=true;++actionEpoch;updater?.dispose();
    void Promise.resolve(runtime?.close()).finally(()=>{tray?.destroy();tray=null;log('quit');quitReady=true;app.quit();});
  });
  installExitHandlers({app,host:process});
  app.whenReady().then(async()=>{
    if(quitting)return;
    desktopEntry({app,platform,icon:path.join(__dirname,'tray-color.png'),onError:()=>log('dock-unavailable')});
    locale=normalize((app.getPreferredSystemLanguages?.()||[app.getLocale()])[0]);
    if(testMode&&process.env.LOCALHARNESS_TEST_LOCALE)locale=normalize(process.env.LOCALHARNESS_TEST_LOCALE);
    preferences=new Preferences(home,locale);locale=preferences.locale;
    try{
      fs.mkdirSync(home,{recursive:true,mode:0o700});if(fs.lstatSync(home).isSymbolicLink())throw new Error();fs.chmodSync(home,0o700);
      updater=new Updater({current:app.getVersion(),platform,arch:process.arch,directory:path.join(home,'updates'),packaged:app.isPackaged,fetcher:(url,options)=>net.fetch(url,options)});
      updater.on('state',publish);
      if(!testMode)updater.setAutomatic(preferences.autoCheckUpdates);else updater.update({automatic:preferences.autoCheckUpdates});
      versions={...versions,...JSON.parse(fs.readFileSync(path.join(resources,'bundle.json'),'utf8'))};
      settings=new Settings(home,safeStorage);
      const tunnelScript=testMode&&process.env.LOCALHARNESS_TEST_TUNNEL_SCRIPT;
      if(tunnelScript&&(!path.isAbsolute(tunnelScript)||!fs.statSync(tunnelScript).isFile()))throw new Error();
      runtime=new RuntimeManager({home,resources,log,tunnelScript});runtime.on('state',publish);
      const {McpSettings}=require('./mcp-settings.cjs');
      const {McpManager}=require('./mcp-manager.cjs');
      const {McpGateway}=require('./mcp-gateway.cjs');
      mcpSettings=new McpSettings(home,safeStorage);
      mcpManager=new McpManager({settings:mcpSettings,nodePath:runtime.paths.node,processHost:runtime.paths.processHost,fetcher:(url,options)=>net.fetch(url,options),log,
        builtinFactory:async desktopSettings=>{
          runtime.prepare(desktopSettings);
          return {transport:'stdio',command:runtime.paths.node,args:[runtime.launcher,runtime.paths.desktopCommander,String(process.pid)],cwd:desktopSettings.directories[0],env:runtime.childEnvironment(desktopSettings)};
        }});
      mcpManager.broker=new McpGateway(mcpManager);runtime.gateway=mcpManager;
      mcpManager.on('state',()=>{const toolsCount=mcpManager.visibleTools().length;runtime.update({toolsCount,localReady:toolsCount>0});publish();});
      mcpManager.on('approval',()=>{if(!quitting&&!installing)show();});
      if(settings.public().keySaved)runtime.update({state:'stopped'});
    }catch(error){fatal=error.name==='SettingsError'?error.message:'应用组件或配置无法读取。请重新安装应用，或通过一键启动入口重新准备组件。';log('startup-failed');}
    Menu.setApplicationMenu(applicationMenu());
    app.setAboutPanelOptions?.({applicationName:product,applicationVersion:app.getVersion(),copyright:'MIT · DJ-Huang'});
    registerIPC();createWindow();
    try{createTray();}catch{tray?.destroy();tray=null;log('tray-unavailable');}
    log('started');
    if(!fatal&&settings.public().autoConnect&&settings.public().keySaved){
      window.webContents.once('did-finish-load',()=>{void connect().catch(()=>publish());});
    }
  }).catch(()=>{dialog.showErrorBox(t('{product} 无法启动',{product}),t('请重新安装应用，或使用一键启动入口检查组件准备结果。'));quitReady=true;app.quit();});
}
