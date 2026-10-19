'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { RuntimeManager } = require('../app/runtime.cjs');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function managerFor(t) {
  const manager = new RuntimeManager({
    home: path.join(os.tmpdir(), 'localharness-cancellation-unused'),
    paths: { node: process.execPath, tunnel: process.execPath, desktopCommander: __filename },
  });
  // These unit tests drive each transition directly and never launch a process.
  clearInterval(manager.timer);
  manager.stopProcess = async () => { manager.process = null; };
  t.after(() => manager.close());
  return manager;
}

const settings = { tunnelId: 'tunnel_' + 'a'.repeat(32), directories: [os.tmpdir()] };
const key = 'synthetic-cancellation-test-key';

for (const operation of ['connect', 'check']) {
  test(`${operation} completing preflight after Stop cannot restart or overwrite stopped state`, { timeout: 5000 }, async (t) => {
    const manager = managerFor(t);
    const started = deferred();
    const preflight = deferred();
    let launches = 0, monitors = 0;
    manager.probe = async () => { started.resolve(); return preflight.promise; };
    manager.launch = () => { launches++; };
    manager.monitor = async () => { monitors++; };
    if (operation === 'check') {
      manager.desired = { settings, key };
      manager.update({ state: 'ready' });
    }
    const pending = operation === 'connect' ? manager.connect(settings, key) : manager.check(settings);
    await started.promise;
    assert.equal(manager.status().state, 'checking');
    await manager.disconnect();
    const stopped = manager.status();
    assert.equal(stopped.state, 'stopped');
    preflight.resolve(25);
    await pending;
    assert.deepEqual(manager.status(), stopped);
    assert.equal(manager.desired, null);
    assert.equal(launches, 0);
    assert.equal(monitors, 0);
  });
}

for (const processError of ['network', 'key', 'permission']) {
  test(`a delayed ${processError} monitor cleanup cannot publish over a later Stop`, { timeout: 5000 }, async (t) => {
    const manager = managerFor(t);
    const stopping = deferred();
    const release = deferred();
    let stopCalls = 0;
    manager.stopProcess = async () => {
      manager.process = null;
      if (++stopCalls === 1) {
        stopping.resolve();
        await release.promise;
      }
    };
    manager.desired = { settings, key };
    manager.process = { exitCode: null, signalCode: null };
    manager.processError = processError;
    manager.update({ state: 'ready', localReady: true, toolsCount: 25 });
    const transitions = [];
    manager.on('state', state => transitions.push(state.state));
    const monitoring = manager.monitor();
    await stopping.promise;
    await manager.disconnect();
    const stopped = manager.status();
    assert.equal(stopped.state, 'stopped');
    const stopTransitionCount = transitions.length;
    release.resolve();
    await monitoring;
    assert.deepEqual(manager.status(), stopped);
    assert.equal(transitions.length, stopTransitionCount);
    assert.equal(manager.desired, null);
    assert.equal(manager.attempts, 0);
    assert.equal(manager.retryAt, 0);
    assert.equal(manager.monitorBusy, false);
    assert.equal(stopCalls, 2);
  });
}

test('a failed check awaiting cleanup cannot overwrite a later explicit Stop', { timeout: 5000 }, async (t) => {
  const manager = managerFor(t);
  const stopping = deferred();
  const release = deferred();
  let stopCalls = 0;
  manager.probe = async () => { throw new Error('synthetic preflight failure'); };
  manager.stopProcess = async () => {
    manager.process = null;
    if (++stopCalls === 1) {
      stopping.resolve();
      await release.promise;
    }
  };
  manager.desired = { settings, key };
  manager.update({ state: 'ready', localReady: true, toolsCount: 25 });
  const transitions = [];
  manager.on('state', state => transitions.push(state.state));
  const checking = manager.check(settings);
  await stopping.promise;
  await manager.disconnect();
  const stopped = manager.status();
  assert.equal(stopped.state, 'stopped');
  const stopTransitionCount = transitions.length;
  release.resolve();
  await checking;
  assert.deepEqual(manager.status(), stopped);
  assert.equal(transitions.length, stopTransitionCount);
  assert.equal(manager.desired, null);
  assert.equal(stopCalls, 2);
});

