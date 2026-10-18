'use strict';
const fs=require('node:fs');
const {writeBudgeted,sanitize}=require('./diagnostic-budget.cjs');
const TASK_LIMIT=4*1024*1024;
class TaskOutput{
  constructor({home,file,clock=Date.now,secrets=[]}){
    Object.assign(this,{home,clock,secrets});this.bytes=0;this.truncated=false;this.pending='';
    this.fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_APPEND|fs.constants.O_NOFOLLOW,0o600);
    const stat=fs.fstatSync(this.fd);if(!stat.isFile()||stat.nlink!==1){fs.closeSync(this.fd);throw new Error('UNSAFE_TASK_OUTPUT');}this.bytes=stat.size;
  }
  append(stream,text){
    if(this.truncated)return;
    text=sanitize(text,16384,this.secrets);
    for(let at=0;at<text.length;at+=2048){
      const row=JSON.stringify({at:new Date(this.clock()).toISOString(),stream,text:text.slice(at,at+2048)})+'\n';
      if(this.bytes+Buffer.byteLength(this.pending)+Buffer.byteLength(row)>TASK_LIMIT){this.flush();this.truncated=true;return;}
      if(Buffer.byteLength(this.pending)+Buffer.byteLength(row)>65536)this.flush();
      if(this.truncated)return;this.pending+=row;
    }
  }
  flush(){
    if(!this.pending)return;const row=this.pending;this.pending='';
    // Reserve headroom for terminal execution records while detached workers
    // still share the same absolute 50MiB ceiling with every other diagnostic.
    if(writeBudgeted(this.home,Buffer.byteLength(row),()=>fs.writeSync(this.fd,row),{ceiling:46*1024*1024}))this.bytes+=Buffer.byteLength(row);else this.truncated=true;
  }
  close(){this.flush();fs.fsyncSync(this.fd);fs.closeSync(this.fd);}
}
module.exports={TaskOutput,TASK_LIMIT};
