'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {readJson,privateDirectory}=require('./durable-files.cjs');
const MiB=1024*1024, HARD=50*MiB, SOFT=40*MiB, AGE=7*86400000;
function regular(file){try{const s=fs.lstatSync(file);return s.isFile()&&s.nlink===1?s:null;}catch{return null;}}
function directory(file){try{return fs.lstatSync(file).isDirectory()&&!fs.lstatSync(file).isSymbolicLink();}catch{return false;}}
function inventory(home){
  const files=[];
  const add=(file,kind,clean=true)=>{let stat;try{stat=fs.lstatSync(file);}catch{return;}if(stat.isFile()){
    let detailed=false;clean=clean&&stat.nlink===1;
    if(kind==='executions'&&stat.nlink===1)try{const row=readJson(file,24576);clean=!['received','waiting_approval','submitted','running','cancelling'].includes(row.state);detailed=Boolean(row.stdout);}catch{}
    files.push({file,kind,clean,detailed,size:stat.size,time:stat.mtimeMs});
  }};
  for(const sub of ['logs','executions','diagnostics']){
    const dir=path.join(home,sub);if(!directory(dir))continue;
    for(const name of fs.readdirSync(dir))if(sub!=='logs'||/^app\.log(?:\.previous)?$/.test(name))add(path.join(dir,name),sub==='executions'&&!/^exec_[a-f0-9-]{36}\.json$/.test(name)?'temporary':sub);
  }
  const tasks=path.join(home,'tasks');
  if(directory(tasks))for(const name of fs.readdirSync(tasks)){
    const dir=path.join(tasks,name);if(!/^task_[a-f0-9]{64}$/.test(name)||!directory(dir))continue;
    let finished=false;try{finished=Boolean(readJson(path.join(dir,'state.json')).finished_at);}catch{}
    add(path.join(dir,'output.jsonl'),'output',finished);
  }
  return files;
}
// Shared by app and detached workers. Contention drops diagnostic writes rather
// than queueing output in memory. A dead owner's lock can be reclaimed.
function locked(home,fn){
  privateDirectory(home);const lock=path.join(home,'diagnostic-budget.lock');let fd;
  try{fd=fs.openSync(lock,'wx',0o600);fs.writeFileSync(fd,String(process.pid));}
  catch(error){
    if(error.code!=='EEXIST')return false;
    try{const stat=regular(lock);if(!stat||stat.size>32)return false;const lockFd=fs.openSync(lock,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let pid;try{pid=Number(fs.readFileSync(lockFd,'utf8'));}finally{fs.closeSync(lockFd);}if(pid>0){try{process.kill(pid,0);return false;}catch(e){if(e.code!=='ESRCH')return false;}}else return false;fs.unlinkSync(lock);}catch{return false;}
    return locked(home,fn);
  }
  try{return fn();}finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
function cleanup(home,{now=Date.now(),incoming=0,recordSlot=0}={}){
  let files=inventory(home),total=files.reduce((n,f)=>n+f.size,0),detail=files.filter(f=>(f.kind==='diagnostics'||f.detailed)).reduce((n,f)=>n+f.size,0);
  const records=files.filter(f=>f.kind==='executions').sort((a,b)=>a.time-b.time);let count=records.length;
  for(const f of files.sort((a,b)=>a.time-b.time)){
    if(!f.clean)continue;
    if(now-f.time<AGE&&total+incoming<SOFT&&!(f.kind==='executions'&&count+recordSlot>10000)&&!((f.kind==='diagnostics'||f.detailed)&&detail>10*MiB))continue;
    try{
      if(f.kind==='output'){const marker=path.join(path.dirname(f.file),'output.expired');try{fs.writeFileSync(marker,'expired\n',{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST'||!regular(marker))throw error;}}
      fs.unlinkSync(f.file);total-=f.size;if(f.kind==='executions')--count;if((f.kind==='diagnostics'||f.detailed))detail-=f.size;
    }catch{}
  }
  return {bytes:total,limit:HARD,detailBytes:detail,records:count};
}
function writeBudgeted(home,bytes,write,options={}){try{return locked(home,()=>{const usage=cleanup(home,{...options,incoming:bytes});if(usage.records+(options.recordSlot||0)>10000||usage.bytes+bytes>(options.ceiling||HARD)||options.detailed&&usage.detailBytes+bytes>10*MiB)return false;write();return true;});}catch{return false;}}
function sanitize(value,limit=2048,secrets=[]){
  let text=String(value??'').slice(0,Math.max(limit*4,8192));
  for(const secret of [...new Set(secrets)].filter(value=>typeof value==='string'&&value.length).sort((a,b)=>b.length-a.length))text=text.split(secret).join('[redacted]');
  text=text.replace(/([\"']?(?:token|password|secret|api[_-]?key|authorization|cookie)[\"']?\s*[:=]\s*)[\"'][^\"']*[\"']/gi,'$1[redacted]').replace(/(?:Bearer|Basic)\s+[^\s"',]+/gi,'[redacted authorization]').replace(/((?:token|password|secret|api[_-]?key|authorization|cookie)\s*[=:]\s*)[^\s,;"}]+/gi,'$1[redacted]').replace(/\b[A-Za-z0-9+/_=-]{64,}\b/g,'[omitted data]').replace(/https?:\/\/[^\s]+/g,'[URL omitted]');
  text=text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,' ');
  return Buffer.from(text).subarray(0,limit).toString('utf8').replace(/\uFFFD$/,'');
}
function safeFields(value,depth=0){
  // Optional fields must stay absent. Treating undefined as a diagnostic value
  // used to turn normal empty error fields into the visible text [omitted].
  if(value===undefined)return undefined;
  if(typeof value==='string')return sanitize(value,512);
  if(value===null||typeof value==='boolean'||typeof value==='number')return value;
  if(!value||typeof value!=='object'||depth>3)return '[omitted]';
  if(Array.isArray(value))return value.slice(0,16).map(item=>safeFields(item,depth+1));
  const fields={};for(const [key,item]of Object.entries(value).slice(0,24)){if(item===undefined)continue;fields[sanitize(key,64)]=/token|secret|password|authorization|cookie|api.?key|^env$|headers|content|base64/i.test(key)?'[redacted]':safeFields(item,depth+1);}
  return fields;
}
module.exports={safeFields,HARD,SOFT,AGE,inventory,cleanup,locked,writeBudgeted,sanitize,regular};
