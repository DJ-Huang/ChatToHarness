'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {PassThrough}=require('node:stream');
const path=require('node:path');
const os=require('node:os');
const projectA=path.resolve(path.sep,'project-a');
const projectB=path.resolve(path.sep,'project-b');
const inProject=(target,root)=>target===root||target.startsWith(root+path.sep);
const {McpProxy,wireProtocol,toolPaths}=require('../app/mcp-proxy.cjs');
const {AjvJsonSchemaValidator}=require('@modelcontextprotocol/sdk/validation/ajv');

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

test('compact builtin descriptions preserve schemas, format semantics and permission annotations without chunked-write advice',t=>{
  const f=fixture();t.after(()=>f.proxy.dispose());
  const cases={
    write_file:[/apply_project_edit/,/UTF-8/,/Excel/,/sheet-name/,/DOCX/,/write_pdf/],
    write_pdf:[/Markdown/,/HTML\/CSS/,/SVG/,/different outputPath/,/0-based/,/sourcePdfPath/,/page-break-before/],
    list_directory:[/depth defaults to 2/,/use 1/,/Root entries are complete/,/100/,/hidden-count/],
    read_multiple_files:[/one call/,/Individual read errors/,/PNG/,/WebP/],
    edit_block:[/old_string\/new_string/,/exact whitespace/,/expected_replacements/,/default 1/,/DOCX/,/XML/,/header\/footer/,/A1:C10/,/2D-array/,/apply_project_edit/],
    read_process_output:[/offset=0 reads NEW/,/positive offsets.*0-based/,/negative offsets/,/timeout_ms/,/fileReadLineLimit/,/still running/,/get_task_result/],
    get_more_search_results:[/sessionId/,/0-based/,/negative offset/,/ignores length/,/defaults to 100/,/search_project/],
  };
  for(const [name,semantics]of Object.entries(cases)){
    const inputSchema={type:'object',properties:{path:{type:'string'},content:{type:'string'},mode:{enum:['rewrite','append']},options:{type:'object'}},required:['path'],additionalProperties:false};
    const original={name,description:'Legacy instructions: split writes into 25-30 lines and make separate calls.',inputSchema,annotations:{title:'Kept title',vendor:'keep'}};
    const tool=f.proxy.decorateTool(original);
    for(const expression of semantics)assert.match(tool.description,expression,name);
    assert.doesNotMatch(tool.description,/25.?30|CHUNKED WRITES|make separate calls/i,name);
    assert.deepEqual(tool.inputSchema.required,inputSchema.required,name);
    for(const [key,value]of Object.entries(inputSchema.properties))assert.deepEqual(tool.inputSchema.properties[key],value,name+' '+key);
    assert.equal(tool.inputSchema.additionalProperties,false,name);
    assert.equal(tool.annotations.title,'Kept title');assert.equal(tool.annotations.vendor,'keep');
    const mutating=['write_file','write_pdf','edit_block'].includes(name);
    assert.equal(tool.annotations.readOnlyHint,!mutating,name);assert.equal(tool.annotations.destructiveHint,mutating,name);
    assert.equal(tool.annotations.openWorldHint,false,name);
    assert.equal(tool.annotations.idempotentHint,!mutating&&name!=='read_process_output',name);
    assert.equal(original.description,'Legacy instructions: split writes into 25-30 lines and make separate calls.');
  }
  const external={name:'vendor__write_file',description:'External service contract.',inputSchema:{type:'object'},annotations:{readOnlyHint:false}};
  assert.deepEqual(f.proxy.decorateTool(external),external,'unrecognized third-party descriptions are unchanged');
});

test('terminal response delivers original output alongside project guidance in both result formats',async t=>{
  const f=fixture();t.after(()=>f.proxy.dispose());
  const contexts=[{project_path:projectA,diagnostics:[]}];
  f.contexts.prepare=async()=>({contexts,needsDelivery:false});
  await f.proxy.client(call('terminal','start_process',{command:'connection check',timeout_ms:1000,context_paths:[projectA]}));
  const text='Process started with PID 42 (shell: /bin/zsh)\nInitial output:\nCHAT2HARNESS_CONNECTION_OK\nDarwin\n';
  const upstream={content:[{type:'text',text}],isError:false,_meta:{preserved:true}},original=structuredClone(upstream);
  await f.proxy.server({jsonrpc:'2.0',id:'terminal',result:upstream});
  const result=f.client.at(-1).result;
  assert.deepEqual(result.structuredContent._harness_result.content,upstream.content);
  assert.equal(result.structuredContent._harness_result.isError,false);
  assert.deepEqual(result.structuredContent.project_contexts,contexts);
  assert.deepEqual(result.content,[...upstream.content,{type:'text',text:JSON.stringify({project_contexts:contexts})}]);
  assert.equal(result.isError,false);assert.deepEqual(result._meta,upstream._meta);
  assert.ok(f.proxy.processes.has('42'),'Text-only upstream replies still bind process handles');
  assert.deepEqual(upstream,original,'Response decoration must not mutate the upstream result');
  const tool=f.proxy.decorateTool({name:'start_process',inputSchema:{type:'object'}});
  const validate=new AjvJsonSchemaValidator().getValidator(tool.outputSchema);
  assert.equal(validate(result.structuredContent).valid,true);
  assert.equal(tool.outputSchema.properties._harness_result.type,'object');
});

