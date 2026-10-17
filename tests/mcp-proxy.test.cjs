'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {PassThrough}=require('node:stream');
const path=require('node:path');
const projectA=path.resolve(path.sep,'project-a');
const projectB=path.resolve(path.sep,'project-b');
const inProject=(target,root)=>target===root||target.startsWith(root+path.sep);
const {McpProxy,wireProtocol,toolPaths}=require('../app/mcp-proxy.cjs');

function fixture(options={}) {
  const client=[],server=[],validations=[];
  const contexts={
    async authorizePaths(paths) { return paths; },
    async prepare(tokens,paths,{writing}={}) {
      if(writing&&(!Array.isArray(tokens)||!tokens.length))return {contexts:[],needsDelivery:true};
      if(Array.isArray(tokens)&&tokens.length)await this.validate(tokens,paths);
      return {contexts:[],needsDelivery:false};
    },
    async getContext(args) {return {project_path:args.project_path,project_context_token:`token:${args.project_path}`,agents:[],rules_index:[],loaded_rules:[]};},
    async validate(tokens,paths) {
      validations.push({tokens,paths});
      if (tokens.includes('stale')) throw Object.assign(new Error('Rules changed; reload context.'),{code:'context_stale'});
      if (paths.some(target=>inProject(target,projectB)) && !tokens.includes('b')) throw Object.assign(new Error('Missing project B.'),{code:'context_scope_mismatch'});
      if (paths.some(target=>inProject(target,projectA)) && !tokens.includes('a')) throw Object.assign(new Error('Missing project A.'),{code:'context_scope_mismatch'});
      return [];
    }
  };
  const proxy=new McpProxy({contexts,defaultDirectory:path.resolve('/default'),sendClient:async value=>client.push(value),sendServer:async value=>server.push(value),...options});
  return {proxy,client,server,validations,contexts};
}
const call=(id,name,args)=>({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}});

test('first write is blocked, context is delivered, explicit retry strips adapter fields',async()=>{
  const f=fixture();
  await f.proxy.client(call(1,'write_file',{path:path.join(projectA,'file.md'),content:'hello'}));
  assert.equal(f.server.length,0);
  assert.equal(f.client[0].result.structuredContent.operation_executed,false);
  assert.equal(f.client[0].result.structuredContent.next_tool,'get_project_context');
  await f.proxy.client(call(2,'get_project_context',{project_path:projectA,target_paths:[path.join(projectA,'file.md')]}));
  assert.equal(f.client[1].result.structuredContent.project_context_token,`token:${projectA}`);
  assert.equal(f.server.length,0,'context loading never replays a blocked operation');
  await f.proxy.client(call(3,'write_file',{path:path.join(projectA,'file.md'),content:'hello',project_context_tokens:['a']}));
  assert.deepEqual(f.server[0].params.arguments,{path:path.join(projectA,'file.md'),content:'hello'});
});

test('initialize and paginated discovery preserve protocol metadata and extend only tool schemas',async()=>{
  const f=fixture();
  await f.proxy.client({jsonrpc:'2.0',id:'i',method:'initialize',params:{protocolVersion:'2025-06-18'}});
  await f.proxy.server({jsonrpc:'2.0',id:'i',result:{instructions:'upstream instructions',capabilities:{tools:{listChanged:true}},serverInfo:{name:'dc'}}});
  assert.match(f.client[0].result.instructions,/^ChatToHarness:/);
  assert.match(f.client[0].result.instructions,/upstream instructions$/);
  assert.doesNotMatch(f.client[0].result.instructions,/automatically load|Never ask|before all/i);
  assert.equal(f.client[0].result.capabilities.tools.listChanged,true);
  await f.proxy.client({jsonrpc:'2.0',id:1,method:'tools/list',params:{}});
  await f.proxy.server({jsonrpc:'2.0',id:1,result:{tools:[{name:'start_process',description:'Legacy model workflow instructions',inputSchema:{type:'object',properties:{command:{type:'string'}},required:['command']},annotations:{destructiveHint:true}}],nextCursor:'next'}});
  assert.equal(f.client[1].result.tools.length,1);
  const tool=f.client[1].result.tools[0];
  assert.equal(tool.inputSchema.properties.project_context_tokens.type,'array');
  assert.equal(tool.inputSchema.properties.context_paths.type,'array');
  assert.deepEqual(tool.inputSchema.required,['command']);
  assert.equal(tool.annotations.destructiveHint,true);
  assert.equal(tool.annotations.readOnlyHint,false,'an arbitrary shell remains a write-capable tool');
  assert.equal(tool.annotations.openWorldHint,true);
  assert.match(tool.description,/Can modify files and access the network/);
  assert.doesNotMatch(tool.description,/Legacy|automatically load|Never ask/i);
  await f.proxy.client({jsonrpc:'2.0',id:2,method:'tools/list',params:{cursor:'next'}});
  await f.proxy.server({jsonrpc:'2.0',id:2,result:{tools:[]}});
  assert.equal(f.client[2].result.tools[0].name,'get_project_context');
});

