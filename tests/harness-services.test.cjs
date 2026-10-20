'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {HarnessServices, DC_TOOLS} = require('../app/harness-services.cjs');
const {ProjectInspector, gitEnvironment} = require('../app/project-inspect.cjs');
const {ProjectContexts} = require('../app/project-context.cjs');
const {sourceIdentity, writeBuildInfo, captureBuild} = require('../app/build-identity.cjs');
const {McpManager} = require('../app/mcp-manager.cjs');

function fixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cth-inspect 中文 ')));
  const project = path.join(directory, 'project space'); fs.mkdirSync(project);
  const contexts = new ProjectContexts({allowedDirectories: [directory], defaultDirectory: project});
  const inspector = new ProjectInspector(contexts);
  const services = new HarnessServices({home: path.join(directory, 'app'), versions: {app: '0.5.0', desktopCommander: '0.3.0'}, build: {commit: 'captured'}, runtime: () => ({state: 'ready', localReady: true}), catalog: () => DC_TOOLS.map(name => ({name}))});
  services.configure({directories: [directory]});
  t.after(() => { inspector.dispose(); contexts.dispose(); services.dispose(); fs.rmSync(directory, {recursive: true, force: true}); });
  const git = (...args) => execFileSync('git', ['-C', project, ...args], {encoding: 'utf8', env: gitEnvironment(), stdio: ['ignore', 'pipe', 'pipe']});
  git('init'); git('config', 'user.name', 'Synthetic Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(project, 'hello 中文.txt'), 'first\nsecond\n'); git('add', '.'); git('commit', '-m', 'synthetic baseline');
  return {directory, project, inspector, contexts, services, git};
}
test('task service validates waits before execution and applies short/default query waits with durable linkage', async t=>{
  const f=fixture(t),task_id='task_'+'b'.repeat(64),calls=[],updates=[];
  f.services.configure({directories:[f.project],autoProjectContext:false});
  f.services.history={update:(id,patch)=>updates.push({id,...patch})};
  f.services.tasks.existing=()=>undefined;
  f.services.tasks.start=()=>{calls.push('start');return {task_id,reused:false,execution_state:'not_started'};};
  f.services.tasks.waitResult=async(id,project,options)=>{calls.push(options.wait_ms);return {task_id:id,terminal:false,state:'running',execution_state:'running'};};
  const input={project_path:f.project,command:'fixture',idempotency_key:'stable'};
  for(const wait_ms of [-1,10001,1.5,'5'])assert.equal((await f.services.call('start_task',{...input,wait_ms})).isError,true);
  assert.deepEqual(calls,[]);
  const started=await f.services.call('start_task',input,{executionId:'original-request'});
  assert.equal(started.structuredContent.task_id,task_id);assert.deepEqual(calls,['start',2000]);
  assert.equal(updates[0].task_id,task_id);assert.equal(updates[0].id,'original-request');
  assert.equal(updates[0].task_accepted,true);
  await f.services.call('get_task_result',{project_path:f.project,task_id});assert.equal(calls.at(-1),5000);
  f.services.tasks.existing=()=>({task_id,execution_state:'running',reused:true});
  const retry=await f.services.call('start_task',{...input,wait_ms:0});
  assert.equal(retry.structuredContent.reused,true);assert.equal(calls.at(-1),0);assert.equal(calls.filter(x=>x==='start').length,1);
  f.services.tasks.waitResult=async()=>{throw Error('unreadable state after submission');};
  const unavailable=await f.services.call('start_task',{...input,wait_ms:0});
  assert.equal(unavailable.structuredContent.task_id,task_id);assert.equal(unavailable.structuredContent.execution_state,'unknown');
  assert.equal(unavailable.structuredContent.operation_executed,null);assert.equal(calls.filter(x=>x==='start').length,1);
});

