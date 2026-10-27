'use strict';
// Real Desktop Commander + protocol adapter. All fixture writes are disposable.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {RuntimeManager,stopTree}=require('../app/runtime.cjs');
const {spawnManaged}=require('../app/platform.cjs');
async function main(){
 const root=path.resolve(__dirname,'..');const home=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'ChatToHarness MCP 中文 space ')));
 const resources=process.argv[2]?path.resolve(process.argv[2]):path.join(root,'resources');
 const manager=new RuntimeManager({home:path.join(home,'app'),resources});let child;const waiting=new Map();let id=0,buffer='';
 const project=path.join(home,'工程 A'),other=path.join(home,'工程 B'),nested=path.join(project,'nested');
 for(const dir of [nested,other,path.join(project,'rules')])fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(project,'AGENTS.md'),'# Project A\nUse rules/output.md for generated text.\n');
 fs.writeFileSync(path.join(project,'rules','output.md'),'# Output format\nRequired marker: RULE_BODY_DELIVERED\n');
 fs.writeFileSync(path.join(nested,'agents.md'),'# Nested scope\nNested files use NESTED_RULE.\n');
 fs.writeFileSync(path.join(other,'AGENTS.md'),'# Project B\nOTHER_PROJECT_RULE\n');
 try{
  const settings={directories:[home],autoProjectContext:true};manager.prepare(settings);
  const env=manager.childEnvironment(settings);env.CONTROL_PLANE_API_KEY='synthetic-credential-must-not-reach-shell';
  child=spawnManaged(manager.paths.node,[manager.launcher,manager.paths.desktopCommander,String(process.pid)],{processHost:manager.paths.processHost,env,cwd:home,stdio:['pipe','pipe','pipe']});child.stderr.resume();
  const fail=()=>{for(const p of waiting.values())p.reject(new Error('MCP acceptance stopped'));waiting.clear();};
  child.on('error',fail);child.on('exit',fail);child.stdin.on('error',fail);
  child.stdout.setEncoding('utf8');child.stdout.on('data',part=>{buffer+=part;let index;while((index=buffer.indexOf('\n'))>=0){const value=JSON.parse(buffer.slice(0,index));buffer=buffer.slice(index+1);const p=waiting.get(value.id);if(p){waiting.delete(value.id);value.error?p.reject(new Error(JSON.stringify(value.error))):p.resolve(value.result);}}});
  const rpc=(method,params)=>new Promise((resolve,reject)=>{const number=++id;waiting.set(number,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:number,method,params})+'\n');});
  const timeout=setTimeout(fail,45000);
  try{
   const initialized=await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'ChatToHarness Acceptance',version:'0.3.0'}});
   assert.ok(initialized.instructions.includes('get_project_context'));
   child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
   const tools=await rpc('tools/list',{});const names=new Set(tools.tools.map(x=>x.name));
   assert.ok(initialized.capabilities?.resources || tools.tools.every(tool=>!tool._meta?.['openai/outputTemplate']&&!tool._meta?.['ui/resourceUri']&&!tool._meta?.ui?.resourceUri),'Preview templates require advertised resource support');
   for(const name of ['get_project_context','search_project','start_process','read_file','write_file'])assert.ok(names.has(name));
   assert.equal(tools.tools.find(tool=>tool.name==='start_process').annotations.readOnlyHint,false);
   const raw=(name,args)=>rpc('tools/call',{name,arguments:args});
   const asText=result=>(result.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');
   const call=async(name,args)=>{
    const result=await raw(name,args);assert.notEqual(result.isError,true,`${name}: ${asText(result)}`);
    if(tools.tools.find(tool=>tool.name===name)?.outputSchema?.properties?._harness_result){
     const visible=result.structuredContent?._harness_result;
     assert.ok(visible,`${name}: structured-first clients must receive the actual result`);
     assert.equal(visible.isError,false);assert.deepEqual(visible.content.map(block=>Number.isInteger(block.content_index)?result.content[block.content_index]:block),result.content.slice(0,visible.content.length));
     assert.ok(visible.content.length,`${name}: the native engine returned public content`);
    }
    return asText(result);
   };
   const context=async(project_path,target_paths,rule_paths)=>{const result=await raw('get_project_context',{project_path,target_paths,rule_paths});assert.notEqual(result.isError,true,asText(result));const data=result.structuredContent||JSON.parse(asText(result));assert.equal(typeof data.project_context_token,'string');return data;};
   const file=path.join(project,'hello 中文.txt'),content='hello localharness\n真实工具验收';
   const blocked=await raw('write_file',{path:file,content,mode:'rewrite'});assert.equal(blocked.isError,true);assert.equal(fs.existsSync(file),false);
   let a=await context(project,[file]);assert.ok(JSON.stringify(a).includes('Project A'));assert.ok(JSON.stringify(a).includes('output.md'));
   a=await context(project,[file],['rules/output.md']);assert.ok(JSON.stringify(a).includes('RULE_BODY_DELIVERED'));
   const tokens=[a.project_context_token];
   await call('write_file',{path:file,content,mode:'rewrite',project_context_tokens:tokens});assert.equal(fs.readFileSync(file,'utf8'),content);
   assert.ok((await call('read_file',{path:file})).includes(content),'reads need no prerequisite context call');
   assert.ok((await call('read_file',{path:file,project_context_tokens:tokens})).includes(content));
   const imagePath=path.join(project,'synthetic-preview.png');
   fs.writeFileSync(imagePath,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC','base64'));
   const imageReply=await raw('read_file',{path:imagePath});assert.notEqual(imageReply.isError,true,asText(imageReply));
   const imageBlock=imageReply.content.find(item=>item.type==='image');assert.ok(imageBlock?.data&&imageBlock.mimeType.startsWith('image/'));
   const imageReference=imageReply.structuredContent._harness_result.content.find(item=>item.type==='image');
   assert.deepEqual(imageReference,{type:'image',mimeType:imageBlock.mimeType,content_index:imageReply.content.indexOf(imageBlock)});
   assert.deepEqual(imageReply.content[imageReference.content_index],imageBlock);
   assert.equal(JSON.stringify(imageReply).split(imageBlock.data).length-1,1,'Native image bytes must not be duplicated in structured mirrors');
   const missingReply=await raw('read_file',{path:path.join(project,'missing-synthetic-file.txt')});
   assert.equal(missingReply.isError,true);assert.equal(missingReply.structuredContent._harness_result.isError,true);
   assert.ok(asText(missingReply.structuredContent._harness_result).length,'the original read failure must remain visible');
   console.log('Structured-first native text/image/error delivery: passed');
   const searchResult=await raw('search_project',{project_path:project,pattern:'真实工具验收'});
   assert.notEqual(searchResult.isError,true,asText(searchResult));
   const canonicalFile=fs.realpathSync.native(file);
   assert.ok(searchResult.structuredContent.results.some(match=>match.line===2&&fs.realpathSync.native(match.path)===canonicalFile),JSON.stringify({expected:canonicalFile,search:searchResult.structuredContent}));
   const emptyProject=path.join(home,'without instructions');fs.mkdirSync(emptyProject);
   const emptyFile=path.join(emptyProject,'plain.txt');
   await call('write_file',{path:emptyFile,content:'no AGENTS required',project_path:emptyProject});
   assert.equal(fs.readFileSync(emptyFile,'utf8'),'no AGENTS required');
   const nestedFile=path.join(nested,'child.txt');assert.equal((await raw('write_file',{path:nestedFile,content:'nested',project_context_tokens:tokens})).isError,true);assert.equal(fs.existsSync(nestedFile),false);
   const n=await context(project,[nestedFile]);assert.ok(JSON.stringify(n).includes('NESTED_RULE'));
   await call('write_file',{path:nestedFile,content:'nested',project_context_tokens:[n.project_context_token]});
   const bFile=path.join(other,'target.txt');const [b,a2]=await Promise.all([context(other,[bFile]),context(project,[file],['rules/output.md'])]);
   assert.ok(!JSON.stringify(b).includes('Project A'));assert.ok(!JSON.stringify(a2).includes('OTHER_PROJECT_RULE'));
   const denied=await raw('move_file',{source:file,destination:bFile,project_context_tokens:[a2.project_context_token]});assert.equal(denied.isError,true);assert.ok(fs.existsSync(file));
   await call('move_file',{source:file,destination:bFile,project_context_tokens:[a2.project_context_token,b.project_context_token]});assert.equal(fs.readFileSync(bFile,'utf8'),content);
   fs.appendFileSync(path.join(project,'rules','output.md'),'\nRULE_CHANGED\n');
   assert.equal((await raw('write_file',{path:file,content:'stale write',project_context_tokens:[a2.project_context_token]})).isError,true);assert.equal(fs.existsSync(file),false);
   a=await context(project,[file],['rules/output.md']);
   const command=process.platform==='win32' ? 'Write-Output ("CTH_HOME="+$env:USERPROFILE); if (!(Test-Path Env:CONTROL_PLANE_API_KEY)) { Write-Output "RUNTIME_KEY_REMOVED" }; git --version' : 'printf "CTH_HOME=%s\\n" "$HOME"; if [ -z "${CONTROL_PLANE_API_KEY+x}" ]; then printf "RUNTIME_KEY_REMOVED\\n"; fi; git --version';
   const processResult=await raw('start_process',{command,timeout_ms:5000,context_paths:[file],project_context_tokens:[a.project_context_token]});
   assert.notEqual(processResult.isError,true,asText(processResult));
   const output=asText(processResult);
   assert.ok(output.includes('CTH_HOME='+os.homedir()),'Shell user home changed');assert.ok(output.includes('RUNTIME_KEY_REMOVED'),'Runtime key reached Shell');assert.ok(output.includes('git version'));
   assert.equal(processResult.structuredContent._harness_result.content[0].text,processResult.content[0].text,'Structured output must retain the original terminal response');
   assert.equal(processResult.structuredContent._harness_result.isError,false);
   assert.ok(processResult.structuredContent.project_contexts.length,'Project guidance must accompany terminal output');
   assert.equal(tools.tools.find(tool=>tool.name==='start_process').outputSchema.properties._harness_result.type,'object');
   console.log(JSON.stringify({realDesktopCommander:true,tools:tools.tools.length,blockedBeforeContext:true,readsWithoutPrerequisite:true,noAgentsWrite:true,boundedSearch:true,fileRoundTrip:true,nested:true,selectedRules:true,ruleChanges:true,crossProject:true,concurrentContexts:true,shellHomePreserved:true,runtimeKeyRemoved:true}));
  }finally{clearTimeout(timeout);}
 }finally{if(child)await stopTree(child);await manager.close();fs.rmSync(home,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
main().catch(error=>{console.error('真实 MCP 验收失败：'+error.message);process.exitCode=1;});
