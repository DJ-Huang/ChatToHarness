'use strict';
const http=require('node:http'),https=require('node:https'),net=require('node:net'),fs=require('node:fs'),path=require('node:path');
// Public test-only localhost certificate and key; never installed into a trust store.
const ca=fs.readFileSync(path.join(__dirname,'proxy-test-cert.pem'));
const tlsOptions={cert:ca,key:fs.readFileSync(path.join(__dirname,'proxy-test-key.pem'))};
function read(socket,size){return new Promise((resolve,reject)=>{
  const cleanup=()=>{socket.removeListener('readable',check);socket.removeListener('error',fail);socket.removeListener('end',end);};
  const check=()=>{const value=socket.read(size);if(value){cleanup();resolve(value);}},fail=error=>{cleanup();reject(error);},end=()=>fail(new Error('closed'));
  socket.on('readable',check);socket.once('error',fail);socket.once('end',end);check();
});}
async function start(kind,{username='proxy-user',password='s@fe:/?#secret',targetPort}={}){
  const sockets=new Set(),requests=[];let accepted=0,rejected=0;
  const expected='Basic '+Buffer.from(username+':'+password).toString('base64');
  const handler=(req,res)=>{
    const valid=req.headers['proxy-authorization']===expected;
    requests.push({method:req.method,valid});valid?accepted++:rejected++;
    res.writeHead(valid?200:407,{'Content-Type':'application/json',...(valid?{}:{'Proxy-Authenticate':'Basic realm="fixture"'})});res.end(JSON.stringify({commands:[]}));
  };
  const server=kind==='http'?http.createServer(handler):kind==='https'?https.createServer(tlsOptions,handler):net.createServer(socket=>{(async()=>{
    const greeting=await read(socket,2),methods=await read(socket,greeting[1]);
    if(!methods.includes(2)){rejected++;socket.end(Buffer.from([5,255]));return;}
    socket.write(Buffer.from([5,2]));const auth=await read(socket,2),user=await read(socket,auth[1]),length=await read(socket,1),pass=await read(socket,length[0]);
    const valid=user.toString()===username&&pass.toString()===password;
    if(!valid){rejected++;socket.end(Buffer.from([1,1]));return;}
    accepted++;socket.write(Buffer.from([1,0]));
    const connect=await read(socket,4);const count=connect[3]===1?4:connect[3]===4?16:(await read(socket,1))[0];
    await read(socket,count+2);socket.write(Buffer.from([5,0,0,1,127,0,0,1,0,0]));
    if(targetPort){const remote=net.connect(targetPort,'127.0.0.1');socket.pipe(remote);remote.pipe(socket);socket.once('close',()=>remote.destroy());remote.on('error',()=>socket.destroy());return;}
    let header='';while(!header.endsWith('\r\n\r\n')&&header.length<16384)header+=(await read(socket,1)).toString();
    requests.push({method:header.split(' ')[0],valid:true});socket.end('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 15\r\nConnection: close\r\n\r\n{"commands":[]}');
  })().catch(()=>socket.destroy());});
  if(kind==='http'||kind==='https')server.on('connect',(req,socket)=>{
    const valid=req.headers['proxy-authorization']===expected;requests.push({method:'CONNECT',valid});valid?accepted++:rejected++;
    if(valid&&targetPort){const remote=net.connect(targetPort,'127.0.0.1',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');socket.pipe(remote);remote.pipe(socket);});socket.once('close',()=>remote.destroy());remote.on('error',()=>socket.destroy());return;}
    socket.end('HTTP/1.1 '+(valid?'502 Bad Gateway':'407 Proxy Authentication Required')+'\r\nContent-Length: 0\r\n\r\n');
  });
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {port:server.address().port,requests,get accepted(){return accepted;},get rejected(){return rejected;},async close(){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
module.exports={start,ca,tlsOptions};
