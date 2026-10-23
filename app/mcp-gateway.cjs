'use strict';
const {version: appVersion} = require('../package.json');

const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {Server} = require('@modelcontextprotocol/sdk/server/index.js');
const {ListToolsRequestSchema,CallToolRequestSchema,McpError,ErrorCode} = require('@modelcontextprotocol/sdk/types.js');
const {LineTransport} = require('./mcp-transport.cjs');
const {createSamplingPlanner}=require('./computer-use-sampling-planner.cjs');
const {fromHostMetadata}=require('./computer-use-conversation-title.cjs');
const {McpResultPages,decorateTool} = require('./mcp-result-pages.cjs');
const {fingerprint} = require('./mcp-manager.cjs');
const {DIAGNOSTIC_WORKFLOW}=require('./tool-recovery.cjs');

// No TCP listener or public configuration endpoint. Each app run owns a fresh
// Unix socket / Windows named pipe, authenticated before any MCP bytes parse.
class McpGateway {
  constructor(manager) {
    this.manager=manager;this.sessions=new Set();this.initializedSessions=new WeakSet();this.sockets=new Set();this.epoch=0;this.nextSession=0;
    this.results=new McpResultPages({directory:manager.settings?.directory?path.join(manager.settings.directory,'result-pages'):undefined,
      authorize:source=>source.scope===this.resultScope(source.tool,source.content_server),log:(...args)=>manager.log?.(...args)});
    if(manager.history)manager.history.resultInfo=row=>this.results.describe(row);
    this.changed=()=>{
      let recipients=0;
      for(const session of this.sessions)if(this.initializedSessions.has(session)){++recipients;void session.notification({method:'notifications/tools/list_changed'}).catch(()=>{});}
      this.manager.log?.('mcp-list-notification',{recipients,toolsVersion:this.manager.toolsVersion});
    };
    manager.on('toolsChanged',this.changed);
    this.contentChanged=kind=>{for(const session of this.sessions)if(this.initializedSessions.has(session))void session.notification({method:`notifications/${kind}/list_changed`}).catch(()=>{});};
    this.resourcesChanged=()=>this.contentChanged('resources');this.promptsChanged=()=>this.contentChanged('prompts');
    manager.on('resourcesChanged',this.resourcesChanged);manager.on('promptsChanged',this.promptsChanged);
  }
  async start() {
    if(this.starting)return this.starting;
    if(this.server)return;
    const epoch=this.epoch;
    this.starting=(async()=>{
      const token=crypto.randomBytes(32).toString('hex');let directory,endpoint,server;
      if(process.platform==='win32')endpoint=`\\\\.\\pipe\\cth-mcp-${process.pid}-${crypto.randomBytes(16).toString('hex')}`;
      else{
        directory=fs.mkdtempSync(path.join(os.tmpdir(),'cth-mcp-'));fs.chmodSync(directory,0o700);
        endpoint=path.join(directory,'gateway.sock');
      }
      try{
        server=net.createServer(socket=>this.accept(socket));
        await new Promise((resolve,reject)=>{
          const fail=error=>{server.off('listening',ready);reject(error);};
          const ready=()=>{server.off('error',fail);resolve();};
          server.once('error',fail);server.once('listening',ready);server.listen(endpoint);
        });
        if(process.platform!=='win32')fs.chmodSync(endpoint,0o600);
        server.on('error',()=>{});
        if(epoch!==this.epoch){await new Promise(resolve=>server.close(resolve));if(directory)fs.rmSync(directory,{recursive:true,force:true});return;}
        Object.assign(this,{server,directory,endpoint,token});
      }catch{
        if(server?.listening)await new Promise(resolve=>server.close(resolve));
        if(directory)fs.rmSync(directory,{recursive:true,force:true});
        throw new Error('MCP_GATEWAY_UNAVAILABLE');
      }
    })().finally(()=>{this.starting=null;});
    return this.starting;
  }
  environment() {
    if(!this.server?.listening||!this.token)throw new Error('MCP_GATEWAY_UNAVAILABLE');
    return {CTH_GATEWAY_ENDPOINT:this.endpoint,CTH_GATEWAY_TOKEN:this.token,CTH_GATEWAY_OWNER:String(process.pid)};
  }
  resultScope(name,contentServer) {
    const tools=this.manager.visibleTools?.()||this.manager.tools||[];
    const tool=tools.find(tool=>tool.name===name);if(!tool)return null;
    const record=[...this.manager.records?.values()||[]].find(record=>record.tools.some(item=>item.alias===name));
    let content;
    if(name.startsWith('mcp_')){
      const records=[...this.manager.records?.values()||[]].filter(record=>!contentServer||record.id===contentServer);
      if(contentServer&&!records.some(record=>this.manager.available(record)))return null;
      content=records.filter(record=>this.manager.available(record)).map(record=>[record.id,record.configFingerprint]).sort((a,b)=>a[0].localeCompare(b[0]));
    }
    return fingerprint({tool,directories:this.manager.desktopSettings?.directories||[],config:record?.configFingerprint,content});
  }
  async toolCall(name,args,options={}) {
    options.signal?.throwIfAborted();
    if(this.results.has(name)){
      const result=await this.results.call(name,args);
      this.manager.history?.complete(options.executionId,result);return result;
    }
    const content_server=name==='mcp_read_resource'?/^(?:cth-resource:\/\/|ui:\/\/cth\/)([a-z][a-z0-9_-]{0,31})\//.exec(args.uri||'')?.[1]
      :name==='mcp_get_prompt'?String(args.name||'').split('::')[0]:undefined;
    const scope=this.resultScope(name,content_server);
    const received=performance.now();
    const result=await this.manager.call(name,args,options);
    const resultReady=performance.now();
    if(!scope)return result;
    const definition=(this.manager.visibleTools?.()||this.manager.tools||[]).find(tool=>tool.name===name);
    // Widget components consume the original structured result directly.
    const preserveOriginal=Boolean(definition?._meta?.ui?.resourceUri||definition?._meta?.['ui/resourceUri']||definition?._meta?.['openai/outputTemplate']);
    const knownBuiltin=Boolean(this.manager.services?.has(name)||this.manager.records?.get('builtin')?.tools.some(item=>item.alias===name));
    const delivered=await this.results.deliver(result,{tool:name,scope,...(options.executionId?{execution_id:options.executionId,execution_version:this.manager.history?.get(options.executionId)?.poll_count||1}:{}),...(content_server?{content_server}:{})},
      {knownBuiltin,capture:true,preserveOriginal,explicitFiles:name==='get_file_result'&&args.preview===true,
        onSaved:ref=>{if(options.executionId)this.manager.history?.update(options.executionId,ref);}});
    this.manager.log?.('mcp-result-ready',{tool:name,execution_id:options.executionId,session:options.session,request:options.request,executionMs:Math.round(resultReady-received),deliveryPreparationMs:Math.round(performance.now()-resultReady),bytes:Buffer.byteLength(JSON.stringify(delivered))});
    return delivered;
  }
  accept(socket) {
    if(this.sockets.size>=32){socket.destroy();return;}
    const acceptedAt=performance.now();
    this.sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>this.sockets.delete(socket));
    let buffer=Buffer.alloc(0);
    const timer=setTimeout(()=>socket.destroy(),5000);timer.unref?.();
    const authenticate=chunk=>{
      buffer=Buffer.concat([buffer,chunk]);const end=buffer.indexOf(10);
      if((end<0&&buffer.length>512)||end>512){socket.destroy();return;}
      if(end<0)return;
      socket.pause();socket.off('data',authenticate);clearTimeout(timer);
      let supplied;
      try{supplied=JSON.parse(buffer.subarray(0,end).toString('utf8')).token;}catch{}
      const expected=Buffer.from(this.token||''),provided=Buffer.from(typeof supplied==='string'?supplied:'');
      if(!expected.length||expected.length!==provided.length||!crypto.timingSafeEqual(expected,provided)){socket.destroy();return;}
      const remaining=buffer.subarray(end+1);buffer=Buffer.alloc(0);if(remaining.length)socket.unshift(remaining);
      socket.write('{"ready":true}\n');
      const session=++this.nextSession,openedAt=performance.now();let initializations=0,nextRequest=0,initializedAt,initializeResponse;
      const executionIds=new Map(),requestTimes=new Map();
      const elapsed=start=>Math.round((performance.now()-start)*1000)/1000;
      // Only fixed protocol methods and local ordinals are recorded. Original
      // JSON-RPC IDs, arguments, response bodies and credentials stay private.
      const timingLog=(phase,timing,details={})=>this.manager.log?.('mcp-timing',{session,request:timing.request,method:timing.method,phase,...(timing.executionId?{execution_id:timing.executionId}:{}),...details});
      const transport=new LineTransport(socket,socket,{close:async()=>socket.destroy(),observeTiming:true,onMessage:(message,frame)=>{
        if(message.id!==undefined&&['initialize','tools/list','tools/call'].includes(message.method)){
          if(requestTimes.size>=128)requestTimes.delete(requestTimes.keys().next().value);
          const timing={request:++nextRequest,method:message.method,receivedAt:performance.now()};requestTimes.set(message.id,timing);
          timingLog('request-received',timing,{frameMs:Math.round(frame.frameMs*1000)/1000,parseMs:Math.round(frame.parseMs*1000)/1000,bytes:frame.bytes,
            ...(initializedAt!==undefined?{sinceInitializedMs:elapsed(initializedAt)}:{})});
        }
        if(message.method==='tools/call'&&message.id!==undefined&&this.manager.history){
          if(executionIds.size>=128){const [key,id]=executionIds.entries().next().value;this.manager.history.update(id,{state:'unknown',finished_at:this.manager.history.now()});executionIds.delete(key);}
          const service=[...this.manager.records?.values()||[]].find(r=>r.tools.some(t=>t.alias===message.params?.name));
          const id=this.manager.history.begin(message.params?.name,message.params?.arguments,service?.id||'Harness',service?.secretValues||[]);executionIds.set(message.id,id);
          const timing=requestTimes.get(message.id);if(timing)timing.executionId=id;
        }
      }});
      const send=transport.send.bind(transport);
      transport.send=async message=>{
        const id=executionIds.get(message.id),timing=requestTimes.get(message.id),writeAt=performance.now();
        if(id&&message.error&&this.manager.history?.get(id)?.state==='received')this.manager.history?.complete(id,null,{code:message.error.code,message:'MCP request rejected'});
        try{
          await send(message);
          if(timing){
            if(timing.method==='initialize')initializeResponse={request:timing.request,writtenAt:performance.now()};
            timingLog('response-written',timing,{durationMs:elapsed(timing.receivedAt),writeMs:elapsed(writeAt),result:message.error?'error':'complete'});
          }
          if(id)this.manager.history?.update(id,{delivery:'local_write_succeeded'});
        }
        catch(error){if(timing)timingLog('response-write-failed',timing,{durationMs:elapsed(timing.receivedAt),writeMs:elapsed(writeAt)});if(id)this.manager.history?.update(id,{delivery:'local_write_failed'});throw error;}
        finally{if(id)executionIds.delete(message.id);if(timing&&requestTimes.get(message.id)===timing)requestTimes.delete(message.id);}
      };
      const server=new Server({name:'ChatToHarness',version:appVersion},{capabilities:{tools:{listChanged:true},...(this.manager.content?{resources:{listChanged:true},prompts:{listChanged:true}}:{})},instructions:'ChatToHarness provides authorized local tools and configured MCP extensions. For a known project or path, call the target tool directly. Use get_harness_status only to diagnose a connection, and get_project_overview only when project structure is needed. Prefer search_project for ordinary searches, read_file with a bounded line range for file reads, and git_status, git_diff and git_log for Git reads. '+DIAGNOSTIC_WORKFLOW+' Prefer apply_project_edit for UTF-8 project edits: new files use expected_sha256="absent", existing files require their current SHA-256. It returns an undo record and actual readback verification; when verification.status="matched" and complete=true, use that text to confirm the write without another read solely for verification. Keep the same idempotency_key after interruption. Prefer start_task for ordinary non-interactive commands: short tasks return bounded output, active tasks return their original task_id and next_arguments. Use start_process for interactive terminals. Follow next_tool only when more work or output is needed. Query persistent tasks with bounded waits. After interruption, inspect get_execution_summary, original task IDs and saved results before any mutation; never deduplicate commands by text. Use start_task for work that may outlive a plugin call; query the original task_id after a timeout or reconnect and reuse its idempotency_key. Large supported results return a useful harness_result_summary and save the full original result. Answer from the preview when it contains the requested evidence; fetch get_tool_result_page only when the remaining detail is needed. Raw pages use result_id and next_offset and must be concatenated before parsing. Read all instruction bodies before retrying a write. Never repeat the source operation just to read its remaining output. Native files are deferred as $harness_file references; use get_tool_result_file only when their content is needed. Use get_file_result for project artifacts, with preview:true only when a native preview is requested. Existing tool arguments, execution and native resource protocols are unchanged. Resource/prompt tools provide fallbacks for clients without a resource browser. Tool access is managed in the desktop application. Interrupted calls are never automatically replayed.'});
      this.sessions.add(server);
      this.manager.log?.('mcp-session',{session,phase:'opened',authenticationMs:Math.round((openedAt-acceptedAt)*1000)/1000});
      server.oninitialized=()=>{
        initializedAt=performance.now();
        this.initializedSessions.add(server);
        this.manager.log?.('mcp-session',{session,phase:'initialized',initializations:++initializations,toolsVersion:this.manager.toolsVersion,
          ...(initializeResponse?{initializeRequest:initializeResponse.request,responseToNotificationMs:elapsed(initializeResponse.writtenAt)}:{})});
      };
      server.onerror=()=>{};server.onclose=()=>{for(const id of executionIds.values()){const row=this.manager.history?.get(id);if(row&&['received','running','waiting_approval'].includes(row.state))this.manager.history.update(id,{state:'unknown',finished_at:this.manager.history.now()});}executionIds.clear();requestTimes.clear();this.sessions.delete(server);this.manager.log?.('mcp-session',{session,phase:'closed',initializations});};
      server.setRequestHandler(ListToolsRequestSchema,request=>{
        try{
          const result=this.manager.listTools(request.params?.cursor);
          this.manager.log?.('mcp-session',{session,phase:'tools-listed',toolsVersion:this.manager.toolsVersion,count:result.tools.length,hasNextPage:Boolean(result.nextCursor)});
          return {...result,tools:[...result.tools.map(decorateTool),...(!request.params?.cursor?this.results.tools():[])]};
        }catch{throw new McpError(ErrorCode.InvalidParams,'MCP_CURSOR_EXPIRED');}
      });
      server.setRequestHandler(CallToolRequestSchema,(request,extra)=>{
        const timing=requestTimes.get(extra.requestId);
        if(timing)timingLog('tool-dispatched',timing,{durationMs:elapsed(timing.receivedAt)});
        return this.toolCall(request.params.name,request.params.arguments||{},
        {executionId:executionIds.get(extra.requestId),session,request:timing?.request,signal:extra.signal,
         hostConversationTitle: request.params.name==='computer_use' && request.params.arguments?.action==='open_session'
           ? fromHostMetadata(request.params._meta) : undefined,
         planner: request.params.name==='computer_use' && request.params.arguments?.action==='start_task'
           ? createSamplingPlanner(()=>server) : undefined,
         onprogress:progress=>{
          const token=request.params._meta?.progressToken;
          if(token!==undefined)void server.notification({method:'notifications/progress',params:{...progress,progressToken:token}}).catch(()=>{});
        }});
      });
      if(this.manager.content){
        const types=require('@modelcontextprotocol/sdk/types.js');
        for(const [schema,method] of [[types.ListResourcesRequestSchema,'resources/list'],[types.ListResourceTemplatesRequestSchema,'resources/templates/list'],[types.ReadResourceRequestSchema,'resources/read'],[types.ListPromptsRequestSchema,'prompts/list'],[types.GetPromptRequestSchema,'prompts/get']])
          server.setRequestHandler(schema,(request,extra)=>this.manager.content.native(method,request.params||{},{signal:extra.signal}).catch(error=>{throw new McpError(ErrorCode.InvalidParams,/^MCP_[A-Z_]+$/.test(error.code||'')?error.code:'MCP_CONTENT_FAILED');}));
      }
      void server.connect(transport).then(()=>this.manager.log?.('mcp-session',{session,phase:'transport-ready',durationMs:elapsed(openedAt)})).catch(()=>{this.sessions.delete(server);socket.destroy();});
    };
    socket.on('data',authenticate);socket.once('close',()=>clearTimeout(timer));
  }
  async stop() {
    ++this.epoch;
    await this.starting?.catch(()=>{});
    const server=this.server;this.server=null;this.token='';
    await Promise.allSettled([...this.sessions].map(session=>session.close()));this.sessions.clear();
    for(const socket of this.sockets)socket.destroy();this.sockets.clear();
    if(server)await new Promise(resolve=>server.close(()=>resolve()));
    if(this.directory)fs.rmSync(this.directory,{recursive:true,force:true});this.directory=null;
  }
  async close(){await this.stop();await this.results.close();this.manager.off('toolsChanged',this.changed);this.manager.off('resourcesChanged',this.resourcesChanged);this.manager.off('promptsChanged',this.promptsChanged);}
}

module.exports={McpGateway};
