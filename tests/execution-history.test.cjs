'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {PassThrough,Writable}=require('node:stream');
const {ExecutionHistory,argumentSummary}=require('../app/execution-history.cjs');
const {writeBudgeted,cleanup,inventory,HARD,AGE,sanitize,locked}=require('../app/diagnostic-budget.cjs');
const {McpManager}=require('../app/mcp-manager.cjs');
const {LineTransport}=require('../app/mcp-transport.cjs');
function fixture(t){const home=fs.mkdtempSync(path.join(os.tmpdir(),'cth-history-'));let time=Date.now();const history=new ExecutionHistory(home,{clock:()=>time});t.after(()=>{history.close();fs.rmSync(home,{recursive:true,force:true});});return {home,history,advance:n=>time+=n};}
const ok={content:[{type:'text',text:'ok'}]};
test('unified wrapper records built-in, policy denial, invalid arguments, thrown errors and unknown timeouts',async t=>{
  const {history}=fixture(t);
  const manager=Object.create(McpManager.prototype);Object.assign(manager,{history,records:new Map(),services:{has:n=>n==='builtin',call:async()=>ok},running:true,active:new Set()});
  await manager.call('builtin',{content:'do not store raw content'});
  await manager.call('denied',{});
  assert.deepEqual(history.rows().map(r=>r.state).sort(),['failed','succeeded']);
  assert.ok(!JSON.stringify(history.rows()).includes('do not store raw content'));
  manager.dispatch=async()=>{throw Object.assign(new Error('token=private'),{code:'MCP_TIMEOUT'});};
  await assert.rejects(manager.call('external',{}));
  const timeout=history.rows().find(r=>r.tool==='external');assert.equal(timeout.state,'unknown');assert.equal(timeout.delivery,'unknown');assert.ok(!timeout.error_summary.includes('private'));
});
test('execution progresses in place; restart preserves completed records and marks unresolved calls unknown',t=>{
  const {history,home}=fixture(t);const id=history.begin('read_file',{path:'/project/a'});
  history.update(id,{state:'waiting_approval'});history.update(id,{state:'running',started_at:history.now()});history.complete(id,ok);history.update(id,{delivery:'local_write_failed'});
  const pending=history.begin('mutation',{});history.close();const restarted=new ExecutionHistory(home);t.after(()=>restarted.close());
  assert.equal(restarted.get(id).state,'succeeded');assert.equal(restarted.get(id).delivery,'local_write_failed');assert.equal(restarted.get(id).remote_ack,'unknown');assert.equal(restarted.get(pending).state,'unknown');assert.equal(restarted.rows().length,2);
});

test('recoverable pre-execution records retain failure state and present legacy history consistently',t=>{
  const {history}=fixture(t);
  const make=(code,options={})=>{
    const id=history.begin('start_process',{},options.service||'builtin');
    history.complete(id,{isError:true,structuredContent:{code,execution_state:options.execution_state||'not_started',retry_patch:{project_context_tokens:['must-not-be-stored']}}});
    return id;
  };
  const missing=make('context_paths_required'),guidance=make('PROJECT_CONTEXT_REFRESH_REQUIRED');
  assert.equal(history.get(missing).state,'failed');
  assert.equal(history.get(missing).execution_state,'not_started');
  assert.equal(history.get(missing).recovery_kind,'needs_arguments');
  assert.equal(history.get(guidance).recovery_kind,'needs_context');
  assert.ok(!JSON.stringify(history.rows()).includes('must-not-be-stored'));
  assert.equal(history.list({tab:'errors'}).total,0);
  const legacy=history.begin('start_process',{},'builtin');
  const row={...history.get(legacy),state:'failed',error_code:'PROJECT_CONTEXT_REFRESH_REQUIRED'};
  fs.writeFileSync(history.file(legacy),JSON.stringify(row));
  assert.equal(history.detail(legacy).recovery_kind,'needs_context');
  assert.equal(history.list().records.find(r=>r.request_id===legacy).execution_state,'not_started');
  assert.equal(history.export([legacy])[0].recovery_kind,'needs_context');
  assert.equal(JSON.parse(fs.readFileSync(history.file(legacy))).execution_state,undefined,'old records need no rewrite');
  const denied=make('PATH_NOT_ALLOWED'),invalid=make('invalid_context_paths');
  const unknown=make('PROJECT_CONTEXT_REFRESH_REQUIRED',{execution_state:'unknown'});
  const external=make('PROJECT_CONTEXT_REFRESH_REQUIRED',{service:'external'});
  for(const id of [denied,invalid,unknown,external])assert.equal(history.get(id).recovery_kind,undefined);
  history.update(guidance,{delivery:'local_write_failed'});
  assert.equal(history.get(guidance).recovery_kind,undefined);
  assert.equal(history.list({tab:'errors'}).total,5);
});
test('asynchronous submission links worker updates, cancellation and restart without claiming command success',t=>{
  const {history,home}=fixture(t);const task='task_'+'a'.repeat(64),dir=path.join(home,'tasks',task);fs.mkdirSync(dir,{recursive:true});
  const id=history.begin('start_task',{});history.complete(id,{structuredContent:{task_id:task,state:'queued'}});assert.equal(history.get(id).state,'submitted');assert.equal(history.get(id).finished_at,undefined);
  fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({state:'running',updated_at:history.now(),started_at:history.now()}));history.maintain();assert.equal(history.get(id).state,'running');
  fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({state:'succeeded',finished_at:history.now()}));history.maintain();assert.equal(history.get(id).state,'succeeded');assert.equal(history.get(id).task_id,task);
});

