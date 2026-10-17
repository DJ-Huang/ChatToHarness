'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const i18n = require('../app/i18n.js');
const messages = require('../app/locales.js');

const source = name => fs.readFileSync(path.join(__dirname, '../app', name), 'utf8');
const html = source('index.html');
const renderer = source('renderer.js');
const methods = {
  mcpSaveServer: 'mcp-save-server', mcpRemoveServer: 'mcp-remove-server',
  mcpSetEnabled: 'mcp-set-enabled', mcpTrustServer: 'mcp-trust-server',
  mcpTestServer: 'mcp-test-server', mcpSetToolPolicy: 'mcp-set-tool-policy',
  mcpSetAllowAllTools: 'mcp-set-allow-all-tools',
  mcpPreviewImport: 'mcp-preview-import', mcpCommitImport: 'mcp-commit-import',
  mcpExport: 'mcp-export', mcpResolveApproval: 'mcp-resolve-approval',
};

// A deliberately small DOM contract fixture. It neither starts Electron nor
// interprets HTML, and fails if untrusted content is sent to an HTML sink.
function documentFixture() {
  const nodes = new Map();
  class Node {
    constructor(tagName = 'div') {
      this.tagName = tagName.toUpperCase(); this.listeners = new Map(); this.attributes = {};
      this.dataset = {}; this.value = ''; this.checked = false; this.hidden = false;
      this.disabled = false; this.children = []; this._text = '';
    }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set innerHTML(_value) { throw new Error('Untrusted content must not use innerHTML'); }
    set outerHTML(_value) { throw new Error('Untrusted content must not use outerHTML'); }
    insertAdjacentHTML() { throw new Error('Untrusted content must not use insertAdjacentHTML'); }
    addEventListener(name, callback) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(callback);
    }
    async emit(name) {
      for (const callback of this.listeners.get(name) || []) await callback({ target: this, preventDefault() {} });
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    appendChild(child) { this.children.push(child); return child; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this._text = ''; this.children = children; }
    focus() {}
  }
  for (const match of html.matchAll(/<([a-z][\w-]*)\b([^<>]*\bid="([^"]+)"[^<>]*)>/g)) {
    const node = new Node(match[1]);
    node.hidden = /(?:^|\s)hidden(?:\s|$)/.test(match[2]);
    node.checked = /(?:^|\s)checked(?:\s|$)/.test(match[2]);
    for (const attribute of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) {
      node.attributes[attribute[1]] = attribute[2];
      if (attribute[1].startsWith('data-')) node.dataset[attribute[1].slice(5)] = attribute[2];
      if (['value', 'type'].includes(attribute[1])) node[attribute[1]] = attribute[2];
    }
    nodes.set(match[3], node);
  }
  return {
    nodes, body: { dataset: {} },
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); },
    createElement(tag) { return new Node(tag); }, createElementNS(_ns, tag) { return new Node(tag); },
    querySelectorAll(selector) {
      if (/^\[data-[\w-]+\]$/.test(selector)) return [...nodes.values()].filter(node => Object.hasOwn(node.attributes, selector.slice(1, -1)));
      return [];
    },
  };
}
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }
function button(node, label) {
  const found = descendants(node).find(item => item.tagName === 'BUTTON' && item.textContent === label);
  assert.ok(found, `Missing button ${label}`); return found;
}
const initialState = () => ({
  actionEpoch: 0, settings: { tunnelId: '', keySaved: false, directories: [], autoConnect: true, autoProjectContext: true },
  runtime: { state: 'stopped' }, system: { platform: 'darwin', locale: 'zh-CN' }, mcp: { servers: [], approvals: [] },
});
const settled = () => new Promise(resolve => setImmediate(resolve));
async function rendererFixture(state = initialState(), overrides = {}) {
  const document = documentFixture();
  let subscriber;
  const calls = [];
  const api = { getState: async () => state, onState(callback) { subscriber = callback; return () => {}; } };
  for (const method of Object.keys(methods)) api[method] = async (...args) => { calls.push({ method, args }); return state; };
  Object.assign(api, overrides);
  vm.runInNewContext(renderer, {
    window: { localHarness: api, CTHI18n: { ...i18n, documentTranslator: () => () => {} }, addEventListener() {} },
    document, navigator: { language: 'zh-CN' },
  }, { filename: 'renderer.js' });
  await settled();
  return { document, calls, node: id => document.getElementById(id), update: value => subscriber(value), api };
}

