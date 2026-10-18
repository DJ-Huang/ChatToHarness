'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {privateDirectory,readJson,atomicJson}=require('./durable-files.cjs');
const {cleanup,locked,writeBudgeted,sanitize,regular}=require('./diagnostic-budget.cjs');
const ACTIVE=new Set(['received','waiting_approval','submitted','running','cancelling']);
function argumentSummary(args,secrets=[]){
  if(!args||typeof args!=='object')return 'Invalid arguments';
  return sanitize(Object.entries(args).slice(0,32).map(([key,value])=>`${/secret|token|password|authorization|env|key/i.test(key)?'[private field]':sanitize(key,64)}: ${/^(project_path|path|file_path|task_id|pid|offset|limit|length)$/.test(key)?sanitize(value,256):Array.isArray(value)?`[${value.length} items]`:typeof value==='string'?`[${value.length} characters]`:`[${typeof value}]`}`).join(', '),2048,secrets);
}
class ExecutionHistory{
  constructor(home,{clock=Date.now,version=require('../package.json').version,instance=crypto.randomUUID(),onChange=()=>{}}={}){
    Object.assign(this,{home,clock,version,instance,onChange});this.directory=path.join(home,'executions');privateDirectory(this.directory);this.detailedUntil=0;this.polls=new Map();this.pending=new Map();
    // A previous process cannot prove the fate of a non-task operation.
    for(const row of this.rows())if(ACTIVE.has(row.state)&&!(row.tool==='start_task'&&row.task_id))this.update(row.request_id,{state:'unknown',finished_at:this.now(),error_code:'APP_RESTARTED'});
    this.maintain();this.timer=setInterval(()=>this.maintain(),60000);this.timer.unref?.();this.retry=setInterval(()=>this.flush(),100);this.retry.unref?.();
  }
  now(){return new Date(this.clock()).toISOString();}
  file(id){if(typeof id!=='string'||!/^exec_[a-f0-9-]{36}$/.test(id))throw new Error('INVALID_EXECUTION_ID');return path.join(this.directory,id+'.json');}
  rows(){
    const rows=new Map();let names=[];try{names=fs.readdirSync(this.directory);}catch{}
    for(const name of names)if(/^exec_[a-f0-9-]{36}\.json$/.test(name))try{const row=readJson(path.join(this.directory,name),24576);rows.set(row.request_id,row);}catch{}
    for(const [id,row]of this.pending)rows.set(id,row);return [...rows.values()];
  }
  save(row){
    if(Buffer.byteLength(JSON.stringify(row))>24000){row.error_summary=sanitize(row.error_summary,8000);delete row.stdout;}
    const bytes=Buffer.byteLength(JSON.stringify(row))+1;
    const saved=writeBudgeted(this.home,bytes*2,()=>atomicJson(this.file(row.request_id),row),{now:this.clock(),detailed:Boolean(row.stdout),recordSlot:regular(this.file(row.request_id))?0:1});
    if(saved){this.pending.delete(row.request_id);try{this.onChange({...row});}catch{}}
    else{this.pending.set(row.request_id,structuredClone(row));if(this.pending.size>512)this.pending.delete(this.pending.keys().next().value);}
    return saved;
  }
  flush(){for(const row of [...this.pending.values()].slice(0,16))this.save(row);}
  begin(tool,args,service='Harness',secrets=[]){
    const poll=/^(get_task_status|get_task_result|get_task_logs|list_tasks|get_harness_status|read_process_output|get_more_search_results)$/.test(tool);
    const pollHash=crypto.createHash('sha256');
    if(poll)for(const value of [tool,service,args?.task_id,args?.project_path,args?.pid,args?.sessionId])pollHash.update(typeof value==='string'?value:typeof value==='number'?String(value):'').update('\0');
    const pollKey=poll?pollHash.digest('hex'):null;
    const prior=pollKey&&this.polls.get(pollKey);
    if(prior&&this.clock()-prior.at<60000){const saved=this.get(prior.id);if(saved&&!ACTIVE.has(saved.state)){this.update(prior.id,{state:'received',delivery:'unknown',finished_at:undefined,duration_ms:undefined,last_received_at:this.now(),poll_count:(saved.poll_count||1)+1});return prior.id;}}
    const row={schema:1,request_id:'exec_'+crypto.randomUUID(),tool:sanitize(tool,256,secrets),service:sanitize(service,256,secrets),operation:argumentSummary(args,secrets),received_at:this.now(),state:'received',delivery:'unknown',remote_ack:'unknown',instance_id:this.instance,app_version:this.version};
    if(typeof args?.project_path==='string')row.project=sanitize(args.project_path,512,secrets);
    if(/^task_[a-f0-9]{64}$/.test(args?.task_id||''))row.task_id=args.task_id;
    if(pollKey){this.polls.set(pollKey,{id:row.request_id,at:this.clock()});if(this.polls.size>512)this.polls.delete(this.polls.keys().next().value);}
    this.save(row);return row.request_id;
  }
  get(id){if(this.pending.has(id))return structuredClone(this.pending.get(id));try{return readJson(this.file(id),24576);}catch{return null;}}
  update(id,patch){const row=this.get(id);if(!row)return;Object.assign(row,patch);if(row.finished_at)row.duration_ms=Math.max(0,Date.parse(row.finished_at)-Date.parse(row.last_received_at||row.received_at));if(!this.save(row)&&row.stdout){delete row.stdout;this.save(row);}}
  complete(id,result,error,secrets=[]){
    let data=result?.structuredContent||{};
    if(!Object.keys(data).length)try{const text=result?.content?.find(c=>c.type==='text')?.text;if(text&&text.length<=16384)data=JSON.parse(text);}catch{}
    const code=String(error?.code||data.code||'');
    const row=this.get(id);if(!row)return;
    const uncertain=data.execution_state==='unknown'||error&&row.state==='running'&&!/^(-32602|MCP_INVALID_ARGUMENTS)$/.test(code)||/TIMEOUT|DISCONNECT|CANCELLED|CONNECTION_CLOSED/i.test(code);
    const state=uncertain?'unknown':error||result?.isError?'failed':row.tool==='start_task'&&data.task_id?'submitted':'succeeded';
    const patch={state,...(state==='submitted'?{}:{finished_at:this.now()}),error_code:sanitize(code,256),error_summary:result?.isError||error?sanitize(data.message||error?.message||'Tool reported an error',16384,secrets):''};
    if(/^task_[a-f0-9]{64}$/.test(data.task_id||''))patch.task_id=data.task_id;
    // Results can contain whole files, credentials and base64. Capture only an
    // explicit stdout field during the short opt-in window.
    if(this.detailedUntil>this.clock()&&typeof data.stdout==='string')patch.stdout=sanitize(data.stdout,2048,secrets);
    this.update(id,patch);
  }
  diagnostics(enabled){this.detailedUntil=enabled===true?this.clock()+30*60000:0;return {enabled:this.detailedUntil>this.clock(),until:this.detailedUntil};}
  maintain(){
    for(const row of this.rows())if(row.tool==='start_task'&&row.task_id&&!row.task_finished)try{
      const task=readJson(path.join(this.home,'tasks',row.task_id,'state.json'));
      const stale=!task.finished_at&&this.clock()-Date.parse(task.updated_at)>15000;
      const state=stale?'unknown':task.finished_at?(['succeeded','failed','interrupted'].includes(task.state)?task.state:task.state==='cancelled'?'interrupted':'unknown'):fs.existsSync(path.join(this.home,'tasks',row.task_id,'cancel.request'))?'cancelling':task.state==='running'?'running':'submitted';
      this.update(row.request_id,{state,...(task.started_at?{started_at:task.started_at}:{}),...(task.finished_at?{finished_at:task.finished_at,task_finished:true,error_code:sanitize(task.error?.code||'',256),error_summary:sanitize(task.error?.message||'',16384)}:stale?{finished_at:this.now(),error_code:'TASK_HEARTBEAT_UNAVAILABLE'}:{finished_at:undefined,error_code:''})});
    }catch{this.update(row.request_id,{state:'unknown',error_code:'TASK_RECORD_UNAVAILABLE'});}
    locked(this.home,()=>cleanup(this.home,{now:this.clock()}));
  }
  list({tab='all',search='',offset=0,limit=50}={}){
    limit=Math.max(1,Math.min(100,Number(limit)||50));offset=Math.max(0,Math.min(10000,Number(offset)||0));search=String(search).slice(0,256).toLowerCase();
    const rows=this.rows().filter(r=>(tab!=='running'||ACTIVE.has(r.state))&&(tab!=='errors'||(['failed','unknown','interrupted'].includes(r.state)||r.delivery==='local_write_failed'))&&[r.tool,r.service,r.operation,r.project,r.task_id].join(' ').toLowerCase().includes(search)).sort((a,b)=>Number(ACTIVE.has(b.state))-Number(ACTIVE.has(a.state))||(b.last_received_at||b.received_at).localeCompare(a.last_received_at||a.received_at));
    const usage=require('./diagnostic-budget.cjs').inventory(this.home).reduce((n,f)=>n+f.size,0);
    return {records:rows.slice(offset,offset+limit).map(({stdout,error_summary,...r})=>r),total:rows.length,offset,usage,limit_bytes:50*1024*1024,diagnostics:{enabled:this.detailedUntil>this.clock(),until:this.detailedUntil}};
  }
  detail(id){
    const row=this.get(id);if(!row||!/^task_[a-f0-9]{64}$/.test(row.task_id||''))return row;
    const directory=path.join(this.home,'tasks',row.task_id);let fd;
    try{
      for(const dir of [path.join(this.home,'tasks'),directory]){const stat=fs.lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink())return row;}
      if(fs.existsSync(path.join(directory,'output.expired')))return {...row,task_output_expired:true};
      fd=fs.openSync(path.join(directory,'output.jsonl'),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
      const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.nlink!==1)return row;
      const buffer=Buffer.alloc(Math.min(16384,stat.size));fs.readSync(fd,buffer,0,buffer.length,0);
      const lines=buffer.toString('utf8').split('\n');lines.pop();
      row.stdout=sanitize(lines.flatMap(line=>{try{const entry=JSON.parse(line);return entry.stream==='stdout'?[entry.text]:[];}catch{return [];}}).join(''),2048);
    }catch{}finally{if(fd!==undefined)fs.closeSync(fd);}
    return row;
  }
  export(ids){if(!Array.isArray(ids)||ids.length>100)throw new Error('SELECT_UP_TO_100_RECORDS');return ids.map(id=>this.get(id)).filter(Boolean);}
  close(){clearInterval(this.timer);clearInterval(this.retry);this.flush();}
}
module.exports={ExecutionHistory,argumentSummary,ACTIVE};
