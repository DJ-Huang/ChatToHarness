'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const API = 'https://api.github.com/repos/DJ-Huang/ChatToHarness/releases/latest';
const RELEASE_ROOT = 'https://github.com/DJ-Huang/ChatToHarness/releases/';
const CHECK_INTERVAL = 24 * 60 * 60 * 1000;
const STARTUP_DELAY = 10000;
const MAX_INSTALLER_BYTES = 8 * 1024 ** 3;
const ERRORS = Object.freeze({
  network: '更新请求失败，请检查网络后重试。',
  rate: '更新服务暂时限制请求，请稍后重试。',
  release: '无法识别正式发布版本，请稍后重新检查。',
  platform: '当前系统或架构不支持此更新。',
  asset: '最新版本尚未提供当前系统的安装包，请稍后重新检查。',
  checksum: '安装包校验失败或缺少校验信息，未启动安装。请重新检查或下载。',
  storage: '无法保存安装包，请检查磁盘空间和目录写入权限后重试。',
  check: '请先检查更新，再下载安装。',
  install: '无法打开安装程序，请重试。',
});
function failure(code) { return Object.assign(new Error(ERRORS[code]), { updateCode: code }); }
function version(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match || match.slice(1).some(part => !Number.isSafeInteger(Number(part)))) throw failure('release');
  return match.slice(1).map(Number);
}
// Stable releases remain mandatory; only the locally installed version may
// be prerelease, so a beta can safely compare against the latest stable build.
function currentVersion(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!match || match.slice(1,4).some(part => !Number.isSafeInteger(Number(part)))) throw failure('release');
  return { numbers: match.slice(1,4).map(Number), prerelease: Boolean(match[4]) };
}
function newer(latest, current) {
  const a = version(latest), parsed = currentVersion(current), b = parsed.numbers;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return parsed.prerelease;
}
function assetUrl(asset, tag) {
  const expected = `${RELEASE_ROOT}download/${encodeURIComponent(tag)}/${encodeURIComponent(asset.name)}`;
  if (asset.browser_download_url !== expected) throw failure('release');
  return expected;
}
async function boundedText(response, limit) {
  const chunks = []; let bytes = 0;
  for await (const chunk of Readable.fromWeb(response.body)) {
    bytes += chunk.length;
    if (bytes > limit) throw failure('release');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

class Updater extends EventEmitter {
  constructor({ current, platform, arch, directory, packaged = true, fetcher = fetch,
    now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
    super();
    Object.assign(this, { current, platform, arch, directory, packaged, fetcher, now, setTimer, clearTimer });
    this.state = { current, latest: '', phase: 'idle', received: 0, total: 0, error: '', checkedAt: 0, releaseUrl: '', automatic: true };
    this.automatic = false;
    this.closed = false;
  }
  status() { return { ...this.state, canDownload: this.packaged && Boolean(this.asset), canInstall: Boolean(this.file) && this.state.phase === 'ready' }; }
  update(values) { if (this.closed) return; Object.assign(this.state, values); this.emit('state', this.status()); }
  get busy() { return ['checking', 'downloading', 'verifying', 'installing'].includes(this.state.phase); }
  setAutomatic(enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('Invalid automatic update preference');
    this.automatic = enabled;
    this.clearTimer(this.timer); this.timer = null;
    this.update({ automatic: enabled });
    if (enabled) this.schedule(this.state.checkedAt ? Math.max(1000, CHECK_INTERVAL - (this.now() - this.state.checkedAt)) : STARTUP_DELAY);
  }
  schedule(delay = CHECK_INTERVAL) {
    this.clearTimer(this.timer); this.timer = null;
    if (!this.automatic || this.closed) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.check().finally(() => { if (!this.timer) this.schedule(); });
    }, delay);
    this.timer.unref?.();
  }
  async response(url, signal, { metadata = false } = {}) {
    const response = await this.fetcher(url, {
      headers: { 'User-Agent': `ChatToHarness/${this.current}`, Accept: metadata ? 'application/vnd.github+json' : 'application/octet-stream' },
      credentials: 'omit', redirect: metadata ? 'error' : 'follow', signal,
    });
    if (metadata && response.status === 404) { await response.body?.cancel().catch(() => {}); return null; }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw failure([403, 429].includes(response.status) ? 'rate' : 'network');
    }
    return response;
  }
  fail(error) {
    const code = Object.hasOwn(ERRORS, error?.updateCode) ? error.updateCode
      : ['ENOSPC', 'EACCES', 'EPERM', 'EROFS'].includes(error?.code) ? 'storage' : 'network';
    if (!this.closed) this.update({ phase: 'error', error: ERRORS[code] });
    return this.status();
  }
  check() {
    if (this.checkPromise) return this.checkPromise;
    if (this.closed || this.busy) return Promise.resolve(this.status());
    this.clearTimer(this.timer); this.timer = null;
    this.checkPromise = this.inspect().finally(() => { this.checkPromise = null; this.schedule(); });
    return this.checkPromise;
  }
  async inspect() {
    this.asset = null;
    await this.removeDownload();
    await this.pruneDownloads();
    if (this.closed) return this.status();
    const controller = new AbortController(); this.controller = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
    this.update({ phase: 'checking', latest: '', received: 0, total: 0, error: '', releaseUrl: '' });
    try {
      const response = await this.response(API, signal, { metadata: true });
      if (!response) { this.update({ phase: 'unavailable', checkedAt: this.now() }); return this.status(); }
      let release;
      try { release = JSON.parse(await boundedText(response, 1024 * 1024)); }
      catch (error) { if (signal.aborted) throw error; throw failure('release'); }
      if (!release || release.draft !== false || release.prerelease !== false || !release.published_at || !Array.isArray(release.assets)) throw failure('release');
      version(release.tag_name);
      const releaseUrl = `${RELEASE_ROOT}tag/${encodeURIComponent(release.tag_name)}`;
      if (release.html_url !== releaseUrl) throw failure('release');
      this.update({ latest: release.tag_name.replace(/^v/, ''), checkedAt: this.now(), releaseUrl });
      if (!newer(release.tag_name, this.current)) { this.update({ phase: 'current' }); return this.status(); }
      const suffix = this.platform === 'win32' && this.arch === 'x64' ? 'windows-x64-setup.exe'
        : this.platform === 'darwin' && this.arch === 'arm64' ? 'macos-arm64.dmg' : '';
      if (!suffix) throw failure('platform');
      const name = `ChatToHarness-${this.state.latest}-${suffix}`;
      const asset = release.assets.find(item => item.name === name);
      if (!asset || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_INSTALLER_BYTES) throw failure('asset');
      const url = assetUrl(asset, release.tag_name);
      let digest = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest || '')?.[1];
      if (!digest) {
        const sums = release.assets.find(item => item.name === 'SHA256SUMS.txt');
        if (!sums || !Number.isSafeInteger(sums.size) || sums.size <= 0 || sums.size > 65536) throw failure('checksum');
        const content = await boundedText(await this.response(assetUrl(sums, release.tag_name), signal), 65536);
        const matches = content.split(/\r?\n/).map(line => /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line)).filter(match => match?.[2] === name);
        if (matches.length !== 1) throw failure('checksum');
        digest = matches[0][1];
      }
      if (this.closed) return this.status();
      this.asset = { name, url, size: asset.size, digest: digest.toLowerCase() };
      this.update({ phase: this.packaged ? 'available' : 'development', total: asset.size });
    } catch (error) { this.fail(error); }
    finally { if (this.controller === controller) this.controller = null;this.update({checkedAt:this.now()}); }
    return this.status();
  }
  download() {
    if (this.downloadPromise) return this.downloadPromise;
    if (this.closed || this.busy) return Promise.resolve(false);
    if (!this.packaged || !this.asset || !['available', 'error', 'ready'].includes(this.state.phase)) return Promise.reject(failure('check'));
    this.downloadPromise = this.transfer().finally(() => { this.downloadPromise = null; });
    return this.downloadPromise;
  }
  async transfer() {
    const asset = this.asset;
    const controller = new AbortController(); this.controller = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(2 * 60 * 60 * 1000)]);
    this.update({ phase: 'downloading', error: '', received: 0 });
    try {
      await this.removeDownload();
      await fs.promises.mkdir(this.directory, { recursive: true, mode: 0o700 });
      const info = await fs.promises.lstat(this.directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw Object.assign(new Error(), { code: 'EACCES' });
      this.folder = await fs.promises.mkdtemp(path.join(this.directory, 'update-'));
      const partial = path.join(this.folder, `${asset.name}.partial`);
      const response = await this.response(asset.url, signal);
      const hash = crypto.createHash('sha256'); let received = 0, lastReport = 0;
      const meter = new Transform({ transform: (chunk, _, callback) => {
        received += chunk.length;
        if (received > asset.size) { callback(failure('checksum')); return; }
        hash.update(chunk);
        this.state.received = received;
        if (this.now() - lastReport >= 150) { lastReport = this.now(); this.emit('state', this.status()); }
        callback(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(partial, { flags: 'wx', mode: 0o600 }), { signal });
      this.update({ phase: 'verifying', received });
      if (received !== asset.size || hash.digest('hex') !== asset.digest) throw failure('checksum');
      this.file = path.join(this.folder, asset.name);
      await fs.promises.rename(partial, this.file);
      this.update({ phase: 'ready' });
      return true;
    } catch (error) { await this.removeDownload(); this.fail(error); return false; }
    finally { if (this.controller === controller) this.controller = null; }
  }
  async installer() {
    if (this.closed || this.state.phase !== 'ready' || !this.file) throw failure('check');
    this.update({ phase: 'verifying', error: '' });
    let handle;
    try {
      const info = await fs.promises.lstat(this.file);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== this.asset.size) throw failure('checksum');
      handle = await fs.promises.open(this.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const hash = crypto.createHash('sha256');let bytes=0;
      for await (const chunk of handle.createReadStream({ autoClose: false })) {bytes+=chunk.length;if(this.closed||bytes>this.asset.size)throw failure('checksum');hash.update(chunk);}
      if (hash.digest('hex') !== this.asset.digest || this.closed) throw failure('checksum');
      this.update({ phase: 'installing' });
      return this.file;
    } catch (error) { await handle?.close().catch(() => {}); handle = null; await this.removeDownload(); this.asset = null; const reported=error.updateCode?error:failure('checksum');this.fail(reported);throw reported; }
    finally { await handle?.close().catch(() => {}); }
  }
  installFailed() { this.update({ phase: 'ready', error: ERRORS.install }); }
  async removeDownload() {
    const folder = this.folder; this.folder = null; this.file = null;
    if (folder) await fs.promises.rm(folder, { recursive: true, force: true }).catch(() => {});
  }
  async pruneDownloads() {
    try {
      const stat=await fs.promises.lstat(this.directory);
      if(!stat.isDirectory()||stat.isSymbolicLink())return;
      for(const entry of await fs.promises.readdir(this.directory,{withFileTypes:true})){
        if(!entry.isDirectory()||!/^update-[A-Za-z0-9]{6}$/.test(entry.name))continue;
        const folder=path.join(this.directory,entry.name),info=await fs.promises.lstat(folder);
        if(info.isDirectory()&&!info.isSymbolicLink()&&info.mtimeMs<this.now()-7*24*60*60*1000)await fs.promises.rm(folder,{recursive:true,force:true});
      }
    }catch{ /* Cache housekeeping must not prevent checking for updates. */ }
  }
  dispose() {
    this.closed = true;
    this.clearTimer(this.timer); this.timer = null;
    this.controller?.abort();
    // Keep a verified installer while the OS opens it; failed/partial downloads
    // are removed by transfer's cancellation path.
  }
}
module.exports = { Updater, newer, API, CHECK_INTERVAL, STARTUP_DELAY, ERRORS };
