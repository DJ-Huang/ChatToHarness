'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {PassThrough}=require('node:stream');
const {once,EventEmitter}=require('node:events');
const sharp=require('sharp');
const {McpProxy,wireProtocol}=require('../app/mcp-proxy.cjs');
const {ProjectContexts}=require('../app/project-context.cjs');
const {HarnessServices}=require('../app/harness-services.cjs');
const {McpGateway}=require('../app/mcp-gateway.cjs');
const {MAX_MESSAGE_BYTES,INLINE_IMAGE_BYTES,MAX_FILE_CHUNK_BYTES,FILE_CHUNK_BYTES,IMAGE_PREVIEW_BYTES,MAX_ARTIFACT_BYTES,PREVIEW_CHUNK_BYTES,MAX_TEXT_CHUNK_BYTES}=require('../app/mcp-limits.cjs');
const {AjvJsonSchemaValidator}=require('@modelcontextprotocol/sdk/validation/ajv');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const call=(id,args)=>({jsonrpc:'2.0',id,method:'tools/call',params:{name:'read_file',arguments:args}});
function fixture(t){
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'cth-image-delivery-')));
  const project=path.join(directory,'project');fs.mkdirSync(project);
  const contexts=new ProjectContexts({allowedDirectories:[project],defaultDirectory:project});
  const services=new HarnessServices({home:path.join(directory,'home')});services.configure({directories:[project],autoProjectContext:false});
  const sent=[],forwarded=[];
  const proxy=new McpProxy({contexts,enabled:false,defaultDirectory:project,sendClient:async m=>sent.push(m),sendServer:async m=>forwarded.push(m)});
  t.after(()=>{proxy.dispose();services.dispose();fs.rmSync(directory,{recursive:true,force:true});});
  return {directory,project,proxy,services,sent,forwarded};
}

test('image delivery: native bytes occur once and mirrors reference original blocks',async t=>{
  const f=fixture(t),data=crypto.randomBytes(4*1024*1024).toString('base64');
  fs.writeFileSync(path.join(f.project,'small.png'),Buffer.from([0]));
  await f.proxy.client(call(1,{path:'small.png'}));
  const upstream={content:[{type:'image',mimeType:'image/png',data},{type:'audio',mimeType:'audio/wav',data:'YXVkaW8='},
    {type:'resource',resource:{uri:'test://binary',mimeType:'application/octet-stream',blob:'YmxvYg=='}}]};
  await f.proxy.server({jsonrpc:'2.0',id:1,result:upstream});
  const result=f.sent.at(-1).result,wire=JSON.stringify(result);
  assert.equal(wire.split(data).length-1,1);
  assert.ok(Buffer.byteLength(wire)<MAX_MESSAGE_BYTES);
  assert.deepEqual(result.content,upstream.content);
  assert.deepEqual(result.structuredContent._harness_result.content,[{type:'image',mimeType:'image/png',content_index:0},
    {type:'audio',mimeType:'audio/wav',content_index:1},
    {type:'resource',resource:{uri:'test://binary',mimeType:'application/octet-stream'},content_index:2}]);
});

test('image delivery: large local reads return manifests after scope checks; small and URL reads retain forwarding',async t=>{
  const f=fixture(t),large=path.join(f.project,'large.png'),small=path.join(f.project,'small.png');
  fs.writeFileSync(large,Buffer.alloc(INLINE_IMAGE_BYTES+1));fs.writeFileSync(small,Buffer.alloc(INLINE_IMAGE_BYTES));
  await f.proxy.client(call(1,{path:large,project_path:f.project,offset:0,length:1}));
  const manifest=f.sent.at(-1).result.structuredContent;
  assert.equal(f.forwarded.length,0);assert.equal(manifest.delivery,'chunked');assert.equal(manifest.size,INLINE_IMAGE_BYTES+1);
  assert.deepEqual(manifest.next_arguments,{project_path:f.project,path:large,preview:true});
  const tool=f.proxy.decorateTool({name:'read_file',inputSchema:{type:'object'},outputSchema:{type:'object',properties:{old:{type:'string'}},required:['old'],additionalProperties:false}});
  assert.equal(new AjvJsonSchemaValidator().getValidator(tool.outputSchema)(manifest).valid,true);
  await f.proxy.client(call(2,{path:small}));assert.equal(f.forwarded.length,1);
  await f.proxy.client(call(3,{path:'https://example.invalid/large.png',isUrl:true}));assert.equal(f.forwarded.length,2);
  const outside=path.join(f.directory,'outside.png');fs.writeFileSync(outside,Buffer.alloc(INLINE_IMAGE_BYTES+1));
  await f.proxy.client(call(4,{path:outside}));assert.equal(f.sent.at(-1).result.structuredContent.code,'PATH_NOT_ALLOWED');
  const sub=path.join(f.project,'sub');fs.mkdirSync(sub);
  await f.proxy.client(call(5,{path:large,project_path:sub}));assert.equal(f.sent.at(-1).result.structuredContent.code,'TARGET_OUTSIDE_PROJECT');
  assert.equal(f.forwarded.length,2);
});

