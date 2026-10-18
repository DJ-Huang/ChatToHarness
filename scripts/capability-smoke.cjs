'use strict';
// Synthetic, isolated native acceptance. Never submits the feedback form.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {RuntimeManager} = require('../app/runtime.cjs');
const {McpManager} = require('../app/mcp-manager.cjs');
const {McpSettings} = require('../app/mcp-settings.cjs');
const {HarnessServices, DC_TOOLS} = require('../app/harness-services.cjs');
const {patchEngine} = require('./engine-isolation.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = result => (result.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
async function main() {
  const root = path.resolve(__dirname, '..'), resources = path.join(root, 'resources');
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cth-capabilities 中文 '))), project = path.join(directory, 'project');
  fs.mkdirSync(project); const home = path.join(directory, 'app'), runtime = new RuntimeManager({home, resources});
  const report = {platform: process.platform, arch: process.arch, engine_version: '0.3.0', generated_at: new Date().toISOString(), tools: {}, formats: {}, failures: []};
  const record = (name, status, detail) => { report.tools[name] = {status, detail}; };
  patchEngine(path.dirname(path.dirname(runtime.paths.desktopCommander)));
  const settings = new McpSettings(path.join(directory, 'settings'), {isEncryptionAvailable: () => false});
  let manager;
  const services = new HarnessServices({home, versions: {app: require('../package.json').version, desktopCommander: '0.3.0'}, runtime: () => runtime.status(), catalog: () => manager.visibleTools(), mcp: () => manager.status()});
  manager = new McpManager({settings, services, nodePath: runtime.paths.node, processHost: runtime.paths.processHost,
    builtinFactory: async desktop => { runtime.prepare(desktop); return {transport: 'stdio', command: runtime.paths.node, args: [runtime.launcher, runtime.paths.desktopCommander, String(process.pid)], cwd: project, env: runtime.childEnvironment(desktop)}; }});
  const call = async (name, args = {}) => {
    const result = await manager.call(name, {project_path: project, ...args});
    assert.notEqual(result.isError, true, `${name}: ${text(result)}`); record(name, 'verified', 'Synthetic native invocation succeeded.'); return result;
  };
  const command = code => {
    const name = '.capability-' + crypto.createHash('sha256').update(code).digest('hex').slice(0, 16) + '.cjs';
    const script = path.join(project, name);
    if (!fs.existsSync(script)) fs.writeFileSync(script, code);
    return process.platform === 'win32'
      ? `& '${runtime.paths.node.replace(/'/g, "''")}' '${script.replace(/'/g, "''")}'`
      : `'${runtime.paths.node.replace(/'/g, "'\\''")}' '${script.replace(/'/g, "'\\''")}'`;
  };
  try {
    await manager.start({directories: [directory], autoProjectContext: true});
    const catalog = manager.visibleTools(), names = new Set(catalog.map(item => item.name));
    for (const name of DC_TOOLS) { assert.ok(names.has(name), `Missing official tool ${name}`); record(name, 'partial', 'Definition preserved; no native behavioral invocation yet.'); }
    assert.equal(catalog.find(tool => tool.name === 'stop_search').annotations.readOnlyHint, false);
    assert.equal(catalog.find(tool => tool.name === 'start_process').annotations.idempotentHint, false);
    await call('get_config'); await call('set_config_value', {key: 'fileReadLineLimit', value: 1000});
    const deny = await manager.call('set_config_value', {key: 'allowedDirectories', value: []}); assert.equal(deny.isError, true);
    record('set_config_value', 'partial', 'Ordinary configuration works. Authorized-folder expansion through a tool is intentionally unsupported; use desktop settings.');
    await call('create_directory', {path: path.join(project, 'files')});
    const file = path.join(project, 'files', 'hello 中文.txt');
    await call('write_file', {path: file, content: 'CTH_TEXT\nline two\n', mode: 'rewrite'});
    assert.match(text(await call('read_file', {path: file})), /CTH_TEXT/);
    await call('edit_block', {file_path: file, old_string: 'line two', new_string: 'CTH_EDIT'});
    assert.match(text(await call('read_multiple_files', {paths: [file]})), /CTH_EDIT/);
    await call('list_directory', {path: project, depth: 2}); await call('get_file_info', {path: file});
    const moved = path.join(project, 'files', 'moved.txt'); await call('move_file', {source: file, destination: moved}); assert.ok(fs.existsSync(moved));
    const search = await call('start_search', {path: project, pattern: 'CTH_EDIT', searchType: 'content', literalSearch: true, timeout_ms: 1000});
    const searchId = search.structuredContent?.sessionId || /(?:session(?: ID)?|Session):?\s*(search_[A-Za-z0-9_-]+)/i.exec(text(search))?.[1]; assert.ok(searchId, text(search));
    await call('get_more_search_results', {sessionId: searchId, offset: 0, length: 20}); await call('list_searches'); await call('stop_search', {sessionId: searchId});
    const start = await call('start_process', {command: command('process.stdin.once("data",x=>{console.log("CTH_INPUT:"+x);process.exit(0)})'), timeout_ms: 200, context_paths: [project]});
    const pid = Number(start.structuredContent?.pid || /Process started with PID\s+(-?\d+)/.exec(text(start))?.[1]); assert.ok(pid);
    await call('list_sessions', {context_paths: [project]}); await call('list_processes', {context_paths: [project]});
    assert.match(text(await call('interact_with_process', {pid, input: 'hello\n', timeout_ms: 2000, context_paths: [project]})), /CTH_INPUT/);
    await call('read_process_output', {pid, offset: -20, length: 20, timeout_ms: 1000, context_paths: [project]});
    for (const name of ['force_terminate', 'kill_process']) {
      const run = await call('start_process', {command: command('setInterval(()=>{},1000)'), timeout_ms: 100, context_paths: [project]});
      const owned = Number(run.structuredContent?.pid || /Process started with PID\s+(-?\d+)/.exec(text(run))?.[1]); assert.ok(owned);
      await call(name, {pid: owned, context_paths: [project]});
    }
    await call('get_usage_stats');
    await call('get_recent_tool_calls', {count: 3});
    assert.ok(fs.existsSync(path.join(runtime.localHome, 'tool-history.jsonl')), 'History must remain inside this isolated fixture.');
    record('give_feedback_to_desktop_commander', 'partial', 'Official definition and annotations preserved. Browser/form submission intentionally not exercised.');
    for (const [extension, content, marker] of [['xlsx', '[["name","value"],["CTH_XLSX",42]]', 'CTH_XLSX'], ['docx', '# CTH_DOCX\n\nSynthetic paragraph.', 'CTH_DOCX'], ['pdf', '# CTH_PDF\n\nSynthetic paragraph.', 'CTH_PDF']]) {
      const target = path.join(project, `sample 中文.${extension}`);
      try {
        await pause(200);
        const result = extension === 'pdf' ? await manager.call('write_pdf', {path: target, outputPath: target, content, project_path: project}) : await manager.call('write_file', {path: target, content, project_path: project});
        assert.notEqual(result.isError, true, text(result));
        const read = await call('read_file', {path: target}); assert.match(text(read), new RegExp(marker));
        if (extension === 'xlsx') { await call('edit_block', {file_path: target, range: 'Sheet1!B2:B2', content: [[99]]}); assert.match(text(await call('read_file', {path: target, range: 'Sheet1!A1:B2'})), /99/); }
        if (extension === 'docx') { await call('edit_block', {file_path: target, old_string: 'Synthetic paragraph.', new_string: 'CTH_DOCX_EDIT'}); assert.match(text(await call('read_file', {path: target})), /CTH_DOCX_EDIT/); }
        if (extension === 'pdf') record('write_pdf', 'verified', 'Synthetic Markdown PDF creation and native readback.');
        report.formats[extension] = {status: 'verified', bytes: fs.statSync(target).size};
      } catch (error) { report.formats[extension] = {status: 'partial', reason: error.message}; report.failures.push(`format:${extension}`); }
    }
    execFileSync('git', ['-C', project, 'init'], {stdio: 'ignore'});
    await call('get_harness_status'); await call('get_project_overview'); await call('git_status'); await call('git_diff'); await call('get_file_result', {path: moved});
    report.history_isolated = true;
  } catch (error) { report.failures.push(error.message); }
  finally {
    await manager.close(); await runtime.close();
    const output = path.join(root, '.cache', 'acceptance'); fs.mkdirSync(output, {recursive: true});
    fs.writeFileSync(path.join(output, `capabilities-${process.platform}-${process.arch}.json`), JSON.stringify(report, null, 2) + '\n');
    fs.rmSync(directory, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
  }
  console.log(JSON.stringify(report, null, 2)); if (report.failures.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {main};
