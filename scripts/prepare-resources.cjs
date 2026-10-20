'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const versions = require('./versions.cjs');
const root = path.resolve(__dirname, '..');
const resources = path.join(root, 'resources');
const downloads = path.join(root, '.cache', 'downloads');
const platformId = `${process.platform}-${process.arch}`;
const isWindows = process.platform === 'win32';
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} exited with ${result.status}`);
  return result;
}
function powershell(script, env = process.env) {
  return run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(`$ErrorActionPreference='Stop'; ${script}`, 'utf16le').toString('base64')], { env });
}
function envWithPath(directory) {
  const currentPath = Object.entries(process.env).find(([name]) => name.toLowerCase() === 'path')?.[1] || '';
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'path'));
  return { ...env, PATH: `${directory}${path.delimiter}${currentPath}`, PUPPETEER_SKIP_DOWNLOAD: 'true' };
}
async function download(url, name, expected) {
  fs.mkdirSync(downloads, { recursive: true });
  const file = path.join(downloads, name);
  if (fs.existsSync(file) && sha(file) === expected) return file;
  fs.rmSync(file, { force: true });
  const temporary = `${file}.part`;
  console.log(`下载并校验：${name}`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { Readable } = require('node:stream');
      const { pipeline } = require('node:stream/promises');
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary));
      if (sha(temporary) !== expected) throw new Error('SHA-256 verification failed');
      fs.renameSync(temporary, file);
      return file;
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      if (attempt === 3) throw new Error(`${name}: ${error.message}; no unverified payload was installed`);
    }
  }
}
function unzip(archive, destination) {
  if (isWindows) powershell('Expand-Archive -LiteralPath $env:CTH_ARCHIVE -DestinationPath $env:CTH_EXTRACT -Force',
    { ...process.env, CTH_ARCHIVE: archive, CTH_EXTRACT: destination });
  else run('/usr/bin/ditto', ['-x', '-k', archive, destination]);
}
async function prepareNode(pin) {
  const destination = path.join(resources, 'node');
  const binary = path.join(destination, pin.binary);
  const receipt = path.join(destination, '.chatharness-node.json');
  let cached;
  try { cached = JSON.parse(fs.readFileSync(receipt, 'utf8')); } catch {}
  if (cached?.platform === platformId && cached?.archiveSha256 === pin.sha256 &&
      fs.existsSync(binary) && cached.binarySha256 === sha(binary)) return binary;
  const archive = await download(pin.url, pin.file, pin.sha256);
  const temporary = `${destination}.prepare`;
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.mkdirSync(temporary, { recursive: true });
  if (isWindows) {
    unzip(archive, temporary);
    const contents = path.join(temporary, pin.file.replace(/\.zip$/, ''));
    if (!fs.existsSync(path.join(contents, pin.binary))) throw new Error('Unexpected Node archive layout');
    fs.rmSync(destination, { recursive: true, force: true });
    fs.renameSync(contents, destination);
    fs.rmSync(temporary, { recursive: true, force: true });
  } else {
    run('/usr/bin/tar', ['-xzf', archive, '-C', temporary, '--strip-components=1']);
    fs.rmSync(destination, { recursive: true, force: true });
    fs.renameSync(temporary, destination);
  }
  const installed = run(binary, ['--version'], { encoding: 'utf8', stdio: 'pipe' }).stdout.trim();
  if (installed !== `v${pin.version}`) throw new Error('Node version mismatch');
  fs.writeFileSync(receipt, JSON.stringify({ platform: platformId, archiveSha256: pin.sha256, binarySha256: sha(binary) }));
  return binary;
}
async function prepareTunnel(pin) {
  const destination = path.join(resources, 'tunnel');
  const archive = await download(pin.url, pin.file, pin.sha256);
  const license = await download(pin.licenseUrl, pin.licenseFile, pin.licenseSha256);
  const temporary = `${destination}.prepare`;
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.mkdirSync(temporary, { recursive: true });
  unzip(archive, temporary);
  const binaries = [];
  function findBinary(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) findBinary(file);
      else if (entry.name === pin.binary) binaries.push(file);
    }
  }
  findBinary(temporary);
  if (binaries.length !== 1) throw new Error('Unexpected Tunnel archive layout');
  const binary = path.join(temporary, pin.binary);
  if (binaries[0] !== binary) fs.copyFileSync(binaries[0], binary);
  if (!isWindows) fs.chmodSync(binary, 0o755);
  fs.copyFileSync(license, path.join(temporary, 'THIRD_PARTY_LICENSES.txt'));
  fs.rmSync(destination, { recursive: true, force: true });
  fs.renameSync(temporary, destination);
}
function prepareDesktopCommander(node, pin) {
  const source = path.join(root, 'vendor', 'desktop-commander');
  const destination = path.join(resources, 'desktop-commander');
  const lockFile = path.join(source, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  const pinned = lock.packages['node_modules/@wonderwhy-er/desktop-commander'];
  if (pinned?.version !== versions.desktopCommander.version || pinned?.integrity !== versions.desktopCommander.integrity) {
    throw new Error('Desktop Commander lockfile does not match the pinned version and integrity');
  }
  const marker = path.join(destination, '.localharness-lock');
  const installedPackage = path.join(destination, 'node_modules', '@wonderwhy-er', 'desktop-commander');
  const patchedFile = path.join(installedPackage, 'dist', 'config.js');
  const fingerprint = `${sha(lockFile)}:${platformId}:isolated-config-v2`;
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === fingerprint &&
      fs.existsSync(patchedFile) && fs.readFileSync(patchedFile, 'utf8').includes('ChatToHarness isolated configuration')) { require('./engine-isolation.cjs').patchEngine(installedPackage); return; }
  // A platform-qualified fingerprint prevents copying macOS native modules into
  // Windows installers even when a restored build cache contains old resources.
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  for (const name of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(source, name), path.join(destination, name));
  const npm = path.join(resources, 'node', pin.npm);
  console.log('准备独立的工具组件…');
  run(node, [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: destination, env: envWithPath(path.dirname(node))
  });
  const original = "const CONFIG_DIR = path.join(USER_HOME, '.claude-server-commander');";
  const code = fs.readFileSync(patchedFile, 'utf8');
  if (code.split(original).length !== 2) throw new Error('Desktop Commander config isolation patch no longer matches upstream; build stopped');
  const replacement = `// ChatToHarness isolated configuration; the real user home remains unchanged.\nconst CONFIG_DIR = (() => {\n    const directory = process.env.LOCALHARNESS_DC_HOME;\n    if (!directory || !path.isAbsolute(directory)) throw new Error('LOCALHARNESS_DC_HOME must be an absolute directory');\n    return directory;\n})();`;
  fs.writeFileSync(patchedFile, code.replace(original, replacement));
  const ripgrep = isWindows ? '@vscode/ripgrep-win32-x64' : '@vscode/ripgrep-darwin-arm64';
  if (!fs.existsSync(path.join(destination, 'node_modules', ripgrep, 'bin', isWindows ? 'rg.exe' : 'rg'))) {
    throw new Error(`Native search component missing for ${platformId}`);
  }
  require('./engine-isolation.cjs').patchEngine(installedPackage);
  fs.writeFileSync(marker, fingerprint);
}
function prepareProcessHost() {
  const output = path.join(resources, 'managed-process');
  fs.mkdirSync(output, { recursive: true });
  if (!isWindows) {
    // Do not accidentally bundle a stale Windows helper into the Mac artifact.
    fs.rmSync(path.join(output, 'ChatToHarness.ProcessHost.exe'), { force: true });
    fs.writeFileSync(path.join(output, 'README.txt'), 'Windows process containment helper is built only on Windows.\n');
    return;
  }
  const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!fs.existsSync(compiler)) throw new Error('Windows .NET Framework C# compiler is required for process containment');
  run(compiler, ['/nologo', '/target:exe', '/platform:x64', '/optimize+',
    `/out:${path.join(output, 'ChatToHarness.ProcessHost.exe')}`, path.join(root, 'native', 'ManagedProcess.cs')]);
}
function collectLicenses() {
  const output = path.join(resources, 'licenses');
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  fs.copyFileSync(path.join(resources, 'node', 'LICENSE'), path.join(output, 'Node-LICENSE.txt'));
  fs.copyFileSync(path.join(resources, 'tunnel', 'THIRD_PARTY_LICENSES.txt'), path.join(output, 'Tunnel-LICENSES.txt'));
  const modules = path.join(resources, 'desktop-commander', 'node_modules');
  const packages = [];
  const visited = new Set();
  function scan(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (item.name.startsWith('.')) continue;
      const folder = path.join(directory, item.name);
      if (!item.isDirectory() || item.isSymbolicLink()) continue;
      if (item.name.startsWith('@')) { scan(folder); continue; }
      const manifest = path.join(folder, 'package.json');
      if (fs.existsSync(manifest)) {
        const entry = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        const id = `${entry.name}@${entry.version}`;
        if (!visited.has(id)) {
          visited.add(id);
          const texts = fs.readdirSync(folder)
            .filter(name => /^(licen[cs]e|copying|notice)(\.|$|-)/i.test(name) && fs.statSync(path.join(folder, name)).isFile())
            .map(name => ({ name, text: fs.readFileSync(path.join(folder, name), 'utf8') }));
          packages.push({ package: entry.name, version: entry.version, license: entry.license || 'See package', texts });
        }
      }
      const nested = path.join(folder, 'node_modules');
      if (fs.existsSync(nested)) scan(nested);
    }
  }
  scan(modules);
  fs.writeFileSync(path.join(output, 'Desktop-Commander-dependency-licenses.json'), JSON.stringify(packages, null, 2));
  const report = packages.map(entry => `# ${entry.package}@${entry.version}\nLicense: ${typeof entry.license === 'string' ? entry.license : JSON.stringify(entry.license)}\n${entry.texts.map(item => `\n${item.name}\n${item.text}`).join('\n')}`).join('\n\n---\n\n');
  fs.writeFileSync(path.join(output, 'Desktop-Commander-LICENSES.txt'), report);
}

