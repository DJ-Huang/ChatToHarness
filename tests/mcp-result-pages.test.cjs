'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {McpResultPages,INLINE_BYTES,decorateTool}=require('../app/mcp-result-pages.cjs');

const source={tool:'fixture',scope:'authorized'};
function fixture(t,options={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cth-result-pages-test-'));
  const pages=new McpResultPages({directory,...options});
  t.after(async()=>{await pages.close();fs.rmSync(directory,{recursive:true,force:true});});
  return {pages,directory};
}
async function collect(pages,first){
  const chunks=[],sourceError=first.isError;let current=first.structuredContent;
  for(let guard=0;guard<1000;guard++){
    const {_meta,...publicResult}=first;
    assert.ok(Buffer.byteLength(JSON.stringify(publicResult))<=INLINE_BYTES);
    assert.equal(current.offset,chunks.reduce((sum,text)=>sum+Buffer.byteLength(text),0));
    chunks.push(current.text);
    if(!current.has_more)break;
    assert.ok(current.next_offset>current.offset);
    first=await pages.call('get_tool_result_page',{result_id:current.result_id,offset:current.next_offset});
    assert.equal(first.isError,sourceError);
    current=first.structuredContent;
  }
  const text=chunks.join('');
  assert.equal(Buffer.byteLength(text),current.total_bytes);
  assert.equal(crypto.createHash('sha256').update(text).digest('hex'),current.sha256);
  return JSON.parse(text);
}

test('small plain results retain all original fields and never create a snapshot',async t=>{
  const {pages,directory}=fixture(t);
  const result={content:[{type:'text',text:'中文 stdout'}],structuredContent:{pid:42},_meta:{private:true},vendor:{kept:1}};
  assert.equal(await pages.deliver(result,source),result);
  assert.deepEqual(fs.readdirSync(directory),[]);
});
test('large results round-trip Unicode, control characters, domain fields and errors within the wire budget',async t=>{
  const {pages}=fixture(t);
  for(const isError of [undefined,false,true]){
    const result={content:[{type:'text',text:('中文😀\\\"\n\t\u0000').repeat(2500)}],structuredContent:{pid:42,session_id:'search_original',retry_patch:{project_context_tokens:['token']}},...(isError===undefined?{}:{isError}),vendor:{all:'preserved'}};
    const first=await pages.deliver(result,source);
    assert.equal(first.structuredContent.kind,'harness_result_page');
    assert.deepEqual(await collect(pages,first),result);
    assert.equal(first.isError,isError);
    const repeated=await pages.call('get_tool_result_page',{result_id:first.structuredContent.result_id});
    assert.deepEqual(repeated,first,'reads are immutable and do not consume pages');
  }
});
test('native files are deferred and deduplicated across result representations; client metadata stays private',async t=>{
  const {pages}=fixture(t);
  const blocks=[
    {type:'image',mimeType:'image/png',data:'c3ludGhldGljLWltYWdl',annotations:{audience:['user']}},
    {type:'audio',mimeType:'audio/wav',data:'c3ludGhldGljLWF1ZGlv'},
    {type:'resource',resource:{uri:'fixture://text',mimeType:'text/plain',text:'完整文件正文'}},
    {type:'resource_link',uri:'fixture://download',name:'original name',description:'kept with file'}
  ];
  const result={content:[{type:'text',text:'result preview'},...blocks],structuredContent:{_harness_result:{content:blocks},contents:[blocks[2].resource]},_meta:{clientOnly:'PRIVATE_TOKEN'}};
  const first=await pages.deliver(result,source);
  assert.equal(first.structuredContent.file_count,4);
  assert.ok(first.content.every(block=>block.type==='text'));
  const projected=await collect(pages,first);
  assert.doesNotMatch(JSON.stringify(projected),/PRIVATE_TOKEN|c3ludGhldGlj|完整文件正文/);
  assert.deepEqual(first._meta,result._meta);
  for(const [index,block] of blocks.entries()){
    assert.equal(projected.content[index+1].$harness_file.file_index,index);
    assert.equal(projected.structuredContent._harness_result.content[index].$harness_file.file_index,index);
    const file=await pages.call('get_tool_result_file',{result_id:first.structuredContent.result_id,file_index:index});
    assert.deepEqual(file.content,[block]);
  }
  assert.equal(projected.structuredContent.contents[0].$harness_file.file_index,2);
  assert.deepEqual(result.content.slice(1),blocks,'projection does not mutate upstream data');
});
test('saved results survive a new store instance and enforce current source authorization',async t=>{
  let allowed=true;const {pages,directory}=fixture(t,{authorize:binding=>allowed&&binding.scope===source.scope});
  const first=await pages.deliver({content:[{type:'text',text:'saved '.repeat(10000)}]},source);
  await pages.close();
  const reopened=new McpResultPages({directory,authorize:binding=>allowed&&binding.scope===source.scope});
  assert.deepEqual(await reopened.call('get_tool_result_page',{result_id:first.structuredContent.result_id}),first);
  if(process.platform!=='win32'){
    assert.equal(fs.statSync(directory).mode&0o777,0o700);
    assert.equal(fs.statSync(path.join(directory,`${first.structuredContent.result_id}.json`)).mode&0o777,0o600);
  }
  allowed=false;
  for(const name of ['get_tool_result_page','get_tool_result_file'])assert.equal((await reopened.call(name,{result_id:first.structuredContent.result_id,file_index:0})).structuredContent.code,'MCP_RESULT_DENIED');
});
test('invalid IDs, offsets, lengths and file indexes fail without consuming saved data',async t=>{
  const {pages}=fixture(t);
  const first=await pages.deliver({content:[{type:'text',text:'😀中文'.repeat(4000)}]},source),result_id=first.structuredContent.result_id;
  for(const args of [{result_id:'../../outside'},{result_id,offset:-1},{result_id,offset:13.5},{result_id,offset:9999999},{result_id,length:1},{result_id,length:10000}])assert.equal((await pages.call('get_tool_result_page',args)).isError,true);
  assert.equal((await pages.call('get_tool_result_file',{result_id,file_index:0})).structuredContent.code,'MCP_INVALID_ARGUMENTS');
  assert.deepEqual(await pages.call('get_tool_result_page',{result_id}),first);
});
test('storage failure returns the exact original operation result and logs no output',async t=>{
  const logs=[];const {directory}=fixture(t);const blocked=path.join(directory,'not-a-directory');fs.writeFileSync(blocked,'occupied');
  const pages=new McpResultPages({directory:blocked,log:(...args)=>logs.push(args)});
  const result={content:[{type:'text',text:'secret output '.repeat(3000)}],structuredContent:{task_id:'already-started'}};
  assert.equal(await pages.deliver(result,source),result);
  assert.equal(logs.length,1);assert.doesNotMatch(JSON.stringify(logs),/secret output|already-started/);
});
test('explicit native delivery preserves its existing format and schemas are decorated without mutation',async t=>{
  const {pages}=fixture(t);const result={content:[{type:'image',mimeType:'image/png',data:'large '.repeat(5000)}]};
  assert.equal(await pages.deliver(result,source,{explicitFiles:true}),result);
  const tool={name:'strict',outputSchema:{type:'object',$defs:{row:{type:'string'}},properties:{value:{$ref:'#/$defs/row'}},required:['value'],additionalProperties:false}};
  const original=structuredClone(tool);const decorated=decorateTool(tool);
  assert.deepEqual(tool,original);
  assert.equal(decorated.outputSchema.$defs.harness_original.properties.value.$ref,'#/$defs/harness_original/$defs/row');
});

test('known builtin results return a usable bounded summary and retain their complete immutable result',async t=>{
  const {pages}=fixture(t),binding={tool:'search_project',service:'builtin',scope:'authorized'};
  const result={content:[{type:'text',text:'large search response '.repeat(3000)}],structuredContent:{project_path:'/synthetic/project',results:Array.from({length:50},(_,index)=>({path:`/synthetic/project/${index}.txt`,line:index+1,text:'中文 result '.repeat(100)})),has_more:false}};
  const first=await pages.deliver(result,binding,{knownBuiltin:true}),summary=first.structuredContent;
  assert.equal(summary.kind,'harness_result_summary');assert.equal(summary.complete,false);assert.equal(summary.requires_full_guidance,false);
  assert.equal(summary.preview.results[0].path,'/synthetic/project/0.txt');assert.equal(summary.preview.results[0].line,1);
  assert.ok(Buffer.byteLength(JSON.stringify(first))<=INLINE_BYTES);assert.match(summary.next_action,/only for full details/);
  const rawFirst=await pages.call('get_tool_result_page',{result_id:summary.result_id});
  assert.deepEqual(await collect(pages,rawFirst),result);
  assert.deepEqual(await pages.call('get_tool_result_page',{result_id:summary.result_id}),rawFirst);
  const small={content:[{type:'text',text:'small'}],structuredContent:{state:'succeeded'}};
  assert.equal(await pages.deliver(small,binding,{knownBuiltin:true}),small);
});

test('summary guidance is explicitly incomplete and cannot expose a delivery token or retry patch',async t=>{
  const {pages}=fixture(t),context={project_context_token:'SECRET_GUIDANCE_TOKEN',agents:[{body:'Required project instructions. '.repeat(2500)}],loaded_rules:[],loaded_skills:[]};
  const result={isError:true,content:[{type:'text',text:JSON.stringify({contexts:[context]})}],structuredContent:{code:'PROJECT_CONTEXT_REFRESH_REQUIRED',message:'Read complete guidance before writing.',contexts:[context],retry_patch:{project_context_tokens:['SECRET_GUIDANCE_TOKEN']},operation_executed:false,execution_state:'not_started'}};
  const first=await pages.deliver(result,{tool:'start_task',scope:'authorized'},{knownBuiltin:true});
  assert.equal(first.isError,true);assert.equal(first.structuredContent.guidance_complete,false);assert.equal(first.structuredContent.requires_full_guidance,true);
  assert.equal(first.structuredContent.preview.execution_state,'not_started');assert.match(first.structuredContent.next_action,/Read every get_tool_result_page/);
  assert.doesNotMatch(JSON.stringify(first),/SECRET_GUIDANCE_TOKEN|retry_patch|Required project instructions/);
  const raw=await pages.call('get_tool_result_page',{result_id:first.structuredContent.result_id});
  assert.deepEqual(await collect(pages,raw),result,'complete guidance remains available without replaying the write');
});

test('large builtin text-only mirrors remain useful while third-party results use their original paging contract',async t=>{
  const {pages}=fixture(t),raw={content:[{type:'text',text:'file line with selected information '.repeat(1000)}]},result={...raw,structuredContent:{_harness_result:raw,project_contexts:[{reused:true,project_context_token:'already-delivered'}]}};
  const summary=await pages.deliver(result,{tool:'read_file',scope:'authorized'},{knownBuiltin:true});
  assert.match(summary.structuredContent.preview.text,/selected information/);assert.equal(summary.structuredContent.requires_full_guidance,false);
  const thirdParty=await pages.deliver(result,{tool:'custom__read_file',scope:'authorized',service:'custom'});
  assert.equal(thirdParty.structuredContent.kind,'harness_result_page');
  assert.deepEqual(await collect(pages,thirdParty),result);
  const decorated=decorateTool({name:'search_project',outputSchema:{type:'object',properties:{results:{type:'array'}},required:['results']}});
  assert.ok(decorated.outputSchema.anyOf.some(schema=>schema.properties?.kind?.const==='harness_result_summary'));
});