test('stale and cross-project tokens block operations without sharing a global active project',async()=>{
  const f=fixture();
  await f.proxy.client(call('stale','write_file',{path:path.join(projectA,'x'),content:'x',project_context_tokens:['stale']}));
  assert.equal(f.server.length,0);
  assert.equal(f.client[0].result.structuredContent.code,'context_stale');
  await Promise.all([
    f.proxy.client(call('a','read_file',{path:path.join(projectA,'x'),project_context_tokens:['a']})),
    f.proxy.client(call('b','read_file',{path:path.join(projectB,'y'),project_context_tokens:['b']}))
  ]);
  assert.equal(f.server.length,2);
  await f.proxy.client(call('move-blocked','move_file',{source:path.join(projectA,'x'),destination:path.join(projectB,'y'),project_context_tokens:['a']}));
  assert.equal(f.server.length,2);
  await f.proxy.client(call('move-ok','move_file',{source:path.join(projectA,'x'),destination:path.join(projectB,'y'),project_context_tokens:['a','b']}));
  assert.equal(f.server.length,3);
});

test('shell targets are declared without parsing command; continuations retain originating scope',async()=>{
  const f=fixture();
  await f.proxy.client(call(1,'start_process',{command:'opaque arbitrary shell',project_context_tokens:['a']}));
  assert.equal(f.client[0].result.structuredContent.code,'context_paths_required');
  assert.equal(f.server.length,0);
  await f.proxy.client(call(2,'start_process',{command:'opaque arbitrary shell',timeout_ms:1000,context_paths:[path.join(projectA,'子目录/file')],project_context_tokens:['a']}));
  assert.deepEqual(f.validations[0].paths,[path.join(projectA,'子目录/file')]);
  assert.deepEqual(f.server[0].params.arguments,{command:'opaque arbitrary shell',timeout_ms:1000});
  await f.proxy.server({jsonrpc:'2.0',id:2,result:{content:[],structuredContent:{pid:42}}});
  await f.proxy.client(call(3,'read_process_output',{pid:42,project_context_tokens:['b']}));
  assert.equal(f.server.length,1,'another project token cannot read this process');
  await f.proxy.client(call(4,'read_process_output',{pid:42,project_context_tokens:['a']}));
  assert.equal(f.server.length,2);
  await f.proxy.client(call(5,'read_process_output',{pid:999,project_context_tokens:['a']}));
  assert.equal(f.client.at(-1).result.structuredContent.code,'context_origin_unknown');
});

test('search continuation validates the original target scope',async()=>{
  const f=fixture();
  await f.proxy.client(call('s','start_search',{path:projectA,pattern:'hello',project_context_tokens:['a']}));
  await f.proxy.server({jsonrpc:'2.0',id:'s',result:{content:[],structuredContent:{sessionId:'search_123'}}});
  await f.proxy.client(call('page-b','get_more_search_results',{sessionId:'search_123',project_context_tokens:['b']}));
  assert.equal(f.server.length,1);
  await f.proxy.client(call('page-a','get_more_search_results',{sessionId:'search_123',project_context_tokens:['a']}));
  assert.equal(f.server.length,2);
});

