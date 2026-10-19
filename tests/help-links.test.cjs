'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {documentationURL}=require('../app/help-links.cjs');
test('help URLs follow the app language and cover every console panel',()=>{
  const mapping={overview:'console-tour',connection:'first-connection',directories:'work-directories',mcp:'local-services',logs:'live-logs',history:'execution-records',help:'first-task',chatgpt:'chatgpt',codex:'codex'};
  for(const locale of ['en','zh-CN','ja']){
    assert.equal(documentationURL('docs',locale),`https://dj-huang.github.io/ChatToHarness/docs/${locale}/`);
    for(const [panel,slug]of Object.entries(mapping))assert.equal(documentationURL('docs-'+panel,locale),`https://dj-huang.github.io/ChatToHarness/docs/${locale}/${slug}/`);
  }
  assert.ok(documentationURL('docs','fr').endsWith('/en/'));
});
test('help destinations cannot be supplied as arbitrary paths or URLs',()=>{
  for(const id of ['docs-../../','docs-https://example.com','docs-__proto__','docs-constructor','other'])assert.equal(documentationURL(id,'en'),null);
});
