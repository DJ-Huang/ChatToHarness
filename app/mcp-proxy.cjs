'use strict';
const path = require('node:path');
const os = require('node:os');
const {StringDecoder} = require('node:string_decoder');
const {SEARCH_TOOL} = require('./project-search.cjs');
const {inside} = require('./project-context.cjs');
const {guidanceRetry,scopeRecovery,DIAGNOSTIC_WORKFLOW} = require('./tool-recovery.cjs');
const WORKFLOW = 'ChatToHarness: local file, search and terminal tools. search_project returns bounded matches with 1-based lines; read_file offsets are 0-based. Reads include optional project guidance and diagnostics. get_project_context discovers optional project skills, loads selected rule/skill bodies and reports matching guidance. A write with newly discovered guidance returns contexts and delivery tokens without execution; a subsequent request can include those tokens. File access uses desktop folder settings. Terminal context_paths describe project scope and do not sandbox the shell. Forwarded timeouts have unknown execution state; mutations are not replayed by the server. '+DIAGNOSTIC_WORKFLOW;
const TOKEN_DESCRIPTION = 'Optional delivered-context tokens. If a write returns fresh guidance, read it and merge retry_patch into the original arguments for an explicit retry.';
const FILE_TOOLS = new Set(['read_file','read_multiple_files','write_file','write_pdf','create_directory','list_directory','move_file','get_file_info','edit_block']);
const SEARCH_TOOLS = new Set(['start_search','get_more_search_results','stop_search','list_searches']);
const TERMINAL_TOOLS = new Set(['start_process','read_process_output','interact_with_process','force_terminate','kill_process','list_sessions','list_processes']);
const MUTATING_TOOLS = new Set(['write_file','write_pdf','create_directory','move_file','edit_block','start_process','interact_with_process']);
const CONTROL_TOOLS = new Set(['stop_search','force_terminate','kill_process']);
const GATED_TOOLS = new Set([...FILE_TOOLS,...SEARCH_TOOLS,...TERMINAL_TOOLS]);
const CONTEXT_TOOL = {
  name:'get_project_context',title:'Load project guidance',
  description:'Read optional AGENTS, rule and skill indexes for an explicit project. task and target_paths report guidance matches; rule_paths and skill_paths select full bodies. Missing references produce diagnostics. Shared references may be in any authorized folder. Returned tokens record delivery and confer no access rights.',
  inputSchema:{type:'object',properties:{project_path:{type:'string',description:'Absolute task project directory or file in a Git project.'},target_paths:{type:'array',items:{type:'string'},maxItems:128},rule_paths:{type:'array',items:{type:'string'},maxItems:128},skill_paths:{type:'array',items:{type:'string'},maxItems:128},task:{type:'string',maxLength:4096}},required:['project_path'],additionalProperties:false},
  outputSchema:{type:'object',properties:{project_path:{type:'string'},target_paths:{type:'array',items:{type:'string'}},agents:{type:'array',items:{type:'object'}},rules_index:{type:'array',items:{type:'object'}},loaded_rules:{type:'array',items:{type:'object'}},skills_index:{type:'array',items:{type:'object'}},loaded_skills:{type:'array',items:{type:'object'}},precedence:{type:'object'},budget:{type:'object'},diagnostics:{type:'array',items:{type:'object'}},context_version:{type:'string'},instruction_version:{type:'string'},project_context_token:{type:'string'},instructions:{type:'string'}},required:['project_path','agents','rules_index','loaded_rules','diagnostics','project_context_token']},
  annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
};
function idKey(id){return `${typeof id}:${String(id)}`;}
function hasId(message){return Object.prototype.hasOwnProperty.call(message,'id');}
function object(value){return value&&typeof value==='object'&&!Array.isArray(value);}
// A structured-first client must not receive project guidance in place of the
// actual tool output. Mirror public content without promoting client-only _meta.
// Keep native blocks untouched so multimodal-capable clients can still render them.
function projectResult(result,contexts=[]){
  const content=Array.isArray(result.content)?result.content:[];
  const upstream=result.structuredContent;
  const data=object(upstream)?upstream:{};
  const mirror={content,isError:result.isError===true};
  if(upstream!==undefined&&(!object(upstream)||Object.hasOwn(data,'_harness_result')||Object.hasOwn(data,'project_contexts'))){
    mirror.upstream_structured_content=upstream;
  }
  return {...result,
    content:contexts.length?[...content,{type:'text',text:JSON.stringify({project_contexts:contexts})}]:content,
    structuredContent:{...data,_harness_result:mirror,project_contexts:contexts}};
}
function projectResultSchema(schema={}){
  return {...schema,type:'object',properties:{...schema.properties,
    _harness_result:{type:'object',description:'Original public MCP result, including native content blocks and the error flag. Inspect this instead of treating project guidance as the tool output.',
      properties:{content:{type:'array',items:{type:'object'}},isError:{type:'boolean'},upstream_structured_content:{}},required:['content','isError']},
    project_contexts:{type:'array',items:{type:'object'}}}};
}
function failure(code,message,details={}){
  const result={code,message,operation_executed:false,execution_state:'not_started',...details};
  return {isError:true,content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};
}
function toolPaths(name,args){
  if(name==='read_file'&&(args.isUrl||/^https?:\/\//i.test(args.path||''))){if(!/^https?:\/\//i.test(args.path||''))throw Object.assign(new Error('URL reads require HTTP or HTTPS.'),{code:'invalid_url'});return [];}
  if(name==='read_multiple_files')return args.paths;
  if(name==='move_file')return [args.source,args.destination];
  if(name==='edit_block'){
    let content=args.content;if(typeof content==='string'&&content.trim().startsWith('['))try{content=JSON.parse(content);}catch{}
    return [args.file_path,args.options?.outputPath,args.options?.sourcePdf,...(Array.isArray(content)?content.map(item=>item?.sourcePdfPath):[])].filter(value=>value!==undefined);
  }
  if(name==='write_pdf'){
    let content=args.content;if(typeof content==='string'&&content.trim().startsWith('['))try{content=JSON.parse(content);}catch{}
    return [args.path,args.outputPath,...(Array.isArray(content)?content.map(item=>item?.sourcePdfPath):[])].filter(value=>value!==undefined);
  }
  if(FILE_TOOLS.has(name)||name==='start_search')return [args.path];
  return [];
}
class McpProxy{
  constructor({contexts,search,enabled=true,defaultDirectory=process.cwd(),sendClient,sendServer,requestTimeout=60000,maxPending=128}){
    Object.assign(this,{contexts,search,enabled,defaultDirectory,sendClient,sendServer,requestTimeout,maxPending});
    this.pending=new Map();this.local=new Map();this.expired=new Set();this.processes=new Map();this.searches=new Map();this.closed=false;
  }
  async reply(id,result){if(!this.closed)await this.sendClient({jsonrpc:'2.0',id,result});}
  expire(key){this.expired.add(key);if(this.expired.size>2048)this.expired.delete(this.expired.values().next().value);}
  beginLocal(message){
    const key=idKey(message.id),operation={cancelled:false,controller:new AbortController()};
    operation.timer=setTimeout(()=>{
      operation.cancelled=true;operation.controller.abort();this.local.delete(key);this.expire(key);
      void this.reply(message.id,failure('request_timeout','The operation timed out before execution; retry after checking the reported paths.')).catch(()=>{});
    },this.requestTimeout);operation.timer.unref?.();this.local.set(key,operation);return operation;
  }
  endLocal(message,operation){clearTimeout(operation.timer);const key=idKey(message.id);if(this.local.get(key)===operation)this.local.delete(key);}
  async client(message){
    if(this.closed)return;
    if(!object(message)||message.jsonrpc!=='2.0'||(hasId(message)&&!['string','number'].includes(typeof message.id)))return this.sendClient({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid JSON-RPC message'}});
    if(message.method==='notifications/cancelled'){
      const key=idKey(message.params?.requestId),local=this.local.get(key);
      if(local){local.cancelled=true;local.controller.abort();clearTimeout(local.timer);this.local.delete(key);this.expire(key);return;}
      const pending=this.pending.get(key);if(pending){clearTimeout(pending.timer);this.pending.delete(key);this.expire(key);}
      return this.sendServer(message);
    }
    if(typeof message.method==='string'&&hasId(message)){
      const key=idKey(message.id);
      if(this.pending.has(key)||this.local.has(key)||this.expired.has(key))return this.sendClient({jsonrpc:'2.0',id:message.id,error:{code:-32600,message:'Use a fresh request ID; this ID is active or cancelled.'}});
      if(this.pending.size+this.local.size>=this.maxPending)return this.reply(message.id,failure('server_busy','Too many pending requests; retry shortly.',{retryable:true,retry_after_ms:250}));
    }
    const name=message.params?.name,args=message.params?.arguments;
    if(message.method==='tools/call'){
      if(!hasId(message))return;
      if(!object(args))return this.reply(message.id,failure('invalid_arguments','Tool arguments must be an object.'));
      if(name==='set_config_value'&&args.key==='allowedDirectories')return this.reply(message.id,failure('directory_settings_required','Change authorized folders in the desktop app; project content and tools cannot expand this boundary.'));
      if(name===CONTEXT_TOOL.name||name===SEARCH_TOOL.name){
        const operation=this.beginLocal(message);
        try{
          let result;
          if(name===CONTEXT_TOOL.name)result=await this.contexts.getContext(args,{signal:operation.controller.signal});
          else{
            if(!this.search)throw Object.assign(new Error('The bundled search component is unavailable.'),{code:'SEARCH_UNAVAILABLE'});
            const prepared=this.enabled?await this.contexts.prepare(args.project_context_tokens, [args.project_path],{projectPath:args.project_path,signal:operation.controller.signal}):null;
            result=await this.search.search(args,{signal:operation.controller.signal});
            if(prepared)result.project_contexts=prepared.contexts;
          }
          if(!operation.cancelled)await this.reply(message.id,{content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result});
        }catch(error){if(!operation.cancelled)await this.reply(message.id,this.contextFailure(error,name,args));}
        finally{this.endLocal(message,operation);}return;
      }
    }
    let forwarded=message,binding;
    if(message.method==='tools/call'){
      const operation=this.beginLocal(message);
      try{if(GATED_TOOLS.has(name))binding=await this.validateCall(name,args,{signal:operation.controller.signal});}
      catch(error){if(!operation.cancelled)await this.reply(message.id,this.contextFailure(error,name,args));return;}
      finally{this.endLocal(message,operation);}
      if(operation.cancelled||this.closed)return;
      const clean={...args};delete clean.project_context_tokens;delete clean.context_paths;delete clean.project_path;
      if(['start_process','read_process_output'].includes(name)){
        const requested = clean.timeout_ms;
        // This bounds the collection wait, never the lifetime of the process.
        // Invalid inputs remain the upstream validator's responsibility.
        if(name==='read_process_output'&&requested===undefined || typeof requested === 'number' && Number.isFinite(requested) && requested >= 0){
          clean.timeout_ms = Math.min(requested ?? 5000,10000);
          operation.waitInfo = {requested_wait_ms: requested ?? null, effective_wait_ms: clean.timeout_ms, wait_limit_ms:10000};
        }
      }
      binding = binding ? {...binding, waitInfo:operation.waitInfo} : operation.waitInfo ? {contexts:[],waitInfo:operation.waitInfo} : binding;
      forwarded={...message,params:{...message.params,arguments:clean}};
    }
    if(hasId(message)&&typeof message.method==='string'){
      const key=idKey(message.id),wait=Number(args?.timeout_ms??args?.timeout);
      const timeout=Number.isFinite(wait)&&wait>0?Math.min(180000,Math.max(this.requestTimeout,wait+5000)):this.requestTimeout;
      const timer=setTimeout(()=>{
        if(!this.pending.delete(key))return;this.expire(key);
        void this.sendServer({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:message.id,reason:'Request deadline exceeded'}}).catch(()=>{});
        const result=failure('request_timeout','The forwarded operation timed out. Its execution result is unknown; do not automatically replay writes or commands.',{operation_executed:null,execution_state:'unknown',retryable:!MUTATING_TOOLS.has(name)&&!CONTROL_TOOLS.has(name)});
        void(message.method==='tools/call'?this.reply(message.id,result):this.sendClient({jsonrpc:'2.0',id:message.id,error:{code:-32000,message:'Request timed out'}})).catch(()=>{});
      },timeout);timer.unref?.();this.pending.set(key,{method:message.method,name,binding,timer,handle:args?.pid??args?.sessionId});
    }
    return this.sendServer(forwarded);
  }
  loadHint(targets){return {next_tool:'get_project_context',default_project_path:this.defaultDirectory,target_paths:targets,instructions:'Supplied contexts contain fresh guidance and delivery tokens for a subsequent request. get_project_context also accepts an explicit task project. The original operation did not execute.'};}
  contextFailure(error,name,args){
    const details=object(error?.details)?error.details:{};
    if(['TARGET_OUTSIDE_PROJECT','PATH_NOT_ALLOWED'].includes(error?.code))return failure(error.code,error.message,{...details,...scopeRecovery(error,name,args)});
    const hint=error?.code==='context_paths_required'
      ? {next_tool:name,next_action:'declare_context_paths_then_retry',recovery_kind:'needs_arguments',instructions:'Provide related context_paths, or an explicit project_path for start_process to use as its default scope. [] is only for ordinary system diagnostics. The operation has not run.'}
      : details.retry_patch ? {} : this.loadHint(details.target_paths||[]);
    return failure(error?.code||'context_error',error?.message||'Project context could not be loaded.',{...hint,...details});
  }
  pruneBindings(map){const cutoff=Date.now()-5*60*1000;for(const [id,binding]of map)if(binding.finishedAt&&binding.finishedAt<cutoff)map.delete(id);}
  async validateCall(name,args,{signal}={}){
    const tokens=args.project_context_tokens;let targets=toolPaths(name,args),origin;
    this.pruneBindings(this.processes);this.pruneBindings(this.searches);
    if(TERMINAL_TOOLS.has(name)){
      const defaultScope=name==='start_process'&&!Object.hasOwn(args,'context_paths')&&
        typeof args.project_path==='string'&&path.isAbsolute(args.project_path)&&
        args.project_path.length<=32768&&!args.project_path.includes('\0') ? [args.project_path] : undefined;
      if(this.enabled&&name==='start_process'&&!Object.hasOwn(args,'context_paths')&&!defaultScope)throw Object.assign(new Error('Declare related context_paths or a valid absolute project_path; [] is only for ordinary system diagnostics.'),{code:'context_paths_required'});
      targets=Object.hasOwn(args,'context_paths') ? args.context_paths : defaultScope||[];
      if(args.pid!==undefined)origin=this.processes.get(String(args.pid));
    }else if(SEARCH_TOOLS.has(name)&&args.sessionId!==undefined)origin=this.searches.get(String(args.sessionId));
    if((['read_process_output','interact_with_process','force_terminate'].includes(name)||['get_more_search_results','stop_search'].includes(name))&&!origin)throw Object.assign(new Error('The process/search handle is unavailable after reconnect or expiry; start a new operation.'),{code:'context_origin_unknown'});
    if(name==='kill_process'&&!origin&&this.enabled&&!Object.hasOwn(args,'context_paths'))throw Object.assign(new Error('Declare context_paths for an untracked process.'),{code:'context_paths_required'});
    if(origin&&Array.isArray(tokens)&&tokens.length&&!tokens.some(token=>origin.tokens.includes(token))){
      const records=tokens.map(token=>this.contexts.contexts?.get(token)).filter(Boolean);
      if(!records.length||!origin.paths.every(target=>records.some(record=>inside(record.result.project_path,target))))throw Object.assign(new Error('Supplied tokens do not cover the originating operation.'),{code:'context_scope_mismatch'});
    }
    if(!Array.isArray(targets)||targets.length>128||targets.some(value=>typeof value!=='string'||!value||value.length>32768||value.includes('\0')))throw Object.assign(new Error('Provide up to 128 valid target paths, each at most 32768 characters.'),{code:'invalid_context_paths'});
    const absolute=[...new Set([...targets,...(origin?.paths||[])])].map(value=>path.resolve(this.defaultDirectory,value==='~'?os.homedir():value.startsWith('~/')?path.join(os.homedir(),value.slice(2)):value));
    if(origin&&CONTROL_TOOLS.has(name))return {...origin,contexts:[]};
    if((name==='start_process'&&this.processes.size>=2048)||(name==='start_search'&&this.searches.size>=2048))throw Object.assign(new Error('Too many active handles; stop existing tasks first.'),{code:'resource_limit'});
    if(FILE_TOOLS.has(name)||name==='start_search')await this.contexts.authorizePaths(absolute,signal);
    if(!this.enabled)return {paths:absolute,tokens:Array.isArray(tokens)?tokens:[],contexts:[]};
    // Network-only reads and known cleanup actions have no project prerequisites.
    if(name==='read_file'&&!absolute.length)return {paths:[],tokens:[],contexts:[]};
    const prepared=await this.contexts.prepare(tokens,absolute,{projectPath:args.project_path,signal,writing:MUTATING_TOOLS.has(name)});
    if(prepared.needsDelivery)throw Object.assign(new Error('Read the project guidance before retrying the original tool. This operation has not run.'),{code:'PROJECT_CONTEXT_REFRESH_REQUIRED',details:guidanceRetry(name,prepared.contexts)});
    return {paths:absolute,tokens:prepared.contexts.length?prepared.contexts.map(context=>context.project_context_token):Array.isArray(tokens)?tokens:[],contexts:prepared.contexts};
  }
  remember(map,key,binding){if(key===undefined||key===null||!binding)return;this.pruneBindings(map);map.set(String(key),{...binding,contexts:[]});}
  async server(message){
    if(this.closed)return;if(!object(message))throw new Error('Invalid upstream JSON-RPC message');
    if(hasId(message)&&typeof message.method!=='string'){
      const key=idKey(message.id),pending=this.pending.get(key);if(!pending&&this.expired.has(key))return;
      if(pending){clearTimeout(pending.timer);this.pending.delete(key);}
      if(pending&&object(message.result)){
        if(pending.method==='initialize'){this.upstreamCapabilities=message.result.capabilities||{};message={...message,result:{...message.result,instructions:`${this.enabled?WORKFLOW:'Automatic project guidance is disabled. Authorized-folder checks still apply.'}\n\n${message.result.instructions||''}`}};}
        else if(pending.method==='tools/list'&&Array.isArray(message.result.tools)){
          const tools=message.result.tools.map(tool=>this.decorateTool(tool));
          if(!message.result.nextCursor){for(const tool of [CONTEXT_TOOL,SEARCH_TOOL])if(!tools.some(item=>item.name===tool.name))tools.push({...tool});}
          message={...message,result:{...message.result,tools}};
        }else if(pending.method==='tools/call'&&pending.binding){
          if(!message.result.isError){
            const text=message.result.content?.find(item=>item.type==='text')?.text||'';
            const data=message.result.structuredContent;
            const processId=data?.pid??(pending.name==='start_process'?/Process started with PID\s+(-?\d+)/.exec(text)?.[1]:pending.handle);
            const searchId=data?.sessionId??data?.session_id??(pending.name==='start_search'?/(?:session(?: ID)?|Session):?\s*(search_[A-Za-z0-9_-]+)/i.exec(text)?.[1]:pending.handle);
            if(pending.name==='start_process')this.remember(this.processes,processId,pending.binding);
            if(pending.name==='start_search')this.remember(this.searches,searchId,pending.binding);
            if(CONTROL_TOOLS.has(pending.name)){
              const map=pending.name==='stop_search'?this.searches:this.processes;
              const binding=map.get(String(pending.handle));if(binding)binding.finishedAt=Date.now();
            }
            // v0.3.0 uses status for process starts/input, isComplete for
            // searches, and a text completion footer for read_process_output.
            if(data?.isComplete===true||data?.isRunning===false||data?.status==='finished'||(pending.name==='read_process_output'&&/\n✅ Process completed with (?:exit code -?\d+|signal \S+)/.test(text))){
              const map=SEARCH_TOOLS.has(pending.name)?this.searches:this.processes;
              const binding=map.get(String(SEARCH_TOOLS.has(pending.name)?searchId:processId));if(binding)binding.finishedAt=Date.now();
            }
          }
          message={...message,result:projectResult(message.result,pending.binding.contexts||[])};
          if(pending.binding.waitInfo)message.result.structuredContent={...message.result.structuredContent,...pending.binding.waitInfo};
        }
      }
    }
    return this.sendClient(message);
  }
  decorateTool(tool){
    // Built-in file/terminal calls return data. Desktop Commander's viewer hints
    // otherwise make ChatGPT open a UI even for an ordinary text read. Native
    // result blocks and external MCP widgets retain their own delivery paths.
    if(object(tool._meta)){
      const meta={...tool._meta};delete meta['ui/resourceUri'];delete meta['openai/outputTemplate'];delete meta['openai/widgetAccessible'];
      if(object(meta.ui)){const ui={...meta.ui};delete ui.resourceUri;if(Object.keys(ui).length)meta.ui=ui;else delete meta.ui;}
      const clean={...tool};if(Object.keys(meta).length)clean._meta=meta;else delete clean._meta;tool=clean;
    }
    if(!GATED_TOOLS.has(tool.name)){
      if(tool.name==='set_config_value')return {...tool,annotations:{...tool.annotations,readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:false}};
      if(tool.name==='give_feedback_to_desktop_commander')return {...tool,annotations:{...tool.annotations,readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true}};
      return tool;
    }
    const properties={...tool.inputSchema?.properties,project_path:{type:'string',description:'Optional explicit project scope. Every local target must be inside it and within desktop-authorized folders.'},project_context_tokens:{type:'array',items:{type:'string'},maxItems:128,description:TOKEN_DESCRIPTION}};
    if(TERMINAL_TOOLS.has(tool.name))properties.context_paths={type:'array',items:{type:'string'},maxItems:128,description:'Related project paths. start_process defaults to [project_path] when omitted with an explicit absolute project_path; otherwise declare this field. Explicit values take precedence; [] is for ordinary system diagnostics. This only supplies guidance and changes neither shell cwd nor access.'};
    const brief={
      read_file:'Read authorized local files or HTTP(S) URLs. Text offset is 0-based (negative means tail), length limits lines. Supports PDF, images, DOCX and spreadsheets; sheet/range select workbook cells. Reads include optional project guidance. For ChatToHarness logs use get_execution_summary or get_harness_status, without guessing OS log paths.',
      read_multiple_files:'Read multiple authorized local files in one call, returning each path and content. Individual read errors do not stop other files. PNG, JPEG, GIF and WebP retain native image content.',
      write_file:'Write or append an authorized file. Prefer apply_project_edit for UTF-8 project text with checksum and undo protection. Text uses string content; Excel (.xlsx/.xls/.xlsm) uses JSON 2D arrays or sheet-name maps. New DOCX accepts Markdown headings; edit existing DOCX with edit_block. Use write_pdf for PDF.',
      write_pdf:'Create PDFs from Markdown, HTML/CSS, inline SVG and images, or modify an existing PDF with delete/insert operations. Use a new filename in outputPath; modifications preserve the source and require a different outputPath. Page indexes are 0-based; inserts accept markdown or sourcePdfPath. Force page breaks with <div style="page-break-before: always;"></div>. All source and output paths must be authorized.',
      create_directory:'Create an authorized directory and missing parent directories, or leave an existing directory in place.',
      list_directory:'List an authorized directory with relative paths and file/directory markers. All targets must be inside an explicit project_path. depth defaults to 2; use 1 for direct children. Root entries are complete; nested directories show at most 100 entries each with hidden-count warnings. For ChatToHarness logs use get_execution_summary or get_harness_status; do not search OS log folders.',
      move_file:'Move or rename a file or directory. Both source and destination must be within authorized folders. Prefer absolute paths.',
      get_file_info:'Read file/directory metadata, including size, timestamps, permissions, type and text line count/tail information. Use get_file_result when a SHA-256 is needed for a safe project edit.',
      edit_block:'Edit an authorized file. Text uses old_string/new_string with exact whitespace and expected_replacements (default 1); include enough context to identify the intended matches. DOCX uses XML fragments from read_file, including header/footer search. Excel uses a range such as Sheet1!A1:C10 and 2D-array content. Prefer apply_project_edit for UTF-8 project edits with checksum and undo protection.',
      start_search:'Start a background filename or content search. Patterns are regex unless literalSearch=true. The returned sessionId identifies result pages and cancellation. search_project provides a bounded alternative with line context.',
      get_more_search_results:'Read a result range and current status from a start_search sessionId. Nonnegative offset is a 0-based result index; negative offset tails the last N results and ignores length. length defaults to 100. Fetch additional results only when needed; prefer search_project for ordinary searches.',
      stop_search:'Stop a start_search session. Its final results remain readable until automatic cleanup after five minutes.',
      list_searches:'List active background search session IDs, patterns, status and runtime.',
      start_process:'Start an interactive terminal process. Prefer start_task for ordinary non-interactive commands. Can modify files and access the network. Returns output and a process handle when available; timeout_ms limits the initial wait and is capped at 10000 ms; the command may continue running. Omitted context_paths defaults to [project_path] when an explicit absolute project_path is supplied. This guidance scope changes neither shell cwd nor access. Read returned guidance before applying retry_patch and explicitly retrying.',
      interact_with_process:'Send input to a tracked terminal process and collect output. Input may execute commands, modify files or access the network. pid identifies the process returned by start_process.',
      read_process_output:'Read tracked process output and status. offset=0 reads NEW lines since the last read and waits up to timeout_ms; positive offsets are absolute 0-based lines, negative offsets start that many lines from the end. length limits lines (default: fileReadLineLimit). A wait can end while the process is still running. Each wait is capped at 10000 ms. Use get_task_result for persistent tasks.',
      force_terminate:'Force termination of a tracked terminal session by its pid.',
      kill_process:'Forcefully terminate a system process by a positive PID. This can interrupt unrelated work.',
      list_sessions:'List tracked terminal sessions with PID, waiting-for-input state and runtime.',
      list_processes:'List system processes with PID, command name, CPU and memory information.'
    };
    const annotations={...tool.annotations,idempotentHint:!MUTATING_TOOLS.has(tool.name)&&!['start_search','read_process_output'].includes(tool.name),readOnlyHint:!MUTATING_TOOLS.has(tool.name)&&!CONTROL_TOOLS.has(tool.name),destructiveHint:(MUTATING_TOOLS.has(tool.name)&&tool.name!=='create_directory')||['kill_process','force_terminate'].includes(tool.name),openWorldHint:tool.name==='read_file'||['start_process','interact_with_process'].includes(tool.name)};
    const scopeSchema=this.enabled&&tool.name==='start_process'
      ? {allOf:[...(tool.inputSchema?.allOf||[]),{anyOf:[{required:['context_paths']},{required:['project_path']}]}]} : {};
    return {...tool,description:brief[tool.name]||tool.description,inputSchema:{...tool.inputSchema,type:'object',properties,...scopeSchema},annotations,
      outputSchema:projectResultSchema(tool.outputSchema)};
  }
  dispose(){
    if(this.closed)return;this.closed=true;
    for(const operation of this.local.values()){operation.cancelled=true;operation.controller.abort();clearTimeout(operation.timer);}
    for(const operation of this.pending.values())clearTimeout(operation.timer);
    this.local.clear();this.pending.clear();this.expired.clear();this.processes.clear();this.searches.clear();this.search?.dispose();this.contexts.dispose?.();
  }
}

// MCP stdio uses one JSON object per UTF-8 line. StringDecoder preserves split
// multibyte filenames; no diagnostic output is ever written to protocol stdout.
function wireProtocol({clientInput,clientOutput,serverInput,serverOutput,proxy,onFatal,maxFrameBytes=64*1024*1024}) {
  let closed=false;
  function fail() {if (!closed) {closed=true;proxy.dispose?.();onFatal();}}
  function writer(output,source) {
    return message=>new Promise((resolve,reject)=>{
      if (closed || output.destroyed || output.writableEnded) return reject(new Error('MCP transport is closed'));
      const data=JSON.stringify(message)+'\n';
      if (!output.write(data,error=>error ? reject(error) : resolve())) {
        source.pause();output.once('drain',()=>{if(!closed)source.resume();});
      }
    });
  }
  proxy.sendClient=writer(clientOutput,serverOutput);
  proxy.sendServer=writer(serverInput,clientInput);
  function listen(input,handler,client) {
    const decoder=new StringDecoder('utf8');let buffer='';
    input.on('data',chunk=>{
      buffer+=decoder.write(chunk);
      let end;
      while ((end=buffer.indexOf('\n'))!==-1) {
        const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);
        if (!line) continue;
        if (Buffer.byteLength(line)>maxFrameBytes) return fail();
        let message;
        try {message=JSON.parse(line);} catch {
          if (client) proxy.sendClient({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON-RPC JSON'}}).catch(fail);
          else fail();
          continue;
        }
        Promise.resolve(handler(message)).catch(fail);
      }
      if (Buffer.byteLength(buffer)>maxFrameBytes) fail();
    });
    input.on('error',fail);
    input.on('end',()=>{if (buffer.trim() || decoder.end() || !client) fail();else if(client)fail();});
  }
  clientOutput.on('error',fail);serverInput.on('error',fail);
  listen(clientInput,message=>proxy.client(message),true);
  listen(serverOutput,message=>proxy.server(message),false);
  return {close(){closed=true;proxy.dispose?.();}};
}

module.exports={McpProxy,wireProtocol,CONTEXT_TOOL,WORKFLOW,GATED_TOOLS,toolPaths};