test('notifications, server requests, replies and concurrent IDs pass transparently',async()=>{
  const f=fixture();
  const notice={jsonrpc:'2.0',method:'notifications/progress',params:{progressToken:'a',progress:3}};
  const request={jsonrpc:'2.0',id:'server-id',method:'roots/list',params:{}};
  const reply={jsonrpc:'2.0',id:'server-id',result:{roots:[]}};
  await f.proxy.server(notice);await f.proxy.server(request);await f.proxy.client(reply);
  assert.deepEqual(f.client,[notice,request]);assert.deepEqual(f.server,[reply]);
  await Promise.all([f.proxy.client({jsonrpc:'2.0',id:1,method:'ping'}),f.proxy.client({jsonrpc:'2.0',id:'1',method:'ping'})]);
  await f.proxy.server({jsonrpc:'2.0',id:'1',result:{order:'string'}});
  await f.proxy.server({jsonrpc:'2.0',id:1,result:{order:'number'}});
  assert.equal(f.proxy.pending.size,0);
  const cancel={jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:99}};
  await f.proxy.client(cancel);assert.deepEqual(f.server.at(-1),cancel);
});

test('cancellation during asynchronous context/gate checks suppresses response and execution',async()=>{
  let finish;
  const f=fixture();
  f.contexts.getContext=()=>new Promise(resolve=>{finish=resolve;});
  const loading=f.proxy.client(call('context','get_project_context',{project_path:projectA}));
  await f.proxy.client({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:'context'}});
  finish({project_context_token:'a'});await loading;
  assert.equal(f.client.length,0);assert.equal(f.server.length,0);
  f.contexts.validate=()=>new Promise(resolve=>{finish=resolve;});
  const checking=f.proxy.client(call('write','write_file',{path:path.join(projectA,'x'),content:'x',project_context_tokens:['a']}));
  await f.proxy.client({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:'write'}});
  finish([]);await checking;
  assert.equal(f.server.length,0);
});

test('disabled gating keeps Desktop Commander behavior and strips fields',async()=>{
  const f=fixture({enabled:false});
  await f.proxy.client(call(1,'write_file',{path:path.join(projectA,'x'),content:'x',project_context_tokens:['stale'],context_paths:['/x']}));
  assert.deepEqual(f.server[0].params.arguments,{path:path.join(projectA,'x'),content:'x'});
  assert.equal(f.validations.length,0);
});

test('all tools omit optional widget rendering hints while preserving unrelated metadata and schemas',()=>{
  const f=fixture();
  for (const name of ['get_config','read_file']) {
    const schema={type:'object',properties:{path:{type:'string'}},required:['path']};
    const original={name,inputSchema:schema,annotations:{readOnlyHint:true},_meta:{'ui/resourceUri':'ui://preview','openai/outputTemplate':'ui://preview','openai/widgetAccessible':true,ui:{resourceUri:'ui://preview',visibility:['model']},'vendor/keep':'preserved'}};
    const clean=f.proxy.decorateTool(original);
    assert.deepEqual(clean._meta,{ui:{visibility:['model']},'vendor/keep':'preserved'});
    assert.equal(clean.annotations.readOnlyHint,true);
    if(name==='read_file'){assert.equal(clean.annotations.destructiveHint,false);assert.equal(clean.annotations.openWorldHint,true);}
    assert.deepEqual(clean.inputSchema.required,['path']);
    assert.deepEqual(clean.inputSchema.properties.path,{type:'string'});
    assert.equal(original._meta.ui.resourceUri,'ui://preview','upstream objects are not mutated');
    assert.equal(original._meta['openai/widgetAccessible'],true);
  }
  const bare=f.proxy.decorateTool({name:'get_config',inputSchema:{type:'object'},_meta:{'ui/resourceUri':'ui://preview',ui:{resourceUri:'ui://preview'}}});
  assert.equal(Object.prototype.hasOwnProperty.call(bare,'_meta'),false);
});

test('PDF operation source and destination paths are all included',()=>{
  assert.deepEqual(toolPaths('write_pdf',{path:'/a/input.pdf',outputPath:'/b/output.pdf',content:'[{"type":"insert","sourcePdfPath":"/c/source.pdf"}]'}),['/a/input.pdf','/b/output.pdf','/c/source.pdf']);
});

