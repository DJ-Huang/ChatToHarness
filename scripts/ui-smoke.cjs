'use strict';

// A native Electron window and real local MCP engine, with an isolated loopback
// fixture replacing the remote tunnel. Never uses a developer's saved credentials.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ChatToHarness UI 中文 space '));
const stateHome = process.env.LOCALHARNESS_HOME ? path.resolve(process.env.LOCALHARNESS_HOME) : path.join(home, 'isolated user data');
const project = path.join(home, '示例工程 project');
const modeFile = path.join(home, 'health-mode.json');
const pidFile = path.join(home, 'managed-pids.json');
const argsFile = path.join(home, 'tunnel-arguments.json');
const tunnelScript = path.join(home, 'tunnel fixture.cjs');
const output = path.resolve(process.env.CTH_SMOKE_OUTPUT || path.join(root, '.cache', 'acceptance'));
const development = process.argv.includes('--dev');
const explicitExecutable = process.env.CTH_EXECUTABLE || process.env.LOCALHARNESS_EXECUTABLE;
const executable = explicitExecutable || (development ? require('electron') : process.platform === 'win32'
  ? path.join(root, 'dist', 'win-unpacked', 'ChatToHarness.exe')
  : path.join(root, 'dist', 'mac-arm64', 'ChatToHarness.app', 'Contents', 'MacOS', 'ChatToHarness'));
const launchArgs = development && !explicitExecutable ? [root] : [];
const key = 'synthetic-ui-key-not-a-real-key';
const replacement = 'synthetic-ui-replacement-not-a-real-key';
const env = { ...process.env, LOCALHARNESS_HOME: stateHome,
  LOCALHARNESS_TEST_MODE: '1', LOCALHARNESS_TEST_LOCALE: 'zh-CN', LOCALHARNESS_TEST_TUNNEL_SCRIPT: tunnelScript };
if (!launchArgs.length) delete env.LOCALHARNESS_RESOURCES;
else env.LOCALHARNESS_RESOURCES = process.env.LOCALHARNESS_RESOURCES || path.join(root, 'resources');
delete env.ELECTRON_RUN_AS_NODE;
let instance;
const errors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getState() {
  return instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('window.localHarness.getState()'));
}
async function waitState(name) {
  for (let count = 0; count < 250; count++) {
    const state = await getState();
    if (state.runtime.state === name) return state;
    if (state.runtime.state === 'failed' && name !== 'failed') throw new Error(`Expected ${name}, got failure: ${state.runtime.error}`);
    await delay(100);
  }
  throw new Error('UI state did not become ' + name);
}
async function launch() {
  instance = await electron.launch({ executablePath: executable, args: launchArgs, env, timeout: 60000 });
  const page = await instance.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.initialized === 'true');
  assert.equal((await getState()).testMode, true, 'fixture must be explicitly enabled');
  return page;
}
async function close() {
  if (instance) {
    await instance.close();
    instance = null;
  }
}
async function tab(page, name) {
  await page.locator('#nav-' + name).click();
  assert.equal(await page.locator('#panel-' + name).isVisible(), true);
  assert.equal(await page.locator('#nav-' + name).getAttribute('aria-selected'), 'true');
  for (const other of ['overview', 'connection', 'directories', 'help']) {
    if (other !== name) assert.equal(await page.locator('#panel-' + other).isVisible(), false);
  }
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function assertGone(pids) {
  for (let tries = 0; tries < 100 && pids.some(alive); tries++) await delay(100);
  assert.deepEqual(pids.filter(alive), [], 'all owned fixture processes must stop');
}
function noPlaintextSecret() {
  for (const file of [path.join(stateHome, 'settings.json'), argsFile, path.join(stateHome, 'logs', 'app.log')]) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(text.includes(key), false, path.basename(file) + ' exposes synthetic key');
    assert.equal(text.includes(replacement), false, path.basename(file) + ' exposes replacement key');
  }
}