test('task synchronization preserves rejected idempotency requests and reports accepted command exits',t=>{
  const {history,home}=fixture(t),task='task_'+'3'.repeat(64),dir=path.join(home,'tasks',task);fs.mkdirSync(dir,{recursive:true});
  const accepted=history.begin('start_task',{});
  history.complete(accepted,{structuredContent:{task_id:task,state:'queued',execution_state:'not_started'}});
  fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({state:'failed',execution_state:'completed',operation_executed:true,exit_code:23,finished_at:history.now()}));
  const rejected=history.begin('start_task',{});
  history.complete(rejected,{isError:true,structuredContent:{task_id:task,code:'IDEMPOTENCY_CONFLICT',message:'Inspect original task.',execution_state:'not_started',operation_executed:false}});
  const original=history.get(rejected);assert.equal(original.task_accepted,false);
  history.maintain();assert.deepEqual(history.get(rejected),original);
  assert.equal(history.get(accepted).error_code,'TASK_EXIT_NONZERO');assert.match(history.get(accepted).error_summary,/23/);
  const legacy=history.begin('start_task',{}),legacyRow={...original,request_id:legacy};delete legacyRow.task_accepted;
  fs.writeFileSync(history.file(legacy),JSON.stringify(legacyRow));
  history.close();const restored=new ExecutionHistory(home);t.after(()=>restored.close());restored.maintain();
  assert.equal(restored.get(rejected).error_code,'IDEMPOTENCY_CONFLICT');assert.equal(restored.get(rejected).execution_state,'not_started');
  assert.equal(restored.get(legacy).error_code,'IDEMPOTENCY_CONFLICT');assert.equal(restored.get(legacy).task_finished,undefined);
});
test('safe summaries, bounded errors and opt-in diagnostic expiry use an injected clock',t=>{
  const {history,advance}=fixture(t);const args={command:'echo hidden',env:{KEY:'secret'},content:'file body',api_key:'credential',path:'/a'};
  const summary=argumentSummary(args);for(const value of ['echo hidden','secret','file body','credential'])assert.ok(!summary.includes(value));
  assert.ok(Buffer.byteLength(argumentSummary(Object.fromEntries(Array.from({length:300},(_,i)=>['x'+i,'q'.repeat(10000)]))))<=2048);
  const first=history.begin('tool',{});history.complete(first,{structuredContent:{stdout:'not opted in'}});assert.equal(history.get(first).stdout,undefined);
  history.diagnostics(true);const second=history.begin('tool',{});history.complete(second,{structuredContent:{stdout:'Bearer credential token=private '+ 'a'.repeat(1000)}});assert.ok(!history.get(second).stdout.includes('credential'));assert.ok(!history.get(second).stdout.includes('private'));
  advance(30*60000);const third=history.begin('tool',{});history.complete(third,{structuredContent:{stdout:'expired'}});assert.equal(history.get(third).stdout,undefined);assert.equal(history.list().diagnostics.enabled,false);
  history.complete(third,{isError:true,structuredContent:{message:'"'.repeat(100000)}});assert.ok(fs.statSync(history.file(third)).size<=24576);
  history.complete(third,{isError:true,structuredContent:{message:'\0'.repeat(100000)}});assert.ok(history.get(third));assert.ok(fs.statSync(history.file(third)).size<=24576);
  assert.ok(!sanitize('https://user:password@host/?token=secret').includes('secret'));
});
test('polls fold; paginated IPC payload omits details and exports selected safe records',t=>{
  const {history}=fixture(t);const id=history.begin('get_task_status',{});history.complete(id,ok);assert.equal(history.begin('get_task_status',{}),id);history.complete(id,ok);assert.equal(history.get(id).poll_count,2);
  for(let n=0;n<4;n++){const key=history.begin('tool'+n,{});history.complete(key,ok);}
  assert.equal(history.list({limit:2}).records.length,2);assert.equal(history.list({offset:2,limit:2}).records.length,2);assert.equal(history.list({search:'tool3'}).total,1);assert.equal(history.export([id]).length,1);assert.throws(()=>history.export(Array(101).fill(id)));
  assert.equal(history.list({tab:'running'}).total,0);
});
test('shared budget purges aged finished output, reports expired cursors and preserves task guards and in-flight bytes',t=>{
  const {home}=fixture(t);const {TaskStore}=require('../app/task-store.cjs');const task='task_'+'b'.repeat(64),dir=path.join(home,'tasks',task);fs.mkdirSync(dir,{recursive:true});
  const output=path.join(dir,'output.jsonl');fs.writeFileSync(output,'old output');fs.writeFileSync(path.join(dir,'request.json'),JSON.stringify({task_id:task,project_path:'/p'}));fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({state:'running'}));fs.writeFileSync(path.join(dir,'worker.claim'),'guard');
  const old=Date.now()-AGE-1000;fs.utimesSync(output,old/1000,old/1000);locked(home,()=>cleanup(home));assert.equal(fs.readFileSync(output,'utf8'),'old output');
  fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({state:'succeeded',finished_at:new Date().toISOString()}));locked(home,()=>cleanup(home));assert.ok(!fs.existsSync(output));assert.ok(fs.existsSync(path.join(dir,'worker.claim')));assert.ok(fs.existsSync(path.join(dir,'request.json')));
  const store=new TaskStore({home});assert.throws(()=>store.logs(task,'/p',{cursor:task+':4'}),{code:'TASK_LOG_EXPIRED'});
});
test('50MiB hard cap counts actual stored output while active and drops writes on contention without queues',t=>{
  const {home}=fixture(t);const task='task_'+'c'.repeat(64),dir=path.join(home,'tasks',task);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'state.json'),'{}');const output=path.join(dir,'output.jsonl');const fd=fs.openSync(output,'w');fs.ftruncateSync(fd,HARD-4);fs.closeSync(fd);
  let wrote=false;assert.equal(writeBudgeted(home,5,()=>{wrote=true;}),false);assert.equal(wrote,false);assert.equal(writeBudgeted(home,4,()=>fs.appendFileSync(output,'1234')),true);assert.equal(inventory(home).reduce((n,f)=>n+f.size,0),HARD);
  locked(home,()=>assert.equal(writeBudgeted(home,1,()=>{throw Error('must not write');}),false));
});
test('retention ignores symlinks and hardlinks and purges previous app logs and temporary diagnostics',t=>{
  const {home}=fixture(t);const logs=path.join(home,'logs'),diagnostics=path.join(home,'diagnostics');fs.mkdirSync(logs);fs.mkdirSync(diagnostics);const outside=path.join(home,'keep');fs.writeFileSync(outside,'keep');fs.symlinkSync(outside,path.join(diagnostics,'link'));fs.linkSync(outside,path.join(diagnostics,'hardlink'));
  const file=path.join(logs,'app.log.previous');fs.writeFileSync(file,'old');const old=Date.now()-AGE-1000;fs.utimesSync(file,old/1000,old/1000);locked(home,()=>cleanup(home));assert.ok(!fs.existsSync(file));assert.equal(fs.readFileSync(outside,'utf8'),'keep');
});
test('delivery failure after successful execution never changes execution outcome; local writes never acknowledge remote delivery',async t=>{
  const {history}=fixture(t);const id=history.begin('tool',{});history.complete(id,ok);
  const output=new Writable({write(chunk,encoding,callback){callback(new Error('closed'));}});output.on('error',()=>{});const transport=new LineTransport(new PassThrough(),output);
  await assert.rejects(transport.send({jsonrpc:'2.0',id:1,result:ok}));history.update(id,{delivery:'local_write_failed'});assert.equal(history.get(id).state,'succeeded');assert.equal(history.get(id).remote_ack,'unknown');
  history.update(id,{delivery:'local_write_succeeded'});await transport.close();assert.equal(history.get(id).delivery,'local_write_succeeded');
});

