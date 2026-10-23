'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {readJson,syncDirectory}=require('./durable-files.cjs');
const NEW_RE=/^cu-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}_[0-9]{13}(?:_[1-9][0-9]*)?$/;
const DEVICE_RE=/^cu-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail=code=>Object.assign(new Error(code),{code});
const keyHash=(session,key)=>crypto.createHash('sha256').update(JSON.stringify([session,key])).digest('hex');
const recordFile=(directory,id)=>path.join(directory,id+'.json');
const indexFile=(directory,session,key)=>path.join(directory,'.key-'+keyHash(session,key)+'.json');
function validId(id){return typeof id==='string'&&NEW_RE.test(id);}
function existing(directory,session,key){
  const pathname=indexFile(directory,session,key);
  if(!fs.existsSync(pathname))return null;
  const row=readJson(pathname);
  if(row.session_id!==session||row.key_digest!==keyHash(session,key)||!validId(row.task_id))
    throw fail('CU_TASK_INDEX_CORRUPT');
  if(!fs.existsSync(recordFile(directory,row.task_id)))throw fail('CU_TASK_START_INCOMPLETE');
  return row.task_id;
}
function create(directory,service,session,key,record){
  const device=service.deviceId;
  if(!DEVICE_RE.test(device||''))throw fail('CU_DEVICE_ID_UNAVAILABLE');
  const ms=String(Date.now());
  let id,fd;
  for(let sequence=0;sequence<10000;sequence++){
    id=device+'_'+ms+(sequence?'_'+sequence:'');
    try{fd=fs.openSync(recordFile(directory,id),'wx',0o600);break;}
    catch(e){if(e.code!=='EEXIST')throw e;}
  }
  if(fd===undefined)throw fail('CU_TASK_ID_EXHAUSTED');
  record.task_id=id;
  try{fs.writeFileSync(fd,JSON.stringify(record)+'\n');fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  syncDirectory(directory);
  const index={schema:1,task_id:id,session_id:session,key_digest:keyHash(session,key)};
  const pathname=indexFile(directory,session,key);
  try{
    const handle=fs.openSync(pathname,'wx',0o600);
    try{fs.writeFileSync(handle,JSON.stringify(index)+'\n');fs.fsyncSync(handle);}
    finally{fs.closeSync(handle);}
    syncDirectory(directory);
  }catch(e){
    fs.rmSync(recordFile(directory,id),{force:true});
    if(e.code==='EEXIST')return {task_id:existing(directory,session,key),reused:true};
    throw e;
  }
  return {task_id:id,reused:false};
}
module.exports={NEW_RE,validId,existing,create,keyHash};
