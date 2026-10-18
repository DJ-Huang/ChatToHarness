'use strict';

(() => {
  const api = window.localHarness;
  const i18n = window.CTHI18n;
  let locale = i18n.normalize(navigator.language);
  const t = (message, values) => i18n.translate(locale, message, values);
  const translateDocument = i18n.documentTranslator(document);
  translateDocument(locale);
  const byId = (id) => document.getElementById(id);
  const form = byId('settings-form');
  const tunnelInput = byId('tunnel-id');
  const keyInput = byId('api-key');
  const autoConnectInput = byId('auto-connect');
  const autoProjectContextInput = byId('auto-project-context');
  let currentState = null;
  let initialized = false;
  let directories = [];
  let baseline = '';
  let keySaved = false;
  let pending = '';
  let actionError = '';
  let actionMessage = '';
  let operationSequence = 0;
  let actionEpoch = null;
  let activeTab = 'overview';
  let updatePending = false;
  let updatePreferencePending = false;
  let updateError = '';
  let mcpPending = '';
  let mcpEditorId = null;
  let mcpTrustRequest = null;
  let mcpImportDraft = null;
  let mcpRenderKey = '';
  let approvalRenderKey = '';
  const mcpApprovalPending = new Set();
  const mcpOpenTools = new Set();
  const cancelled = Symbol('cancelled');
  const tabNames = ['overview', 'logs', 'history', 'connection', 'directories', 'mcp', 'help'];
  const pages = {
    overview: ['工作空间概览', '将 AI 对话连接到本机执行环境。'],
    logs: ['实时日志', '持续查看本机连接、工具调用与异常日志。'],
    connection: ['连接配置', '为这个工作空间建立一条安全通道。'],
    directories: ['工作目录', '选择协作范围，自动交付工程规范。'],
    mcp: ['MCP Servers', '配置本应用的工具服务，再通过安全通道提供给客户端。'],
    history: ['执行记录', '按需查看本机工具执行与响应写入状态。'],
    help: ['接入与帮助', '连接客户端，开始第一次本机工具调用。'],
  };
  const stateNames = {
    unconfigured: '尚未配置', stopped: '已停止', checking: '检查中', authorizing: '等待系统授权',
    starting: '连接中', ready: '通道就绪', reconnecting: '重连中', failed: '连接异常',
  };
  const descriptions = {
    unconfigured: '添加工作目录或 MCP 服务，保存连接配置，即可开始。',
    stopped: '连接已停止，可以随时重新连接。',
    authorizing: '请在系统窗口授权访问已保存的凭据。',
    checking: '正在确认本机工具是否可用。',
    starting: '正在建立安全通道，请稍候。',
    ready: '本机已准备好接收请求，下一步在客户端完成接入。',
    reconnecting: '连接中断，正在自动尝试恢复。',
    failed: '连接需要处理，请查看上方提示。',
  };
  const headlines = {
    unconfigured: '准备连接你的工作空间', stopped: '工作空间暂未连接', checking: '正在检查本机执行环境',
    authorizing: '等待系统凭据授权', starting: '正在建立安全连接', ready: '工作空间已准备就绪',
    reconnecting: '正在恢复安全连接', failed: '连接需要你的关注',
  };
  const values = () => ({
    tunnelId: tunnelInput.value.trim(), directories: [...directories], autoConnect: autoConnectInput.checked,
    autoProjectContext: autoProjectContextInput.checked,
  });
  const settingsFingerprint = () => JSON.stringify(values());
  const savedFingerprint = (settings) => JSON.stringify({
    tunnelId: settings.tunnelId || '', directories: [...(settings.directories || [])],
    autoConnect: settings.autoConnect !== false, autoProjectContext: settings.autoProjectContext !== false,
  });
  const isDirty = () => settingsFingerprint() !== baseline || keyInput.value.length > 0;
  const workspaceDirty = () => JSON.stringify({ directories, autoProjectContext: autoProjectContextInput.checked }) !==
    JSON.stringify({ directories: currentState?.settings?.directories || [], autoProjectContext: currentState?.settings?.autoProjectContext !== false });
  const safeMessage = (error) => typeof error?.message === 'string' && error.message.trim()
    ? error.message : t('操作未完成，请重试或查看日志。');
  const mcpErrors = {
    MCP_APPROVAL_DENIED: '已拒绝此次工具调用。', MCP_APPROVAL_EXPIRED: '此次调用的确认已过期，未获得执行授权。',
    MCP_AUTH_REQUIRED: '服务认证失败，请检查密钥或请求头。', MCP_CANCELLED: 'MCP 操作已取消。',
    MCP_CONNECTION_FAILED: 'MCP 服务连接失败，请检查配置或稍后重试。', MCP_CONNECT_TIMEOUT: '连接 MCP 服务超时，请检查服务是否可用。',
    MCP_CURSOR_EXPIRED: '工具目录已更新，请刷新后重试。', MCP_DISCONNECTED: 'MCP 服务已断开；执行中的调用请先检查实际结果。',
    MCP_INVALID_APPROVAL: '调用确认无效，请重新发起请求。', MCP_INVALID_ARGUMENTS: '工具参数无效，请检查后重试。',
    MCP_INVALID_CONFIG: 'MCP 配置无效，请检查后重试。', MCP_INVALID_TOOL_POLICY: '工具已变更，请刷新列表后重新授权。',
    MCP_MESSAGE_TOO_LARGE: 'MCP 消息超过允许大小，请减少请求或返回内容。', MCP_NO_TOOLS: '尚无已授权的工具，请先启用服务并设置工具权限，或添加工作目录。',
    MCP_POLICY_CHANGED: '工具权限已变更，此次调用已停止。', MCP_PROTOCOL_INVALID: '服务返回的 MCP 消息无效，连接已停止。',
    MCP_PROTOCOL_UNSUPPORTED: '此服务的 MCP 协议版本暂不支持，请使用兼容版本。', MCP_SECRET_MISSING: '此服务有缺失或无法解密的密钥，请编辑并重新填写。',
    MCP_SERVER_BUSY: '此服务正在处理较多请求，请稍后重试。', MCP_STOPPED: 'MCP 连接已停止。',
    MCP_TIMEOUT: '调用已超时。若已开始执行，请先检查实际结果。', MCP_TOOLS_CHANGED: '工具定义已变更，请重新核对并授权。',
    MCP_TOOL_DENIED: '此工具尚未获得调用授权。', MCP_TRUST_REQUIRED: '请先核对并信任此服务，再连接或测试。',
    MCP_START_FAILED: '无法启动服务，请检查命令、参数与工作目录。', MCP_TRANSPORT_CLOSED: 'MCP 服务连接已关闭。',
    MCP_TRANSPORT_STARTED: '此服务已在运行，请复用现有连接。',
    INVALID_INPUT: 'MCP 配置无效，请检查后重试。', INVALID_SERVER_ID: '服务 ID 须以小写字母开头，最多 32 位，可含数字、下划线或连字符。',
    INVALID_COMMAND: '请填写启动命令；文件路径须为对应平台的绝对路径。', INVALID_ARGUMENTS: '启动参数必须是字符串 JSON 数组。',
    INVALID_CWD: '启动工作目录须为对应平台的绝对路径。', INVALID_URL: '服务地址须使用 HTTPS；仅本机回环地址可使用 HTTP，且不能包含账号、密码或片段。',
    INVALID_TRANSPORT: '此连接方式暂不支持，请选择 stdio 或 Streamable HTTP。', INVALID_PLATFORM: '平台覆盖配置无效，请仅使用 darwin 和 win32。',
    INVALID_TIMEOUT: '调用时限须为 1 到 90 秒。', INVALID_TOOL_POLICY: '工具已变更，请刷新列表后重新授权。',
    INVALID_SECRET_REFERENCE: '密钥引用无效，请保留原引用或重新输入密钥。', INVALID_IMPORT: '导入配置无效，请检查 JSON 格式及服务定义。',
    IMPORT_EXPIRED: '导入预览已过期，请重新预览。', IMPORT_CONFLICT: '导入预览与当前配置冲突，请重新预览。',
    SERVER_NOT_FOUND: '此 MCP 服务已不存在，请刷新列表。', SERVER_LIMIT: 'MCP 服务数量超过上限（100）。',
    CONFIG_TOO_LARGE: 'MCP 配置超过允许大小，请减少服务或配置内容。', PLATFORM_UNSUPPORTED: '此启动配置不适用于当前平台，请填写平台覆盖路径。',
    SECRET_MISSING: '此服务有缺失或无法解密的密钥，请编辑并重新填写。', ENCRYPTION_UNAVAILABLE: '系统安全存储不可用，请完成系统授权后重试。',
    ENCRYPTION_FAILED: '密钥无法安全保存，请重试。', DECRYPTION_FAILED: '此服务有缺失或无法解密的密钥，请编辑并重新填写。',
    UNSAFE_STORAGE: 'MCP 配置目录不安全，未读取或写入配置。', STORAGE_UNAVAILABLE: 'MCP 配置存储不可用，请检查目录权限。',
    INVALID_CONFIG: 'MCP 配置文件无法读取，原文件已保留。', WRITE_FAILED: 'MCP 配置无法保存，请检查目录权限后重试。',
  };
  function mcpErrorMessage(error) {
    const message = typeof error === 'string' ? error : safeMessage(error);
    const code = /(?:^|: )([A-Z][A-Z_]+)$/.exec(message)?.[1];
    return mcpErrors[code] || (code ? 'MCP 操作未完成，请检查配置后重试。' : message);
  }

  // Menu expansion is UI state, independent from the current log page. Start
  // collapsed; the parent tab toggles its child without leaving the log viewer.
  let logMenuExpanded = false;
  function setLogMenuExpanded(expanded) {
    logMenuExpanded = Boolean(expanded);
    byId('nav-log-group').dataset.expanded = String(logMenuExpanded);
    byId('nav-log-submenu').hidden = !logMenuExpanded;
    byId('nav-logs').setAttribute('aria-expanded', String(logMenuExpanded));
    if (!logMenuExpanded) byId('nav-history').setAttribute('tabindex', '-1');
  }
  function showTab(name, focus = false) {
    if (!Object.hasOwn(pages, name)) return;
    if (name === 'history') setLogMenuExpanded(true);
    else if (name !== 'logs') setLogMenuExpanded(false);
    activeTab = name;
    // Keep the logs category highlighted for either of its two pages.
    byId('nav-log-group').dataset.active = String(name === 'logs' || name === 'history');
    if(name==='history')void loadHistory();
    if(name==='logs')void loadLiveLogs(true);
    for (const tab of tabNames) byId('panel-' + tab).hidden = tab !== name;
    document.querySelectorAll('[data-tab]').forEach((button) => {
      const selected = button.dataset.tab === name;
      button.className = 'nav-item' + (selected ? ' selected' : '');
      button.setAttribute('aria-selected', String(selected));
      button.setAttribute('tabindex', selected ? '0' : '-1');
      if (selected && focus) button.focus();
    });
    byId('page-title').textContent = t(pages[name][0]);
    byId('page-description').textContent = t(pages[name][1]);
  }

  function renderDirectories() {
    const list = byId('directory-list');
    list.replaceChildren();
    if (!directories.length) {
      const empty = document.createElement('li');
      empty.className = 'empty-folders';
      empty.textContent = t('还没有工作目录。添加工程或文件夹，开启本机协作。');
      list.appendChild(empty);
      return;
    }
    directories.forEach((directory, index) => {
      const item = document.createElement('li');
      item.className = 'directory-item';
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('class', 'folder-icon');
      icon.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M3.5 7V5.5A1.5 1.5 0 0 1 5 4h5l2 2h7A1.5 1.5 0 0 1 20.5 7.5v11A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5V7Zm0 1h17');
      icon.appendChild(path);
      const copy = document.createElement('div');
      copy.className = 'directory-copy';
      const name = document.createElement('span');
      name.className = 'directory-name';
      name.textContent = directory.split(/[\\/]/).filter(Boolean).pop() || directory;
      const fullPath = document.createElement('span');
      fullPath.className = 'directory-path';
      fullPath.textContent = directory;
      fullPath.title = directory;
      copy.append(name, fullPath);
      const remove = document.createElement('button');
      remove.className = 'remove-directory';
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', t('移除目录 {directory}', { directory }));
      remove.disabled = Boolean(pending) || ['downloading', 'verifying', 'installing'].includes(currentState?.updates?.phase);
      remove.addEventListener('click', () => {
        directories.splice(index, 1);
        actionMessage = '';
        renderDirectories();
        render();
      });
      item.append(icon, copy, remove);
      list.appendChild(item);
    });
  }

  function applyState(state, replaceDraft = false) {
    if (!state || typeof state !== 'object') return;
    if (Number.isSafeInteger(state.actionEpoch)) {
      if (actionEpoch !== null && actionEpoch !== state.actionEpoch && pending && pending !== 'stop') {
        // An external Stop invalidates the same save/check/connect chain as the window button.
        ++operationSequence;
        pending = '';
        actionMessage = '连接已停止。';
        renderDirectories();
      }
      actionEpoch = state.actionEpoch;
    }
    currentState = state;
    if (state.system?.locale && state.system.locale !== locale) {
      locale = i18n.normalize(state.system.locale);
      translateDocument(locale);
      showTab(activeTab);
      renderDirectories();
    }
    byId('language-select').value = locale;
    const settings = state.settings || {};
    keySaved = Boolean(settings.keySaved);
    // Background connection updates must not replace a user's settings draft.
    if (!initialized || replaceDraft) {
      tunnelInput.value = settings.tunnelId || '';
      directories = Array.isArray(settings.directories) ? [...settings.directories] : [];
      autoConnectInput.checked = settings.autoConnect !== false;
      autoProjectContextInput.checked = settings.autoProjectContext !== false;
      baseline = settingsFingerprint();
      initialized = true;
      document.body.dataset.initialized = 'true';
      renderDirectories();
    }
    render();
  }

  function render() {
    const runtime = currentState?.runtime || {};
    const state = runtime.state || 'unconfigured';
    const transitioning = ['authorizing', 'checking', 'starting'].includes(state);
    const active = ['authorizing', 'checking', 'starting', 'ready', 'reconnecting'].includes(state);
    const installing = ['downloading', 'verifying', 'installing'].includes(currentState?.updates?.phase);
    const locked = Boolean(pending) || transitioning || installing || !initialized;
    byId('status-badge').className = `status-badge ${state === 'ready' ? 'ready' : ['authorizing', 'checking', 'starting', 'reconnecting'].includes(state) ? 'working' : state === 'failed' ? 'failed' : ''}`;
    byId('status-label').textContent = initialized ? t(stateNames[state] || '状态未知') : t('正在载入');
    byId('overview-headline').textContent = t(headlines[state] || headlines.unconfigured);
    byId('runtime-description').textContent = t(descriptions[state] || descriptions.unconfigured);
    byId('key-status').hidden = !keySaved;
    byId('toggle-key').setAttribute('aria-label', t(keyInput.type === 'password' ? '显示密钥' : '隐藏密钥'));
    keyInput.placeholder = keySaved ? t('已保存；输入新密钥可替换') : t('输入 Runtime API Key');
    const dirty = initialized && isDirty();
    byId('save-indicator').textContent = dirty ? t('有未保存的更改') : keySaved ? t('配置已保存') : t('填写后保存');
    byId('save-indicator').className = `save-indicator${dirty ? ' dirty' : ''}`;
    byId('workspace-save-indicator').textContent = initialized && workspaceDirty() ? t('有未保存的更改') : directories.length ? t('设置已保存') : t('未启用文件工具');
    byId('workspace-save-indicator').className = `save-indicator${workspaceDirty() ? ' dirty' : ''}`;
    byId('save-connect').disabled = locked;
    byId('save-connect-label').textContent = pending === 'save' || state === 'starting' ? t('正在连接…') : t('保存并连接');
    byId('save-workspace').disabled = locked;
    byId('check-connection').disabled = locked;
    byId('check-connection').textContent = pending === 'check' || state === 'checking' ? t('检查中…') : t('检查本机工具');
    byId('reconnect').disabled = locked || !keySaved || !currentState?.settings?.tunnelId;
    byId('reconnect-label').textContent = ['ready', 'reconnecting', 'failed'].includes(state) ? t('重新连接') : t('连接通道');
    const mcpActive = (currentState?.mcp?.servers || []).some(server => ['connecting', 'connected', 'ready', 'reconnecting'].includes(server.phase));
    byId('stop').disabled = (!active && !mcpActive && !['save', 'check', 'reconnect'].includes(pending)) || pending === 'stop';
    byId('clear-credentials').disabled = locked || (!keySaved && !currentState?.settings?.tunnelId && !keyInput.value);
    byId('add-directory').disabled = Boolean(pending) || installing || !initialized;
    [tunnelInput, keyInput, autoConnectInput, autoProjectContextInput].forEach((input) => { input.disabled = installing || ['save', 'workspace', 'clear'].includes(pending); });
    document.querySelectorAll('.remove-directory').forEach(button => { button.disabled = Boolean(pending) || installing; });
    byId('action-message').textContent = t(actionMessage);
    const error = actionError || (state === 'failed' ? runtime.error : '') || '';
    byId('error-banner').hidden = !error;
    byId('error-message').textContent = t(mcpErrors[error] || error);
    byId('tools-summary').textContent = runtime.localReady ? t('{count} 项可用', { count: runtime.toolsCount || '—' }) : state === 'checking' ? t('正在检查') : t('等待检查');
    byId('folders-summary').textContent = directories.length ? t('{count} 个目录', { count: directories.length }) : t('尚未选择');
    byId('directory-nav-count').textContent = String(directories.length);
    byId('rules-summary').textContent = autoProjectContextInput.checked ? t('自动加载') : t('已关闭');
    byId('rules-detail').textContent = autoProjectContextInput.checked ? t('AGENTS.md 与相关规则') : t('工具调用前不自动提供工程规范');
    byId('step-local').className = `progress-step${runtime.localReady ? ' complete' : state === 'checking' ? ' active' : ''}`;
    byId('local-detail').textContent = runtime.localReady
      ? runtime.toolsCount ? t('已就绪 · {count} 项工具', { count: runtime.toolsCount }) : t('已就绪')
      : state === 'checking' ? t('正在检查本机工具…') : t('连接时自动检查');
    byId('step-tunnel').className = `progress-step${state === 'ready' ? ' complete' : ['starting', 'reconnecting'].includes(state) ? ' active' : ''}`;
    byId('tunnel-detail').textContent = state === 'ready' ? t('通道已就绪') : state === 'starting' ? t('正在建立安全通道…') : state === 'reconnecting' ? t('正在恢复连接…') : state === 'failed' ? t('连接需要处理') : t('等待连接');
    // Tunnel health cannot prove that a client has authorized or executed a tool.
    byId('step-client').className = `progress-step${state === 'ready' ? ' active' : ''}`;
    byId('client-detail').textContent = state === 'ready' ? t('请在客户端选择同一通道并验证工具调用。') : t('选择同一通道，再发起一次工具调用。');
    byId('tunnel-example').value = currentState?.settings?.tunnelId || t('保存 Tunnel ID 后显示');
    byId('copy-tunnel').disabled = !currentState?.settings?.tunnelId;
    byId('responses-example').textContent = JSON.stringify({ type: 'mcp', server_label: 'chat_to_harness', tunnel_id: currentState?.settings?.tunnelId || t('tunnel_替换为已配置的通道标识') }, null, 2);
    const versions = currentState?.versions || {};
    byId('app-version').textContent = versions.app ? `v${versions.app}` : '';
    byId('versions').textContent = [
      ['Node', versions.node], [t('通道运行组件'), versions.tunnel], [t('工具引擎'), versions.desktopCommander],
    ].map(([name, version]) => `${name} ${version || t('未读取')}`).join(' · ');
    renderUpdates();
    renderMcp();
  }

  const mcpServers = () => currentState?.mcp?.servers || [];
  const mcpServer = id => mcpServers().find(server => server.id === id);
  const make = (tag, className, content) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  };
  function mcpButton(label, handler, style = 'secondary') {
    const button = make('button', 'button compact-button ' + style, t(label));
    button.type = 'button';
    button.disabled = Boolean(mcpPending) || !initialized || ['downloading', 'verifying', 'installing'].includes(currentState?.updates?.phase);
    button.addEventListener('click', handler);
    return button;
  }
  function mcpTarget(server) {
    if (server.transport === 'streamable-http') return server.url || '';
    const override = server.platforms?.[currentState?.system?.platform] || {};
    const command = override.command ?? server.command ?? '';
    const args = override.args ?? server.args ?? [];
    const cwd = override.cwd ?? server.cwd ?? '';
    return [command, JSON.stringify(args), cwd ? t('工作目录：{directory}', { directory: cwd }) : ''].filter(Boolean).join('\n');
  }
  function mcpDetails(label, value) {
    const details = make('details', 'mcp-tool-details');
    details.append(make('summary', '', t(label)), make('pre', 'code-example', JSON.stringify(value, null, 2)));
    return details;
  }
  function renderMcp() {
    const servers = mcpServers();
    const allowAllTools = currentState?.mcp?.allowAllTools === true;
    const installing = ['downloading', 'verifying', 'installing'].includes(currentState?.updates?.phase);
    const busy = Boolean(mcpPending) || installing || !initialized;
    byId('mcp-allow-all-tools').checked = allowAllTools;
    byId('mcp-allow-all-tools').disabled = busy;
    byId('mcp-policy-summary').textContent = t(allowAllTools
      ? '已开启允许所有工具。下方逐项权限在关闭此开关后生效。'
      : '先信任服务，再逐项授权工具。新增或变更的工具默认禁用，客户端可能需要刷新工具目录。');
    for (const id of ['mcp-add', 'mcp-save', 'mcp-cancel', 'mcp-import-preview', 'mcp-export', 'mcp-import-confirm', 'mcp-trust-confirm', 'mcp-trust-cancel']) byId(id).disabled = busy;
    byId('mcp-import-text').disabled = busy;
    byId('mcp-import-preview').disabled = busy || !byId('mcp-import-text').value.trim();
    byId('mcp-id').disabled = busy || Boolean(mcpEditorId);
    for (const id of ['mcp-name', 'mcp-transport', 'mcp-timeout', 'mcp-command', 'mcp-args', 'mcp-cwd', 'mcp-env', 'mcp-url', 'mcp-headers', 'mcp-platforms']) byId(id).disabled = busy;
    byId('mcp-nav-count').textContent = String(servers.length);
    byId('mcp-editor-title').textContent = t(mcpEditorId ? '编辑 MCP 服务' : '添加 MCP 服务');
    byId('mcp-save').textContent = t(mcpPending === 'save' ? '正在保存…' : '保存服务');
    const key = JSON.stringify([servers, allowAllTools, locale, mcpPending, initialized, installing]);
    if (key !== mcpRenderKey) {
      mcpRenderKey = key;
      const list = byId('mcp-server-list');
      list.replaceChildren();
      if (!servers.length) list.append(make('div', 'empty-folders', t('尚未添加 MCP 服务。添加服务或导入配置后，先测试连接再授权工具。')));
      const phases = { disabled: '已停用', stopped: '已停止', connecting: '连接中', starting: '连接中', connected: '已连接', ready: '已连接', reconnecting: '重连中', failed: '连接异常', error: '连接异常', untrusted: '等待信任', disconnected: '未连接' };
      for (const server of servers) {
        const item = make('article', 'mcp-server');
        const heading = make('div', 'mcp-server-heading');
        const name = make('div', 'mcp-server-copy');
        name.append(make('h3', '', server.name || server.id), make('span', 'mcp-server-id', server.id));
        const status = make('span', 'mcp-server-status', t(phases[server.phase] || (server.enabled ? '未连接' : '已停用')));
        status.dataset.phase = server.phase || 'disabled';
        heading.append(name, status);
        item.append(heading, make('pre', 'mcp-target', mcpTarget(server)));
        const protocol = server.protocolVersion ? t('协议版本：{version}', { version: server.protocolVersion }) : t('协议版本：尚未协商');
        item.append(make('p', 'mcp-caption', protocol));
        if (server.error) item.append(make('p', 'mcp-server-error', t(mcpErrorMessage(server.error))));
        if (server.missingSecrets?.length) item.append(make('p', 'mcp-server-error', t('此服务有缺失的密钥，请编辑并重新填写：{fields}', { fields: server.missingSecrets.map(entry => typeof entry === 'string' ? entry : [entry.field, entry.key].filter(Boolean).join('.')).join(', ') })));
        const actions = make('div', 'mcp-actions');
        actions.append(
          mcpButton(server.enabled ? '停用' : '启用', () => server.enabled ? mcpPerform('disable', () => api.mcpSetEnabled(server.id, false)) : requestMcpConnection(server, 'enable')),
          mcpButton('测试连接', () => requestMcpConnection(server, 'test')),
          mcpButton('编辑', () => openMcpEditor(server)),
          mcpButton('删除', () => {
            const review = make('div', 'mcp-delete-review');
            review.append(make('p', 'mcp-caption', t('删除此服务会停止连接并移除配置。')),
              mcpButton('确认删除', () => mcpPerform('remove', async () => { const state = await api.mcpRemoveServer(server.id); if (mcpEditorId === server.id) closeMcpEditor(); return state; }), 'subtle-danger'),
              mcpButton('取消', () => { mcpRenderKey = ''; renderMcp(); }));
            actions.replaceChildren(review);
          }, 'subtle-danger'),
        );
        item.append(actions);
        const tools = make('details', 'mcp-tools');
        tools.open = mcpOpenTools.has(server.id);
        tools.addEventListener('toggle', () => { if (tools.open) mcpOpenTools.add(server.id); else mcpOpenTools.delete(server.id); });
        tools.append(make('summary', '', t('工具与授权（{count}）', { count: server.tools?.length || 0 })));
        if (!server.tools?.length) tools.append(make('p', 'mcp-caption', t(allowAllTools ? '连接后可预览工具。' : '连接后可预览工具；工具默认禁用。')));
        for (const tool of server.tools || []) {
          const row = make('div', 'mcp-tool');
          const line = make('div', 'mcp-tool-heading');
          const title = make('div', 'mcp-server-copy');
          title.append(make('strong', '', tool.title || tool.name), make('code', 'mcp-server-id', tool.exposedName || server.id + '__' + tool.name));
          const label = make('label', 'mcp-policy');
          label.append(make('span', '', t(allowAllTools ? '关闭后使用的权限' : '调用权限')));
          const select = make('select');
          select.setAttribute('aria-label', t(allowAllTools ? '关闭后 {tool} 的调用权限' : '{tool} 的调用权限', { tool: tool.name }));
          for (const [value, text] of [['deny', '禁用'], ['allow', '直接调用'], ['ask', '每次本机确认']]) {
            const option = make('option', '', t(text)); option.value = value; select.append(option);
          }
          select.value = (allowAllTools ? tool.savedPolicy : tool.policy) || 'deny';
          select.disabled = busy || allowAllTools;
          select.addEventListener('change', event => mcpPerform('policy', () => api.mcpSetToolPolicy({ serverId: server.id, toolName: tool.name, policy: event.target.value })));
          label.append(select); line.append(title, label); row.append(line);
          if(tool.projectGrants?.length){row.append(make('p','mcp-caption',t('已记住 {count} 个项目的授权',{count:tool.projectGrants.length})),mcpDetails('项目授权范围',tool.projectGrants),mcpButton('清除项目授权',()=>mcpPerform('policy',()=>api.mcpSetToolPolicy({serverId:server.id,toolName:tool.name,policy:tool.savedPolicy||'ask'}))));}
          if (tool.description) row.append(make('p', 'mcp-tool-description', tool.description));
          row.append(mcpDetails('输入参数', tool.inputSchema || {}));
          if (tool.outputSchema) row.append(mcpDetails('返回格式', tool.outputSchema));
          tools.append(row);
        }
        item.append(tools); list.append(item);
      }
    }
    const trustServer = mcpTrustRequest && mcpServer(mcpTrustRequest.id);
    byId('mcp-trust').hidden = !trustServer;
    if (trustServer) {
      byId('mcp-trust-target').textContent = (trustServer.name || trustServer.id) + '\n' + mcpTarget(trustServer);
      byId('mcp-trust-confirm').textContent = t(mcpTrustRequest.action === 'test' ? '信任并测试' : '信任并连接');
    }
    if (mcpImportDraft) renderMcpImport();
    renderMcpApprovals();
  }
  function renderMcpApprovals() {
    const approvals = currentState?.mcp?.approvals || [];
    byId('mcp-approvals').hidden = !approvals.length;
    const key = JSON.stringify([approvals, locale, [...mcpApprovalPending]]);
    if (key === approvalRenderKey) return;
    approvalRenderKey = key;
    const list = byId('mcp-approval-list'); list.replaceChildren();
    for (const approval of approvals) {
      const row = make('article', 'mcp-approval');
      row.append(make('h3', '', (approval.serverName || approval.serverId) + ' · ' + approval.toolName));
      const deadline = Number(approval.expiresAt) || Date.parse(approval.expiresAt);
      if (Number.isFinite(deadline)) row.append(make('p', 'mcp-caption', t('确认截止：{time}', { time: new Intl.DateTimeFormat(locale, { timeStyle: 'medium' }).format(deadline) })));
      const details=make('details','mcp-tool-details');details.append(make('summary','',t('查看参数与确认来源')));
      details.append(make('pre','code-example',JSON.stringify(approval.arguments??{},null,2)));
      details.append(make('p','mcp-caption',t('这是 ChatToHarness 本机确认。ChatGPT、操作系统和外部服务可能另行确认。')));
      if(approval.projectPath)details.append(make('p','mcp-caption',approval.projectPath),make('p','mcp-caption',t('项目授权用于复用确认，不会把终端或外部服务限制在该目录中。')));
      row.append(details);
      const remember=make('select');remember.setAttribute('aria-label',t('本机授权范围'));
      for(const [value,label]of [['once','仅本次'],...(approval.projectPath?[['project','此项目内记住']]:[]),['tool','记住此工具']]){const option=make('option','',t(label));option.value=value;remember.append(option);}
      remember.value='once';row.append(remember);
      const buttons = make('div', 'mcp-actions');
      for (const [allow, label] of [[false, '拒绝'], [true, '允许此次调用']]) {
        const button = make('button', 'button ' + (allow ? 'primary' : 'secondary'), t(label)); button.type = 'button';
        button.disabled = mcpApprovalPending.has(approval.id) || (Number.isFinite(deadline) && deadline <= Date.now());
        button.addEventListener('click', async () => {
          if (mcpApprovalPending.has(approval.id)) return;
          mcpApprovalPending.add(approval.id); renderMcpApprovals();
          try { const state = await api.mcpResolveApproval({ id: approval.id, allow, ...(allow&&remember.value!=='once'?{remember:remember.value}:{}) }); if (state?.mcp || state?.runtime) applyState(state); }
          catch (error) { actionError = mcpErrorMessage(error); }
          finally { mcpApprovalPending.delete(approval.id); render(); }
        });
        buttons.append(button);
      }
      row.append(buttons); list.append(row);
    }
  }
  async function mcpPerform(name, work) {
    if (mcpPending) return;
    mcpPending = name; actionError = ''; actionMessage = ''; render();
    try {
      const state = await work();
      if (state?.mcp || state?.settings || state?.runtime) applyState(state);
    } catch (error) { actionError = mcpErrorMessage(error); }
    finally { mcpPending = ''; render(); }
  }
  function requestMcpConnection(server, action) {
    if (!server.trusted) {
      mcpTrustRequest = { id: server.id, action }; renderMcp();
      byId('mcp-trust').scrollIntoView?.({ block: 'nearest' });
      byId('mcp-trust-confirm').focus();
      return;
    }
    mcpPerform(action, () => action === 'test' ? api.mcpTestServer(server.id) : api.mcpSetEnabled(server.id, true));
  }
  function openMcpEditor(server = null) {
    mcpEditorId = server?.id || null;
    byId('mcp-id').value = server?.id || '';
    byId('mcp-name').value = server?.name || '';
    byId('mcp-transport').value = server?.transport || 'stdio';
    byId('mcp-timeout').value = String((server?.timeoutMs || 60000) / 1000);
    byId('mcp-command').value = server?.command || '';
    byId('mcp-args').value = JSON.stringify(server?.args || [], null, 2);
    byId('mcp-cwd').value = server?.cwd || '';
    byId('mcp-env').value = JSON.stringify(server?.env || {}, null, 2);
    byId('mcp-url').value = server?.url || '';
    byId('mcp-headers').value = JSON.stringify(server?.headers || {}, null, 2);
    byId('mcp-platforms').value = JSON.stringify(server?.platforms || {}, null, 2);
    byId('mcp-editor').hidden = false;
    updateMcpTransport(); renderMcp();
    byId('mcp-editor').scrollIntoView?.({ block: 'nearest' });
    byId(server ? 'mcp-name' : 'mcp-id').focus();
  }
  function closeMcpEditor() {
    byId('mcp-editor').hidden = true; mcpEditorId = null;
    // Newly entered secrets must not remain in a hidden editor after save/cancel.
    for (const id of ['mcp-env', 'mcp-headers']) byId(id).value = '{}';
  }
  function updateMcpTransport() {
    const http = byId('mcp-transport').value === 'streamable-http';
    byId('mcp-http-fields').hidden = !http;
    byId('mcp-stdio-fields').hidden = http;
  }
  function parseMcpJson(id, kind) {
    let value;
    try { value = JSON.parse(byId(id).value.trim() || (kind === 'array' ? '[]' : '{}')); }
    catch { byId(id).focus(); throw new Error(t('请填写有效的 JSON。')); }
    if (kind === 'array' ? !Array.isArray(value) || value.some(item => typeof item !== 'string') : !value || typeof value !== 'object' || Array.isArray(value)) {
      byId(id).focus(); throw new Error(t(kind === 'array' ? '启动参数必须是字符串 JSON 数组。' : '此字段必须是 JSON 对象。'));
    }
    return value;
  }
  function renderMcpImport() {
    const list = byId('mcp-import-summary'); list.replaceChildren();
    for (const server of mcpImportDraft?.servers || []) {
      const item = make('div', 'mcp-import-server');
      item.append(make('strong', '', server.name || server.id), make('pre', 'mcp-target', mcpTarget(server)));
      list.append(item);
    }
    if (mcpImportDraft?.missingSecrets?.length) list.append(make('p', 'mcp-server-error', t('导入后需要重新填写引用的密钥。')));
    list.append(make('p', 'mcp-caption', t('导入仅保存配置，不会启动服务；所有工具保持禁用。')));
  }

  function renderUpdates() {
    const updates = currentState?.updates || {};
    const phase = updates.phase || 'idle';
    const busy = ['checking', 'downloading', 'verifying', 'installing'].includes(phase);
    byId('check-update').disabled = !initialized || busy || updatePending;
    byId('check-update').textContent = t(phase === 'checking' ? '正在检查…' : '检查更新');
    byId('auto-check-updates').checked = updates.automatic !== false;
    byId('auto-check-updates').disabled = !initialized || updatePreferencePending;
    const current = updates.current || currentState?.versions?.app || '—';
    byId('update-version').textContent = updates.latest
      ? t('当前版本 v{current} · 最新版本 v{latest}', { current, latest: updates.latest })
      : t('当前版本 v{version}', { version: current });
    const labels = {
      idle: '尚未检查更新。', checking: '正在检查正式发布版本…', current: '当前没有可用更新。',
      available: '有新版本可用。', unavailable: '暂未发布可用的正式版本。',
      development: '开发模式仅检查版本，请更新源码后重新运行。',
      verifying: '正在校验安装包…', installing: '正在停止连接并打开安装程序…', ready: '安装包已校验，可以继续安装。',
    };
    const percent = updates.total ? Math.min(100, Math.floor((updates.received || 0) / updates.total * 100)) : 0;
    const error = updateError || updates.error || '';
    byId('update-status').textContent = error ? t(error) : phase === 'downloading'
      ? t('正在下载更新 {percent}%', { percent }) : t(labels[phase] || '尚未检查更新。');
    byId('update-status').className = `update-status${error ? ' update-error' : ''}`;
    byId('update-progress').hidden = phase !== 'downloading';
    byId('update-progress').value = percent;
    byId('update-checked').hidden = !updates.checkedAt;
    byId('update-checked').textContent = updates.checkedAt ? t('上次检查：{time}',{time:new Intl.DateTimeFormat(locale,{dateStyle:'short',timeStyle:'short'}).format(updates.checkedAt)}) : '';
    const canDownload = updates.canDownload && ['available', 'error', 'ready'].includes(phase);
    byId('download-update').hidden = !canDownload;
    byId('download-update').disabled = Boolean(pending) || updatePending || isDirty() || ['authorizing', 'checking', 'starting'].includes(currentState?.runtime?.state);
    byId('download-update').textContent = t(updates.canInstall ? '继续安装' : '下载并安装');
    byId('update-release').hidden = !updates.releaseUrl;
    byId('update-install-help').hidden = !canDownload && !['downloading', 'verifying', 'installing'].includes(phase);
    byId('update-install-help').textContent = t(isDirty()
      ? '请先保存或撤销未保存的配置，再安装更新。'
      : currentState?.system?.platform === 'darwin'
        ? '校验后会停止连接，打开 DMG 并退出应用。请将新版拖入“应用程序”。'
        : '校验后会停止连接并打开安装向导，随后退出应用。');
    const notice = byId('update-notice');
    notice.hidden = !updates.latest || !['available', 'development', 'ready', 'downloading', 'verifying', 'installing'].includes(phase);
    notice.textContent = t('发现新版本 v{version}', { version: updates.latest || '' });
  }

  async function updateAction(method) {
    if (updatePending) return;
    updatePending = true; updateError = ''; render();
    try { applyState(await api[method]()); }
    catch (error) { updateError = safeMessage(error); }
    finally { updatePending = false; render(); }
  }

  function showUpdates() {
    showTab('help');
    byId('update-card').scrollIntoView?.({ block: 'nearest' });
  }

  async function perform(name, work) {
    if (pending && name !== 'stop') return;
    const operation = ++operationSequence;
    const checkpoint = () => { if (operation !== operationSequence) throw cancelled; };
    pending = name;
    actionError = '';
    actionMessage = '';
    render();
    renderDirectories();
    try {
      const result = await work(checkpoint);
      checkpoint();
      if (result?.settings || result?.runtime) applyState(result);
    } catch (error) {
      if (operation === operationSequence && error !== cancelled) actionError = safeMessage(error);
    } finally {
      if (operation === operationSequence) {
        pending = '';
        render();
        renderDirectories();
      }
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (pending) return;
    tunnelInput.removeAttribute('aria-invalid');
    keyInput.removeAttribute('aria-invalid');
    if (!tunnelInput.value.trim()) {
      actionError = '请先填写 Tunnel ID。';
      tunnelInput.setAttribute('aria-invalid', 'true');
      showTab('connection');
      tunnelInput.focus();
      render();
      return;
    }
    if (!keySaved && !keyInput.value.trim()) {
      actionError = '请填写 Runtime API Key。';
      keyInput.setAttribute('aria-invalid', 'true');
      showTab('connection');
      keyInput.focus();
      render();
      return;
    }
    perform('save', async (checkpoint) => {
      const settings = values();
      if (keyInput.value.trim()) settings.apiKey = keyInput.value.trim();
      const submittedDraft = settingsFingerprint();
      const savedState = await api.saveSettings(settings);
      const draftUnchanged = settingsFingerprint() === submittedDraft &&
        (!settings.apiKey || keyInput.value.trim() === settings.apiKey);
      // Always clear the submitted secret, including when Stop interrupts saving.
      if (!settings.apiKey || keyInput.value.trim() === settings.apiKey) {
        keyInput.value = '';
        keyInput.type = 'password';
        byId('toggle-key').setAttribute('aria-label', t('显示密钥'));
        byId('toggle-key').setAttribute('aria-pressed', 'false');
      }
      if (draftUnchanged && savedState?.settings) {
        applyState({ ...(currentState || savedState), settings: savedState.settings }, true);
      }
      checkpoint();
      showTab('overview');
      const connectedState = await api.connect();
      checkpoint();
      return connectedState;
    });
  });

  byId('save-workspace').addEventListener('click', () => perform('workspace', async (checkpoint) => {
    const savedState = await api.saveSettings({ directories: [...directories], autoProjectContext: autoProjectContextInput.checked });
    checkpoint();
    if (savedState?.settings) {
      directories = [...savedState.settings.directories];
      autoProjectContextInput.checked = savedState.settings.autoProjectContext !== false;
      baseline = savedFingerprint(savedState.settings);
      applyState({ ...(currentState || savedState), settings: savedState.settings });
    }
    actionMessage = '工作目录与工程规范设置已保存。';
  }));
  byId('add-directory').addEventListener('click', () => perform('choose', async (checkpoint) => {
    const selected = await api.chooseDirectories();
    checkpoint();
    if (Array.isArray(selected)) directories = [...new Set([...directories, ...selected.filter((entry) => typeof entry === 'string' && entry)])];
  }));
  byId('check-connection').addEventListener('click', () => perform('check', async (checkpoint) => {
    if (workspaceDirty()) {
      actionError = '请先保存工作目录设置，再检查本机工具。';
      showTab('directories');
      return;
    }
    const state = await api.check();
    checkpoint();
    if (state?.runtime?.localReady) actionMessage = '本机工具检查通过。';
    return state;
  }));
  byId('reconnect').addEventListener('click', () => perform('reconnect', async (checkpoint) => {
    const state = await api.connect();
    checkpoint();
    return state;
  }));
  byId('stop').addEventListener('click', () => perform('stop', async (checkpoint) => {
    const state = await api.disconnect();
    checkpoint();
    actionMessage = '连接已停止。';
    return state;
  }));
  byId('clear-credentials').addEventListener('click', () => perform('clear', async (checkpoint) => {
    const state = await api.clearCredentials();
    checkpoint();
    keyInput.value = '';
    keySaved = false;
    applyState(state, true);
    actionMessage = '已清除通道标识与密钥，工作目录设置已保留。';
  }));
  byId('open-logs').addEventListener('click', () => perform('logs', () => api.openLogs()));
  byId('mcp-add').addEventListener('click', () => openMcpEditor());
  byId('mcp-allow-all-tools').addEventListener('change', event => {
    const enabled = event.target.checked;
    return mcpPerform('allow-all-tools', () => api.mcpSetAllowAllTools(enabled));
  });
  byId('mcp-cancel').addEventListener('click', closeMcpEditor);
  byId('mcp-transport').addEventListener('change', updateMcpTransport);
  byId('mcp-save').addEventListener('click', () => mcpPerform('save', async () => {
    const id = byId('mcp-id').value.trim();
    const name = byId('mcp-name').value.trim();
    if (!id || !name) throw new Error(t('请填写服务 ID 和显示名称。'));
    const timeout = Number(byId('mcp-timeout').value);
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 90) throw new Error(t('调用时限须为 1 到 90 秒。'));
    const config = { id, name, transport: byId('mcp-transport').value, enabled: mcpEditorId ? mcpServer(mcpEditorId)?.enabled === true : false, timeoutMs: Math.round(timeout * 1000) };
    if (config.transport === 'stdio') {
      config.command = byId('mcp-command').value.trim();
      config.args = parseMcpJson('mcp-args', 'array');
      config.cwd = byId('mcp-cwd').value.trim();
      config.env = parseMcpJson('mcp-env', 'object');
      config.platforms = parseMcpJson('mcp-platforms', 'object');
    } else {
      config.url = byId('mcp-url').value.trim();
      config.headers = parseMcpJson('mcp-headers', 'object');
    }
    const state = await api.mcpSaveServer(config);
    closeMcpEditor(); actionMessage = 'MCP 服务配置已保存。';
    return state;
  }));
  byId('mcp-trust-cancel').addEventListener('click', () => { mcpTrustRequest = null; renderMcp(); });
  byId('mcp-trust-confirm').addEventListener('click', () => {
    const request = mcpTrustRequest;
    if (!request) return;
    mcpPerform('trust', async () => {
      const trustedState = await api.mcpTrustServer(request.id);
      if (trustedState?.mcp) applyState(trustedState);
      mcpTrustRequest = null;
      return request.action === 'test' ? api.mcpTestServer(request.id) : api.mcpSetEnabled(request.id, true);
    });
  });
  byId('mcp-import-text').addEventListener('input', () => {
    mcpImportDraft = null; byId('mcp-import-preview-panel').hidden = true; renderMcp();
  });
  byId('mcp-import-preview').addEventListener('click', () => mcpPerform('import-preview', async () => {
    mcpImportDraft = await api.mcpPreviewImport(byId('mcp-import-text').value);
    byId('mcp-import-preview-panel').hidden = false;
    renderMcpImport();
  }));
  byId('mcp-import-confirm').addEventListener('click', () => {
    if (!mcpImportDraft?.draftId) return;
    const draftId = mcpImportDraft.draftId;
    mcpPerform('import', async () => {
      const state = await api.mcpCommitImport(draftId);
      mcpImportDraft = null; byId('mcp-import-preview-panel').hidden = true; byId('mcp-import-text').value = '';
      actionMessage = 'MCP 配置已导入，请逐项确认信任与工具授权。';
      return state;
    });
  });
  byId('mcp-export').addEventListener('click', () => mcpPerform('export', async () => {
    const exported = await api.mcpExport();
    byId('mcp-export-text').value = typeof exported === 'string' ? exported : JSON.stringify(exported, null, 2);
    byId('mcp-export-panel').hidden = false;
  }));
  byId('mcp-copy-export').addEventListener('click', () => {
    const input = byId('mcp-export-text'); input.focus(); input.select();
    try { if (!document.execCommand('copy')) throw new Error(); actionMessage = '已复制 MCP 配置。'; }
    catch { actionMessage = '请复制已选中的 MCP 配置。'; }
    render();
  });
  byId('check-update').addEventListener('click', () => updateAction('checkUpdate'));
  byId('download-update').addEventListener('click', () => {
    if (isDirty() || pending) return;
    updateAction(currentState?.updates?.canInstall ? 'installUpdate' : 'downloadUpdate');
  });
  byId('update-release').addEventListener('click', () => updateAction('openRelease'));
  byId('update-notice').addEventListener('click', showUpdates);
  byId('auto-check-updates').addEventListener('change', async event => {
    const enabled = event.target.checked;
    updatePreferencePending = true; updateError = ''; render();
    try { applyState(await api.setAutoCheckUpdates(enabled)); }
    catch (error) { updateError = safeMessage(error); }
    finally { updatePreferencePending = false; render(); }
  });
  api?.onShowUpdates?.(showUpdates);
  document.querySelectorAll('[data-external]').forEach((button) => {
    button.addEventListener('click', () => {
      Promise.resolve(api.openExternal(button.dataset.external)).catch((error) => {
        actionError = safeMessage(error);
        render();
      });
    });
  });
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.tab === 'logs') {
        const nextExpanded = !logMenuExpanded;
        // A disclosure click on the already-visible viewer must not reload
        // the log stream (or reset its scroll position/pause state).
        if (activeTab !== 'logs') showTab('logs');
        setLogMenuExpanded(nextExpanded);
      } else showTab(button.dataset.tab);
    });
    button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' && button.dataset.tab === 'logs') {
        event.preventDefault();
        setLogMenuExpanded(true);
        return;
      }
      if (event.key === 'ArrowLeft' && (button.dataset.tab === 'logs' || button.dataset.tab === 'history')) {
        event.preventDefault();
        showTab('logs', true);
        setLogMenuExpanded(false);
        return;
      }
      // A collapsed submenu must never be reachable via roving tabindex.
      const visibleTabs = tabNames.filter(tab => tab !== 'history' || logMenuExpanded);
      let index = visibleTabs.indexOf(activeTab);
      if (event.key === 'ArrowDown') index = (index + 1) % visibleTabs.length;
      else if (event.key === 'ArrowUp') index = (index + visibleTabs.length - 1) % visibleTabs.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = visibleTabs.length - 1;
      else return;
      event.preventDefault();
      showTab(visibleTabs[index], true);
    });
  });
  // Only the active log panel polls the bounded main-process JSONL tail.
  // Search/filter are local over the last 400 already sanitized log summaries.
  let liveCursor=null,liveEntries=[],liveFilter='all',livePaused=false,liveFollowing=true;
  let liveLoadSerial=0,liveBusy=false;
  const liveCategories={tool:'工具',connection:'连接',system:'系统'};
  function renderLiveLogs(){
    const needle=byId('log-search').value.trim().toLowerCase();
    const filtered=liveEntries.filter(entry=>
      (liveFilter==='all'||liveFilter==='error'&&entry.severity==='error'||entry.category===liveFilter)&&
      (!needle||[entry.at,entry.event,entry.message,entry.category].join(' ').toLowerCase().includes(needle)));
    const viewport=byId('log-stream'),previousScroll=viewport.scrollTop||0;
    const body=byId('log-entries');body.replaceChildren();
    for(const entry of filtered){
      const line=document.createElement('div');line.className='live-log-line';
      if(entry.severity==='error')line.className+=' live-log-line-error';
      const time=document.createElement('time');time.className='live-log-time';
      const parsed=Date.parse(entry.at);
      time.textContent=Number.isFinite(parsed)?new Date(parsed).toLocaleTimeString(locale,{hour12:false}):'--:--:--';
      const kind=document.createElement('span');kind.className='live-log-kind';
      kind.textContent=t(liveCategories[entry.category]||'系统');
      const message=document.createElement('span');message.className='live-log-message';message.textContent=entry.message;
      line.append(time,kind,message);body.append(line);
    }
    if(!filtered.length){
      const empty=document.createElement('p');empty.className='live-log-empty';
      empty.textContent=t(liveEntries.length?'没有符合筛选条件的日志。':'等待新日志…');
      body.append(empty);
    }
    byId('log-count').textContent=t('已显示 {count} 条日志，内存最多保留 400 条。',{count:filtered.length});
    byId('log-live-state').textContent=t(livePaused?'已暂停':'自动更新');
    byId('log-pause').textContent=t(livePaused?'继续':'暂停');
    byId('log-pause').setAttribute('aria-pressed',String(livePaused));
    if(liveFollowing)viewport.scrollTop=viewport.scrollHeight;
    else viewport.scrollTop=previousScroll;
  }
  async function loadLiveLogs(reload=false){
    if(activeTab!=='logs'||livePaused&&!reload||liveBusy&&!reload)return;
    const serial=++liveLoadSerial;
    liveBusy=true;
    try{
      const result=await api.readLiveLogs({cursor:reload?null:liveCursor,limit:200});
      if(serial!==liveLoadSerial||activeTab!=='logs')return;
      if(reload||result.reset)liveEntries=[];
      const seen=new Set(liveEntries.map(entry=>entry.id));
      for(const entry of result.entries||[])if(!seen.has(entry.id)){
        liveEntries.push(entry);seen.add(entry.id);
      }
      if(liveEntries.length>400)liveEntries=liveEntries.slice(-400);
      liveCursor=result.cursor??null;
      byId('log-error').textContent='';
      renderLiveLogs();
      if(result.more&&typeof setTimeout==='function')setTimeout(()=>void loadLiveLogs(),100);
    }catch(error){
      if(serial===liveLoadSerial)byId('log-error').textContent=safeMessage(error);
    }finally{if(serial===liveLoadSerial)liveBusy=false;}
  }
  document.querySelectorAll('[data-log-filter]').forEach(button=>{
    button.addEventListener('click',()=>{
      liveFilter=button.dataset.logFilter;
      document.querySelectorAll('[data-log-filter]').forEach(option=>{
        option.setAttribute('aria-pressed',String(option===button));
        option.className='live-log-filter'+(option===button?' selected':'');
      });
      renderLiveLogs();
    });
  });
  byId('log-search').addEventListener('input',renderLiveLogs);
  byId('log-pause').addEventListener('click',()=>{
    livePaused=!livePaused;renderLiveLogs();
    if(!livePaused)void loadLiveLogs();
  });
  byId('log-follow').addEventListener('change',event=>{
    liveFollowing=event.target.checked;renderLiveLogs();
  });
  byId('log-stream').addEventListener('scroll',()=>{
    if(liveFollowing&&byId('log-stream').scrollHeight-byId('log-stream').scrollTop-byId('log-stream').clientHeight>40){
      liveFollowing=false;byId('log-follow').checked=false;
    }
  });
  byId('log-clear').addEventListener('click',()=>{liveEntries=[];renderLiveLogs();});
  byId('log-reload').addEventListener('click',()=>void loadLiveLogs(true));
  byId('log-open-folder').addEventListener('click',()=>{
    Promise.resolve(api.openLogs()).catch(error=>{byId('log-error').textContent=safeMessage(error);});
  });
  if(typeof setInterval==='function')setInterval(()=>{
    if(activeTab==='logs'&&!document.hidden&&!livePaused)void loadLiveLogs();
  },2000);

  let historyFilter='all',historyOffset=0,historySequence=0,historyDetail=null,historySearchTimer;
  const historySelected=new Set();
  const executionLabels={received:'已接收',waiting_approval:'等待批准',submitted:'任务已提交',running:'执行中',succeeded:'成功',failed:'失败',interrupted:'已中断',unknown:'未知',cancelling:'正在取消',local_write_succeeded:'本机写入成功',local_write_failed:'本机写入失败'};
  async function loadHistory(){
    const sequence=++historySequence;
    try{
      const result=await api.executionList({tab:historyFilter,search:byId('history-search').value,offset:historyOffset,limit:50});
      if(sequence!==historySequence)return;
      byId('history-error').textContent='';
      byId('history-usage').textContent=`${(result.usage/1048576).toFixed(1)} / 50 MiB`;
      byId('history-diagnostics').checked=Boolean(result.diagnostics?.enabled);
      byId('history-page').textContent=`${result.total?historyOffset+1:0}–${Math.min(historyOffset+50,result.total)} / ${result.total}`;
      byId('history-prev').disabled=historyOffset===0;byId('history-next').disabled=historyOffset+50>=result.total;
      const body=byId('history-rows');body.replaceChildren();
      for(const record of result.records){
        const row=document.createElement('tr'),cell=document.createElement('td'),check=document.createElement('input');check.type='checkbox';check.checked=historySelected.has(record.request_id);check.setAttribute('aria-label',record.request_id);
        check.addEventListener('change',()=>{if(check.checked&&historySelected.size<100)historySelected.add(record.request_id);else{historySelected.delete(record.request_id);check.checked=false;}});cell.append(check);row.append(cell);
        for(const value of [new Date(record.last_received_at||record.received_at).toLocaleString(locale),record.tool+' · '+record.operation,record.project||record.service,t(executionLabels[record.state]||record.state)+(record.delivery==='local_write_failed'?' · '+t('本机写入失败'):''),record.duration_ms===undefined?'—':record.duration_ms+' ms']){
          const td=document.createElement('td');td.textContent=value;row.append(td);
        }
        const button=document.createElement('button');button.type='button';button.className='inline-link';button.textContent=row.children[2].textContent;row.children[2].replaceChildren(button);
        button.addEventListener('click',async()=>{try{historyDetail=await api.executionDetail(record.request_id);byId('history-detail').hidden=false;byId('history-detail-text').textContent=JSON.stringify(historyDetail,null,2);}catch(error){byId('history-error').textContent=safeMessage(error);}});
        body.append(row);
      }
    }catch(error){byId('history-error').textContent=safeMessage(error);}
  }
  document.querySelectorAll('[data-history-filter]').forEach(button=>button.addEventListener('click',()=>{historyFilter=button.dataset.historyFilter;historyOffset=0;document.querySelectorAll('[data-history-filter]').forEach(tab=>tab.setAttribute('aria-selected',String(tab===button)));void loadHistory();}));
  byId('history-search').addEventListener('input',()=>{clearTimeout(historySearchTimer);historySearchTimer=setTimeout(()=>{historyOffset=0;void loadHistory();},250);});
  byId('history-refresh').addEventListener('click',()=>void loadHistory());
  byId('history-prev').addEventListener('click',()=>{historyOffset=Math.max(0,historyOffset-50);void loadHistory();});
  byId('history-next').addEventListener('click',()=>{historyOffset+=50;void loadHistory();});
  byId('history-diagnostics').addEventListener('change',async event=>{try{await api.executionDiagnostics(event.target.checked);await loadHistory();}catch(error){byId('history-error').textContent=safeMessage(error);}});
  byId('history-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(JSON.stringify(historyDetail,null,2));}catch(error){byId('history-error').textContent=safeMessage(error);}});
  byId('history-export').addEventListener('click',async()=>{try{
    const records=await api.executionExport([...historySelected]);const url=URL.createObjectURL(new Blob([JSON.stringify(records,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='execution-records.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){byId('history-error').textContent=safeMessage(error);}});
  if(typeof setInterval==='function')setInterval(()=>{if(activeTab==='history'&&!document.hidden)void loadHistory();},5000);

  document.querySelectorAll('[data-navigate]').forEach((button) => {
    button.addEventListener('click', () => showTab(button.dataset.navigate));
  });
  byId('toggle-key').addEventListener('click', () => {
    const visible = keyInput.type === 'password';
    keyInput.type = visible ? 'text' : 'password';
    byId('toggle-key').setAttribute('aria-pressed', String(visible));
    byId('toggle-key').setAttribute('aria-label', visible ? t('隐藏密钥') : t('显示密钥'));
  });
  byId('copy-tunnel').addEventListener('click', async () => {
    const input = byId('tunnel-example');
    if (!currentState?.settings?.tunnelId) return;
    try {
      input.focus();
      input.select();
      if (!document.execCommand('copy')) throw new Error();
      actionMessage = '已复制通道标识。';
    } catch {
      actionMessage = '请复制已选中的通道标识。';
    }
    render();
  });
  [tunnelInput, keyInput, autoConnectInput, autoProjectContextInput].forEach((input) => {
    input.addEventListener('input', () => {
      input.removeAttribute('aria-invalid');
      actionMessage = '';
      render();
    });
  });
  byId('language-select').value = locale;
  byId('language-select').addEventListener('change', async (event) => {
    const selector = event.target;
    selector.disabled = true;
    try { applyState(await api.setLanguage(selector.value)); }
    catch (error) { actionError = safeMessage(error); selector.value = locale; render(); }
    finally { selector.disabled = false; }
  });
  showTab('overview');
  if (!api) {
    actionError = '应用组件未正确载入，请退出后重新打开 ChatToHarness。';
    render();
    return;
  }
  const unsubscribe = api.onState(applyState);
  window.addEventListener('beforeunload', () => { if (typeof unsubscribe === 'function') unsubscribe(); }, { once: true });
  api.getState().then((state) => applyState(state)).catch((error) => { actionError = safeMessage(error); render(); });
})();
