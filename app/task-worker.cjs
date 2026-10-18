'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {StringDecoder} = require('node:string_decoder');
const {spawnManaged, stopTree, defaultShell, taskShellArguments} = require('./platform.cjs');
const {readJson, atomicJson} = require('./durable-files.cjs');
const {TaskOutput}=require('./task-output.cjs');
const {sanitize}=require('./diagnostic-budget.cjs');
const directory = process.argv[2];
const now = () => new Date().toISOString();
async function main() {
  if (!directory || !path.isAbsolute(directory) || fs.lstatSync(directory).isSymbolicLink()) throw new Error('Invalid task directory.');
  const request = readJson(path.join(directory, 'request.json'));
  // An exclusive claim persists even after a crash: another worker must never
  // replay a command whose execution state may already be unknown.
  let lock; try { lock = fs.openSync(path.join(directory, 'worker.claim'), 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') return; throw error; }
  fs.writeFileSync(lock, String(process.pid)); fs.fsyncSync(lock); fs.closeSync(lock);
  let state = {...readJson(path.join(directory, 'state.json')), state: 'starting', worker_pid: process.pid, updated_at: now()}, child, reason, heartbeat, deadline;
  const save = () => { state.updated_at = now(); atomicJson(path.join(directory, 'state.json'), state); };
  const outputLog=new TaskOutput({home:path.dirname(path.dirname(directory)),file:path.join(directory,'output.jsonl'),secrets:Object.entries(process.env).filter(([key])=>/token|secret|password|key|authorization/i.test(key)).map(([,value])=>value)});
  const log=(stream,text)=>{outputLog.append(stream,text);};
  const stop = why => { if (reason) return; reason = why; if (child) void stopTree(child); };
  process.on('SIGTERM', () => stop('cancelled')); process.on('SIGINT', () => stop('cancelled'));
  save();
  heartbeat = setInterval(() => {
    try { if (fs.existsSync(path.join(directory, 'cancel.request'))) stop('cancelled'); save(); }
    catch { stop('interrupted'); }
  }, 1000);
  try {
    if (!request.engine_entry || !request.config_home) throw Object.assign(new Error('The official command validator is unavailable.'), {code: 'TASK_ENGINE_UNAVAILABLE'});
    process.env.LOCALHARNESS_DC_HOME = request.config_home; process.env.DO_NOT_TRACK = '1';
    const {commandManager} = await import(pathToFileURL(path.join(path.dirname(request.engine_entry), 'command-manager.js')).href);
    if (!await commandManager.validateCommand(request.command)) throw Object.assign(new Error('The command is blocked by the Desktop Commander command policy.'), {code: 'COMMAND_BLOCKED'});
    const config = readJson(path.join(request.config_home, 'config.json'), 2 * 1024 * 1024);
    const shell = config.defaultShell || defaultShell();
    if (fs.existsSync(path.join(directory, 'cancel.request'))) reason = 'cancelled';
    if (reason) { state.state = reason; state.finished_at = now(); return; }
    const argv = taskShellArguments(shell, request.command);
    // Persist uncertainty before crossing the spawn boundary. A process crash
    // after launch must never leave a record claiming it was not executed.
    state = {...state, state: 'launching', operation_executed: null, execution_state: 'unknown'}; save();
    child = spawnManaged(shell, argv, {processHost: request.process_host, cwd: request.project_path, env: process.env, stdio: ['ignore', 'pipe', 'pipe']});
    for (const [stream, output] of [['stdout', child.stdout], ['stderr', child.stderr]]) {
      const decoder = new StringDecoder('utf8');let pending='',omitted=false;
      const consume=text=>{
        for(const part of text.split(/(?<=\n)/)){
          if(!omitted){pending+=part;if(pending.length>16384){pending='';omitted=true;state.log_truncated=true;log(stream,'[long output line omitted]\n');}}
          if(part.endsWith('\n')){if(pending)log(stream,pending);pending='';omitted=false;}
        }
      };
      output.on('data',bytes=>{consume(decoder.write(bytes));outputLog.flush();});
      output.on('end',()=>{consume(decoder.end());if(pending)log(stream,pending);outputLog.flush();});
    }
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('spawn', () => { state = {...state, state: 'running', started_at: now(), process_pid: child.pid, operation_executed: true, execution_state: 'running'}; save(); });
      child.once('close', (code, signal) => resolve({exit_code: code, signal}));
      deadline = setTimeout(() => stop('timed_out'), request.runtime_limit_ms);
    });
    if (child.localHarnessStopping) await child.localHarnessStopping;
    state = {...state, ...result, state: reason || (result.exit_code === 0 ? 'succeeded' : 'failed'), execution_state: 'completed', finished_at: now(), log_bytes: outputLog.bytes};
  } catch (error) {
    if (child) await stopTree(child);
    const executed = state.operation_executed === true;
    state = {...state, state: reason || 'failed', operation_executed: executed, finished_at: now(), execution_state: executed ? 'unknown' : 'not_started', error: {code: error.code || 'TASK_FAILED', message: sanitize(error.message,1024,outputLog.secrets)}};
  } finally {
    clearInterval(heartbeat); clearTimeout(deadline); outputLog.close();state.log_bytes=outputLog.bytes;state.log_truncated=outputLog.truncated||state.log_truncated;save();
  }
}
main().then(() => process.exit(0), () => process.exit(1));
