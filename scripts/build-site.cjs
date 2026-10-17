'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const repository='DJ-Huang/ChatToHarness';
const repoURL='https://github.com/'+repository;
const baseURL='https://dj-huang.github.io/ChatToHarness/';
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function releaseInfo(releases){
  const stable=releases.filter(item=>!item.draft&&!item.prerelease&&/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(item.tag_name));
  stable.sort((a,b)=>{const av=a.tag_name.slice(1).split('.').map(Number),bv=b.tag_name.slice(1).split('.').map(Number);for(let i=0;i<3;i++)if(av[i]!==bv[i])return bv[i]-av[i];return 0;});
  const release=stable[0];
  if(!release)return {version:'首个版本准备中',windows:null,macos:null,checksum:null};
  const version=release.tag_name.slice(1);
  function asset(name){const a=(release.assets||[]).find(item=>item.name===name);if(!a)return null;const expected=`${repoURL}/releases/download/${release.tag_name}/`;if(!a.browser_download_url?.startsWith(expected)||!Number.isSafeInteger(a.size)||a.size<=0)throw new Error('Invalid public release asset.');return a;}
  return {version,windows:asset(`ChatToHarness-${version}-windows-x64-setup.exe`),macos:asset(`ChatToHarness-${version}-macos-arm64.dmg`),checksum:asset('SHA256SUMS.txt')};
}
async function publishedReleases(){
  const all=[];
  for(let page=1;;page++){
    const headers={Accept:'application/vnd.github+json','User-Agent':'ChatToHarness-pages'};
    if(process.env.GITHUB_TOKEN)headers.Authorization='Bearer '+process.env.GITHUB_TOKEN;
    const response=await fetch(`https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`,{headers,signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error('Cannot load releases (HTTP '+response.status+'); existing website will remain published.');
    const items=await response.json();if(!Array.isArray(items))throw new Error('Invalid release list.');all.push(...items);if(items.length<100)return all;
  }
}
function build(releases,output=path.join(root,'dist/site')){
  const info=releaseInfo(releases);
  function download(platform,label){const a=info[platform];return a?`<a class="button ${platform==='windows'?'':'secondary'}" href="${escape(a.browser_download_url)}">${label}<span>v${escape(info.version)} · ${(a.size/1024/1024).toFixed(0)} MB ↗</span></a>`:`<span class="button unavailable" aria-disabled="true">${label}<span>暂未发布</span></span>`;}
  const values={base:'/ChatToHarness/',canonical:baseURL,version:escape(info.version),windows:download('windows','下载 Windows 版本'),macos:download('macos','下载 Mac 版本'),checksum:info.checksum?`<a href="${escape(info.checksum.browser_download_url)}">SHA-256 校验文件 ↗</a>`:'安装包正式发布后显示下载链接',repo:repoURL};
  let html=fs.readFileSync(path.join(root,'site/index.html'),'utf8').replace(/\{\{(\w+)\}\}/g,(_match,key)=>{if(!(key in values))throw new Error('Missing site value '+key);return values[key];});
  fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'index.html'),html);
  fs.copyFileSync(path.join(root,'site/style.css'),path.join(output,'style.css'));
  fs.cpSync(path.join(root,'site/assets'),path.join(output,'assets'),{recursive:true});
  fs.writeFileSync(path.join(output,'.nojekyll'),'');
  fs.writeFileSync(path.join(output,'robots.txt'),`User-agent: *\nAllow: /\nSitemap: ${baseURL}sitemap.xml\n`);
  fs.writeFileSync(path.join(output,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${baseURL}</loc></url></urlset>\n`);
  for(const match of html.matchAll(/(?:href|src)="(\/ChatToHarness\/[^"#?]*)"/g)){
    const name=match[1].slice('/ChatToHarness/'.length)||'index.html';if(!fs.existsSync(path.join(output,name)))throw new Error('Missing website asset: '+name);
  }
  return info;
}
module.exports={releaseInfo,build};
if(require.main===module)(async()=>{const fixture=process.argv.indexOf('--fixture');const releases=fixture>=0?JSON.parse(fs.readFileSync(process.argv[fixture+1],'utf8')):await publishedReleases();console.log('Website built:',build(releases).version);})().catch(error=>{console.error(error.message);process.exitCode=1;});
