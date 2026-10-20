'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');

// macOS takes the application-menu title from the native bundle, independently
// of app.setName(). Keep the dependency pristine and cache a named development
// bundle that still loads the repository's current source through Electron.
function prepareDevelopmentApp({root,binary,platform=process.platform,run=execFileSync}={}) {
  if(platform!=='darwin')return binary;
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const product=manifest.build.productName;
  if(!/^[\w .-]+$/.test(product))throw new Error('Invalid development product name.');
  const source=path.resolve(binary,'../../..');
  const info=path.join('Contents','Info.plist');
  const stat=fs.statSync(binary);
  const key=crypto.createHash('sha256').update(JSON.stringify({revision:2,product,binary,
    version:manifest.devDependencies.electron,size:stat.size,mtime:stat.mtimeMs}))
    .update(fs.readFileSync(path.join(source,info))).digest('hex').slice(0,24);
  const cache=path.join(root,'.cache','dev-electron');
  const directory=path.join(cache,key);
  const bundle=path.join(directory,product+'.app');
  const executable=path.join(bundle,path.relative(source,binary));
  const receipt=path.join(directory,'ready.json');
  try {
    if(JSON.parse(fs.readFileSync(receipt,'utf8')).key===key){fs.accessSync(executable,fs.constants.X_OK);return executable;}
  } catch {}
  fs.mkdirSync(cache,{recursive:true});
  const temporary=fs.mkdtempSync(path.join(cache,'.prepare-'));
  const staged=path.join(temporary,product+'.app');
  try {
    fs.cpSync(source,staged,{recursive:true,verbatimSymlinks:true,mode:fs.constants.COPYFILE_FICLONE});
    const options={stdio:'pipe',timeout:120000};
    for(const name of ['CFBundleName','CFBundleDisplayName'])run('/usr/bin/plutil',['-replace',name,'-string',product,path.join(staged,info)],options);
    run('/usr/bin/codesign',['--force','--deep','--sign','-',staged],options);
    run('/usr/bin/codesign',['--verify','--deep','--strict',staged],options);
    fs.writeFileSync(path.join(temporary,'ready.json'),JSON.stringify({key})+'\n');
    fs.rmSync(directory,{recursive:true,force:true});
    fs.renameSync(temporary,directory);
    return executable;
  } finally {fs.rmSync(temporary,{recursive:true,force:true});}
}

module.exports={prepareDevelopmentApp};
