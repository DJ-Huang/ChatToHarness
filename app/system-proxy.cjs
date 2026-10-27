'use strict';

// Electron resolves Windows/macOS system proxy settings, including PAC, for
// this destination. Preserve DIRECT ordering; never fall back to direct when
// the selected system proxy cannot be represented by the Tunnel runtime.
function proxyURL(result) {
  const first=String(result||'').split(';')[0].trim();
  if(first==='DIRECT')return null;
  const match=/^(PROXY|HTTPS|SOCKS|SOCKS4|SOCKS5)\s+(\S+)$/i.exec(first);
  if(!match)throw new Error('无法读取可用的系统代理，请检查系统代理设置。');
  const scheme={PROXY:'http',HTTPS:'https',SOCKS:'socks5',SOCKS5:'socks5'}[match[1].toUpperCase()];
  if(!scheme)throw new Error('系统代理类型暂不支持，请配置 HTTP 或 SOCKS5 代理。');
  try {
    const url=new URL(scheme+'://'+match[2]);
    if(!url.hostname||!/:\d+$/.test(match[2])||url.username||url.password||(url.pathname&&url.pathname!=='/')||url.search||url.hash)throw new Error();
    return url.href.replace(/\/$/,'');
  }catch{throw new Error('无法读取可用的系统代理，请检查系统代理设置。');}
}
module.exports={proxyURL};
