'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Updater, newer, API, STARTUP_DELAY, CHECK_INTERVAL, ERRORS } = require('../app/updater.cjs');
const { Preferences } = require('../app/preferences.cjs');

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cth-update-'));
  const bytes = Buffer.from('verified installer fixture');
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const tag = 'v0.3.2', name = 'ChatToHarness-0.3.2-macos-arm64.dmg';
  const url = file => `https://github.com/DJ-Huang/ChatToHarness/releases/download/${tag}/${file}`;
  const release = { tag_name: tag, html_url: `https://github.com/DJ-Huang/ChatToHarness/releases/tag/${tag}`,
    published_at: '2026-10-17T00:00:00Z', draft: false, prerelease: false,
    assets: [{ name, size: bytes.length, digest: `sha256:${digest}`, browser_download_url: url(name) }] };
  const calls = [];
  const updater = new Updater({ current: '0.3.1', platform: 'darwin', arch: 'arm64', directory,
    fetcher: async (target, init) => {
      calls.push({ target, init });
      return target === API ? Response.json(release) : new Response(bytes);
    }, ...options });
  t.after(() => { updater.dispose(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { updater, directory, bytes, digest, release, calls, url };
}

test('stable numeric versions, platform selection, and development mode', async t => {
  assert.equal(newer('v0.10.0', '0.9.9'), true);
  assert.equal(newer('0.3.1', '0.3.1'), false);
  assert.equal(newer('0.3.0', '0.3.1'), false);
  assert.throws(() => newer('0.4.0-beta', '0.3.1'));
  assert.equal(newer('v0.7.0', '0.7.0-beta'), true);
  assert.equal(newer('v0.6.0', '0.7.0-beta'), false);
  assert.equal(newer('v0.7.0', '0.7.0'), false);
  assert.throws(() => newer('v0.7.0-beta', '0.7.0-beta'));
  const f = fixture(t);
  assert.equal((await f.updater.check()).phase, 'available');
  assert.equal(f.calls.length, 1, 'a check never downloads the installer');
  assert.equal(f.calls[0].init.credentials, 'omit');
  const dev = fixture(t, { packaged: false });
  assert.equal((await dev.updater.check()).phase, 'development');
  await assert.rejects(dev.updater.download());
  const windows = fixture(t, { platform: 'win32', arch: 'x64' });
  windows.release.assets[0].name = 'ChatToHarness-0.3.2-windows-x64-setup.exe';
  windows.release.assets[0].browser_download_url = windows.url(windows.release.assets[0].name);
  assert.equal((await windows.updater.check()).phase, 'available');
});

test('drafts, prereleases, wrong asset origins and absent installers do not enable updates', async t => {
  for (const mutate of [r => { r.draft = true; }, r => { r.prerelease = true; },
    r => { r.assets[0].browser_download_url = 'https://example.com/update.dmg'; },
    r => { r.html_url = 'https://example.com/release'; }, r => { r.assets = []; }]) {
    const f = fixture(t); mutate(f.release);
    const status = await f.updater.check();
    assert.equal(status.phase, 'error'); assert.equal(status.canDownload, false);
  }
  const f = fixture(t, { current: '0.3.2' });
  assert.equal((await f.updater.check()).phase, 'current');
});

test('SHA256SUMS fallback is bounded and must identify the exact installer', async t => {
  const f = fixture(t);
  delete f.release.assets[0].digest;
  f.release.assets.push({ name: 'SHA256SUMS.txt', size: 120, browser_download_url: f.url('SHA256SUMS.txt') });
  f.updater.fetcher = async target => target === API ? Response.json(f.release)
    : new Response(`${f.digest}  ${f.release.assets[0].name}\n`);
  assert.equal((await f.updater.check()).phase, 'available');
  f.updater.fetcher = async target => target === API ? Response.json(f.release) : new Response('x'.repeat(65537));
  assert.equal((await f.updater.check()).phase, 'error');
  assert.equal(f.updater.status().canDownload, false);
});

test('download and pre-install verification reject changed or oversized bytes and clean partial files', async t => {
  const f = fixture(t); await f.updater.check();
  assert.equal(await f.updater.download(), true);
  assert.equal(f.updater.status().phase, 'ready');
  const file = f.updater.file;
  fs.writeFileSync(file, Buffer.alloc(f.bytes.length, 120));
  await assert.rejects(f.updater.installer());
  assert.equal(f.updater.status().phase, 'error');
  assert.equal(fs.existsSync(file), false);
  await f.updater.check();
  f.updater.fetcher = async () => new Response(Buffer.alloc(f.bytes.length + 1));
  assert.equal(await f.updater.download(), false);
  assert.deepEqual(fs.readdirSync(f.directory), []);
  assert.equal(f.updater.status().error, ERRORS.checksum);
});

test('verified installer can be retried after an OS handoff failure', async t => {
  const f = fixture(t); await f.updater.check(); await f.updater.download();
  const file = await f.updater.installer();
  assert.equal(f.updater.status().phase, 'installing');
  f.updater.installFailed();
  assert.equal(f.updater.status().canInstall, true);
  assert.equal(await f.updater.installer(), file);
});

test('network failures, rate limits and missing releases remain distinct from up-to-date', async t => {
  for (const [code, phase, error] of [[429, 'error', ERRORS.rate], [503, 'error', ERRORS.network], [404, 'unavailable', '']]) {
    const f = fixture(t, { fetcher: async () => new Response('', { status: code }) });
    const status = await f.updater.check();
    assert.equal(status.phase, phase); assert.equal(status.error, error);
  }
});

test('automatic checks are delayed, deduplicated, repeat daily and can be disabled', async t => {
  let timer, sequence = 0;
  const f = fixture(t, { setTimer: (callback, delay) => { timer = { callback, delay, id: ++sequence }; return timer; },
    clearTimer: handle => { if (timer === handle) timer = null; } });
  f.updater.setAutomatic(true);
  assert.equal(timer.delay, STARTUP_DELAY); assert.equal(f.calls.length, 0);
  const first = f.updater.check(), second = f.updater.check();
  assert.equal(first, second);
  await first;
  assert.equal(f.calls.length, 1); assert.equal(timer.delay, CHECK_INTERVAL);
  f.updater.setAutomatic(false); assert.equal(timer, null);
  assert.equal(f.updater.status().automatic, false);
  f.updater.setAutomatic(true); assert.ok(timer);
  f.updater.dispose(); assert.equal(timer, null);
});

test('quit aborts in-flight checks without later publishing state', async t => {
  const f = fixture(t, { fetcher: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
  let events = 0; f.updater.on('state', () => events++);
  const checking = f.updater.check();
  await new Promise(resolve => setImmediate(resolve));
  f.updater.dispose(); const before = events;
  await checking; assert.equal(events, before);
});

test('legacy preferences gain automatic checks without changing credentials or losing language', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, 'preferences.json'), JSON.stringify({ locale: 'ja' }));
  const credentials = path.join(f.directory, 'settings.json'); fs.writeFileSync(credentials, 'opaque-existing-data');
  const preferences = new Preferences(f.directory, 'en');
  assert.equal(preferences.autoCheckUpdates, true);
  preferences.setAutoCheckUpdates(false); preferences.setLocale('en');
  const saved = new Preferences(f.directory, 'zh-CN');
  assert.equal(saved.autoCheckUpdates, false); assert.equal(saved.locale, 'en');
  assert.equal(fs.readFileSync(credentials, 'utf8'), 'opaque-existing-data');
  assert.throws(() => saved.setAutoCheckUpdates('false'));
});

test('old update cache cleanup preserves recent and unrelated files',async t=>{
  const f=fixture(t),old=path.join(f.directory,'update-ABC123'),recent=path.join(f.directory,'update-DEF456'),unrelated=path.join(f.directory,'user-data');
  for(const folder of [old,recent,unrelated])fs.mkdirSync(folder);
  const date=new Date(Date.now()-8*24*60*60*1000);fs.utimesSync(old,date,date);fs.utimesSync(unrelated,date,date);
  await f.updater.check();assert.equal(fs.existsSync(old),false);assert.equal(fs.existsSync(recent),true);assert.equal(fs.existsSync(unrelated),true);
});
