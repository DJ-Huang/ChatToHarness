'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * @typedef {Object} McpServerConfig
 * @property {string} id Stable namespace; display-name changes do not rename tools.
 * @property {string} name
 * @property {boolean} enabled
 * @property {'stdio'|'streamable-http'} transport
 * @property {string} command
 * @property {string[]} args Literal argv, never a shell command line.
 * @property {string} cwd
 * @property {Object<string,string|{secretRef:string}>} env Strings are accepted only on input and encrypted before persistence.
 * @property {string} url
 * @property {Object<string,string|{secretRef:string}>} headers
 * @property {Object<string,{command?:string,args?:string[],cwd?:string}>} platforms darwin/win32 startup overrides.
 * @property {number} timeoutMs Total request budget including local confirmation.
 */

const MAX_BYTES = 2 * 1024 * 1024;
const SERVER_ID = /^[a-z][a-z0-9_-]{0,31}$/;
const SECRET_ID = /^secret_[a-f0-9]{32}$/;
const POLICIES = new Set(['deny', 'allow', 'ask']);
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => structuredClone(value);
const stable = value => JSON.stringify(value, (_key, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const digest = value => crypto.createHash('sha256').update(stable(value)).digest('hex');

class McpSettingsError extends Error {
  constructor(message, code) { super(message); this.name = 'McpSettingsError'; this.code = code; }
}
const fail = (code, message = 'MCP configuration is invalid.') => new McpSettingsError(message, code);

function string(value, max = 8192, empty = true) {
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || (!empty && !value.trim())) {
    throw fail('INVALID_INPUT');
  }
  return value;
}

function id(value) {
  if (typeof value !== 'string' || !SERVER_ID.test(value) || value === 'builtin') throw fail('INVALID_SERVER_ID');
  return value;
}

function absolute(value, platform) {
  return platform === 'win32' ? path.win32.isAbsolute(value) && /^(?:[A-Za-z]:[/\\]|\\\\)/.test(value) : path.posix.isAbsolute(value);
}

function launchFields(input, platform, partial = false) {
  if (!object(input)) throw fail('INVALID_INPUT');
  const result = {};
  if (!partial || has(input, 'command')) {
    result.command = string(input.command ?? '', 8192);
    if (/[\r\n]/.test(result.command)) throw fail('INVALID_COMMAND');
    // Bare executables resolve through PATH. A path must be absolute on its target platform.
    if (result.command && /[/\\]/.test(result.command) && !absolute(result.command, platform)) throw fail('INVALID_COMMAND');
  }
  if (!partial || has(input, 'args')) {
    const args = input.args ?? [];
    if (!Array.isArray(args) || args.length > 256) throw fail('INVALID_ARGUMENTS');
    result.args = args.map(value => string(value, 32768));
  }
  if (!partial || has(input, 'cwd')) {
    result.cwd = string(input.cwd ?? '', 8192);
    if (result.cwd && !absolute(result.cwd, platform)) throw fail('INVALID_CWD');
  }
  return result;
}

function validateUrl(value) {
  string(value, 8192, false);
  let url;
  try { url = new URL(value); } catch { throw fail('INVALID_URL'); }
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.username || url.password || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) throw fail('INVALID_URL');
  return url.toString();
}

function slug(name) {
  const normalized = String(name).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_0-9]+/, '').slice(0, 32);
  return normalized && normalized !== 'builtin' ? normalized : 'server';
}

