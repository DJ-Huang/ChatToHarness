'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CONFIG_NAME = 'settings.json';
const MAX_CONFIG_BYTES = 128 * 1024;
const TUNNEL_ID = /^tunnel_[a-z0-9]{32}$/;
const has = (value, property) => Object.prototype.hasOwnProperty.call(value, property);

class SettingsError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SettingsError';
    this.code = code;
  }
}

function failure(message, code) {
  return new SettingsError(message, code);
}

function directories(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw failure('请至少选择一个有效的本机文件夹。', 'INVALID_DIRECTORY');
  }
  const result = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !path.isAbsolute(entry) || entry.includes('\0')) {
      throw failure('文件夹必须是已存在的绝对路径。', 'INVALID_DIRECTORY');
    }
    let canonical;
    try {
      canonical = fs.realpathSync(entry);
      if (!fs.statSync(canonical).isDirectory()) throw new Error('not a directory');
    } catch {
      throw failure('有文件夹不存在或无法读取，请重新选择。', 'INVALID_DIRECTORY');
    }
    if (!result.includes(canonical)) result.push(canonical);
  }
  return result;
}

function savedDirectories(value) {
  if (!Array.isArray(value) || value.length > 100 ||
      value.some(entry => typeof entry !== 'string' || !path.isAbsolute(entry) || entry.includes('\0'))) {
    throw failure('已保存的文件夹路径格式无效。', 'INVALID_DIRECTORY');
  }
  // A moved folder or an offline volume must remain editable in the UI.
  return [...new Set(value.map(entry => path.normalize(entry)))];
}

function validateKey(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\r\n\0]/.test(value)) {
    throw failure('Runtime API Key 格式无效，请粘贴一行完整密钥。', 'INVALID_KEY');
  }
  return value.trim();
}

function validateTunnel(value, allowEmpty = false) {
  if (typeof value !== 'string') {
    throw failure('Tunnel ID 格式无效，应为 tunnel_ 加 32 位小写字母或数字。', 'INVALID_TUNNEL');
  }
  const normalized = value.trim();
  if (!(allowEmpty && normalized === '') && !TUNNEL_ID.test(normalized)) {
    throw failure('Tunnel ID 格式无效，应为 tunnel_ 加 32 位小写字母或数字。', 'INVALID_TUNNEL');
  }
  return normalized;
}

