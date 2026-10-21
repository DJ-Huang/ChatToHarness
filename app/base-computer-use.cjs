'use strict';
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {createInterface} = require('node:readline');
const {compressCapture, snapshot, readChunk, MAX_CAPTURE_BYTES, MAX_CHUNK_BYTES} = require('./computer-use-images.cjs');
const ACTIONS = ['list_windows', 'open_session', 'get_session', 'activate', 'observe', 'read_screenshot', 'click', 'mouse_move', 'mouse_down', 'mouse_drag', 'mouse_up', 'type_text', 'key_press', 'scroll', 'close_session'];
const KEYS = ['ENTER', 'TAB', 'BACKSPACE', 'DELETE', 'LEFT', 'RIGHT', 'UP', 'DOWN', 'HOME', 'END', 'PAGEUP', 'PAGEDOWN', 'CTRL+A', 'CTRL+C', 'CTRL+V', 'CTRL+Z', 'CTRL+Y', 'SHIFT+TAB'];
const definition = {
  name: 'computer_use', title: 'Windows computer use',
  description: 'Computer Use requires native OS permissions, per-window authorization and fresh observations before every input',
  inputSchema: {type: 'object', additionalProperties: false, required: ['action'], properties: {
    action: {type: 'string', enum: ACTIONS}, session_id: {type: 'string'}, observation_id: {type: 'string'}, window_id: {type: 'string', pattern: '^[1-9][0-9]{0,18}$'},
    format: {type: 'string', enum: ['auto', 'png', 'webp']}, delivery: {type: 'string', enum: ['auto', 'chunked']}, screenshot_id: {type: 'string'},
    offset: {type: 'integer', minimum: 0, maximum: MAX_CAPTURE_BYTES}, length: {type: 'integer', minimum: 1, maximum: MAX_CHUNK_BYTES},
    x: {type: 'integer', minimum: 0}, y: {type: 'integer', minimum: 0},
    button: {type: 'string', enum: ['left', 'right']}, screen_x: {type: 'integer', minimum: -32768, maximum: 32767}, screen_y: {type: 'integer', minimum: -32768, maximum: 32767}, text: {type: 'string', maxLength: 1000},
    key: {type: 'string', enum: KEYS}, delta: {type: 'integer', minimum: -10, maximum: 10}
  }},
  outputSchema: {type: 'object', additionalProperties: true, properties: {
    session_id: {type: ['string', 'null']}, state: {type: 'string', enum: ['none', 'initializing', 'awaiting_consent', 'ready', 'closed']},
    authorization_mode: {type: 'string', enum: ['all_windows', 'per_window']},
    observation_id: {type: 'string'}, next_action: {type: 'string'}, code: {type: 'string'}
  }},
  annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true}
};
const SCREENSHOT_DESCRIPTION = ' If the target loses focus, call activate with session_id, then observe. Never replay input automatically. observe format auto compares lossless WebP and optimized PNG, keeping the smaller at original resolution; format png/webp forces compatibility. Small images return MCP image content and structuredContent.screenshot.data base64. Large images (or delivery chunked) return screenshot metadata only: call read_screenshot with session_id, screenshot_id, byte offset and optional length (default 256 KiB, max 512 KiB). Decode each chunk separately, concatenate bytes in offset order, verify full sha256 and display using mime_type. Repeat reads are safe; next_offset/eof supports resuming. Only the latest snapshot is kept in memory for 120 seconds, cleared by observe, activation, input or close. Chunk reads never refresh the 30-second input observation deadline; obtain a new observation before input if stale. No screenshot files are saved. The native capture guard is 40 MiB, not a per-call network limit.';
definition.description += SCREENSHOT_DESCRIPTION;
definition.outputSchema.properties.screenshot = {type: 'object', additionalProperties: true, required: ['screenshot_id', 'mime_type', 'encoding', 'sha256', 'byte_length', 'delivery'], properties: {
  screenshot_id: {type: 'string'}, mime_type: {type: 'string', enum: ['image/png', 'image/webp']}, encoding: {type: 'string', const: 'base64'}, data: {type: 'string', maxLength: 1398104},
  sha256: {type: 'string'}, byte_length: {type: 'integer', maximum: MAX_CAPTURE_BYTES}, delivery: {type: 'string', enum: ['inline', 'chunked']}
}};
const fail = code => Object.assign(new Error(code), {code});
const fields = {
  list_windows: [], open_session: ['window_id'], get_session: ['session_id'], activate: ['session_id'], observe: ['session_id', 'format', 'delivery'], close_session: ['session_id'],
  read_screenshot: ['session_id', 'screenshot_id', 'offset', 'length'],
  click: ['session_id', 'observation_id', 'x', 'y', 'button'],
  mouse_move: ['session_id', 'observation_id', 'x', 'y'],
  mouse_down: ['session_id', 'observation_id', 'x', 'y'],
  mouse_drag: ['session_id', 'observation_id', 'screen_x', 'screen_y'],
  mouse_up: ['session_id'],
  type_text: ['session_id', 'observation_id', 'text'], key_press: ['session_id', 'observation_id', 'key'],
  scroll: ['session_id', 'observation_id', 'x', 'y', 'delta']
};
function validate(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || !ACTIONS.includes(args.action)) throw fail('CU_INVALID_ARGUMENT');
  const allowed = fields[args.action];
  if (Object.keys(args).some(k => k !== 'action' && !allowed.includes(k))) throw fail('CU_INVALID_ARGUMENT');
  for (const k of allowed) if (args[k] === undefined && !['button','window_id','format','delivery','offset','length'].includes(k) && !(k === 'session_id' && ['get_session', 'close_session'].includes(args.action))) throw fail('CU_INVALID_ARGUMENT');
  if (args.format !== undefined && !['auto', 'png', 'webp'].includes(args.format)) throw fail('CU_INVALID_ARGUMENT');
  if (args.delivery !== undefined && !['auto', 'chunked'].includes(args.delivery)) throw fail('CU_INVALID_ARGUMENT');
  if (args.offset !== undefined && (!Number.isSafeInteger(args.offset) || args.offset < 0 || args.offset > MAX_CAPTURE_BYTES)) throw fail('CU_INVALID_ARGUMENT');
  if (args.length !== undefined && (!Number.isSafeInteger(args.length) || args.length < 1 || args.length > MAX_CHUNK_BYTES)) throw fail('CU_INVALID_ARGUMENT');
  if (args.window_id !== undefined && (typeof args.window_id !== 'string' || !/^[1-9][0-9]{0,18}$/.test(args.window_id))) throw fail('CU_INVALID_ARGUMENT');
  for (const k of ['session_id', 'observation_id', 'screenshot_id']) if (args[k] !== undefined && (typeof args[k] !== 'string' || !args[k].length || args[k].length > 100)) throw fail('CU_INVALID_ARGUMENT');
  for (const k of ['x', 'y']) if (args[k] !== undefined && (!Number.isSafeInteger(args[k]) || args[k] < 0 || args[k] > 32767)) throw fail('CU_INVALID_ARGUMENT');
  for (const k of ['screen_x', 'screen_y']) if (args[k] !== undefined && (!Number.isSafeInteger(args[k]) || args[k] < -32768 || args[k] > 32767)) throw fail('CU_INVALID_ARGUMENT');
  if (args.button !== undefined && !['left', 'right'].includes(args.button)) throw fail('CU_INVALID_ARGUMENT');
  if (args.action === 'type_text' && (typeof args.text !== 'string' || !args.text.length || args.text.length > 1000 || /[\x00-\x1f\x7f]/.test(args.text))) throw fail('CU_INVALID_ARGUMENT');
  if (args.action === 'key_press' && !KEYS.includes(args.key)) throw fail('CU_INVALID_ARGUMENT');
  if (args.action === 'scroll' && (!Number.isInteger(args.delta) || !args.delta || Math.abs(args.delta) > 10)) throw fail('CU_INVALID_ARGUMENT');
  return args;
}
class NativeConnection {
  constructor(executable, {operation, mode = 'all_windows', window_id, session_id} = {}) {
    const nativeArguments=[String(process.pid), operation === 'list_windows' ? 'list_windows' : mode, window_id || '0'];
    // The native macOS HUD shows the actual MCP session, never a fabricated ID.
    // Windows native CLI retains its original strict three-argument contract.
    if (process.platform === 'darwin' && session_id && operation !== 'list_windows')
      nativeArguments.push(session_id);
    this.child = spawn(executable, nativeArguments, {windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'ignore'], env: Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(SystemRoot|WINDIR|TEMP|TMP|USERPROFILE|HOME|TMPDIR|USER|LOGNAME|LANG)$/i.test(k)))});
    this.pending = null;
    this.ready = new Promise((resolve, reject) => { this.initial = {resolve, reject}; });
    this.lines = createInterface({input: this.child.stdout});
    this.lines.on('line', line => {
      if (Buffer.byteLength(line) > 64 * 1024 * 1024) return this.stop('CU_RESULT_TOO_LARGE');
      let data; try { data = JSON.parse(line); } catch { return this.stop('CU_PROTOCOL_ERROR'); }
      const waiter = this.initial || this.pending; this.initial = null; this.pending = null;
      if (!waiter) return this.stop('CU_PROTOCOL_ERROR');
      data.error ? waiter.reject(fail(/^CU_[A-Z_]+$/.test(data.error) ? data.error : 'CU_NATIVE_ERROR')) : waiter.resolve(data);
    });
    this.child.on('error', () => this.stop('CU_HELPER_UNAVAILABLE'));
    this.child.on('exit', () => this.stop('CU_SESSION_CLOSED'));
    this.child.stdin.on('error', () => this.stop('CU_SESSION_CLOSED'));
  }
  request(args) {
    if (this.closed || this.pending) return Promise.reject(fail('CU_SESSION_CLOSED'));
    return new Promise((resolve, reject) => { this.pending = {resolve, reject}; this.child.stdin.write(JSON.stringify(args) + '\n'); });
  }
  stop(code = 'CU_SESSION_CLOSED') {
    if (this.closed) return;
    this.closed = true;
    this.initial?.reject(fail(code)); this.pending?.reject(fail(code));
    this.initial = this.pending = null;
    if (this.mouseHeld && this.child.exitCode === null) {
      // Best-effort grace for an in-flight synthetic left-down. The native
      // helper also releases on local STOP, EOF, failure and 30s idle timeout.
      try { this.child.stdin.write(JSON.stringify({action:'mouse_up'}) + '\n'); } catch {}
      this.child.stdin.end();
      const killer = setTimeout(() => this.child.kill(), 5000);
      killer.unref?.();
    } else {
      this.child.stdin.destroy(); this.child.kill();
    }
    this.lines.close();
  }
}
class BaseComputerUse {
  constructor({platform = process.platform, connect, helperPath, timeoutMs = 45000, supportedPlatform, authorizationMode = process.env.CTH_COMPUTER_USE_AUTHORIZATION_MODE || 'all_windows', onPermissionDenied} = {}) {
    if (!['darwin', 'win32'].includes(supportedPlatform)) throw fail('CU_PLATFORM_UNSUPPORTED');
    if (typeof helperPath !== 'string' || !helperPath) throw fail('CU_HELPER_UNAVAILABLE');
    if (!['all_windows','per_window'].includes(authorizationMode)) throw fail('CU_INVALID_AUTHORIZATION_MODE');
    this.authorizationMode = authorizationMode; this.onPermissionDenied = onPermissionDenied;
    this.platform = platform; this.supportedPlatform = supportedPlatform; this.connect = connect || (options => new NativeConnection(helperPath, options));
    this.timeoutMs = timeoutMs; this.session = null; this.lastSession = null; this.busy = false; this.operation = null;
  }
  status(s = this.session) {
    if (!s) return this.lastSession || {state: 'none', session_id: null, authorization_mode: this.authorizationMode, next_action: 'open_session'};
    return {session_id: s.id, state: s.state, authorization_mode: this.authorizationMode, ...(s.windowId ? {window_id: s.windowId} : {}), expires_at: new Date(s.expiresAt).toISOString(),
      expires_in_ms: Math.max(0, s.expiresAt - Date.now()),
      stop_hotkey: s.inputEnabled === false ? null : 'Esc', mouse_button_held: !!s.mouseHeld,
      ...(typeof s.inputEnabled === 'boolean' ? {input_enabled: s.inputEnabled} : {}),
      ...(s.inputBlockedReason ? {input_blocked_reason: s.inputBlockedReason} : {}),
      next_action: s.state === 'ready' ? 'observe' : 'get_session', ...(s.error ? {code: s.error} : {})};
  }
  stop(code = 'CU_SESSION_CLOSED', s = this.session) {
    if (!s || this.session !== s) return;
    clearTimeout(s.consentTimer);
    this.clearCapture(s);
    this.session = null; this.busy = false; this.operation = null;
    s.state = 'closed'; s.error = code; s.observation = null; s.capture = null;
    this.lastSession = {...this.status(s), expires_in_ms: 0, next_action: 'open_session'};
    s.native.stop();
  }
  clearCapture(s) { clearTimeout(s.captureTimer); s.capture = null; }
  reconcile() {
    const s = this.session;
    if (s && (s.native.closed || Date.now() >= s.expiresAt)) this.stop(s.native.closed ? 'CU_SESSION_CLOSED' : 'CU_SESSION_EXPIRED', s);
    else if (s?.capture && Date.now() >= s.capture.expiresAt) s.capture = null;
  }
  async listWindows(signal) {
    if (this.authorizationMode !== 'all_windows') throw fail('CU_WINDOW_LIST_NOT_AUTHORIZED');
    const native = this.connect({operation: 'list_windows'});
    const stop = () => native.stop(); const timer = setTimeout(stop, this.timeoutMs);
    signal?.addEventListener('abort',stop,{once:true});
    try { const value = await native.ready; if (!Array.isArray(value.windows) || value.windows.length > 256) throw fail('CU_PROTOCOL_ERROR'); return this.result({authorization_mode:this.authorizationMode,windows:value.windows}); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort',stop); native.stop(); }
  }
  open(args) {
    if (this.session) {
      if (args.window_id && args.window_id !== this.session.windowId) throw fail('CU_SESSION_TARGET_MISMATCH');
      return this.result({...this.status(), reused: true});
    }
    const sessionID=crypto.randomUUID();
    const s = {id: sessionID, native: this.connect({mode:this.authorizationMode,window_id:args.window_id,session_id:sessionID}), windowId:args.window_id,
      state: this.authorizationMode === 'per_window' ? 'awaiting_consent' : 'initializing', mouseHeld: false, expiresAt: Date.now() + 600000};
    this.session = s;
    s.consentTimer = setTimeout(() => this.stop(this.authorizationMode === 'per_window' ? 'CU_CONSENT_TIMEOUT' : 'CU_SESSION_START_TIMEOUT', s), this.timeoutMs);
    s.consentTimer.unref?.();
    // Consent belongs to the session, not the lifetime of this short MCP call.
    // Every outcome is observed; a cancelled/lost opening response cannot orphan
    // an inaccessible session or cause an unhandled ready rejection.
    Promise.resolve(s.native.ready).then(data => {
      clearTimeout(s.consentTimer);
      if (this.session === s && !s.native.closed) {
        s.state = 'ready'; s.windowId = data.window_id || s.windowId;
        if (typeof data.input_enabled === 'boolean') s.inputEnabled = data.input_enabled;
        if (typeof data.input_blocked_reason === 'string') s.inputBlockedReason = data.input_blocked_reason;
        if (data.input_enabled === false &&
          /^(CU_SCREEN_RECORDING_REQUIRED|CU_ACCESSIBILITY_REQUIRED)$/.test(data.input_blocked_reason || ''))
          this.onPermissionDenied?.(data.input_blocked_reason);
      }
    }, error => {
      const code=/^CU_[A-Z_]+$/.test(error.code || '') ? error.code : 'CU_NATIVE_ERROR';
      this.stop(code, s);
      if (['CU_SCREEN_RECORDING_REQUIRED','CU_ACCESSIBILITY_REQUIRED','CU_CONSENT_DENIED'].includes(code))
        this.onPermissionDenied?.(code);
    });
    return this.result({...this.status(s), reused: false});
  }
  async call(input, {signal} = {}) {
    let started = false, timer, abort, operation, activeSession;
    try {
      const args = validate(input);
      if (this.platform !== this.supportedPlatform) throw fail(this.supportedPlatform === 'darwin' ? 'CU_MACOS_REQUIRED' : 'CU_WINDOWS_REQUIRED');
      signal?.throwIfAborted();
      this.reconcile();
      if (args.action === 'list_windows') return await this.listWindows(signal);
      if (args.action === 'get_session') {
        if (args.session_id && args.session_id !== (this.session?.id || this.lastSession?.session_id)) throw fail('CU_SESSION_CLOSED');
        return this.result(this.status());
      }
      if (args.action === 'close_session') {
        if (args.session_id && args.session_id !== (this.session?.id || this.lastSession?.session_id)) throw fail('CU_SESSION_CLOSED');
        const id = this.session?.id || this.lastSession?.session_id || null;
        this.stop(); return this.result({session_id: id, state: 'closed', closed: true});
      }
      if (args.action === 'open_session') return this.open(args);
      if (!this.session || args.session_id !== this.session.id) throw fail('CU_SESSION_CLOSED');
      if (this.session.state !== 'ready') throw fail(this.authorizationMode === 'per_window' ? 'CU_CONSENT_PENDING' : 'CU_SESSION_STARTING');
      if (this.busy) throw fail('CU_BUSY');
      if (args.action === 'read_screenshot') {
        const chunk = readChunk(this.session.capture, args.screenshot_id, args.offset, args.length);
        const {data, ...metadata} = chunk;
        return {...this.result({session_id: this.session.id, screenshot: metadata}), structuredContent: {session_id: this.session.id, screenshot: chunk}};
      }
      activeSession = this.session;
      this.busy = true;
      operation = {}; this.operation = operation;
      abort = () => this.stop('CU_CANCELLED', activeSession); signal?.addEventListener('abort', abort, {once: true});
      timer = setTimeout(() => this.stop('CU_TIMEOUT', activeSession), this.timeoutMs);
      const s = activeSession;
      const isInput = ['click', 'type_text', 'key_press', 'scroll', 'mouse_move', 'mouse_down', 'mouse_drag'].includes(args.action);
      if (s.mouseHeld && !['mouse_drag', 'mouse_up', 'observe'].includes(args.action)) throw fail('CU_MOUSE_BUTTON_HELD');
      if (args.action === 'mouse_drag' && !s.mouseHeld) throw fail('CU_MOUSE_NOT_HELD');
      if (args.action === 'mouse_up' && !s.mouseHeld) throw fail('CU_MOUSE_NOT_HELD');
      if (args.action === 'mouse_down' && s.mouseHeld) throw fail('CU_MOUSE_BUTTON_HELD');
      if (isInput) {
        if (!s.observation || Date.now() - s.observation.at > 30000 || args.observation_id !== s.observation.id) throw fail('CU_STALE_OBSERVATION');
        if (args.x !== undefined && (args.x >= s.observation.width || args.y >= s.observation.height)) throw fail('CU_COORDINATE_OUTSIDE_WINDOW');
        if (args.action === 'mouse_drag' && !s.observation.displays.some(d =>
          args.screen_x >= d.x && args.screen_x < d.x + d.width &&
          args.screen_y >= d.y && args.screen_y < d.y + d.height)) throw fail('CU_COORDINATE_OUTSIDE_DISPLAY');
      }
      const observation = s.observation; s.observation = null; this.clearCapture(s);
      const {session_id, observation_id, format, delivery, ...command} = args;
      started = args.action !== 'observe';
      const data = await s.native.request({...command, ...(isInput ? {geometry: observation.geometry} : {})});
      if (this.session !== s || this.operation !== operation) throw fail('CU_SESSION_CLOSED');
      if (args.action === 'activate' && data.foreground !== true) throw fail('CU_ACTIVATION_FAILED');
      if (args.action === 'observe') {
        if (!Number.isInteger(data.width) || !Number.isInteger(data.height) || data.width < 1 || data.height < 1 || data.width > 4096 || data.height > 4096 || data.width * data.height > 8388608 || typeof data.png !== 'string' || data.png.length > Math.ceil(MAX_CAPTURE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.png) || !Array.isArray(data.geometry) || data.geometry.length !== 4) throw fail('CU_INVALID_CAPTURE');
        const png = Buffer.from(data.png, 'base64');
        if (png.length > MAX_CAPTURE_BYTES) throw fail('CU_CAPTURE_TOO_LARGE');
        if (png.length < 8 || !png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || png.toString('base64') !== data.png) throw fail('CU_INVALID_CAPTURE');
        const capturedAt = Date.now();
        const compressed = await compressCapture(png, data.width, data.height, format);
        if (this.session !== s || this.operation !== operation) throw fail('CU_SESSION_CLOSED');
        s.capture = snapshot(compressed, delivery);
        s.captureTimer = setTimeout(() => this.clearCapture(s), Math.max(0, s.capture.expiresAt - Date.now()));
        s.captureTimer.unref?.();
        const displays = Array.isArray(data.displays) && data.displays.length <= 32 &&
          data.displays.every(d => d && ['x','y','width','height'].every(k => Number.isSafeInteger(d[k])) &&
            d.width > 0 && d.height > 0 && d.width <= 32768 && d.height <= 32768) ? data.displays : [];
        s.observation = {id: crypto.randomUUID(), at: capturedAt, width: data.width, height: data.height, geometry: data.geometry, displays};
        const metadata = {session_id: s.id, observation_id: s.observation.id, width: data.width, height: data.height, coordinate_space: 'window_pixels', desktop_displays: displays, desktop_coordinate_space: this.platform === 'darwin' ? 'quartz_points' : 'virtual_screen_pixels'};
        const screenshot = s.capture.metadata;
        if (screenshot.delivery === 'chunked') return this.result({...metadata, screenshot, next_action: 'read_screenshot'});
        const encoded = s.capture.bytes.toString('base64');
        return {...this.result({...metadata, screenshot, image_delivery: 'MCP image content and structuredContent.screenshot.data; honor screenshot.mime_type'}, [{type: 'image', mimeType: screenshot.mime_type, data: encoded}]), structuredContent: {...metadata, screenshot: {...screenshot, data: encoded}}};
      }
      if (args.action === 'mouse_down') { s.mouseHeld = true; s.native.mouseHeld = true; }
      if (args.action === 'mouse_up') { s.mouseHeld = false; s.native.mouseHeld = false; }
      return this.result({session_id: s.id, action: args.action, mouse_button_held: !!s.mouseHeld, execution_state: 'complete', observe_required: true, ...(args.action === 'activate' ? {foreground: true, next_action: 'observe'} : {})});
    } catch (error) {
      // A native failure during a hold/drag may have occurred after injecting down.
      // Kill the helper to trigger its guaranteed mouse-up cleanup; never retry.
      if (activeSession && ['mouse_down', 'mouse_drag', 'mouse_up'].includes(input?.action) &&
          this.session === activeSession && started)
        this.stop('CU_DRAG_ABORTED', activeSession);
      const code = /^CU_[A-Z_]+$/.test(error.code || '') ? error.code : 'CU_CANCELLED';
      return {...this.result({code, execution_state: started ? 'unknown' : 'not_started', operation_executed: started ? null : false,
        ...(['CU_CONSENT_PENDING','CU_SESSION_STARTING'].includes(code) ? this.status() : {}), next_action: code === 'CU_SCREENSHOT_EXPIRED' ? 'observe' : code === 'CU_WINDOW_NOT_FOREGROUND' ? 'activate' : code === 'CU_ACTIVATION_FAILED' ? 'Manually activate the authorized window, then observe; do not replay input.' : 'get_session'}), isError: true};
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      // Rejected concurrent calls must not unlock the active operation.
      if (operation && this.operation === operation) { this.busy = false; this.operation = null; }
    }
  }
  result(data, content = []) { return {content: [{type: 'text', text: JSON.stringify(data)}, ...content], structuredContent: data}; }
}
module.exports = {BaseComputerUse, NativeConnection, baseDefinition: definition, validate, KEYS, SCREENSHOT_DESCRIPTION};