test('task conflicts guide a read of the original task without bypassing its identity',async t=>{
  const f=fixture(t),task='task_'+'c'.repeat(64);
  f.services.configure({directories:[f.project],autoProjectContext:false});
  f.services.tasks.existing=()=>{throw require('../app/project-inspect.cjs').fail('IDEMPOTENCY_CONFLICT','Inspect original task.',{task_id:task,next_tool:'get_task_result',next_arguments:{project_path:f.project,task_id:task,wait_ms:0}});};
  f.services.tasks.start=()=>assert.fail('A rejected key must not launch a worker.');
  const error=await f.services.call('start_task',{project_path:f.project,idempotency_key:'same',command:'changed'});
  assert.equal(error.isError,true);assert.equal(error.structuredContent.code,'IDEMPOTENCY_CONFLICT');
  assert.equal(error.structuredContent.next_tool,'get_task_result');assert.equal(error.structuredContent.next_arguments.task_id,task);
  assert.equal(error.structuredContent.execution_state,'not_started');
  const definition=f.services.tools().find(tool=>tool.name==='get_task_logs');
  assert.equal(definition.inputSchema.properties.tail.type,'boolean');assert.match(definition.description,/never calculate byte offsets/);
});
test('project overview and read-only Git cover unicode files, staged changes and immutable pages', async t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.project, 'AGENTS.md'), '# Project\nUse local project conventions.\n');
  fs.appendFileSync(path.join(f.project, 'hello 中文.txt'), 'third\nfourth\n');
  fs.writeFileSync(path.join(f.project, 'literal; echo injected.txt'), 'only a filename');
  let result = await f.services.call('get_project_overview', {project_path: f.project});
  assert.equal(result.isError, undefined); assert.match(result.structuredContent.summary, /project space/);
  assert.equal(result.structuredContent.guidance.agents.length, 1);
  assert.equal(result.structuredContent.git.clean, false);
  result = await f.inspector.git('diff', {project_path: f.project, limit: 2});
  assert.equal(result.has_more, true); const cursor = result.next_cursor;
  fs.writeFileSync(path.join(f.project, 'hello 中文.txt'), 'later working tree');
  const rest = []; do { result = await f.inspector.git('diff', {project_path: f.project, cursor: result.next_cursor, limit: 2}); rest.push(...result.items); } while (result.has_more);
  assert.ok(rest.some(row => row.text === '+third')); assert.ok(!rest.some(row => row.text.includes('later working tree')));
  assert.equal((await f.inspector.git('diff', {project_path: f.project, cursor, limit: 2})).items.length, 2);
  f.git('add', 'hello 中文.txt');
  const staged = await f.inspector.git('diff', {project_path: f.project, staged: true}); assert.ok(staged.items.some(row => row.text.includes('later working tree')));
  const log = await f.inspector.git('log', {project_path: f.project}); assert.equal(log.items[0].subject, 'synthetic baseline');
  const selected = await f.inspector.git('status', {project_path: f.project, paths: ['literal; echo injected.txt']});
  assert.equal(selected.items[0].path, 'literal; echo injected.txt');
  assert.equal(fs.existsSync(path.join(f.project, 'injected.txt')), false);
});
test('Git scope checks reject outside paths and cursors from another project', async t => {
  const f = fixture(t); fs.appendFileSync(path.join(f.project, 'hello 中文.txt'), 'changed');
  const first = await f.inspector.git('diff', {project_path: f.project, limit: 1});
  await assert.rejects(f.inspector.git('status', {project_path: f.project, paths: ['../outside']}), {code: 'TARGET_OUTSIDE_PROJECT'});
  await assert.rejects(f.inspector.git('diff', {project_path: f.directory, cursor: first.next_cursor}), {code: 'CURSOR_EXPIRED'});
  assert.equal(gitEnvironment({PATH: 'unchanged', GIT_DIR: '/other', GIT_CONFIG_COUNT: '1'}).GIT_DIR, undefined);
  assert.equal(gitEnvironment({PATH: 'unchanged'}).GIT_OPTIONAL_LOCKS, '0');
});
test('status reports captured build and paginates all 25 original engine names', async t => {
  const f = fixture(t), result = await f.services.call('get_harness_status', {limit: 10});
  assert.equal(result.structuredContent.app.build.commit, 'captured');
  assert.equal(result.structuredContent.desktop_commander.expected_tools, 25);
  assert.deepEqual(result.structuredContent.desktop_commander.missing_tools, []);
  assert.equal(result.structuredContent.tool_catalog.items.length, 10);
  assert.equal(result.structuredContent.connection.state, 'ready');
  const next = await f.services.call('get_harness_status', {cursor: result.structuredContent.tool_catalog.next_cursor});
  assert.equal(next.structuredContent.tool_catalog.items.length, 15);
});
test('artifact pages return exact bytes, checksum, and native image content', async t => {
  const f = fixture(t); const bytes = Buffer.from('中文 bytes 012345'); const file = path.join(f.project, 'result.txt'); fs.writeFileSync(file, bytes);
  const first = await f.services.call('get_file_result', {project_path: f.project, path: 'result.txt', length: 7});
  const second = await f.services.call('get_file_result', {project_path: f.project, path: file, offset: 7});
  assert.equal(first.structuredContent.text, '中文 ');
  assert.deepEqual(Buffer.concat([Buffer.from(first.structuredContent.data, 'base64'), Buffer.from(second.structuredContent.data, 'base64')]), bytes);
  assert.equal(first.structuredContent.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(path.join(f.project, 'pixel.png'), png);
  const metadata = await f.services.call('get_file_result', {project_path: f.project, path: 'pixel.png'});
  assert.ok(metadata.content.every(block => block.type === 'text'), 'default artifact reads do not attach files');
  assert.deepEqual(Buffer.from(metadata.structuredContent.data, 'base64'), png);
  const image = await f.services.call('get_file_result', {project_path: f.project, path: 'pixel.png', preview: true});
  assert.equal(image.content[1].type, 'image'); assert.deepEqual(Buffer.from(image.content[1].data, 'base64'), png);
  const denied = await f.services.call('get_file_result', {project_path: f.project, path: '../outside'}); assert.equal(denied.isError, true); assert.ok(denied.structuredContent.next_action);
});
test('safe edits respect the explicitly disabled automatic-guidance setting', async t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.project, 'AGENTS.md'), 'Project guidance.');
  f.services.configure({directories: [f.project], autoProjectContext: false});
  const input = {project_path: f.project, file_path: 'new.txt', content: 'saved', expected_sha256: 'absent', idempotency_key: 'guidance-disabled'};
  const result = await f.services.call('apply_project_edit', input); assert.equal(result.isError, undefined);
  assert.equal(fs.readFileSync(path.join(f.project, 'new.txt'), 'utf8'), 'saved');
  assert.equal(result.structuredContent.verification.status, 'matched');
  assert.equal(result.structuredContent.verification.text, fs.readFileSync(path.join(f.project, 'new.txt'), 'utf8'));
  assert.equal(result.structuredContent.verification.complete, true);
  const overview = await f.services.call('get_project_overview', {project_path: f.project}); assert.equal(overview.structuredContent.guidance.agents.length, 1);
});