test('stdio framing preserves split UTF-8 and reports malformed client JSON without leaking content',async()=>{
  const f=fixture({enabled:false});
  const input=new PassThrough(),output=new PassThrough(),toServer=new PassThrough(),fromServer=new PassThrough();
  let wire='',fatal=0;
  output.on('data',chunk=>wire+=chunk.toString());
  const sent=[];let serverBuffer='';
  toServer.on('data',chunk=>{serverBuffer+=chunk.toString();let end;while((end=serverBuffer.indexOf('\n'))!==-1){sent.push(JSON.parse(serverBuffer.slice(0,end)));serverBuffer=serverBuffer.slice(end+1);}});
  const transport=wireProtocol({clientInput:input,clientOutput:output,serverInput:toServer,serverOutput:fromServer,proxy:f.proxy,onFatal:()=>fatal++});
  const packet=Buffer.from(JSON.stringify(call(4,'read_file',{path:'/中文 空格/test'}))+'\n');
  const split=packet.indexOf(Buffer.from('中'))+1;
  input.write(packet.subarray(0,split));input.write(packet.subarray(split));
  input.write('{invalid-secret-value}\n');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sent[0].params.arguments.path,'/中文 空格/test');
  assert.equal(JSON.parse(wire.trim()).error.code,-32700);
  assert.doesNotMatch(wire,/secret/);assert.equal(fatal,0);
  transport.close();
});

test('ordinary reads need no context token while access checks remain enabled',async()=>{
  const f=fixture();
  await f.proxy.client(call('read','read_file',{path:path.join(projectA,'x')}));
  assert.equal(f.server.length,1);
  f.contexts.authorizePaths=async()=>{throw Object.assign(new Error('Denied'),{code:'PATH_NOT_ALLOWED'});};
  await f.proxy.client(call('denied','read_file',{path:path.join(projectB,'x')}));
  assert.equal(f.server.length,1);assert.equal(f.client.at(-1).result.structuredContent.code,'PATH_NOT_ALLOWED');
  await f.proxy.client(call('config','set_config_value',{key:'allowedDirectories',value:[]}));
  assert.equal(f.server.length,1);assert.equal(f.client.at(-1).result.structuredContent.code,'directory_settings_required');
  f.proxy.dispose();
});

test('forwarded timeout reports unknown execution, drops late replies and never replays a write',async()=>{
  const f=fixture({enabled:false,requestTimeout:10});
  await f.proxy.client(call('write','write_file',{path:path.join(projectA,'x'),content:'x'}));
  await new Promise(resolve=>setTimeout(resolve,30));
  const result=f.client.at(-1).result.structuredContent;
  assert.equal(result.execution_state,'unknown');assert.equal(result.operation_executed,null);assert.equal(result.retryable,false);
  assert.equal(f.server.filter(message=>message.params?.name==='write_file').length,1);assert.equal(f.proxy.pending.size,0);
  const count=f.client.length;await f.proxy.server({jsonrpc:'2.0',id:'write',result:{content:[]}});assert.equal(f.client.length,count);
  f.proxy.dispose();
});

