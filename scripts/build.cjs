'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const versions = require('./versions.cjs');
const root = path.resolve(__dirname, '..');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function run(script, args = [], env = process.env) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(script)} exited with ${result.status}`);
}
function signingConfig(platform, env) {
  const signed = env.CTH_SIGNED === '1';
  const buildEnv = { ...env };
  if (signed) {
    const required = ['CSC_LINK', 'CSC_KEY_PASSWORD'];
    if (platform === 'darwin') {
      const hasApiKey = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'].every(name => Boolean(env[name]));
      if (!hasApiKey) required.push('APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID');
    }
    const missing = required.filter(name => !env[name]);
    if (missing.length) throw new Error(`正式签名已启用，但缺少：${missing.join(', ')}`);
    buildEnv.CSC_IDENTITY_AUTO_DISCOVERY = 'true';
  } else {
    // Empty certificate variables are treated as filesystem paths by the builder.
    for (const name of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD',
      'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']) delete buildEnv[name];
    buildEnv.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
    // electron-builder's PR guard also skips the certificate-free ad-hoc
    // signature required by our macOS package verification. Allow only this
    // mode after removing credentials and forcing mac.identity=- below.
    if (platform === 'darwin') buildEnv.CSC_FOR_PULL_REQUEST = 'true';
  }
  const overrides = platform === 'darwin' ? (signed
    ? ['-c.mac.hardenedRuntime=true', '-c.mac.notarize=true',
      '-c.mac.entitlements=assets/entitlements.mac.plist', '-c.mac.entitlementsInherit=assets/entitlements.mac.plist', '-c.forceCodeSigning=true']
    : ['-c.mac.identity=-', '-c.mac.hardenedRuntime=false', '-c.mac.notarize=false'])
    : signed ? ['-c.forceCodeSigning=true'] : [];
  return { signed, env: buildEnv, overrides };
}
function verifyResources(resources, options = {}) {
  const receipt = JSON.parse(fs.readFileSync(path.join(resources, 'bundle.json'), 'utf8'));
  const pin = versions.forPlatform();
  if (receipt.platform !== `${process.platform}-${process.arch}` || receipt.node !== versions.node.version ||
      receipt.tunnel !== versions.tunnel.version || receipt.desktopCommander !== versions.desktopCommander.version ||
      receipt.nodeArchiveSha256 !== pin.node.sha256 || receipt.tunnelArchiveSha256 !== pin.tunnel.sha256) throw new Error('运行组件版本或平台不匹配。');
  for (const [relative, expected] of Object.entries(receipt.files)) {
    const file = path.join(resources, relative);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`应用缺少运行组件：${relative}`);
    // macOS code signing changes Mach-O bytes. After packaging, codesign verifies
    // those binaries; exact archive-derived digests are checked before packaging.
    const signedMachO = options.packaged && process.platform === 'darwin' && /^(node\/bin\/node|tunnel\/tunnel-client-runtime)$/.test(relative);
    const signedPE = options.packaged && options.signed && process.platform === 'win32' && /\.exe$/i.test(relative);
    if (!signedMachO && !signedPE && sha(file) !== expected) throw new Error(`运行组件校验失败：${relative}`);
  }
  for (const relative of [`node/${pin.node.npm}`, 'desktop-commander/node_modules/@wonderwhy-er/desktop-commander/dist/index.js']) {
    if (!fs.existsSync(path.join(resources, relative))) throw new Error(`应用缺少运行组件：${relative}`);
  }
  return receipt;
}
function main() {
  versions.forPlatform();
  const config = signingConfig(process.platform, process.env);
  run(path.join(__dirname, 'prepare-resources.cjs'));
  verifyResources(path.join(root, 'resources'));
  const installer = process.argv.includes('--dist');
  const args = ['--config', 'electron-builder.config.cjs', process.platform === 'darwin' ? '--mac' : '--win', process.platform === 'darwin' ? '--arm64' : '--x64',
    ...(installer ? [] : ['--dir']), '--publish', 'never', ...config.overrides,
    ...(process.env.CTH_ELECTRON_DIST ? [`-c.electronDist=${process.env.CTH_ELECTRON_DIST}`] : [])];
  console.log(`正在生成 ChatToHarness ${installer ? '安装包' : '应用'}…`);
  run(path.join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'), args, config.env);
  const application = process.platform === 'darwin'
    ? path.join(root, 'dist', 'mac-arm64', 'ChatToHarness.app') : path.join(root, 'dist', 'win-unpacked');
  const executable = process.platform === 'darwin'
    ? path.join(application, 'Contents', 'MacOS', 'ChatToHarness') : path.join(application, 'ChatToHarness.exe');
  if (!fs.existsSync(executable)) throw new Error('应用打包未生成预期入口。');
  const resources = process.platform === 'darwin' ? path.join(application, 'Contents', 'Resources') : path.join(application, 'resources');
  verifyResources(resources, { packaged: true, signed: config.signed });
  if (process.platform === 'darwin') {
    const signed = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', application], { stdio: 'inherit' });
    if (signed.status !== 0) throw new Error('应用签名校验失败。');
  }
  if (process.platform === 'win32' && config.signed) {
    const pin = versions.forPlatform();
    const signedFiles = [executable, path.join(resources, 'node', pin.node.binary),
      path.join(resources, 'tunnel', pin.tunnel.binary), path.join(resources, 'managed-process', 'ChatToHarness.ProcessHost.exe')];
    const script = "$ErrorActionPreference='Stop'; foreach ($file in ($env:CTH_SIGNATURE_FILES | ConvertFrom-Json)) { if ((Get-AuthenticodeSignature -LiteralPath $file).Status -ne 'Valid') { throw ('Invalid executable signature: ' + [IO.Path]::GetFileName($file)) } }";
    const verified = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { stdio: 'inherit', windowsHide: true, env: { ...config.env, CTH_SIGNATURE_FILES: JSON.stringify(signedFiles) } });
    if (verified.error) throw verified.error;
    if (verified.status !== 0) throw new Error('Windows 应用签名校验失败。');
  }
  fs.mkdirSync(path.join(root, '.cache'), { recursive: true });
  fs.writeFileSync(path.join(root, '.cache', 'build-stamp'), new Date().toISOString() + '\n');
  if (installer) {
    const version = require('../package.json').version;
    const name = process.platform === 'darwin' ? `ChatToHarness-${version}-macos-arm64.dmg` : `ChatToHarness-${version}-windows-x64-setup.exe`;
    if (!fs.existsSync(path.join(root, 'dist', name))) throw new Error(`缺少预期安装包：${name}`);
    console.log(`已生成：${path.join(root, 'dist', name)}`);
  } else console.log(`已生成：${application}`);
}
if (require.main === module) { try { main(); } catch (error) { console.error(`构建失败：${error.message}`); process.exitCode = 1; } }
module.exports = { signingConfig, verifyResources };