test('MCP navigation is accessible and management inputs cannot submit tunnel settings', () => {
  const document = documentFixture();
  const nav = document.getElementById('nav-mcp');
  const panel = document.getElementById('panel-mcp');
  assert.equal(nav.attributes.role, 'tab');
  assert.equal(nav.attributes['aria-controls'], 'panel-mcp');
  assert.equal(panel.attributes.role, 'tabpanel');
  assert.equal(panel.attributes['aria-labelledby'], 'nav-mcp');
  assert.equal(panel.hidden, true);
  const allowAll = document.getElementById('mcp-allow-all-tools');
  assert.equal(allowAll.type, 'checkbox');
  assert.equal(allowAll.attributes.role, 'switch');
  assert.deepEqual(allowAll.attributes['aria-describedby'].split(/\s+/).sort(),
    ['mcp-allow-all-help', 'mcp-allow-all-status', 'mcp-client-permissions']);
  assert.match(html, /<label\b[^>]*\bfor="mcp-allow-all-tools"[^>]*>[^<]+<\/label>/);
  assert.match(html, /<section\b[^>]*\bid="panel-mcp"[^>]*>\s*<section\b[^>]*\bid="mcp-global-permissions"/,
    'global permissions are the first card in the MCP panel');
  assert.equal(document.getElementById('mcp-allow-all-status').attributes['aria-live'], 'polite');
  assert.ok(html.indexOf('id="panel-mcp"') > html.indexOf('</form>'), 'MCP editor is outside tunnel form');
  assert.ok(html.indexOf('id="mcp-approvals"') < html.indexOf('<form'), 'approvals remain visible outside every tab panel');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate UI identifiers');
  for (const match of html.matchAll(/\bfor="(mcp-[^"]+)"/g)) assert.ok(ids.includes(match[1]), `Missing label target ${match[1]}`);
  for (const match of html.matchAll(/<button\b[^>]*\bid="mcp-[^"]+"[^>]*>/g)) assert.match(match[0], /\btype="button"/);
});

test('renderer and restricted preload agree on MCP methods and exact IPC routes', async () => {
  let exposed;
  const calls = [];
  vm.runInNewContext(source('preload.cjs'), {
    require(name) {
      assert.equal(name, 'electron');
      return { contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'localHarness'); exposed = value; } },
        ipcRenderer: { async invoke(...args) { calls.push(args); return {}; } } };
    },
  });
  assert.ok(Object.isFrozen(exposed));
  const referenced = [...new Set([...renderer.matchAll(/\bapi\.(mcp\w+)/g)].map(match => match[1]))].sort();
  assert.deepEqual(referenced, Object.keys(methods).sort());
  assert.deepEqual(Object.keys(exposed).filter(name => name.startsWith('mcp')).sort(), referenced);
  for (const [method, route] of Object.entries(methods)) {
    const cases = method === 'mcpSetAllowAllTools' ? [[true], [false]]
      : [method === 'mcpSetEnabled' ? ['server', true] : method === 'mcpExport' ? [] : [{ test: method }]];
    for (const args of cases) {
      await exposed[method](...args);
      assert.deepEqual(calls.pop(), ['localharness:' + route, ...args]);
    }
  }
  assert.equal(exposed.invoke, undefined);
  assert.equal(exposed.ipcRenderer, undefined);
  assert.doesNotMatch(renderer, /\b(?:require\s*\(|fetch\s*\(|WebSocket|XMLHttpRequest|ipcRenderer|insertAdjacentHTML|innerHTML|outerHTML)\b/);
  assert.match(html, /connect-src 'none'/);
});

test('a newly saved MCP service is disabled and saving does not connect or trust it', async () => {
  const fixture = await rendererFixture();
  await fixture.node('mcp-add').emit('click');
  fixture.node('mcp-id').value = 'example'; fixture.node('mcp-name').value = 'Example';
  fixture.node('mcp-command').value = 'example-server';
  await fixture.node('mcp-save').emit('click');
  assert.deepEqual(fixture.calls.map(call => call.method), ['mcpSaveServer']);
  const config = fixture.calls[0].args[0];
  assert.equal(config.enabled, false); assert.equal(config.transport, 'stdio');
  assert.equal(config.timeoutMs, 60000); assert.deepEqual(Array.from(config.args), []);
  assert.equal(fixture.node('mcp-editor').hidden, true);
  assert.equal(fixture.node('mcp-env').value, '{}'); assert.equal(fixture.node('mcp-headers').value, '{}');
});

