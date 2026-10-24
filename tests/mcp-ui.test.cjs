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
  mcpSetComputerUse: 'mcp-set-computer-use',
  mcpComputerUsePermissions: 'mcp-computer-use-permissions',
  mcpComputerUseDismissPermissions: 'mcp-computer-use-dismiss-permissions',
  mcpComputerUseOpenPermissionSettings: 'mcp-computer-use-open-permission-settings',
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
    async emit(name, event = {}) {
      for (const callback of this.listeners.get(name) || []) await callback({ target: this, preventDefault() {}, ...event });
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
      if (attribute[1].startsWith('data-')) node.dataset[attribute[1].slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())] = attribute[2];
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
  runtime: { state: 'stopped' }, system: { platform: 'darwin', locale: 'zh-CN' }, mcp: { servers: [], approvals: [], computerUse: { enabled: false, available: true, platform: 'darwin' } },
});
const settled = () => new Promise(resolve => setImmediate(resolve));
async function rendererFixture(state = initialState(), overrides = {}, clipboard) {
  const document = documentFixture();
  let subscriber;
  const calls = [];
  const api = { getState: async () => state, onState(callback) { subscriber = callback; return () => {}; } };
  for (const method of Object.keys(methods)) api[method] = async (...args) => { calls.push({ method, args }); return state; };
  Object.assign(api, overrides);
  vm.runInNewContext(renderer, {
    window: { localHarness: api, CTHI18n: { ...i18n, documentTranslator: () => () => {} }, addEventListener() {} },
    document, navigator: { language: 'zh-CN', clipboard },
  }, { filename: 'renderer.js' });
  await settled();
  return { document, calls, node: id => document.getElementById(id), update: value => subscriber(value), api };
}

test('a healthy tunnel still shows degraded tool health and clears after recovery', async () => {
  const state=initialState();
  state.runtime={state:'ready',localReady:true,toolsCount:12,tools_health:'degraded',tools_ready:false,
    missing_capabilities:[{service_id:'builtin',capability:'tools',phase:'failed',code:'MCP_MODULE_NOT_FOUND'}]};
  const f=await rendererFixture(state);
  assert.equal(f.node('status-label').textContent,'部分工具不可用');
  assert.equal(f.node('local-detail').textContent,'部分工具不可用');
  assert.equal(f.node('tunnel-detail').textContent,'通道已就绪');
  assert.equal(f.node('error-banner').hidden,false);
  f.update({...state,runtime:{...state.runtime,tools_health:'ready',tools_ready:true,missing_capabilities:[]}});
  assert.equal(f.node('error-banner').hidden,true);
  assert.notEqual(f.node('status-label').textContent,'部分工具不可用');
});

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
    const args = method === 'mcpSetEnabled' ? ['server', true] : ['mcpSetAllowAllTools','mcpSetComputerUse'].includes(method) ? [true] : ['mcpExport','mcpComputerUseDismissPermissions'].includes(method) ? [] : [{ test: method }];
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

