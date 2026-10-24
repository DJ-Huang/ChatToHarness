'use strict';
// Articles and images in docs/ are the only content source. This module owns presentation.
const fs=require('node:fs');
const path=require('node:path');
const {Marked}=require('marked');
const root=path.resolve(__dirname,'..');
const navigation=require('../docs/navigation.json');
const messages=require('../site/help/messages.json');
const searchAliases=require('../docs/search-aliases.json');
const {coverage}=require('../docs/feature-coverage.json');
const base='/ChatToHarness/';
const origin='https://dj-huang.github.io';
const repository='https://github.com/DJ-Huang/ChatToHarness/blob/main/';
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const route=(locale,slug='')=>`${base}docs/${locale}/${slug?slug+'/':''}`;
const slugs=navigation.groups.flatMap(group=>group.articles);
// Recognize published section titles without tying their links to document order.
const sectionTitles={
  en:{'your goal':'goal','before you start':'before','steps':'steps','what success looks like':'result','if it does not work':'troubleshooting','next steps':'next'},
  'zh-CN':{'使用目标':'goal','开始前':'before','操作步骤':'steps','完成后的表现':'result','没有成功时':'troubleshooting','下一步':'next'},
  ja:{'目的':'goal','始める前に':'before','操作手順':'steps','完了時の状態':'result','うまくいかない場合':'troubleshooting','次のステップ':'next'}
};
const normalizedHeading=value=>value.trim().toLowerCase().replace(/\s+/g,' ');
function standardSectionId(locale,title){
  const titles=Object.hasOwn(sectionTitles,locale)?sectionTitles[locale]:null,key=normalizedHeading(title);
  return titles&&Object.hasOwn(titles,key)?titles[key]:null;
}
const headingSlug=value=>value.normalize('NFKC').trim().toLowerCase().replace(/[^\p{L}\p{N}_]+/gu,'-').replace(/^-+|-+$/g,'')||'section';
function safeURL(href){
  if(typeof href!=='string'||/[\u0000-\u0020\\]/.test(href)||/^(?:javascript|data|vbscript):/i.test(href))throw new Error('Unsafe documentation link: '+href);
  if(/^[a-z][a-z\d+.-]*:/i.test(href)&&!/^https?:/i.test(href))throw new Error('Unsupported documentation link: '+href);
  return href;
}
function resolveLink(href,source,{image=false,repositoryRoot=root}={}){
  safeURL(href);
  if(/^https?:\/\//i.test(href)){if(image)throw new Error('Documentation images must be in docs/images');return href;}
  if(href.startsWith('#'))return href;
  if(href.startsWith('/'))throw new Error('Use repository-relative documentation links: '+href);
  const [filename,fragment]=href.split('#');
  const target=path.resolve(path.dirname(source),decodeURIComponent(filename));
  const relative=path.relative(repositoryRoot,target).split(path.sep).join('/');
  if(relative.startsWith('../')||!fs.existsSync(target))throw new Error(`Broken documentation link in ${source}: ${href}`);
  if(image){
    if(!relative.startsWith('docs/images/')||!/^\.(png|webp|jpg|jpeg|svg)$/i.test(path.extname(target)))throw new Error('Invalid documentation image: '+href);
    return base+relative;
  }
  const match=/^docs\/(en|zh-CN|ja)\/([a-z\d-]+)\.md$/.exec(relative);
  if(match&&slugs.includes(match[2]))return route(match[1],match[2])+(fragment?'#'+fragment:'');
  if(/^docs\/(en|zh-CN|ja)\/README\.md$/.test(relative))return route(relative.split('/')[1]);
  return repository+relative+(fragment?'#'+fragment:'');
}
function readArticle(locale,slug,{docsRoot=path.join(root,'docs')}={}){
  const source=path.join(docsRoot,locale,slug+'.md');
  const markdown=fs.readFileSync(source,'utf8');
  const title=/^# (.+)$/m.exec(markdown)?.[1];
  if(!title)throw new Error('Missing article title: '+source);
  const toc=[],usedIds=new Set();
  const uniqueId=base=>{let id=base,suffix=2;while(usedIds.has(id))id=base+'-'+suffix++;usedIds.add(id);return id;};
  const parser=new Marked({gfm:true,breaks:false,renderer:{
    html({text}){return escape(text);},
    heading({tokens,depth}){
      const text=this.parser.parseInline(tokens),plain=tokens.map(token=>token.text||token.raw).join('');
      const id=uniqueId(depth===1?'title':depth===2
        ? standardSectionId(locale,plain) || 'section-'+headingSlug(plain)
        : 'sub-'+encodeURIComponent(plain.toLowerCase().replace(/\s+/g,'-')));
      if(depth===2)toc.push({id,text:plain});
      return `<h${depth} id="${escape(id)}">${text}</h${depth}>\n`;
    },
    link({href,tokens,title}){
      const url=resolveLink(href,source,{repositoryRoot:path.dirname(docsRoot)});
      return `<a href="${escape(url)}"${title?` title="${escape(title)}"`:''}${/^https?:/.test(url)?' rel="noreferrer"':''}>${this.parser.parseInline(tokens)}</a>`;
    },
    image({href,text}){
      const url=resolveLink(href,source,{image:true,repositoryRoot:path.dirname(docsRoot)});
      return `<a class="article-image" href="${escape(url)}" data-zoom aria-label="${escape(messages[locale].zoom+': '+text)}"><img src="${escape(url)}" alt="${escape(text)}" loading="lazy" width="1160"></a>`;
    }
  }});
  const html=parser.parse(markdown);
  const parts=markdown.split(/^## (.+)$/m);
  let goalText=parts[2]||'';
  for(let i=1;i<parts.length;i+=2)if(standardSectionId(locale,parts[i])==='goal'){goalText=parts[i+1]||'';break;}
  const goal=goalText.trim().split('\n')[0]||'';
  const text=markdown.replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[#*>`|]/g,'').replace(/\s+/g,' ').trim();
  return {slug,locale,title,summary:goal,html,toc,text,source};
}
function buildHelp(output,{docsRoot=path.join(root,'docs')}={}){
  const catalogs={};const files=[];
  for(const locale of navigation.locales)catalogs[locale]=slugs.map(slug=>readArticle(locale,slug,{docsRoot}));
  fs.cpSync(path.join(docsRoot,'images'),path.join(output,'docs/images'),{recursive:true});
  for(const asset of ['style.css','help.js'])fs.copyFileSync(path.join(root,'site/help',asset),path.join(output,'docs',asset));
  const write=(name,html)=>{const file=path.join(output,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,html);files.push(file);};
  for(const locale of navigation.locales){
    const m=messages[locale],catalog=catalogs[locale],bySlug=Object.fromEntries(catalog.map(item=>[item.slug,item]));
    const website=base+(locale==='en'?'':locale+'/');
    const cards=group=>group.articles.map(slug=>`<a class="topic" href="${route(locale,slug)}"><span>${escape(bySlug[slug].title)}</span><span aria-hidden="true">↗</span></a>`).join('');
    const groups=navigation.groups.map(group=>`<section class="topic-group" id="${group.id}"><div class="group-title"><h2>${escape(group.labels[locale])}</h2><span>${group.articles.length} ${escape(m.count)}</span></div><div class="topics">${cards(group)}</div></section>`).join('');
    for(const article of [null,...catalog]){
      const slug=article?.slug||'',url=route(locale,slug),title=article?article.title+' · '+m.home:m.home+' · ChatToHarness';
      const group=article&&navigation.groups.find(group=>group.articles.includes(slug));
      const nav=navigation.groups.map(item=>`<details${!article||item===group?' open':''}><summary>${escape(item.labels[locale])}</summary>${item.articles.map(id=>`<a href="${route(locale,id)}"${id===slug?' aria-current="page"':''}>${escape(bySlug[id].title)}</a>`).join('')}</details>`).join('');
      const languages=navigation.locales.map(lang=>`<a href="${route(lang,slug)}" lang="${lang}" hreflang="${lang}" data-language="${lang}"${locale===lang?' aria-current="page"':''}>${{en:'English','zh-CN':'简体中文',ja:'日本語'}[lang]}</a>`).join('');
      const search=`<form class="search" role="search"><label class="sr-only" for="help-search">${escape(m.search)}</label><span aria-hidden="true">⌕</span><input id="help-search" type="search" placeholder="${escape(m.placeholder)}" autocomplete="off" maxlength="120"><button type="reset" aria-label="${escape(m.clear)}">×</button></form><div id="search-results" class="search-results" aria-live="polite" hidden></div>`;
      let body;
      if(!article){
        const starters=[['start','first-connection','01'],['features','console-tour','02'],['problems','connection-problems','03']];
        body=`<section class="welcome"><p class="eyebrow">CHATTOHARNESS / ${escape(m.home)}</p><h1>${escape(m.tagline)}</h1><p>${escape(m.intro)}</p>${search}<div class="entrypoints">${starters.map(([key,id,n])=>`<a href="${route(locale,id)}"><small>${n}</small><strong>${escape(m[key])}</strong><span>${escape(bySlug[id].title)} →</span></a>`).join('')}</div></section><div class="catalog-title"><h2>${escape(m.browse)}</h2><span>38 ${escape(m.count)}</span></div>${groups}`;
      }else{
        const index=slugs.indexOf(slug),adjacent=[[slugs[index-1],m.previous],[slugs[index+1],m.next]].map(([id,label])=>id?`<a href="${route(locale,id)}"><small>${escape(label)}</small>${escape(bySlug[id].title)} →</a>`:'<span></span>').join('');
        body=`${search}<nav class="breadcrumbs" aria-label="${escape(m.home)}"><a href="${route(locale)}">${escape(m.home)}</a><span>/</span><a href="${route(locale)}#${group.id}">${escape(group.labels[locale])}</a></nav><p class="article-meta">${escape(m.version)} ${escape(navigation.version)}</p><div class="reading-layout"><article class="prose">${article.html}<nav class="adjacent">${adjacent}</nav><a class="source-link" href="${repository}docs/${locale}/${slug}.md">${escape(m.source)} ↗</a></article><aside class="toc"><strong>${escape(m.contents)}</strong>${article.toc.map(item=>`<a href="#${item.id}">${escape(item.text)}</a>`).join('')}</aside></div>`;
      }
      const html=`<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escape(article?.summary||m.intro)}"><meta name="theme-color" content="#f7f8fc"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'"><title>${escape(title)}</title><link rel="canonical" href="${origin+url}">${navigation.locales.map(lang=>`<link rel="alternate" hreflang="${lang}" href="${origin+route(lang,slug)}">`).join('')}<link rel="icon" href="${base}assets/logo.png"><link rel="stylesheet" href="${base}docs/style.css"><script src="${base}docs/help.js" defer></script></head><body data-locale="${locale}" data-slug="${slug}"><a class="skip" href="#main">${escape(m.skip)}</a><header class="help-header"><a class="brand" href="${route(locale)}"><img src="${base}assets/logo.png" width="34" height="34" alt=""><span>ChatToHarness<small>${escape(m.home)}</small></span></a><div class="header-links"><a href="${website}">${escape(m.website)} ↗</a><nav class="languages" aria-label="Language">${languages}</nav><button id="topics-toggle" aria-expanded="false" aria-controls="topics-nav">${escape(m.menu)}</button></div></header><div class="help-shell"><aside class="topics-nav" id="topics-nav"><a class="all-topics" href="${route(locale)}">${escape(m.all)}</a>${nav}</aside><main id="main" tabindex="-1">${body}<footer><span>${escape(m.updated)}</span><a href="${repository}docs/${locale}/README.md">GitHub ↗</a></footer></main></div><dialog id="image-dialog" aria-label="${escape(m.zoom)}"><button autofocus type="button" aria-label="${escape(m.imageClose)}">×</button><img alt=""></dialog></body></html>`;
      write(`docs/${locale}/${slug?slug+'/':''}index.html`,html);
    }
    fs.writeFileSync(path.join(output,'docs',locale,'search.json'),JSON.stringify({messages:m,articles:catalog.map(({slug,title,summary,text})=>({slug,title,summary,text,keywords:[...(searchAliases[slug]?.[locale]||[]),...(coverage[slug]?.tools||[])].join(' '),url:route(locale,slug)}))}));
    fs.writeFileSync(path.join(output,'docs',locale,'messages.json'),JSON.stringify(m));
  }
  write('docs/index.html',`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${route('en')}"><title>Help center</title></head><body><a href="${route('en')}">English</a> <a href="${route('zh-CN')}">简体中文</a> <a href="${route('ja')}">日本語</a></body></html>`);
  return {files,urls:navigation.locales.flatMap(locale=>['',...slugs].map(slug=>origin+route(locale,slug)))};
}
module.exports={buildHelp,readArticle,resolveLink,safeURL,route,slugs};