test('detached task output stays within 4MiB, uses the shared budget and redacts secrets before chunking',t=>{
  const {home}=fixture(t);const {TaskOutput,TASK_LIMIT}=require('../app/task-output.cjs');
  const task='task_'+'d'.repeat(64),dir=path.join(home,'tasks',task);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'state.json'),'{}');const file=path.join(dir,'output.jsonl');
  const log=new TaskOutput({home,file,secrets:['known-private-value']});log.append('stdout','known-private-value '+ 'z'.repeat(2020)+'token="another-secret"\n');log.flush();
  for(let n=0;n<350;n++)log.append('stdout',('output '+n+'\n').repeat(1500));log.close();
  assert.ok(log.truncated);assert.ok(fs.statSync(file).size<=TASK_LIMIT);const saved=fs.readFileSync(file,'utf8');assert.ok(!saved.includes('known-private-value'));assert.ok(!saved.includes('another-secret'));
  const active='task_'+'e'.repeat(64),activeDir=path.join(home,'tasks',active);fs.mkdirSync(activeDir);fs.writeFileSync(path.join(activeDir,'state.json'),'{}');const huge=fs.openSync(path.join(activeDir,'output.jsonl'),'w');fs.ftruncateSync(huge,46*1024*1024);fs.closeSync(huge);
  const capped=new TaskOutput({home,file:path.join(dir,'more.jsonl')});capped.append('stdout','must drop');capped.close();assert.ok(capped.truncated);assert.equal(capped.bytes,0);
});