test('recovery copy uses bounded metadata and all result states have translations',async()=>{
  const {recoveryInfo}=require('../app/tool-recovery.cjs'),copied=[];
  const record={request_id:'exec_fixture',project:'/project',tool:'start_task',task_id:'task_fixture',state:'running',received_at:'2026-01-01T00:00:00Z',result_status:'available'};
  const detail={...record,stdout:'private body',recovery:recoveryInfo(record)};
  const f=await rendererFixture(initialState(),{executionList:async()=>({records:[record],total:1,usage:0,diagnostics:{}}),executionDetail:async()=>detail},{writeText:async text=>copied.push(text)});
  await f.node('nav-history').emit('click');await settled();
  await f.node('history-rows').children[0].children[2].children[0].emit('click');
  assert.equal(f.node('history-result-status').textContent,'结果已保存，可恢复');
  await f.node('history-recovery').emit('click');assert.equal(copied.length,1);
  assert.equal(JSON.parse(copied[0]).next_arguments.task_id,record.task_id);assert.doesNotMatch(copied[0],/private body/);
  for(const key of ['复制恢复信息','结果已保存，可恢复','保存的结果已过期','此记录未保存结果','结果保存失败，请先核对任务与产物','保存的结果暂不可用'])
    for(const locale of ['en','ja'])assert.notEqual(i18n.translate(locale,key),key);
});
test('execution page loads only on navigation, paginates and renders hostile records as text',async()=>{
  const calls=[];const record={request_id:'exec_'+ 'a'.repeat(36),received_at:'2026-01-01T00:00:00Z',tool:'<img onerror=alert(1)>',operation:'<script>private</script>',service:'test',state:'succeeded',duration_ms:3};
  const f=await rendererFixture(initialState(),{executionList:async query=>{calls.push(query);return {records:[record],total:80,usage:1024,diagnostics:{enabled:false}};},executionDetail:async()=>({...record,error_summary:'<script>detail</script>'})});
  assert.equal(calls.length,0);await f.node('nav-history').emit('click');await settled();assert.equal(calls.length,1);assert.equal(calls[0].limit,50);
  const rows=f.node('history-rows');assert.equal(rows.children.length,1);assert.match(rows.textContent,/<img onerror/);
  await rows.children[0].children[2].children[0].emit('click');assert.match(f.node('history-detail-text').textContent,/<script>detail/);
  await f.node('history-next').emit('click');await settled();assert.equal(calls.at(-1).offset,50);
  await f.node('history-errors').emit('click');await settled();assert.equal(calls.at(-1).tab,'errors');assert.equal(calls.at(-1).offset,0);
  for(const [method,channel]of Object.entries({executionList:'execution-list',executionDetail:'execution-detail',executionExport:'execution-export',executionDiagnostics:'execution-diagnostics'})){assert.ok(source('preload.cjs').includes(method));assert.ok(source('main.cjs').includes("bind('"+channel+"'"));}
});


test('home and sidebar open a live log page; filtering, pause, search and clear never interpret log text as HTML',async()=>{
  const entries=[
    {id:'1:1',at:'2026-10-18T08:00:00Z',event:'execution',category:'tool',severity:'error',message:'<img src=x onerror=alert(1)> · failed'},
    {id:'1:2',at:'2026-10-18T08:00:01Z',event:'runtime',category:'connection',severity:'info',message:'Tunnel ready'},
  ];
  const calls=[];
  const f=await rendererFixture(initialState(),{readLiveLogs:async query=>{
    calls.push(query);return {entries:calls.length===1?entries:[],cursor:{file:'app.log',identity:'123',offset:80},reset:false,more:false};
  }});
  assert.deepEqual(f.node('nav-logs').attributes['aria-controls'].split(' '),['panel-logs','nav-log-submenu']);
  assert.equal(f.node('overview-open-logs').dataset.navigate,'logs');
  assert.equal(calls.length,0,'reading logs must be lazy');
  await f.node('overview-open-logs').emit('click');await settled();
  assert.equal(f.node('panel-logs').hidden,false);
  assert.equal(calls.length,1);
  assert.equal(calls[0].cursor,null);
  assert.equal(f.node('log-entries').children.length,2);
  assert.match(f.node('log-entries').textContent,/<img src=x/);

  await f.node('log-filter-error').emit('click');
  assert.equal(f.node('log-entries').children.length,1);
  assert.match(f.node('log-entries').textContent,/failed/);
  assert.doesNotMatch(f.node('log-entries').textContent,/Tunnel ready/);
  await f.node('log-filter-connection').emit('click');
  assert.match(f.node('log-entries').textContent,/Tunnel ready/);
  assert.doesNotMatch(f.node('log-entries').textContent,/failed/);

  f.node('log-search').value='not present';await f.node('log-search').emit('input');
  assert.match(f.node('log-entries').textContent,/没有符合筛选条件/);
  f.node('log-search').value='';await f.node('log-search').emit('input');
  await f.node('log-pause').emit('click');
  assert.equal(f.node('log-pause').textContent,'继续');
  await f.node('log-pause').emit('click');await settled();
  assert.equal(calls.length,2,'resuming catches up with a cursor');
  assert.deepEqual(calls[1].cursor,{file:'app.log',identity:'123',offset:80});
  await f.node('log-clear').emit('click');
  assert.match(f.node('log-entries').textContent,/等待新日志/);
  await f.node('log-reload').emit('click');await settled();
  assert.equal(calls.at(-1).cursor,null,'reload reads the bounded tail again');
  assert.ok(source('main.cjs').includes("bind('live-logs-read'"));
  assert.ok(source('preload.cjs').includes("readLiveLogs:input=>call('live-logs-read',input)"));
});

