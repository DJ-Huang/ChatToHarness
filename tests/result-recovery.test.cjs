'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {McpResultPages}=require('../app/mcp-result-pages.cjs');
const {ExecutionHistory}=require('../app/execution-history.cjs');
const {recoveryInfo}=require('../app/tool-recovery.cjs');
const {McpGateway}=require('../app/mcp-gateway.cjs');
const {HarnessServices}=require('../app/harness-services.cjs');
const {EventEmitter}=require('node:events');

test('gateway links a lost reply to project execution summaries and recovery reads never re-execute or snapshot themselves',async t=>{
  const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'cth gateway recovery '))),history=new ExecutionHistory(home);
  const definition={name:'fixture_command',inputSchema:{type:'object'}},manager=new EventEmitter();let calls=0;
  const result={content:[{type:'text',text:'original command output'}]};
  Object.assign(manager,{history,settings:{directory:home},records:new Map(),visibleTools:()=>[definition],call:async(_name,_args,options)=>{calls++;history.complete(options.executionId,result);return result;}});
  const gateway=new McpGateway(manager),services=new HarnessServices({home,history});services.configure({directories:[home]});
  t.after(async()=>{services.dispose();await gateway.close();history.close();fs.rmSync(home,{recursive:true,force:true});});
  const id=history.begin('fixture_command',{project_path:home});
  assert.equal(await gateway.toolCall('fixture_command',{}, {executionId:id}),result);
  const summary=await services.call('get_execution_summary',{project_path:home});
  const row=summary.structuredContent.items.find(item=>item.request_id===id);
  assert.ok(row,JSON.stringify(summary));
  assert.equal(row.result_status,'available');assert.ok(row.result_id);assert.equal(history.get(id).result_id,row.result_id);
  const snapshots=()=>fs.readdirSync(path.join(home,'result-pages')).filter(name=>name.startsWith('result_')).length;
  const before=snapshots();
  const recovered=await gateway.toolCall('get_tool_result_page',{result_id:row.result_id});
  assert.deepEqual(JSON.parse(recovered.structuredContent.text),result);assert.equal(calls,1);assert.equal(snapshots(),before);
});