function desktopHarness(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'localharness-desktop-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const handlers = new Map();
  const image = () => ({ representations: [], resize() { return this; }, isEmpty() { return false; }, toDataURL() { return 'data:image/png;base64,Zml4dHVyZQ=='; }, addRepresentation(value) { this.representations.push(value); }, setTemplateImage(value) { this.template = value; } });
  class FakeTray extends EventEmitter {
    constructor(icon) { super(); this.icon = icon; this.destroyed = false; }
    setTitle(text) { this.title = text; }
    setToolTip(text) { this.tooltip = text; }
    popUpContextMenu(menu) { this.menu = menu; }
    destroy() { this.destroyed = true; }
  }
  const app = {
    quitCalls: 0, setName() {}, setPath() {}, getVersion() { return 'test'; },
    requestSingleInstanceLock() { return true; }, whenReady() { return new Promise(() => {}); },
    on(name, handler) { handlers.set(name, handler); }, quit() { this.quitCalls++; },
  };
  const electron = { app, Tray: FakeTray, Menu: { buildFromTemplate(items) { return items; } },
    nativeImage: { createEmpty: image, createFromBuffer: image },
    shell: { async openPath() { return ''; } }, ipcMain: {} };
  const mainPath = path.join(__dirname, '..', 'app', 'main.cjs');
  const context = { require(name) {
    if (name === 'electron') return electron;
    if (name === './settings.cjs' || name === './runtime.cjs') return {};
    if (['./platform.cjs','./help-links.cjs','./preferences.cjs','./i18n.js','./updater.cjs','./dev-lifecycle.cjs','./execution-history.cjs','./live-logs.cjs','./diagnostic-budget.cjs','./durable-files.cjs'].includes(name)) return require('../app/'+name.slice(2));
    return require(name);
  }, __dirname: path.dirname(mainPath), process: { platform: 'darwin', env: { LOCALHARNESS_HOME: home } }, Buffer, Promise, setTimeout };
  vm.runInNewContext(fs.readFileSync(mainPath, 'utf8') + `
    locale='zh-CN';
    globalThis.harness={action,connect,stopConnection,createTray,refreshTray,state,checkUpdate,installUpdate,setUpdater(value){updater=value;},
      set(s,r,w){settings=s;runtime=r;window=w;},getTray(){return tray;},getMenu(){return trayMenu;}};
  `, context);
  const harness = context.harness;
  const configuration = { public() { return { keySaved: true, tunnelId: settings.tunnelId, directories: [home], autoProjectContext: true }; }, getKey() { return key; } };
  const runtime = { current: 'checking', desired: { settings, key }, stops: 0, closes: 0,
    status() { return { state: this.current, error:this.error||'' }; },
    update(values) { if(values.state)this.current=values.state; if(values.error!==undefined)this.error=values.error; },
    async connect() {this.connects=(this.connects||0)+1;this.current='starting';},
    async disconnect() { this.stops++; this.current = 'stopped'; this.desired = null; },
    async close() { this.closes++; },
  };
  const window = { restores: 0, shows: 0, focuses: 0, isDestroyed() { return false; },
    isMinimized() { return true; }, restore() { this.restores++; }, show() { this.shows++; }, focus() { this.focuses++; },
    webContents: { send() {} },
  };
  harness.set(configuration, runtime, window);
  return { harness, app, handlers, runtime, window, configuration, electron };
}

test('desktop Stop cancels queued operations before their callbacks run', async (t) => {
  const { harness, runtime } = desktopHarness(t);
  const started = deferred(), release = deferred();
  let connects = 0;
  const active = harness.action(async () => { started.resolve(); await release.promise; });
  await started.promise;
  const queued = harness.action(() => { connects++; });
  // Attach the rejection handler before releasing the previous queue item.
  const cancelled = assert.rejects(queued, /操作已停止/);
  await harness.stopConnection();
  assert.equal(runtime.stops, 1);
  assert.equal(harness.state().actionEpoch, 1);
  release.resolve();
  await active;
  await cancelled;
  assert.equal(connects, 0);
  assert.equal(runtime.current, 'stopped');
});

test('PNG menu bar icon has Retina representations and separate left and right click behavior', async (t) => {
  const { harness, runtime, window } = desktopHarness(t);
  harness.createTray();
  const tray = harness.getTray();
  assert.equal(tray.title,'CTH');
  assert.equal(tray.icon.template, true);
  assert.deepEqual(Array.from(tray.icon.representations, entry => entry.scaleFactor), [1, 2]);
  for(const entry of tray.icon.representations){
    assert.match(entry.dataURL,/^data:image\/png;base64,/);
    assert.equal(entry.buffer,undefined,'Encoded PNGs must not be passed as raw pixel buffers');
  }
  tray.emit('click');
  assert.equal(window.restores, 1);
  assert.equal(window.shows, 1);
  assert.equal(window.focuses, 1);
  assert.equal(tray.menu, undefined);
  tray.emit('right-click');
  assert.ok(tray.menu.some(item => item.label === '查看日志'));
  assert.equal(tray.menu.find(item => item.label === '重新连接').enabled, false);
  const release = deferred();
  const queued = harness.action(() => release.promise);
  await Promise.resolve();
  tray.menu.find(item => item.label === '停止连接').click();
  assert.equal(runtime.stops, 1);
  assert.equal(tray.destroyed, false);
  for (const state of ['unconfigured', 'stopped', 'failed']) {
    runtime.current = state;
    harness.refreshTray();
    assert.ok(tray.tooltip.startsWith('ChatToHarness · '));
    assert.equal(tray.destroyed, false);
  }
  release.resolve();
  await queued;
});

