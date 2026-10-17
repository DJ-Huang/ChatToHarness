'use strict';

// Standalone bundled Node entry point. MCP and credentials stay in the desktop
// main process; this relay has no third-party dependencies or child processes.
const net=require('node:net');
const endpoint=process.env.CTH_GATEWAY_ENDPOINT,token=process.env.CTH_GATEWAY_TOKEN,owner=Number(process.env.CTH_GATEWAY_OWNER);
delete process.env.CTH_GATEWAY_ENDPOINT;delete process.env.CTH_GATEWAY_TOKEN;delete process.env.CTH_GATEWAY_OWNER;
if(!endpoint||!/^[a-f0-9]{64}$/.test(token||'')||!Number.isSafeInteger(owner)||owner<2){process.stderr.write('MCP_GATEWAY_UNAVAILABLE\n');process.exit(1);}
let closing=false,ready=false,buffer=Buffer.alloc(0);
const socket=net.createConnection(endpoint);
const deadline=setTimeout(()=>stop(1),5000);
const watchdog=setInterval(()=>{try{process.kill(owner,0);if(process.ppid===1)stop(1);}catch{stop(1);}},1000);
function stop(code=0){if(closing)return;closing=true;clearTimeout(deadline);clearInterval(watchdog);socket.destroy();process.exit(code);}
socket.once('connect',()=>socket.write(JSON.stringify({token})+'\n'));
socket.on('data',function handshake(chunk){
  if(ready)return;
  buffer=Buffer.concat([buffer,chunk]);const end=buffer.indexOf(10);
  if((end<0&&buffer.length>512)||end>512)return stop(1);
  if(end<0)return;
  try{if(JSON.parse(buffer.subarray(0,end).toString('utf8')).ready!==true)return stop(1);}catch{return stop(1);}
  ready=true;clearTimeout(deadline);socket.off('data',handshake);
  const remainder=buffer.subarray(end+1);buffer=Buffer.alloc(0);
  if(remainder.length)process.stdout.write(remainder);
  socket.pipe(process.stdout);process.stdin.pipe(socket);
});
socket.on('error',()=>stop(1));socket.on('end',()=>stop());socket.on('close',()=>stop());
process.stdin.on('error',()=>stop(1));process.stdout.on('error',()=>stop(1));process.stdin.on('end',()=>stop());
process.on('SIGTERM',()=>stop());process.on('SIGINT',()=>stop());process.on('SIGHUP',()=>stop());
