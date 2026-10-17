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
const siteMessages=require('../site/locales.json');
const locales=['zh-CN','en','ja'];
const route=locale=>'/ChatToHarness/'+(locale==='zh-CN'?'':locale+'/');
function siteText(locale,text){return locale==='zh-CN'?text:siteMessages[text]?.[locale==='en'?0:1]||text;}
function localizeMarkup(html,locale){
  if(locale==='zh-CN')return html;
  const text=value=>{const key=value.trim();return Object.hasOwn(siteMessages,key)?value.replace(key,()=>escape(siteText(locale,key))):value;};
  return html.replace(/>([^<]+)</g,(_match,value)=>'>'+text(value)+'<')
    .replace(/(content|aria-label|alt)="([^"]*)"/g,(_match,name,value)=>name+'="'+escape(siteText(locale,value))+'"');
}
function build(releases,output=path.join(root,'dist/site')){
  const info=releaseInfo(releases);
  fs.mkdirSync(output,{recursive:true});
  fs.copyFileSync(path.join(root,'site/style.css'),path.join(output,'style.css'));
  fs.copyFileSync(path.join(root,'site/language.js'),path.join(output,'language.js'));
  fs.cpSync(path.join(root,'site/assets'),path.join(output,'assets'),{recursive:true});
  const pages=[];
  for(const locale of locales){
    const t=text=>siteText(locale,text);
    function download(platform,label){const a=info[platform];return a?`<a class="button ${platform==='windows'?'':'secondary'}" href="${escape(a.browser_download_url)}">${escape(t(label))}<span>v${escape(info.version)} · ${(a.size/1024/1024).toFixed(0)} MB ↗</span></a>`:`<span class="button unavailable" aria-disabled="true">${escape(t(label))}<span>${escape(t('暂未发布'))}</span></span>`;}
    const canonical=baseURL+(locale==='zh-CN'?'':locale+'/');
    const values={base:'/ChatToHarness/',localeBase:route(locale),lang:locale,docLocale:locale,
      guideAnchor:{'zh-CN':'故障处理',en:'troubleshooting',ja:'トラブルシューティング'}[locale],
      canonical,alternates:locales.map(lang=>`<link rel="alternate" hreflang="${lang}" href="${baseURL+(lang==='zh-CN'?'':lang+'/')}">`).join(''),
      languageLinks:locales.map(lang=>`<a href="${route(lang)}" lang="${lang}" hreflang="${lang}" data-language="${lang}"${lang===locale?' aria-current="page"':''}>${{'zh-CN':'中文',en:'English',ja:'日本語'}[lang]}</a>`).join(''),
      version:escape(t(info.version)),windows:download('windows','下载 Windows 版本'),macos:download('macos','下载 Mac 版本'),
      checksum:info.checksum?`<a href="${escape(info.checksum.browser_download_url)}">${escape(t('SHA-256 校验文件 ↗'))}</a>`:escape(t('安装包正式发布后显示下载链接')),repo:repoURL};
    const html=localizeMarkup(fs.readFileSync(path.join(root,'site/index.html'),'utf8'),locale)
      .replace(/\{\{(\w+)\}\}/g,(_match,key)=>{if(!(key in values))throw new Error('Missing site value '+key);return values[key];});
    const folder=path.join(output,locale==='zh-CN'?'':locale);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'index.html'),html);pages.push(html);
  }
  fs.writeFileSync(path.join(output,'.nojekyll'),'');
  fs.writeFileSync(path.join(output,'robots.txt'),`User-agent: *\nAllow: /\nSitemap: ${baseURL}sitemap.xml\n`);
  fs.writeFileSync(path.join(output,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locales.map(locale=>`<url><loc>${baseURL+(locale==='zh-CN'?'':locale+'/')}</loc></url>`).join('')}</urlset>\n`);
  for(const html of pages)for(const match of html.matchAll(/(?:href|src)="(\/ChatToHarness\/[^"#?]*)"/g)){
    const name=match[1].slice('/ChatToHarness/'.length)||'index.html';if(!fs.existsSync(path.join(output,name)))throw new Error('Missing website asset: '+name);
  }
  return info;
}
module.exports={releaseInfo,build,publishedReleases};
if(require.main===module)(async()=>{
  const {prepareDeployment}=require('./site-deployment.cjs');
  const fixture=process.argv.indexOf('--fixture');
  const load=fixture>=0?async()=>JSON.parse(fs.readFileSync(process.argv[fixture+1],'utf8')):publishedReleases;
  const event=process.env.GITHUB_EVENT_PATH?JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')):{};
  const {releases,info}=await prepareDeployment({load,event,eventName:process.env.GITHUB_EVENT_NAME,ref:process.env.GITHUB_REF});
  build(releases);
  if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`version=${info.version}\n`);
  console.log('Website built:',info.version);
})().catch(error=>{console.error(error.message);process.exitCode=1;});