test('edits and persistent tasks return direct guidance retry patches without executing first', async t => {
  const f=fixture(t);fs.writeFileSync(path.join(f.project,'AGENTS.md'),'Read these project instructions before modifying files.');
  const input={project_path:f.project,file_path:'retry.txt',content:'saved',expected_sha256:'absent',idempotency_key:'edit-guidance-retry'};
  const first=await f.services.call('apply_project_edit',input);
  const data=first.structuredContent;
  assert.equal(data.code,'PROJECT_CONTEXT_REFRESH_REQUIRED');
  assert.equal(data.next_tool,'apply_project_edit');
  assert.equal(data.next_action,'read_contexts_then_retry');
  assert.equal(data.execution_state,'not_started');assert.equal(data.operation_executed,false);
  assert.deepEqual(JSON.parse(first.content[0].text),data);
  assert.deepEqual(Object.keys(data.retry_patch),['project_context_tokens']);
  assert.ok(!fs.existsSync(path.join(f.project,'retry.txt')));
  const saved=await f.services.call('apply_project_edit',{...input,...data.retry_patch});
  assert.equal(saved.isError,undefined);assert.equal(fs.readFileSync(path.join(f.project,'retry.txt'),'utf8'),'saved');

  const starts=[];
  f.services.tasks.start=args=>{starts.push(args);return {task_id:'task_'+'e'.repeat(64),state:'queued'};};
  f.services.tasks.waitResult=async task_id=>({task_id,state:'queued',terminal:false});
  const taskInput={project_path:f.project,command:'synthetic fixture',idempotency_key:'task-guidance-retry'};
  const taskFirst=await f.services.call('start_task',taskInput),taskData=taskFirst.structuredContent;
  assert.equal(taskData.code,'PROJECT_CONTEXT_REFRESH_REQUIRED');assert.equal(taskData.next_tool,'start_task');
  assert.deepEqual(JSON.parse(taskFirst.content[0].text),taskData);
  assert.equal(starts.length,0,'guidance delivery neither submits nor replays a task');
  const submitted=await f.services.call('start_task',{...taskInput,...taskData.retry_patch});
  assert.equal(submitted.isError,undefined);assert.equal(starts.length,1);
  assert.equal(starts[0].idempotency_key,taskInput.idempotency_key);
});
test('build identity persists the source fingerprint and never invents absent packaged metadata', t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.project, 'app')); fs.writeFileSync(path.join(f.project, 'app', 'main.cjs'), 'module.exports = 1;'); fs.writeFileSync(path.join(f.project, 'package.json'), '{"version":"1.2.3"}');
  const identity = sourceIdentity(f.project); const resources = path.join(f.project, 'resources'); writeBuildInfo(f.project, resources);
  assert.equal(captureBuild({resources, packaged: true}).source_sha256, identity.source_sha256);
  fs.appendFileSync(path.join(f.project, 'app', 'main.cjs'), '\n// changed'); assert.notEqual(sourceIdentity(f.project).source_sha256, identity.source_sha256);
  fs.unlinkSync(path.join(resources, 'build-info.json')); assert.equal(captureBuild({resources, packaged: true}).identity_available, false);
});
test('application services participate in tool discovery and stop with the gateway manager', async t => {
  const f = fixture(t), settings = {list: () => [], getAllowAllTools: () => false};
  const manager = new McpManager({settings, services: f.services}); t.after(() => manager.close());
  await manager.start({directories: [f.project]});
  assert.ok(manager.listTools().tools.some(tool => tool.name === 'git_status'));
  assert.equal((await manager.call('git_status', {project_path: f.project})).structuredContent.clean, true);
  await manager.stop(); assert.equal((await manager.call('git_status', {project_path: f.project})).structuredContent.code, 'MCP_STOPPED');
});

