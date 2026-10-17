'use strict';
const config=JSON.parse(JSON.stringify(require('./package.json').build));
// electron-builder filters an immediate node_modules inside extraResources.
// Windows Node ships npm there (Mac uses lib/node_modules), so copy that tree
// explicitly, like the separately included tool-engine dependency tree.
if(process.platform==='win32')config.extraResources.push({from:'resources/node/node_modules',to:'node/node_modules',filter:['**/*']});
module.exports=config;