test('local deadlines abort preparation before forwarding and pending capacity is bounded',async()=>{
  const f=fixture({requestTimeout:10});
  f.contexts.prepare=(_tokens,_paths,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  const operation=f.proxy.client(call('prepare','write_file',{path:path.join(projectA,'x'),content:'x'}));
  await new Promise(resolve=>setTimeout(resolve,30));await operation;
  assert.equal(f.server.length,0);assert.equal(f.client.at(-1).result.structuredContent.execution_state,'not_started');
  const g=fixture({enabled:false,maxPending:1});
  await g.proxy.client(call('one','read_file',{path:path.join(projectA,'x')}));
  await g.proxy.client(call('two','read_file',{path:path.join(projectA,'y')}));
  assert.equal(g.proxy.pending.size,1);assert.equal(g.client.at(-1).result.structuredContent.code,'server_busy');
  f.proxy.dispose();g.proxy.dispose();
});

test('real context delivery keeps broken references readable and first writes reviewable',async t=>{
  const fs=require('node:fs'),os=require('node:os');
  const {ProjectContexts}=require('../app/project-context.cjs');
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'cth-proxy-context-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'AGENTS.md'),'Read `missing.json` and `docs/{en,ja}/GUIDE.md`.');
  const contexts=new ProjectContexts({defaultDirectory:root,allowedDirectories:[root]});
  const client=[],server=[],proxy=new McpProxy({contexts,defaultDirectory:root,sendClient:async m=>client.push(m),sendServer:async m=>server.push(m)});
  t.after(()=>proxy.dispose());const file=path.join(root,'source.txt');
  await proxy.client(call('first','write_file',{path:file,content:'new',project_path:root}));
  assert.equal(server.length,0);const fresh=client[0].result.structuredContent.contexts[0];assert.ok(fresh.project_context_token);
  await proxy.client(call('write','write_file',{path:file,content:'new',project_path:root,project_context_tokens:[fresh.project_context_token]}));
  assert.equal(server.length,1);
  fs.writeFileSync(path.join(root,'AGENTS.md'),Buffer.from([255,254]));
  await proxy.client(call('read','read_file',{path:file,project_path:root}));assert.equal(server.length,2);
  await proxy.server({jsonrpc:'2.0',id:'read',result:{content:[{type:'text',text:'file content'}]}});
  assert.ok(client.at(-1).result.structuredContent.project_contexts[0].diagnostics.some(item=>item.blocks_writes));
  await proxy.client(call('blocked','write_file',{path:file,content:'unsafe',project_path:root}));assert.equal(server.length,2);
  assert.equal(client.at(-1).result.structuredContent.code,'PROJECT_INSTRUCTIONS_UNAVAILABLE');
});

test('known process cleanup remains usable when project instructions become unreadable',async()=>{
  const f=fixture();
  await f.proxy.client(call('start','start_process',{command:'fixture',context_paths:[projectA],project_context_tokens:['a']}));
  await f.proxy.server({jsonrpc:'2.0',id:'start',result:{content:[],structuredContent:{pid:42}}});
  f.contexts.prepare=async()=>{throw Object.assign(new Error('Broken instructions'),{code:'PROJECT_INSTRUCTIONS_UNAVAILABLE'});};
  await f.proxy.client(call('stop','force_terminate',{pid:42,project_context_tokens:['a']}));
  assert.equal(f.server.at(-1).params.name,'force_terminate');
  await f.proxy.server({jsonrpc:'2.0',id:'stop',result:{content:[]}});
  assert.ok(f.proxy.processes.get('42').finishedAt);f.proxy.dispose();
});

test('fixed upstream completion formats retire initial and continued handles independently',async()=>{
  const f=fixture();
  await f.proxy.client(call('p','start_process',{command:'fixture',context_paths:[projectA],project_context_tokens:['a']}));
  await f.proxy.server({jsonrpc:'2.0',id:'p',result:{content:[],structuredContent:{pid:42,status:'finished'}}});
  assert.ok(f.proxy.processes.get('42').finishedAt);
  await f.proxy.client(call('s','start_search',{path:projectA,pattern:'x',project_context_tokens:['a']}));
  await f.proxy.server({jsonrpc:'2.0',id:'s',result:{content:[],structuredContent:{sessionId:'search_done',isComplete:true}}});
  assert.ok(f.proxy.searches.get('search_done').finishedAt);
  await f.proxy.client(call('r','start_process',{command:'fixture',context_paths:[projectA],project_context_tokens:['a']}));
  await f.proxy.server({jsonrpc:'2.0',id:'r',result:{content:[],structuredContent:{pid:43,status:'running'}}});
  assert.equal(f.proxy.processes.get('43').finishedAt,undefined);
  await f.proxy.client(call('read','read_process_output',{pid:43}));
  await f.proxy.server({jsonrpc:'2.0',id:'read',result:{content:[{type:'text',text:'New output\n✅ Process completed with exit code 0'}]}});
  assert.ok(f.proxy.processes.get('43').finishedAt);
  f.proxy.processes.get('43').finishedAt=Date.now()-5*60*1000-1;
  f.proxy.pruneBindings(f.proxy.processes);assert.equal(f.proxy.processes.has('43'),false);
  f.proxy.dispose();
});