test('execution summaries authorize the project and expose state and errors without raw arguments or output',async t=>{
  const f=fixture(t),child=path.join(f.project,'nested');fs.mkdirSync(child);
  const records=Array.from({length:12},(_,index)=>({request_id:`exec_${index}`,project:index===11?f.directory:index===10?child:f.project,tool:'read_file',state:'failed',received_at:`2026-10-20T00:00:${String(index).padStart(2,'0')}.000Z`,duration_ms:214,error_code:'READ_FAILED',error_summary:'Unable to read the selected file.',operation:'SECRET_COMMAND',command:'SECRET_COMMAND',arguments:{secret:'PRIVATE_ARGS'},stdout:'PRIVATE_OUTPUT',task_id:'task_'+'a'.repeat(64)}));
  records.push({request_id:'guidance',project:f.project,tool:'start_task',state:'failed',recovery_kind:'needs_context',received_at:'2026-10-20T00:00:59.000Z',error_code:'PROJECT_CONTEXT_REFRESH_REQUIRED'});
  f.services.history={rows:()=>records};
  const args={project_path:f.project,state:'errors'},first=await f.services.call('get_execution_summary',args),data=first.structuredContent;
  assert.equal(first.isError,undefined);assert.equal(data.items.length,10);assert.equal(data.total,11);assert.equal(data.has_more,true);
  assert.equal(data.items[0].request_id,'exec_10');assert.equal(data.items[0].error.code,'READ_FAILED');assert.equal(data.items[0].duration_ms,214);
  assert.doesNotMatch(JSON.stringify(first),/SECRET_COMMAND|PRIVATE_ARGS|PRIVATE_OUTPUT|guidance/);
  records.length=0;
  const next=await f.services.call('get_execution_summary',{...args,cursor:data.next_cursor});
  assert.equal(next.structuredContent.items.length,1,'later pages use the original immutable summary snapshot');
  assert.equal((await f.services.call('get_execution_summary',{...args,state:'all',cursor:data.next_cursor})).structuredContent.code,'CURSOR_EXPIRED');
  assert.equal((await f.services.call('get_execution_summary',{...args,limit:51})).isError,true);
  assert.equal((await f.services.call('get_execution_summary',{...args,since:'invalid'})).isError,true);
  assert.equal((await f.services.call('get_execution_summary',{project_path:path.dirname(f.directory)})).isError,true);
  const definition=f.services.tools().find(tool=>tool.name==='get_execution_summary');
  assert.deepEqual(definition.inputSchema.required,['project_path']);assert.equal(definition.annotations.readOnlyHint,true);
});