test('forwarded responses match their output schema without guidance, including disabled context and empty output',async t=>{
  for(const enabled of [true,false])for(const text of ['CHAT2HARNESS_CONNECTION_OK\nDarwin\n','']){
    const f=fixture({enabled});t.after(()=>f.proxy.dispose());
    await f.proxy.client(call('read','read_file',{path:path.join(projectA,'file.txt')}));
    const content=text?[{type:'text',text}]:[];
    await f.proxy.server({jsonrpc:'2.0',id:'read',result:{content}});
    const result=f.client.at(-1).result;
    assert.deepEqual(result.structuredContent._harness_result.content,content);
    assert.equal(result.structuredContent._harness_result.isError,false);
    assert.deepEqual(result.content,content);
    assert.deepEqual(result.structuredContent.project_contexts,[]);
    const tool=f.proxy.decorateTool({name:'read_file',inputSchema:{type:'object'}});
    assert.equal(new AjvJsonSchemaValidator().getValidator(tool.outputSchema)(result.structuredContent).valid,true);
  }
});

test('structured output preserves native fields, media, schemas and tool error flags',async t=>{
  for(const isError of [false,true]){
    const f=fixture({enabled:false});t.after(()=>f.proxy.dispose());
    const tool={name:'read_file',inputSchema:{type:'object'},outputSchema:{type:'object',properties:{details:{type:'object'}},required:['details'],additionalProperties:false}};
    const originalTool=structuredClone(tool),schema=f.proxy.decorateTool(tool).outputSchema;
    await f.proxy.client(call('read','read_file',{path:path.join(projectA,'file.png')}));
    const upstream={content:[{type:'text',text:'First 中文\n'},{type:'image',mimeType:'image/png',data:'cGl4ZWxz'},{type:'text',text:'Last line'},{type:'resource_link',uri:'https://example.test/asset',name:'asset'}],
      structuredContent:{details:{values:[null,false,0]}},isError,_meta:{preserved:true}};
    const original=structuredClone(upstream);
    await f.proxy.server({jsonrpc:'2.0',id:'read',result:upstream});
    const result=f.client.at(-1).result;
    assert.deepEqual(result.structuredContent._harness_result.content,upstream.content);
    assert.equal(result.structuredContent._harness_result.isError,isError);
    assert.deepEqual(result.structuredContent.details,upstream.structuredContent.details);
    assert.deepEqual(result.content,upstream.content);assert.equal(result.isError,isError);assert.deepEqual(result._meta,upstream._meta);
    assert.deepEqual(upstream,original);assert.deepEqual(tool,originalTool);
    assert.deepEqual(schema.required,['details']);assert.equal(schema.additionalProperties,false);
    assert.equal(schema.properties._harness_result.type,'object');
    assert.equal(new AjvJsonSchemaValidator().getValidator(schema)(result.structuredContent).valid,true);
  }
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

test('terminal scope defaults only from an explicit project and never replaces explicit arguments',async t=>{
  const f=fixture();t.after(()=>f.proxy.dispose());
  const original={command:'opaque shell',project_path:projectA,project_context_tokens:['a']};
  await f.proxy.client(call('default','start_process',original));
  assert.deepEqual(f.validations.at(-1).paths,[projectA]);
  assert.deepEqual(f.server.at(-1).params.arguments,{command:'opaque shell'},'guidance scope does not change shell arguments or cwd');
  assert.ok(!Object.hasOwn(original,'context_paths'),'normalization does not mutate caller arguments');
  const child=path.join(projectA,'child');
  await f.proxy.client(call('explicit','start_process',{...original,context_paths:[child]}));
  assert.deepEqual(f.validations.at(-1).paths,[child]);
  await f.proxy.client(call('diagnostic','start_process',{...original,context_paths:[]}));
  assert.deepEqual(f.validations.at(-1).paths,[]);
  const forwarded=f.server.length;
  for(const [index,value]of [null,undefined,'invalid',[null],[''],['bad\0path']].entries()){
    await f.proxy.client(call('invalid'+index,'start_process',{...original,context_paths:value}));
    assert.equal(f.client.at(-1).result.structuredContent.code,'invalid_context_paths');
  }
  for(const [index,value]of [undefined,'','relative',42,'/bad\0project'].entries()){
    await f.proxy.client(call('project'+index,'start_process',{command:'opaque shell',project_path:value}));
    const result=f.client.at(-1).result;
    assert.equal(result.structuredContent.code,'context_paths_required');
    assert.equal(result.structuredContent.recovery_kind,'needs_arguments');
    assert.equal(result.structuredContent.next_tool,'start_process');
    assert.deepEqual(JSON.parse(result.content[0].text),result.structuredContent);
  }
  assert.equal(f.server.length,forwarded);
  const schema=f.proxy.decorateTool({name:'start_process',inputSchema:{required:['command']}}).inputSchema;
  assert.match(schema.properties.context_paths.description,/defaults to \[project_path\]/);
  assert.deepEqual(schema.required,['command']);
  const validate=new AjvJsonSchemaValidator().getValidator(schema);
  assert.equal(validate({command:'fixture'}).valid,false);
  assert.equal(validate({command:'fixture',project_path:projectA}).valid,true);
  assert.equal(validate({command:'fixture',context_paths:[]}).valid,true);
  const disabled=fixture({enabled:false});t.after(()=>disabled.proxy.dispose());
  await disabled.proxy.client(call('disabled','start_process',{command:'fixture'}));
  assert.equal(disabled.server.length,1);
  assert.equal(disabled.proxy.decorateTool({name:'start_process',inputSchema:{}}).inputSchema.allOf,undefined);
});

test('returned terminal guidance can be read and retried directly, including a later rule refresh',async t=>{
  const fs=require('node:fs');
  const {ProjectContexts}=require('../app/project-context.cjs');
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'cth-terminal-retry-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const guidance=path.join(root,'AGENTS.md');fs.writeFileSync(guidance,'Original project instructions.');
  const contexts=new ProjectContexts({defaultDirectory:root,allowedDirectories:[root]});
  const client=[],server=[],proxy=new McpProxy({contexts,defaultDirectory:root,sendClient:async value=>client.push(value),sendServer:async value=>server.push(value)});
  t.after(()=>proxy.dispose());
  const input={command:'opaque shell',project_path:root};
  await proxy.client(call('initial','start_process',input));
  const first=client.at(-1).result;
  assert.deepEqual(JSON.parse(first.content[0].text),first.structuredContent);
  const data=first.structuredContent;
  assert.equal(data.code,'PROJECT_CONTEXT_REFRESH_REQUIRED');
  assert.equal(data.next_tool,'start_process');
  assert.equal(data.next_action,'read_contexts_then_retry');
  assert.equal(data.execution_state,'not_started');assert.equal(data.operation_executed,false);
  assert.equal(data.contexts[0].agents[0].content,'Original project instructions.');
  assert.deepEqual(data.retry_patch.project_context_tokens,[data.contexts[0].project_context_token]);
  assert.equal(server.length,0);
  await proxy.client(call('retry','start_process',{...input,...data.retry_patch}));
  assert.equal(server.length,1,'explicit retry forwards exactly once without another context call');
  assert.deepEqual(server[0].params.arguments,{command:'opaque shell'});
  fs.writeFileSync(guidance,'Changed project instructions that must be delivered again.');
  await proxy.client(call('changed','start_process',{...input,...data.retry_patch}));
  const changed=client.at(-1).result.structuredContent;
  assert.equal(changed.code,'PROJECT_CONTEXT_REFRESH_REQUIRED');
  assert.equal(changed.contexts[0].agents[0].content,'Changed project instructions that must be delivered again.');
  assert.notDeepEqual(changed.retry_patch,data.retry_patch);
  assert.equal(server.length,1);
  await proxy.client(call('refreshed','start_process',{...input,...changed.retry_patch}));
  assert.equal(server.length,2);
  await proxy.client(call('unauthorized','start_process',{...input,project_path:path.dirname(root)}));
  assert.equal(client.at(-1).result.structuredContent.code,'PATH_NOT_ALLOWED');
  assert.equal(server.length,2,'default guidance scope cannot expand authorized folders');
});

test('incomplete guidance still requests loading and never supplies a partial retry patch',async t=>{
  const f=fixture();t.after(()=>f.proxy.dispose());
  f.contexts.prepare=async()=>({needsDelivery:true,contexts:[{project_context_token:'partial'}]});
  await f.proxy.client(call('partial','start_process',{command:'opaque shell',project_path:projectA}));
  const result=f.client.at(-1).result;
  assert.equal(result.structuredContent.next_tool,'get_project_context');
  assert.equal(result.structuredContent.next_action,'load_project_context_then_retry');
  assert.equal(result.structuredContent.retry_patch,undefined);
  assert.deepEqual(JSON.parse(result.content[0].text),result.structuredContent);
  assert.equal(f.server.length,0);
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
  // Desktop Commander advertises resources even when a plain text read should
  // not ask ChatGPT to launch its file viewer.

  const f=fixture();f.proxy.upstreamCapabilities={resources:{}};
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
