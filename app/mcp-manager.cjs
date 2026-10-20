'use strict';
const {version: appVersion} = require('../package.json');

const {EventEmitter} = require('node:events');
const crypto = require('node:crypto');
const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
const {StreamableHTTPClientTransport} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const {ListToolsResultSchema,CallToolResultSchema,ToolListChangedNotificationSchema,McpError,ErrorCode} = require('@modelcontextprotocol/sdk/types.js');
const {ManagedStdioTransport,toolEnvironment,boundedMessage,observeTransport,boundedFetch,MAX_MESSAGE_BYTES,startupDiagnostic} = require('./mcp-transport.cjs');

/** @typedef {'deny'|'allow'|'ask'} McpToolPolicy */
/**
 * @typedef {Object} McpConnectionState
 * @property {'stopped'|'connecting'|'ready'|'failed'|'reconnecting'} phase
 * @property {string} error Sanitized diagnostic code, never a transport error body.
 * @property {string} protocolVersion Independently negotiated downstream version.
 */
/**
 * @typedef {Object} McpCallApproval
 * @property {string} id Opaque, one-use confirmation ID.
 * @property {string} serverId
 * @property {string} serverName
 * @property {string} toolName
 * @property {Object} arguments Display copy with configured secrets redacted.
 * @property {number} expiresAt
 */

const BUILTIN = 'builtin';
const MAX_TOOLS = 1024;
const CONNECT_TIMEOUT = 20000;
const copy = value => JSON.parse(JSON.stringify(value));
function stable(value) {
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}
const fingerprint = value => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
function issue(code) {return Object.assign(new Error(code),{code});}
function errorCode(error) {
  if(/^MCP_[A-Z_]+$/.test(error?.code||''))return error.code;
  if(/^MCP_[A-Z_]+$/.test(error?.message||''))return error.message;
  if(error?.code===ErrorCode.RequestTimeout)return 'MCP_TIMEOUT';
  if(error?.code===ErrorCode.ConnectionClosed)return 'MCP_DISCONNECTED';
  if(['SECRET_MISSING','ENCRYPTION_UNAVAILABLE','DECRYPTION_FAILED'].includes(error?.code))return 'MCP_SECRET_MISSING';
  if(error?.name==='McpSettingsError')return 'MCP_INVALID_CONFIG';
  if(['MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND','ENOENT','EACCES','EPERM'].includes(error?.code))return startupDiagnostic(error).code;
  const text=String(error?.message||'');
  if(/protocol.*(?:version|invalid)|not supported/i.test(text))return 'MCP_PROTOCOL_UNSUPPORTED';
  if(error?.code===401||error?.code===403||/\b(?:401|403)\b|unauthorized/i.test(text))return 'MCP_AUTH_REQUIRED';
  return 'MCP_CONNECTION_FAILED';
}
function failed(code,started=false) {
  const hints={
    MCP_TOOL_DENIED:['This tool is disabled or unavailable.','Enable the intended tool in the desktop MCP settings.'],
    MCP_SERVICE_UNAVAILABLE:['The registered MCP service is currently unavailable; this request has not been executed.','Check this service connection in the desktop app. Once restored, retry this unstarted request; query saved tasks before repeating earlier operations.'],
    MCP_APPROVAL_DENIED:['The local confirmation was declined or expired.','Approve a new request in the desktop app if you still want to run it.'],
    MCP_TIMEOUT:['The service exceeded its request deadline.','Inspect the saved task or service state before retrying a mutation.'],
    MCP_DISCONNECTED:['The MCP service disconnected.','Wait for reconnection; query existing tasks instead of restarting them.'],
    MCP_STOPPED:['The local gateway is stopped.','Connect the desktop app before calling this tool.'],
    MCP_TOOLS_CHANGED:['This tool definition changed during the call.','Refresh its definition and review its saved permission.'],
    MCP_POLICY_CHANGED:['The local tool permission changed.','Review the current permission in the desktop app.'],
    MCP_AUTH_REQUIRED:['The service requires authentication.','Check the credentials for this MCP service in the desktop app.'],
    MCP_SERVER_BUSY:['The service has too many active calls.','Wait for an active call to finish, then retry.'],
    MCP_CANCELLED:['The request was cancelled.','Check the original task status before retrying a mutation.']
  };
  const [message,next_action]=hints[code]||['The MCP request could not complete.','Check this service connection and its diagnostic code in the desktop app.'];
  const data={code,message,next_action,operation_executed:started?null:false,execution_state:started?'unknown':'not_started'};
  return {isError:true,content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data};
}
function alias(id,name) {
  const candidate=`${id}__${name}`;
  return /^[A-Za-z0-9_.-]{1,128}$/.test(candidate)?candidate:`${id}__t_${fingerprint(name).slice(0,24)}`;
}
function redact(value,secrets=[]) {
  if(typeof value==='string'){
    for(const secret of [...new Set(secrets)].filter(item=>typeof item==='string'&&item).sort((a,b)=>b.length-a.length))if(value.includes(secret))value=value.split(secret).join('[redacted]');
    return value;
  }
  if(Array.isArray(value))return value.map(item=>redact(item,secrets));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,redact(item,secrets)]));
  return value;
}