test('image delivery: large originals round-trip in bounded chunks and derived previews preserve bytes',async t=>{
  const f=fixture(t),file=path.join(f.project,'noise.png');
  const original=await sharp(crypto.randomBytes(1600*1100*3),{raw:{width:1600,height:1100,channels:3}}).png().toBuffer();
  fs.writeFileSync(file,original);const digest=sha(original),chunks=[];
  let offset=0,count=0;
  do{
    const result=await f.services.call('get_file_result',{project_path:f.project,path:file,offset,length:MAX_FILE_CHUNK_BYTES});
    assert.equal(result.isError,undefined);const v=result.structuredContent,bytes=Buffer.from(v.data,'base64');
    assert.equal(v.offset,offset);assert.equal(v.length,bytes.length);assert.equal(v.chunk_sha256,sha(bytes));assert.equal(v.sha256,digest);
    assert.ok(Buffer.byteLength(JSON.stringify(result))<MAX_MESSAGE_BYTES);assert.equal(v.eof,!v.has_more);
    chunks.push(bytes);count++;offset=v.next_offset;if(!v.has_more)break;
  }while(count<20);
  assert.equal(count,Math.ceil(original.length/MAX_FILE_CHUNK_BYTES));assert.deepEqual(Buffer.concat(chunks),original);
  const repeated=await f.services.call('get_file_result',{project_path:f.project,path:file,length:MAX_FILE_CHUNK_BYTES});
  assert.deepEqual(Buffer.from(repeated.structuredContent.data,'base64'),chunks[0]);
  const preview=await f.services.call('get_file_result',{project_path:f.project,path:file,preview:true});
  assert.equal(preview.structuredContent.length,PREVIEW_CHUNK_BYTES);assert.equal(preview.structuredContent.preview.derived,true);
  const image=preview.content.find(b=>b.type==='image');assert.equal(image.mimeType,'image/jpeg');
  const bytes=Buffer.from(image.data,'base64');assert.ok(bytes.length<=IMAGE_PREVIEW_BYTES);
  assert.equal(sha(bytes),preview.structuredContent.preview.sha256);assert.equal((await sharp(bytes).metadata()).format,'jpeg');
  assert.equal(preview.structuredContent.sha256,digest);assert.deepEqual(fs.readFileSync(file),original);
  const eof=await f.services.call('get_file_result',{project_path:f.project,path:file,offset:original.length});
  assert.equal(eof.structuredContent.eof,true);assert.equal(eof.structuredContent.data,'');
  for(const args of [{length:MAX_FILE_CHUNK_BYTES+1},{length:0},{offset:original.length+1}]){
    const result=await f.services.call('get_file_result',{project_path:f.project,path:file,...args});assert.equal(result.structuredContent.code,'INVALID_ARGUMENT');
  }
});

test('image delivery: unavailable previews keep original chunks; oversize and unauthorized files remain rejected',async t=>{
  const f=fixture(t),bad=path.join(f.project,'invalid.png');fs.writeFileSync(bad,Buffer.alloc(IMAGE_PREVIEW_BYTES+1,123));
  const result=await f.services.call('get_file_result',{project_path:f.project,path:bad,preview:true});
  assert.equal(result.isError,undefined);assert.equal(result.structuredContent.preview_unavailable,true);
  assert.equal(Buffer.from(result.structuredContent.data,'base64').length,PREVIEW_CHUNK_BYTES);
  const huge=path.join(f.project,'huge.png'),fd=fs.openSync(huge,'w');fs.ftruncateSync(fd,MAX_ARTIFACT_BYTES+1);fs.closeSync(fd);
  assert.equal((await f.services.call('get_file_result',{project_path:f.project,path:huge})).structuredContent.code,'FILE_TOO_LARGE');
  assert.equal((await f.services.call('get_file_result',{project_path:f.project,path:path.join(f.directory,'outside.png')})).isError,true);
});

