'use strict';
const http=require('node:http');
const https=require('node:https');
const net=require('node:net');
const tls=require('node:tls');
const {normalizeProxy,selectProxy}=require('./proxy-config.cjs');
const failure=code=>Object.assign(new Error(code),{code});
function connected(socket,event,signal){return new Promise((resolve,reject)=>{
  const finish=error=>{socket.removeListener(event,ready);socket.removeListener('error',failed);signal.removeEventListener('abort',aborted);error?reject(error):resolve(socket);};
  const ready=()=>finish(),failed=error=>finish(error),aborted=()=>finish(failure('PROXY_TEST_TIMEOUT'));
  socket.once(event,ready);socket.once('error',failed);signal.addEventListener('abort',aborted,{once:true});if(signal.aborted)aborted();
});}
function read(socket,count,signal){return new Promise((resolve,reject)=>{
  const finish=(error,value)=>{socket.removeListener('readable',available);socket.removeListener('error',failed);socket.removeListener('end',ended);signal.removeEventListener('abort',aborted);error?reject(error):resolve(value);};
  const available=()=>{const value=socket.read(count);if(value)finish(null,value);},failed=error=>finish(error),ended=()=>finish(failure('PROXY_TEST_CONNECT_FAILED')),aborted=()=>finish(failure('PROXY_TEST_TIMEOUT'));
  socket.on('readable',available);socket.once('error',failed);socket.once('end',ended);signal.addEventListener('abort',aborted,{once:true});if(signal.aborted)aborted();else available();
});}
async function socksConnect(socket,proxy,target,signal){
  const username=Buffer.from(decodeURIComponent(proxy.username)),password=Buffer.from(decodeURIComponent(proxy.password));
  socket.write(Buffer.from(username.length?[5,2,0,2]:[5,1,0]));
  const greeting=await read(socket,2,signal);
  if(greeting[0]!==5)throw failure('PROXY_TEST_CONNECT_FAILED');
  if(greeting[1]===2){
    if(!username.length)throw failure('PROXY_TEST_AUTH_FAILED');
    socket.write(Buffer.concat([Buffer.from([1,username.length]),username,Buffer.from([password.length]),password]));
    const auth=await read(socket,2,signal);if(auth[0]!==1||auth[1]!==0)throw failure('PROXY_TEST_AUTH_FAILED');
  }else if(greeting[1]!==0)throw failure('PROXY_TEST_AUTH_FAILED');
  const hostname=target.hostname.replace(/^\[|\]$/g,''),port=Number(target.port||(target.protocol==='https:'?443:80));
  // SOCKS5 domain addressing preserves proxy-side DNS resolution, including IPv6 literals.
  const host=Buffer.from(hostname);socket.write(Buffer.concat([Buffer.from([5,1,0,3,host.length]),host,Buffer.from([port>>8,port&255])]));
  const reply=await read(socket,4,signal);if(reply[0]!==5||reply[1]!==0)throw failure('PROXY_TEST_CONNECT_FAILED');
  const length=reply[3]===1?4:reply[3]===4?16:reply[3]===3?(await read(socket,1,signal))[0]:0;
  if(!length)throw failure('PROXY_TEST_CONNECT_FAILED');await read(socket,length+2,signal);
}
async function httpConnect(socket,proxy,target,signal){
  const authority=target.hostname+':'+(target.port||443);
  const auth=proxy.username?'Proxy-Authorization: Basic '+Buffer.from(decodeURIComponent(proxy.username)+':'+decodeURIComponent(proxy.password)).toString('base64')+'\r\n':'';
  socket.write('CONNECT '+authority+' HTTP/1.1\r\nHost: '+authority+'\r\n'+auth+'\r\n');
  let header='';while(!header.endsWith('\r\n\r\n')){if(header.length>=16384)throw failure('PROXY_TEST_CONNECT_FAILED');header+=(await read(socket,1,signal)).toString('latin1');}
  const status=Number(/^HTTP\/1\.[01] (\d+)/.exec(header)?.[1]);
  if(status===407)throw failure('PROXY_TEST_AUTH_FAILED');if(status!==200)throw failure('PROXY_TEST_CONNECT_FAILED');
}
function request(target,proxy,socket,signal,ca){return new Promise((resolve,reject)=>{
  const directProtocol=target.protocol==='https:'?https:http;
  let agent;
  const options={method:'HEAD',signal,ca,headers:{'User-Agent':'ChatToHarness Proxy Check'}};
  if(socket){agent=target.protocol==='https:'?new https.Agent():new http.Agent();agent.createConnection=()=>socket;options.agent=agent;}
  if(proxy&&!socket){
    options.protocol=proxy.protocol;options.hostname=proxy.hostname.replace(/^\[|\]$/g,'');options.port=proxy.port;options.path=target.href;options.headers.Host=target.host;
    options.servername=net.isIP(options.hostname)?'':options.hostname;
    if(proxy.username)options.headers['Proxy-Authorization']='Basic '+Buffer.from(decodeURIComponent(proxy.username)+':'+decodeURIComponent(proxy.password)).toString('base64');
  }
  const transport=proxy&&!socket?(proxy.protocol==='https:'?https:http):directProtocol;
  const onResponse=response=>{
    const code=response.statusCode;response.resume();agent?.destroy();
    if(code===407)reject(failure('PROXY_TEST_AUTH_FAILED'));else if(code>=200&&code<500)resolve(code);else reject(failure('PROXY_TEST_TARGET_FAILED'));
  };
  const req=proxy&&!socket?transport.request(options,onResponse):transport.request(target,options,onResponse);
  req.on('error',error=>{agent?.destroy();reject(error);});req.end();
});}
async function testProxy({config,password,target='https://api.openai.com',resolveSystemProxy=async()=>null,timeout=10000,ca}){
  const start=Date.now();let socket;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);timer.unref?.();
  try{
    let url;try{url=new URL(target);}catch{throw failure('PROXY_TEST_INVALID_URL');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash)throw failure('PROXY_TEST_INVALID_URL');
    const settings=normalizeProxy(config),selected=await Promise.race([selectProxy(settings,resolveSystemProxy,url.href,password),new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(failure('PROXY_TEST_TIMEOUT')),{once:true}))]);
    const proxy=selected?new URL(selected):null;
    if(proxy&&(proxy.protocol==='socks5:'||url.protocol==='https:')){
      const host=proxy.hostname.replace(/^\[|\]$/g,'');
      socket=proxy.protocol==='https:'?tls.connect({host,port:Number(proxy.port||443),servername:net.isIP(host)?undefined:host,ca}):net.connect({host,port:Number(proxy.port||(proxy.protocol==='http:'?80:1080))});
      socket.on('error',()=>{});await connected(socket,proxy.protocol==='https:'?'secureConnect':'connect',controller.signal);
      if(proxy.protocol==='socks5:')await socksConnect(socket,proxy,url,controller.signal);else await httpConnect(socket,proxy,url,controller.signal);
      if(url.protocol==='https:'){const host=url.hostname.replace(/^\[|\]$/g,'');socket=tls.connect({socket,host,servername:net.isIP(host)?undefined:host,ca});socket.on('error',()=>{});await connected(socket,'secureConnect',controller.signal);}
    }
    const status=await request(url,proxy,socket,controller.signal,ca);
    return {ok:true,status,elapsedMs:Date.now()-start,route:proxy?'proxy':'direct'};
  }catch(error){const code=controller.signal.aborted?'PROXY_TEST_TIMEOUT':/^PROXY_/.test(error.code||'')?error.code:error.code==='ENOTFOUND'?'PROXY_TEST_DNS_FAILED':/CERT|TLS|SSL/.test(error.code||'')?'PROXY_TEST_TLS_FAILED':'PROXY_TEST_CONNECT_FAILED';return {ok:false,code};}
  finally{clearTimeout(timer);socket?.destroy();}
}
module.exports={testProxy,socksConnect,connected};