test('Quit closes managed processes and removes the menu bar icon', async (t) => {
  const { harness, app, handlers, runtime } = desktopHarness(t);
  harness.createTray();
  const tray = harness.getTray();
  let prevented = false;
  handlers.get('before-quit')({ preventDefault() { prevented = true; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prevented, true);
  assert.equal(runtime.closes, 1);
  assert.equal(tray.destroyed, true);
  assert.equal(app.quitCalls, 1);
  await assert.rejects(harness.action(() => {}), /正在退出/);
});

test('development replacement waits for runtime cleanup and rejects queued reconnects',async(t)=>{
  const {harness,app,handlers,runtime}=desktopHarness(t);
  const cleanup=deferred();runtime.close=()=>{runtime.closes++;return cleanup.promise;};
  handlers.get('second-instance')({},[],'.',{localHarnessDevRestart:true});assert.equal(app.quitCalls,1);
  handlers.get('before-quit')({preventDefault(){}});
  await assert.rejects(harness.connect(),/正在退出/);assert.equal(runtime.closes,1);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(app.quitCalls,1,'old instance remains alive during cleanup');
  cleanup.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(app.quitCalls,2);
});

test('menu bar Stop prevents a renderer save response from continuing into Connect', async () => {
  const saving = deferred();
  const nodes = new Map();
  class Node {
    constructor() { this.listeners = {}; this.attributes = {}; this.value = ''; this.checked = true; this.children = []; this.dataset = {}; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    replaceChildren(...children) { this.children = children; }
    appendChild(child) { this.children.push(child); }
    append(...children) { this.children.push(...children); }
    focus() {}
  }
  const document = { body: {dataset:{}}, getElementById(id) { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); },
    createElement() { return new Node(); }, createElementNS() { return new Node(); }, querySelectorAll() { return []; } };
  let subscriber, connectCalls = 0;
  const state = { actionEpoch: 0, settings: { tunnelId: settings.tunnelId, keySaved: true, directories: ['/tmp/project'], autoProjectContext: true, autoConnect: true }, runtime: { state: 'stopped' } };
  const api = { getState: async () => state, onState(callback) { subscriber = callback; },
    saveSettings() { return saving.promise; }, async connect() { connectCalls++; return state; } };
  const context = { window: { localHarness: api, CTHI18n: {...require('../app/i18n.js'),documentTranslator:()=>()=>{}}, addEventListener() {} }, document, navigator:{language:'zh-CN'} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes.get('tunnel-id').value, settings.tunnelId);
  assert.equal(nodes.get('auto-project-context').checked, true);
  nodes.get('settings-form').listeners.submit({ preventDefault() {} });
  subscriber({ ...state, actionEpoch: 1 });
  saving.resolve(state);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(connectCalls, 0);
  assert.equal(nodes.get('api-key').value, '');
  assert.equal(nodes.get('action-message').textContent, '连接已停止。');
  assert.equal(nodes.get('directory-list').children[0].children[2].disabled, false);
});


test('credential authorization errors become a recoverable visible state', async (t) => {
  const {harness,runtime,configuration}=desktopHarness(t);
  configuration.getKey=()=>{throw new Error('系统安全存储当前不可用，请完成系统授权后重试。');};
  await assert.rejects(harness.connect(),/系统安全存储/);
  assert.equal(runtime.current,'failed');
  assert.match(harness.state().runtime.error,/系统授权/);
  assert.equal(runtime.connects,undefined);
});

test('Stop during the authorization presentation cancels key lookup and connection', async (t) => {
  const {harness,runtime,configuration}=desktopHarness(t);
  let reads=0;configuration.getKey=()=>{reads++;return key;};
  const connecting=harness.connect();
  const cancelled=assert.rejects(connecting,/操作已停止/);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(runtime.current,'authorizing');
  await harness.stopConnection();
  await cancelled;
  assert.equal(reads,0);
  assert.equal(runtime.connects,undefined);
  assert.equal(runtime.current,'stopped');
});

test('checking updates never reads credentials, stops tools, or reconnects', async t => {
  const {harness,runtime,configuration}=desktopHarness(t);let checked=0;
  configuration.getKey=()=>{throw new Error('must not read credentials');};
  harness.setUpdater({async check(){checked++;},status(){return {phase:'current'};}});
  const desired=runtime.desired;
  await harness.checkUpdate();assert.equal(checked,1);assert.equal(runtime.stops,0);assert.equal(runtime.desired,desired);
});

test('installer handoff stops tools before opening and keeps failed handoffs retryable', async t => {
  const {harness,runtime,electron,app}=desktopHarness(t),order=[];let phase='ready';
  harness.setUpdater({status(){return {phase};},async installer(){phase='installing';return '/temporary/verified-installer';},installFailed(){phase='ready';}});
  runtime.disconnect=async()=>{order.push('stop');runtime.current='stopped';};
  electron.shell.openPath=async()=>{order.push('open');return 'failed to open';};
  await harness.installUpdate();assert.deepEqual(order,['stop','open']);assert.equal(app.quitCalls,0);assert.equal(phase,'ready');assert.equal(runtime.closes,0);
  let resumed=false;await harness.action(()=>{resumed=true;});assert.equal(resumed,true);
  electron.shell.openPath=async()=>{order.push('open');return '';};
  await harness.installUpdate();assert.equal(app.quitCalls,1);
});