test('live logs merge transport updates across polls and localize recoverable execution states',async()=>{
  const base={at:'2026-10-19T00:52:18Z',event:'execution',category:'tool',severity:'info',request_id:'exec_first',
    service:'builtin',tool:'start_process',state:'failed',error_code:'PROJECT_CONTEXT_REFRESH_REQUIRED',
    recovery_kind:'needs_context',message:'builtin · start_process · failed · PROJECT_CONTEXT_REFRESH_REQUIRED'};
  const pages=[
    [{...base,id:'1:1',delivery:'unknown'}],
    [{...base,id:'1:2',delivery:'local_write_succeeded'},
      {...base,id:'1:3',request_id:'exec_second',error_code:'context_paths_required',recovery_kind:'needs_arguments'},
      {...base,id:'1:4',state:'running',error_code:'',recovery_kind:undefined}],
    [{...base,id:'1:5',delivery:'local_write_failed',severity:'error',recovery_kind:undefined}],
  ];
  const f=await rendererFixture(initialState(),{readLiveLogs:async()=>({entries:pages.shift()||[],cursor:{file:'app.log',identity:'1',offset:100},reset:false,more:false})});
  await f.node('nav-logs').emit('click');await settled();
  assert.equal(f.node('log-entries').children.length,1);
  assert.match(f.node('log-entries').textContent,/待读取项目规范/);
  const poll=async()=>{await f.node('log-pause').emit('click');await f.node('log-pause').emit('click');await settled();};
  await poll();
  assert.equal(f.node('log-entries').children.length,3,'same request/state/code updates in place; other requests and phases stay separate');
  assert.match(f.node('log-entries').textContent,/响应已写入本机通道/);
  assert.match(f.node('log-entries').textContent,/待补全参数/);
  assert.match(f.node('log-entries').textContent,/执行中/);
  await f.node('log-filter-error').emit('click');
  assert.match(f.node('log-entries').textContent,/没有符合筛选条件/);
  await poll();
  assert.equal(f.node('log-entries').children.length,1);
  assert.match(f.node('log-entries').textContent,/失败.*本机写入失败/);
  assert.doesNotMatch(f.node('log-entries').textContent,/待读取项目规范/);
  await f.node('log-filter-all').emit('click');
  assert.equal(f.node('log-entries').children.length,3);
  await f.node('log-reload').emit('click');await settled();
  assert.match(f.node('log-entries').textContent,/等待新日志/);
});

test('execution history labels recoverable failures and translations describe local response delivery',async()=>{
  const records=['needs_arguments','needs_context'].map((kind,index)=>({request_id:'exec_'+index,received_at:'2026-10-19T00:52:18Z',tool:'start_process',service:'builtin',state:'failed',recovery_kind:kind}));
  const f=await rendererFixture(initialState(),{executionList:async()=>({records,total:2,usage:0,diagnostics:{enabled:false}})});
  await f.node('nav-history').emit('click');await settled();
  assert.match(f.node('history-rows').textContent,/待补全参数/);
  assert.match(f.node('history-rows').textContent,/待读取项目规范/);
  for(const key of ['待补全参数','待读取项目规范','响应已写入本机通道']){
    assert.equal(messages[key].length,2);
    assert.notEqual(i18n.translate('en',key),key);assert.notEqual(i18n.translate('ja',key),key);
  }
});

test('live command failures display a localized exit code',async()=>{
  const entry={id:'exit:23',at:'2026-10-20T08:34:34Z',event:'execution',category:'tool',severity:'error',request_id:'exec_exit',service:'Harness',tool:'start_task',state:'failed',error_code:'TASK_EXIT_NONZERO',exit_code:23};
  const f=await rendererFixture(initialState(),{readLiveLogs:async()=>({entries:[entry],cursor:null,reset:false,more:false})});
  await f.node('nav-logs').emit('click');await settled();
  assert.match(f.node('log-entries').textContent,/TASK_EXIT_NONZERO.*退出码 23/);
  assert.equal(i18n.translate('en','退出码 {code}',{code:23}),'Exit code 23');
  assert.equal(i18n.translate('ja','退出码 {code}',{code:23}),'終了コード 23');
});

