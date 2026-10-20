'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { RuntimeManager, ERRORS, reason, cleanEnvironment, shellQuote, stopTree, healthRequest, reconnectDelay } = require('../app/runtime.cjs');
const {RUNTIME_COMPONENTS,RUNTIME_ENTRYPOINTS,prepareRuntimeComponents,verifyRuntimeComponents}=require('../app/runtime-components.cjs');
const {defaultShell,tunnelCommand,spawnManaged}=require('../app/platform.cjs');
const {windowsProcessHost}=require('./native-helper.cjs');

const launcherSource = path.resolve(__dirname, '../app/mcp-launch.cjs');
const fakeKey = 'localharness-synthetic-test-key';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function waitFor(predicate, message, timeout = 5000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = predicate();
    if (value) return value;
    await delay(20);
  }
  throw new Error(message);
}
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "localharness-runtime-中文 ' ")));
  const home = path.join(root, 'app home');
  const notes = path.join(root, "notes 中文 ' spaces");
  fs.mkdirSync(home); fs.mkdirSync(notes);
  const cleanup = [];
  t.after(async () => {
    for (const action of cleanup.reverse()) await action();
    // Windows may retain a process working-directory handle briefly after exit.
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return { root, home, notes, cleanup };
}
function writeScript(file, text) {
  fs.writeFileSync(file, '#!/usr/bin/env node\n' + text, { mode: 0o700 });
  return file;
}
function withEnvironment(changes, action) {
  const old = new Map(Object.keys(changes).map(key => [key, process.env[key]]));
  Object.assign(process.env, changes);
  return Promise.resolve().then(action).finally(() => {
    for (const [key, value] of old) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  });
}

test('tool environments strip tunnel and API credentials while retaining HOME and development tools', () => {
  const source = {
    HOME: '/Users/test', PATH: '/custom/bin', SSH_AUTH_SOCK: '/private/tmp/agent', GIT_CONFIG_GLOBAL: '/Users/test/.gitconfig',
    CONTROL_PLANE_API_KEY: fakeKey, TUNNEL_CLIENT_TOKEN: fakeKey, MCP_TOKEN: fakeKey, HEALTH_TOKEN: fakeKey,
    HARPOON_SECRET: fakeKey, LOG_AUTH: fakeKey, OPENAI_API_KEY: fakeKey, openai_admin_key: fakeKey,
  };
  const cleaned = cleanEnvironment(source);
  assert.deepEqual(cleaned, { HOME: source.HOME, PATH: source.PATH, SSH_AUTH_SOCK: source.SSH_AUTH_SOCK, GIT_CONFIG_GLOBAL: source.GIT_CONFIG_GLOBAL });
  assert.equal(source.CONTROL_PLANE_API_KEY, fakeKey);
});

test('the copied runtime manifest resolves actual helper dependencies without executing entrypoints', t => {
  const f=fixture(t);
  const files=prepareRuntimeComponents({sourceDirectory:path.dirname(launcherSource),home:f.home});
  for(const name of RUNTIME_COMPONENTS.builtin)assert.ok(files.includes(path.join(f.home,name)),name);
  assert.ok(files.includes(path.join(f.home,'tool-recovery.cjs')),'transitive recovery dependency must ship with the launcher');
  fs.unlinkSync(path.join(f.home,'tool-recovery.cjs'));
  assert.throws(()=>verifyRuntimeComponents({directory:f.home,entrypoints:['mcp-launch.cjs']}),{code:'MCP_MODULE_NOT_FOUND'});
  const sideEffect=path.join(f.root,'must-not-exist');
  fs.writeFileSync(path.join(f.home,'entry.cjs'),`require('node:fs').writeFileSync(${JSON.stringify(sideEffect)},'executed');require('./helper.cjs');`);
  fs.writeFileSync(path.join(f.home,'helper.cjs'),'module.exports = 1;');
  verifyRuntimeComponents({directory:f.home,entrypoints:['entry.cjs']});
  assert.equal(fs.existsSync(sideEffect),false);
  fs.writeFileSync(path.join(f.home,'helper.cjs'),'module.exports = ;');
  assert.throws(()=>verifyRuntimeComponents({directory:f.home,entrypoints:['entry.cjs']}),{code:'MCP_COMPONENT_INVALID'});
});

test('runtime keeps tunnel readiness independent from managed tool readiness', t => {
  const f=fixture(t),gateway={status(){return {tools_health:'degraded',tools_ready:false,missing_capabilities:[{service_id:'builtin',capability:'tools',phase:'failed',code:'MCP_MODULE_NOT_FOUND'}]};},async stop(){},async close(){}};
  const manager=new RuntimeManager({home:f.home,paths:{},gateway});f.cleanup.push(()=>manager.close());
  manager.update({state:'ready',localReady:true,toolsCount:3});
  assert.equal(manager.status().state,'ready');assert.equal(manager.status().tools_health,'degraded');
  assert.equal(manager.status().tools_ready,false);assert.equal(manager.status().missing_capabilities[0].service_id,'builtin');
});

test('diagnostic packaging verification covers writer and worker dependencies without starting a worker', t => {
  const f=fixture(t);
  assert.deepEqual(RUNTIME_ENTRYPOINTS.diagnostics,['diagnostic-writer.cjs','diagnostic-worker.cjs']);
  const files=prepareRuntimeComponents({sourceDirectory:path.dirname(launcherSource),home:f.home,kind:'diagnostics'});
  for(const name of RUNTIME_COMPONENTS.diagnostics)assert.ok(files.includes(path.join(f.home,name)),name);
  // Evaluating the worker would require parentPort/workerData and would write
  // storage. Packaging verification only compiles and resolves copied files.
  assert.equal(fs.existsSync(path.join(f.home,'executions')),false);
  assert.equal(fs.existsSync(path.join(f.home,'logs')),false);
  fs.unlinkSync(path.join(f.home,'diagnostic-storage.cjs'));
  assert.throws(()=>verifyRuntimeComponents({directory:f.home,entrypoints:RUNTIME_ENTRYPOINTS.diagnostics}),{code:'MCP_MODULE_NOT_FOUND'});
});

test('missing bundled executables keep a permanent component code alongside the localized message', t => {
  const f=fixture(t);
  const manager=new RuntimeManager({home:f.home,paths:{node:path.join(f.root,'missing-node'),tunnel:process.execPath}});f.cleanup.push(()=>manager.close());
  assert.throws(()=>manager.prepare({directories:[f.notes]}),{code:'MCP_FILE_NOT_FOUND',message:ERRORS.binary});
});

test('app gateway supports MCP-only workspaces and Tunnel restarts reuse downstream ownership', {timeout:15000}, async t => {
  const f=fixture(t),report=path.join(f.root,'gateway-tunnel.json');
  const tunnel=writeScript(path.join(f.root,'gateway-tunnel.cjs'),`
require('node:fs').writeFileSync(${JSON.stringify(report)},JSON.stringify({args:process.argv.slice(2),endpoint:process.env.CTH_GATEWAY_ENDPOINT}));
setInterval(()=>{},1000);
`);
  const gateway={starts:0,stops:0,closes:0,async start(settings){this.starts++;assert.deepEqual(settings.directories,[]);return 2;},
    environment(){return {CTH_GATEWAY_ENDPOINT:'synthetic-private-endpoint',CTH_GATEWAY_TOKEN:'0'.repeat(64)};},
    async stop(){this.stops++;},async close(){this.closes++;}};
  const manager=new RuntimeManager({home:f.home,paths:{node:process.execPath,tunnel:process.execPath,desktopCommander:path.join(f.root,'missing-unused-builtin'),processHost:windowsProcessHost()},gateway,tunnelScript:tunnel});
  f.cleanup.push(()=>manager.close());
  await manager.connect({directories:[],tunnelId:'tunnel_'+'a'.repeat(32)},fakeKey);
  // A fixture may create the output path before the JSON write completes.
  // Wait for a complete report, not just the existence of an empty file.
  let first;
  await waitFor(()=>{try{first=JSON.parse(fs.readFileSync(report,'utf8'));return Boolean(first?.endpoint);}catch{return false;}},'gateway Tunnel fixture did not start');
  assert.equal(first.endpoint,'synthetic-private-endpoint');
  assert.equal(first.args[first.args.indexOf('--mcp.command')+1],tunnelCommand([process.execPath,manager.gatewayLauncher]));
  assert.equal(first.args[first.args.indexOf('--control-plane.initial-poll-timeout')+1],'1s');
  assert.equal(fs.existsSync(manager.gatewayLauncher),true);
  assert.equal(gateway.starts,1);
  await manager.stopProcess();manager.launch();
  assert.equal(gateway.starts,1,'a transport restart cannot restart managed MCP clients');
  await manager.disconnect();
  assert.equal(gateway.stops,1);
  assert.equal(manager.status().state,'stopped');
});

test('shell command quoting preserves unicode, spaces, apostrophes and shell metacharacters', {skip:process.platform==='win32'}, () => {
  const values = ['', "中文 project ' files", 'literal $(echo unsafe) `id` $HOME ; * \nnext line'];
  for (const value of values) {
    const result = execFileSync('/bin/zsh', ['-c', `printf '%s' ${shellQuote(value)}`], { encoding: 'utf8' });
    assert.equal(result, value);
  }
});

test('authentication failures map to actionable reasons', () => {
  for (const value of ['HTTP 401 Unauthorized', { error: 'invalid_api_key' }, 'invalid api key']) assert.equal(reason(value), 'key');
  for (const value of ['HTTP 403 Forbidden', { error: 'permission_denied' }]) assert.equal(reason(value), 'permission');
  for (const value of ['HTTP 404', { error: 'tunnel_not_found' }]) assert.equal(reason(value), 'tunnel');
  assert.equal(reason({ status: 'ok' }), '');
  assert.equal(reason('connection reset'), '');
  assert.equal(reason({ status: 'ok', polls: 401, duration_ms: 403, requests: 404 }), '');
  assert.equal(reason({ status_code: 401 }), 'key');
});

test('brief outages use fast retries while sustained failures retain bounded backoff',()=>{
  assert.deepEqual([0,1,2,3,4,20].map(attempt=>reconnectDelay(attempt,15000)),[250,1000,2000,5000,5000,5000]);
  assert.equal(reconnectDelay(10,30000),10000);
  assert.equal(reconnectDelay(10,60000),30000);
});

test('an exited tunnel restarts by event and retry timer without waiting for the periodic monitor', {timeout:10000},async t=>{
  const f=fixture(t),tunnel=writeScript(path.join(f.root,'idle-tunnel.cjs'),'setInterval(()=>{},1000);');
  const logs=[],gateway={async start(){return 1;},environment(){return {};},async stop(){},async close(){}};
  const manager=new RuntimeManager({home:f.home,paths:{node:process.execPath,tunnel:process.execPath,processHost:windowsProcessHost()},gateway,tunnelScript:tunnel,log:(event,value)=>logs.push({event,...value})});
  f.cleanup.push(()=>manager.close());
  clearInterval(manager.timer); // Only the exit event and retry timer can recover.
  await manager.connect({directories:[],tunnelId:'tunnel_'+'a'.repeat(32)},fakeKey);
  const original=manager.process;assert.ok(original.pid);
  original.kill();
  await waitFor(()=>manager.process&&manager.process!==original,'exit did not schedule a replacement',5000);
  assert.equal(logs.find(row=>row.event==='runtime-retry').delay_ms,250);
  assert.equal(manager.attempts,1);
  assert.equal(manager.status().state,'reconnecting');
  // A quick ready/flapping period preserves the existing recovery budget.
  assert.notEqual(manager.recoveryStartedAt,null);
  await manager.disconnect();assert.equal(manager.retryTimer,null);
});

test('explicit disconnect cancels a scheduled reconnect and a stale timer cannot relaunch',async t=>{
  const f=fixture(t),manager=new RuntimeManager({home:f.home,paths:{}});f.cleanup.push(()=>manager.close());
  clearInterval(manager.timer);
  let launches=0;manager.launch=()=>launches++;
  manager.desired={};manager.processError='network';manager.process={exitCode:null,signalCode:null};
  manager.stopProcess=async()=>{manager.process=null;};
  await manager.monitor();assert.ok(manager.retryTimer);assert.equal(manager.attempts,1);
  await manager.disconnect();await delay(350);
  assert.equal(launches,0);assert.equal(manager.retryTimer,null);assert.equal(manager.status().state,'stopped');
});

test('health checks accept only an unauthenticated HTTP endpoint on IPv4 loopback', async (t) => {
  let requests = 0;
  const server = http.createServer((request, response) => {
    requests++;
    assert.equal(request.headers.accept, 'application/json');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ path: request.url, status: 'ok' }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const good = await healthRequest(`http://127.0.0.1:${port}/`, '/health?details=true');
  assert.equal(good.code, 200);
  assert.equal(good.body.path, '/health?details=true');
  for (const base of [
    `https://127.0.0.1:${port}/`, `http://localhost:${port}/`, `http://[::1]:${port}/`,
    `http://127.0.0.1/`, `http://user:password@127.0.0.1:${port}/`,
    `http://127.0.0.1:${port}/other`, 'file:///private/tmp/health', 'not-a-url',
  ]) await assert.rejects(healthRequest(base, '/readyz'));
  assert.equal(requests, 1);
});

test('real stdio MCP preflight strips runtime keys, retains HOME and shuts down its server', { timeout: 15000 }, async (t) => {
  const f = fixture(t);
  const report = path.join(f.root, 'mcp-report.json');
  const stopped = path.join(f.root, 'mcp-stopped');
  const entry = writeScript(path.join(f.root, "fake mcp '中文.cjs"), `
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify({pid:process.pid,home:process.env.HOME,dcHome:process.env.LOCALHARNESS_DC_HOME,track:process.env.DO_NOT_TRACK,keys:Object.keys(process.env).filter(key=>/^(CONTROL_PLANE_|TUNNEL_CLIENT_|MCP_|HEALTH_|HARPOON_|LOG_)/i.test(key)||/^(OPENAI_API_KEY|OPENAI_ADMIN_KEY)$/i.test(key))}));
require('node:readline').createInterface({input:process.stdin}).on('line', line=>{
 const request=JSON.parse(line); if(request.id===undefined)return;
 const result=request.method==='initialize'?{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'Fixture MCP',version:'1'}}:{tools:[{name:'start_process',inputSchema:{type:'object'}},{name:'read_file',inputSchema:{type:'object'}}]};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n');
});
process.on('SIGTERM',()=>{fs.writeFileSync(${JSON.stringify(stopped)},'stopped');process.exit(0);});
`);
  const manager = new RuntimeManager({ home: f.home, paths: { node: process.execPath, tunnel: process.execPath, desktopCommander: entry, processHost:windowsProcessHost() }, launcherSource });
  f.cleanup.push(() => manager.close());
  await withEnvironment({ CONTROL_PLANE_API_KEY: fakeKey, OPENAI_API_KEY: fakeKey, TUNNEL_CLIENT_TOKEN: fakeKey }, async () => {
    assert.ok(await manager.probe({ directories: [f.notes] }) >= 3);
  });
  const evidence = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.deepEqual(evidence.keys, []);
  assert.equal(evidence.home, process.env.HOME);
  assert.equal(evidence.dcHome, path.join(f.home, 'desktop-commander'));
  assert.equal(evidence.track, '1');
  assert.equal(alive(evidence.pid), false);
  if(process.platform!=='win32')assert.equal(fs.readFileSync(stopped, 'utf8'), 'stopped');
  const config = JSON.parse(fs.readFileSync(path.join(f.home, 'desktop-commander', 'config.json'), 'utf8'));
  assert.equal(config.defaultShell, defaultShell());
  assert.deepEqual(config.allowedDirectories, [f.notes]);
  assert.equal(config.telemetryEnabled, false);
  for(const helper of RUNTIME_COMPONENTS.builtin)assert.ok(fs.existsSync(path.join(f.home,helper)));
  assert.equal(manager.childEnvironment({autoProjectContext:false}).LOCALHARNESS_AUTO_PROJECT_CONTEXT,'0');
  assert.equal(manager.childEnvironment().LOCALHARNESS_AUTO_PROJECT_CONTEXT,'1');
  assert.equal(manager.probeChild, null);
});

test('supervisor readiness, authorization failure and explicit stop use only local fixture processes', { timeout: 20000 }, async (t) => {
  const f = fixture(t);
  const mode = path.join(f.root, 'health-mode.json');
  const report = path.join(f.root, 'tunnel-report.json');
  fs.writeFileSync(mode, JSON.stringify({ status: 'ok' }));
  const entry = writeScript(path.join(f.root, 'unused fake mcp.cjs'), 'setInterval(()=>{},1000);');
  const tunnel = writeScript(path.join(f.root, "fake tunnel '中文.cjs"), `
const fs=require('node:fs'),http=require('node:http');
const args=process.argv.slice(2),file=args[args.indexOf('--health.url-file')+1];
fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({pid:process.pid,args,home:process.env.HOME,key:process.env.CONTROL_PLANE_API_KEY}));
const server=http.createServer((req,res)=>{let control=JSON.parse(fs.readFileSync(${JSON.stringify(mode)},'utf8'));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(req.url==='/readyz'?{status:'ok'}:{components:{'control-plane':control}}));});
// The parent waits for existence: publish a complete URL atomically so it
// cannot observe the empty file between open and write on a busy CI runner.
server.listen(0,'127.0.0.1',()=>{const pending=file+'.tmp';fs.writeFileSync(pending,'http://127.0.0.1:'+server.address().port+'/');fs.renameSync(pending,file);});
`);
  const manager = new RuntimeManager({ home: f.home, paths: { node: process.execPath, tunnel:process.execPath, desktopCommander: entry, processHost:windowsProcessHost() }, launcherSource, tunnelScript:tunnel, probe: async () => 2 });
  f.cleanup.push(() => manager.close());
  const settings = { directories: [f.notes], tunnelId: 'tunnel_' + 'a'.repeat(32) };
  await manager.connect(settings, fakeKey);
  await waitFor(() => fs.existsSync(manager.healthFile), 'fixture tunnel did not start');
  const evidence = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.equal(evidence.key, fakeKey);
  assert.equal(evidence.home, process.env.HOME);
  assert.equal(evidence.args.includes(fakeKey), false);
  assert.equal(evidence.args[evidence.args.indexOf('--control-plane.api-key') + 1], 'env:CONTROL_PLANE_API_KEY');
  const command = evidence.args[evidence.args.indexOf('--mcp.command') + 1];
  assert.equal(command, tunnelCommand([process.execPath, manager.launcher, entry, String(process.pid)]));
  await manager.monitor();
  assert.equal(manager.status().state, 'ready');
  assert.equal(manager.status().localReady, true);
  manager.attempts=4;manager.recoveryStartedAt=Date.now()-20000;manager.readySince=null;
  await manager.monitor();assert.equal(manager.attempts,4,'a briefly ready connection must not reset flapping backoff');
  manager.readySince=Date.now()-31000;
  await manager.monitor();assert.equal(manager.attempts,0);assert.equal(manager.recoveryStartedAt,null);
  fs.writeFileSync(mode, JSON.stringify({ status: 'degraded', error: { status: 403, message: 'Forbidden' } }));
  await manager.monitor();
  assert.equal(manager.status().state, 'failed');
  assert.equal(manager.status().error, ERRORS.permission);
  assert.equal(manager.desired, null);
  assert.equal(manager.process, null);
  assert.equal(alive(evidence.pid), false);
  assert.equal(fs.existsSync(manager.healthFile), false);
  fs.writeFileSync(mode, JSON.stringify({ status: 'ok' }));
  await manager.connect(settings, fakeKey);
  await waitFor(() => fs.existsSync(manager.healthFile), 'fixture tunnel did not restart');
  const restarted = JSON.parse(fs.readFileSync(report, 'utf8'));
  await manager.disconnect();
  assert.equal(manager.status().state, 'stopped');
  assert.equal(manager.desired, null);
  assert.equal(alive(restarted.pid), false);
});

function stubbornChildSource(pidFile) {
  return `const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`;
}

test('stopTree also kills a detached descendant that ignores SIGTERM after its parent exits', { timeout: 15000 }, async (t) => {
  const f = fixture(t);
  const pidFile = path.join(f.root, 'stubborn.pid');
  const childEntry = writeScript(path.join(f.root, 'stubborn.cjs'), stubbornChildSource(pidFile));
  const rootEntry = writeScript(path.join(f.root, 'parent.cjs'), `require('node:child_process').spawn(process.execPath,[${JSON.stringify(childEntry)}],{detached:true,stdio:'ignore'});setInterval(()=>{},1000);`);
  const child = spawnManaged(process.execPath, [rootEntry], { processHost:windowsProcessHost(), stdio: 'ignore' });
  let descendant;
  f.cleanup.push(async () => {
    for (const pid of [descendant, child.pid]) if (pid) try { process.kill(pid, 'SIGKILL'); } catch {}
  });
  descendant = Number(await waitFor(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8'), 'descendant did not start'));
  await stopTree(child);
  await waitFor(() => !alive(descendant), 'detached descendant survived stopTree', 1500);
  assert.notEqual(child.exitCode === null && child.signalCode === null, true);
});

test('stdio launcher kills detached tool descendants even when its direct MCP child exits first', { timeout: 15000 }, async (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.home,'config.json'),JSON.stringify({allowedDirectories:[f.notes]}));
  const pidFile = path.join(f.root, 'launcher-stubborn.pid');
  const childEntry = writeScript(path.join(f.root, 'launcher-stubborn.cjs'), stubbornChildSource(pidFile));
  const entry = writeScript(path.join(f.root, 'launcher-mcp.cjs'), `require('node:child_process').spawn(process.execPath,[${JSON.stringify(childEntry)}],{detached:true,stdio:'ignore'});setInterval(()=>{},1000);`);
  const child = spawnManaged(process.execPath, [launcherSource, entry, String(process.pid)], { processHost:windowsProcessHost(), env: { ...process.env, LOCALHARNESS_DC_HOME: f.home, ...(process.platform==='win32'?{LOCALHARNESS_PROCESS_HOST:windowsProcessHost()}:{}) }, stdio: ['pipe', 'ignore', 'ignore'] });
  let descendant;
  f.cleanup.push(async () => {
    for (const pid of [descendant, child.pid]) if (pid) try { process.kill(pid, 'SIGKILL'); } catch {}
  });
  descendant = Number(await waitFor(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8'), 'launcher descendant did not start'));
  const exited = once(child, 'exit');
  await stopTree(child);
  await exited;
  await waitFor(() => !alive(descendant), 'detached descendant survived launcher stop', 1500);
});
