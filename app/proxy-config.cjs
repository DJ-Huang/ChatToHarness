'use strict';
const os=require('node:os');
const net=require('node:net');
const BASE_BYPASS=['localhost','.localhost','.local','127.0.0.0/8','::1','10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','169.254.0.0/16','fc00::/7','fe80::/10'];
function invalid(){return Object.assign(new Error('代理配置无效，请检查代理地址、端口和不走代理的地址。'),{code:'INVALID_PROXY_SETTINGS'});}
function subnet(value){
  const parts=value.split('/');
  if(parts.length!==2||!/^\d+$/.test(parts[1]))throw invalid();
  const family=net.isIP(parts[0]),bits=Number(parts[1]);
  if(!family||bits>(family===4?32:128))throw invalid();
  const block=new net.BlockList();block.addSubnet(parts[0],bits,family===4?'ipv4':'ipv6');return block;
}
function ipv6Network(ip,prefix){
  ip=ip.replace(/(\d+\.\d+\.\d+\.\d+)$/,tail=>{const bytes=tail.split('.').map(Number);return ((bytes[0]<<8)|bytes[1]).toString(16)+':'+((bytes[2]<<8)|bytes[3]).toString(16);});
  const [left,right]=ip.split('::'),head=left?left.split(':'):[],tail=right?right.split(':'):[];
  const words=right===undefined?head:[...head,...Array(8-head.length-tail.length).fill('0'),...tail];
  const numeric=words.reduce((value,word)=>(value<<16n)|BigInt('0x'+word),0n),shift=BigInt(128-Number(prefix));
  const network=(numeric>>shift)<<shift;
  const parts=Array.from({length:8},(_,index)=>((network>>BigInt((7-index)*16))&65535n).toString(16));
  let best=-1,length=1;
  for(let i=0;i<8;i++){if(parts[i]!=='0')continue;let j=i;while(j<8&&parts[j]==='0')j++;if(j-i>length){best=i;length=j-i;}i=j-1;}
  return (best<0?parts.join(':'):parts.slice(0,best).join(':')+'::'+parts.slice(best+length).join(':'))+'/'+prefix;
}
function defaultBypass(interfaces=os.networkInterfaces()){
  const result=[...BASE_BYPASS];
  for(const rows of Object.values(interfaces))for(const row of rows||[]){
    if(row.internal||!row.cidr)continue;
    const [ip,prefix]=row.cidr.split('/');
    try{
      subnet(row.cidr);
      if(net.isIP(ip)===4){
        const bits=Number(prefix),mask=bits===0?0:(0xffffffff<<(32-bits))>>>0;
        const number=ip.split('.').reduce((v,n)=>(v*256+Number(n))>>>0,0);
        const network=(number&mask)>>>0;
        result.push([24,16,8,0].map(shift=>(network>>>shift)&255).join('.')+'/'+bits);
      }else result.push(ipv6Network(ip,prefix));
    }catch{}
  }
  return [...new Set(result)];
}
function normalizeProxy(value,legacy=false){
  if(value===undefined)value={mode:legacy?'system':'direct'};
  if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();
  const mode=value.mode??'direct',type=value.type??'http',host=value.host??'127.0.0.1',port=value.port??7890;
  if(!['direct','system','manual'].includes(mode)||!['http','https','socks5'].includes(type)||typeof host!=='string'||host.length>253||!Number.isInteger(port)||port<1||port>65535)throw invalid();
  const hostname=host.trim().replace(/^\[|\]$/g,'');
  if(!net.isIP(hostname)&&!hostname.split('.').every(part=>/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(part)&&part.length<=63))throw invalid();
  let bypass=value.bypass===undefined?defaultBypass():value.bypass;
  if(typeof bypass==='string')bypass=bypass.split(/[\s,;]+/).filter(Boolean);
  if(!Array.isArray(bypass)||bypass.length>256)throw invalid();
  bypass=bypass.map(entry=>{
    if(typeof entry!=='string'||entry.length>253||!entry.trim())throw invalid();
    const rule=entry.trim().toLowerCase();
    if(rule.includes('/'))subnet(rule);
    else if(rule!=='*'&&!net.isIP(rule)&&!/^\*?\.?[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(rule))throw invalid();
    return rule;
  });
  const authEnabled=value.authEnabled??false,username=value.username??'',rememberPassword=value.rememberPassword??false,bypassLocal=value.bypassLocal??true,bypassLan=value.bypassLan??true;
  if([authEnabled,rememberPassword,bypassLocal,bypassLan].some(flag=>typeof flag!=='boolean')||typeof username!=='string'||Buffer.byteLength(username)>255||/[\r\n\0:]/.test(username))throw invalid();
  if(mode==='manual'&&authEnabled&&!username.trim())throw invalid();
  return {mode,type,host:hostname,port,bypass:[...new Set(bypass)],authEnabled,username,rememberPassword,bypassLocal,bypassLan};
}
function bypasses(url,rules){
  const host=new URL(url).hostname.replace(/^\[|\]$/g,'').toLowerCase();
  return rules.some(rule=>{
    if(rule==='*')return true;
    if(rule.includes('/'))return Boolean(net.isIP(host)&&subnet(rule).check(host,net.isIP(host)===4?'ipv4':'ipv6'));
    const domain=rule.replace(/^\*?\./,'');
    return host===domain||(!net.isIP(domain)&&host.endsWith('.'+domain));
  });
}
function manualProxyURL(config,password){
  const url=new URL(`${config.type}://${net.isIP(config.host)===6?'['+config.host+']':config.host}:${config.port}`);
  if(config.authEnabled){if(typeof password!=='string'||!password)throw Object.assign(new Error('请填写代理密码，或重新输入已保存的密码。'),{code:'PROXY_PASSWORD_REQUIRED'});url.username=config.username;url.password=password;}
  if(config.authEnabled&&(Buffer.byteLength(password)>(config.type==='socks5'?255:4096)||/[\r\n\0]/.test(password)))throw invalid();
  return url.href.replace(/\/$/,'');
}
function effectiveBypass(config){return [...new Set([...config.bypass,...(config.bypassLocal?BASE_BYPASS.slice(0,5):[]),...(config.bypassLan?defaultBypass().filter(value=>!BASE_BYPASS.slice(0,5).includes(value)):[])])];}
async function selectProxy(config,resolveSystemProxy,target,password){
  if(config.mode==='direct'||bypasses(target,effectiveBypass(config)))return null;
  return config.mode==='system'?resolveSystemProxy(target):manualProxyURL(config,password);
}
function credentialIdentity(config){return JSON.stringify([config.type,config.host,config.port,config.username]);}
module.exports={BASE_BYPASS,defaultBypass,normalizeProxy,bypasses,manualProxyURL,effectiveBypass,selectProxy,credentialIdentity};
