'use strict';
const {releaseInfo}=require('./build-site.cjs');
const stable=/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function expectedTag(eventName,ref='',event={}){
  if(eventName==='push'&&ref.startsWith('refs/tags/'))return ref.slice(10);
  if(eventName==='release'&&event.action!=='deleted'&&!event.release?.prerelease&&!event.release?.draft)return event.release?.tag_name||'';
  return '';
}

// Publishing a release and listing it are separate API operations. Never turn a
// temporarily stale list into a successful deployment of the previous release.
async function prepareDeployment({load,eventName,ref='',event={},attempts=6,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  const required=expectedTag(eventName,ref,event);
  for(let attempt=0;attempt<attempts;attempt++){
    const releases=await load();
    const info=releaseInfo(releases);
    const release=required&&releases.find(item=>item.tag_name===required&&!item.draft&&!item.prerelease);
    const ready=!stable.test(required)||(release&&['windows','macos','checksum'].every(key=>releaseInfo([release])[key]));
    if(ready)return {releases,info};
    if(attempt+1<attempts)await wait(10000);
  }
  throw new Error(`Published release ${required} and both installers/checksums are not visible; refusing to deploy older downloads.`);
}
module.exports={expectedTag,prepareDeployment};