test('saved connection diagnostics avoid log paths and cannot expose other project executions or raw messages',async t=>{
  const f=fixture(t),logs=path.join(f.services.home,'logs');fs.mkdirSync(logs,{recursive:true});
  const raw=[
    {time:'2026-10-20T00:00:00.000Z',event:'runtime',state:'ready'},
    {time:'2026-10-20T00:00:01.000Z',event:'execution',state:'failed',project:'OTHER_PROJECT',command:'PRIVATE_COMMAND',stdout:'PRIVATE_OUTPUT'},
    {time:'2026-10-20T00:00:02.000Z',event:'runtime-retry',attempt:1,delay_ms:250,reason:'process',headers:{authorization:'PRIVATE_AUTH'},error:'PRIVATE_MESSAGE'},
    {time:'2026-10-20T00:00:03.000Z',event:'runtime',state:'reconnecting',error:'PRIVATE_MESSAGE',api_key:'PRIVATE_KEY'},
    {time:'2026-10-20T00:00:04.000Z',event:'runtime',state:'ready',path:'PRIVATE_PATH'},
    {time:'2026-10-20T00:00:05.000Z',event:'runtime',state:'PRIVATE_STATE'},
  ];
  fs.writeFileSync(path.join(logs,'app.log'),raw.map(row=>JSON.stringify(row)).join('\n')+'\n');
  f.services.history={rows:()=>[]};
  const args={project_path:f.project,state:'errors',since:'2026-10-20T00:00:01.000Z',include_connection:true};
  const result=await f.services.call('get_execution_summary',args),connection=result.structuredContent.connection;
  assert.equal(result.isError,undefined);assert.deepEqual(result.structuredContent.items,[]);
  assert.equal(connection.scope,'application_connection');assert.equal(connection.bounded,true);
  assert.deepEqual(connection.events.map(row=>row.state),['retry_scheduled','reconnecting','ready']);
  assert.equal(connection.events[0].delay_ms,250);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|OTHER_PROJECT/);
  const status=await f.services.call('get_harness_status',{});
  assert.equal(status.structuredContent.connection.events.length,4);
  assert.doesNotMatch(JSON.stringify(status),/PRIVATE_|OTHER_PROJECT/);
  const ordinary=await f.services.call('get_execution_summary',{project_path:f.project});assert.equal(ordinary.structuredContent.connection,undefined);
  assert.equal((await f.services.call('get_execution_summary',{...args,include_connection:'yes'})).isError,true);
  assert.equal((await f.services.call('get_execution_summary',{...args,project_path:path.dirname(f.directory)})).isError,true);
});

test('read-only domain pages budget a long Unicode Git line without opaque transport pagination',t=>{
  const f=fixture(t),rows=[{line:1,text:'中文'.repeat(8192)},{line:2,text:'next line'}];
  const first=f.inspector.page('diff',f.project,rows,{summary:'Diff snapshot.',project_path:f.project},{limit:1});
  assert.equal(first.items[0].line,1);assert.equal(first.items[0].truncated,true);assert.equal(first.has_more,true);
  assert.ok(Buffer.byteLength(JSON.stringify({content:[{type:'text',text:first.summary}],structuredContent:first}))<16*1024);
  assert.equal(f.inspector.page('diff',f.project,null,null,{cursor:first.next_cursor}).items[0].line,2);
  assert.equal(rows[0].truncated,undefined);
});

