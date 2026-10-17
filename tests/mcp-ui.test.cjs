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
    const args = method === 'mcpSetEnabled' ? ['server', true] : method === 'mcpSetAllowAllTools' ? [true] : method === 'mcpExport' ? [] : [{ test: method }];
    await exposed[method](...args);
    assert.deepEqual(calls.pop(), ['localharness:' + route, ...args]);
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

test('allow all tools shows saved permissions and restores individual controls when disabled', async () => {
  let state = initialState();
  const tool = { name: 'write', policy: 'deny', savedPolicy: 'deny' };
  state.mcp.servers = [{ id: 'example', name: 'Example', enabled: true, trusted: true, transport: 'stdio', command: 'server', tools: [tool] }];
  const toggles = [];
  const fixture = await rendererFixture(state, {
    async mcpSetAllowAllTools(enabled) {
      toggles.push(enabled);
      state = { ...state, mcp: { ...state.mcp, allowAllTools: enabled,
        servers: state.mcp.servers.map(server => ({ ...server, tools: [{ ...tool, policy: enabled ? 'allow' : 'deny' }] })) } };
      return state;
    },
  });
  const toggle = fixture.node('mcp-allow-all-tools');
  const policySelect = () => descendants(fixture.node('mcp-server-list')).find(node => node.tagName === 'SELECT');
  assert.equal(toggle.checked, false);
  assert.equal(policySelect().disabled, false);
  assert.equal(policySelect().value, 'deny');
  toggle.checked = true;
  await toggle.emit('change');
  assert.deepEqual(toggles, [true]);
  assert.equal(toggle.checked, true);
  assert.equal(policySelect().disabled, true);
  assert.equal(policySelect().value, 'deny', 'saved policy remains visible instead of the effective allow');
  assert.equal(policySelect().attributes['aria-label'], '关闭后 write 的调用权限');
  assert.match(fixture.node('mcp-policy-summary').textContent, /关闭此开关后生效/);
  toggle.checked = false;
  await toggle.emit('change');
  assert.deepEqual(toggles, [true, false]);
  assert.equal(toggle.checked, false);
  assert.equal(policySelect().disabled, false);
  assert.equal(policySelect().value, 'deny');
  assert.equal(policySelect().attributes['aria-label'], 'write 的调用权限');
  assert.equal(fixture.calls.length, 0, 'the switch does not rewrite individual tool grants');
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