test('image delivery: gateway binary chunks bypass nested text paging and retain saved results',async t=>{
  const f=fixture(t),file=path.join(f.project,'binary.png');fs.writeFileSync(file,crypto.randomBytes(MAX_FILE_CHUNK_BYTES+7));
  const manager=new EventEmitter();manager.services=f.services;manager.tools=f.services.tools();manager.desktopSettings={directories:[f.project]};
  manager.call=(name,args)=>f.services.call(name,args);manager.log=()=>{};
  const gateway=new McpGateway(manager);t.after(()=>gateway.close());
  const result=await gateway.toolCall('get_file_result',{project_path:f.project,path:file,length:MAX_FILE_CHUNK_BYTES});
  assert.equal(result.structuredContent.kind,undefined);assert.equal(result.structuredContent.length,MAX_FILE_CHUNK_BYTES);
  assert.equal(Buffer.from(result.structuredContent.data,'base64').length,MAX_FILE_CHUNK_BYTES);
  const next=await gateway.toolCall(result.structuredContent.next_tool,result.structuredContent.next_arguments);
  assert.equal(next.structuredContent.eof,true);assert.equal(next.structuredContent.length,7);
});

test('image delivery: oversized builtin replies fail only delivery and the next response succeeds',async t=>{
  const f=fixture(t),clientInput=new PassThrough(),clientOutput=new PassThrough(),serverInput=new PassThrough(),serverOutput=new PassThrough();
  let fatal=false;const wire=wireProtocol({clientInput,clientOutput,serverInput,serverOutput,proxy:f.proxy,onFatal:()=>{fatal=true;}});
  t.after(()=>{wire.close();for(const s of [clientInput,clientOutput,serverInput,serverOutput])s.destroy();});
  let received=once(clientOutput,'data');
  serverOutput.write(JSON.stringify({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:'x'.repeat(MAX_MESSAGE_BYTES+1)}]}})+'\n');
  const [bytes]=await received,first=JSON.parse(bytes);
  assert.equal(first.result.structuredContent.code,'MCP_MESSAGE_TOO_LARGE');assert.equal(first.result.structuredContent.execution_state,'completed');
  assert.equal(first.result.structuredContent.result_omitted,true);assert.ok(bytes.length<MAX_MESSAGE_BYTES);assert.equal(fatal,false);
  received=once(clientOutput,'data');serverOutput.write(JSON.stringify({jsonrpc:'2.0',id:2,result:{content:[{type:'text',text:'still available'}]}})+'\n');
  const [next]=await received;assert.equal(JSON.parse(next).result.content[0].text,'still available');assert.equal(fatal,false);
});


test('image delivery: fitting originals use one call; explicit legacy ranges and small previews remain compatible',async t=>{
  const f=fixture(t),file=path.join(f.project,'original.bin'),original=crypto.randomBytes(4901956);fs.writeFileSync(file,original);
  const result=await f.services.call('get_file_result',{project_path:f.project,path:file});
  assert.equal(result.structuredContent.eof,true);assert.equal(result.structuredContent.length,original.length);
  assert.equal(sha(Buffer.from(result.structuredContent.data,'base64')),sha(original));
  assert.equal(result.structuredContent.next_arguments,undefined);
  for(const length of [8192,65536,524288]){
    const r=await f.services.call('get_file_result',{project_path:f.project,path:file,length});
    assert.equal(r.structuredContent.length,length);assert.equal(r.structuredContent.next_arguments.length,length);
  }
  const preview=await f.services.call('get_file_result',{project_path:f.project,path:file,preview:true});
  assert.equal(preview.structuredContent.length,PREVIEW_CHUNK_BYTES);
  assert.equal(preview.structuredContent.next_arguments.length,undefined,'Default continuations do not advertise a new explicit length to stale clients.');
  const text=path.join(f.project,'large.txt');fs.writeFileSync(text,'x'.repeat(MAX_TEXT_CHUNK_BYTES+1));
  assert.equal((await f.services.call('get_file_result',{project_path:f.project,path:text,length:MAX_TEXT_CHUNK_BYTES+1})).structuredContent.code,'INVALID_ARGUMENT');
});

