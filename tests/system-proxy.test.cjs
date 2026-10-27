'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {proxyURL}=require('../app/system-proxy.cjs');
const {RuntimeManager}=require('../app/runtime.cjs');
const {defaultBypass,normalizeProxy,bypasses,manualProxyURL}=require('../app/proxy-config.cjs');

test('default bypass includes actual adapter prefixes, not guessed /24 ranges',()=>{
  const defaults=defaultBypass({lan:[{internal:false,cidr:'203.0.113.174/25'},{internal:false,cidr:'10.18.2.4/20'},{internal:false,cidr:'2001:db8:1234:5678::abcd/64'}],loop:[{internal:true,cidr:'127.0.0.1/8'}]});
  assert.ok(defaults.includes('203.0.113.128/25'));
  assert.ok(defaults.includes('10.18.0.0/20'));
  assert.ok(defaults.includes('2001:db8:1234:5678::/64'));
  for(const target of ['http://localhost','http://127.3.4.5','http://192.168.12.8','http://[::1]','http://[fd12::5]','http://203.0.113.200'])assert.equal(bypasses(target,defaults),true,target);
  assert.equal(bypasses('http://203.0.113.127',defaults),false);
});

test('bypass domains match boundaries and CIDR supports IPv4 and IPv6',()=>{
  const rules=normalizeProxy({bypass:'*.example.com,192.0.2.0/24\n2001:db8::/32'}).bypass;
  assert.equal(bypasses('https://api.example.com',rules),true);
  assert.equal(bypasses('https://notexample.com',rules),false);
  assert.equal(bypasses('https://example.com.evil.test',rules),false);
  assert.equal(bypasses('http://192.0.2.255',rules),true);
  assert.equal(bypasses('http://192.0.3.1',rules),false);
  assert.equal(bypasses('http://[2001:db8::1234]',rules),true);
  assert.equal(bypasses('http://[2001:db9::1]',rules),false);
});

test('manual proxy validates server, types, ports and bypass inputs',()=>{
  for(const type of ['http','https','socks5'])assert.equal(manualProxyURL(normalizeProxy({mode:'manual',type,host:'::1',port:1080})),type+'://[::1]:1080');
  for(const value of [{mode:'other'},{type:'socks4'},{host:'http://localhost'},{host:'user:pass@host'},{port:0},{port:65536},{port:3.5},{bypass:['10.0.0.0/33']},{bypass:['::/129']},{bypass:['example.com/path']},{bypass:['bad address']}])assert.throws(()=>normalizeProxy(value),{code:'INVALID_PROXY_SETTINGS'});
});

test('manual routing respects bypass before proxy selection and direct never reads system settings',async t=>{
  let calls=0;
  const manager=new RuntimeManager({home:__dirname,paths:{},resolveSystemProxy:async()=>{calls++;return 'http://localhost:7890';}});
  t.after(()=>manager.close());manager.probe=async()=>1;manager.launch=()=>{};
  const settings={tunnelId:'tunnel_'+'a'.repeat(32),directories:[]};
  await manager.connect({...settings,proxy:{mode:'manual',type:'socks5',host:'127.0.0.1',port:1080,bypass:[]}},'synthetic-key');
  assert.equal(manager.desired.systemProxy,'socks5://127.0.0.1:1080');
  await manager.connect({...settings,proxy:{mode:'manual',bypass:['.openai.com']}},'synthetic-key');
  assert.equal(manager.desired.systemProxy,null);
  await manager.connect({...settings,proxy:{mode:'system',bypass:['api.openai.com']}},'synthetic-key');
  assert.equal(manager.desired.systemProxy,null);assert.equal(calls,0);
  await manager.connect({...settings,proxy:{mode:'direct'}},'synthetic-key');
  assert.equal(manager.desired.systemProxy,null);assert.equal(calls,0);
});

test('system proxy resolution preserves PAC order and rejects unsupported or malformed entries',()=>{
  assert.equal(proxyURL('PROXY 127.0.0.1:7897; DIRECT'),'http://127.0.0.1:7897');
  assert.equal(proxyURL('DIRECT; PROXY localhost:7897'),null);
  assert.equal(proxyURL('SOCKS5 localhost:1080'),'socks5://localhost:1080');
  assert.equal(proxyURL('HTTPS proxy.example:8443'),'https://proxy.example:8443');
  for(const value of ['', 'SOCKS4 localhost:1080','PROXY user:pass@localhost:7897','PROXY localhost:7897/path'])assert.throws(()=>proxyURL(value));
});

test('proxy opt-in reads fresh configuration on connect and persists it for retries',async t=>{
  let calls=0;
  const manager=new RuntimeManager({home:__dirname,paths:{},resolveSystemProxy:async()=>{calls++;return 'http://127.0.0.1:7897';}});
  t.after(()=>manager.close());
  manager.probe=async()=>1;
  manager.launch=()=>{};
  const settings={tunnelId:'tunnel_'+'a'.repeat(32),directories:[__dirname]};
  await manager.connect(settings,'synthetic-key');
  assert.equal(calls,0);assert.equal(manager.desired.systemProxy,null);
  await manager.connect({...settings,useSystemProxy:true},'synthetic-key');
  assert.equal(calls,1);assert.equal(manager.desired.systemProxy,'http://127.0.0.1:7897');
  await manager.connect({...settings,useSystemProxy:true},'synthetic-key');
  assert.equal(calls,2);
  await manager.connect({...settings,useSystemProxy:false},'synthetic-key');
  assert.equal(calls,2);assert.equal(manager.desired.systemProxy,null);
});