async function main() {
  const pin = versions.forPlatform();
  fs.mkdirSync(resources, { recursive: true });
  const node = await prepareNode(pin.node);
  await prepareTunnel(pin.tunnel);
  prepareDesktopCommander(node, pin.node);
  prepareProcessHost();
  const computerUseFiles = require('./prepare-computer-use.cjs').prepareComputerUse(root, node);
  collectLicenses();
  const files = {};
  for (const file of [`node/${pin.node.binary}`, `tunnel/${pin.tunnel.binary}`,
    'desktop-commander/node_modules/@wonderwhy-er/desktop-commander/dist/config.js',
    'desktop-commander/node_modules/@wonderwhy-er/desktop-commander/dist/utils/toolHistory.js',
    'desktop-commander/node_modules/@wonderwhy-er/desktop-commander/dist/utils/fuzzySearchLogger.js',
    'desktop-commander/node_modules/@opendocsg/pdf2md/lib/models/transformations/text-item/CalculateGlobalStats.js',
    ...(isWindows ? ['managed-process/ChatToHarness.ProcessHost.exe'] : []), ...computerUseFiles]) files[file] = sha(path.join(resources, file));
  fs.writeFileSync(path.join(resources, 'bundle.json'), JSON.stringify({
    platform: platformId, node: versions.node.version, tunnel: versions.tunnel.version,
    desktopCommander: versions.desktopCommander.version, nodeArchiveSha256: pin.node.sha256,
    tunnelArchiveSha256: pin.tunnel.sha256, files
  }, null, 2) + '\n');
  console.log('工具组件已准备并校验。');
}
if (require.main === module) main().catch(error => { console.error(`准备组件失败：${error.message}`); process.exitCode = 1; });
module.exports = { envWithPath, sha };