async function main() {
  if (fs.existsSync(path.join(stateHome, 'settings.json'))) throw new Error('UI smoke requires a fresh isolated state directory; existing settings will not be touched');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(stateHome, { recursive: true });
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(modeFile, JSON.stringify({ status: 'ok' }));
  const grandchildScript = path.join(home, 'grandchild.cjs');
  const childScript = path.join(home, 'child.cjs');
  fs.writeFileSync(grandchildScript, "setInterval(() => {}, 1000);\n");
  fs.writeFileSync(childScript, `const {spawn}=require('node:child_process');const child=spawn(process.execPath,[${JSON.stringify(grandchildScript)}],{stdio:'ignore',windowsHide:true});process.send({pid:child.pid});setInterval(()=>{},1000);\n`);
  fs.writeFileSync(tunnelScript, `
'use strict';
const fs=require('node:fs'),http=require('node:http'),{fork}=require('node:child_process');
const argv=process.argv.slice(2),file=argv[argv.indexOf('--health.url-file')+1];
fs.writeFileSync(${JSON.stringify(argsFile)},JSON.stringify(argv));
const child=fork(${JSON.stringify(childScript)},[],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
child.on('message',message=>fs.writeFileSync(${JSON.stringify(pidFile)},JSON.stringify([process.pid,child.pid,message.pid])));
const server=http.createServer((req,res)=>{const control=JSON.parse(fs.readFileSync(${JSON.stringify(modeFile)},'utf8'));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(req.url==='/readyz'?{status:'ok'}:{components:{'control-plane':control}}));});
server.listen(0,'127.0.0.1',()=>fs.writeFileSync(file,'http://127.0.0.1:'+server.address().port+'/'));
`);
  let page = await launch();
  const initial = await getState();
  assert.equal(initial.settings.autoProjectContext, true);
  assert.deepEqual(initial.settings.directories, []);
  assert.equal(await page.title(), 'ChatToHarness');
  await page.screenshot({ path: path.join(output, 'console-initial.png'), fullPage: true });

  // All four navigation entries select real, separate panels; keyboard navigation
  // follows the vertical tab pattern. No client branding leaks into the overview.
  await tab(page, 'help');
  assert.ok((await page.locator('#panel-help').textContent()).includes('ChatGPT'));
  assert.ok((await page.locator('#panel-help').textContent()).includes('Codex'));
  await page.locator('#nav-help').press('Home');
  assert.equal(await page.locator('#panel-overview').isVisible(), true);
  assert.equal(/ChatGPT|OpenAI|Mac|macOS|Windows/.test(await page.locator('#panel-overview').textContent()), false);

  // Exercise the actual IPC-backed folder picker using only a temporary directory.
  await instance.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, project);
  await tab(page, 'directories');
  await page.locator('#add-directory').click();
  await page.waitForFunction(() => document.querySelectorAll('.directory-item').length === 1);
  assert.equal(await page.locator('.directory-name').textContent(), '示例工程 project');
  await page.locator('#save-workspace').click();
  await page.waitForFunction(() => document.getElementById('action-message').textContent.includes('已保存'));
  assert.deepEqual((await getState()).settings.directories, [fs.realpathSync(project)]);
  await tab(page, 'overview');
  await page.locator('#check-connection').click();
  const checked = await waitState('stopped');
  assert.ok(checked.runtime.toolsCount > 0);
  assert.ok((await page.locator('#local-detail').textContent()).includes(String(checked.runtime.toolsCount)));

  await tab(page, 'connection');
  await page.locator('#tunnel-id').fill('tunnel_' + 'a'.repeat(32));
  await page.locator('#api-key').fill(key);
  await page.locator('#save-connect').click();
  const connected = await waitState('ready');
  assert.equal(connected.settings.keySaved, true);
  assert.equal(JSON.stringify(connected).includes(key), false);
  assert.equal(await page.locator('#api-key').inputValue(), '');
  assert.equal(await page.locator('#panel-overview').isVisible(), true);
  assert.ok((await page.locator('#client-detail').textContent()).includes('验证工具调用'));
  assert.equal(await page.locator('#step-client').getAttribute('class'), 'progress-step active');
  noPlaintextSecret();
  await page.screenshot({ path: path.join(output, 'console-overview.png'), fullPage: true });
  for (const name of ['connection', 'directories', 'help']) {
    await tab(page, name);
    await page.screenshot({ path: path.join(output, 'console-' + name + '.png'), fullPage: true });
  }

  // Language changes are independent of credentials, workspace drafts, and runtime.
  const configBeforeLanguages = fs.readFileSync(path.join(stateHome, 'settings.json'), 'utf8');
  const pidsBeforeLanguages = fs.readFileSync(pidFile, 'utf8');
  for (const locale of ['en', 'ja', 'zh-CN']) {
    await page.locator('#language-select').selectOption(locale);
    await page.waitForFunction(lang => document.documentElement.lang === lang, locale);
    assert.equal((await getState()).system.locale, locale);
    assert.equal((await getState()).runtime.state, 'ready');
    const expected = {en:'Connection settings',ja:'接続設定','zh-CN':'连接配置'}[locale];
    assert.equal(await page.locator('#nav-connection').textContent(), expected);
    const menu = await instance.evaluate(({Menu}) => Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items.map(child => child.label) || []));
    assert.ok(menu.includes({en:'Open window',ja:'ウィンドウを開く','zh-CN':'打开窗口'}[locale]));
    for (const name of ['overview', 'connection', 'directories', 'help']) {
      await tab(page, name);
      await page.screenshot({path:path.join(output, `console-${name}-${locale}.png`),fullPage:true});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (locale === 'en') {
        const visible = await page.locator('body').innerText();
        assert.equal(/[\u3400-\u9fff]/u.test(visible.replaceAll('简体中文','').replaceAll('日本語','').replaceAll('示例工程 project','').replaceAll('示例工程','').replaceAll('中文','')), false, 'English UI should not contain untranslated Chinese');
      }
    }
  }
  assert.equal(fs.readFileSync(path.join(stateHome, 'settings.json'), 'utf8'), configBeforeLanguages);
  assert.equal(fs.readFileSync(pidFile, 'utf8'), pidsBeforeLanguages, 'language switching must not restart managed processes');
  await tab(page, 'connection');
  await page.locator('#api-key').fill('unsaved-synthetic-draft');
  await page.locator('#language-select').selectOption('ja');
  await page.waitForFunction(() => document.documentElement.lang === 'ja');
  assert.equal(await page.locator('#api-key').inputValue(), 'unsaved-synthetic-draft');
  await page.locator('#api-key').fill('');
  await page.locator('#language-select').selectOption('zh-CN');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');

  // Window close hides, duplicate launch exits, and reopening restores the same window.
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  assert.equal(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  const second = spawn(executable, launchArgs, { env, stdio: 'ignore', windowsHide: true });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { second.kill(); reject(new Error('duplicate application did not exit')); }, 20000);
    second.once('error', error => { clearTimeout(timer); reject(error); });
    second.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('duplicate application exited with ' + code)); });
  });
  assert.equal(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  assert.equal(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);

  await tab(page, 'overview');
  const owned = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
  assert.equal(owned.length, 3);
  await page.locator('#stop').click();
  await waitState('stopped');
  await assertGone(owned);
  const ciphertextBefore = JSON.parse(fs.readFileSync(path.join(stateHome, 'settings.json'), 'utf8')).encryptedKey;
  await tab(page, 'connection');
  await page.locator('#api-key').fill(replacement);
  await page.locator('#save-connect').click();
  await waitState('ready');
  assert.equal(await page.locator('#api-key').inputValue(), '');
  assert.notEqual(JSON.parse(fs.readFileSync(path.join(stateHome, 'settings.json'), 'utf8')).encryptedKey, ciphertextBefore);
  noPlaintextSecret();

  await page.locator('#language-select').selectOption('ja');
  await page.waitForFunction(() => document.documentElement.lang === 'ja');
  const quittingPids = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
  await close();
  await assertGone(quittingPids);
  page = await launch();
  await waitState('ready');
  assert.equal((await getState()).system.locale, 'ja', 'language choice survives restart');
  await page.locator('#language-select').selectOption('zh-CN');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  assert.deepEqual((await getState()).settings.directories, [fs.realpathSync(project)]);

  // A local fixture produces a permission fault; no real endpoint is contacted.
  fs.writeFileSync(modeFile, JSON.stringify({ status: 'degraded', error: { status: 403, message: 'Forbidden' } }));
  await waitState('failed');
  assert.ok((await page.locator('#error-message').textContent()).includes('权限'));
  fs.writeFileSync(modeFile, JSON.stringify({ status: 'ok' }));
  await page.locator('#reconnect').click();
  await waitState('ready');
  await tab(page, 'connection');
  await page.locator('#clear-credentials').click();
  await page.waitForFunction(() => document.getElementById('tunnel-id').value === '');
  const cleared = await getState();
  assert.equal(cleared.settings.keySaved, false);
  assert.equal(cleared.settings.autoConnect, false);
  assert.deepEqual(cleared.settings.directories, [fs.realpathSync(project)]);
  noPlaintextSecret();
  assert.deepEqual(errors, []);
  const report = { ui: true, platform: process.platform, architecture: process.arch, packaged: launchArgs.length === 0,
    realLocalTools: checked.runtime.toolsCount, languages:['zh-CN','en','ja'], languagePersistence:true, languagePreservesCredentialsAndConnection:true, navigation: true, unicodeSpaceDirectory: true, encryptedSaveAndReplace: true,
    restartAutoConnect: true, windowHide: true, singleInstance: true, ownedProcessCleanup: true,
    authErrorAndRecovery: true, clearPreservesWorkspace: true, remoteTunnel: 'not tested: isolated fixture' };
  fs.writeFileSync(path.join(output, 'ui-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; })
  .finally(async () => { await close(); fs.rmSync(home, { recursive: true, force: true }); });
