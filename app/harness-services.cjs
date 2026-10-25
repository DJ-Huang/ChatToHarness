'use strict';
const fs = require('node:fs/promises');
const {MAX_ARTIFACT_BYTES, FILE_CHUNK_BYTES, MAX_FILE_CHUNK_BYTES, IMAGE_PREVIEW_BYTES, PREVIEW_CHUNK_BYTES, MAX_TEXT_CHUNK_BYTES} = require('./mcp-limits.cjs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {TaskStore, waitMilliseconds} = require('./task-store.cjs');
const {SafeEdits} = require('./safe-edits.cjs');
const {ProjectContexts, inside} = require('./project-context.cjs');
const {ProjectInspector, integer, fail} = require('./project-inspect.cjs');
const {guidanceRetry,scopeRecovery} = require('./tool-recovery.cjs');
const {sanitize} = require('./diagnostic-budget.cjs');
const {connectionDiagnostics} = require('./live-logs.cjs');

const DC_TOOLS = Object.freeze(['get_config', 'set_config_value', 'read_file', 'read_multiple_files', 'write_file', 'write_pdf', 'create_directory', 'list_directory', 'move_file', 'start_search', 'get_more_search_results', 'stop_search', 'list_searches', 'get_file_info', 'edit_block', 'start_process', 'read_process_output', 'interact_with_process', 'force_terminate', 'list_sessions', 'list_processes', 'kill_process', 'get_usage_stats', 'get_recent_tool_calls', 'give_feedback_to_desktop_commander']);
const project = {type: 'string', description: 'Absolute project directory within the desktop app authorized folders.'};
const pagination = {cursor: {type: 'string'}, limit: {type: 'integer', minimum: 1, maximum: 200}};
const readHints = {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false};
function tool(name, title, description, properties, required = [], annotations = readHints) {
  return {name, title, description, inputSchema: {type: 'object', properties, required, additionalProperties: false}, outputSchema: {type: 'object', additionalProperties: true}, annotations};
}
const taskFields = {project_path: project, task_id: {type: 'string'}};
const waitField = {type: 'integer', minimum: 0, maximum: 10000, description: 'Bounded response wait only; does not alter the task runtime limit or idempotency identity. Disconnect ends the wait, not the task.'};
const taskHints = {readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true};
const TASK_TOOLS = [
  tool('start_task', 'Start persistent task', 'Preferred for ordinary non-interactive commands. Record a durable idempotent shell task, wait up to 2000 ms by default, and return bounded output if finished or the original task_id and query instructions if still running. After timeout/reconnect, reuse the key with unchanged command, runtime limit and artifacts; on IDEMPOTENCY_CONFLICT inspect the returned original task, never automatically change keys to bypass the conflict. The worker applies the official command policy; project_path supplies guidance and cwd, not a shell sandbox.', {project_path: project, wait_ms: {...waitField, default: 2000}, command: {type: 'string', maxLength: 65536}, idempotency_key: {type: 'string', minLength: 1, maxLength: 128}, runtime_limit_ms: {type: 'integer', minimum: 1, maximum: 604800000}, artifact_paths: {type: 'array', items: {type: 'string'}, maxItems: 32}, context_paths: {type: 'array', items: {type: 'string'}, maxItems: 128}, project_context_tokens: {type: 'array', items: {type: 'string'}, maxItems: 128}}, ['project_path', 'command', 'idempotency_key'], taskHints),
  tool('get_task_status', 'Task status', 'Read durable task state after disconnect or app restart. Interrupted tasks have unknown execution state and are never replayed. Prefer get_task_result when output or an exit code is also needed.', taskFields, ['project_path','task_id']),
  tool('get_task_result', 'Task result', 'Read task state, exit code and bounded saved stdout/stderr tails in one call. Wait up to 5000 ms by default for an active task to finish; terminal tasks return immediately. Includes a log cursor for further output; never executes the command again. Interrupted tasks retain unknown execution state.', {...taskFields, wait_ms: {...waitField, default: 5000}}, ['project_path','task_id']),
  tool('get_task_logs', 'Task logs', 'Read bounded saved stdout/stderr entries from the beginning, or use tail:true without cursor for recent output. Cursors are opaque: use an unchanged returned cursor, never calculate byte offsets. Cursors survive reconnect/app restart; reads never consume logs or rerun commands.', {...taskFields, ...pagination, tail: {type:'boolean',description:'Return the last bounded entries without scanning earlier pages. Omit cursor when true.'}}, ['project_path', 'task_id']),
  tool('list_tasks', 'Project tasks', 'Find persistent tasks and results for an authorized project.', {project_path: project, ...pagination}, ['project_path']),
  tool('cancel_task', 'Cancel task', 'Record cancellation of a task owned by this project. Query its status until the worker confirms termination; no arbitrary PID is accepted.', taskFields, ['project_path', 'task_id'], {...taskHints, openWorldHint: false})
];
const EDIT_TOOLS = [
  {...tool('apply_project_edit', 'Write and verify project text', 'Create or replace UTF-8 text, then reopen and checksum the actual saved file in this call. New files use expected_sha256="absent"; existing files require their current SHA-256 from get_file_result. Returns undo_id and verification with up to 4 KiB of actual readback text. When status="matched" and complete=true, answer from that text without another read solely to confirm this write. A mismatch never overwrites newer content. Retries reuse the same intent and idempotency_key; they verify without rewriting. Use native format tools for binary documents.', {project_path:project,file_path:{type:'string',description:'Absolute target file or a path relative to project_path.'},content:{type:'string',maxLength:1048576},expected_sha256:{type:'string',pattern:'^(absent|[a-f0-9]{64})$',description:'Use absent to create a new file, or the current SHA-256 from get_file_result to replace existing text.'},idempotency_key:{type:'string',minLength:1,maxLength:128,description:'Stable key for this intended edit; reuse unchanged arguments and key after interruption.'},project_context_tokens:{type:'array',items:{type:'string'},maxItems:128}}, ['project_path','file_path','content','expected_sha256','idempotency_key'], {...taskHints,openWorldHint:false}),
    outputSchema:{type:'object',additionalProperties:true,properties:{verification:{type:'object',description:'Fresh observation from reopening the target after the edit or exact-key retry. The checksum covers the entire file; complete/truncated apply only to the bounded text preview.',properties:{status:{type:'string',enum:['matched','changed','unavailable']},expected_sha256:{type:'string'},sha256:{type:['string','null']},bytes:{type:['integer','null']},text:{type:'string',description:'Actual reopened UTF-8 text, at most 4096 bytes; absent when verification is unavailable.'},complete:{type:'boolean'},truncated:{type:'boolean'},checked_at:{type:'string'},error:{type:'object',additionalProperties:true}},required:['status','expected_sha256','sha256','bytes','complete','truncated','checked_at'],additionalProperties:false}}}},
  tool('undo_project_edit', 'Undo project edit', 'Restore the saved bytes only if the file still matches the edited SHA-256. Later user changes are preserved and reported as a conflict.', {project_path:project,undo_id:{type:'string'},expected_sha256:{type:'string'},project_context_tokens:{type:'array',items:{type:'string'},maxItems:128}}, ['project_path','undo_id','expected_sha256'], {...taskHints,openWorldHint:false})
];
const TOOLS = [
  tool('get_harness_status', 'Harness status', 'Diagnose ChatToHarness connection/reconnect problems: returns current state and bounded saved connection events/retry delays, without a log path. Do not guess OS log folders or request access to app storage. Also returns the running build, device and capability inventory; tool names are paginated.', {...pagination}),
  tool('get_project_overview', 'Project overview', 'Read a bounded directory summary, Git status, AGENTS and on-demand rule/skill indexes in one call.', {project_path: project, depth: {type: 'integer', minimum: 1, maximum: 3}, target_paths: {type: 'array', items: {type: 'string'}, maxItems: 128}, task: {type: 'string', maxLength: 4096}}, ['project_path']),
  tool('get_execution_summary', 'Project execution summary', 'Preferred for ChatToHarness tool/error logs: read project execution states, durations, error reasons and saved result references without locating log files. Use state:errors for failures; include_connection:true adds bounded application-wide connection events filtered by since. state/tool filter execution records only. Commands, arguments and full output are excluded; use the original task_id to inspect work without replaying it.', {project_path:project,state:{type:'string',enum:['all','errors','received','waiting_approval','submitted','running','cancelling','succeeded','failed','unknown','interrupted','needs_context','needs_arguments']},tool:{type:'string',maxLength:256},since:{type:'string',description:'ISO date-time lower bound for when a request was received.'},include_connection:{type:'boolean',description:'Include bounded app connection/reconnect events, with no raw log access. These events are application-wide, not project execution records.'},cursor:{type:'string'},limit:{type:'integer',minimum:1,maximum:50,default:10}}, ['project_path']),
  ...['status', 'diff', 'log'].map(kind => tool(`git_${kind}`, `Git ${kind}`, `Read project-scoped Git ${kind} without a shell. Result pages use a five-minute immutable snapshot. Diff defaults to unstaged changes; log covers up to 100 commits.`, {project_path: project, paths: {type: 'array', items: {type: 'string'}, maxItems: 64}, ...(kind === 'diff' ? {staged: {type: 'boolean'}} : {}), ...pagination}, ['project_path'])),
  tool('get_file_result', 'File result', 'Read an authorized artifact up to 64 MiB as SHA-256 and exact byte pages. Omit length for a binary page up to 5 MiB, returning fitting files in one call without text-result paging. Explicit binary length is at most 5 MiB; text defaults to 32 KiB, max 512 KiB. Previews default to a small 32 KiB byte page (max 512 KiB, including explicit length) to keep native media plus metadata within the wire budget. Set preview:true for a bounded native preview; large images use a derived JPEG up to 512 KiB. Use preview:false and omit length for exact original byte pages without re-encoding. Decode each Base64 chunk separately, concatenate by next_offset and verify SHA-256. Default reads do not attach files. Use the exact returned path for subsequent pages.', {project_path: project, path: {type: 'string'}, offset: {type: 'integer', minimum: 0}, length: {type: 'integer', minimum: 1, maximum: MAX_FILE_CHUNK_BYTES}, preview: {type: 'boolean'}}, ['project_path', 'path'])
];
function response(value, content = []) { return {content: [{type: 'text', text: value.summary || JSON.stringify(value)}, ...content], structuredContent: value}; }
function errorResult(error,name,args) {
  const value = {code: error.code || 'HARNESS_OPERATION_FAILED', message: error.message || 'The operation could not complete.', next_action: error.details?.next_action || 'Check the supplied project/path and retry the read. For mutations, inspect the saved task or result before retrying.', operation_executed: false, execution_state: 'not_started', ...(error.details || {}),...scopeRecovery(error,name,args)};
  return {...response(value), isError: true};
}
class HarnessServices {
  constructor({home, build = {}, versions = {}, runtime = () => ({}), catalog = () => [], mcp = () => ({}), computerUse = null, nodePath = process.execPath, processHost, engineEntry, configHome, history} = {}) {
    Object.assign(this, {home, build, versions, runtime, catalog, mcp, computerUse, nodePath, processHost, history});
    this.edits = new SafeEdits(home);
    this.tasks = new TaskStore({home,nodePath,processHost,engineEntry,configHome});
    this.configure({directories: []});
  }
  configure(settings) {
    this.contexts?.dispose(); this.inspector?.dispose();
    this.directories = [...(settings.directories || [])];
    this.autoProjectContext = settings.autoProjectContext !== false;
    this.contexts = new ProjectContexts({defaultDirectory: this.directories[0] || this.home, allowedDirectories: this.directories.length ? this.directories : [this.home]});
    this.inspector = new ProjectInspector(this.contexts);
  }
  tools() { return [...TOOLS, ...TASK_TOOLS, ...EDIT_TOOLS, ...(this.computerUse?.definition() ? [this.computerUse.definition()] : [])]; }
  stopComputerUse() { this.computerUse?.stop(); }
  setComputerUseEnabled(enabled) { this.computerUse?.setEnabled(enabled); }
  has(name) { return this.tools().some(tool => tool.name === name); }
  async call(name, args, options = {}) {
    try {
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw fail('INVALID_ARGUMENT', 'Tool arguments must be an object.');
      options.signal?.throwIfAborted();
      if (name === 'get_harness_status') return response(this.status(args));
      if (name === 'computer_use' && this.computerUse?.definition()) return await this.computerUse.call(require('./computer-use-compat.cjs').withLegacySessionTitle(args), options);
      if (!this.directories.length) throw fail('PATH_NOT_ALLOWED', 'Choose a project folder in the desktop app before using project tools.');
      if (EDIT_TOOLS.some(tool => tool.name === name)) return response(await this.edit(name,args,options));
      if (TASK_TOOLS.some(tool => tool.name === name)) return response(await this.task(name,args,options));
      if (name === 'get_project_overview') return response(await this.inspector.overview(args, options));
      if (name === 'get_execution_summary') return response(await this.executionSummary(args, options));
      if (['git_status', 'git_diff', 'git_log'].includes(name)) return response(await this.inspector.git(name.slice(4), args, options));
      if (name === 'get_file_result') return await this.file(args, options);
      throw fail('UNKNOWN_TOOL', 'This Harness tool is unavailable.');
    } catch (error) { return errorResult(error,name,args); }
  }
  async executionSummary(args,{signal}={}) {
    const root=await this.inspector.root(args),limit=integer(args.limit,10,50),state=args.state||'all';
    const states=this.tools().find(item=>item.name==='get_execution_summary').inputSchema.properties.state.enum;
    if(!states.includes(state)||args.include_connection!==undefined&&typeof args.include_connection!=='boolean'||args.tool!==undefined&&(typeof args.tool!=='string'||!args.tool||args.tool.length>256)||args.since!==undefined&&(typeof args.since!=='string'||args.since.length>64||!Number.isFinite(Date.parse(args.since))))throw fail('INVALID_ARGUMENT','Use a supported state, a tool name, an ISO date-time for since, and a boolean include_connection.');
    const kind=`executions:${JSON.stringify([state,args.tool||'',args.since||'',args.include_connection===true])}`;
    if(args.cursor)return this.inspector.page(kind,root,null,null,{...args,limit});
    if(!this.history||typeof this.history.rows!=='function')throw fail('EXECUTION_HISTORY_UNAVAILABLE','Execution history is unavailable in this application instance.');
    const rows=[],projects=new Map([[`project:${root}`,root]]);
    for(const row of this.history.rows()) {
      signal?.throwIfAborted();
      if(args.tool&&row.tool!==args.tool||args.since&&Date.parse(row.last_received_at||row.received_at)<Date.parse(args.since))continue;
      const errors=['failed','unknown','interrupted'].includes(row.state)&&!row.recovery_kind||row.delivery==='local_write_failed';
      if(state==='errors'?!errors:state!=='all'&&state!==row.state&&state!==row.recovery_kind)continue;
      const explicitProject=typeof row.project==='string'&&path.isAbsolute(row.project),scopes=explicitProject?[row.project]:row.scope_paths;
      // Authorize canonical paths before testing project containment. Windows
      // 8.3 names and other authorized aliases can be outside the root lexically
      // while resolving to the very same project. The checks below still reject
      // every canonical target that escapes the selected project.
      if(!Array.isArray(scopes)||!scopes.length||scopes.length>128||scopes.some(scope=>typeof scope!=='string'||!path.isAbsolute(scope)))continue;
      let scoped=true;
      for(const scope of scopes) {
        const key=`${explicitProject?'project':'path'}:${scope}`;let canonical=projects.get(key);
        if(canonical===undefined){try{canonical=explicitProject?await this.contexts.resolveProject(scope):await this.contexts.authorize(scope);}catch{canonical=null;}projects.set(key,canonical);}
        if(!canonical||!inside(root,canonical)){scoped=false;break;}
      }
      if(!scoped)continue;
      const resultInfo=this.history.resultInfo?await this.history.resultInfo(row):{result_status:row.result_status||'not_recorded',...(row.result_id?{result_id:row.result_id}:{})};
      rows.push({request_id:row.request_id,tool:row.tool,state:row.state,...(row.recovery_kind?{recovery_kind:row.recovery_kind}:{}),received_at:row.last_received_at||row.received_at,
        ...resultInfo,
        ...(row.started_at?{started_at:row.started_at}:{}),...(row.finished_at?{finished_at:row.finished_at}:{}),...(Number.isFinite(row.duration_ms)?{duration_ms:row.duration_ms}:{}),
        ...(row.execution_state?{execution_state:row.execution_state}:{}),...(row.delivery?{delivery:row.delivery}:{}),...(row.task_id?{task_id:row.task_id}:{}),...(Number.isInteger(row.exit_code)?{exit_code:row.exit_code}:{}),
        ...(row.error_code||row.error_summary?{error:{code:sanitize(row.error_code||'',256),message:sanitize(row.error_summary||'',512)}}:{})});
    }
    rows.sort((a,b)=>(b.received_at||'').localeCompare(a.received_at||''));
    return this.inspector.page(kind,root,rows,{project_path:root,summary:`${rows.length} matching execution records.`,total:rows.length,...(args.include_connection?{connection:connectionDiagnostics(this.home,{since:args.since})}:{})}, {...args,limit});
  }
  status(args) {
    const catalog = this.catalog().map(item => ({name: item.name, read_only: item.annotations?.readOnlyHint === true}));
    const page = this.inspector.page('catalog', 'harness', catalog, {}, args);
    const available = new Set(catalog.map(item => item.name)), runtime = this.runtime(), mcp = this.mcp();
    const missing_capabilities=mcp.missing_capabilities??runtime.missing_capabilities??[];
    const tools_health=mcp.tools_health??runtime.tools_health??'unknown',tools_ready=mcp.tools_ready??runtime.tools_ready??false;
    return {summary: `ChatToHarness ${this.versions.app || this.build.version || 'unknown'}; connection ${runtime.state || 'unknown'}; tools ${tools_health}; ${catalog.length} available tools.`,
      tools_health,tools_ready,missing_capabilities,
      app: {version: this.versions.app || this.build.version || null, build: this.build}, components: {node: this.versions.node || process.versions.node, tunnel: this.versions.tunnel || null, desktop_commander: this.versions.desktopCommander || null},
      device: {platform: process.platform, arch: process.arch, os_release: os.release(), name: os.hostname(), ...(this.computerUse?.status().device?.id ? {computer_use_id:this.computerUse.status().device.id} : {})},
      connection: {state: runtime.state || 'unknown', local_ready: Boolean(runtime.localReady), gateway: 'app-owned', tools_version: mcp.toolsVersion ?? null,...connectionDiagnostics(this.home)},
      capabilities: {project_overview: true, git_reads: true, artifact_return: true, persistent_tasks: true, safe_text_edits: true, automatic_project_context: this.autoProjectContext, shell_is_sandboxed: false},
      desktop_commander: {expected_tools: DC_TOOLS.length, available_tools: DC_TOOLS.filter(name => available.has(name)), missing_tools: DC_TOOLS.filter(name => !available.has(name)), verification: 'Availability only; consult the platform acceptance report for tested behavior.'},
      tool_catalog: page};
  }
  async edit(name,args,{signal}={}) {
    const root = await this.inspector.root(args);
    const requested = name==='apply_project_edit' ? path.resolve(root,args.file_path) : this.edits.entry(args.undo_id,root).request.file_path;
    const file = await this.contexts.authorize(requested);
    if (!inside(root,file)) throw fail('TARGET_OUTSIDE_PROJECT','The edit target is outside the selected project.');
    if (name === 'apply_project_edit') {
      const existing = this.edits.existing({...args, project_path: root, file_path: file});
      if (existing) return existing;
    }
    const guidance = this.autoProjectContext ? await this.contexts.prepare(args.project_context_tokens,[file],{projectPath:root,signal,writing:true}) : {contexts: [], needsDelivery: false};
    if (guidance.needsDelivery) throw fail('PROJECT_CONTEXT_REFRESH_REQUIRED','Read the project guidance before retrying the original tool. This operation has not run.',guidanceRetry(name,guidance.contexts));
    signal?.throwIfAborted();
    return name==='apply_project_edit' ? this.edits.apply({...args,project_path:root,file_path:file}) : this.edits.undo(args.undo_id,root,args.expected_sha256);
  }
  async task(name, args, {signal, executionId} = {}) {
    const wait = ['start_task','get_task_result'].includes(name) ? waitMilliseconds(args.wait_ms, name === 'start_task' ? 2000 : 5000) : 0;
    const root = await this.inspector.root(args);
    if (name === 'start_task') {
      const requested = args.artifact_paths || [];
      if (!Array.isArray(requested) || requested.length > 32 || requested.some(item=>typeof item!=='string'||!item||item.includes('\0'))) throw fail('INVALID_ARGUMENT','artifact_paths must contain at most 32 filenames.');
      const artifacts = [];
      for (const item of requested) { const file = await this.contexts.authorize(path.resolve(root,item)); if (!inside(root,file)) throw fail('TARGET_OUTSIDE_PROJECT','Artifacts must be inside the selected project.'); artifacts.push(file); }
      const existing = this.tasks.existing({...args,project_path:root,artifact_paths:artifacts});
      if(existing)return this.registeredTaskResult(existing,root,{wait,signal,executionId});
      const related = args.context_paths || [root];
      if (!Array.isArray(related) || related.length > 128 || related.some(item=>typeof item!=='string'||!item||item.includes('\0'))) throw fail('INVALID_ARGUMENT','context_paths must contain at most 128 related project paths.');
      const targets = [...new Set([...related.map(item=>path.resolve(root,item)),...artifacts])];
      const guidance = this.autoProjectContext ? await this.contexts.prepare(args.project_context_tokens,targets,{projectPath:root,signal,writing:true}) : {contexts: [], needsDelivery: false};
      if (guidance.needsDelivery) throw fail('PROJECT_CONTEXT_REFRESH_REQUIRED','Read the project guidance before retrying the original tool with the same idempotency_key. This operation has not run.',guidanceRetry(name,guidance.contexts));
      signal?.throwIfAborted();
      const started = this.tasks.start({...args,project_path:root,artifact_paths:artifacts});
      return {...await this.registeredTaskResult(started,root,{wait,signal,executionId}),project_contexts:guidance.contexts};
    }
    if (name === 'list_tasks') return this.inspector.page('tasks',root,this.tasks.list(root),{project_path:root,summary:'Saved tasks for this project.'},args);
    if (name === 'get_task_logs') return this.tasks.logs(args.task_id,root,args);
    if (name === 'get_task_result') return this.tasks.waitResult(args.task_id,root,{wait_ms: wait,signal});
    if (name === 'cancel_task') return this.tasks.cancel(args.task_id,root);
    return this.tasks.status(args.task_id,root);
  }
  async registeredTaskResult(started,root,{wait,signal,executionId}) {
    // Keep this identity even if the chat disappears or a later status read fails.
    this.history?.update(executionId,{task_id:started.task_id,task_accepted:true,state:'submitted',execution_state:started.execution_state});
    try{return {...await this.tasks.waitResult(started.task_id,root,{wait_ms:wait,signal}),reused:started.reused};}
    catch(error){throw fail(error.code||'TASK_RESULT_UNAVAILABLE','The task was registered but its result could not be read. Inspect the original task and artifacts; do not restart it.',
      {task_id:started.task_id,operation_executed:null,execution_state:'unknown'});}
  }
  async file(args, {signal} = {}) {
    const root = await this.inspector.root(args), file = await this.contexts.authorize(path.resolve(root, args.path), true);
    if (!inside(root, file)) throw fail('TARGET_OUTSIDE_PROJECT', 'The artifact is outside the selected project.');
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw fail('FILE_REQUIRED', 'Choose a regular file.');
    const extension = path.extname(file).toLowerCase();
    const textual = /^\.(txt|md|markdown|cjs|mjs|js|ts|tsx|jsx|yml|yaml|html|css|csv|tsv|log|xml|sh|ps1|ini|toml|rs|py|json)$/.test(extension);
    const length = integer(args.length, textual || args.preview === true ? PREVIEW_CHUNK_BYTES : FILE_CHUNK_BYTES, textual || args.preview === true ? MAX_TEXT_CHUNK_BYTES : MAX_FILE_CHUNK_BYTES), offset = args.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > stat.size) throw fail('INVALID_ARGUMENT', 'offset is a byte position within the file.');
    const handle = await fs.open(file, 'r');
    let buffer, digest;
    try {
      if (stat.size > MAX_ARTIFACT_BYTES) throw fail('FILE_TOO_LARGE', 'Artifacts are limited to 64 MiB; export a smaller separate artifact before reading.');
      buffer = Buffer.alloc(Math.min(length, stat.size - offset));
      for(let at=0;at<buffer.length;) {
        signal?.throwIfAborted();const {bytesRead}=await handle.read(buffer,at,buffer.length-at,offset+at);
        if(!bytesRead)throw fail('FILE_CHANGED','The artifact ended before the requested byte range.');at+=bytesRead;
      }
      const hash=crypto.createHash('sha256');
      if(offset===0&&buffer.length===stat.size)hash.update(buffer);
      else {
        const scratch=Buffer.alloc(1024*1024);let at=0;
        for(;;){signal?.throwIfAborted();const {bytesRead}=await handle.read(scratch,0,scratch.length,at);if(!bytesRead)break;
          if(at+bytesRead>MAX_ARTIFACT_BYTES)throw fail('FILE_CHANGED','The artifact grew beyond the preview limit while being read.');
          hash.update(scratch.subarray(0,bytesRead));at+=bytesRead;}
      }
      digest=hash.digest('hex');
      const after = await handle.stat(); if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ino !== stat.ino) throw fail('FILE_CHANGED', 'The file changed during preview. Read it again to obtain a consistent result.');
    } finally { await handle.close(); }
    const mime = ({'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.json': 'application/json'})[extension] || (/^\.(txt|md|markdown|cjs|mjs|js|ts|tsx|jsx|yml|yaml|html|css|csv|tsv|log|xml|sh|ps1|ini|toml|rs|py)$/.test(extension) ? 'text/plain' : 'application/octet-stream');
    const value = {summary: `${path.basename(file)}; ${stat.size} bytes; bytes ${offset}–${offset + buffer.length}.`, path: file, mime_type: mime, size: stat.size, sha256: digest, offset, encoding: 'base64', data: buffer.toString('base64'), has_more: offset + buffer.length < stat.size, next_offset: offset + buffer.length};
    value.length=buffer.length;value.eof=!value.has_more;
    value.chunk_sha256=crypto.createHash('sha256').update(buffer).digest('hex');
    if(value.has_more){value.next_tool='get_file_result';value.next_arguments={project_path:root,path:file,offset:value.next_offset,...(args.length===undefined?{}:{length}),preview:false};}
    const content = [];
    if (mime === 'text/plain' || mime === 'application/json') {
      try { if (!buffer.includes(0)) value.text = new TextDecoder('utf-8', {fatal: true}).decode(buffer); } catch { /* Byte pages can split a UTF-8 sequence; exact base64 bytes remain available. */ }
    }
    if (args.preview === true && offset === 0 && mime.startsWith('image/')) {
      const image = await fs.readFile(file); if (crypto.createHash('sha256').update(image).digest('hex') !== digest) throw fail('FILE_CHANGED', 'The image changed while being prepared.');
      if(image.length<=IMAGE_PREVIEW_BYTES)content.push({type:'image',mimeType:mime,data:image.toString('base64')});
      else {
        try {
          const sharp=require('sharp');let preview,info;
          // This is explicitly a derived display preview, never replacement original data.
          for(const [width,quality] of [[1600,80],[1200,60],[800,45]]) {
            signal?.throwIfAborted();
            ({data:preview,info}=await sharp(image,{limitInputPixels:64*1024*1024,failOn:'error'}).rotate()
              .resize({width,height:width,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'})
              .jpeg({quality}).timeout({seconds:10}).toBuffer({resolveWithObject:true}));
            if(preview.length<=IMAGE_PREVIEW_BYTES)break;
          }
          signal?.throwIfAborted();
          if(preview.length>IMAGE_PREVIEW_BYTES)throw Error('Preview exceeds its budget');
          value.preview={derived:true,mime_type:'image/jpeg',byte_length:preview.length,width:info.width,height:info.height,
            sha256:crypto.createHash('sha256').update(preview).digest('hex')};
          content.push({type:'image',mimeType:'image/jpeg',data:preview.toString('base64')});
        } catch(error) {
          signal?.throwIfAborted();value.preview_unavailable=true;
          value.preview_message='A bounded preview could not be generated. Original bytes remain available through get_file_result.';
        }
      }
    } else if (args.preview === true && !value.has_more && offset === 0) content.push({type: 'resource', resource: {uri: pathToFileURL(file).href, mimeType: mime, ...(value.text !== undefined ? {text: value.text} : {blob: value.data})}});
    return response(value, content);
  }
  dispose() { this.computerUse?.dispose(); this.contexts.dispose(); this.inspector.dispose(); }
}
module.exports = {HarnessServices, DC_TOOLS, TOOLS, tool, project, pagination, readHints, response, errorResult};
