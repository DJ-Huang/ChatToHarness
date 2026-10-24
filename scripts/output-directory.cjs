'use strict';
const path=require('node:path');

// A running unpacked development app may live in dist/mac-arm64. Never let a
// release build clean that directory. An isolated, named dist subdirectory
// makes it possible to build and smoke-test while that app is in use.
function outputDirectory(root=path.resolve(__dirname,'..'), env=process.env) {
  const name=env.CTH_DIST_SUBDIR;
  if(name===undefined||name==='')return path.join(root,'dist');
  if(typeof name!=='string' || name==='.' || name==='..' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name))
    throw new Error('CTH_DIST_SUBDIR must be a simple non-traversing directory name');
  return path.join(root,'dist',name);
}
module.exports={outputDirectory};
