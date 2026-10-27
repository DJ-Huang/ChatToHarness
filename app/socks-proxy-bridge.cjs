'use strict';
const http=require('node:http'),net=require('node:net'),crypto=require('node:crypto');
const {socksConnect,connected}=require('./proxy-test.cjs');
async function startSocksBridge(upstream,target='https://api.openai.com'){
  const proxy=new URL(upstream),allowed=new URL(target),token=crypto.randomBytes(24).toString('hex');
  const authorization='Basic '+Buffer.from('cth:'+token).toString('base64'),sockets=new Set();
  const authorize=req=>{const value=String(req.headers['proxy-authorization']||'');return value.length===authorization.length&&crypto.timingSafeEqual(Buffer.from(value),Buffer.from(authorization));};
  const matches=url=>url.hostname===allowed.hostname&&(url.port||(url.protocol==='https:'?'443':'80'))===(allowed.port||(allowed.protocol==='https:'?'443':'80'));
  async function connect(url){
    const signal=AbortSignal.timeout(10000),socket=net.connect({host:proxy.hostname.replace(/^\[|\]$/g,''),port:Number(proxy.port)});
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    try{await connected(socket,'connect',signal);await socksConnect(socket,proxy,url,signal);return socket;}catch(error){socket.destroy();throw error;}
  }
  const server=http.createServer((req,res)=>{(async()=>{
    if(!authorize(req)){res.writeHead(407);res.end();return;}
    const url=new URL(req.url);if(url.protocol!=='http:'||!matches(url)){res.writeHead(403);res.end();return;}
    const socket=await connect(url),agent=new http.Agent();agent.createConnection=()=>socket;
    const headers={...req.headers};delete headers['proxy-authorization'];delete headers['proxy-connection'];
    const request=http.request(url,{method:req.method,headers,agent},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);response.once('end',()=>agent.destroy());});
    request.on('error',()=>{agent.destroy();if(!res.headersSent)res.writeHead(502);res.end();});res.once('close',()=>{request.destroy();agent.destroy();});req.pipe(request);
  })().catch(()=>{if(!res.headersSent)res.writeHead(502);res.end();});});
  server.on('connect',(req,client,head)=>{(async()=>{
    if(!authorize(req)){client.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');return;}
    const url=new URL('https://'+req.url);if(!matches(url)){client.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
    const socket=await connect(url);if(client.destroyed){socket.destroy();return;}
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)socket.write(head);
    client.pipe(socket);socket.pipe(client);client.once('close',()=>socket.destroy());socket.once('close',()=>client.destroy());
  })().catch(()=>client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));});
  server.on('connection',socket=>{if(sockets.size>=64){socket.destroy();return;}sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});});
  server.on('clientError',(_,socket)=>socket.destroy());
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {url:'http://cth:'+token+'@127.0.0.1:'+server.address().port,async close(){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
module.exports={startSocksBridge};