test('real gateway SDK correlates wire requests, execution and local transport callbacks without network sockets',async t=>{
  const {Duplex}=require('node:stream');const {McpGateway}=require('../app/mcp-gateway.cjs');const {EventEmitter}=require('node:events');
  const {history}=fixture(t);
  class Socket extends Duplex{
    constructor(){super();this.messages=[];this.failedId=null;this.on('error',()=>{});}
    _read(){}
    _write(bytes,encoding,callback){const message=JSON.parse(bytes.toString());this.messages.push(message);if(message.id===this.failedId)return callback(new Error('write rejected'));callback();}
    receive(message){this.push(Buffer.from(JSON.stringify(message)+'\n'));}
  }
  const manager=new EventEmitter();Object.assign(manager,{history,records:new Map(),running:true,active:new Set(),services:{has:()=>true,call:async()=>ok},call:McpManager.prototype.call,dispatch:McpManager.prototype.dispatch});
  const gateway=new McpGateway(manager);gateway.token='test-private-token';t.after(()=>gateway.close());
  const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
  const socket=new Socket();gateway.accept(socket);socket.receive({token:gateway.token});await settle();
  socket.receive({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}});await settle();socket.receive({jsonrpc:'2.0',method:'notifications/initialized'});await settle();
  socket.receive({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'get_harness_status',arguments:{}}});await settle();
  assert.equal(history.rows().length,1,'gateway and dispatch update the same record');let record=history.rows()[0];assert.equal(record.state,'succeeded');assert.equal(record.delivery,'local_write_succeeded');assert.equal(record.remote_ack,'unknown');
  socket.failedId=3;socket.receive({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'mutation',arguments:{}}});await settle();
  record=history.rows().find(r=>r.tool==='mutation');assert.equal(record.state,'succeeded');assert.equal(record.delivery,'local_write_failed');
});

test('execution count and detailed diagnostic share are enforced before growth, with active records pinned',t=>{
  const {home,history}=fixture(t);const crypto=require('node:crypto');
  for(let n=0;n<10000;n++){const id='exec_'+crypto.randomUUID();fs.writeFileSync(history.file(id),JSON.stringify({request_id:id,state:'succeeded',received_at:new Date(n).toISOString(),tool:'old'}));}
  const active=history.begin('new',{});assert.ok(history.get(active));assert.equal(history.rows().length,10000);
  const diagnostics=path.join(home,'diagnostics');fs.mkdirSync(diagnostics);fs.writeFileSync(path.join(diagnostics,'verbose.tmp'),Buffer.alloc(11*1024*1024));locked(home,()=>cleanup(home));assert.ok(!fs.existsSync(path.join(diagnostics,'verbose.tmp')));assert.ok(history.get(active));
});

