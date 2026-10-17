'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
let executable;
function windowsProcessHost(){
  if(process.platform!=='win32')return undefined;
  if(executable)return executable;
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chatharness-native-test-'));
  executable=path.join(directory,'ChatToHarness.ProcessHost.exe');
  const compiler=path.join(process.env.SystemRoot||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  execFileSync(compiler,['/nologo','/target:exe','/platform:x64','/optimize+','/out:'+executable,path.resolve(__dirname,'../native/ManagedProcess.cs')],{windowsHide:true,stdio:'pipe'});
  process.once('exit',()=>{try{fs.rmSync(directory,{recursive:true,force:true});}catch{}});
  return executable;
}
module.exports={windowsProcessHost};
