'use strict';

// Keep native desktop implementations outside the opposite OS installer.
// Shared session protocol and screenshot processing are bundled on both hosts.
const FILE_EXCLUDES = Object.freeze({
  darwin: ['!app/windows-computer-use.cjs','!app/windows-computer-use-stdio.cjs',
    '!app/computer-use-stdio.cjs'],
  win32: ['!app/macos-computer-use.cjs','!app/macos-computer-use-stdio.cjs',
    '!app/computer-use-stdio.cjs']
});
const RESOURCE_EXCLUDES = Object.freeze({
  darwin: ['!ChatToHarness.ComputerUse.exe','!app/windows-computer-use.cjs','!app/windows-computer-use-stdio.cjs'],
  win32: ['!ChatToHarness.MacComputerUse','!app/macos-computer-use.cjs','!app/macos-computer-use-stdio.cjs']
});
function filterForPlatform(platform) {
  if(!Object.hasOwn(FILE_EXCLUDES,platform))return {files:[],resources:[]};
  return {files:[...FILE_EXCLUDES[platform]],
    resources:['**/*','!node_modules/**/*','!mcp-config.json',...RESOURCE_EXCLUDES[platform]]};
}
module.exports={filterForPlatform};
