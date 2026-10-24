'use strict';
const config=JSON.parse(JSON.stringify(require('./package.json').build));
const {filterForPlatform}=require('./scripts/packaging-platform.cjs');
// electron-builder filters immediate node_modules inside extraResources.
// Do not include the opposite OS JS adapter or native helper in a release.
const platform=filterForPlatform(process.platform);
config.files.push(...platform.files);
if(process.platform==='win32')config.extraResources.push({from:'resources/node/node_modules',to:'node/node_modules',filter:['**/*']});
if(platform.resources.length) {
  config.extraResources.push({from:'resources/computer-use',to:'computer-use',filter:platform.resources});
  config.extraResources.push({from:'resources/computer-use/node_modules',to:'computer-use/node_modules',filter:['**/*']});
}
config.extraResources.push({from:'resources/build-info.json',to:'build-info.json'});
module.exports=config;