class Settings {
  constructor(directory, safeStorage, { defaultDirectory } = {}) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory.includes('\0')) {
      throw failure('本机配置目录无效。', 'UNSAFE_STORAGE');
    }
    this.directory = path.normalize(directory);
    this.file = path.join(this.directory, CONFIG_NAME);
    this.safeStorage = safeStorage;
    this._prepareDirectory();
    this._configuration = this._load(defaultDirectory);
  }

  _prepareDirectory() {
    try {
      fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      this._assertDirectory();
      fs.chmodSync(this.directory, 0o700);
    } catch (error) {
      if (error instanceof SettingsError) throw error;
      throw failure('无法访问本机配置目录，请检查文件权限。', 'STORAGE_UNAVAILABLE');
    }
  }

  _assertDirectory() {
    const info = fs.lstatSync(this.directory);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw failure('本机配置目录必须是普通文件夹，不能是符号链接。', 'UNSAFE_STORAGE');
    }
  }

  _assertConfigurationFile() {
    try {
      const info = fs.lstatSync(this.file);
      if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) {
        throw failure('配置文件不是独立的普通文件，请检查本机配置目录。', 'UNSAFE_STORAGE');
      }
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  _load(defaultDirectory) {
    let descriptor;
    try {
      if (!this._assertConfigurationFile()) {
        return { schema: 1, tunnelId: '', encryptedKey: '', directories: defaultDirectory ? directories([defaultDirectory]) : [], autoConnect: true, autoProjectContext: true };
      }
      descriptor = fs.openSync(this.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const info = fs.fstatSync(descriptor);
      if (!info.isFile() || info.nlink !== 1 || info.size > MAX_CONFIG_BYTES) throw new Error('invalid file');
      const saved = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
      if (!saved || typeof saved !== 'object' || Array.isArray(saved) || saved.schema !== 1 ||
          typeof saved.autoConnect !== 'boolean' || typeof saved.encryptedKey !== 'string' ||
          saved.encryptedKey.length > 64 * 1024 ||
          (has(saved, 'autoProjectContext') && typeof saved.autoProjectContext !== 'boolean')) throw new Error('invalid configuration');
      const ciphertext = saved.encryptedKey;
      if (ciphertext && (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(ciphertext) ||
          Buffer.from(ciphertext, 'base64').toString('base64') !== ciphertext)) throw new Error('invalid ciphertext');
      return {
        schema: 1,
        tunnelId: validateTunnel(saved.tunnelId, true),
        encryptedKey: ciphertext,
        directories: savedDirectories(saved.directories),
        autoConnect: saved.autoConnect,
        autoProjectContext: saved.autoProjectContext !== false,
      };
    } catch (error) {
      if (error instanceof SettingsError && error.code === 'UNSAFE_STORAGE') throw error;
      throw failure('本机配置文件无法读取或格式无效。原文件已保留，请查看帮助后修复。', 'INVALID_CONFIG');
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }

  public() {
    const saved = this._configuration;
    return {
      tunnelId: saved.tunnelId,
      directories: [...saved.directories],
      autoConnect: saved.autoConnect,
      autoProjectContext: saved.autoProjectContext,
      keySaved: saved.encryptedKey !== '',
    };
  }

  _assertEncryption() {
    try {
      if (this.safeStorage?.isEncryptionAvailable() !== true || this.safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw new Error('unavailable');
    } catch {
      throw failure('系统安全存储当前不可用，无法保存或读取密钥。请完成系统授权后重试。', 'ENCRYPTION_UNAVAILABLE');
    }
  }

  getKey() {
    if (!this._configuration.encryptedKey) return '';
    this._assertEncryption();
    try {
      const key = this.safeStorage.decryptString(Buffer.from(this._configuration.encryptedKey, 'base64'));
      const normalized = validateKey(key);
      if (!normalized) throw new Error('empty key');
      return normalized;
    } catch {
      throw failure('无法解密已保存的 Runtime API Key，请重新输入密钥。', 'DECRYPTION_FAILED');
    }
  }

  save(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw failure('配置内容无效，请重新填写。', 'INVALID_INPUT');
    }
    const next = { ...this._configuration,
      directories: directories(has(input, 'directories') ? input.directories : this._configuration.directories) };
    if (has(input, 'tunnelId')) next.tunnelId = validateTunnel(input.tunnelId);
    if (has(input, 'autoConnect')) {
      if (typeof input.autoConnect !== 'boolean') throw failure('自动连接设置无效。', 'INVALID_INPUT');
      next.autoConnect = input.autoConnect;
    }
    if (has(input, 'autoProjectContext')) {
      if (typeof input.autoProjectContext !== 'boolean') throw failure('工程规范设置无效。', 'INVALID_INPUT');
      next.autoProjectContext = input.autoProjectContext;
    }
    const key = has(input, 'apiKey') ? validateKey(input.apiKey) : '';
    if (key) {
      if (!next.tunnelId) throw failure('请先填写 Tunnel ID。', 'INVALID_TUNNEL');
      this._assertEncryption();
      try {
        const encrypted = this.safeStorage.encryptString(key);
        if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) throw new Error('encryption failed');
        next.encryptedKey = encrypted.toString('base64');
      } catch {
        throw failure('无法加密 API Key，原配置已保留。请检查系统安全存储授权。', 'ENCRYPTION_FAILED');
      }
    } else if (next.encryptedKey) {
      this._assertEncryption();
    }
    this._write(next);
    this._configuration = next;
    return this.public();
  }

  clearCredentials() {
    const next = { ...this._configuration, tunnelId: '', encryptedKey: '', autoConnect: false };
    this._write(next);
    this._configuration = next;
    return this.public();
  }

  _write(value) {
    let temporary;
    let descriptor;
    try {
      this._assertDirectory();
      this._assertConfigurationFile();
      temporary = path.join(this.directory, `.settings-${crypto.randomBytes(16).toString('hex')}.tmp`);
      descriptor = fs.openSync(temporary,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      fs.fchmodSync(descriptor, 0o600);
      fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      this._assertDirectory();
      this._assertConfigurationFile();
      fs.renameSync(temporary, this.file);
      temporary = undefined;
    } catch (error) {
      if (error instanceof SettingsError) throw error;
      throw failure('无法保存本机配置，原配置已保留。请检查磁盘空间和文件权限。', 'WRITE_FAILED');
    } finally {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch { /* preserve the safe error above */ }
      }
      if (temporary) {
        try { fs.unlinkSync(temporary); } catch { /* no plaintext was written */ }
      }
    }
  }
}

module.exports = { Settings, SettingsError };
