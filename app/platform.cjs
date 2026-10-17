'use strict';

const path = require('node:path');
const os = require('node:os');
const {spawn, execFileSync} = require('node:child_process');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function storageDirectory({platform = process.platform, userHome = os.homedir(), appData, override} = {}) {
  if (override) return override;
  // Keep the legacy macOS path and keychain identity across the product rename.
  if (platform === 'darwin') return path.join(userHome, 'Library', 'Application Support', 'LocalHarness');
  if (platform === 'win32') return path.win32.join(appData || path.win32.join(userHome, 'AppData', 'Roaming'), 'ChatToHarness');
  return path.join(userHome, '.config', 'ChatToHarness');
}

function bundledPaths(resources, platform = process.platform) {
  const join = platform === 'win32' ? path.win32.join : path.join;
  return {
    node: platform === 'win32' ? join(resources, 'node', 'node.exe') : join(resources, 'node', 'bin', 'node'),
    tunnel: join(resources, 'tunnel', 'tunnel-client-runtime' + (platform === 'win32' ? '.exe' : '')),
    desktopCommander: join(resources, 'desktop-commander', 'node_modules', '@wonderwhy-er', 'desktop-commander', 'dist', 'index.js'),
    processHost: join(resources, 'managed-process', 'ChatToHarness.ProcessHost.exe'),
  };
}

function defaultShell(platform = process.platform, env = process.env) {
  return platform === 'win32'
    ? path.win32.join(env.SystemRoot || env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : '/bin/zsh';
}

function developmentEnvironment(source, nodePath, platform = process.platform) {
  const env = {...source};
  if (platform === 'win32') {
    const key = Object.keys(env).find(name => name.toLowerCase() === 'path') || 'PATH';
    const value = env[key] || '';
    for (const other of Object.keys(env)) if (other.toLowerCase() === 'path') delete env[other];
    env.PATH = [path.win32.dirname(nodePath), value].filter(Boolean).join(';');
    // Windows native tools use USERPROFILE. Keep it, and provide HOME for Git
    // only when the user's environment did not already select one.
    if (!env.HOME && env.USERPROFILE) env.HOME = env.USERPROFILE;
  } else {
    env.PATH = [path.dirname(nodePath), '/opt/homebrew/bin', '/usr/local/bin', env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'].join(':');
  }
  return env;
}

// Tunnel v0.0.16 uses its own platform-independent parseCommandArgv, then
// exec.Command(args...). This is its quoting grammar, NOT cmd.exe/PowerShell
// quoting. Double quotes and escaped backslashes retain Windows drive/UNC paths.
function tunnelArgument(value) {
  if (typeof value !== 'string' || !value || /[\r\n\0]/.test(value)) throw new Error('启动路径格式无效。');
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}
function tunnelCommand(values) { return values.map(tunnelArgument).join(' '); }

function spawnManaged(command, args, {platform = process.platform, processHost, ...options} = {}) {
  if (platform === 'win32') {
    if (!processHost) throw new Error('受管进程组件缺失，请重新安装应用。');
    const child = spawn(processHost, [String(process.pid), command, ...args], {...options, detached: false, windowsHide: true});
    child.chatToHarnessJob = true;
    return child;
  }
  return spawn(command, args, {...options, detached: true});
}

function descendants(pid) {
  try {
    const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], {encoding: 'utf8', timeout: 2000}).trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
    const found = new Set([pid]);
    for (let changed = true; changed;) {changed = false; for (const [id, parent] of rows) if (found.has(parent) && !found.has(id)) {found.add(id); changed = true;}}
    return [...found].reverse();
  } catch {return [pid];}
}

async function stopTree(child) {
  if (!child?.pid) return;
  if (child.localHarnessStopping) return child.localHarnessStopping;
  child.localHarnessStopping = stopOwned();
  return child.localHarnessStopping;
  async function stopOwned() {
    if (process.platform === 'win32' || child.chatToHarnessJob) {
      // Killing only this private helper closes its sole job handle. Windows
      // kills all descendants, including detached shells and grandchildren.
      if (child.exitCode === null && child.signalCode === null) {
        try {child.kill();} catch {}
        await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(3000)]);
      }
      return;
    }
    const owned = descendants(child.pid);
    for (const pid of owned) try {process.kill(pid, 'SIGTERM');} catch {}
    try {process.kill(-child.pid, 'SIGTERM');} catch {}
    const alive = pid => {try {process.kill(pid, 0); return true;} catch {return false;}};
    const deadline = Date.now() + 2800;
    while (Date.now() < deadline && owned.some(alive)) await pause(100);
    for (const pid of owned) if (alive(pid)) try {process.kill(pid, 'SIGKILL');} catch {}
    if (child.exitCode === null && child.signalCode === null) try {process.kill(-child.pid, 'SIGKILL');} catch {}
    if (child.exitCode === null && child.signalCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(500)]);
  }
}

module.exports = {storageDirectory, bundledPaths, defaultShell, developmentEnvironment, tunnelArgument, tunnelCommand, spawnManaged, stopTree};
