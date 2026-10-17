'use strict';
const {version: appVersion} = require('../package.json');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {EventEmitter} = require('node:events');
const {bundledPaths, defaultShell, developmentEnvironment, tunnelCommand, spawnManaged, stopTree} = require('./platform.cjs');

const ERRORS = {
  binary:'应用组件不完整，请重新安装应用，或使用一键启动入口准备组件。',
  config:'本机工具配置无法读取，请打开日志目录，检查工具配置文件。',
  mcp:'本地工具检查失败，请确认项目目录可访问，再点击“检查连接”。',
  key:'Runtime API Key 无效或已失效，请重新填写后连接。',
  permission:'此密钥没有通道使用权限，请在服务配置页面检查所属组织及 Tunnels Read + Use 权限。',
  tunnel:'找不到这个 Tunnel，请检查 Tunnel ID、所属组织和工作区关联。',
  network:'连接暂时中断，正在自动重连。请检查网络或代理设置。',
  process:'连接组件意外退出，正在重新连接。',
  directory:'请先在“工作目录”中选择至少一个可访问的本机文件夹。',
};
const BLOCKED = ['mkfs','format','mount','umount','fdisk','dd','parted','diskpart','sudo','su','passwd','adduser','useradd','usermod','groupadd','chsh','visudo','shutdown','reboot','halt','poweroff','init','iptables','firewall','netsh','sfc','bcdedit','reg','net','sc','runas','cipher','takeown'];
function reason(value) {
  const text = typeof value === 'string' ? value.toLowerCase() : (JSON.stringify(value)||'').toLowerCase();
  // Poll counts and timing values can also be 401/403/404. Require an HTTP
  // status/code context instead of treating every matching number as auth.
  const hasStatus=code=>text.trim()===String(code)||new RegExp('\\b(?:http(?:[_ ]status(?:[_ ]code)?)?|status(?:[_ -]code)?|statuscode|httpstatus|code)\\b["\'\\s:=]+'+code+'\\b').test(text);
  if (/unauthorized|invalid[_ ]api[_ ]key/.test(text)||hasStatus(401)) return 'key';
  if (/forbidden|permission[_ ]denied/.test(text)||hasStatus(403)) return 'permission';
  if (/tunnel[_ ]not[_ ]found/.test(text)||hasStatus(404)) return 'tunnel';
  return '';
}
function shellQuote(value) {return "'" + value.replace(/'/g, "'\\''") + "'";}
function cleanEnvironment(source = process.env) {
  const env = {...source};
  for (const key of Object.keys(env)) if (/^(CONTROL_PLANE_|TUNNEL_CLIENT_|MCP_|HEALTH_|HARPOON_|LOG_)/i.test(key) || /^(OPENAI_API_KEY|OPENAI_ADMIN_KEY)$/i.test(key) || /^LOCALHARNESS_TEST_/i.test(key)) delete env[key];
  return env;
}
function healthRequest(base, suffix) {
  return new Promise((resolve,reject) => {
    const url = new URL(base);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/') return reject(new Error('process'));
    const req = http.get(new URL(suffix,url),{agent:false,timeout:1800,headers:{Accept:'application/json'}},response=>{
      let raw='';response.setEncoding('utf8');
      response.on('data', chunk=>{raw+=chunk;if(raw.length>262144)response.destroy(new Error('network'));});
      response.on('error',reject);response.on('end',()=>{let body={};try{body=JSON.parse(raw);}catch{}resolve({code:response.statusCode,body});});
    });
    req.on('timeout',()=>req.destroy(new Error('network')));req.on('error',reject);
  });
}

class RuntimeManager extends EventEmitter {
  constructor({home, resources, launcherSource=path.join(__dirname,'mcp-launch.cjs'), paths, probe, tunnelScript, gateway, log=()=>{}}) {
    super();this.home=home;this.log=log;this.launcherSource=launcherSource;
    this.paths=paths||bundledPaths(resources);this.tunnelScript=tunnelScript;
    this.gateway=gateway;this.gatewayLauncher=path.join(home,'mcp-gateway-stdio.cjs');
    this.localHome=path.join(home,'desktop-commander');this.launcher=path.join(home,'mcp-launch.cjs');
    this.healthFile=path.join(home,'tunnel-health-url');this.launchId=0;this.probeOverride=probe;
    this.value={state:'unconfigured',error:'',localReady:false,toolsCount:0};
    this.desired=null;this.process=null;this.generation=0;this.attempts=0;this.retryAt=0;this.monitorBusy=false;this.closed=false;
    this.timer=setInterval(()=>void this.monitor(),2000);this.timer.unref();
  }
  status(){return {...this.value};}
  update(values){
    const next={...this.value,...values};if(JSON.stringify(next)===JSON.stringify(this.value))return;
    this.value=next;this.log('runtime',{state:next.state,error:next.error});this.emit('state',this.status());
  }
  prepare(settings) {
    if(!Array.isArray(settings.directories)||!settings.directories.length||settings.directories.some(directory=>{try{return !path.isAbsolute(directory)||!fs.statSync(directory).isDirectory();}catch{return true;}}))throw new Error(ERRORS.directory);
    try {
      for (const name of ['node','tunnel']) fs.accessSync(this.paths[name],fs.constants.X_OK);
      fs.accessSync(this.paths.desktopCommander,fs.constants.R_OK);
      if(process.platform==='win32')fs.accessSync(this.paths.processHost,fs.constants.R_OK);
      fs.mkdirSync(this.localHome,{recursive:true,mode:0o700});
      if (fs.lstatSync(this.localHome).isSymbolicLink()) throw new Error();
      fs.chmodSync(this.localHome,0o700);
    } catch {throw new Error(ERRORS.binary);}
    try {
      const file=path.join(this.localHome,'config.json');let value={blockedCommands:BLOCKED};
      if(fs.existsSync(file)) {
        if(fs.lstatSync(file).isSymbolicLink())throw new Error();
        value=JSON.parse(fs.readFileSync(file,'utf8'));if(!value||Array.isArray(value)||typeof value!=='object')throw new Error();
      }
      Object.assign(value,{defaultShell:defaultShell(),allowedDirectories:settings.directories,telemetryEnabled:false,pendingWelcomeOnboarding:false,welcomeOnboardingEligible:false});
      const temp=file+'.'+process.pid+'.tmp';
      try {fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(temp,file);} finally {try{fs.unlinkSync(temp);}catch{}}
      // A private copy works with standalone Node even when Electron uses asar.
      // The protocol adapter and context reader must travel with the launcher;
      // standalone Node cannot resolve helpers from Electron's asar archive.
      for(const name of ['platform.cjs','project-context.cjs','project-search.cjs','mcp-proxy.cjs',path.basename(this.launcherSource)]){
        const source=path.join(path.dirname(this.launcherSource),name);
        const destination=name===path.basename(this.launcherSource)?this.launcher:path.join(this.home,name);
        const temporary=destination+'.'+process.pid+'.tmp';
        try{fs.writeFileSync(temporary,fs.readFileSync(source),{mode:0o600,flag:'wx'});fs.renameSync(temporary,destination);}finally{try{fs.unlinkSync(temporary);}catch{}}
      }
    } catch {throw new Error(ERRORS.config);}
  }
  childEnvironment(settings={}){
    const env=developmentEnvironment(cleanEnvironment(),this.paths.node);env.LOCALHARNESS_DC_HOME=this.localHome;env.DO_NOT_TRACK='1';
    env.LOCALHARNESS_AUTO_PROJECT_CONTEXT=settings.autoProjectContext===false?'0':'1';
    if(process.platform==='win32')env.LOCALHARNESS_PROCESS_HOST=this.paths.processHost;
    return env;
  }
  async probe(settings) {
    if(this.gateway){
      fs.mkdirSync(this.home,{recursive:true,mode:0o700});
      if(fs.lstatSync(this.home).isSymbolicLink())throw new Error(ERRORS.config);
      for(const name of ['node','tunnel'])fs.accessSync(this.paths[name],fs.constants.X_OK);
      const source=path.join(path.dirname(this.launcherSource),'mcp-gateway-stdio.cjs');
      const temporary=this.gatewayLauncher+'.'+process.pid+'.tmp';
      try{fs.writeFileSync(temporary,fs.readFileSync(source),{mode:0o600,flag:'wx'});fs.renameSync(temporary,this.gatewayLauncher);}finally{try{fs.unlinkSync(temporary);}catch{}}
      return this.gateway.start(settings);
    }
    this.prepare(settings);
    if(this.probeOverride)return this.probeOverride(settings);
    const child=spawnManaged(this.paths.node,[this.launcher,this.paths.desktopCommander,String(process.pid)],{processHost:this.paths.processHost,env:this.childEnvironment(settings),cwd:settings.directories[0],stdio:['pipe','pipe','pipe']});
    this.probeChild=child;
    const waiting=new Map();let buffer='',id=0,broken=false;
    const abort=()=>{broken=true;for(const {reject}of waiting.values())reject(new Error(ERRORS.mcp));waiting.clear();};
    this.cancelProbe=abort;
    child.on('error',abort);child.on('exit',abort);child.stderr.resume();
    child.stdout.setEncoding('utf8');child.stdout.on('data',part=>{
      buffer+=part;if(buffer.length>2*1024*1024){abort();return;}
      for(let at;(at=buffer.indexOf('\n'))>=0;){
        const line=buffer.slice(0,at);buffer=buffer.slice(at+1);let value;try{value=JSON.parse(line);}catch{abort();continue;}
        const pending=waiting.get(value.id);if(pending){waiting.delete(value.id);value.error?pending.reject(new Error(ERRORS.mcp)):pending.resolve(value.result);}
        else if(value.id!==undefined&&value.method){child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:value.id,error:{code:-32601,message:'Unsupported client request'}})+'\n');}
      }
    });
    child.stdin.on('error',abort);
    const rpc=(method,params)=>new Promise((resolve,reject)=>{if(broken)return reject(new Error(ERRORS.mcp));const number=++id;waiting.set(number,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:number,method,params})+'\n');});
    const timeout=setTimeout(abort,20000);
    try{
      const init=await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'ChatToHarness Check',version:appVersion}});
      if(!init?.serverInfo)throw new Error(ERRORS.mcp);
      child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
      let count=0,cursor;const names=new Set();
      for(let page=0;page<10;page++){
        const result=await rpc('tools/list',cursor?{cursor}:{});
        if(!Array.isArray(result?.tools))throw new Error(ERRORS.mcp);
        for(const tool of result.tools)if(typeof tool.name==='string')names.add(tool.name);
        count+=result.tools.length;cursor=result.nextCursor;if(!cursor)break;
      }
      if(cursor||!count||!names.has('start_process')||!names.has('read_file')||!names.has('search_project')||(settings.autoProjectContext!==false&&!names.has('get_project_context')))throw new Error(ERRORS.mcp);
      return count;
    } finally {clearTimeout(timeout);abort();await stopTree(child);if(this.probeChild===child){this.probeChild=null;this.cancelProbe=null;}}
  }
  async check(settings) {
    const generation=++this.generation,wasRunning=Boolean(this.desired);this.update({state:'checking',error:''});
    try{const toolsCount=await this.probe(settings);if(generation!==this.generation||this.closed)return this.status();this.update({localReady:true,toolsCount,state:wasRunning?'starting':'stopped',error:''});if(wasRunning)await this.monitor();return this.status();}
    catch(error){if(generation!==this.generation||this.closed)return this.status();this.desired=null;await this.stopProcess();if(generation!==this.generation||this.closed)return this.status();this.update({state:'failed',error:error.message,localReady:false,toolsCount:0});throw error;}
  }
  async connect(settings,key) {
    const generation=++this.generation;
    this.desired=null;this.cancelProbe?.();await this.stopProcess();if(this.probeChild)await stopTree(this.probeChild);
    if(generation!==this.generation||this.closed)return this.status();
    if(!/^tunnel_[a-z0-9]{32}$/.test(settings.tunnelId))throw new Error('Tunnel ID 应为 tunnel_ 后跟 32 位小写字母或数字。');
    if(!key||/[\r\n\0]/.test(key))throw new Error(ERRORS.key);
    this.update({state:'checking',error:'',localReady:false,toolsCount:0});
    try{
      const toolsCount=await this.probe(settings);if(this.closed||generation!==this.generation)return this.status();
      this.desired={settings:{...settings,directories:[...settings.directories]},key};this.attempts=0;this.retryAt=0;
      this.update({localReady:true,toolsCount,state:'starting',error:''});this.launch();
    } catch(error){if(generation!==this.generation||this.closed)return this.status();this.desired=null;this.update({state:'failed',error:error.message,localReady:false});throw error;}
    return this.status();
  }
  launch() {
    if(!this.desired||this.closed)return;
    const {settings,key}=this.desired;this.processError='';
    // A delayed cleanup of an old connection must not remove the new URL file.
    this.healthFile=path.join(this.home,`tunnel-health-${process.pid}-${++this.launchId}`);
    const env=this.childEnvironment(settings);env.CONTROL_PLANE_API_KEY=key;
    if(this.gateway)Object.assign(env,this.gateway.environment());
    env.NO_PROXY=env.no_proxy=[env.NO_PROXY||env.no_proxy||'','127.0.0.1','localhost','::1'].filter(Boolean).join(',');
    const command=tunnelCommand(this.gateway?[this.paths.node,this.gatewayLauncher]:[this.paths.node,this.launcher,this.paths.desktopCommander,String(process.pid)]);
    const args=['run','--control-plane.tunnel-id',settings.tunnelId,'--control-plane.api-key','env:CONTROL_PLANE_API_KEY','--mcp.command',command,'--mcp.stdio-send-initialized-notification','--health.listen-addr','127.0.0.1:0','--health.url-file',this.healthFile,'--log.format','json','--log.level','info'];
    const child=spawnManaged(this.tunnelScript?this.paths.node:this.paths.tunnel,this.tunnelScript?[this.tunnelScript,...args]:args,{processHost:this.paths.processHost,cwd:settings.directories[0]||this.home,env,stdio:['ignore','pipe','pipe']});
    this.process=child;this.startedAt=Date.now();
    child.once('error',()=>{if(this.process===child)this.processError='process';});
    // Consume output without keeping request bodies, paths or auth headers.
    for(const stream of [child.stdout,child.stderr]){
      let buffered='';stream.setEncoding('utf8');stream.on('data',part=>{
        buffered=(buffered+part).slice(-32768);let index;
        while((index=buffered.indexOf('\n'))>=0){const line=buffered.slice(0,index);buffered=buffered.slice(index+1);
          if(this.process===child&&/control.plane|poll/i.test(line)){const code=reason(line);if(code)this.processError=code;}
        }
      });
    }
    this.update({state:this.attempts?'reconnecting':'starting',error:this.attempts?ERRORS.network:''});
  }
  async monitor() {
    if(this.monitorBusy||!this.desired||this.closed)return;
    this.monitorBusy=true;const generation=this.generation;
    try{
      if(!this.process){if(Date.now()>=this.retryAt)this.launch();return;}
      if(this.processError)throw new Error(this.processError);
      if(this.process.exitCode!==null||this.process.signalCode!==null)throw new Error('process');
      if(!fs.existsSync(this.healthFile)){if(Date.now()-this.startedAt>45000)throw new Error('network');return;}
      const base=fs.readFileSync(this.healthFile,'utf8').trim();
      const [ready,detail]=await Promise.all([healthRequest(base,'/readyz'),healthRequest(base,'/health?details=true')]);
      if(generation!==this.generation||!this.desired)return;
      const control=detail.body?.components?.['control-plane'];const failure=reason(control||{});if(failure)throw new Error(failure);
      if(ready.code===200&&control?.status==='ok'){this.attempts=0;this.update({state:'ready',error:''});}
      else if(control?.status==='degraded'||this.value.state==='ready'||Date.now()-this.startedAt>30000)this.update({state:'reconnecting',error:ERRORS.network});
    }catch(error){
      if(generation!==this.generation||!this.desired)return;
      const code=Object.hasOwn(ERRORS,error.message)?error.message:'network';
      if(['key','permission','tunnel'].includes(code)){
        this.desired=null;await this.stopProcess();if(generation!==this.generation||this.closed)return;this.update({state:'failed',error:ERRORS[code]});
      }else{
        await this.stopProcess();if(generation!==this.generation||!this.desired||this.closed)return;this.retryAt=Date.now()+[2000,5000,15000,30000][Math.min(this.attempts++,3)];this.update({state:'reconnecting',error:ERRORS[code]||ERRORS.network});
      }
    }finally{this.monitorBusy=false;}
  }
  async stopProcess(){const child=this.process,file=this.healthFile;this.process=null;try{fs.unlinkSync(file);}catch{}await stopTree(child);try{fs.unlinkSync(file);}catch{}}
  async disconnect(){const generation=++this.generation;this.desired=null;this.cancelProbe?.();await this.stopProcess();if(this.probeChild)await stopTree(this.probeChild);await this.gateway?.stop();if(generation===this.generation)this.update({state:'stopped',error:''});return this.status();}
  async close(){this.closed=true;clearInterval(this.timer);await this.disconnect();await this.gateway?.close();}
}
module.exports={RuntimeManager,ERRORS,reason,cleanEnvironment,shellQuote,stopTree,healthRequest};