test('import requires a current preview, commits only its draft ID, and never enables services', async () => {
  const calls = [];
  const state = initialState();
  const imported = { id: 'imported', name: 'Imported', enabled: false, transport: 'stdio', command: 'untrusted-command', args: [] };
  const fixture = await rendererFixture(state, {
    async mcpPreviewImport(text) { calls.push(['preview', text]); return { draftId: 'reviewed-draft', servers: [imported], missingSecrets: [] }; },
    async mcpCommitImport(id) { calls.push(['commit', id]); return { ...state, mcp: { servers: [imported], approvals: [] } }; },
  });
  await fixture.node('mcp-import-confirm').emit('click'); assert.equal(calls.length, 0);
  fixture.node('mcp-import-text').value = '{"mcpServers":{"example":{}}}';
  await fixture.node('mcp-import-text').emit('input');
  await fixture.node('mcp-import-preview').emit('click');
  assert.equal(calls.length, 1); assert.equal(fixture.node('mcp-import-preview-panel').hidden, false);
  assert.match(fixture.node('mcp-import-summary').textContent, /untrusted-command/);
  fixture.node('mcp-import-text').value = '{"mcpServers":{"changed":{}}}';
  await fixture.node('mcp-import-text').emit('input');
  await fixture.node('mcp-import-confirm').emit('click'); assert.equal(calls.length, 1, 'edited imports invalidate the reviewed draft');
  await fixture.node('mcp-import-preview').emit('click'); await fixture.node('mcp-import-confirm').emit('click');
  await settled();
  assert.deepEqual(calls.at(-1), ['commit', 'reviewed-draft']);
  assert.equal(fixture.node('mcp-import-preview-panel').hidden, true);
  assert.equal(fixture.node('mcp-import-text').value, '');
  assert.equal(fixture.calls.length, 0, 'import does not call trust, enable, test or tool authorization');
});

test('untrusted services show the effective platform target before trust and connection', async () => {
  const state = initialState();
  const server = { id: 'example', name: 'Example', enabled: false, trusted: false, transport: 'stdio',
    command: 'base-command', args: ['base'], platforms: { darwin: { command: '/native/server', args: ['native'] } } };
  state.mcp.servers = [server];
  const fixture = await rendererFixture(state);
  await button(fixture.node('mcp-server-list'), '启用').emit('click');
  assert.equal(fixture.calls.length, 0); assert.equal(fixture.node('mcp-trust').hidden, false);
  assert.match(fixture.node('mcp-trust-target').textContent, /\/native\/server/);
  assert.match(fixture.node('mcp-trust-target').textContent, /native/);
  assert.doesNotMatch(fixture.node('mcp-trust-target').textContent, /base-command/);
  await fixture.node('mcp-trust-confirm').emit('click');
  await settled();
  assert.deepEqual(fixture.calls.map(call => call.method), ['mcpTrustServer', 'mcpSetEnabled']);
  assert.equal(fixture.calls[1].args[1], true);
});

test('approval content is plain text and stays actionable on other pages during a connection operation', async () => {
  const state = initialState();
  const untrustedText = '<img src=x onerror="execute()">';
  state.mcp.servers = [{ id: 'example', name: untrustedText, enabled: true, trusted: true, transport: 'stdio', command: 'server', tools: [] }];
  state.mcp.approvals = [{ id: 'approval-one', serverId: 'example', serverName: untrustedText, toolName: 'echo', arguments: { text: untrustedText }, expiresAt: Date.now() + 60000 }];
  let finishTest;
  const resolutions = [];
  const fixture = await rendererFixture(state, {
    mcpTestServer() { return new Promise(resolve => { finishTest = () => resolve(state); }); },
    async mcpResolveApproval(input) { resolutions.push(input); return { ...state, mcp: { ...state.mcp, approvals: [] } }; },
  });
  const connecting = button(fixture.node('mcp-server-list'), '测试连接').emit('click');
  await fixture.node('nav-help').emit('click');
  assert.equal(fixture.node('panel-mcp').hidden, true); assert.equal(fixture.node('mcp-approvals').hidden, false);
  const list = fixture.node('mcp-approval-list');
  assert.match(list.textContent, /<img src=x onerror="execute\(\)">/);
  const allow = button(list, '允许此次调用'); assert.equal(allow.disabled, false);
  await allow.emit('click');
  assert.equal(resolutions.length, 1);
  assert.deepEqual(Object.keys(resolutions[0]).sort(), ['allow', 'id']);
  assert.equal(resolutions[0].id, 'approval-one'); assert.equal(resolutions[0].allow, true);
  assert.equal(fixture.node('mcp-approvals').hidden, true);
  finishTest(); await connecting;
});

