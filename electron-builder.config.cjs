'use strict';
const config=JSON.parse(JSON.stringify(require('./package.json').build));
// Electron-builder filters immediate node_modules inside extraResources.
// Keep platform-native dependencies isolated in a dedicated resource subtree.
if(process.platform==='win32')config.extraResources.push({from:'resources/node/node_modules',to:'node/node_modules',filter:['**/*']});
if(process.platform==='win32'||process.platform==='darwin') {
  config.extraResources.push({from:'resources/computer-use',to:'computer-use',filter:['**/*','!node_modules/**/*','!mcp-config.json']});
  config.extraResources.push({from:'resources/computer-use/node_modules',to:'computer-use/node_modules',filter:['**/*']});
}
config.extraResources.push({from:'resources/build-info.json',to:'build-info.json'});
module.exports=config;
