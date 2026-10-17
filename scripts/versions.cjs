'use strict';

// Immutable upstream downloads. Values copied from the linked official checksum
// manifests; installation never trusts a version string or an unchecked cache.
const nodeVersion = '24.22.0';
const tunnelVersion = '0.0.16';
const nodeOrigin = `https://nodejs.org/dist/v${nodeVersion}`;
const tunnelOrigin = `https://github.com/openai/tunnel-client/releases/download/v${tunnelVersion}`;
function platform(nodeAsset, nodeSha, tunnelAsset, tunnelSha, licenseSha, nodeBinary, npm, tunnelBinary) {
  const licenseFile = tunnelAsset.replace(/\.zip$/, '-licenses.txt');
  return Object.freeze({
    node: Object.freeze({ version: nodeVersion, file: nodeAsset, url: `${nodeOrigin}/${nodeAsset}`, sha256: nodeSha,
      binary: nodeBinary, npm, checksumSource: `${nodeOrigin}/SHASUMS256.txt` }),
    tunnel: Object.freeze({ version: tunnelVersion, file: tunnelAsset, url: `${tunnelOrigin}/${tunnelAsset}`, sha256: tunnelSha,
      binary: tunnelBinary, licenseFile, licenseUrl: `${tunnelOrigin}/${licenseFile}`, licenseSha256: licenseSha,
      checksumSource: `${tunnelOrigin}/SHA256SUMS.txt` })
  });
}
const platforms = Object.freeze({
  'darwin-arm64': platform('node-v24.22.0-darwin-arm64.tar.gz',
    '6a9724d9b50a5f22b4816cded441b5a8d9ddae546191a5e5b7efa5a5e2ee26d5',
    'tunnel-client-runtime-v0.0.16-darwin-arm64.zip',
    '81d230a289ae1b1416738d8150bc879d88a29e8749bb659047a7ef90dfc4acbe',
    '5acdab335f96235bb6f04d06e6327648a3ea7ba431d50772bca674f8e5a948e2',
    'bin/node', 'lib/node_modules/npm/bin/npm-cli.js', 'tunnel-client-runtime'),
  'win32-x64': platform('node-v24.22.0-win-x64.zip',
    'f9683a19877e12a9b167305c8db71040d812876359de21f0d2e97c3f321f80c3',
    'tunnel-client-runtime-v0.0.16-windows-amd64.zip',
    '639fdfe10d91c672d8f8a49386ebf39acaac4e560a88134735b1739a02ddb82d',
    '65f2c97d95abfe805ce18fd63757186295e1bbf8e20ecedcb7cc173d3cade73f',
    'node.exe', 'node_modules/npm/bin/npm-cli.js', 'tunnel-client-runtime.exe')
});
function forPlatform(name = `${process.platform}-${process.arch}`) {
  const found = platforms[name];
  if (!found) throw new Error(`Unsupported native build platform: ${name}; use macOS arm64 or Windows x64`);
  return found;
}
module.exports = Object.freeze({
  node: Object.freeze({ version: nodeVersion }),
  tunnel: Object.freeze({ version: tunnelVersion }),
  desktopCommander: Object.freeze({ version: '0.3.0', integrity: 'sha512-2EXNxuztSIW3fQw6OEGMek39M8yQlKinXooMYtNR4wRLhtA+f3b0cbxBggAfDeKemMWltm1qWQy/t2Av9VmYLw==' }),
  platforms, forPlatform
});
