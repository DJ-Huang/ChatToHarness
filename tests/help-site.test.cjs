'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {buildHelp,readArticle,resolveLink,safeURL,slugs}=require('../scripts/help-site.cjs');
const navigation=require('../docs/navigation.json');
const root=path.resolve(__dirname,'..');
test('all 114 repository articles build with translated navigation, stable sections, images and deep links',t=>{
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'cth-help-site-'));t.after(()=>fs.rmSync(output,{recursive:true,force:true}));
  assert.equal(slugs.length,38);assert.equal(new Set(slugs).size,38);
  const built=buildHelp(output);assert.equal(built.urls.length,117);
  for(const locale of navigation.locales){
    const search=JSON.parse(fs.readFileSync(path.join(output,'docs',locale,'search.json'),'utf8'));assert.equal(search.articles.length,38);
    for(const slug of slugs){
      const source=readArticle(locale,slug),html=fs.readFileSync(path.join(output,'docs',locale,slug,'index.html'),'utf8');
      assert.ok(html.includes(`<h1 id="title">${source.title}</h1>`));
      assert.match(html,new RegExp(`<html lang="${locale}">`));
      assert.ok(html.includes(`github.com/DJ-Huang/ChatToHarness/blob/main/docs/${locale}/${slug}.md`));
      for(const section of ['goal','before','steps','result','troubleshooting','next'])assert.ok(html.includes(`id="${section}"`));
      for(const lang of navigation.locales)assert.ok(html.includes(`href="/ChatToHarness/docs/${lang}/${slug}/" lang="${lang}"`));
      for(const match of html.matchAll(/(?:href|src)="(\/ChatToHarness\/docs\/[^"#]*)"/g)){
        const relative=match[1].slice('/ChatToHarness/'.length),target=path.join(output,relative);
        assert.ok(fs.existsSync(target),`Missing website link ${target}`);
      }
      const indexed=search.articles.find(article=>article.slug===slug);assert.equal(indexed.title,source.title);assert.ok(indexed.text.includes(source.summary));
    }
  }
});
test('editing repository prose changes website and search output without a second content copy',t=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cth-help-source-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
  const docs=path.join(tmp,'docs'),output=path.join(tmp,'output');fs.cpSync(path.join(root,'docs'),docs,{recursive:true});
  const file=path.join(docs,'en/first-connection.md');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('Prepare the desktop app','Repository-only proof: prepare the desktop app'));
  buildHelp(output,{docsRoot:docs});
  assert.match(fs.readFileSync(path.join(output,'docs/en/first-connection/index.html'),'utf8'),/Repository-only proof/);
  assert.match(fs.readFileSync(path.join(output,'docs/en/search.json'),'utf8'),/Repository-only proof/);
});
test('repository links work on GitHub and resolve to website articles or preserved developer references',()=>{
  const source=path.join(root,'docs/zh-CN/first-connection.md');
  assert.equal(resolveLink('first-task.md',source),'/ChatToHarness/docs/zh-CN/first-task/');
  assert.equal(resolveLink('../en/first-task.md',source),'/ChatToHarness/docs/en/first-task/');
  assert.equal(resolveLink('GUIDE.md#故障处理',source),'https://github.com/DJ-Huang/ChatToHarness/blob/main/docs/zh-CN/GUIDE.md#故障处理');
  assert.throws(()=>resolveLink('../images/missing.png',source,{image:true}),/Broken/);
  assert.throws(()=>resolveLink('../../../outside.md',source),/Broken/);
  for(const url of ['javascript:alert(1)','data:text/html,test','//example.com/test','https://example.com/a b'])assert.throws(()=>resolveLink(url,source));
});
test('Markdown rendering escapes raw HTML and rejects unsafe embedded links',t=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cth-help-markdown-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
  fs.mkdirSync(path.join(tmp,'docs/en'),{recursive:true});const file=path.join(tmp,'docs/en/sample.md');
  const text='# Example\n\n'+['Goal','Before','Steps','Result','Troubleshooting','Next'].map(section=>'## '+section+'\n\nText.\n').join('\n');
  fs.writeFileSync(file,text+'\n<script>alert(1)</script>');const article=readArticle('en','sample',{docsRoot:path.join(tmp,'docs')});assert.doesNotMatch(article.html,/<script>/);assert.match(article.html,/&lt;script&gt;/);
  assert.throws(()=>safeURL('javascript:alert(1)'));
});
test('documentation and renderer changes trigger the existing Pages build',()=>{
  const workflow=fs.readFileSync(path.join(root,'.github/workflows/pages.yml'),'utf8');
  assert.equal(workflow.match(/'docs\/\*\*'/g).length,2);assert.ok(workflow.includes('npm ci --ignore-scripts'));
  assert.ok(workflow.includes("if: github.event_name != 'pull_request'"));
});
test('every built-in tool and documented console action maps to a real article',()=>{
  const {coverage}=require('../docs/feature-coverage.json');
  const names=new Set(Object.values(coverage).flatMap(item=>item.tools));
  const {DC_TOOLS,TOOLS}=require('../app/harness-services.cjs');
  for(const name of [...DC_TOOLS,...TOOLS.map(item=>item.name),'start_task','get_task_status','get_task_result','get_task_logs','list_tasks','cancel_task','apply_project_edit','undo_project_edit','get_project_context','search_project','mcp_list_resources','mcp_read_resource','mcp_list_prompts','mcp_get_prompt'])assert.ok(names.has(name),'Undocumented tool: '+name);
  const html=fs.readFileSync(path.join(root,'app/index.html'),'utf8');
  for(const [slug,item]of Object.entries(coverage)){
    assert.ok(slugs.includes(slug),'Unknown coverage article: '+slug);
    for(const id of item.ui)assert.ok(html.includes(`id="${id}"`),'Missing console control: '+id);
  }
  const guide=fs.readFileSync(path.join(root,'docs/zh-CN/GUIDE.md'),'utf8');
  for(const heading of ['## 安装与使用','## MCP Servers','## 应用更新','## 故障处理'])assert.ok(guide.includes(heading),'Lost old guide anchor: '+heading);
});