function fixture(t,options={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cth-recovery-'));
  const stores=[];
  const open=(extra={})=>{const store=new McpResultPages({directory,authorize:source=>source.scope==='allowed',...options,...extra});stores.push(store);return store;};
  t.after(async()=>{for(const store of stores)await store.close();fs.rmSync(directory,{recursive:true,force:true});});
  return {directory,open};
}
const execution=()=> 'exec_'+crypto.randomUUID();
const source=request_id=>({tool:'read_file',scope:'allowed',execution_id:request_id});
const plain=text=>({content:[{type:'text',text}],structuredContent:{value:text},_meta:{private:'client-only'}});

test('small results keep their wire shape and recover by request identity across a lost reply and restart',async t=>{
  const f=fixture(t),first=f.open(),request_id=execution(),result=plain('small original result');let ref;
  assert.equal(await first.deliver(result,source(request_id),{capture:true,onSaved:value=>{ref=value;}}),result);
  assert.equal(ref.result_status,'available');assert.equal(ref.request_id,request_id);
  // Simulate failure to persist the history link after the immutable snapshot.
  fs.unlinkSync(path.join(f.directory,request_id+'.ref.json'));await first.close();
  const reopened=f.open(),info=await reopened.describe({request_id});
  assert.equal(info.result_id,ref.result_id);assert.equal(info.result_status,'available');
  const restored=await reopened.call('get_tool_result_page',{result_id:info.result_id});
  assert.deepEqual(JSON.parse(restored.structuredContent.text),{content:result.content,structuredContent:result.structuredContent});
  assert.doesNotMatch(restored.structuredContent.text,/client-only/);assert.deepEqual(restored._meta,result._meta);
  const denied=f.open({authorize:()=>false});
  assert.equal((await denied.call('get_tool_result_page',{result_id:info.result_id})).structuredContent.code,'MCP_RESULT_DENIED');
});

test('age and capacity eviction report expired results without touching durable task identities',async t=>{
  let now=Date.now();const f=fixture(t,{cacheOptions:{clock:()=>now,maxAge:1000,maxBytes:10000}}),store=f.open();
  const firstId=execution();let first;
  await store.deliver(plain('a'.repeat(1500)),source(firstId),{capture:true,onSaved:ref=>{first=ref;}});
  const task=path.join(f.directory,'task-guard');fs.writeFileSync(task,'never replay');
  const secondId=execution();let second;
  await store.deliver(plain('b'.repeat(1500)),source(secondId),{capture:true,onSaved:ref=>{second=ref;}});
  assert.equal((await store.describe({request_id:firstId})).result_status,'expired');
  assert.equal((await store.describe({request_id:secondId})).result_status,'available');
  assert.equal((await store.call('get_tool_result_page',{result_id:first.result_id})).structuredContent.code,'MCP_RESULT_EXPIRED');
  const bytes=fs.readdirSync(f.directory).filter(name=>name.endsWith('.json')).reduce((sum,name)=>sum+fs.statSync(path.join(f.directory,name)).size,0);
  assert.ok(bytes<=10000);assert.equal(fs.readFileSync(task,'utf8'),'never replay');
  now+=1001;
  assert.equal((await store.describe({request_id:secondId})).result_status,'expired');
  assert.equal((await store.call('get_tool_result_page',{result_id:second.result_id})).structuredContent.code,'MCP_RESULT_EXPIRED');
});

test('cache failure preserves completed results and marks recovery unavailable without leaking output into logs',async t=>{
  const f=fixture(t),blocked=path.join(f.directory,'blocked');fs.writeFileSync(blocked,'file');
  const logs=[],store=f.open({directory:blocked,log:(...args)=>logs.push(args)}),result=plain('sensitive original output');let ref;
  assert.equal(await store.deliver(result,source(execution()),{capture:true,onSaved:value=>{ref=value;}}),result);
  assert.equal(ref.result_status,'storage_failed');assert.doesNotMatch(JSON.stringify(logs),/sensitive original output/);
});
test('coalesced polls cannot recover a previous response as the current result, even in the same millisecond',async t=>{
  const f=fixture(t),store=f.open(),id=execution(),binding=source(id);let first,second;
  await store.deliver(plain('first poll'),binding,{capture:true,onSaved:ref=>{first=ref;}});
  assert.equal((await store.describe({request_id:id,poll_count:2})).result_status,'not_recorded');
  assert.equal((await store.describe({request_id:id,poll_count:2,result_status:'storage_failed'})).result_status,'storage_failed');
  await store.deliver(plain('second poll'),{...binding,execution_version:2},{capture:true,onSaved:ref=>{second=ref;}});
  assert.notEqual(first.result_id,second.result_id);
  const reopened=f.open();assert.equal((await reopened.describe({request_id:id,poll_count:2})).result_id,second.result_id);
  assert.equal((await reopened.describe({request_id:id})).result_id,second.result_id,'recover a newer snapshot even when the history update was lost');
  assert.equal(JSON.parse((await store.call('get_tool_result_page',{result_id:first.result_id})).structuredContent.text).structuredContent.value,'first poll');
});

test('recovery metadata keeps task identity, excludes raw commands/output and preserves unknown execution states',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'cth-recovery-history-')),history=new ExecutionHistory(home);
  t.after(()=>{history.close();fs.rmSync(home,{recursive:true,force:true});});
  const task_id='task_'+'e'.repeat(64),id=history.begin('start_task',{project_path:path.resolve(home),command:'private shell'});
  history.complete(id,{structuredContent:{task_id,terminal:true,state:'succeeded',execution_state:'completed',exit_code:0,finished_at:new Date().toISOString()}});
  assert.equal(history.get(id).state,'succeeded');assert.equal(history.get(id).task_finished,true);assert.equal(history.get(id).exit_code,0);
  const info=recoveryInfo({...history.get(id),state:'unknown',execution_state:'unknown',stdout:'private output'});
  assert.equal(info.execution_state,'unknown');assert.equal(info.next_arguments.task_id,task_id);
  assert.doesNotMatch(JSON.stringify(info),/private shell|private output/);
  const stale=history.begin('start_task',{});
  history.complete(stale,{structuredContent:{task_id,terminal:true,state:'interrupted',execution_state:'unknown'}});
  assert.equal(history.get(stale).state,'unknown');assert.notEqual(history.get(stale).task_finished,true);
  const legacy=recoveryInfo({request_id:execution(),state:'unknown'});assert.equal(legacy.result_status,'not_recorded');assert.equal(legacy.next_tool,undefined);
});

test('native preview and component result formats are preserved while their snapshots remain recoverable',async t=>{
  const f=fixture(t),store=f.open(),id=execution();let ref;
  const result={content:[{type:'image',mimeType:'image/png',data:'cGl4ZWxz'}],structuredContent:{widget:true}};
  assert.equal(await store.deliver(result,source(id),{capture:true,preserveOriginal:true,onSaved:value=>{ref=value;}}),result);
  const restored=await store.call('get_tool_result_file',{result_id:ref.result_id,file_index:0});assert.deepEqual(restored.content,result.content);
});
