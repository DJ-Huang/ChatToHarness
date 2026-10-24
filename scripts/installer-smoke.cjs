'use strict';
// Native installer acceptance. Never opens the user's real configuration or keys.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const {outputDirectory}=require('./output-directory.cjs');
const outputRoot=outputDirectory(root);
const version = require('../package.json').version;
const isWindows = process.platform === 'win32';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ChatToHarness 安装验收 space '));
const output = path.resolve(process.env.CTH_SMOKE_OUTPUT || path.join(root, '.cache', 'acceptance', 'installer'));
// Windows acceptance must exercise the actual default data path because NSIS
// removes that path when deleteAppDataOnUninstall is enabled. Require the
// dedicated hosted-runner profile and refuse any preexisting application data.
const state = isWindows ? path.join(process.env.APPDATA || temporary, 'ChatToHarness') : path.join(temporary, 'user data');
let ownedState = false;
let mounted = false;
const mount = path.join(temporary, 'mounted');
const report = { platform: `${process.platform}-${process.arch}`, version, credentialMode: 'isolated fixtures', installer: false, startup: false, uninstallRetainsData: false };
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true, timeout: 240000, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} exited with ${result.status}`);
  return result;
}
function smoke(executable) {
  run(process.execPath, [path.join(root, 'scripts', 'ui-smoke.cjs')], {
    timeout: 240000,
    env: { ...process.env, CTH_EXECUTABLE: executable, LOCALHARNESS_HOME: state, CTH_SMOKE_OUTPUT: output }
  });
  report.startup = true;
}
function main() {
  require('./versions.cjs').forPlatform();
  if (isWindows && (process.env.CI !== 'true' || !process.env.APPDATA)) throw new Error('Windows installer acceptance requires a dedicated CI profile.');
  if (isWindows && fs.existsSync(state)) throw new Error('Refusing to replace preexisting application data during installer acceptance.');
  ownedState = true;
  fs.mkdirSync(output, { recursive: true });
  fs.mkdirSync(state, { recursive: true });
  const marker = path.join(state, 'uninstall-preservation.txt');
  fs.writeFileSync(marker, 'Installation and uninstallation must preserve existing user data.\n');
  if (isWindows) {
    const installer = path.join(outputRoot, `ChatToHarness-${version}-windows-x64-setup.exe`);
    const directory = path.join(temporary, '应用 installed');
    // NSIS requires /D last and unquoted, even when the path contains spaces.
    run(installer, ['/S', `/D=${directory}`], { windowsVerbatimArguments: true });
    const executable = path.join(directory, 'ChatToHarness.exe');
    if (!fs.existsSync(executable)) throw new Error('NSIS installation did not produce the requested executable');
    report.installer = true;
    smoke(executable);
    const uninstaller = fs.readdirSync(directory).find(name => /^Uninstall.*\.exe$/i.test(name));
    if (!uninstaller) throw new Error('NSIS uninstaller missing');
    // _?= keeps the uninstaller in the current process, making its completion
    // observable instead of racing a detached temporary uninstaller.
    run(path.join(directory, uninstaller), ['/S', `_?=${directory}`], { windowsVerbatimArguments: true });
    if (fs.existsSync(executable)) throw new Error('NSIS uninstallation left the application executable behind');
  } else {
    const image = path.join(outputRoot, `ChatToHarness-${version}-macos-arm64.dmg`);
    fs.mkdirSync(mount, { recursive: true });
    run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, image]);
    mounted = true;
    const app = path.join(temporary, '应用 installed', 'ChatToHarness.app');
    fs.mkdirSync(path.dirname(app), { recursive: true });
    run('/usr/bin/ditto', [path.join(mount, 'ChatToHarness.app'), app]);
    run('/usr/bin/hdiutil', ['detach', mount]); mounted = false;
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    report.installer = true;
    smoke(path.join(app, 'Contents', 'MacOS', 'ChatToHarness'));
    fs.rmSync(app, { recursive: true });
  }
  if (!fs.existsSync(path.join(state, 'settings.json'))) throw new Error('Application configuration was not preserved at the tested data location');
  if (!fs.existsSync(marker) || !fs.readFileSync(marker, 'utf8').startsWith('Installation')) throw new Error('User data was removed while uninstalling');
  report.uninstallRetainsData = true;
  console.log(JSON.stringify(report));
}
try { main(); } catch (error) { report.error = error.message; console.error(error.message); process.exitCode = 1; }
finally {
  if (mounted) spawnSync('/usr/bin/hdiutil', ['detach', mount, '-force'], { stdio: 'ignore' });
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'installer-result.json'), JSON.stringify(report, null, 2) + '\n');
  if (isWindows && ownedState) { try { fs.rmSync(state, { recursive: true, force: true, maxRetries: 4, retryDelay: 500 }); } catch {} }
  try { fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 4, retryDelay: 500 }); } catch {}
}
