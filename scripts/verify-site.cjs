'use strict';
const baseURL='https://dj-huang.github.io/ChatToHarness/';
const repositoryURL='https://github.com/DJ-Huang/ChatToHarness';
const routes=['','en/','zh-CN/','ja/'];
function validatePage(html,version){
  if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))throw new Error('Expected a stable version.');
  const prefix=`${repositoryURL}/releases/download/v${version}/`;
  const names=[`ChatToHarness-${version}-windows-x64-setup.exe`,`ChatToHarness-${version}-macos-arm64.dmg`,'SHA256SUMS.txt'];
  const links=[...html.matchAll(/href="([^"]*\/releases\/download\/[^\"]*)"/g)].map(match=>match[1]);
  if(names.some(name=>!links.includes(prefix+name))||links.some(url=>!names.some(name=>url===prefix+name)))throw new Error(`Missing or stale public download links; expected v${version}.`);
  const displayed=[...html.matchAll(/<p>[^<]*[:：]\s*([^<]+)<\/p>/g)].some(match=>match[1].trim()===version);
  const badges=[...html.matchAll(/<span>v([0-9.]+)\s/g)].map(match=>match[1]);
  if(badges.length<2||badges.some(value=>value!==version)||!displayed)throw new Error(`Missing or stale displayed version; expected v${version}.`);
}
// GitHub Pages can serve cached HTML for up to ten minutes after a successful deployment.
// Retry for about eleven minutes so a healthy published release is not marked failed by CDN propagation.
async function verifySite(version,{request=fetch,attempts=44,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),report=console.log}={}){
  let failures=[];
  for(let attempt=0;attempt<attempts;attempt++){
    failures=[];
    await Promise.all(routes.map(async route=>{
      const url=baseURL+route;
      try{
        for(const target of [url,url+`?release-check=${encodeURIComponent(version)}-${Date.now()}-${attempt}`]){
          const response=await request(target,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(15000)});
          if(!response.ok)throw new Error(`HTTP ${response.status}`);
          validatePage(await response.text(),version);
        }
      }catch(error){failures.push(`${url}: ${error.message}`);}
    }));
    if(!failures.length){report(`Production verified: v${version}, Chinese/English/Japanese, Windows/macOS/SHA-256 links and displayed versions.`);return;}
    report(`Production check ${attempt+1}/${attempts}: ${failures.join(' | ')}`);
    if(attempt+1<attempts)await wait(15000);
  }
  throw new Error('Pages reported deployment success but production is inconsistent: '+failures.join(' | '));
}
module.exports={validatePage,verifySite};
if(require.main===module)verifySite(process.argv[2]).catch(error=>{console.error(error.message);process.exitCode=1;});