test('execution summaries include explicit file scopes without project_path and exclude escaped or mixed scopes',async t=>{
  const f=fixture(t),outside=path.join(f.directory,'outside.txt');fs.writeFileSync(outside,'outside selected project');
  const file=path.join(f.project,'hello 中文.txt'),missing=path.join(f.project,'missing.txt'),records=[
    {request_id:'file-read',tool:'read_file',scope_paths:[file]},
    {request_id:'missing-file',tool:'read_file',scope_paths:[missing]},
    {request_id:'directory',tool:'list_directory',scope_paths:[f.project]},
    {request_id:'mixed-projects',tool:'read_multiple_files',scope_paths:[file,outside]},
    {request_id:'unscoped-shell',tool:'start_process',operation:`read ${file}`},
    {request_id:'outside-project',tool:'read_file',scope_paths:[outside]}
  ];
  if(process.platform!=='win32'){
    const linked=path.join(f.project,'escape.txt');fs.symlinkSync(outside,linked);records.push({request_id:'symlink-escape',tool:'read_file',scope_paths:[linked]});
  }
  f.services.history={rows:()=>records.map(row=>({...row,state:'failed',received_at:'2026-10-20T00:00:00.000Z',error_code:'READ_FAILED',error_summary:'Selected path is unavailable.'}))};
  const result=await f.services.call('get_execution_summary',{project_path:f.project,state:'errors'});
  assert.equal(result.isError,undefined);assert.deepEqual(result.structuredContent.items.map(row=>row.request_id).sort(),['directory','file-read','missing-file']);
  assert.doesNotMatch(JSON.stringify(result),/outside selected project|scope_paths|unscoped-shell|mixed-projects|symlink-escape/);
});

test('execution summaries scope authorized aliases by canonical paths while excluding aliases outside the project',async t=>{
  const f=fixture(t),alias=path.join(f.directory,'project-alias'),outside=path.join(f.directory,'outside');
  fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'private.txt'),'outside project');
  const outsideAlias=path.join(f.project,'outside-alias');
  fs.symlinkSync(f.project,alias,process.platform==='win32'?'junction':'dir');
  fs.symlinkSync(outside,outsideAlias,process.platform==='win32'?'junction':'dir');
  const records=[
    {request_id:'project-alias',project:alias},
    {request_id:'file-alias',scope_paths:[path.join(alias,'hello 中文.txt')]},
    {request_id:'missing-alias',scope_paths:[path.join(alias,'missing.txt')]},
    {request_id:'outside-alias',scope_paths:[path.join(outsideAlias,'private.txt')]},
    {request_id:'mixed-alias',scope_paths:[path.join(alias,'hello 中文.txt'),path.join(outsideAlias,'private.txt')]},
  ];
  f.services.history={rows:()=>records.map(row=>({...row,tool:'read_file',state:'failed',received_at:'2026-10-20T00:00:00.000Z',error_code:'READ_FAILED'}))};
  const result=await f.services.call('get_execution_summary',{project_path:f.project,state:'errors'});
  assert.equal(result.isError,undefined);
  assert.deepEqual(result.structuredContent.items.map(row=>row.request_id).sort(),['file-alias','missing-alias','project-alias']);
  assert.doesNotMatch(JSON.stringify(result),/outside-alias|mixed-alias|private\.txt/);
});

test('harness status reports tool health separately from a ready connection using manager and runtime health',async t=>{
  const f=fixture(t),missing=[{service_id:'builtin',capability:'tools',phase:'failed',code:'MCP_COMPONENT_MISSING'}];
  f.services.runtime=()=>({state:'ready',localReady:true,tools_health:'ready',tools_ready:true,missing_capabilities:[]});
  f.services.mcp=()=>({tools_health:'degraded',tools_ready:false,missing_capabilities:missing,toolsVersion:4});
  f.services.catalog=()=>[{name:'custom__read_only'}];
  const result=(await f.services.call('get_harness_status',{})).structuredContent;
  assert.equal(result.connection.state,'ready');assert.equal(result.connection.local_ready,true);
  assert.equal(result.tools_health,'degraded');assert.equal(result.tools_ready,false);assert.deepEqual(result.missing_capabilities,missing);
  assert.match(result.summary,/connection ready; tools degraded/);assert.equal(result.desktop_commander.missing_tools.length,25);
  f.services.mcp=()=>({});f.services.runtime=()=>({state:'ready',localReady:true,tools_health:'unavailable',tools_ready:false,missing_capabilities:missing});
  assert.equal((await f.services.call('get_harness_status',{})).structuredContent.tools_health,'unavailable');
});