test('log pages share a labelled group, with nested history icon and accessible keyboard order', async () => {
  const start=html.indexOf('id="nav-log-group"');
  const end=html.indexOf('id="nav-connection"',start);
  const group=html.slice(start,end);
  assert.ok(start>0&&end>start);
  assert.ok(group.indexOf('id="nav-logs"')<group.indexOf('id="nav-history"'));
  assert.match(group, /role="group" aria-label="日志"/);
  assert.match(group, /id="nav-history"[^>]*data-nav-level="child"[^>]*><svg[^>]*>.+?<\/svg>执行记录/);
  assert.match(source('style.css'), /\.nav-log-group \.nav-item\[data-nav-level="child"\]/);
  assert.equal(i18n.translate('en','日志'),'Logs');
  assert.equal(i18n.translate('ja','日志'),'ログ');

  let logReads=0;
  const f=await rendererFixture(initialState(),{
    readLiveLogs:async()=>{logReads++;return {entries:[],cursor:null,reset:false,more:false};},
    executionList:async()=>({records:[],total:0,usage:0,diagnostics:{enabled:false}}),
  });
  const groupNode=f.node('nav-log-group');
  const submenu=f.node('nav-log-submenu');
  const parent=f.node('nav-logs');
  const child=f.node('nav-history');
  assert.equal(groupNode.dataset.active,'false');
  assert.equal(groupNode.dataset.expanded,'false','menu is collapsed by default');
  assert.equal(submenu.hidden,true,'child is hidden by default');
  assert.equal(parent.attributes['aria-expanded'],'false');
  assert.equal(child.attributes.tabindex,'-1');
  assert.match(group,/id="nav-log-submenu"[^>]*hidden/,'child markup is collapsed before renderer loads');
  assert.match(group,/class="nav-log-chevron"/,'parent has a disclosure arrow');

  await parent.emit('click');await settled();
  assert.equal(groupNode.dataset.active,'true');
  assert.equal(groupNode.dataset.expanded,'true');
  assert.equal(submenu.hidden,false);
  assert.equal(parent.attributes['aria-expanded'],'true');
  assert.equal(parent.attributes['aria-selected'],'true');
  assert.equal(child.attributes['aria-selected'],'false');

  const callsWhileOpen=logReads;
  await parent.emit('click');await settled();
  assert.equal(logReads,callsWhileOpen,'folding the menu must not reload the log stream');
  assert.equal(groupNode.dataset.expanded,'false','clicking parent again closes its child');
  assert.equal(submenu.hidden,true);
  assert.equal(f.node('panel-logs').hidden,false,'collapsing does not close the log page');

  await parent.emit('keydown',{key:'ArrowDown'});
  assert.equal(f.node('nav-connection').attributes['aria-selected'],'true','collapsed child is skipped by keyboard navigation');
  assert.equal(groupNode.dataset.active,'false');

  await f.node('nav-connection').emit('keydown',{key:'ArrowUp'});
  assert.equal(parent.attributes['aria-selected'],'true');
  assert.equal(submenu.hidden,true);
  await parent.emit('keydown',{key:'ArrowRight'});
  assert.equal(parent.attributes['aria-expanded'],'true','right arrow expands');
  await parent.emit('keydown',{key:'ArrowDown'});await settled();
  assert.equal(child.attributes['aria-selected'],'true');
  assert.equal(f.node('panel-history').hidden,false);
  assert.equal(submenu.hidden,false);
  assert.equal(groupNode.dataset.active,'true');
  assert.match(child.className,/selected/);

  await child.emit('keydown',{key:'ArrowLeft'});
  assert.equal(parent.attributes['aria-selected'],'true');
  assert.equal(submenu.hidden,true,'left arrow collapses');
  assert.equal(parent.attributes['aria-expanded'],'false');

  // In-page shortcuts to history expand the menu even when it is folded.
  const shortcut=f.node('logs-history-shortcut');
  assert.equal(shortcut.dataset.navigate,'history','history shortcut exists in live log page');
  await shortcut.emit('click');await settled();
  assert.equal(submenu.hidden,false);
  assert.equal(child.attributes['aria-selected'],'true');
  await parent.emit('click');
  assert.equal(submenu.hidden,true,'clicking parent from history navigates to logs and closes');
  assert.equal(f.node('panel-logs').hidden,false);

  await f.node('nav-overview').emit('click');
  assert.equal(groupNode.dataset.active,'false');
  assert.equal(submenu.hidden,true);
});