test('execution updates coalesce through shared-lock contention with a bounded retry queue',t=>{
  const {history,home}=fixture(t);let id;
  locked(home,()=>{id=history.begin('mutation',{});history.update(id,{state:'running'});history.complete(id,ok);assert.equal(history.pending.size,1);assert.equal(history.get(id).state,'succeeded');assert.ok(!fs.existsSync(history.file(id)));});
  history.flush();assert.equal(history.pending.size,0);assert.equal(JSON.parse(fs.readFileSync(history.file(id),'utf8')).state,'succeeded');
  const task='task_'+'f'.repeat(64),dir=path.join(home,'tasks',task);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'output.jsonl'),JSON.stringify({stream:'stdout',text:'token="private" safe stdout'})+'\n');
  history.update(id,{task_id:task});const detail=history.detail(id);assert.ok(detail.stdout.includes('safe stdout'));assert.ok(!detail.stdout.includes('private'));
});

test('legacy failed task without a finished_at is still terminal',t=>{
 const {history,home}=fixture(t),task='task_'+'a'.repeat(64),dir=path.join(home,'tasks',task);
 fs.mkdirSync(dir,{recursive:true});
 const id=history.begin('start_task',{});history.complete(id,{structuredContent:{task_id:task}});
 fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({state:'failed',updated_at:history.now(),error:{code:'TASK_START_FAILED'}}));
 history.maintain();
 assert.equal(history.get(id).state,'failed');
 assert.equal(history.get(id).task_finished,true);
 assert.equal(history.get(id).error_code,'TASK_START_FAILED');
});

test('task maintenance replaces submission execution flags with actual worker state and exit code',t=>{
  const {history,home}=fixture(t),task='task_'+'7'.repeat(64),dir=path.join(home,'tasks',task);
  fs.mkdirSync(dir,{recursive:true});
  const id=history.begin('start_task',{});
  history.complete(id,{structuredContent:{task_id:task,execution_state:'not_started',operation_executed:false}});
  fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({state:'running',updated_at:history.now(),started_at:history.now(),execution_state:'running',operation_executed:true}));
  history.maintain();
  assert.equal(history.get(id).execution_state,'running');
  assert.equal(history.get(id).operation_executed,true);
  fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({state:'failed',updated_at:history.now(),finished_at:history.now(),execution_state:'completed',operation_executed:true,exit_code:17}));
  history.maintain();
  assert.equal(history.get(id).state,'failed');
  assert.equal(history.get(id).execution_state,'completed');
  assert.equal(history.get(id).operation_executed,true);
  assert.equal(history.get(id).exit_code,17);
});

test('ordinary built-in file calls retain bounded explicit scopes without inferring commands or third-party scope',t=>{
  const {history}=fixture(t);
  const read=history.begin('read_file',{path:'/project/readme.md'});
  assert.deepEqual(history.get(read).scope_paths,['/project/readme.md']);
  const many=history.begin('read_multiple_files',{paths:['/project/a','/other/b','/project/a']},'builtin');
  assert.deepEqual(history.get(many).scope_paths,['/project/a','/other/b']);
  const move=history.begin('move_file',{source:'/project/a',destination:'/other/b'},'builtin');
  assert.deepEqual(history.get(move).scope_paths,['/project/a','/other/b']);
  const edit=history.begin('edit_block',{file_path:'/project/a',options:{outputPath:'/project/b',sourcePdf:'/other/source.pdf'}},'builtin');
  assert.deepEqual(history.get(edit).scope_paths,['/project/a','/project/b','/other/source.pdf']);
  for(const [tool,args,service]of [
    ['read_file',{project_path:'/project',path:'/project/a'},'builtin'],
    ['read_file',{path:'/project/a'},'external'],
    ['read_file',{path:'https://example.com/a'},'builtin'],
    ['read_file',{path:'/project/a',isUrl:true},'builtin'],
    ['read_file',{path:'relative/a'},'builtin'],
    ['read_file',{path:'/project/'+ 'x'.repeat(600)},'builtin'],
    ['read_multiple_files',{paths:['/project/a','relative/b']},'builtin'],
    ['read_multiple_files',{paths:Array.from({length:129},(_,index)=>'/project/'+index)},'builtin'],
    ['edit_block',{file_path:'/project/a',content:'[{"sourcePdfPath":"/other/source.pdf"}]'},'builtin'],
    ['start_process',{path:'/project',command:'cat /project/a',context_paths:['/project']},'builtin'],
    ['unknown_tool',{path:'/project/a'},'Harness'],
  ])assert.equal(history.get(history.begin(tool,args,service)).scope_paths,undefined,tool+' must not infer an incomplete scope');
  const bounded=history.begin('read_multiple_files',{paths:Array.from({length:128},(_,index)=>'/p/'+index)},'builtin');
  assert.equal(history.get(bounded).scope_paths.length,128);
  assert.ok(Buffer.byteLength(JSON.stringify(history.get(bounded)))<24576);
});
