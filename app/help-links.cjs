'use strict';
const {normalize}=require('./i18n.js');
const pages=Object.freeze({overview:'console-tour',connection:'first-connection',directories:'work-directories',mcp:'local-services',logs:'live-logs',history:'execution-records',help:'first-task',chatgpt:'chatgpt',codex:'codex'});
function documentationURL(id,locale){
  if(typeof id!=='string')return null;
  if(id!=='docs'&&!(id.startsWith('docs-')&&Object.hasOwn(pages,id.slice(5))))return null;
  const slug=id==='docs'?'':pages[id.slice(5)]+'/';
  return `https://dj-huang.github.io/ChatToHarness/docs/${normalize(locale)}/${slug}`;
}
module.exports={documentationURL};