test('all MCP error messages have Chinese, English and Japanese translations with matching placeholders', () => {
  const errors = renderer.match(/const mcpErrors = \{([\s\S]*?)\n  \};/);
  assert.ok(errors);
  const keys = [...new Set([...errors[1].matchAll(/:\s*'([^']+)'/g)].map(match => match[1]))];
  assert.ok(keys.length > 25, 'MCP errors have specific user-facing messages');
  keys.push('MCP 操作未完成，请检查配置后重试。');
  for (const key of keys) {
    assert.ok(Object.hasOwn(messages, key), key); assert.equal(i18n.translate('zh-CN', key), key);
    const placeholders = text => [...text.matchAll(/\{\w+\}/g)].map(match => match[0]).sort();
    for (const locale of ['en', 'ja']) {
      const translated = i18n.translate(locale, key);
      assert.notEqual(translated, key, `${locale}: ${key}`);
      assert.deepEqual(placeholders(translated), placeholders(key));
      if (locale === 'en') assert.doesNotMatch(translated, /[\u3400-\u9fff]/u);
    }
  }
});

test('global MCP permissions load persisted state without authorizing tools and have localized guidance', async () => {
  const guidance = new Set(['允许所有工具']);
  const help = html.match(/<p\b[^>]*\bid="mcp-allow-all-help"[^>]*>([^<]+)<\/p>/);
  assert.ok(help, 'global permission scope has visible help');
  guidance.add(help[1]);
  const clientHelp = html.match(/<p\b[^>]*\bid="mcp-client-permissions"[^>]*>([^<]+)<\/p>/);
  assert.ok(clientHelp, 'client approval guidance remains visible in either permission mode');
  assert.match(clientHelp[1], /ChatGPT.*始终允许.*本次对话/);
  guidance.add(clientHelp[1]);
  for (const saved of [undefined, false, true]) {
    const state = initialState();
    if (saved !== undefined) state.mcp.allowAllTools = saved;
    const fixture = await rendererFixture(state);
    const toggle = fixture.node('mcp-allow-all-tools');
    assert.equal(toggle.checked, saved === true, 'initial value comes from saved backend state');
    assert.equal(toggle.disabled, false);
    assert.deepEqual(fixture.calls, [], 'initial rendering must not change permissions');
    for (const id of ['mcp-allow-all-status', 'mcp-per-tool-help']) {
      const text = fixture.node(id).textContent.trim();
      assert.ok(text, id + ' describes the current permission mode');
      guidance.add(text);
    }
    guidance.add(fixture.node('mcp-server-list').textContent.trim());
    fixture.update({ ...state, mcp: { ...state.mcp, allowAllTools: saved !== true } });
    assert.equal(toggle.checked, saved !== true, 'backend state notifications update the switch');
    assert.deepEqual(fixture.calls, [], 'state notifications must not change permissions');
  }
  const placeholders = text => [...text.matchAll(/\{\w+\}/g)].map(match => match[0]).sort();
  for (const key of guidance) {
    assert.ok(Object.hasOwn(messages, key), 'Missing permission translation: ' + key);
    assert.equal(i18n.translate('zh-CN', key), key);
    for (const locale of ['en', 'ja']) {
      const translated = i18n.translate(locale, key);
      assert.notEqual(translated, key, locale + ': ' + key);
      assert.deepEqual(placeholders(translated), placeholders(key));
      if (locale === 'en') assert.doesNotMatch(translated, /[\u3400-\u9fff]/u);
    }
  }
});

test('global MCP permission changes pass booleans and restore individual tool policies when disabled', async () => {
  const savedPolicies = ['deny', 'ask', 'allow'];
  const stateFor = allowAllTools => ({
    ...initialState(),
    mcp: {
      allowAllTools, approvals: [],
      servers: [{
        id: 'example', name: 'Example', enabled: true, trusted: true,
        transport: 'stdio', command: 'example-server', phase: 'connected',
        tools: savedPolicies.map((savedPolicy, index) => ({
          name: 'tool_' + index, savedPolicy,
          policy: allowAllTools ? 'allow' : savedPolicy,
          inputSchema: { type: 'object' },
        })),
      }],
    },
  });
  const permissionCalls = [];
  const fixture = await rendererFixture(stateFor(false), {
    async mcpSetAllowAllTools(...args) {
      permissionCalls.push(args);
      return stateFor(args[0]);
    },
  });
  const selections = () => descendants(fixture.node('mcp-server-list')).filter(node => node.tagName === 'SELECT');
  const toolsDetails = () => descendants(fixture.node('mcp-server-list')).find(node => node.tagName === 'DETAILS' && node.className === 'mcp-tools');
  const assertPolicies = enabled => {
    const controls = selections();
    assert.equal(controls.length, savedPolicies.length);
    assert.deepEqual(controls.map(node => node.value), enabled ? ['allow', 'allow', 'allow'] : savedPolicies);
    assert.deepEqual(controls.map(node => node.disabled), savedPolicies.map(() => enabled));
  };
  const toggle = fixture.node('mcp-allow-all-tools');
  const individualHelp = fixture.node('mcp-per-tool-help').textContent;
  const individualStatus = fixture.node('mcp-allow-all-status').textContent;
  assertPolicies(false);
  toolsDetails().open = true; // A native toggle event may still be queued when permissions change.
  toggle.checked = true;
  await toggle.emit('change');
  await settled();
  assert.equal(toggle.checked, true);
  assert.equal(toggle.disabled, false);
  assertPolicies(true);
  assert.equal(toolsDetails().open, true, 'saving permissions preserves an expanded tool list without waiting for toggle events');
  assert.notEqual(fixture.node('mcp-per-tool-help').textContent, individualHelp);
  assert.notEqual(fixture.node('mcp-allow-all-status').textContent, individualStatus);
  toggle.checked = false;
  await toggle.emit('change');
  await settled();
  assert.equal(toggle.checked, false);
  assertPolicies(false);
  assert.equal(toolsDetails().open, true, 'restoring individual permissions preserves the expanded tool list');
  assert.equal(fixture.node('mcp-per-tool-help').textContent, individualHelp);
  assert.equal(fixture.node('mcp-allow-all-status').textContent, individualStatus);
  assert.deepEqual(permissionCalls, [[true], [false]], 'both changes send exactly one boolean');
  assert.deepEqual(fixture.calls, [], 'global changes do not overwrite saved per-tool policies');
});

test('global MCP permission saves prevent duplicate requests and restore saved state after failure', async () => {
  for (const saved of [false, true]) {
    const state = initialState();
    state.mcp.allowAllTools = saved;
    const permissionCalls = [];
    let rejectSave;
    const fixture = await rendererFixture(state, {
      mcpSetAllowAllTools(...args) {
        permissionCalls.push(args);
        return new Promise((_resolve, reject) => { rejectSave = reject; });
      },
    });
    const toggle = fixture.node('mcp-allow-all-tools');
    toggle.checked = !saved;
    const saving = toggle.emit('change');
    assert.equal(toggle.disabled, true, 'the switch is disabled while saving');
    assert.equal(toggle.checked, !saved, 'the requested value remains visible while saving');
    assert.deepEqual(permissionCalls, [[!saved]]);
    toggle.checked = saved;
    await toggle.emit('change');
    assert.deepEqual(permissionCalls, [[!saved]], 'a repeated change cannot start a concurrent save');
    assert.equal(toggle.checked, !saved, 'a repeated event cannot replace the pending choice');
    rejectSave(new Error('WRITE_FAILED'));
    await saving;
    await settled();
    assert.equal(toggle.checked, saved, 'a failed save restores the backend value');
    assert.equal(toggle.disabled, false, 'failure leaves the switch available for retry');
    fixture.api.mcpSetAllowAllTools = async (...args) => {
      permissionCalls.push(args);
      return { ...state, mcp: { ...state.mcp, allowAllTools: args[0] } };
    };
    toggle.checked = !saved;
    await toggle.emit('change');
    await settled();
    assert.deepEqual(permissionCalls, [[!saved], [!saved]]);
    assert.equal(toggle.checked, !saved, 'retry applies the successfully saved state');
    assert.equal(toggle.disabled, false);
    assert.deepEqual(fixture.calls, []);
  }
});
