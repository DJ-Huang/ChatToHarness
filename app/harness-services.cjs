'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {TaskStore} = require('./task-store.cjs');
const {ProjectContexts, inside} = require('./project-context.cjs');
const {ProjectInspector, integer, fail} = require('./project-inspect.cjs');

const DC_TOOLS = Object.freeze(['get_config', 'set_config_value', 'read_file', 'read_multiple_files', 'write_file', 'write_pdf', 'create_directory', 'list_directory', 'move_file', 'start_search', 'get_more_search_results', 'stop_search', 'list_searches', 'get_file_info', 'edit_block', 'start_process', 'read_process_output', 'interact_with_process', 'force_terminate', 'list_sessions', 'list_processes', 'kill_process', 'get_usage_stats', 'get_recent_tool_calls', 'give_feedback_to_desktop_commander']);
const project = {type: 'string', description: 'Absolute project directory within the desktop app authorized folders.'};
const pagination = {cursor: {type: 'string'}, limit: {type: 'integer', minimum: 1, maximum: 200}};
const readHints = {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false};
function tool(name, title, description, properties, required = [], annotations = readHints) {
  return {name, title, description, inputSchema: {type: 'object', properties, required, additionalProperties: false}, outputSchema: {type: 'object', additionalProperties: true}, annotations};
}
const taskFields = {project_path: project, task_id: {type: 'string'}};
const taskHints = {readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true};
const TASK_TOOLS = [
  tool('start_task', 'Start persistent task', 'Record an idempotent local shell task and return immediately. Reuse the same idempotency_key after a timeout or reconnect. The worker applies the official command policy; project_path supplies guidance and cwd, not a shell sandbox.', {project_path: project, command: {type: 'string', maxLength: 65536}, idempotency_key: {type: 'string', minLength: 1, maxLength: 128}, runtime_limit_ms: {type: 'integer', minimum: 1, maximum: 604800000}, artifact_paths: {type: 'array', items: {type: 'string'}, maxItems: 32}, context_paths: {type: 'array', items: {type: 'string'}, maxItems: 128}, project_context_tokens: {type: 'array', items: {type: 'string'}, maxItems: 128}}, ['project_path', 'command', 'idempotency_key'], taskHints),
  ...['status', 'result'].map(kind => tool(`get_task_${kind}`, `Task ${kind}`, 'Read a durable task record after disconnect or app restart. Interrupted tasks are reported with unknown execution state and are never replayed.', taskFields, ['project_path', 'task_id'])),
  tool('get_task_logs', 'Task logs', 'Read bounded saved stdout/stderr entries. A cursor remains valid after reconnect or app restart; offsets never consume or delete logs.', {...taskFields, ...pagination}, ['project_path', 'task_id']),
  tool('list_tasks', 'Project tasks', 'Find persistent tasks and results for an authorized project.', {project_path: project, ...pagination}, ['project_path']),
  tool('cancel_task', 'Cancel task', 'Record cancellation of a task owned by this project. Query its status until the worker confirms termination; no arbitrary PID is accepted.', taskFields, ['project_path', 'task_id'], {...taskHints, openWorldHint: false})
];
const TOOLS = [
  tool('get_harness_status', 'Harness status', 'Read the running build, device, connection and current capability inventory. Tool names are paginated; availability is distinct from acceptance evidence.', {...pagination}),
  tool('get_project_overview', 'Project overview', 'Read a bounded directory summary, Git status, AGENTS and on-demand rule/skill indexes in one call.', {project_path: project, depth: {type: 'integer', minimum: 1, maximum: 3}, target_paths: {type: 'array', items: {type: 'string'}, maxItems: 128}, task: {type: 'string', maxLength: 4096}}, ['project_path']),
  ...['status', 'diff', 'log'].map(kind => tool(`git_${kind}`, `Git ${kind}`, `Read project-scoped Git ${kind} without a shell. Result pages use a five-minute immutable snapshot. Diff defaults to unstaged changes; log covers up to 100 commits.`, {project_path: project, paths: {type: 'array', items: {type: 'string'}, maxItems: 64}, ...(kind === 'diff' ? {staged: {type: 'boolean'}} : {}), ...pagination}, ['project_path'])),
  tool('get_file_result', 'File result', 'Return an authorized artifact with a SHA-256 fingerprint, size and bounded text/base64 page; supported small images also return native MCP image content. Use the exact returned path for subsequent pages.', {project_path: project, path: {type: 'string'}, offset: {type: 'integer', minimum: 0}, length: {type: 'integer', minimum: 1, maximum: 65536}, preview: {type: 'boolean'}}, ['project_path', 'path'])
];
function response(value, content = []) { return {content: [{type: 'text', text: value.summary || JSON.stringify(value)}, ...content], structuredContent: value}; }
function errorResult(error) {
  const value = {code: error.code || 'HARNESS_OPERATION_FAILED', message: error.message || 'The operation could not complete.', next_action: error.details?.next_action || 'Check the supplied project/path and retry the read. For mutations, inspect the saved task or result before retrying.', operation_executed: false, execution_state: 'not_started', ...(error.details || {})};
  return {...response(value), isError: true};
}
class HarnessServices {
  constructor({home, build = {}, versions = {}, runtime = () => ({}), catalog = () => [], mcp = () => ({}), nodePath = process.execPath, processHost, engineEntry, configHome} = {}) {
    Object.assign(this, {home, build, versions, runtime, catalog, mcp, nodePath, processHost});
    this.tasks = new TaskStore({home,nodePath,processHost,engineEntry,configHome});
    this.configure({directories: []});
  }
  configure(settings) {
    this.contexts?.dispose(); this.inspector?.dispose();
    this.directories = [...(settings.directories || [])];
    this.contexts = new ProjectContexts({defaultDirectory: this.directories[0] || this.home, allowedDirectories: this.directories.length ? this.directories : [this.home]});
    this.inspector = new ProjectInspector(this.contexts);
  }
  tools() { return [...TOOLS, ...TASK_TOOLS]; }
  has(name) { return this.tools().some(tool => tool.name === name); }
  async call(name, args, options = {}) {
    try {
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw fail('INVALID_ARGUMENT', 'Tool arguments must be an object.');
      options.signal?.throwIfAborted();
      if (name === 'get_harness_status') return response(this.status(args));
      if (!this.directories.length) throw fail('PATH_NOT_ALLOWED', 'Choose a project folder in the desktop app before using project tools.');
      if (TASK_TOOLS.some(tool => tool.name === name)) return response(await this.task(name,args,options));
      if (name === 'get_project_overview') return response(await this.inspector.overview(args, options));
      if (['git_status', 'git_diff', 'git_log'].includes(name)) return response(await this.inspector.git(name.slice(4), args, options));
      if (name === 'get_file_result') return await this.file(args, options);
      throw fail('UNKNOWN_TOOL', 'This Harness tool is unavailable.');
    } catch (error) { return errorResult(error); }
  }
  status(args) {
    const catalog = this.catalog().map(item => ({name: item.name, read_only: item.annotations?.readOnlyHint === true}));
    const page = this.inspector.page('catalog', 'harness', catalog, {}, args);
    const available = new Set(catalog.map(item => item.name)), runtime = this.runtime(), mcp = this.mcp();
    return {summary: `ChatToHarness ${this.versions.app || this.build.version || 'unknown'}; ${runtime.state || 'unknown'}; ${catalog.length} available tools.`,
      app: {version: this.versions.app || this.build.version || null, build: this.build}, components: {node: this.versions.node || process.versions.node, tunnel: this.versions.tunnel || null, desktop_commander: this.versions.desktopCommander || null},
      device: {platform: process.platform, arch: process.arch, os_release: os.release(), name: os.hostname()},
      connection: {state: runtime.state || 'unknown', local_ready: Boolean(runtime.localReady), gateway: 'app-owned', tools_version: mcp.toolsVersion ?? null},
      capabilities: {project_overview: true, git_reads: true, artifact_return: true, persistent_tasks: true, shell_is_sandboxed: false},
      desktop_commander: {expected_tools: DC_TOOLS.length, available_tools: DC_TOOLS.filter(name => available.has(name)), missing_tools: DC_TOOLS.filter(name => !available.has(name)), verification: 'Availability only; consult the platform acceptance report for tested behavior.'},
      tool_catalog: page};
  }
  async task(name, args, {signal} = {}) {
    const root = await this.inspector.root(args);
    if (name === 'start_task') {
      const requested = args.artifact_paths || [];
      if (!Array.isArray(requested) || requested.length > 32 || requested.some(item=>typeof item!=='string'||!item||item.includes('\0'))) throw fail('INVALID_ARGUMENT','artifact_paths must contain at most 32 filenames.');
      const artifacts = [];
      for (const item of requested) { const file = await this.contexts.authorize(path.resolve(root,item)); if (!inside(root,file)) throw fail('TARGET_OUTSIDE_PROJECT','Artifacts must be inside the selected project.'); artifacts.push(file); }
      const related = args.context_paths || [root];
      if (!Array.isArray(related) || related.length > 128 || related.some(item=>typeof item!=='string'||!item||item.includes('\0'))) throw fail('INVALID_ARGUMENT','context_paths must contain at most 128 related project paths.');
      const targets = [...new Set([...related.map(item=>path.resolve(root,item)),...artifacts])];
      const guidance = await this.contexts.prepare(args.project_context_tokens,targets,{projectPath:root,signal,writing:true});
      if (guidance.needsDelivery) throw fail('PROJECT_CONTEXT_REFRESH_REQUIRED','Read the returned project instructions, then retry with the same idempotency_key and supplied tokens.',{contexts:guidance.contexts,next_action:'read_contexts_then_retry'});
      signal?.throwIfAborted();
      return {...this.tasks.start({...args,project_path:root,artifact_paths:artifacts}),project_contexts:guidance.contexts};
    }
    if (name === 'list_tasks') return this.inspector.page('tasks',root,this.tasks.list(root),{project_path:root,summary:'Saved tasks for this project.'},args);
    if (name === 'get_task_logs') return this.tasks.logs(args.task_id,root,args);
    if (name === 'cancel_task') return this.tasks.cancel(args.task_id,root);
    return this.tasks.status(args.task_id,root);
  }
  async file(args, {signal} = {}) {
    const root = await this.inspector.root(args), file = await this.contexts.authorize(path.resolve(root, args.path), true);
    if (!inside(root, file)) throw fail('TARGET_OUTSIDE_PROJECT', 'The artifact is outside the selected project.');
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw fail('FILE_REQUIRED', 'Choose a regular file.');
    const length = integer(args.length, 32768, 65536), offset = args.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > stat.size) throw fail('INVALID_ARGUMENT', 'offset is a byte position within the file.');
    const handle = await fs.open(file, 'r');
    let buffer, digest;
    try {
      if (stat.size > 64 * 1024 * 1024) throw fail('FILE_TOO_LARGE', 'Artifact preview is limited to 64 MiB; use the Desktop Commander file tools for larger files.');
      const hash = crypto.createHash('sha256'), scratch = Buffer.alloc(65536); let at = 0;
      for (;;) { signal?.throwIfAborted(); const {bytesRead} = await handle.read(scratch, 0, scratch.length, at); if (!bytesRead) break; hash.update(scratch.subarray(0, bytesRead)); at += bytesRead; }
      digest = hash.digest('hex');
      buffer = Buffer.alloc(Math.min(length, stat.size - offset)); await handle.read(buffer, 0, buffer.length, offset);
      const after = await handle.stat(); if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ino !== stat.ino) throw fail('FILE_CHANGED', 'The file changed during preview. Read it again to obtain a consistent result.');
    } finally { await handle.close(); }
    const mime = ({'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const value = {summary: `${path.basename(file)}; ${stat.size} bytes; bytes ${offset}–${offset + buffer.length}.`, path: file, mime_type: mime, size: stat.size, sha256: digest, offset, encoding: 'base64', data: buffer.toString('base64'), has_more: offset + buffer.length < stat.size, next_offset: offset + buffer.length};
    const content = [];
    if (args.preview !== false && offset === 0 && mime.startsWith('image/') && stat.size <= 512 * 1024) {
      const image = await fs.readFile(file); if (crypto.createHash('sha256').update(image).digest('hex') !== digest) throw fail('FILE_CHANGED', 'The image changed while being prepared.');
      content.push({type: 'image', mimeType: mime, data: image.toString('base64')});
    } else if (!value.has_more && offset === 0) content.push({type: 'resource', resource: {uri: pathToFileURL(file).href, mimeType: mime, blob: value.data}});
    return response(value, content);
  }
  dispose() { this.contexts.dispose(); this.inspector.dispose(); }
}
module.exports = {HarnessServices, DC_TOOLS, TOOLS, tool, project, pagination, readHints, response, errorResult};
