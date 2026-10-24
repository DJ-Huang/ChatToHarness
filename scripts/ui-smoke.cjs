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
const mcpStartFile = path.join(home, 'mcp-fixture-starts.txt');
const mcpFixtureName = 'synthetic-ui-mcp-name-not-a-real-key';
const mcpServerId = 'ui_fixture';
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
async function waitMcp(predicate, description) {
  let latest;
  for (let count = 0; count < 250; count++) {
    const state = await getState();
    latest = state.mcp?.servers.find(server => server.id === mcpServerId);
    if (predicate(latest)) return state;
    await delay(100);
  }
  throw new Error(`MCP fixture did not ${description}: ${latest?.phase || 'missing'} ${latest?.error || ''}`);
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
  if (await page.locator('#plugin-management-drawer').isVisible()) await page.locator('#plugin-management-close').click();
  await page.locator('#nav-' + name).click();
  assert.equal(await page.locator('#panel-' + name).isVisible(), true);
  assert.equal(await page.locator('#nav-' + name).getAttribute('aria-selected'), 'true');
  if (name === 'mcp' && await page.locator('#plugin-manage-' + mcpServerId).count()) await page.locator('#plugin-manage-' + mcpServerId).click();
  for (const other of ['overview', 'logs', 'history', 'connection', 'directories', 'mcp', 'help']) {
    if (other !== name) assert.equal(await page.locator('#panel-' + other).isVisible(), false);
  }
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function assertGone(pids) {
  for (let tries = 0; tries < 100 && pids.some(alive); tries++) await delay(100);
  assert.deepEqual(pids.filter(alive), [], 'all owned fixture processes must stop');
}
function noPlaintextSecret() {
  for (const file of [path.join(stateHome, 'settings.json'), path.join(stateHome, 'mcp-settings.json'), argsFile, path.join(stateHome, 'logs', 'app.log')]) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(text.includes(key), false, path.basename(file) + ' exposes synthetic key');
    assert.equal(text.includes(replacement), false, path.basename(file) + ' exposes replacement key');
    assert.equal(text.includes(mcpFixtureName), false, path.basename(file) + ' exposes MCP environment value');
  }
}