test('image delivery: maximum binary page plus maximum native preview stays within wire and snapshot budgets',async t=>{
  const f=fixture(t),file=path.join(f.project,'limit.bin'),original=crypto.randomBytes(MAX_FILE_CHUNK_BYTES);fs.writeFileSync(file,original);
  const result=await f.services.call('get_file_result',{project_path:f.project,path:file});
  result.content.push({type:'image',mimeType:'image/jpeg',data:Buffer.alloc(IMAGE_PREVIEW_BYTES).toString('base64')});
  assert.ok(Buffer.byteLength(JSON.stringify({jsonrpc:'2.0',id:1,result}))<MAX_MESSAGE_BYTES);
  const manager=new EventEmitter();manager.services=f.services;manager.tools=f.services.tools();manager.desktopSettings={directories:[f.project]};manager.log=()=>{};
  manager.call=async()=>result;const gateway=new McpGateway(manager);t.after(()=>gateway.close());
  const delivered=await gateway.toolCall('get_file_result',{project_path:f.project,path:file,preview:true});
  assert.equal(delivered,result);assert.equal(delivered.structuredContent.kind,undefined);
  const snapshotName=[...gateway.results.cache.files.keys()].find(name=>/^result_.*\.json$/.test(name));assert.ok(snapshotName);
  const saved=await gateway.results.cache.read(snapshotName.slice(0,-5));
  assert.equal(saved.result.structuredContent.sha256,sha(original));
  assert.equal(sha(Buffer.from(saved.result.structuredContent.data,'base64')),sha(original));
  assert.equal(saved.result.content.at(-1).data.length,result.content.at(-1).data.length);
});


test('image delivery: previews stay lightweight when the exact original fits one byte page',async t=>{
  const f=fixture(t),file=path.join(f.project,'native.png');
  const original=await sharp(crypto.randomBytes(1500*1000*3),{raw:{width:1500,height:1000,channels:3}}).png().toBuffer();
  assert.ok(original.length>IMAGE_PREVIEW_BYTES&&original.length<MAX_FILE_CHUNK_BYTES);fs.writeFileSync(file,original);
  const result=await f.services.call('get_file_result',{project_path:f.project,path:file,preview:true}),v=result.structuredContent;
  assert.equal(result.isError,undefined);assert.equal(v.preview.derived,true);assert.equal(v.preview.mime_type,'image/jpeg');
  assert.equal(v.length,PREVIEW_CHUNK_BYTES);assert.ok(v.preview.byte_length<=IMAGE_PREVIEW_BYTES);assert.equal(v.sha256,sha(original));
  const native=result.content.find(b=>b.type==='image');assert.equal(native.mimeType,'image/jpeg');
  assert.equal(sha(Buffer.from(native.data,'base64')),v.preview.sha256);assert.ok(v.preview.width<=1600);assert.ok(v.preview.height<=1600);assert.ok(Buffer.byteLength(JSON.stringify(result))<2*1024*1024);
  assert.ok(Buffer.byteLength(JSON.stringify({jsonrpc:'2.0',id:1,result}))<MAX_MESSAGE_BYTES);
  assert.equal(sha(fs.readFileSync(file)),sha(original));
  const explicit=await f.services.call('get_file_result',{project_path:f.project,path:file,preview:true,length:MAX_TEXT_CHUNK_BYTES});
  assert.equal(explicit.structuredContent.length,MAX_TEXT_CHUNK_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify({jsonrpc:'2.0',id:1,result:explicit}))<MAX_MESSAGE_BYTES);
  const excessive=await f.services.call('get_file_result',{project_path:f.project,path:file,preview:true,length:MAX_FILE_CHUNK_BYTES});
  assert.equal(excessive.structuredContent.code,'INVALID_ARGUMENT','Do not combine a full Base64 page with a full native original.');
  await f.proxy.client(call('manifest',{path:file,project_path:f.project}));
  assert.deepEqual(f.sent.at(-1).result.structuredContent.original_arguments,{project_path:f.project,path:file,preview:false});
});
