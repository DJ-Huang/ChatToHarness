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
  const cancelled = Symbol('cancelled');
  const tabNames = ['overview', 'connection', 'directories', 'help'];
  const pages = {
    overview: ['工作空间概览', '将 AI 对话连接到本机执行环境。'],
    connection: ['连接配置', '为这个工作空间建立一条安全通道。'],
    directories: ['工作目录', '选择协作范围，自动交付工程规范。'],
    help: ['接入与帮助', '连接客户端，开始第一次本机工具调用。'],
  };
  const stateNames = {
    unconfigured: '尚未配置', stopped: '已停止', checking: '检查中', authorizing: '等待系统授权',
    starting: '连接中', ready: '通道就绪', reconnecting: '重连中', failed: '连接异常',
  };
  const descriptions = {
    unconfigured: '选择工作目录，保存连接配置，即可开始。',
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

  function showTab(name, focus = false) {
    if (!Object.hasOwn(pages, name)) return;
    activeTab = name;
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
      remove.disabled = Boolean(pending);
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
    const locked = Boolean(pending) || transitioning || !initialized;
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
    byId('workspace-save-indicator').textContent = initialized && workspaceDirty() ? t('有未保存的更改') : directories.length ? t('设置已保存') : t('请先添加目录');
    byId('workspace-save-indicator').className = `save-indicator${workspaceDirty() ? ' dirty' : ''}`;
    byId('save-connect').disabled = locked;
    byId('save-connect-label').textContent = pending === 'save' || state === 'starting' ? t('正在连接…') : t('保存并连接');
    byId('save-workspace').disabled = locked || !directories.length;
    byId('check-connection').disabled = locked || !directories.length;
    byId('check-connection').textContent = pending === 'check' || state === 'checking' ? t('检查中…') : t('检查本机工具');
    byId('reconnect').disabled = locked || !keySaved || !currentState?.settings?.tunnelId;
    byId('reconnect-label').textContent = ['ready', 'reconnecting', 'failed'].includes(state) ? t('重新连接') : t('连接通道');
    byId('stop').disabled = (!active && !['save', 'check', 'reconnect'].includes(pending)) || pending === 'stop';
    byId('clear-credentials').disabled = locked || (!keySaved && !currentState?.settings?.tunnelId && !keyInput.value);
    byId('add-directory').disabled = Boolean(pending) || !initialized;
    [tunnelInput, keyInput, autoConnectInput, autoProjectContextInput].forEach((input) => { input.disabled = ['save', 'workspace', 'clear'].includes(pending); });
    byId('action-message').textContent = t(actionMessage);
    const error = actionError || (state === 'failed' ? runtime.error : '') || '';
    byId('error-banner').hidden = !error;
    byId('error-message').textContent = t(error);
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
    if (!directories.length) {
      actionError = '请至少添加一个工作目录。';
      showTab('directories');
      byId('add-directory').focus();
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
  document.querySelectorAll('[data-external]').forEach((button) => {
    button.addEventListener('click', () => {
      Promise.resolve(api.openExternal(button.dataset.external)).catch((error) => {
        actionError = safeMessage(error);
        render();
      });
    });
  });
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => showTab(button.dataset.tab));
    button.addEventListener('keydown', (event) => {
      let index = tabNames.indexOf(activeTab);
      if (event.key === 'ArrowDown') index = (index + 1) % tabNames.length;
      else if (event.key === 'ArrowUp') index = (index + tabNames.length - 1) % tabNames.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = tabNames.length - 1;
      else return;
      event.preventDefault();
      showTab(tabNames[index], true);
    });
  });
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