async function main() {
  if (['settings.json', 'mcp-settings.json'].some(file => fs.existsSync(path.join(stateHome, file)))) throw new Error('UI smoke requires a fresh isolated state directory; existing settings will not be touched');
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
  assert.equal(await page.locator('#nav-history').isVisible(),false,'fresh app starts with collapsed log navigation');

  // The homepage button opens the same read-only rolling log panel as the
  // sidebar. Verify it in a disposable Electron profile, never the live app.
  assert.equal(await page.locator('#overview-open-logs').isVisible(), true);
  await page.locator('#overview-open-logs').click();
  assert.equal(await page.locator('#panel-logs').isVisible(), true);
  await page.waitForFunction(() => document.querySelectorAll('#log-entries .live-log-line').length > 0);
  await page.locator('#log-filter-connection').click();
  assert.equal(await page.locator('#log-filter-connection').getAttribute('aria-pressed'), 'true');
  await page.locator('#log-search').fill('not-a-real-log-event');
  assert.ok((await page.locator('#log-entries').textContent()).includes('没有符合筛选条件'));
  await page.locator('#log-search').fill('');
  await page.locator('#log-pause').click();
  assert.equal(await page.locator('#log-pause').textContent(), '继续');
  await page.locator('#log-pause').click();
  await page.locator('#log-reload').click();
  await page.screenshot({path: path.join(output, 'console-live-logs.png'), fullPage: true});
  const logGroup=page.locator('#nav-log-group');
  const mainLog=page.locator('#nav-logs');
  const historyLog=page.locator('#nav-history');
  const logSubmenu=page.locator('#nav-log-submenu');
  assert.equal(await logGroup.getAttribute('data-expanded'),'false','menu starts collapsed');
  assert.equal(await mainLog.getAttribute('aria-expanded'),'false');
  assert.equal(await historyLog.isVisible(),false,'child is hidden by default');
  await mainLog.click();
  assert.equal(await logGroup.getAttribute('data-expanded'),'true');
  assert.equal(await mainLog.getAttribute('aria-expanded'),'true');
  assert.equal(await historyLog.isVisible(),true);
  await tab(page,'history');
  assert.equal(await logGroup.getAttribute('data-active'),'true');
  assert.equal(await mainLog.getAttribute('aria-selected'),'false');
  assert.equal(await historyLog.locator('svg').count(),1,'history retains its document icon');
  const parentBox=await mainLog.boundingBox(),childBox=await historyLog.boundingBox();
  assert.ok(parentBox&&childBox&&childBox.x>=parentBox.x+12,'history is indented under live logs');
  assert.ok(childBox.y>=parentBox.y+parentBox.height,'history follows live logs vertically');
  await page.screenshot({path:path.join(output,'console-log-navigation-expanded.png'),fullPage:true});
  await tab(page,'logs');
  assert.equal(await historyLog.isVisible(),false,'clicking parent collapses its child');
  assert.equal(await mainLog.getAttribute('aria-expanded'),'false');
  await page.screenshot({path:path.join(output,'console-log-navigation-collapsed.png'),fullPage:true});
  await mainLog.press('ArrowDown');
  assert.equal(await page.locator('#nav-connection').getAttribute('aria-selected'),'true','keyboard skips hidden submenu');
  await page.locator('#nav-connection').press('ArrowUp');
  assert.equal(await mainLog.getAttribute('aria-selected'),'true');
  await mainLog.press('ArrowRight');
  assert.equal(await historyLog.isVisible(),true,'right arrow expands submenu');
  await mainLog.press('ArrowDown');
  assert.equal(await historyLog.getAttribute('aria-selected'),'true');
  await historyLog.press('ArrowLeft');
  assert.equal(await historyLog.isVisible(),false,'left arrow collapses submenu');
  assert.equal(await mainLog.getAttribute('aria-selected'),'true');
  await page.locator('#panel-logs [data-navigate="history"]').click();
  assert.equal(await historyLog.isVisible(),true,'history shortcut expands submenu');
  await tab(page,'overview');
  assert.equal(await logSubmenu.isVisible(),false,'leaving log section collapses submenu');


  // All seven navigation entries select real, separate panels; keyboard navigation
  // follows the vertical tab pattern. No client branding leaks into the overview.
  await tab(page, 'help');
  assert.ok((await page.locator('#panel-help').textContent()).includes('ChatGPT'));
  assert.ok((await page.locator('#panel-help').textContent()).includes('Codex'));
  await page.locator('#nav-help').press('Home');
  assert.equal(await page.locator('#panel-overview').isVisible(), true);
  assert.equal(/ChatGPT|OpenAI|Mac|macOS|Windows/.test(await page.locator('#panel-overview').textContent()), false);

  // Manage a real MCP peer through the packaged app before configuring either
  // a workspace or a tunnel. The smoke runner's standalone Node executable is
  // intentional: Electron's process.execPath would launch another desktop app.
  await tab(page, 'mcp');
  await page.locator('#plugin-add-mcp').click();
  await page.locator('#mcp-add').click();
  await page.locator('#mcp-id').fill(mcpServerId);
  await page.locator('#mcp-name').fill('UI MCP fixture');
  await page.locator('#mcp-command').fill(process.execPath);
  await page.locator('#mcp-args').fill(JSON.stringify([path.join(root, 'tests', 'fixtures', 'mcp-server.cjs'), '--project-aware']));
  await page.locator('#mcp-env').fill(JSON.stringify({ MCP_FIXTURE_NAME: mcpFixtureName, MCP_FIXTURE_START_FILE: mcpStartFile }));
  await page.locator('#mcp-save').click();
  const mcpSaved = await waitMcp(server => Boolean(server), 'save its configuration');
  await page.locator('#mcp-editor').waitFor({ state: 'hidden' });
  const savedServer = mcpSaved.mcp.servers.find(server => server.id === mcpServerId);
  assert.equal(savedServer.enabled, false);
  assert.equal(savedServer.trusted, false);
  assert.deepEqual(savedServer.tools, []);
  assert.equal(fs.existsSync(mcpStartFile), false, 'saving an untrusted service never starts it');
  assert.equal(await page.locator('#mcp-env').inputValue(), '{}', 'submitted environment values are cleared from the editor');
  const mcpSettingsFile = path.join(stateHome, 'mcp-settings.json');
  const savedMcp = JSON.parse(fs.readFileSync(mcpSettingsFile, 'utf8')).servers.find(server => server.id === mcpServerId);
  assert.deepEqual(Object.keys(savedMcp.env.MCP_FIXTURE_NAME), ['secretRef']);
  assert.match(savedMcp.env.MCP_FIXTURE_NAME.secretRef, /^secret_[a-f0-9]{32}$/);
  assert.equal(JSON.stringify(mcpSaved).includes(mcpFixtureName), false, 'public state never returns the saved environment value');
  noPlaintextSecret();

  // Native Computer Use is an app-owned, per-device opt-in rather than an
  // imported third-party MCP server. GUI changes must survive a re-render.
  const nativeBefore=await getState();
  assert.equal(nativeBefore.mcp.computerUse.enabled,false);
  await tab(page, 'mcp');
  await page.locator('#plugin-management-close').click();
  await page.locator('#plugin-computer-use-manage').click();
  const computerToggle=page.locator('#mcp-computer-use');
  if(nativeBefore.mcp.computerUse.available){
    await computerToggle.check();
    await page.waitForFunction(() => {
      const modal=document.getElementById('mcp-computer-use-permission-dialog');
      const enabled=document.getElementById('mcp-computer-use-state').textContent.includes('已启用当前系统');
      return enabled || modal.open;
    });
    const checked=await getState();
    assert.equal(checked.mcp.servers.length,1,'Computer Use must not create an external MCP server');
    if(checked.mcp.computerUse.permissionPromptVisible){
      // TCC is identity-specific. An isolated app must fail closed and guide
      // users, not silently authorize the host or mutate their system grants.
      assert.equal(checked.mcp.computerUse.enabled,false);
      assert.equal((await page.locator('#mcp-computer-use-permission-dialog').isVisible()),true);
      assert.equal(JSON.parse(fs.readFileSync(path.join(stateHome,'preferences.json'),'utf8')).computerUseEnabled,false);
      await page.locator('#mcp-computer-use-permission-dismiss').click();
      await page.waitForFunction(()=>!document.getElementById('mcp-computer-use-permission-dialog').open);
    } else {
      assert.equal(checked.mcp.computerUse.enabled,true);
      assert.equal(JSON.parse(fs.readFileSync(path.join(stateHome,'preferences.json'),'utf8')).computerUseEnabled,true);
      await computerToggle.uncheck();
      await page.waitForFunction(() => document.getElementById('mcp-computer-use-state')
        .textContent.includes('已关闭'));
      assert.equal((await getState()).mcp.computerUse.enabled,false);
      assert.equal(JSON.parse(fs.readFileSync(path.join(stateHome,'preferences.json'),'utf8')).computerUseEnabled,false);
    }
  }

  await page.locator('#plugin-management-close').click();
  await tab(page, 'mcp');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  assert.equal(await page.locator('#mcp-trust').isVisible(), true);
  assert.ok((await page.locator('#mcp-trust-target').textContent()).includes(process.execPath));
  await page.locator('#mcp-trust-confirm').click();
  const mcpTested = await waitMcp(server => server?.trusted && server.tools.length > 0 && server.phase === 'stopped', 'finish its local connection test');
  const discoveredServer = mcpTested.mcp.servers.find(server => server.id === mcpServerId);
  assert.ok(discoveredServer.protocolVersion);
  assert.equal(discoveredServer.tools.every(tool => tool.policy === 'deny'), true, 'discovery never grants tool permissions');
  assert.equal(Number(fs.readFileSync(mcpStartFile, 'utf8')), 1);
  await page.waitForFunction(() => !document.getElementById('mcp-add').disabled);
  await page.locator('.mcp-tools > summary').click();
  await page.getByRole('combobox', { name: 'echo 的调用权限', exact: true }).selectOption('allow');
  await waitMcp(server => server?.tools.find(tool => tool.name === 'echo')?.policy === 'allow', 'save the explicit echo permission');
  await page.getByRole('button', { name: '启用', exact: true }).click();
  const mcpEnabled = await waitMcp(server => server?.enabled && server.phase === 'ready', 'connect without a workspace');
  assert.deepEqual(mcpEnabled.settings.directories, []);
  assert.equal(mcpEnabled.settings.keySaved, false);
  assert.equal(fs.existsSync(argsFile), false, 'standalone MCP management does not start the tunnel');
  assert.equal(Number(fs.readFileSync(mcpStartFile, 'utf8')), 2, 'testing stops its temporary peer before enabling a new connection');
  await page.screenshot({ path: path.join(output, 'console-mcp-connected.png'), fullPage: true });
  await page.getByRole('button', { name: '停用', exact: true }).click();
  await waitMcp(server => server?.enabled === false && server.phase === 'stopped', 'stop its standalone connection');
  const exportedMcp = JSON.parse(await page.evaluate(() => window.localHarness.mcpExport()));
  assert.equal(JSON.stringify(exportedMcp).includes(mcpFixtureName), false);
  assert.equal(Object.hasOwn(exportedMcp, 'trust'), false);
  assert.equal(Object.hasOwn(exportedMcp, 'grants'), false);
  noPlaintextSecret();

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
  for (const name of ['connection', 'directories', 'mcp', 'help']) {
    await tab(page, name);
    await page.screenshot({ path: path.join(output, 'console-' + name + '.png'), fullPage: true });
  }

  // Capture only this isolated test app's manager, without adding a production
  // IPC endpoint that could invoke arbitrary tools or grant permissions.
  await instance.evaluate(({app}) => {
    const localRequire = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    const {McpManager} = localRequire('./app/mcp-manager.cjs');
    const status = McpManager.prototype.status;
    McpManager.prototype.status = function () { globalThis.cthAcceptanceManager = this; McpManager.prototype.status = status; return status.call(this); };
  });
  await getState();
  const harness = await instance.evaluate(() => globalThis.cthAcceptanceManager.call('get_harness_status', {}));
  assert.equal(harness.isError, undefined); assert.match(harness.structuredContent.app.build.source_sha256, /^[a-f0-9]{64}$/);
  assert.equal(harness.structuredContent.app.build.mode, launchArgs.length ? 'development' : 'packaged');
  await tab(page, 'mcp'); await page.getByRole('button', {name: '启用', exact: true}).click();
  await waitMcp(server => server?.phase === 'ready', 'connect for remembered local approvals');
  if (!await page.locator('.mcp-tools').evaluate(element => element.open)) await page.locator('.mcp-tools > summary').click();
  await page.getByRole('combobox', {name: 'echo 的调用权限', exact: true}).selectOption('ask');
  await waitMcp(server => server?.tools.find(tool => tool.name === 'echo')?.policy === 'ask', 'request local approval');
  const startApproval = async () => {
    await instance.evaluate((_electron, value) => { globalThis.cthAcceptancePending = globalThis.cthAcceptanceManager.call(value.name, {project_path: value.project, value: 'synthetic approval'}); }, {name: mcpServerId + '__echo', project: fs.realpathSync(project)});
    await page.getByRole('combobox', {name: '本机授权范围', exact: true}).waitFor();
  };
  await startApproval();
  await page.getByRole('combobox', {name: '本机授权范围', exact: true}).selectOption('project');
  await page.screenshot({path: path.join(output, 'console-project-approval.png'), fullPage: true});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole('button', {name: '允许此次调用', exact: true}).click();
  assert.equal((await instance.evaluate(() => globalThis.cthAcceptancePending)).isError, undefined);
  const repeated = await instance.evaluate((_electron, value) => globalThis.cthAcceptanceManager.call(value.name, {project_path: value.project}), {name: mcpServerId + '__echo', project: fs.realpathSync(project)});
  assert.equal(repeated.isError, undefined); assert.equal((await getState()).mcp.approvals.length, 0);
  assert.equal((await getState()).mcp.allowAllTools, false);
  if (!await page.locator('.mcp-tools').evaluate(element => element.open)) await page.locator('.mcp-tools > summary').click();
  await page.getByRole('button', {name: '清除项目授权', exact: true}).click();
  await waitMcp(server => server?.tools.find(tool => tool.name === 'echo')?.projectGrants.length === 0, 'clear its project approval');
  await startApproval();
  await page.getByRole('combobox', {name: '本机授权范围', exact: true}).selectOption('tool');
  await page.getByRole('button', {name: '允许此次调用', exact: true}).click();
  assert.equal((await instance.evaluate(() => globalThis.cthAcceptancePending)).isError, undefined);
  await waitMcp(server => server?.tools.find(tool => tool.name === 'echo')?.savedPolicy === 'allow', 'remember its tool approval');
  await page.getByRole('button', {name: '停用', exact: true}).click();
  await waitMcp(server => server?.phase === 'stopped', 'stop the approval fixture');

  // Language changes are independent of credentials, workspace drafts, and runtime.
  const configBeforeLanguages = fs.readFileSync(path.join(stateHome, 'settings.json'), 'utf8');
  const mcpConfigBeforeLanguages = fs.readFileSync(mcpSettingsFile, 'utf8');
  const pidsBeforeLanguages = fs.readFileSync(pidFile, 'utf8');
  // Exercise update IPC without a real network request or installer. Checking
  // and preferences must leave both credentials and active tools unchanged.
  await instance.evaluate(({net,app})=>{
    net.fetch=async url=>{
      if(url!=='https://api.github.com/repos/DJ-Huang/ChatToHarness/releases/latest')throw new Error('Unexpected update request');
      // The mocked published release must stay stable even when smoke testing
      // a local prerelease installer. Use an older stable fixture version.
      const current=app.getVersion();
      const tag='v'+(current.includes('-')?'0.0.0':current);
      return new Response(JSON.stringify({tag_name:tag,draft:false,prerelease:false,published_at:'2026-10-17T00:00:00Z',html_url:'https://github.com/DJ-Huang/ChatToHarness/releases/tag/'+tag,assets:[]}),{status:200});
    };
  });
  await tab(page,'help');
  await page.locator('#check-update').click();
  await page.waitForFunction(()=>document.getElementById('update-status').textContent.includes('当前没有可用更新'));
  assert.equal((await getState()).updates.phase,'current');
  await page.locator('#auto-check-updates').uncheck();
  await page.waitForFunction(async()=>!(await window.localHarness.getState()).updates.automatic);
  await page.locator('#auto-check-updates').check();
  await page.waitForFunction(async()=>(await window.localHarness.getState()).updates.automatic);
  assert.equal(fs.readFileSync(path.join(stateHome,'settings.json'),'utf8'),configBeforeLanguages);
  assert.equal(fs.readFileSync(pidFile,'utf8'),pidsBeforeLanguages);
  for (const locale of ['en', 'ja', 'zh-CN']) {
    await page.locator('#language-select').selectOption(locale);
    await page.waitForFunction(lang => document.documentElement.lang === lang, locale);
    assert.equal((await getState()).system.locale, locale);
    assert.equal((await getState()).runtime.state, 'ready');
    const expected = {en:'Connection settings',ja:'接続設定','zh-CN':'连接配置'}[locale];
    assert.equal(await page.locator('#nav-connection').textContent(), expected);
    const menu = await instance.evaluate(({Menu}) => Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items.map(child => child.label) || []));
    assert.ok(menu.includes({en:'Open window',ja:'ウィンドウを開く','zh-CN':'打开窗口'}[locale]));
    for (const name of ['overview', 'connection', 'directories', 'mcp', 'help']) {
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
  assert.equal(fs.readFileSync(mcpSettingsFile, 'utf8'), mcpConfigBeforeLanguages, 'language switching preserves MCP configuration and permissions');
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
  assert.equal(Number(fs.readFileSync(mcpStartFile, 'utf8')), 3, 'disabled MCP service stays stopped across tunnel reconnects and app restart');
  await tab(page, 'mcp');
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await waitMcp(server => !server, 'remove its temporary configuration');
  assert.deepEqual(JSON.parse(fs.readFileSync(mcpSettingsFile, 'utf8')).secrets, {}, 'removing the fixture also removes its encrypted environment values');
  assert.deepEqual(errors, []);
  const report = { ui: true, platform: process.platform, architecture: process.arch, packaged: launchArgs.length === 0,
    realLocalTools: checked.runtime.toolsCount, languages:['zh-CN','en','ja'], languagePersistence:true, languagePreservesCredentialsAndConnection:true, navigation: true, unicodeSpaceDirectory: true, encryptedSaveAndReplace: true,
    restartAutoConnect: true, windowHide: true, singleInstance: true, ownedProcessCleanup: true,
    liveLogs: true, appMcpManagement: true, mcpWithoutWorkspace: true, mcpDefaultDeny: true, mcpEncryptedEnvironment: true,
    harnessBuildIdentity: true, localProjectApprovalRemembered: true, localProjectApprovalRevoked: true, localToolApprovalRemembered: true, globalAllowAllPreserved: true,
    authErrorAndRecovery: true, clearPreservesWorkspace: true, remoteTunnel: 'not tested: isolated fixture' };
  fs.writeFileSync(path.join(output, 'ui-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; })
  .finally(async () => { await close(); fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