test('MCP Computer Use checkbox toggles a persisted platform-local capability without editing MCP servers', async () => {
  let state = initialState();
  const updates = [];
  const fixture = await rendererFixture(state, {
    async mcpSetComputerUse(enabled) {
      updates.push(enabled);
      state = { ...state, mcp: { ...state.mcp, computerUse: { enabled, available: true, platform: 'darwin' } } };
      return state;
    },
  });
  const toggle=fixture.node('mcp-computer-use');
  assert.equal(toggle.disabled,false);
  assert.equal(toggle.checked,false);
  toggle.checked=true; await toggle.emit('change');
  assert.deepEqual(updates,[true]);
  assert.equal(toggle.checked,true);
  toggle.checked=false; await toggle.emit('change');
  assert.deepEqual(updates,[true,false]);
  assert.equal(toggle.checked,false);
  assert.equal(state.mcp.servers.length,0,'must not add an external MCP server configuration');
  const unavailable=initialState();
  unavailable.mcp.computerUse.available=false;
  const other=await rendererFixture(unavailable);
  assert.equal(other.node('mcp-computer-use').disabled,true,'missing OS native helper must fail closed');
});

test('denied Mac TCC grants show an accessible local permission dialog and do not register Computer Use',async()=>{
 let state=initialState();
 const requests=[];
 const initialMcpCount=state.mcp.servers.length;
 const fixture=await rendererFixture(state,{
   async mcpSetComputerUse(enabled) {
     requests.push({enabled});
     state={...state,mcp:{...state.mcp,computerUse:{
       platform:'darwin',available:true,enabled:false,registered:false,
       permissionPromptVisible:true,permission:{granted:false,missing:['screen_recording','accessibility']}
     }}};
     return state;
   },
   async mcpComputerUsePermissions(request) {
     requests.push({request});
     state={...state,mcp:{...state.mcp,computerUse:{
       platform:'darwin',available:true,enabled:true,registered:true,
       permissionPromptVisible:false,permission:{granted:true,missing:[]}
     }}};
     return state;
   },
 });
 const checkbox=fixture.node('mcp-computer-use');
 checkbox.checked=true;
 await checkbox.emit('change');
 const dialog=fixture.node('mcp-computer-use-permission-dialog');
 assert.equal(dialog.hidden,false);
 assert.equal(checkbox.checked,false);
 assert.match(fixture.node('mcp-computer-use-permission-detail').textContent,/屏幕录制/);
 assert.match(fixture.node('mcp-computer-use-permission-detail').textContent,/辅助功能/);
 assert.equal(fixture.node('mcp-computer-use-request').hidden,false);
 assert.equal(state.mcp.servers.length,initialMcpCount);
 await fixture.node('mcp-computer-use-request').emit('click');
 assert.deepEqual(requests,[{enabled:true},{request:true}]);
 assert.equal(dialog.hidden,true);
 assert.equal(checkbox.checked,true);
});
test('Windows permission dialog cannot expose macOS TCC buttons',async()=>{
 const state=initialState();
 state.mcp.computerUse={platform:'win32',available:true,enabled:false,
   permissionPromptVisible:true,permission:{granted:false,missing:[],code:'CU_CONSENT_DENIED'}};
 const fixture=await rendererFixture(state);
 assert.equal(fixture.node('mcp-computer-use-permission-dialog').hidden,false);
 assert.equal(fixture.node('mcp-computer-use-request').hidden,true);
 assert.equal(fixture.node('mcp-computer-use-settings-screen').hidden,true);
 assert.equal(fixture.node('mcp-computer-use-settings-accessibility').hidden,true);
 assert.match(fixture.node('mcp-computer-use-permission-detail').textContent,/Windows/);
});