/** App-owned MCP clients. This class never accepts settings from model calls. */
class McpManager extends EventEmitter {
  constructor({settings,builtinFactory,services,enableContent=false,enableProjectGrants=false,nodePath=process.execPath,processHost,fetcher=globalThis.fetch,log=()=>{},callTimeout=60000}={}) {
    super();Object.assign(this,{settings,builtinFactory,services,nodePath,processHost,fetcher,log,callTimeout});
    this.records=new Map();this.approvals=new Map();this.active=new Set();this.running=false;this.closed=false;this.epoch=0;
    this.projectGrants=enableProjectGrants?new (require('./project-grants.cjs').ProjectGrants)(settings.directory):undefined;
    this.content=enableContent?new (require('./mcp-content.cjs').McpContent)(this):undefined;
    this.toolsVersion=0;this.visibleFingerprint='';this.visibleDefinitions=new Map();
  }
  changed() {
    const tools=this.visibleTools(),version=fingerprint(tools);
    if(version!==this.visibleFingerprint){
      const definitions=new Map(tools.map(tool=>[tool.name,fingerprint(tool)]));
      let added=0,removed=0,changed=0;
      for(const [name,hash] of definitions)if(!this.visibleDefinitions.has(name))++added;else if(this.visibleDefinitions.get(name)!==hash)++changed;
      for(const name of this.visibleDefinitions.keys())if(!definitions.has(name))++removed;
      this.visibleDefinitions=definitions;this.visibleFingerprint=version;++this.toolsVersion;
      this.log('mcp-catalog',{version:this.toolsVersion,count:tools.length,fingerprint:version,added,removed,changed});
      this.emit('toolsChanged');
    }
    if(this.content){
      const resources = [...this.records.values()].filter(record => this.available(record) && record.capabilities?.resources).map(record => [record.id, record.generation]);
      const prompts = [...this.records.values()].filter(record => this.available(record) && record.capabilities?.prompts).map(record => [record.id, record.generation]);
      for(const [kind, value] of [['resources', resources], ['prompts', prompts]]){
        const snapshot = JSON.stringify(value);
        if(this.contentVisibility?.[kind] !== snapshot){
          if(!this.contentVisibility)this.contentVisibility = {};
          this.contentVisibility[kind] = snapshot;
          this.content.pages.clear();
          this.emit(kind + 'Changed');
        }
      }
    }
    this.emit('state');
  }
  logConnection(record,phase,details={}) {this.log('mcp-connection',{server:record.id,phase,generation:record.generation,...details});}
  record(id) {
    if(!this.records.has(id))this.records.set(id,{id,phase:'stopped',error:'',tools:[],generation:0,attempts:0});
    return this.records.get(id);
  }
  status() {
    const servers=this.settings.list().map(config=>{
      const record=this.records.get(config.id);
      return {...config,phase:record?.phase||'stopped',error:record?.error||'',startup_error:record?.startupError||null,protocolVersion:record?.protocolVersion||'',
        tools:(record?.tools||[]).map(item=>({...copy(item.tool),exposedName:item.alias,policy:this.policy(record,item),savedPolicy:this.settings.getToolPolicy(config.id,item.tool.name,item.fingerprint),projectGrants:this.projectGrants?.projects(record,item)||[]}))};
    });
    const builtin=this.records.get(BUILTIN);
    const required=servers.filter(config=>config.enabled&&config.trusted).map(config=>config.id);
    if(this.builtinFactory&&this.desktopSettings?.directories?.length)required.push(BUILTIN);
    const missing_capabilities=required.filter(id=>!this.available(this.record(id))).map(id=>{
      const record=this.record(id);
      return {service_id:id,capability:'tools',phase:record.phase,code:record.error||'MCP_SERVICE_UNAVAILABLE'};
    });
    const count=this.visibleTools().length,tools_ready=this.running&&count>0&&missing_capabilities.length===0;
    const tools_health=!this.running?'stopped':missing_capabilities.length?(count?'degraded':'unavailable'):(count?'ready':'unavailable');
    return {servers,tools_health,tools_ready,missing_capabilities,allowAllTools:this.settings.getAllowAllTools(),builtin:{phase:builtin?.phase||'stopped',error:builtin?.error||'',startup_error:builtin?.startupError||null,toolsCount:builtin?.tools.length||0},
      approvals:[...this.approvals.values()].map(value=>copy(value.public)),toolsVersion:this.toolsVersion};
  }
  policy(record,item,project) {if(record.id===BUILTIN||this.settings.getAllowAllTools())return 'allow';const policy=this.settings.getToolPolicy(record.id,item.tool.name,item.fingerprint);return policy==='ask'&&this.projectGrants?.matches(record,item,project)?'allow':policy;}
  available(record) {
    if(record.phase!=='ready')return false;
    if(record.id===BUILTIN)return true;
    try{return this.settings.get(record.id).enabled&&this.settings.isTrusted(record.id);}catch{return false;}
  }
  visibleTools() {
    const result=this.running?[...(this.services?.tools()||[]),...(this.content?.tools()||[])]:[];
    for(const record of this.records.values())if(this.available(record))for(const item of record.tools)if(this.policy(record,item)!=='deny')result.push({...this.content?.decorateTool(record,item.tool)||item.tool,name:item.alias});
    return result.sort((a,b)=>a.name.localeCompare(b.name));
  }
  listTools(cursor) {
    const tools=this.visibleTools();let offset=0;
    if(cursor!==undefined){
      const match=/^(\d+):(\d+)$/.exec(String(cursor));
      if(!match||Number(match[1])!==this.toolsVersion||Number(match[2])>=tools.length)throw issue('MCP_CURSOR_EXPIRED');
      offset=Number(match[2]);
    }
    const page=[];let bytes=1024;
    for(;offset<tools.length&&page.length<64;offset++){
      const size=Buffer.byteLength(JSON.stringify(tools[offset]));
      if(bytes+size>MAX_MESSAGE_BYTES-1024)break;
      page.push(copy(tools[offset]));bytes+=size;
    }
    if(!page.length&&offset<tools.length)throw issue('MCP_MESSAGE_TOO_LARGE');
    return {tools:page,...(offset<tools.length?{nextCursor:`${this.toolsVersion}:${offset}`}:{})};
  }
  async start(desktopSettings) {
    if(this.closed)throw issue('MCP_STOPPED');
    const epoch=this.epoch;this.running=true;
    this.desktopSettings=copy(desktopSettings);
    this.services?.configure(desktopSettings);
    const jobs=[];
    if(desktopSettings.directories?.length&&this.builtinFactory)jobs.push(this.connect(BUILTIN));
    else if(this.records.has(BUILTIN))jobs.push(this.disconnect(this.records.get(BUILTIN)));
    for(const config of this.settings.list())if(config.enabled&&config.trusted)jobs.push(this.connect(config.id));
    await Promise.allSettled(jobs);
    if(epoch!==this.epoch||!this.running)throw issue('MCP_STOPPED');
    await this.broker?.start();
    if(epoch!==this.epoch||!this.running){await this.broker?.stop();throw issue('MCP_STOPPED');}
    const count=this.visibleTools().length;
    if(!count)throw issue('MCP_NO_TOOLS');
    return count;
  }
  environment() {return this.broker?.environment()||{};}
  async syncServer(id) {
    const config=this.settings.get(id),record=this.record(id);
    const current=this.settings.runtimeFingerprint(id);
    if(!config.enabled||!this.settings.isTrusted(id)||record.configFingerprint!==current)await this.disconnect(record);
    if(config.enabled&&this.settings.isTrusted(id)&&this.running)await this.connect(id);
    this.changed();
  }
  async setEnabled(id,enabled) {
    if(typeof enabled!=='boolean')throw issue('MCP_INVALID_CONFIG');
    if(enabled&&!this.settings.isTrusted(id))throw issue('MCP_TRUST_REQUIRED');
    this.settings.setEnabled(id,enabled);
    if(enabled){this.running=true;await this.connect(id);}else await this.disconnect(this.record(id));
    this.changed();
  }
  async test(id) {
    if(!this.settings.isTrusted(id))throw issue('MCP_TRUST_REQUIRED');
    const record=this.record(id),temporary=!this.settings.get(id).enabled;
    try{await this.connect(id,{testing:true});return this.status();}
    finally{if(temporary&&!this.settings.get(id).enabled)await this.disconnect(record);}
  }
  setToolPolicy({serverId,toolName,policy}) {
    const record=this.records.get(serverId),item=record?.tools.find(value=>value.tool.name===toolName);
    if(!item||!['deny','allow','ask'].includes(policy))throw issue('MCP_INVALID_TOOL_POLICY');
    const previous=new Map([...this.active].filter(operation=>operation.record===record&&operation.item===item).map(operation=>[operation,this.policy(record,item,operation.projectPath)]));
    this.settings.setToolPolicy(serverId,toolName,policy,item.fingerprint);this.projectGrants?.remove(serverId,toolName);
    for(const [operation,before]of previous)if(this.policy(record,item,operation.projectPath)!==before)operation.controller.abort(issue('MCP_POLICY_CHANGED'));
    this.changed();
  }
  setAllowAllTools(enabled) {
    if(typeof enabled!=='boolean')throw issue('MCP_INVALID_CONFIG');
    if(enabled===this.settings.getAllowAllTools())return;
    const previous=new Map([...this.active].map(operation=>[operation,this.policy(operation.record,operation.item,operation.projectPath)]));
    // Persist first so a failed save cannot change access or interrupt calls.
    this.settings.setAllowAllTools(enabled);
    for(const [operation,policy] of previous)if(this.policy(operation.record,operation.item,operation.projectPath)!==policy)operation.controller.abort(issue('MCP_POLICY_CHANGED'));
    this.log('mcp-tool-access',{allowAllTools:enabled});this.changed();
  }
  async connect(id,{testing=false}={}) {
    const record=this.record(id);
    if(record.connecting)return record.connecting;
    if(record.phase==='ready'){if(!testing||this.settings.get(id).enabled)record.testing=false;return;}
    clearTimeout(record.retryTimer);
    const generation=++record.generation,epoch=this.epoch;
    record.phase='connecting';record.error='';record.startupError=null;record.testing=testing&&record.id!==BUILTIN&&!this.settings.get(id).enabled;record.terminalError='';record.controller=new AbortController();this.logConnection(record,'connecting');this.changed();
    record.connecting=this.open(record,generation,epoch).finally(()=>{record.connecting=null;});
    return record.connecting;
  }
  async open(record,generation,epoch) {
    let transport,client;
    const timer=setTimeout(()=>record.controller.abort(issue('MCP_CONNECT_TIMEOUT')),CONNECT_TIMEOUT);timer.unref?.();
    try{
      let config;
      if(record.id===BUILTIN){config=await this.builtinFactory(this.desktopSettings);record.configFingerprint=fingerprint(this.desktopSettings);}
      else{
        if(!this.settings.isTrusted(record.id))throw issue('MCP_TRUST_REQUIRED');
        record.configFingerprint=this.settings.runtimeFingerprint(record.id);config=this.settings.resolve(record.id);
        record.secretValues=Object.values(config.transport==='stdio'?(config.env||{}):(config.headers||{}));
        config.env=toolEnvironment(process.env,config.env,this.nodePath);
      }
      if(record.controller.signal.aborted||epoch!==this.epoch||generation!==record.generation)throw issue('MCP_STOPPED');
      record.timeoutMs=Math.min(90000,Math.max(1,config.timeoutMs||this.callTimeout));
      const inspect=message=>{if(message.result?.protocolVersion)record.protocolVersion=message.result.protocolVersion;};
      if(config.transport==='streamable-http'){
        transport=observeTransport(new StreamableHTTPClientTransport(new URL(config.url),{
          requestInit:{headers:config.headers,redirect:'error'},fetch:boundedFetch(this.fetcher),
          reconnectionOptions:{initialReconnectionDelay:1000,maxReconnectionDelay:30000,reconnectionDelayGrowFactor:2,maxRetries:0}
        }),inspect);
      }else transport=new ManagedStdioTransport(config,{processHost:this.processHost,nodePath:this.nodePath,onMessage:inspect});
      client=new Client({name:'ChatToHarness',version:appVersion},{capabilities:{}});
      record.client=client;record.transport=transport;
      client.onerror=error=>{
        if(transport.startupError){
          record.startupError=transport.startupError;record.terminalError=transport.startupError.code;
        }else if(/MCP_(MESSAGE_TOO_LARGE|PROTOCOL_INVALID)/.test(error.message)){
          record.terminalError=errorCode(error);void client.close();
        }else if(config.transport==='streamable-http'&&record.client===client&&!record.stopping&&!record.controller.signal.aborted){
          // The SDK reports a dropped SSE stream through onerror without
          // onclose. Reinitialize the connection, never the interrupted call.
          void this.failConnection(record,error);
        }
      };
      client.onclose=()=>{
        if(record.client!==client||record.stopping)return;
        this.abortRecord(record,record.terminalError||'MCP_DISCONNECTED');record.phase='failed';record.error=record.terminalError||'MCP_CONNECTION_FAILED';
        this.logConnection(record,'closed',{code:record.error});
        this.changed();if(!record.connecting)this.retry(record);
      };
      client.setNotificationHandler(ToolListChangedNotificationSchema,()=>{
        if(record.client===client&&record.phase==='ready'){
          this.log('mcp-tools-notified',{server:record.id,generation:record.generation});
          void this.refreshTools(record,client).catch(error=>this.failConnection(record,error));
        }
      });
      await client.connect(transport,{signal:record.controller.signal,timeout:CONNECT_TIMEOUT});
      record.capabilities=client.getServerCapabilities()||{};
      if(this.content){
        const schemas=require('@modelcontextprotocol/sdk/types.js');
        if(record.capabilities.resources)client.setNotificationHandler(schemas.ResourceListChangedNotificationSchema,()=>this.emit('resourcesChanged'));
        if(record.capabilities.prompts)client.setNotificationHandler(schemas.PromptListChangedNotificationSchema,()=>this.emit('promptsChanged'));
      }
      if(record.capabilities.tools)await this.refreshTools(record,client);else record.tools=[];
      if(epoch!==this.epoch||generation!==record.generation||record.controller.signal.aborted)throw issue('MCP_STOPPED');
      record.phase='ready';record.error='';record.startupError=null;record.terminalError='';record.attempts=0;this.logConnection(record,'ready',{count:record.tools.length});this.changed();
    }catch(error){
      if(record.client===client){record.stopping=true;await client?.close().catch(()=>{});record.stopping=false;record.client=null;}
      if(generation===record.generation){
        record.phase='failed';record.error=record.controller.signal.aborted?'MCP_STOPPED':record.terminalError||errorCode(error);
        if(!record.startupError&&['MCP_MODULE_NOT_FOUND','MCP_FILE_NOT_FOUND','MCP_ACCESS_DENIED','MCP_COMPONENT_INVALID','MCP_START_FAILED'].includes(record.error))record.startupError=startupDiagnostic({code:record.error});
        this.logConnection(record,'failed',{code:record.error});this.changed();this.retry(record);
      }
      throw issue(record.terminalError||errorCode(error));
    }finally{clearTimeout(timer);}
  }
  retry(record) {
    if(this.closed||!this.running||record.testing||record.error==='MCP_STOPPED'||['MCP_AUTH_REQUIRED','MCP_PROTOCOL_UNSUPPORTED','MCP_PROTOCOL_INVALID','MCP_MESSAGE_TOO_LARGE','MCP_SECRET_MISSING','MCP_TRUST_REQUIRED','MCP_INVALID_CONFIG','MCP_TOOL_NAME_CONFLICT','MCP_MODULE_NOT_FOUND','MCP_FILE_NOT_FOUND','MCP_ACCESS_DENIED','MCP_COMPONENT_INVALID'].includes(record.error))return;
    if(record.id!==BUILTIN){try{if(!this.settings.get(record.id).enabled||!this.settings.isTrusted(record.id))return;}catch{return;}}
    record.phase='reconnecting';clearTimeout(record.retryTimer);
    const epoch=this.epoch,delayMs=[1000,3000,10000,30000][Math.min(record.attempts++,3)];
    this.logConnection(record,'retry',{attempt:record.attempts,delayMs,code:record.error});
    record.retryTimer=setTimeout(()=>{if(epoch===this.epoch&&this.running)void this.connect(record.id).catch(()=>{});},delayMs);
    record.retryTimer.unref?.();this.changed();
  }
  async failConnection(record,error) {
    if(record.failing)return record.failing;
    record.terminalError=errorCode(error);
    record.failing=Promise.resolve(record.client?.close()).catch(()=>{}).finally(()=>{record.failing=null;});
    return record.failing;
  }
  async refreshTools(record,client) {
    if(record.refreshing)return record.refreshing;
    record.refreshing=(async()=>{
      const tools=[],seen=new Set();let cursor,bytes=0;
      const timeout=AbortSignal.timeout(CONNECT_TIMEOUT);
      const signal=AbortSignal.any([record.controller.signal,timeout]);
      for(let page=0;page<128;page++){
        const result=await client.request({method:'tools/list',params:cursor?{cursor}:{}},ListToolsResultSchema,{signal,timeout:CONNECT_TIMEOUT});
        boundedMessage({jsonrpc:'2.0',id:0,result});
        for(const tool of result.tools){
          const exposed=record.id===BUILTIN?tool.name:alias(record.id,tool.name);
          if(!tool.name||seen.has(exposed))throw issue('MCP_PROTOCOL_INVALID');seen.add(exposed);
          bytes+=Buffer.byteLength(JSON.stringify(tool));
          if(bytes>16*1024*1024||tools.length>=MAX_TOOLS)throw issue('MCP_MESSAGE_TOO_LARGE');
          tools.push({tool:copy(tool),alias:exposed,fingerprint:fingerprint(tool)});
        }
        cursor=result.nextCursor;if(!cursor)break;
        if(page===127)throw issue('MCP_PROTOCOL_INVALID');
      }
      if(record.client!==client||signal.aborted)throw issue('MCP_DISCONNECTED');
      const aliases=new Set(tools.map(item=>item.alias));
      if([...(this.services?.tools()||[]),...(this.content?.tools()||[])].some(tool=>aliases.has(tool.name)))throw issue('MCP_TOOL_NAME_CONFLICT');
      for(const other of this.records.values())if(other!==record&&other.tools.some(item=>aliases.has(item.alias)))throw issue('MCP_TOOL_NAME_CONFLICT');
      // Only removed or redefined tools invalidate their captured calls.
      // List ordering and changes to unrelated tools do not affect a grant.
      const previous=new Map(record.tools.map(item=>[item.alias,item])),next=new Map(tools.map(item=>[item.alias,item]));
      for(const operation of this.active)if(operation.record===record&&next.get(operation.item.alias)?.fingerprint!==operation.item.fingerprint)operation.controller.abort(issue('MCP_TOOLS_CHANGED'));
      if(record.id!==BUILTIN){const fingerprints=new Map(tools.map(item=>[item.tool.name,item.fingerprint]));this.settings.reconcileTools(record.id,fingerprints);this.projectGrants?.reconcile(record,fingerprints);}
      // Preserve identity so later policy changes can still cancel unchanged
      // operations that were captured before this refresh.
      record.tools=tools.map(item=>previous.get(item.alias)?.fingerprint===item.fingerprint?previous.get(item.alias):item);this.changed();
    })().finally(()=>{record.refreshing=null;});
    return record.refreshing;
  }
  approve({id,allow,remember='once'}) {
    if(typeof id!=='string'||typeof allow!=='boolean'||!['once','project','tool'].includes(remember))throw issue('MCP_INVALID_APPROVAL');
    const approval=this.approvals.get(id);
    if(!approval||Date.now()>=approval.public.expiresAt)throw issue('MCP_APPROVAL_EXPIRED');
    const operation=approval.operation;
    if(allow&&remember==='project'){
      if(!operation.projectPath||!this.projectGrants)throw issue('MCP_INVALID_APPROVAL');
      this.projectGrants.remember(operation.record,operation.item,operation.projectPath);
    }else if(allow&&remember==='tool')this.settings.setToolPolicy(operation.record.id,operation.item.tool.name,'allow',operation.item.fingerprint);
    approval.finish(allow);
    if(allow&&remember!=='once')for(const pending of [...this.approvals.values()])if(pending.operation.record===operation.record&&pending.operation.item===operation.item&&this.policy(pending.operation.record,pending.operation.item,pending.operation.projectPath)==='allow')pending.finish(true);
    this.changed();return this.status();
  }
  requestApproval(operation,args,deadline) {
    return new Promise(resolve=>{
      const id=crypto.randomBytes(20).toString('hex');
      const signal=operation.controller.signal;
      const publicValue={id,serverId:operation.record.id,serverName:this.settings.get(operation.record.id).name,toolName:operation.item.tool.name,arguments:redact(args,operation.record.secretValues),...(operation.projectPath?{projectPath:operation.projectPath}:{}),expiresAt:Math.min(deadline,Date.now()+30000)};
      const finish=allow=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);this.approvals.delete(id);this.emit('state');resolve(allow);};
      const cancel=()=>finish(false),timer=setTimeout(cancel,Math.max(0,publicValue.expiresAt-Date.now()));timer.unref?.();
      this.approvals.set(id,{public:publicValue,finish,operation});signal.addEventListener('abort',cancel,{once:true});
      this.emit('approval');this.emit('state');if(signal.aborted)cancel();
    });
  }
  async call(name,args={}, options={}) {
    const history=this.history;
    if(!history)return this.dispatch(name,args,options);
    const service=[...this.records.values()].find(r=>r.tools.some(t=>t.alias===name));
    const id=options.executionId||history.begin(name,args,service?.id||(this.content?.has(name)?'MCP content':'Harness'),service?.secretValues||[]);
    history.update(id,{service:redact(service?.id||(this.content?.has(name)?'MCP content':'Harness'),service?.secretValues||[])});
    const cancel=()=>history.update(id,{state:'cancelling'});options.signal?.addEventListener('abort',cancel,{once:true});
    try{const result=await this.dispatch(name,args,{...options,executionId:id});history.complete(id,result,null,service?.secretValues||[]);return result;}
    catch(error){history.complete(id,null,error,service?.secretValues||[]);throw error;}
    finally{options.signal?.removeEventListener('abort',cancel);}
  }
  async dispatch(name,args={}, {signal,onprogress,executionId}={}) {
    if(this.content?.has(name)){this.history?.update(executionId,{state:'running',started_at:this.history.now()});return this.running?this.content.call(name,args,{signal,onprogress}):failed('MCP_STOPPED');}
    if(this.services?.has(name)){this.history?.update(executionId,{state:'running',started_at:this.history.now()});return this.running?this.services.call(name,args,{signal,onprogress}):failed('MCP_STOPPED');}
    let record,item;
    for(const candidate of this.records.values()){
      const match=candidate.tools.find(value=>value.alias===name);
      if(match){record=candidate;item=match;break;}
    }
    if(!item){
      // The browser may still hold the previous tool catalog after a service
      // fails before discovery. Saved access identifies that unavailable
      // service without granting access or fabricating a tool definition.
      for(const config of this.settings?.list?.()||[])if(config.enabled&&config.trusted){
        const candidate=this.records.get(config.id);
        if(candidate?.phase==='ready')continue;
        const granted=Object.entries(this.settings.listToolPolicies(config.id)).some(([tool,grant])=>grant.policy!=='deny'&&alias(config.id,tool)===name);
        if(granted||(this.settings.getAllowAllTools()&&name.startsWith(config.id+'__')))return failed('MCP_SERVICE_UNAVAILABLE');
      }
      if(this.running&&this.builtinFactory&&this.desktopSettings?.directories?.length&&this.records.get(BUILTIN)?.phase!=='ready'&&!name.includes('__'))return failed('MCP_SERVICE_UNAVAILABLE');
      return failed('MCP_TOOL_DENIED');
    }
    if(this.policy(record,item)==='deny')return failed('MCP_TOOL_DENIED');
    if(!this.available(record)){
      // Disabled or untrusted services remain denied. A permitted tool whose
      // service disconnected is a different, explicitly unstarted failure.
      if(record.id!==BUILTIN){try{const config=this.settings.get(record.id);if(!config.enabled||!this.settings.isTrusted(record.id))return failed('MCP_TOOL_DENIED');}catch{return failed('MCP_TOOL_DENIED');}}
      if(!this.running&&record.phase==='stopped')return failed('MCP_STOPPED');
      return failed('MCP_SERVICE_UNAVAILABLE');
    }
    if(!args||typeof args!=='object'||Array.isArray(args))return failed('MCP_INVALID_ARGUMENTS');
    if(this.active.size>=128||[...this.active].filter(value=>value.record===record).length>=16)return failed('MCP_SERVER_BUSY');
    const argumentsCopy=copy(args),generation=record.generation,client=record.client,controller=new AbortController();
    const operation={record,item,controller,started:false};this.active.add(operation);
    const startedAt=Date.now(),deadline=startedAt+record.timeoutMs;
    const timeout=setTimeout(()=>controller.abort(issue('MCP_TIMEOUT')),record.timeoutMs);timeout.unref?.();
    const cancel=()=>controller.abort(issue('MCP_CANCELLED'));signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    let approval='not_required',result;
    try{
      boundedMessage({jsonrpc:'2.0',id:0,method:'tools/call',params:{name:item.tool.name,arguments:argumentsCopy}});
      if(this.projectGrants)operation.projectPath=await require('./project-grants.cjs').approvalProject(argumentsCopy,item,this.desktopSettings?.directories||[]);
      if(this.policy(record,item,operation.projectPath)==='ask'){
        this.history?.update(executionId,{state:'waiting_approval'});
        approval=await this.requestApproval(operation,argumentsCopy,deadline)?'allowed':'denied';
        if(approval!=='allowed')return result=failed(controller.signal.aborted?(controller.signal.reason?.code||'MCP_CANCELLED'):'MCP_APPROVAL_DENIED');
      }
      if(controller.signal.aborted||record.generation!==generation||record.client!==client||!this.available(record)||this.policy(record,item,operation.projectPath)==='deny')return result=failed('MCP_CANCELLED');
      operation.started=true;this.history?.update(executionId,{state:'running',started_at:this.history.now()});
      const params={name:item.tool.name,arguments:argumentsCopy};
      result=await client.request({method:'tools/call',params},CallToolResultSchema,{signal:controller.signal,timeout:Math.max(1,deadline-Date.now()),onprogress});
      if(this.content && result?.content)result={...result,content:result.content.map(block=>this.content.rewriteBlock(record.id,block))};
      boundedMessage({jsonrpc:'2.0',id:0,result});return result;
    }catch(error){
      if(error instanceof McpError&&![ErrorCode.ConnectionClosed,ErrorCode.RequestTimeout].includes(error.code)){
        result={isError:true};throw error;
      }
      const code=controller.signal.aborted?(controller.signal.reason?.code||'MCP_CANCELLED'):errorCode(error);
      if(record.transport instanceof StreamableHTTPClientTransport){
        if(!controller.signal.aborted&&['MCP_AUTH_REQUIRED','MCP_CONNECTION_FAILED','MCP_DISCONNECTED','MCP_MESSAGE_TOO_LARGE'].includes(code))void this.failConnection(record,error);
      }
      return result=failed(code,operation.started);
    }finally{
      clearTimeout(timeout);signal?.removeEventListener('abort',cancel);this.active.delete(operation);
      this.log('mcp-call',{server:record.id,tool:redact(item.tool.name,record.secretValues),durationMs:Date.now()-startedAt,approval,result:result?.isError?'error':'complete',executionState:result?.isError?(operation.started?'unknown':'not_started'):'complete'});
    }
  }
  abortRecord(record,code) {
    for(const operation of this.active)if(operation.record===record)operation.controller.abort(issue(code));
  }
  async disconnect(record) {
    ++record.generation;clearTimeout(record.retryTimer);record.controller?.abort(issue('MCP_STOPPED'));this.abortRecord(record,'MCP_STOPPED');
    record.stopping=true;record.phase='stopped';record.error='';this.logConnection(record,'stopped');
    const client=record.client;record.client=null;
    this.changed();await client?.close().catch(()=>{});
    if(record.connecting)await record.connecting.catch(()=>{});
    record.secretValues=[];record.stopping=false;this.changed();
  }
  async remove(id) {const record=this.records.get(id);if(record)await this.disconnect(record);this.settings.remove(id);this.projectGrants?.remove(id);this.records.delete(id);this.changed();}
  async stop() {
    ++this.epoch;this.running=false;
    await Promise.allSettled([...this.records.values()].map(record=>this.disconnect(record)));
    await this.broker?.stop();this.changed();
  }
  async close(){this.closed=true;await this.stop();await this.broker?.close();this.services?.dispose();this.content?.dispose();}
}

module.exports={McpManager,BUILTIN,fingerprint,alias,errorCode,failed};