class McpSettings {
  constructor(directory, safeStorage) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory.includes('\0')) throw fail('UNSAFE_STORAGE');
    this.directory = path.normalize(directory);
    this.file = path.join(this.directory, 'mcp-settings.json');
    this.safeStorage = safeStorage;
    this._drafts = new Map();
    try {
      fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      this._assertDirectory();
      fs.chmodSync(this.directory, 0o700);
    } catch (error) {
      if (error instanceof McpSettingsError) throw error;
      throw fail('STORAGE_UNAVAILABLE', 'MCP settings storage is unavailable.');
    }
    this._state = this._load();
  }

  _assertDirectory() {
    const info = fs.lstatSync(this.directory);
    if (info.isSymbolicLink() || !info.isDirectory()) throw fail('UNSAFE_STORAGE');
  }

  _assertFile() {
    try {
      const info = fs.lstatSync(this.file);
      if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) throw fail('UNSAFE_STORAGE');
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  _load() {
    let descriptor;
    try {
      if (!this._assertFile()) return { schema: 1, servers: [], secrets: {}, trust: {}, grants: {}, allowAllTools: false };
      descriptor = fs.openSync(this.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const info = fs.fstatSync(descriptor);
      if (!info.isFile() || info.nlink !== 1 || info.size > MAX_BYTES) throw fail('INVALID_CONFIG');
      const saved = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
      if (!object(saved) || saved.schema !== 1 || !Array.isArray(saved.servers) || saved.servers.length > 100 ||
          !object(saved.secrets) || !object(saved.trust) || !object(saved.grants) ||
          (has(saved, 'allowAllTools') && typeof saved.allowAllTools !== 'boolean')) throw fail('INVALID_CONFIG');
      const seen = new Set();
      const servers = saved.servers.map(server => {
        const normalized = this._normalize(server, { secrets: saved.secrets, existing: server, loading: true });
        if (seen.has(normalized.id)) throw fail('INVALID_CONFIG');
        seen.add(normalized.id);
        return normalized;
      });
      for (const [ref, secret] of Object.entries(saved.secrets)) {
        if (!SECRET_ID.test(ref) || !object(secret) || !seen.has(secret.serverId) ||
            !['env', 'headers'].includes(secret.field) || typeof secret.key !== 'string' ||
            typeof secret.ciphertext !== 'string' || secret.ciphertext.length > 128 * 1024 ||
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(secret.ciphertext) ||
            !secret.ciphertext || Buffer.from(secret.ciphertext, 'base64').toString('base64') !== secret.ciphertext) throw fail('INVALID_CONFIG');
      }
      for (const [serverId, fingerprint] of Object.entries(saved.trust)) {
        if (!seen.has(serverId) || !/^[a-f0-9]{64}$/.test(fingerprint)) throw fail('INVALID_CONFIG');
      }
      for (const [serverId, grants] of Object.entries(saved.grants)) {
        if (!seen.has(serverId) || !object(grants)) throw fail('INVALID_CONFIG');
        for (const grant of Object.values(grants)) {
          if (!object(grant) || !POLICIES.has(grant.policy) || typeof grant.fingerprint !== 'string' || !grant.fingerprint || grant.fingerprint.length > 256) throw fail('INVALID_CONFIG');
        }
      }
      return { schema: 1, servers, secrets: saved.secrets, trust: saved.trust, grants: saved.grants, allowAllTools: saved.allowAllTools === true };
    } catch (error) {
      if (error instanceof McpSettingsError && error.code === 'UNSAFE_STORAGE') throw error;
      throw fail('INVALID_CONFIG', 'MCP settings cannot be read. The original file has been preserved.');
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }

  _assertEncryption() {
    try {
      if (this.safeStorage?.isEncryptionAvailable() !== true || this.safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw Error();
    } catch { throw fail('ENCRYPTION_UNAVAILABLE', 'System secure storage is unavailable.'); }
  }

  _encrypt(value) {
    this._assertEncryption();
    try {
      const encrypted = this.safeStorage.encryptString(value);
      if (!Buffer.isBuffer(encrypted) || !encrypted.length) throw Error();
      return encrypted.toString('base64');
    } catch { throw fail('ENCRYPTION_FAILED', 'The MCP secret could not be encrypted.'); }
  }

  _normalize(input, { secrets, existing, loading = false, importing = false } = {}) {
    if (!object(input)) throw fail('INVALID_INPUT');
    const serverId = id(input.id);
    const transport = input.transport ?? (input.url ? 'streamable-http' : 'stdio');
    if (!['stdio', 'streamable-http'].includes(transport)) throw fail('INVALID_TRANSPORT');
    const name = string(input.name ?? serverId, 128, false).trim();
    const enabled = input.enabled ?? false;
    if (typeof enabled !== 'boolean') throw fail('INVALID_INPUT');
    const timeoutMs = input.timeoutMs ?? 60000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 90000) throw fail('INVALID_TIMEOUT');
    const platforms = {};
    if (input.platforms !== undefined) {
      if (!object(input.platforms) || Object.keys(input.platforms).some(key => !['darwin', 'win32'].includes(key))) throw fail('INVALID_PLATFORM');
      for (const [platform, value] of Object.entries(input.platforms)) platforms[platform] = launchFields(value, platform, true);
    }
    // Base fields accept either native absolute path form, so an export remains portable.
    const basePlatform = typeof input.command === 'string' && absolute(input.command, 'win32') ? 'win32' :
      typeof input.cwd === 'string' && absolute(input.cwd, 'win32') ? 'win32' : 'darwin';
    const launch = launchFields(input, basePlatform);
    if (transport === 'stdio' && !launch.command && !Object.values(platforms).some(value => value.command)) throw fail('INVALID_COMMAND');
    const result = { id: serverId, name, enabled, transport, ...launch, env: Object.create(null), url: '', headers: Object.create(null), platforms, timeoutMs };
    if (transport === 'streamable-http') result.url = validateUrl(input.url);
    for (const field of ['env', 'headers']) {
      const values = input[field] ?? {};
      if (!object(values) || Object.keys(values).length > 100) throw fail('INVALID_INPUT');
      const seenHeaderNames = new Set();
      for (const [key, value] of Object.entries(values)) {
        if ((field === 'env' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) ||
            (field === 'headers' && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key))) throw fail('INVALID_INPUT');
        if (field === 'headers') {
          if (seenHeaderNames.has(key.toLowerCase())) throw fail('INVALID_INPUT');
          seenHeaderNames.add(key.toLowerCase());
        }
        if (object(value) && Object.keys(value).length === 1 && SECRET_ID.test(value.secretRef)) {
          if (importing) {
            result[field][key] = { secretRef: `secret_${crypto.randomBytes(16).toString('hex')}` };
          } else {
            const previous = existing?.[field]?.[key];
            const secret = secrets[value.secretRef];
            if (previous?.secretRef !== value.secretRef ||
                (secret && (secret.serverId !== serverId || secret.field !== field || secret.key !== key))) throw fail('INVALID_SECRET_REFERENCE');
            result[field][key] = { secretRef: value.secretRef };
          }
        } else {
          if (loading) throw fail('INVALID_CONFIG');
          string(value, 32768);
          if (field === 'headers' && /[\r\n]/.test(value)) throw fail('INVALID_INPUT');
          const secretRef = `secret_${crypto.randomBytes(16).toString('hex')}`;
          secrets[secretRef] = { serverId, field, key, ciphertext: this._encrypt(value) };
          result[field][key] = { secretRef };
        }
      }
    }
    return result;
  }

  _server(serverId) {
    const server = this._state.servers.find(value => value.id === serverId);
    if (!server) throw fail('SERVER_NOT_FOUND');
    return server;
  }

  _fingerprint(server, secrets = this._state.secrets) {
    const { id: _id, name: _name, enabled: _enabled, ...runtime } = server;
    // Ciphertext identifies a secret revision without decrypting or exposing it.
    return digest({ ...runtime, secretRevisions: Object.values({ ...server.env, ...server.headers })
      .map(value => secrets[value.secretRef]?.ciphertext ?? value.secretRef) });
  }

  _public(server) {
    const missingSecrets = [];
    for (const field of [server.transport === 'stdio' ? 'env' : 'headers']) for (const [key, value] of Object.entries(server[field])) {
      if (!has(this._state.secrets, value.secretRef)) missingSecrets.push({ field, key });
    }
    return { ...clone(server), trusted: this._state.trust[server.id] === this._fingerprint(server), missingSecrets };
  }
  list() { return this._state.servers.map(server => this._public(server)); }
  get(serverId) { return this._public(this._server(serverId)); }
  runtimeFingerprint(serverId) { return this._fingerprint(this._server(serverId)); }

  save(input) {
    if (!object(input)) throw fail('INVALID_INPUT');
    const serverId = input.id ?? this._uniqueId(input.name ?? 'server', this._state.servers);
    const existing = this._state.servers.find(server => server.id === serverId);
    if (!existing && this._state.servers.length >= 100) throw fail('SERVER_LIMIT');
    const next = clone(this._state);
    const server = this._normalize({ ...existing, ...input, id: serverId }, { secrets: next.secrets, existing });
    if (!existing || this._fingerprint(existing) !== this._fingerprint(server, next.secrets)) {
      delete next.trust[serverId];
      delete next.grants[serverId];
    }
    const index = next.servers.findIndex(value => value.id === serverId);
    if (index === -1) next.servers.push(server); else next.servers[index] = server;
    this._pruneSecrets(next);
    this._commit(next);
    return this.get(serverId);
  }

  remove(serverId) {
    this._server(serverId);
    const next = clone(this._state);
    next.servers = next.servers.filter(server => server.id !== serverId);
    delete next.trust[serverId];
    delete next.grants[serverId];
    this._pruneSecrets(next);
    this._commit(next);
    return this.list();
  }

  setEnabled(serverId, enabled) { return this.save({ id: serverId, enabled }); }

  trust(serverId) {
    const next = clone(this._state);
    next.trust[serverId] = this.runtimeFingerprint(serverId);
    this._commit(next);
    return this.get(serverId);
  }

  isTrusted(serverId) { return this._state.trust[serverId] === this.runtimeFingerprint(serverId); }

  getAllowAllTools() { return this._state.allowAllTools === true; }

  setAllowAllTools(enabled) {
    if (typeof enabled !== 'boolean') throw fail('INVALID_INPUT');
    if (enabled === this.getAllowAllTools()) return enabled;
    const next = clone(this._state);
    next.allowAllTools = enabled;
    this._commit(next);
    return enabled;
  }

  setToolPolicy(serverId, name, policy, fingerprint) {
    this._server(serverId);
    string(name, 512, false);
    if (!POLICIES.has(policy) || typeof fingerprint !== 'string' || !fingerprint || fingerprint.length > 256) throw fail('INVALID_TOOL_POLICY');
    const next = clone(this._state);
    if (!has(next.grants, serverId)) next.grants[serverId] = {};
    Object.defineProperty(next.grants[serverId], name, { value: { policy, fingerprint }, writable: true, enumerable: true, configurable: true });
    this._commit(next);
    return policy;
  }

  getToolPolicy(serverId, name, fingerprint) {
    this._server(serverId);
    const grants = this._state.grants[serverId];
    const grant = grants && has(grants, name) ? grants[name] : undefined;
    return grant?.fingerprint === fingerprint ? grant.policy : 'deny';
  }

  listToolPolicies(serverId) {
    this._server(serverId);
    return clone(has(this._state.grants, serverId) ? this._state.grants[serverId] : {});
  }

  reconcileTools(serverId, fingerprints) {
    this._server(serverId);
    if (!(fingerprints instanceof Map) && !object(fingerprints)) throw fail('INVALID_TOOL_POLICY');
    const current = new Map(fingerprints instanceof Map ? fingerprints : Object.entries(fingerprints));
    for (const [name, fingerprint] of current) {
      string(name, 512, false);
      if (typeof fingerprint !== 'string' || !fingerprint || fingerprint.length > 256) throw fail('INVALID_TOOL_POLICY');
    }
    const grants = this.listToolPolicies(serverId);
    const stale = Object.keys(grants).filter(name => !current.has(name) || current.get(name) !== grants[name].fingerprint);
    if (stale.length) {
      const next = clone(this._state);
      for (const name of stale) delete next.grants[serverId][name];
      this._commit(next);
    }
    return this.listToolPolicies(serverId);
  }

  resolve(serverId, platform = process.platform) {
    const server = clone(this._server(serverId));
    Object.assign(server, server.platforms[platform] ?? {});
    if (server.transport === 'stdio') {
      if (!server.command || (/[/\\]/.test(server.command) && !absolute(server.command, platform))) throw fail('PLATFORM_UNSUPPORTED');
      if (server.cwd && !absolute(server.cwd, platform)) throw fail('PLATFORM_UNSUPPORTED');
    }
    for (const field of [server.transport === 'stdio' ? 'env' : 'headers']) {
      for (const [key, { secretRef }] of Object.entries(server[field])) {
        const secret = this._state.secrets[secretRef];
        if (!secret) throw fail('SECRET_MISSING', 'A secret must be entered again before connecting.');
        this._assertEncryption();
        try {
          const value = this.safeStorage.decryptString(Buffer.from(secret.ciphertext, 'base64'));
          string(value, 32768);
          if (field === 'headers' && /[\r\n]/.test(value)) throw Error();
          server[field][key] = value;
        } catch { throw fail('DECRYPTION_FAILED', 'An MCP secret could not be decrypted. Enter it again.'); }
      }
    }
    return server;
  }

  _uniqueId(name, servers) {
    const base = slug(name);
    let candidate = base;
    for (let n = 2; servers.some(server => server.id === candidate); n++) candidate = `${base.slice(0, 32 - String(n).length - 1)}-${n}`;
    return candidate;
  }

  previewImport(text) {
    string(text, MAX_BYTES, false);
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw fail('INVALID_IMPORT', 'The MCP import is not valid JSON.'); }
    let entries;
    if (object(parsed) && object(parsed.mcpServers)) {
      entries = Object.entries(parsed.mcpServers).map(([name, server]) => {
        if (!object(server)) throw fail('INVALID_IMPORT');
        if (server.type && !['stdio', 'http', 'streamable-http'].includes(server.type)) throw fail('INVALID_TRANSPORT');
        return { ...server, name, id: undefined, transport: server.transport ?? (server.url ? 'streamable-http' : 'stdio') };
      });
    } else if (object(parsed) && parsed.schema === 1 && Array.isArray(parsed.servers)) entries = parsed.servers;
    else throw fail('INVALID_IMPORT');
    if (!entries.length || entries.length + this._state.servers.length > 100) throw fail('SERVER_LIMIT');
    const draft = { servers: [], secrets: {}, expiresAt: Date.now() + 15 * 60000 };
    const missingSecrets = [];
    for (const entry of entries) {
      if (!object(entry)) throw fail('INVALID_IMPORT');
      const serverId = this._uniqueId(entry.id ?? entry.name ?? 'server', [...this._state.servers, ...draft.servers]);
      const server = this._normalize({ ...entry, id: serverId, enabled: false }, { secrets: draft.secrets, importing: true });
      draft.servers.push(server);
      for (const field of [server.transport === 'stdio' ? 'env' : 'headers']) for (const [key, value] of Object.entries(server[field])) {
        if (!has(draft.secrets, value.secretRef)) missingSecrets.push({ serverId, field, key });
      }
    }
    for (const [key, value] of this._drafts) if (value.expiresAt < Date.now()) this._drafts.delete(key);
    if (this._drafts.size >= 10) this._drafts.delete(this._drafts.keys().next().value);
    const draftId = crypto.randomBytes(24).toString('hex');
    this._drafts.set(draftId, draft);
    return { draftId, servers: clone(draft.servers), missingSecrets };
  }

  commitImport(draftId) {
    const draft = this._drafts.get(draftId);
    if (!draft || draft.expiresAt < Date.now()) { this._drafts.delete(draftId); throw fail('IMPORT_EXPIRED'); }
    const next = clone(this._state);
    if (next.servers.length + draft.servers.length > 100 || draft.servers.some(server => next.servers.some(current => current.id === server.id))) throw fail('IMPORT_CONFLICT');
    next.servers.push(...clone(draft.servers));
    Object.assign(next.secrets, clone(draft.secrets));
    this._commit(next);
    this._drafts.delete(draftId);
    return draft.servers.map(server => this.get(server.id));
  }

  export() { return `${JSON.stringify({ schema: 1, servers: clone(this._state.servers) }, null, 2)}\n`; }

  _pruneSecrets(state) {
    const used = new Set(state.servers.flatMap(server => [...Object.values(server.env), ...Object.values(server.headers)].map(value => value.secretRef)));
    for (const ref of Object.keys(state.secrets)) if (!used.has(ref)) delete state.secrets[ref];
  }

  _commit(next) {
    const serialized = `${JSON.stringify(next, null, 2)}\n`;
    if (Buffer.byteLength(serialized) > MAX_BYTES) throw fail('CONFIG_TOO_LARGE');
    let temporary;
    let descriptor;
    try {
      this._assertDirectory();
      this._assertFile();
      temporary = path.join(this.directory, `.mcp-settings-${crypto.randomBytes(16).toString('hex')}.tmp`);
      descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      fs.fchmodSync(descriptor, 0o600);
      fs.writeFileSync(descriptor, serialized, 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      this._assertDirectory();
      this._assertFile();
      fs.renameSync(temporary, this.file);
      temporary = undefined;
      this._state = next;
    } catch (error) {
      if (error instanceof McpSettingsError) throw error;
      throw fail('WRITE_FAILED', 'MCP settings could not be saved. The original file has been preserved.');
    } finally {
      if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch { /* preserve safe error */ }
      if (temporary) try { fs.unlinkSync(temporary); } catch { /* no plaintext was written */ }
    }
  }
}

module.exports = { McpSettings, McpSettingsError };
