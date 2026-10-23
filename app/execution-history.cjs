'use strict';
const path=require('node:path');
const crypto=require('node:crypto');
const {privateDirectory,readJson,atomicJson}=require('./durable-files.cjs');
const {cleanup,locked,writeBudgeted,sanitize,regular}=require('./diagnostic-budget.cjs');
const {presentExecution,taskError}=require('./tool-recovery.cjs');
const {readRows,taskPatch,taskDetail,followsTask}=require('./diagnostic-storage.cjs');
const ACTIVE=new Set(['received','waiting_approval','submitted','running','cancelling']);
function argumentSummary(args,secrets=[]){
  if(!args||typeof args!=='object')return 'Invalid arguments';
  return sanitize(Object.entries(args).slice(0,32).map(([key,value])=>`${/secret|token|password|authorization|env|key/i.test(key)?'[private field]':sanitize(key,64)}: ${/^(project_path|path|file_path|task_id|pid|offset|limit|length)$/.test(key)?sanitize(value,256):Array.isArray(value)?`[${value.length} items]`:typeof value==='string'?`[${value.length} characters]`:`[${typeof value}]`}`).join(', '),2048,secrets);
}
function scopePaths(tool,args,service,secrets=[]){
  if(!['builtin','Harness'].includes(service)||!args||typeof args!=='object'||typeof args.project_path==='string')return [];
  let paths;
  if(['read_file','write_file','create_directory','list_directory','get_file_info','start_search'].includes(tool)){
    if(tool==='read_file'&&args.isUrl)return [];
    paths=[args.path];
  }else if(tool==='read_multiple_files')paths=args.paths;
  else if(tool==='move_file')paths=[args.source,args.destination];
  else if(['edit_block','write_pdf'].includes(tool)){
    // These tools also accept serialized operation arrays. Do not parse free
    // text to guess their source paths; an incomplete scope could incorrectly
    // classify a call that spans several projects as belonging to just one.
    if(typeof args.content==='string'&&args.content.trim().startsWith('['))return [];
    paths=tool==='edit_block'?[args.file_path,args.options?.outputPath,args.options?.sourcePdf]:[args.path,args.outputPath];
    if(Array.isArray(args.content))paths.push(...args.content.map(item=>item?.sourcePdfPath));
    paths=paths.filter(value=>value!==undefined);
  }else return [];
  if(!Array.isArray(paths)||!paths.length||paths.length>128)return [];
  // Scope is used only as a read-time authorization candidate, so preserve the
  // complete literal path or omit the scope. Truncation/redaction is not a safe
  // substitute for the original path, and partial multi-file scopes are unsafe.
  if(paths.some(value=>typeof value!=='string'||value.includes('\0')||!path.isAbsolute(value)||sanitize(value,512,secrets)!==value))return [];
  paths=[...new Set(paths)];
  return Buffer.byteLength(JSON.stringify(paths))<=8192?paths:[];
}
class ExecutionHistory{
  constructor(home,{clock=Date.now,version=require('../package.json').version,instance=crypto.randomUUID(),onChange=()=>{},writer}={}){
    Object.assign(this,{home,clock,version,instance,onChange,writer});this.directory=path.join(home,'executions');this.detailedUntil=0;this.polls=new Map();this.pending=new Map();this.cache=new Map();
    if(writer){
      this.onMaintenance=({removed_ids=[]})=>{for(const id of removed_ids)if(!writer.hasPending(id))this.cache.delete(id);};writer.on('maintenance',this.onMaintenance);
      this.ready=writer.ready.then(async snapshot=>{
        // New calls can already have live records while startup reads are in
        // flight; persisted snapshots never replace these newer states.
        for(const row of snapshot.rows)if(!this.cache.has(row.request_id)){
          this.cache.set(row.request_id,presentExecution(row));
          if(ACTIVE.has(row.state)&&!(row.tool==='start_task'&&row.task_id))this.update(row.request_id,{state:'unknown',finished_at:this.now(),error_code:'APP_RESTARTED'});
        }
        await this.maintain();return this;
      },()=>this);
    }else{
      privateDirectory(this.directory);
      // A previous process cannot prove the fate of a non-task operation.
      for(const row of this.rows())if(ACTIVE.has(row.state)&&!(row.tool==='start_task'&&row.task_id))this.update(row.request_id,{state:'unknown',finished_at:this.now(),error_code:'APP_RESTARTED'});
      this.maintain();this.ready=Promise.resolve(this);this.retry=setInterval(()=>this.flush(),100);this.retry.unref?.();
    }
    this.timer=setInterval(()=>this.maintain(),60000);this.timer.unref?.();
  }
  now(){return new Date(this.clock()).toISOString();}
  file(id){if(typeof id!=='string'||!/^exec_[a-f0-9-]{36}$/.test(id))throw new Error('INVALID_EXECUTION_ID');return path.join(this.directory,id+'.json');}
  rows(){
    if(this.writer)return [...this.cache.values()].map(row=>presentExecution(structuredClone(row)));
    const rows=new Map(readRows(this.home).map(row=>[row.request_id,row]));
    for(const [id,row]of this.pending)rows.set(id,presentExecution(row));return [...rows.values()];
  }
  save(row){
    if(Buffer.byteLength(JSON.stringify(row))>24000){
      row.error_summary=sanitize(row.error_summary,8000);delete row.stdout;
      // Explicit multi-file scopes are retained in full for authorization.
      // Escaping an error can double its bytes, so trim only its free text
      // until the whole diagnostic record fits the existing private-file cap.
      while(row.error_summary&&Buffer.byteLength(JSON.stringify(row))>24000)row.error_summary=sanitize(row.error_summary,Math.floor(Buffer.byteLength(row.error_summary)/2));
    }
    if(this.writer){
      this.cache.set(row.request_id,structuredClone(row));
      // Retention remains bounded even while the worker is unavailable. Active
      // records are pinned, matching the disk cleanup policy.
      if(this.cache.size>10000){const oldest=[...this.cache.values()].filter(item=>!ACTIVE.has(item.state)).sort((a,b)=>(a.last_received_at||a.received_at).localeCompare(b.last_received_at||b.received_at))[0];if(oldest)this.cache.delete(oldest.request_id);}
      const saved=this.writer.saveRow(row);try{this.onChange({...row});}catch{}return saved;
    }
    const bytes=Buffer.byteLength(JSON.stringify(row))+1;
    const saved=writeBudgeted(this.home,bytes*2,()=>atomicJson(this.file(row.request_id),row),{now:this.clock(),detailed:Boolean(row.stdout),recordSlot:regular(this.file(row.request_id))?0:1});
    if(saved){this.pending.delete(row.request_id);try{this.onChange({...row});}catch{}}
    else{this.pending.set(row.request_id,structuredClone(row));if(this.pending.size>512)this.pending.delete(this.pending.keys().next().value);}
    return saved;
  }
  flush(options){if(this.writer)return this.writer.flush(options);for(const row of [...this.pending.values()].slice(0,16))this.save(row);}
  begin(tool,args,service='Harness',secrets=[]){
    const poll=/^(get_task_status|get_task_result|get_task_logs|list_tasks|get_harness_status|read_process_output|get_more_search_results)$/.test(tool);
    const pollHash=crypto.createHash('sha256');
    if(poll)for(const value of [tool,service,args?.task_id,args?.project_path,args?.pid,args?.sessionId])pollHash.update(typeof value==='string'?value:typeof value==='number'?String(value):'').update('\0');
    const pollKey=poll?pollHash.digest('hex'):null;
    const prior=pollKey&&this.polls.get(pollKey);
    if(prior&&this.clock()-prior.at<60000){const saved=this.get(prior.id);if(saved&&!ACTIVE.has(saved.state)){this.update(prior.id,{state:'received',delivery:'unknown',execution_state:undefined,recovery_kind:undefined,finished_at:undefined,duration_ms:undefined,result_id:undefined,result_status:undefined,result_version:undefined,result_expires_at:undefined,last_received_at:this.now(),poll_count:(saved.poll_count||1)+1});return prior.id;}}
    const row={schema:1,request_id:'exec_'+crypto.randomUUID(),tool:sanitize(tool,256,secrets),service:sanitize(service,256,secrets),operation:argumentSummary(args,secrets),received_at:this.now(),state:'received',delivery:'unknown',remote_ack:'unknown',instance_id:this.instance,app_version:this.version};
    if(typeof args?.project_path==='string')row.project=sanitize(args.project_path,512,secrets);
    else{const scopes=scopePaths(tool,args,service,secrets);if(scopes.length)row.scope_paths=scopes;}
    if(/^task_[a-f0-9]{64}$/.test(args?.task_id||''))row.task_id=args.task_id;
    if(pollKey){this.polls.set(pollKey,{id:row.request_id,at:this.clock()});if(this.polls.size>512)this.polls.delete(this.polls.keys().next().value);}
    this.save(row);return row.request_id;
  }
  get(id){if(this.writer)return this.cache.has(id)?presentExecution(structuredClone(this.cache.get(id))):null;if(this.pending.has(id))return presentExecution(structuredClone(this.pending.get(id)));try{return presentExecution(readJson(this.file(id),24576));}catch{return null;}}
  update(id,patch){let row=this.get(id);if(!row)return;row=presentExecution(Object.assign(row,patch));if(row.finished_at)row.duration_ms=Math.max(0,Date.parse(row.finished_at)-Date.parse(row.last_received_at||row.received_at));if(!this.save(row)&&row.stdout){delete row.stdout;this.save(row);}}
  complete(id,result,error,secrets=[]){
    let data=result?.structuredContent||{};
    if(!Object.keys(data).length)try{const text=result?.content?.find(c=>c.type==='text')?.text;if(text&&text.length<=16384)data=JSON.parse(text);}catch{}
    const code=String(error?.code||data.code||'');
    const row=this.get(id);if(!row)return;
    const uncertain=data.execution_state==='unknown'||error&&row.state==='running'&&!/^(-32602|MCP_INVALID_ARGUMENTS)$/.test(code)||/TIMEOUT|DISCONNECT|CANCELLED|CONNECTION_CLOSED/i.test(code);
    const taskTerminal=row.tool==='start_task'&&!error&&!result?.isError&&data.task_id&&data.terminal===true&&Boolean(data.finished_at);
    const state=uncertain?'unknown':error||result?.isError?'failed':taskTerminal
      ? data.state==='succeeded'?'succeeded':data.state==='failed'||data.state==='timed_out'?'failed':'interrupted'
      :row.tool==='start_task'&&data.task_id?'submitted':'succeeded';
    const patch={state,...(state==='submitted'?{}:{finished_at:this.now()}),error_code:sanitize(code,256),error_summary:result?.isError||error?sanitize(data.message||error?.message||'Tool reported an error',16384,secrets):''};
    patch.execution_state=state==='unknown'?'unknown':['not_started','unknown','running','completed'].includes(data.execution_state)?data.execution_state:undefined;
    if(/^task_[a-f0-9]{64}$/.test(data.task_id||''))patch.task_id=data.task_id;
    if(row.tool==='start_task'&&patch.task_id)patch.task_accepted=row.task_accepted===true||!(error||result?.isError);
    if(taskTerminal){const failure=taskError(data);patch.task_finished=true;patch.exit_code=data.exit_code;patch.operation_executed=data.operation_executed;patch.error_code=sanitize(failure.code||code,256);patch.error_summary=failure.message?sanitize(failure.message,16384,secrets):patch.error_summary;}
    // Results can contain whole files, credentials and base64. Capture only an
    // explicit stdout field during the short opt-in window.
    if(this.detailedUntil>this.clock()&&typeof data.stdout==='string')patch.stdout=sanitize(data.stdout,2048,secrets);
    this.update(id,patch);
  }
  diagnostics(enabled){this.detailedUntil=enabled===true?this.clock()+30*60000:0;return {enabled:this.detailedUntil>this.clock(),until:this.detailedUntil};}
  maintain(){
    const tasks=this.rows().filter(followsTask);
    if(this.writer){
      if(this.maintaining)return this.maintaining;
      this.maintaining=this.writer.maintain(tasks).then(result=>{
        for(const {request_id,task_id,patch}of result.patches){const current=this.get(request_id);if(current?.task_id===task_id&&followsTask(current))this.update(request_id,patch);}
      }).catch(()=>{}).finally(()=>{this.maintaining=null;});return this.maintaining;
    }
    for(const row of tasks)this.update(row.request_id,taskPatch(this.home,row,this.clock()));
    locked(this.home,()=>cleanup(this.home,{now:this.clock()}));
  }
  list({tab='all',search='',offset=0,limit=50}={}){
    limit=Math.max(1,Math.min(100,Number(limit)||50));offset=Math.max(0,Math.min(10000,Number(offset)||0));search=String(search).slice(0,256).toLowerCase();
    const rows=this.rows().filter(r=>(tab!=='running'||ACTIVE.has(r.state))&&(tab!=='errors'||(['failed','unknown','interrupted'].includes(r.state)&&!r.recovery_kind||r.delivery==='local_write_failed'))&&[r.tool,r.service,r.operation,r.project,r.task_id].join(' ').toLowerCase().includes(search)).sort((a,b)=>Number(ACTIVE.has(b.state))-Number(ACTIVE.has(a.state))||(b.last_received_at||b.received_at).localeCompare(a.last_received_at||a.received_at));
    const usage=this.writer?this.writer.usage:require('./diagnostic-budget.cjs').inventory(this.home).reduce((n,f)=>n+f.size,0);
    return {records:rows.slice(offset,offset+limit).map(({stdout,error_summary,...r})=>r),total:rows.length,offset,usage,limit_bytes:50*1024*1024,diagnostics:{enabled:this.detailedUntil>this.clock(),until:this.detailedUntil}};
  }
  detail(id){
    const row=this.get(id);if(!row||!/^task_[a-f0-9]{64}$/.test(row.task_id||''))return row;
    return this.writer?this.writer.detail(row).catch(()=>({...row,diagnostic_detail_unavailable:true})):taskDetail(this.home,row);
  }
  export(ids){if(!Array.isArray(ids)||ids.length>100)throw new Error('SELECT_UP_TO_100_RECORDS');return ids.map(id=>this.get(id)).filter(Boolean);}
  close(){clearInterval(this.timer);clearInterval(this.retry);if(this.writer){this.writer.off('maintenance',this.onMaintenance);return Promise.resolve(this.maintaining).then(()=>this.flush()).catch(()=>({flushed:false}));}this.flush();}
}
module.exports={ExecutionHistory,argumentSummary,ACTIVE,scopePaths};
