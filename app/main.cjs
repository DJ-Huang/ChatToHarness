'use strict';
const {app,BrowserWindow,ipcMain,Menu,Tray,nativeImage,dialog,shell,safeStorage}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {Settings}=require('./settings.cjs');
const {RuntimeManager}=require('./runtime.cjs');
const {storageDirectory}=require('./platform.cjs');
const platform=process.platform||'darwin';
const product='ChatToHarness';
// Electron safeStorage uses the application name for its macOS keychain item.
// Keep that private identity; every visible title and menu uses the new brand.
app.setName(platform==='darwin'?'LocalHarness':product);
const home=storageDirectory({platform,userHome:os.homedir(),appData:process.env.APPDATA,override:process.env.LOCALHARNESS_HOME});
app.setPath('userData',home);
const testMode=process.env.LOCALHARNESS_TEST_MODE==='1'&&Boolean(process.env.LOCALHARNESS_HOME)&&path.isAbsolute(process.env.LOCALHARNESS_HOME);
let window,tray,trayMenu,settings,runtime,fatal='',quitting=false,quitReady=false,queue=Promise.resolve(),actionEpoch=0;
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
function state(){return {settings:settings?settings.public():{tunnelId:'',directories:[],autoConnect:true,autoProjectContext:true,keySaved:false},runtime:fatal?{state:'failed',error:fatal,localReady:false,toolsCount:0}:runtime?.status()||{state:'unconfigured',error:'',localReady:false,toolsCount:0},versions,actionEpoch,system:{platform},testMode};}
function publish(){const value=state();if(window&&!window.isDestroyed())window.webContents.send('localharness:state',value);refreshTray();}
function show(){if(quitting)return;if(!window||window.isDestroyed())createWindow();if(window.isMinimized())window.restore();window.show();window.focus();}
function createWindow(){
  window=new BrowserWindow({width:1160,height:850,minWidth:920,minHeight:690,show:false,title:product,...(platform==='darwin'?{titleBarStyle:'hiddenInset'}:{}),backgroundColor:'#f4f6f8',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(url!==indexURL)event.preventDefault();});
  window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  window.webContents.session.setPermissionCheckHandler(()=>false);
  window.on('close',event=>{if(!quitting){event.preventDefault();window.hide();}});
  window.once('ready-to-show',()=>window.show());void window.loadURL(indexURL);
}
function refreshTray(){
  if(!tray)return;const labels={unconfigured:'尚未配置',stopped:'已停止',authorizing:'等待系统授权',checking:'正在检查',starting:'正在连接',ready:'通道就绪',reconnecting:'正在重连',failed:'需要处理'};
  const current=state().runtime;tray.setToolTip(product+' · '+(labels[current.state]||'尚未配置'));
  const active=['authorizing','checking','starting','ready','reconnecting'].includes(current.state);
  trayMenu=Menu.buildFromTemplate([{label:product+' · '+(labels[current.state]||'尚未配置'),enabled:false},{label:'打开窗口',click:show},{type:'separator'},{label:active?'重新连接':'连接',enabled:Boolean(settings?.public().keySaved)&&!fatal&&!quitting&&!['authorizing','checking','starting'].includes(current.state),click:()=>void connect().catch(()=>show())},{label:'停止连接',enabled:active||Boolean(runtime?.desired),click:()=>void stopConnection().catch(()=>show())},{type:'separator'},{label:'查看日志',click:()=>void openLogs().catch(()=>show())},{label:'退出 '+product,accelerator:'CommandOrControl+Q',click:()=>app.quit()}]);
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
  tray.on('click',show);tray.on('double-click',show);tray.on('right-click',()=>{refreshTray();tray.popUpContextMenu(trayMenu);});refreshTray();
}
async function action(fn){
  const epoch=actionEpoch;
  const checkpoint=()=>{if(quitting)throw new Error('应用正在退出。');if(epoch!==actionEpoch)throw new Error('操作已停止。');};
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
function registerIPC(){
  const bind=(name,handler)=>ipcMain.handle('localharness:'+name,async(event,...args)=>{
    if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame.url!==indexURL)throw new Error('请求来源无效。');
    return handler(...args);
  });
  bind('get-state',()=>state());
  bind('save-settings',input=>action(async()=>{const before=JSON.stringify(settings.public());settings.save(input);if(before!==JSON.stringify(settings.public())||input?.apiKey?.trim())await runtime.disconnect();}));
  bind('connect',connect);
  bind('disconnect',stopConnection);
  bind('check',()=>action(()=>runtime.check(settings.public())));
  bind('clear-credentials',()=>action(async checkpoint=>{await runtime.disconnect();checkpoint();settings.clearCredentials();}));
  bind('choose-directories',async()=>{const result=await dialog.showOpenDialog(window,{title:'选择允许文件工具访问的目录',properties:['openDirectory','multiSelections']});return result.canceled?[]:result.filePaths;});
  bind('open-logs',openLogs);
  bind('open-external',async id=>{if(typeof id!=='string'||!Object.hasOwn(links,id))throw new Error('链接无效。');await shell.openExternal(links[id]);});
}
function applicationMenu(){
  const edit={label:'编辑',submenu:[{role:'undo',label:'撤销'},{role:'redo',label:'重做'},{type:'separator'},{role:'cut',label:'剪切'},{role:'copy',label:'复制'},{role:'paste',label:'粘贴'},{role:'selectAll',label:'全选'}]};
  const common=[{label:'打开窗口',click:show},{type:'separator'},{label:'退出 '+product,role:'quit',accelerator:'CommandOrControl+Q'}];
  return Menu.buildFromTemplate(platform==='darwin'?[{label:product,submenu:[{label:'关于 '+product,role:'about'},common[0],{type:'separator'},{role:'hide',label:'隐藏 '+product},{role:'hideOthers',label:'隐藏其他应用'},{role:'unhide',label:'显示全部'},{type:'separator'},common[2]]},edit]:[{label:product,submenu:common},edit]);
}
if(!app.requestSingleInstanceLock()){app.quit();}
else{
  app.on('second-instance',show);app.on('activate',show);app.on('window-all-closed',()=>{});
  app.on('before-quit',event=>{
    if(quitReady)return;event.preventDefault();if(quitting)return;quitting=true;++actionEpoch;
    void Promise.resolve(runtime?.close()).finally(()=>{tray?.destroy();tray=null;log('quit');quitReady=true;app.quit();});
  });
  app.whenReady().then(async()=>{
    try{
      fs.mkdirSync(home,{recursive:true,mode:0o700});if(fs.lstatSync(home).isSymbolicLink())throw new Error();fs.chmodSync(home,0o700);
      versions={...versions,...JSON.parse(fs.readFileSync(path.join(resources,'bundle.json'),'utf8'))};
      settings=new Settings(home,safeStorage);
      const tunnelScript=testMode&&process.env.LOCALHARNESS_TEST_TUNNEL_SCRIPT;
      if(tunnelScript&&(!path.isAbsolute(tunnelScript)||!fs.statSync(tunnelScript).isFile()))throw new Error();
      runtime=new RuntimeManager({home,resources,log,tunnelScript});runtime.on('state',publish);
      if(settings.public().keySaved)runtime.update({state:'stopped'});
    }catch(error){fatal=error.name==='SettingsError'?error.message:'应用组件或配置无法读取。请重新安装应用，或通过一键启动入口重新准备组件。';log('startup-failed');}
    Menu.setApplicationMenu(applicationMenu());
    app.setAboutPanelOptions?.({applicationName:product,applicationVersion:app.getVersion(),copyright:'MIT · DJ-Huang'});
    registerIPC();createWindow();createTray();log('started');
    if(!fatal&&settings.public().autoConnect&&settings.public().keySaved){
      window.webContents.once('did-finish-load',()=>{void connect().catch(()=>publish());});
    }
  }).catch(()=>{dialog.showErrorBox(product+' 无法启动','请重新安装应用，或使用一键启动入口检查组件准备结果。');quitReady=true;app.quit();});
}
