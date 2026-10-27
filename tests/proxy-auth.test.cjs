'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const {testProxy}=require('../app/proxy-test.cjs');
const {normalizeProxy,manualProxyURL}=require('../app/proxy-config.cjs');
const {start,ca,tlsOptions}=require('./fixtures/auth-proxies.cjs');
const {stopTree,tunnelCommand}=require('../app/platform.cjs');
const {startSocksBridge}=require('../app/socks-proxy-bridge.cjs');
const password='s@fe:/?#secret';
const config=(type,port)=>({mode:'manual',type,host:'127.0.0.1',port,authEnabled:true,username:'proxy-user',bypass:[],bypassLocal:false,bypassLan:false});
for(const type of ['http','https','socks5']){
  test(type+' connection test negotiates real username/password authentication and reports rejection',async t=>{
    const proxy=await start(type);t.after(()=>proxy.close());
    const good=await testProxy({config:config(type,proxy.port),password,target:'http://destination.invalid/check',ca});
    assert.equal(good.ok,true);assert.equal(good.route,'proxy');assert.equal(proxy.accepted,1);
    const bad=await testProxy({config:config(type,proxy.port),password:'wrong',target:'http://destination.invalid/check',ca});
    assert.deepEqual(bad,{ok:false,code:'PROXY_TEST_AUTH_FAILED'});assert.equal(proxy.rejected,1);
    assert.ok(!JSON.stringify(good).includes(password));assert.ok(!JSON.stringify(bad).includes(password));
  });
}
for(const type of ['http','https','socks5'])test(type+' authenticated connection test reaches a real TLS target without disabling certificate checks',async t=>{
  const https=require('node:https');const target=https.createServer(tlsOptions,(req,res)=>{res.writeHead(200);res.end();});
  await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));t.after(()=>{target.closeAllConnections();return new Promise(resolve=>target.close(resolve));});
  const proxy=await start(type,{targetPort:target.address().port});t.after(()=>proxy.close());
  const result=await testProxy({config:config(type,proxy.port),password,target:'https://localhost:'+target.address().port,ca});
  assert.equal(result.ok,true);assert.equal(result.status,200);
});
test('HTTP CONNECT sends proxy authentication before attempting TLS to a target',async t=>{
  const proxy=await start('http');t.after(()=>proxy.close());
  await testProxy({config:config('http',proxy.port),password,target:'https://destination.invalid'});
  assert.deepEqual(proxy.requests,[{method:'CONNECT',valid:true}]);
});
test('SOCKS bridge authenticates, restricts its destination and closes all listeners',async t=>{
  const https=require('node:https');const target=https.createServer(tlsOptions,(req,res)=>{res.writeHead(200);res.end();});
  await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));t.after(()=>{target.closeAllConnections();return new Promise(resolve=>target.close(resolve));});
  const upstream=await start('socks5',{targetPort:target.address().port});t.after(()=>upstream.close());
  const destination='https://localhost:'+target.address().port;
  const bridge=await startSocksBridge(manualProxyURL(normalizeProxy(config('socks5',upstream.port)),password),destination);t.after(()=>bridge.close());
  const url=new URL(bridge.url),bridgeConfig={...config('http',Number(url.port)),username:url.username};
  const result=await testProxy({config:bridgeConfig,password:url.password,target:destination,ca});assert.equal(result.ok,true);
  const before=upstream.accepted;
  assert.equal((await testProxy({config:bridgeConfig,password:'wrong',target:destination,ca})).code,'PROXY_TEST_AUTH_FAILED');
  assert.equal((await testProxy({config:bridgeConfig,password:url.password,target:'https://other.invalid',ca})).ok,false);
  assert.equal(upstream.accepted,before);
  await bridge.close();
  assert.equal((await testProxy({config:bridgeConfig,password:url.password,target:destination,ca})).ok,false);
});
test('bypass overrides authentication, invalid URLs and stalled connections report bounded safe errors',async t=>{
  const http=require('node:http'),net=require('node:net');
  const target=http.createServer((req,res)=>{res.writeHead(401);res.end();});await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>target.close(resolve)));
  const result=await testProxy({config:{...config('http',1),bypass:['127.0.0.0/8']},target:'http://127.0.0.1:'+target.address().port});
  assert.equal(result.ok,true);assert.equal(result.route,'direct');assert.equal(result.status,401);
  assert.equal((await testProxy({config:{mode:'direct'},target:'file:///secret'})).code,'PROXY_TEST_INVALID_URL');
  const sockets=new Set(),stall=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise(resolve=>stall.listen(0,'127.0.0.1',resolve));
  t.after(()=>{for(const socket of sockets)socket.destroy();return new Promise(resolve=>stall.close(resolve));});
  const timed=await testProxy({config:{...config('socks5',stall.address().port)},password,target:'http://destination.invalid',timeout:80});
  assert.equal(timed.code,'PROXY_TEST_TIMEOUT');
});
const binary=path.resolve('resources/tunnel',process.platform==='win32'?'tunnel-client-runtime.exe':'tunnel-client-runtime');
for(const type of ['http','https','socks5'])test('bundled Tunnel authenticates '+type+' using an environment proxy reference',{skip:!fs.existsSync(binary),timeout:10000},async t=>{
  const proxy=await start(type);t.after(()=>proxy.close());
  const url=manualProxyURL(normalizeProxy(config(type,proxy.port)),password);
  const bridge=type==='socks5'?await startSocksBridge(url,'http://destination.invalid'):null;if(bridge)t.after(()=>bridge.close());
  const env={...process.env,CONTROL_PLANE_HTTP_PROXY:bridge?.url||url,PROXY_TEST_KEY:'synthetic-key',NO_PROXY:'',no_proxy:''};
  const child=spawn(binary,['run','--ca-bundle',path.join(__dirname,'fixtures/proxy-test-cert.pem'),'--control-plane.http-proxy','env:CONTROL_PLANE_HTTP_PROXY','--control-plane.api-key','env:PROXY_TEST_KEY','--control-plane.tunnel-id','tunnel_'+'a'.repeat(32),'--control-plane.base-url','http://destination.invalid','--mcp.command',tunnelCommand([process.execPath,path.join(__dirname,'fixtures/mcp-server.cjs')]),'--health.listen-addr','127.0.0.1:0'],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  let diagnostics='';for(const stream of [child.stdout,child.stderr])stream.on('data',part=>{diagnostics=(diagnostics+part).slice(-2000);});
  t.after(()=>stopTree(child));
  for(let i=0;i<100&&!proxy.requests.length;i++)await new Promise(resolve=>setTimeout(resolve,40));
  assert.ok(proxy.requests.some(row=>row.valid),'Tunnel must complete authentication and send a request: '+diagnostics.replaceAll(url,'[proxy]').replaceAll(password,'[password]'));
});
