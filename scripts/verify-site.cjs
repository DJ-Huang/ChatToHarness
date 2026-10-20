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
// Verify real public URLs as well as cache-busted URLs. A stale deployment must
// fail with actionable evidence, rather than spending eleven minutes polling it.
async function verifySite(version,{request=fetch,attempts=24,budgetMs=120000,clock=Date.now,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),report=console.log}={}){
  if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))throw new Error('Expected a stable version.');
  if(!Number.isInteger(attempts)||attempts<1||!Number.isFinite(budgetMs)||budgetMs<=0)throw new Error('Invalid production verification budget.');
  const started=clock(),deadline=started+budgetMs;
  let failures=[];
  for(let attempt=0;attempt<attempts;attempt++){
    if(clock()>=deadline)break;
    const targets=routes.flatMap(route=>{const url=baseURL+route;return [url,url+`?release-check=${encodeURIComponent(version)}-${clock()}-${attempt}`];});
    const results=await Promise.all(targets.map(async target=>{
      let evidence={};
      try{
        const remaining=Math.max(1,Math.min(10000,deadline-clock()));
        const response=await request(target,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(remaining)});
        evidence={status:response.status,age:response.headers?.get('age'),cache:response.headers?.get('x-cache'),etag:response.headers?.get('etag')};
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        const html=await response.text();
        evidence.versions=[...new Set([...html.matchAll(/\/releases\/download\/(v[0-9.]+)\//g)].map(match=>match[1]))];
        if(clock()>=deadline)throw new Error('Production verification time budget exhausted.');
        validatePage(html,version);
        return null;
      }catch(error){return `${target}: ${error.message} ${JSON.stringify(evidence)}`;}
    }));
    failures=results.filter(Boolean);
    if(!failures.length){report(`Production verified: v${version}, Chinese/English/Japanese, Windows/macOS/SHA-256 links and displayed versions.`);return;}
    report(`Production check ${attempt+1}/${attempts} (${((clock()-started)/1000).toFixed(1)}s): ${failures.join(' | ')}`);
    if(attempt+1<attempts&&clock()<deadline)await wait(Math.min(5000,deadline-clock()));
  }
  throw new Error('Pages reported deployment success but production is inconsistent. Inspect the deployed artifact and workflow event; dispatch Website on main if an old release is still served. '+failures.join(' | '));
}
module.exports={validatePage,verifySite};
if(require.main===module)verifySite(process.argv[2]).catch(error=>{console.error(error.message);process.exitCode=1;});
