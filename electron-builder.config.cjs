'use strict';
const config=JSON.parse(JSON.stringify(require('./package.json').build));
// electron-builder filters an immediate node_modules inside extraResources.
// Windows Node ships npm there (Mac uses lib/node_modules), so copy that tree
// explicitly, like the separately included tool-engine dependency tree.
if(process.platform==='win32')config.extraResources.push({from:'resources/node/node_modules',to:'node/node_modules',filter:['**/*']});
if(process.platform==='win32') {
  config.extraResources.push({from:'resources/computer-use',to:'computer-use',filter:['**/*','!node_modules/**/*','!mcp-config.json']});
  config.extraResources.push({from:'resources/computer-use/node_modules',to:'computer-use/node_modules',filter:['**/*']});
}
config.extraResources.push({from:'resources/build-info.json',to:'build-info.json'});
module.exports=config;
