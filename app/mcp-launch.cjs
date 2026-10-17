#!/usr/bin/env node
'use strict';
// This small stdio supervisor is copied outside app.asar for the bundled Node.
const fs = require('node:fs');
const path = require('node:path');
const {spawn, execFileSync} = require('node:child_process');
const {McpProxy,wireProtocol} = require('./mcp-proxy.cjs');
const {ProjectContexts} = require('./project-context.cjs');
const {ProjectSearch,resolveRipgrep}=require('./project-search.cjs');
const {spawnManaged,stopTree}=require('./platform.cjs');
const [entry, ownerText] = process.argv.slice(2);
const owner = Number(ownerText);
const configHome = process.env.LOCALHARNESS_DC_HOME;
if (!entry || !path.isAbsolute(entry) || !configHome || !path.isAbsolute(configHome) || !Number.isSafeInteger(owner) || owner < 2) {
  process.stderr.write('ChatToHarness: invalid local MCP configuration.\n'); process.exit(1);
}
// The runtime needs this key; the MCP server and all its shell children do not.
const env = {...process.env};
for (const key of Object.keys(env)) {
  if (/^(CONTROL_PLANE_|TUNNEL_CLIENT_|MCP_|HEALTH_|HARPOON_|LOG_)/i.test(key) || /^(OPENAI_API_KEY|OPENAI_ADMIN_KEY)$/i.test(key)||/^LOCALHARNESS_TEST_/i.test(key)) delete env[key];
}
env.LOCALHARNESS_DC_HOME = configHome;
env.DO_NOT_TRACK = '1';
const autoProjectContext=env.LOCALHARNESS_AUTO_PROJECT_CONTEXT !== '0';
delete env.LOCALHARNESS_AUTO_PROJECT_CONTEXT;
let child, proxy, closing = false, exitStatus = 0;
function descendants(pid) {
  try {
    const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], {encoding:'utf8',timeout:2000}).trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
    const found = new Set([pid]);
    for (let changed = true; changed;) { changed = false; for (const [id,parent] of rows) if (found.has(parent) && !found.has(id)) {found.add(id);changed = true;} }
    return [...found].reverse();
  } catch {return [pid];}
}
function stop() {
  if (closing) return; closing = true;
  proxy?.dispose();
  clearInterval(watchdog);
  if (!child) return process.exit(exitStatus);
  if(process.platform==='win32'){void stopTree(child).finally(()=>process.exit(exitStatus));return;}
  const owned = descendants(child.pid);
  for (const pid of owned) try {process.kill(pid, 'SIGTERM');} catch {}
  const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
  const force = setTimeout(() => {clearInterval(settle);for (const pid of owned) if(alive(pid))try {process.kill(pid, 'SIGKILL');} catch {} process.exit(exitStatus);}, 2500);
  const settle=setInterval(()=>{if(!owned.some(alive)){clearTimeout(force);clearInterval(settle);process.exit(exitStatus);}},100);
}
const watchdog = setInterval(() => {try {process.kill(owner, 0);process.kill(process.ppid, 0);if(process.ppid === 1)stop();} catch {stop();}}, 1000);
process.on('SIGTERM',stop);process.on('SIGINT',stop);process.on('SIGHUP',stop);
try {
  if (!fs.statSync(entry).isFile()) throw new Error();
  const configuration=JSON.parse(fs.readFileSync(path.join(configHome,'config.json'),'utf8'));
  const contexts=new ProjectContexts({defaultDirectory:process.cwd(),allowedDirectories:configuration.allowedDirectories || []});
  child = process.platform==='win32'
    ? spawnManaged(process.execPath,[entry],{processHost:env.LOCALHARNESS_PROCESS_HOST,env,cwd:process.cwd(),stdio:['pipe','pipe','inherit']})
    : spawn(process.execPath,[entry],{env,cwd:process.cwd(),stdio:['pipe','pipe','inherit']});
  let binary;try{binary=resolveRipgrep(entry);}catch{}
  const search=binary?new ProjectSearch({contexts,binary}):undefined;
  proxy=new McpProxy({contexts,search,enabled:autoProjectContext,defaultDirectory:process.cwd()});
  wireProtocol({clientInput:process.stdin,clientOutput:process.stdout,serverInput:child.stdin,serverOutput:child.stdout,proxy,onFatal:stop});
  child.once('error', () => {process.stderr.write('ChatToHarness: local MCP could not start.\n');exitStatus=1;stop();});
  child.once('exit', code => {if (!closing) {clearInterval(watchdog);exitStatus=code??1;stop();}});
} catch {process.stderr.write('ChatToHarness: local MCP is unavailable.\n');clearInterval(watchdog);process.exit(1);}
