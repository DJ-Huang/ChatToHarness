'use strict';
const {execFile}=require('node:child_process');
const fs=require('node:fs');

const CODES=new Set(['CU_SCREEN_RECORDING_REQUIRED','CU_ACCESSIBILITY_REQUIRED','CU_CONSENT_DENIED']);
function permissionCode(result) {
  const data=result?.structuredContent||result||{};
  if(CODES.has(data.code))return data.code;
  if(data.input_enabled===false && CODES.has(data.input_blocked_reason))return data.input_blocked_reason;
  return null;
}
// Only the macOS native helper can check TCC. Windows uses its own per-window
// consent and does not have Screen Recording/Accessibility TCC requirements.
class ComputerUsePermissions {
  constructor({platform=process.platform,helper,execute=execFile}={}) {
    this.platform=platform;this.helper=helper;this.execute=execute;
  }
  async check({request=false}={}) {
    if(this.platform==='win32')return {platform:'win32',granted:true,missing:[],authorization:'per_window'};
    if(this.platform!=='darwin'||!this.helper||!fs.existsSync(this.helper))throw Error('CU_HELPER_UNAVAILABLE');
    const data=await new Promise((resolve,reject)=>{
      this.execute(this.helper,[request?'request_permissions':'permission_status'],
        {timeout:12000,encoding:'utf8',maxBuffer:4096,windowsHide:true},(error,stdout)=>{
          if(error)return reject(Error('CU_PERMISSION_CHECK_FAILED'));
          try{resolve(JSON.parse(stdout.trim()));}catch{reject(Error('CU_PERMISSION_CHECK_FAILED'));}
        });
    });
    if(typeof data.screen_recording!=='boolean'||typeof data.accessibility!=='boolean')throw Error('CU_PERMISSION_CHECK_FAILED');
    const missing=[];
    if(!data.screen_recording)missing.push('screen_recording');
    if(!data.accessibility)missing.push('accessibility');
    return {platform:'darwin',granted:!missing.length,missing,authorization:'system',
      request_attempted:request};
  }
}
module.exports={ComputerUsePermissions,permissionCode};
